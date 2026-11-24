import { updateContactSchema, type Contact } from '@gigachat/shared';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../context';
import { schema } from '../../db';
import { notFound } from '../../lib/errors';
import { isRecentlySeen, iso, messagePreview } from '../../lib/serialize';
import { parse, toInt } from '../../lib/validate';
import { requireAuth } from '../../plugins/auth';
import { dmKey } from '../conversations/service';

export async function listContacts(ctx: AppContext, meId: number): Promise<Contact[]> {
  const { db, hub } = ctx;
  const now = Date.now();

  const [users, contactRows, memberships] = await Promise.all([
    db.select().from(schema.users).where(ne(schema.users.id, meId)),
    db.select().from(schema.contacts).where(eq(schema.contacts.ownerId, meId)),
    db
      .select({
        conv: schema.conversations,
        member: schema.conversationMembers,
        unread: sql<number>`(
          SELECT count(*)::int FROM ${schema.messages} m
          WHERE m.conversation_id = ${schema.conversations.id}
            AND m.deleted_at IS NULL
            AND m.kind <> 'system'
            AND m.id > COALESCE(${schema.conversationMembers.lastReadMessageId}, 0)
            AND m.sender_id IS DISTINCT FROM ${meId}
        )`,
        lastMessageId: sql<number | null>`(
          SELECT max(m.id) FROM ${schema.messages} m WHERE m.conversation_id = ${schema.conversations.id}
        )`,
        memberCount: sql<number>`(
          SELECT count(*)::int FROM ${schema.conversationMembers} cm WHERE cm.conversation_id = ${schema.conversations.id}
        )`,
      })
      .from(schema.conversationMembers)
      .innerJoin(schema.conversations, eq(schema.conversations.id, schema.conversationMembers.conversationId))
      .where(eq(schema.conversationMembers.userId, meId)),
  ]);

  const lastIds = memberships.map((m) => m.lastMessageId).filter((id): id is number => typeof id === 'number');
  const lastMessages = lastIds.length
    ? await db.select().from(schema.messages).where(inArray(schema.messages.id, lastIds))
    : [];
  const lastById = new Map(lastMessages.map((m) => [m.id, m]));
  const contactByTarget = new Map(contactRows.map((c) => [c.targetId, c]));
  const dmByKey = new Map(memberships.filter((m) => m.conv.kind === 'dm').map((m) => [m.conv.dmKey!, m]));

  const out: Contact[] = [];

  for (const u of users) {
    const c = contactByTarget.get(u.id);
    const m = dmByKey.get(dmKey(meId, u.id));
    const last = m?.lastMessageId ? lastById.get(m.lastMessageId) : undefined;
    out.push({
      kind: 'user',
      id: u.id,
      conversationId: m?.conv.id ?? null,
      name: c?.alias?.trim() || u.username,
      username: u.username,
      alias: c?.alias ?? null,
      color: u.color ?? null,
      emoji: u.emoji ?? null,
      gigascore: u.gigascore,
      role: u.role,
      online: hub.isOnline(u.id) || isRecentlySeen(u.lastSeen, now),
      lastSeen: iso(u.lastSeen),
      pinned: c?.pinned ?? false,
      archived: c?.archived ?? false,
      unread: m?.unread ?? 0,
      lastMessageAt: iso(m?.conv.lastMessageAt ?? null),
      lastMessagePreview: last ? messagePreview(last) : null,
      memberCount: null,
    });
  }

  for (const m of memberships) {
    if (m.conv.kind !== 'group') continue;
    const last = m.lastMessageId ? lastById.get(m.lastMessageId) : undefined;
    out.push({
      kind: 'group',
      id: m.conv.id,
      conversationId: m.conv.id,
      name: m.conv.name ?? 'Gruppe',
      username: null,
      alias: null,
      color: null,
      emoji: null,
      gigascore: 0,
      role: 0,
      online: false,
      lastSeen: null,
      pinned: m.member.pinned,
      archived: m.member.archived,
      unread: m.unread,
      lastMessageAt: iso(m.conv.lastMessageAt),
      lastMessagePreview: last ? messagePreview(last) : null,
      memberCount: m.memberCount,
    });
  }

  out.sort((a, b) => {
    if (a.archived !== b.archived) return a.archived ? 1 : -1;
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    const ta = a.lastMessageAt ? Date.parse(a.lastMessageAt) : 0;
    const tb = b.lastMessageAt ? Date.parse(b.lastMessageAt) : 0;
    if (ta !== tb) return tb - ta;
    return a.name.localeCompare(b.name, 'de');
  });

  return out;
}

export function contactRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db } = ctx;

  app.get('/api/contacts', async (req) => {
    const me = requireAuth(req);
    return { contacts: await listContacts(ctx, me.id) };
  });

  app.patch('/api/contacts/:userId', async (req) => {
    const me = requireAuth(req);
    const targetId = toInt((req.params as { userId: string }).userId, 'userId');
    const input = parse(updateContactSchema, req.body);

    const target = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.id, targetId)).limit(1);
    if (!target[0] || targetId === me.id) throw notFound('Benutzer nicht gefunden');

    const values = {
      ownerId: me.id,
      targetId,
      alias: input.alias === undefined ? undefined : input.alias?.trim() || null,
      pinned: input.pinned,
      archived: input.archived,
    };
    const set: Record<string, unknown> = {};
    if (values.alias !== undefined) set.alias = values.alias;
    if (values.pinned !== undefined) set.pinned = values.pinned;
    if (values.archived !== undefined) set.archived = values.archived;

    await db
      .insert(schema.contacts)
      .values({ ownerId: me.id, targetId, alias: values.alias ?? null, pinned: values.pinned ?? false, archived: values.archived ?? false })
      .onConflictDoUpdate({ target: [schema.contacts.ownerId, schema.contacts.targetId], set });

    const rows = await db
      .select()
      .from(schema.contacts)
      .where(and(eq(schema.contacts.ownerId, me.id), eq(schema.contacts.targetId, targetId)))
      .limit(1);
    return { contact: rows[0] };
  });
}
