import { notesSchema } from '@gigachat/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../context';
import { schema } from '../../db';
import { parse } from '../../lib/validate';
import { requireAuth } from '../../plugins/auth';

export function notesRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db } = ctx;

  app.get('/api/notes', async (req) => {
    const me = requireAuth(req);
    const rows = await db.select().from(schema.notes).where(eq(schema.notes.userId, me.id)).limit(1);
    return { content: rows[0]?.content ?? '', updatedAt: rows[0]?.updatedAt.toISOString() ?? null };
  });

  app.put('/api/notes', async (req) => {
    const me = requireAuth(req);
    const input = parse(notesSchema, req.body);
    const now = new Date();
    await db
      .insert(schema.notes)
      .values({ userId: me.id, content: input.content, updatedAt: now })
      .onConflictDoUpdate({ target: schema.notes.userId, set: { content: input.content, updatedAt: now } });
    return { ok: true, updatedAt: now.toISOString() };
  });
}
