import { ROLES, addMemberSchema, createGroupSchema, renameGroupSchema } from '@gigachat/shared';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../context';
import { schema } from '../../db';
import type { UserRow } from '../../db/schema';
import { badRequest, forbidden, notFound } from '../../lib/errors';
import { parse, toInt } from '../../lib/validate';
import { requireAuth } from '../../plugins/auth';
import { conversationDetail } from '../conversations/routes';

export function groupRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db, hub, conversations } = ctx;

  async function loadGroup(id: number) {
    const conv = await conversations.getConversation(id);
    if (conv.kind !== 'group') throw notFound('Gruppe nicht gefunden');
    return conv;
  }

  function assertManager(conv: { createdBy: number | null }, me: UserRow) {
    if (conv.createdBy !== me.id && me.role < ROLES.ADMIN) throw forbidden('Nur der Ersteller kann die Gruppe verwalten');
  }

  app.post('/api/groups', async (req, reply) => {
    const me = requireAuth(req);
    const input = parse(createGroupSchema, req.body);
    const memberIds = [...new Set(input.memberIds.filter((id) => id !== me.id))];
    if (memberIds.length) {
      const found = await db.select({ id: schema.users.id }).from(schema.users).where(inArray(schema.users.id, memberIds));
      if (found.length !== memberIds.length) throw badRequest('unknown_member', 'Unbekannter Benutzer in der Mitgliederliste');
    }

    const id = await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(schema.conversations)
        .values({ kind: 'group', name: input.name, createdBy: me.id, lastMessageAt: new Date() })
        .returning({ id: schema.conversations.id });
      const convId = inserted[0]!.id;
      await tx.insert(schema.conversationMembers).values([me.id, ...memberIds].map((userId) => ({ conversationId: convId, userId })));
      await conversations.system(convId, me.id, `${me.username} hat die Gruppe erstellt`, tx);
      return convId;
    });

    hub.sendToUsers([me.id, ...memberIds], { t: 'contacts.changed' });
    return reply.code(201).send({ conversation: await conversationDetail(ctx, id, me.id) });
  });

  app.patch('/api/groups/:id', async (req) => {
    const me = requireAuth(req);
    const id = toInt((req.params as { id: string }).id);
    const conv = await loadGroup(id);
    await conversations.assertMember(id, me.id);
    assertManager(conv, me);
    const input = parse(renameGroupSchema, req.body);
    await db.update(schema.conversations).set({ name: input.name }).where(eq(schema.conversations.id, id));
    await conversations.system(id, me.id, `${me.username} hat die Gruppe in „${input.name}“ umbenannt`);
    const members = await conversations.memberIds(id);
    hub.sendToUsers(members, { t: 'conversation.changed', conversationId: id });
    hub.sendToUsers(members, { t: 'contacts.changed' });
    return { conversation: await conversationDetail(ctx, id, me.id) };
  });

  app.post('/api/groups/:id/members', async (req) => {
    const me = requireAuth(req);
    const id = toInt((req.params as { id: string }).id);
    const conv = await loadGroup(id);
    await conversations.assertMember(id, me.id);
    assertManager(conv, me);
    const input = parse(addMemberSchema, req.body);

    const user = await db.select().from(schema.users).where(eq(schema.users.id, input.userId)).limit(1);
    if (!user[0]) throw notFound('Benutzer nicht gefunden');

    const inserted = await db
      .insert(schema.conversationMembers)
      .values({ conversationId: id, userId: input.userId })
      .onConflictDoNothing()
      .returning({ userId: schema.conversationMembers.userId });
    if (inserted[0]) {
      await conversations.system(id, me.id, `${me.username} hat ${user[0].username} hinzugefügt`);
    }
    const members = await conversations.memberIds(id);
    hub.sendToUsers(members, { t: 'conversation.changed', conversationId: id });
    hub.sendToUsers(members, { t: 'contacts.changed' });
    return { conversation: await conversationDetail(ctx, id, me.id) };
  });

  app.delete('/api/groups/:id/members/:userId', async (req) => {
    const me = requireAuth(req);
    const id = toInt((req.params as { id: string }).id);
    const userId = toInt((req.params as { userId: string }).userId, 'userId');
    const conv = await loadGroup(id);
    await conversations.assertMember(id, me.id);
    assertManager(conv, me);
    if (userId === me.id) throw badRequest('use_leave', 'Nutze „Gruppe verlassen“');

    const user = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
    const before = await conversations.memberIds(id);
    const deleted = await db
      .delete(schema.conversationMembers)
      .where(and(eq(schema.conversationMembers.conversationId, id), eq(schema.conversationMembers.userId, userId)))
      .returning({ userId: schema.conversationMembers.userId });
    if (deleted[0] && user[0]) {
      await conversations.system(id, me.id, `${me.username} hat ${user[0].username} entfernt`);
    }
    hub.sendToUsers(before, { t: 'conversation.changed', conversationId: id });
    hub.sendToUsers(before, { t: 'contacts.changed' });
    return { conversation: await conversationDetail(ctx, id, me.id) };
  });

  app.post('/api/groups/:id/leave', async (req) => {
    const me = requireAuth(req);
    const id = toInt((req.params as { id: string }).id);
    const conv = await loadGroup(id);
    await conversations.assertMember(id, me.id);

    const before = await conversations.memberIds(id);
    await db
      .delete(schema.conversationMembers)
      .where(and(eq(schema.conversationMembers.conversationId, id), eq(schema.conversationMembers.userId, me.id)));
    const remaining = before.filter((u) => u !== me.id);

    if (remaining.length === 0) {
      await db.delete(schema.conversations).where(eq(schema.conversations.id, id));
    } else {
      if (conv.createdBy === me.id) {
        const oldest = await db
          .select({ userId: schema.conversationMembers.userId })
          .from(schema.conversationMembers)
          .where(eq(schema.conversationMembers.conversationId, id))
          .orderBy(asc(schema.conversationMembers.joinedAt), asc(schema.conversationMembers.userId))
          .limit(1);
        await db.update(schema.conversations).set({ createdBy: oldest[0]?.userId ?? null }).where(eq(schema.conversations.id, id));
      }
      await conversations.system(id, me.id, `${me.username} hat die Gruppe verlassen`);
      hub.sendToUsers(remaining, { t: 'conversation.changed', conversationId: id });
    }
    hub.sendToUsers(before, { t: 'contacts.changed' });
    return { ok: true };
  });
}
