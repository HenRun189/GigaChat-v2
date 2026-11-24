import { ROLES, bugReplySchema, bugReportSchema, bugStatusSchema, type BugReport } from '@gigachat/shared';
import { and, asc, desc, eq, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context';
import { schema } from '../../db';
import { notFound } from '../../lib/errors';
import { parse, toInt } from '../../lib/validate';
import { requireAuth, requireRole } from '../../plugins/auth';

const listQuery = z.object({
  type: z.enum(['bug', 'feature', 'question']).optional(),
  status: z.enum(['open', 'in_progress', 'closed']).optional(),
  sort: z.enum(['new', 'old']).default('new'),
});

function toBug(row: typeof schema.bugReports.$inferSelect, username: string): BugReport {
  return {
    id: row.id,
    userId: row.userId,
    username,
    type: row.type as BugReport['type'],
    title: row.title,
    description: row.description,
    priority: row.priority as BugReport['priority'],
    status: row.status as BugReport['status'],
    createdAt: row.createdAt.toISOString(),
  };
}

export function bugRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db } = ctx;

  app.post('/api/bugs', async (req, reply) => {
    const me = requireAuth(req);
    ctx.limits.general.check(`bugs:${me.id}`, 20);
    const input = parse(bugReportSchema, req.body);
    const inserted = await db.insert(schema.bugReports).values({ userId: me.id, ...input }).returning();
    return reply.code(201).send({ report: toBug(inserted[0]!, me.username) });
  });

  app.get('/api/bugs/mine', async (req) => {
    const me = requireAuth(req);
    const rows = await db.select().from(schema.bugReports).where(eq(schema.bugReports.userId, me.id)).orderBy(desc(schema.bugReports.createdAt));
    return { reports: rows.map((r) => toBug(r, me.username)) };
  });

  app.get('/api/bugs', async (req) => {
    requireRole(req, ROLES.ADMIN);
    const q = parse(listQuery, req.query);
    const conds: SQL[] = [];
    if (q.type) conds.push(eq(schema.bugReports.type, q.type));
    if (q.status) conds.push(eq(schema.bugReports.status, q.status));
    const rows = await db
      .select({ report: schema.bugReports, username: schema.users.username })
      .from(schema.bugReports)
      .innerJoin(schema.users, eq(schema.users.id, schema.bugReports.userId))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(q.sort === 'old' ? asc(schema.bugReports.createdAt) : desc(schema.bugReports.createdAt))
      .limit(500);
    return { reports: rows.map((r) => toBug(r.report, r.username)) };
  });

  app.patch('/api/bugs/:id/status', async (req) => {
    requireRole(req, ROLES.ADMIN);
    const id = toInt((req.params as { id: string }).id);
    const input = parse(bugStatusSchema, req.body);
    const updated = await db.update(schema.bugReports).set({ status: input.status }).where(eq(schema.bugReports.id, id)).returning();
    if (!updated[0]) throw notFound('Ticket nicht gefunden');
    return { ok: true };
  });

  app.post('/api/bugs/:id/reply', async (req, reply) => {
    const me = requireRole(req, ROLES.ADMIN);
    const id = toInt((req.params as { id: string }).id);
    const input = parse(bugReplySchema, req.body);
    const rows = await db.select().from(schema.bugReports).where(eq(schema.bugReports.id, id)).limit(1);
    const report = rows[0];
    if (!report) throw notFound('Ticket nicht gefunden');
    if (report.userId === me.id) {
      return reply.code(400).send({ error: { code: 'self_reply', message: 'Das ist dein eigenes Ticket' } });
    }
    const conversationId = await ctx.conversations.getOrCreateDm(me.id, report.userId);
    const message = await ctx.conversations.send({
      conversationId,
      senderId: me.id,
      kind: 'text',
      body: `Rückfrage zu deinem Ticket „${report.title}“:\n\n${input.text}`,
      senderName: me.username,
    });
    return reply.code(201).send({ message, conversationId });
  });
}
