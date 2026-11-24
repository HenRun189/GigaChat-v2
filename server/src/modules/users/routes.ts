import { changePasswordSchema, deleteAccountSchema, updateProfileSchema } from '@gigachat/shared';
import { and, eq, like, ne, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../context';
import type { Db } from '../../db';
import { schema } from '../../db';
import { conflict, unauthorized } from '../../lib/errors';
import { hashPassword, verifyPassword } from '../../lib/password';
import { isRecentlySeen, toMe, toPublicUser } from '../../lib/serialize';
import { parse } from '../../lib/validate';
import { destroySession, requireAuth } from '../../plugins/auth';

/** Removes a user and everything that belongs to them (dms, memberships, messages …). */
export async function deleteUserCompletely(db: Db, userId: number): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .delete(schema.conversations)
      .where(
        and(
          eq(schema.conversations.kind, 'dm'),
          or(like(schema.conversations.dmKey, `${userId}:%`), like(schema.conversations.dmKey, `%:${userId}`)),
        ),
      );
    await tx.delete(schema.users).where(eq(schema.users.id, userId));
  });
}

export function userRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db, hub } = ctx;

  app.get('/api/users', async (req) => {
    const me = requireAuth(req);
    const rows = await db.select().from(schema.users).where(ne(schema.users.id, me.id)).orderBy(schema.users.username);
    const now = Date.now();
    return {
      users: rows.map((u) => toPublicUser(u, hub.isOnline(u.id) || isRecentlySeen(u.lastSeen, now))),
    };
  });

  app.patch('/api/users/me', async (req) => {
    const me = requireAuth(req);
    const input = parse(updateProfileSchema, req.body);

    if (input.username && input.username.toLowerCase() !== me.username.toLowerCase()) {
      const taken = await db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(and(sql`lower(${schema.users.username}) = lower(${input.username})`, ne(schema.users.id, me.id)))
        .limit(1);
      if (taken[0]) throw conflict('username_taken', 'Benutzername bereits vergeben');
    }

    const patch: Partial<typeof schema.users.$inferInsert> = {};
    if (input.username !== undefined) patch.username = input.username;
    if (input.color !== undefined) patch.color = input.color;
    if (input.emoji !== undefined) patch.emoji = input.emoji || null;
    if (input.theme !== undefined) patch.theme = input.theme;

    const updated = Object.keys(patch).length
      ? (await db.update(schema.users).set(patch).where(eq(schema.users.id, me.id)).returning())[0]!
      : me;

    if (input.username !== undefined || input.color !== undefined || input.emoji !== undefined) {
      hub.broadcast({ t: 'user.updated', user: toPublicUser(updated, true) });
    }
    return { user: toMe(updated, true) };
  });

  app.post('/api/users/me/password', async (req) => {
    const me = requireAuth(req);
    const input = parse(changePasswordSchema, req.body);
    if (!(await verifyPassword(input.currentPassword, me.passwordHash))) {
      throw unauthorized('Aktuelles Passwort ist falsch');
    }
    const passwordHash = await hashPassword(input.newPassword);
    await db.update(schema.users).set({ passwordHash }).where(eq(schema.users.id, me.id));
    // Log out every other device.
    if (req.sessionId) {
      await db.delete(schema.sessions).where(and(eq(schema.sessions.userId, me.id), ne(schema.sessions.id, req.sessionId)));
    }
    return { ok: true };
  });

  app.delete('/api/users/me', async (req, reply) => {
    const me = requireAuth(req);
    const input = parse(deleteAccountSchema, req.body);
    if (!(await verifyPassword(input.password, me.passwordHash))) throw unauthorized('Passwort ist falsch');
    await destroySession(ctx, reply, req.sessionId);
    hub.closeUser(me.id);
    await deleteUserCompletely(db, me.id);
    hub.broadcast({ t: 'contacts.changed' });
    return { ok: true };
  });
}
