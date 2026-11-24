import { APP_VERSION, ROLES, loginSchema, registerSchema, type AppConfig } from '@gigachat/shared';
import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../context';
import { schema } from '../../db';
import { conflict, unauthorized } from '../../lib/errors';
import { hashPassword, needsRehash, verifyPassword } from '../../lib/password';
import { toMe } from '../../lib/serialize';
import { parse } from '../../lib/validate';
import { createSession, destroySession } from '../../plugins/auth';

export function configFor(ctx: AppContext): AppConfig {
  return {
    version: APP_VERSION,
    vapidPublicKey: ctx.push.publicKey,
    giphyApiKey: ctx.env.giphyApiKey,
    pushEnabled: ctx.push.enabled,
  };
}

export function authRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db, hub } = ctx;

  app.post('/api/auth/register', async (req, reply) => {
    ctx.limits.register.check(`register:${req.ip}`);
    const input = parse(registerSchema, req.body);
    if (input.website) {
      // Honeypot filled in: behave like success without creating anything.
      return reply.code(201).send({ ok: true });
    }

    const taken = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(sql`lower(${schema.users.username}) = lower(${input.username})`)
      .limit(1);
    if (taken[0]) throw conflict('username_taken', 'Benutzername bereits vergeben');

    const countRows = await db.select({ n: sql<number>`count(*)::int` }).from(schema.users);
    const isFirst = (countRows[0]?.n ?? 0) === 0;

    const passwordHash = await hashPassword(input.password);
    const inserted = await db
      .insert(schema.users)
      .values({
        username: input.username,
        passwordHash,
        role: isFirst ? ROLES.OWNER : ROLES.USER,
        lastSeen: new Date(),
      })
      .returning();
    const user = inserted[0]!;

    await createSession(ctx, reply, user.id, input.remember, req.headers['user-agent']);
    hub.broadcast({ t: 'contacts.changed' });
    return reply.code(201).send({ user: toMe(user, true), config: configFor(ctx) });
  });

  app.post('/api/auth/login', async (req, reply) => {
    const input = parse(loginSchema, req.body);
    // Every attempt is counted *before* the password check (no window for parallel
    // requests to slip past the limit) and refunded only when the password was right.
    // The account counter is scoped to the caller's IP, so an attacker cannot lock a
    // legitimate user out from somewhere else.
    const ipKey = `login:ip:${req.ip}`;
    const userKey = `login:user:${input.username.toLowerCase()}:${req.ip}`;
    ctx.limits.login.check(ipKey);
    ctx.limits.login.check(userKey);

    const rows = await db
      .select()
      .from(schema.users)
      .where(sql`lower(${schema.users.username}) = lower(${input.username})`)
      .limit(1);
    const user = rows[0];
    const ok = user ? await verifyPassword(input.password, user.passwordHash) : false;
    if (!user || !ok) throw unauthorized('Benutzername oder Passwort falsch');
    ctx.limits.login.release(ipKey);
    ctx.limits.login.release(userKey);

    if (needsRehash(user.passwordHash)) {
      const passwordHash = await hashPassword(input.password);
      await db.update(schema.users).set({ passwordHash }).where(eq(schema.users.id, user.id));
    }
    await db.update(schema.users).set({ lastSeen: new Date() }).where(eq(schema.users.id, user.id));

    await createSession(ctx, reply, user.id, input.remember, req.headers['user-agent']);
    return { user: toMe(user, true), config: configFor(ctx) };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    await destroySession(ctx, reply, req.sessionId);
    return { ok: true };
  });

  app.get('/api/auth/me', async (req) => {
    if (!req.user) throw unauthorized();
    return { user: toMe(req.user, true), config: configFor(ctx) };
  });
}
