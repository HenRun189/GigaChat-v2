import { ONLINE_WINDOW_SECONDS, ROLES, visitSchema, type StatsOverview } from '@gigachat/shared';
import { desc, eq, gte, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import type { AppContext } from '../../context';
import { schema } from '../../db';
import { iso } from '../../lib/serialize';
import { parse } from '../../lib/validate';
import { requireAuth } from '../../plugins/auth';

const dayStr = (d: Date) => d.toISOString().slice(0, 10);

export function statsRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db, hub } = ctx;

  app.post('/api/stats/visit', async (req) => {
    const me = requireAuth(req);
    const input = parse(visitSchema, req.body);
    const day = dayStr(new Date());
    const visitorHash = createHash('sha256')
      .update(`${me.id}|${req.headers['user-agent'] ?? ''}|${day}`)
      .digest('hex');

    const inserted = await db
      .insert(schema.statsUniques)
      .values({ day, page: input.page, visitorHash })
      .onConflictDoNothing()
      .returning({ day: schema.statsUniques.day });
    const isNew = inserted.length > 0 ? 1 : 0;

    await db
      .insert(schema.statsDaily)
      .values({ day, page: input.page, views: 1, uniqueVisitors: isNew })
      .onConflictDoUpdate({
        target: [schema.statsDaily.day, schema.statsDaily.page],
        set: {
          views: sql`${schema.statsDaily.views} + 1`,
          uniqueVisitors: sql`${schema.statsDaily.uniqueVisitors} + ${isNew}`,
        },
      });
    return { ok: true };
  });

  app.get('/api/stats', async (req): Promise<StatsOverview> => {
    const me = requireAuth(req);
    const now = new Date();
    const today = dayStr(now);
    const since30 = new Date(now.getTime() - 30 * 86_400_000);
    const since14 = dayStr(new Date(now.getTime() - 14 * 86_400_000));
    const onlineSince = new Date(now.getTime() - ONLINE_WINDOW_SECONDS * 1000);
    const startOfToday = new Date(`${today}T00:00:00.000Z`);

    const dayExpr = sql<string>`to_char(${schema.messages.createdAt}, 'YYYY-MM-DD')`;

    const [onlineRows, todayRows, totalRows, accounts, msgToday, msgTotal, perDay, top, daily] = await Promise.all([
      db
        .select({ id: schema.users.id, username: schema.users.username, lastSeen: schema.users.lastSeen })
        .from(schema.users)
        .where(gte(schema.users.lastSeen, onlineSince))
        .orderBy(desc(schema.users.lastSeen))
        .limit(50),
      db
        .select({ v: sql<number>`coalesce(sum(${schema.statsDaily.views}),0)::int`, u: sql<number>`coalesce(sum(${schema.statsDaily.uniqueVisitors}),0)::int` })
        .from(schema.statsDaily)
        .where(eq(schema.statsDaily.day, today)),
      db
        .select({ v: sql<number>`coalesce(sum(${schema.statsDaily.views}),0)::int`, u: sql<number>`coalesce(sum(${schema.statsDaily.uniqueVisitors}),0)::int` })
        .from(schema.statsDaily),
      db.select({ n: sql<number>`count(*)::int` }).from(schema.users),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.messages)
        .where(sql`${schema.messages.createdAt} >= ${startOfToday} AND ${schema.messages.kind} <> 'system'`),
      db.select({ n: sql<number>`count(*)::int` }).from(schema.messages).where(sql`${schema.messages.kind} <> 'system'`),
      db
        .select({ day: dayExpr, count: sql<number>`count(*)::int` })
        .from(schema.messages)
        .where(sql`${schema.messages.createdAt} >= ${since30} AND ${schema.messages.kind} <> 'system'`)
        .groupBy(dayExpr)
        .orderBy(dayExpr),
      db
        .select({ id: schema.users.id, username: schema.users.username, count: sql<number>`count(${schema.messages.id})::int` })
        .from(schema.messages)
        .innerJoin(schema.users, eq(schema.users.id, schema.messages.senderId))
        .where(sql`${schema.messages.kind} <> 'system'`)
        .groupBy(schema.users.id, schema.users.username)
        .orderBy(desc(sql`count(${schema.messages.id})`))
        .limit(10),
      db
        .select({
          day: schema.statsDaily.day,
          views: sql<number>`sum(${schema.statsDaily.views})::int`,
          unique: sql<number>`sum(${schema.statsDaily.uniqueVisitors})::int`,
        })
        .from(schema.statsDaily)
        .where(gte(schema.statsDaily.day, since14))
        .groupBy(schema.statsDaily.day)
        .orderBy(desc(schema.statsDaily.day)),
    ]);

    const onlineIds = new Set<number>(hub.onlineUserIds());
    for (const r of onlineRows) onlineIds.add(r.id);
    const onlineUsers = onlineRows.filter((r) => onlineIds.has(r.id));
    if (onlineIds.size > onlineUsers.length) {
      // Users with an open socket but a stale last_seen (just connected).
      const missing = [...onlineIds].filter((id) => !onlineUsers.some((u) => u.id === id));
      if (missing.length) {
        const extra = await db
          .select({ id: schema.users.id, username: schema.users.username, lastSeen: schema.users.lastSeen })
          .from(schema.users)
          .where(sql`${schema.users.id} IN ${missing}`);
        onlineUsers.push(...extra);
      }
    }

    const perDayMap = new Map(perDay.map((r) => [r.day, r.count]));
    const messagesPerDay: StatsOverview['messagesPerDay'] = [];
    for (let i = 30; i >= 0; i--) {
      const d = dayStr(new Date(now.getTime() - i * 86_400_000));
      messagesPerDay.push({ day: d, count: perDayMap.get(d) ?? 0 });
    }

    let extended: StatsOverview['extended'] = null;
    if (me.role >= ROLES.ADMIN) {
      const lastOnline = await db
        .select({ id: schema.users.id, username: schema.users.username, lastSeen: schema.users.lastSeen, role: schema.users.role })
        .from(schema.users)
        .orderBy(desc(schema.users.lastSeen))
        .limit(50);
      extended = { lastOnline: lastOnline.map((u) => ({ ...u, lastSeen: iso(u.lastSeen) })) };
    }

    return {
      onlineNow: onlineIds.size,
      onlineUsers: onlineUsers.map((u) => ({ id: u.id, username: u.username, lastSeen: iso(u.lastSeen) })),
      viewsToday: todayRows[0]?.v ?? 0,
      uniqueToday: todayRows[0]?.u ?? 0,
      viewsTotal: totalRows[0]?.v ?? 0,
      uniqueTotal: totalRows[0]?.u ?? 0,
      accountsTotal: accounts[0]?.n ?? 0,
      messagesToday: msgToday[0]?.n ?? 0,
      messagesTotal: msgTotal[0]?.n ?? 0,
      messagesPerDay,
      topSenders: top,
      dailyTable: daily.map((d) => ({ day: d.day, views: d.views, unique: d.unique, messages: perDayMap.get(d.day) ?? 0 })),
      extended,
    };
  });
}
