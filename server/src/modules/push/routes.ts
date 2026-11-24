import { pushReplySchema, pushSubscriptionSchema, pushUnsubscribeSchema } from '@gigachat/shared';
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../context';
import { schema } from '../../db';
import { parse } from '../../lib/validate';
import { requireAuth } from '../../plugins/auth';

export function pushRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db, push } = ctx;

  app.get('/api/push/status', async (req) => {
    const me = requireAuth(req);
    const rows = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.pushSubscriptions)
      .where(eq(schema.pushSubscriptions.userId, me.id));
    return { enabled: push.enabled, publicKey: push.publicKey, subscriptions: rows[0]?.n ?? 0 };
  });

  app.post('/api/push/subscribe', async (req) => {
    const me = requireAuth(req);
    const input = parse(pushSubscriptionSchema, req.body);
    await db
      .insert(schema.pushSubscriptions)
      .values({
        userId: me.id,
        endpoint: input.endpoint,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
        userAgent: req.headers['user-agent']?.slice(0, 255) ?? null,
      })
      .onConflictDoUpdate({
        target: schema.pushSubscriptions.endpoint,
        set: { userId: me.id, p256dh: input.keys.p256dh, auth: input.keys.auth, createdAt: new Date() },
      });
    return { ok: true };
  });

  app.post('/api/push/unsubscribe', async (req) => {
    const me = requireAuth(req);
    const input = parse(pushUnsubscribeSchema, req.body);
    await db
      .delete(schema.pushSubscriptions)
      .where(and(eq(schema.pushSubscriptions.userId, me.id), eq(schema.pushSubscriptions.endpoint, input.endpoint)));
    return { ok: true };
  });

  /** Inline reply from a notification action (called by the service worker). */
  app.post('/api/push/reply', async (req, reply) => {
    const me = requireAuth(req);
    ctx.limits.send.check(`send:${me.id}`);
    const input = parse(pushReplySchema, req.body);
    const message = await ctx.conversations.send({
      conversationId: input.conversationId,
      senderId: me.id,
      kind: 'text',
      body: input.text,
      senderName: me.username,
    });
    return reply.code(201).send({ message });
  });
}
