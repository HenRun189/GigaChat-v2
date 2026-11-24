import { ROLES, adminResetPasswordSchema, adminRoleSchema, type AdminUserDetail, type AdminUserSummary } from '@gigachat/shared';
import { and, desc, eq, ne, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../context';
import { schema } from '../../db';
import { badRequest, forbidden, notFound } from '../../lib/errors';
import { hashPassword } from '../../lib/password';
import { iso } from '../../lib/serialize';
import { parse, toInt } from '../../lib/validate';
import { requireRole } from '../../plugins/auth';
import { deleteUserCompletely } from '../users/routes';

export function adminRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db, hub } = ctx;

  async function loadUser(id: number) {
    const rows = await db.select().from(schema.users).where(eq(schema.users.id, id)).limit(1);
    if (!rows[0]) throw notFound('Benutzer nicht gefunden');
    return rows[0];
  }

  /** Admins may only act on accounts below their own role; the owner may act on anyone. */
  function assertCanManage(me: { id: number; role: number }, target: { id: number; role: number }) {
    if (target.id === me.id) return;
    if (me.role >= ROLES.OWNER) return;
    if (target.role >= me.role) throw forbidden('Konten mit gleicher oder höherer Rolle können nicht verwaltet werden');
  }

  app.get('/api/admin/users', async (req) => {
    requireRole(req, ROLES.ADMIN);
    const rows = await db.select().from(schema.users).orderBy(schema.users.id);
    const users: AdminUserSummary[] = rows.map((u) => ({
      id: u.id,
      username: u.username,
      role: u.role,
      gigascore: u.gigascore,
      createdAt: u.createdAt.toISOString(),
      lastSeen: iso(u.lastSeen),
    }));
    return { users };
  });

  app.get('/api/admin/users/:id', async (req) => {
    requireRole(req, ROLES.ADMIN);
    const id = toInt((req.params as { id: string }).id);
    const u = await loadUser(id);

    const [sent, dmReceived, groups, pushSubs, sessions, recent] = await Promise.all([
      db.select({ n: sql<number>`count(*)::int` }).from(schema.messages).where(and(eq(schema.messages.senderId, id), ne(schema.messages.kind, 'system'))),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.messages)
        .innerJoin(schema.conversations, eq(schema.conversations.id, schema.messages.conversationId))
        .innerJoin(
          schema.conversationMembers,
          and(eq(schema.conversationMembers.conversationId, schema.conversations.id), eq(schema.conversationMembers.userId, id)),
        )
        .where(and(eq(schema.conversations.kind, 'dm'), ne(schema.messages.senderId, id))),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.conversationMembers)
        .innerJoin(schema.conversations, eq(schema.conversations.id, schema.conversationMembers.conversationId))
        .where(and(eq(schema.conversationMembers.userId, id), eq(schema.conversations.kind, 'group'))),
      db.select({ n: sql<number>`count(*)::int` }).from(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.userId, id)),
      db.select({ n: sql<number>`count(*)::int` }).from(schema.sessions).where(eq(schema.sessions.userId, id)),
      db
        .select({ m: schema.messages, conv: schema.conversations })
        .from(schema.messages)
        .innerJoin(schema.conversations, eq(schema.conversations.id, schema.messages.conversationId))
        .where(eq(schema.messages.senderId, id))
        .orderBy(desc(schema.messages.id))
        .limit(200),
    ]);

    // Resolve dm partner names for the recent list.
    const dmKeys = recent.filter((r) => r.conv.kind === 'dm').map((r) => r.conv.dmKey!);
    const partnerIds = [...new Set(dmKeys.flatMap((k) => k.split(':').map(Number)).filter((x) => x !== id))];
    const partners = partnerIds.length
      ? await db.select({ id: schema.users.id, username: schema.users.username }).from(schema.users).where(sql`${schema.users.id} IN ${partnerIds}`)
      : [];
    const partnerName = new Map(partners.map((p) => [p.id, p.username]));

    const detail: AdminUserDetail = {
      id: u.id,
      username: u.username,
      role: u.role,
      gigascore: u.gigascore,
      createdAt: u.createdAt.toISOString(),
      lastSeen: iso(u.lastSeen),
      color: u.color ?? null,
      emoji: u.emoji ?? null,
      counts: {
        messagesSent: sent[0]?.n ?? 0,
        dmReceived: dmReceived[0]?.n ?? 0,
        groups: groups[0]?.n ?? 0,
        pushSubscriptions: pushSubs[0]?.n ?? 0,
        sessions: sessions[0]?.n ?? 0,
      },
      recentMessages: recent.map((r) => {
        const other = r.conv.kind === 'dm' ? r.conv.dmKey!.split(':').map(Number).find((x) => x !== id) : undefined;
        return {
          id: r.m.id,
          conversationId: r.conv.id,
          conversationName: r.conv.kind === 'dm' ? (other && partnerName.get(other)) || 'Direktnachricht' : r.conv.name ?? 'Gruppe',
          kind: r.conv.kind as 'dm' | 'group',
          body: r.m.kind === 'text' || r.m.kind === 'system' ? r.m.body : `[${r.m.kind}] ${r.m.mediaName ?? r.m.mediaUrl ?? ''}`,
          messageKind: r.m.kind as AdminUserDetail['recentMessages'][number]['messageKind'],
          createdAt: r.m.createdAt.toISOString(),
          deletedAt: iso(r.m.deletedAt),
        };
      }),
    };
    return { user: detail };
  });

  app.post('/api/admin/users/:id/revoke-push', async (req) => {
    const me = requireRole(req, ROLES.ADMIN);
    const id = toInt((req.params as { id: string }).id);
    assertCanManage(me, await loadUser(id));
    await ctx.push.removeForUser(id);
    return { ok: true };
  });

  app.post('/api/admin/users/:id/revoke-sessions', async (req) => {
    const me = requireRole(req, ROLES.ADMIN);
    const id = toInt((req.params as { id: string }).id);
    assertCanManage(me, await loadUser(id));
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, id));
    hub.closeUser(id);
    return { ok: true };
  });

  app.post('/api/admin/users/:id/reset-password', async (req) => {
    const me = requireRole(req, ROLES.ADMIN);
    const id = toInt((req.params as { id: string }).id);
    const target = await loadUser(id);
    assertCanManage(me, target);
    const input = parse(adminResetPasswordSchema, req.body);
    const passwordHash = await hashPassword(input.newPassword);
    await db.update(schema.users).set({ passwordHash }).where(eq(schema.users.id, id));
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, id));
    hub.closeUser(id);
    return { ok: true };
  });

  app.post('/api/admin/users/:id/role', async (req) => {
    const me = requireRole(req, ROLES.OWNER);
    const id = toInt((req.params as { id: string }).id);
    const input = parse(adminRoleSchema, req.body);
    if (id === me.id && input.role < ROLES.OWNER) {
      const owners = await db.select({ n: sql<number>`count(*)::int` }).from(schema.users).where(eq(schema.users.role, ROLES.OWNER));
      if ((owners[0]?.n ?? 0) <= 1) throw badRequest('last_owner', 'Es muss mindestens einen Owner geben');
    }
    await loadUser(id);
    await db.update(schema.users).set({ role: input.role }).where(eq(schema.users.id, id));
    const updated = await loadUser(id);
    hub.broadcast({ t: 'user.updated', user: { id: updated.id, username: updated.username, color: updated.color, emoji: updated.emoji, gigascore: updated.gigascore, role: updated.role, online: hub.isOnline(updated.id), lastSeen: iso(updated.lastSeen) } });
    return { ok: true };
  });

  app.post('/api/admin/users/:id/delete', async (req) => {
    const me = requireRole(req, ROLES.ADMIN);
    const id = toInt((req.params as { id: string }).id);
    if (id === me.id) throw badRequest('self_delete', 'Eigenes Konto bitte über die Einstellungen löschen');
    const target = await loadUser(id);
    assertCanManage(me, target);
    hub.closeUser(id);
    await deleteUserCompletely(db, id);
    hub.broadcast({ t: 'contacts.changed' });
    return { ok: true };
  });

  app.delete('/api/admin/messages/:id', async (req) => {
    const me = requireRole(req, ROLES.ADMIN);
    const id = toInt((req.params as { id: string }).id);
    return { message: await ctx.conversations.remove(id, me.id, true) };
  });
}
