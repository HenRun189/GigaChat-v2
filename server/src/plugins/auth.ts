import { and, eq, gt } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { createHash, randomBytes } from 'node:crypto';
import type { AppContext } from '../context';
import { schema } from '../db';
import type { UserRow } from '../db/schema';
import { forbidden, unauthorized } from '../lib/errors';

export const SESSION_COOKIE = 'gc_session';
const REMEMBER_MS = 30 * 24 * 60 * 60 * 1000;
const SHORT_MS = 12 * 60 * 60 * 1000;
const TOUCH_INTERVAL_MS = 10 * 60 * 1000;

declare module 'fastify' {
  interface FastifyRequest {
    user: UserRow | null;
    sessionId: string | null;
  }
}

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export function cookieOptions(ctx: AppContext, maxAgeMs: number | null) {
  const secure = ctx.env.publicUrl.startsWith('https://');
  return {
    path: '/',
    httpOnly: true,
    secure,
    sameSite: 'lax' as const,
    ...(maxAgeMs ? { maxAge: Math.floor(maxAgeMs / 1000) } : {}),
  };
}

export async function createSession(
  ctx: AppContext,
  reply: FastifyReply,
  userId: number,
  remember: boolean,
  userAgent?: string,
): Promise<void> {
  const token = randomBytes(32).toString('base64url');
  const ttl = remember ? REMEMBER_MS : SHORT_MS;
  await ctx.db.insert(schema.sessions).values({
    id: hashToken(token),
    userId,
    expiresAt: new Date(Date.now() + ttl),
    userAgent: userAgent?.slice(0, 255) ?? null,
  });
  reply.setCookie(SESSION_COOKIE, token, cookieOptions(ctx, remember ? ttl : null));
}

export async function destroySession(ctx: AppContext, reply: FastifyReply, sessionId: string | null): Promise<void> {
  if (sessionId) await ctx.db.delete(schema.sessions).where(eq(schema.sessions.id, sessionId));
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

export const authPlugin = fp(async (app: FastifyInstance, opts: { ctx: AppContext }) => {
  const { ctx } = opts;
  app.decorateRequest('user', null);
  app.decorateRequest('sessionId', null);

  app.addHook('onRequest', async (req) => {
    const token = req.cookies?.[SESSION_COOKIE];
    if (!token) return;
    const id = hashToken(token);
    const now = new Date();
    const rows = await ctx.db
      .select({ session: schema.sessions, user: schema.users })
      .from(schema.sessions)
      .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
      .where(and(eq(schema.sessions.id, id), gt(schema.sessions.expiresAt, now)))
      .limit(1);
    const row = rows[0];
    if (!row) return;
    req.user = row.user;
    req.sessionId = id;
    if (now.getTime() - row.session.lastUsedAt.getTime() > TOUCH_INTERVAL_MS) {
      void ctx.db
        .update(schema.sessions)
        .set({ lastUsedAt: now })
        .where(eq(schema.sessions.id, id))
        .catch(() => {});
    }
  });
});

export function requireAuth(req: FastifyRequest): UserRow {
  if (!req.user) throw unauthorized();
  return req.user;
}

export function requireRole(req: FastifyRequest, minRole: number): UserRow {
  const user = requireAuth(req);
  if (user.role < minRole) throw forbidden();
  return user;
}
