/**
 * One-off migration from the legacy GigaChat MySQL schema to the new
 * PostgreSQL / PGlite schema.
 *
 * Usage:
 *   LEGACY_MYSQL_HOST=... LEGACY_MYSQL_USER=... LEGACY_MYSQL_PASSWORD=... LEGACY_MYSQL_DATABASE=chat \
 *   DATABASE_URL=postgres://... (or empty for PGlite in DATA_DIR) \
 *   pnpm migrate:mysql
 *
 * The script is idempotent-ish: it refuses to run when the target already
 * contains users, so run it against a fresh database.
 */
import { sql } from 'drizzle-orm';
import mysql from 'mysql2/promise';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { createDb, schema } from '../src/db';
import { readEnv } from '../src/env';
import { dmKey } from '../src/modules/conversations/service';

type Row = Record<string, any>;

const env = readEnv();
const legacyUploads = resolve(process.cwd(), process.env.LEGACY_UPLOADS_DIR || './legacy/uploads');

async function main() {
  const my = await mysql.createConnection({
    host: process.env.LEGACY_MYSQL_HOST || 'localhost',
    user: process.env.LEGACY_MYSQL_USER || 'webapp_user',
    password: process.env.LEGACY_MYSQL_PASSWORD || '',
    database: process.env.LEGACY_MYSQL_DATABASE || 'chat',
    charset: 'utf8mb4',
    timezone: 'Z',
  });
  await my.query("SET time_zone = '+00:00'");

  const { db, close } = await createDb({ url: env.databaseUrl, dataDir: env.dataDir });
  const existing = await db.select({ n: sql<number>`count(*)::int` }).from(schema.users);
  if ((existing[0]?.n ?? 0) > 0) {
    throw new Error('Target database already has users – aborting. Use a fresh database.');
  }

  const q = async (s: string): Promise<Row[]> => (await my.query(s))[0] as Row[];
  const has = async (table: string): Promise<boolean> => (await q(`SHOW TABLES LIKE '${table}'`)).length > 0;

  /* ---------- users ---------- */
  const users = await q('SELECT * FROM users ORDER BY id');
  console.log(`users: ${users.length}`);
  for (const u of users) {
    await db.insert(schema.users).values({
      id: u.id,
      username: String(u.username).slice(0, 30),
      passwordHash: String(u.password ?? u.password_hash ?? ''),
      role: Number(u.role ?? 0),
      color: u.color && /^#[0-9a-fA-F]{6}$/.test(u.color) ? u.color : null,
      emoji: u.emoji ? String(u.emoji).slice(0, 16) : null,
      gigascore: Number(u.gigascore ?? 0),
      pixelsSet: Number(u.pixels_set ?? 0),
      theme: ['default', 'purple', 'ocean', 'forest', 'sunset', 'cyber', 'midnight_cherry', 'aurora_borealis'].includes(u.active_theme)
        ? u.active_theme
        : 'default',
      lastSeen: u.last_seen ? new Date(u.last_seen) : null,
      createdAt: u.created_at ? new Date(u.created_at) : new Date(),
    });
  }
  const userIds = new Set(users.map((u) => Number(u.id)));

  /* ---------- aliases / pins / archive ---------- */
  if (await has('user_aliases')) {
    const aliases = await q('SELECT * FROM user_aliases');
    console.log(`contacts: ${aliases.length}`);
    for (const a of aliases) {
      if (!userIds.has(Number(a.owner_id)) || !userIds.has(Number(a.target_id))) continue;
      await db
        .insert(schema.contacts)
        .values({
          ownerId: Number(a.owner_id),
          targetId: Number(a.target_id),
          alias: a.alias ? String(a.alias).slice(0, 40) : null,
          pinned: !!Number(a.pinned ?? 0),
          archived: !!Number(a.archived ?? 0),
        })
        .onConflictDoNothing();
    }
  }

  /* ---------- conversations ---------- */
  const dmMessages = await q('SELECT * FROM messages ORDER BY id');
  const dmFiles = (await has('message_files')) ? await q('SELECT * FROM message_files ORDER BY id') : [];
  const dmFileByMsg = new Map<number, Row>();
  for (const f of dmFiles) if (!dmFileByMsg.has(Number(f.message_id))) dmFileByMsg.set(Number(f.message_id), f);

  const groups = (await has('chat_groups')) ? await q('SELECT * FROM chat_groups ORDER BY id') : [];
  const groupMembers = (await has('group_members')) ? await q('SELECT * FROM group_members') : [];
  const groupMessages = (await has('group_messages')) ? await q('SELECT * FROM group_messages ORDER BY id') : [];
  const groupFiles = (await has('group_message_files')) ? await q('SELECT * FROM group_message_files ORDER BY id') : [];
  const groupReads = (await has('group_reads')) ? await q('SELECT * FROM group_reads') : [];
  const groupFileByMsg = new Map<number, Row>();
  for (const f of groupFiles) if (!groupFileByMsg.has(Number(f.message_id))) groupFileByMsg.set(Number(f.message_id), f);

  console.log(`dm messages: ${dmMessages.length}, groups: ${groups.length}, group messages: ${groupMessages.length}`);

  // dm conversations
  const dmConvByKey = new Map<string, number>();
  const dmPairs = new Set<string>();
  for (const m of dmMessages) {
    const a = Number(m.sender_id);
    const b = Number(m.receiver_id);
    if (!userIds.has(a) || !userIds.has(b) || a === b) continue;
    dmPairs.add(dmKey(a, b));
  }
  for (const key of dmPairs) {
    const [a, b] = key.split(':').map(Number);
    const ins = await db.insert(schema.conversations).values({ kind: 'dm', dmKey: key, createdBy: a }).returning({ id: schema.conversations.id });
    const id = ins[0]!.id;
    dmConvByKey.set(key, id);
    await db.insert(schema.conversationMembers).values([
      { conversationId: id, userId: a },
      { conversationId: id, userId: b },
    ]);
  }

  // group conversations
  const groupConvByOld = new Map<number, number>();
  for (const g of groups) {
    const createdBy = userIds.has(Number(g.created_by)) ? Number(g.created_by) : null;
    const name = String(g.name ?? 'Gruppe').replace(/^👥\s*/, '').slice(0, 60) || 'Gruppe';
    const ins = await db
      .insert(schema.conversations)
      .values({ kind: 'group', name, createdBy, createdAt: g.created_at ? new Date(g.created_at) : new Date() })
      .returning({ id: schema.conversations.id });
    groupConvByOld.set(Number(g.id), ins[0]!.id);
  }
  for (const gm of groupMembers) {
    const convId = groupConvByOld.get(Number(gm.group_id));
    if (!convId || !userIds.has(Number(gm.user_id))) continue;
    await db
      .insert(schema.conversationMembers)
      .values({ conversationId: convId, userId: Number(gm.user_id), joinedAt: gm.joined_at ? new Date(gm.joined_at) : new Date() })
      .onConflictDoNothing();
  }

  /* ---------- messages (merged chronologically) ---------- */
  mkdirSync(join(env.dataDir, 'uploads', 'legacy'), { recursive: true });
  const copyUpload = (path: string | null | undefined): string | null => {
    if (!path) return null;
    const name = basename(String(path));
    const src = join(legacyUploads, name);
    const dst = join(env.dataDir, 'uploads', 'legacy', name);
    if (existsSync(src) && !existsSync(dst)) copyFileSync(src, dst);
    return `/uploads/legacy/${name}`;
  };

  interface Unified {
    created: Date;
    oldId: number;
    scope: 'dm' | 'group';
    conversationId: number;
    senderId: number;
    receiverId?: number;
    kind: 'text' | 'gif' | 'image' | 'file';
    body: string;
    mediaUrl: string | null;
    mediaName: string | null;
    edited: boolean;
    deleted: boolean;
    readAt: Date | null;
  }
  const unified: Unified[] = [];

  const classify = (m: Row, file: Row | undefined) => {
    const text = String(m.message ?? '');
    const deleted = !!Number(m.deleted ?? 0) || text === '[gelöscht]';
    if (m.gif_url) return { kind: 'gif' as const, body: '', mediaUrl: String(m.gif_url), mediaName: null, deleted };
    if (file) {
      const isImage = !!Number(file.is_image ?? 0);
      return { kind: isImage ? ('image' as const) : ('file' as const), body: '', mediaUrl: copyUpload(file.path), mediaName: file.original_name ? String(file.original_name).slice(0, 255) : null, deleted };
    }
    return { kind: 'text' as const, body: deleted ? '' : text, mediaUrl: null, mediaName: null, deleted };
  };

  for (const m of dmMessages) {
    const a = Number(m.sender_id);
    const b = Number(m.receiver_id);
    const convId = dmConvByKey.get(dmKey(a, b));
    if (!convId) continue;
    const c = classify(m, dmFileByMsg.get(Number(m.id)));
    unified.push({
      created: new Date(m.created_at ?? Date.now()),
      oldId: Number(m.id),
      scope: 'dm',
      conversationId: convId,
      senderId: a,
      receiverId: b,
      ...c,
      edited: !!Number(m.edited ?? 0),
      readAt: m.read_at ? new Date(m.read_at) : null,
    });
  }
  for (const m of groupMessages) {
    const convId = groupConvByOld.get(Number(m.group_id));
    const sender = Number(m.sender_id);
    if (!convId || !userIds.has(sender)) continue;
    const c = classify(m, groupFileByMsg.get(Number(m.id)));
    unified.push({
      created: new Date(m.created_at ?? Date.now()),
      oldId: Number(m.id),
      scope: 'group',
      conversationId: convId,
      senderId: sender,
      ...c,
      edited: !!Number(m.edited ?? 0),
      readAt: null,
    });
  }
  unified.sort((x, y) => x.created.getTime() - y.created.getTime() || x.oldId - y.oldId);

  const newIdByGroupOld = new Map<number, number>();
  const lastReadByMember = new Map<string, number>(); // `${conv}:${user}` -> message id
  const lastMessageAt = new Map<number, Date>();
  let n = 0;
  for (const u of unified) {
    const ins = await db
      .insert(schema.messages)
      .values({
        conversationId: u.conversationId,
        senderId: u.senderId,
        kind: u.kind,
        body: u.body,
        mediaUrl: u.mediaUrl,
        mediaName: u.mediaName,
        createdAt: u.created,
        editedAt: u.edited ? u.created : null,
        deletedAt: u.deleted ? u.created : null,
      })
      .returning({ id: schema.messages.id });
    const newId = ins[0]!.id;
    if (u.scope === 'group') newIdByGroupOld.set(u.oldId, newId);
    lastMessageAt.set(u.conversationId, u.created);
    // sender has read own message
    lastReadByMember.set(`${u.conversationId}:${u.senderId}`, newId);
    if (u.scope === 'dm' && u.readAt && u.receiverId) {
      lastReadByMember.set(`${u.conversationId}:${u.receiverId}`, newId);
    }
    if (++n % 500 === 0) console.log(`  messages: ${n}/${unified.length}`);
  }
  console.log(`messages migrated: ${n}`);

  for (const gr of groupReads) {
    const convId = groupConvByOld.get(Number(gr.group_id));
    const newId = newIdByGroupOld.get(Number(gr.last_read_msg_id));
    if (!convId || !newId) continue;
    const key = `${convId}:${gr.user_id}`;
    lastReadByMember.set(key, Math.max(lastReadByMember.get(key) ?? 0, newId));
  }
  for (const [key, id] of lastReadByMember) {
    const [convId, userId] = key.split(':').map(Number);
    await db
      .update(schema.conversationMembers)
      .set({ lastReadMessageId: id })
      .where(sql`${schema.conversationMembers.conversationId} = ${convId} AND ${schema.conversationMembers.userId} = ${userId}`);
  }
  for (const [convId, at] of lastMessageAt) {
    await db.update(schema.conversations).set({ lastMessageAt: at }).where(sql`${schema.conversations.id} = ${convId}`);
  }

  /* ---------- notes, bug reports, push subscriptions ---------- */
  if (await has('user_notes')) {
    for (const r of await q('SELECT * FROM user_notes')) {
      if (!userIds.has(Number(r.user_id))) continue;
      await db.insert(schema.notes).values({ userId: Number(r.user_id), content: String(r.content ?? '') }).onConflictDoNothing();
    }
  }
  if (await has('bug_reports')) {
    for (const r of await q('SELECT * FROM bug_reports ORDER BY id')) {
      if (!userIds.has(Number(r.user_id))) continue;
      await db.insert(schema.bugReports).values({
        userId: Number(r.user_id),
        type: ['bug', 'feature', 'question'].includes(r.type) ? r.type : 'bug',
        title: String(r.title ?? '').slice(0, 120) || 'Ohne Titel',
        description: String(r.description ?? ''),
        priority: ['low', 'medium', 'high'].includes(r.priority) ? r.priority : 'medium',
        status: ['open', 'in_progress', 'closed'].includes(r.status) ? r.status : 'open',
        createdAt: r.created_at ? new Date(r.created_at) : new Date(),
      });
    }
  }
  if (await has('push_subscriptions')) {
    for (const r of await q('SELECT * FROM push_subscriptions')) {
      if (!userIds.has(Number(r.user_id)) || !r.endpoint || !r.p256dh || !r.auth) continue;
      await db
        .insert(schema.pushSubscriptions)
        .values({ userId: Number(r.user_id), endpoint: String(r.endpoint), p256dh: String(r.p256dh), auth: String(r.auth) })
        .onConflictDoNothing();
    }
  }

  /* ---------- r/place canvas ---------- */
  const canvasFile = resolve(process.cwd(), 'legacy', 'place', 'canvas.json');
  if (existsSync(canvasFile)) {
    try {
      const data = JSON.parse(readFileSync(canvasFile, 'utf8')) as { pixels?: string[] };
      if (Array.isArray(data.pixels) && data.pixels.length === 40000) {
        const buf = Buffer.alloc(40000 * 3, 0xff);
        data.pixels.forEach((hex, i) => {
          if (typeof hex === 'string' && /^#[0-9a-fA-F]{6}$/.test(hex)) {
            buf[i * 3] = Number.parseInt(hex.slice(1, 3), 16);
            buf[i * 3 + 1] = Number.parseInt(hex.slice(3, 5), 16);
            buf[i * 3 + 2] = Number.parseInt(hex.slice(5, 7), 16);
          }
        });
        await db
          .insert(schema.placeCanvas)
          .values({ id: 1, pixels: buf })
          .onConflictDoUpdate({ target: schema.placeCanvas.id, set: { pixels: buf, updatedAt: new Date() } });
        console.log('place canvas migrated');
      }
    } catch (err) {
      console.warn('canvas.json could not be migrated', err);
    }
  }

  /* ---------- sequences ---------- */
  await db.execute(sql`SELECT setval('users_id_seq', (SELECT COALESCE(MAX(id), 1) FROM users))`);
  await db.execute(sql`SELECT setval('conversations_id_seq', (SELECT COALESCE(MAX(id), 1) FROM conversations))`);
  await db.execute(sql`SELECT setval('messages_id_seq', (SELECT COALESCE(MAX(id), 1) FROM messages))`);
  await db.execute(sql`SELECT setval('bug_reports_id_seq', (SELECT COALESCE(MAX(id), 1) FROM bug_reports))`);

  await my.end();
  await close();
  console.log('done ✔');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
