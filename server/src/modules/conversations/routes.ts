import {
  ALLOWED_UPLOAD_EXTENSIONS,
  IMAGE_EXTENSIONS,
  ROLES,
  UPLOAD_MAX_BYTES,
  editMessageSchema,
  markReadSchema,
  messagesQuerySchema,
  sendMessageSchema,
  type ConversationDetail,
} from '@gigachat/shared';
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import sharp from 'sharp';
import { z } from 'zod';
import type { AppContext } from '../../context';
import { schema } from '../../db';
import { badRequest } from '../../lib/errors';
import { isRecentlySeen, iso } from '../../lib/serialize';
import { parse, toInt } from '../../lib/validate';
import { requireAuth } from '../../plugins/auth';

const membershipSchema = z.object({ pinned: z.boolean().optional(), archived: z.boolean().optional() }).strict();

export async function conversationDetail(ctx: AppContext, conversationId: number, meId: number): Promise<ConversationDetail> {
  const { db, hub } = ctx;
  const conv = await ctx.conversations.getConversation(conversationId);
  const rows = await db
    .select({ member: schema.conversationMembers, user: schema.users, alias: schema.contacts.alias })
    .from(schema.conversationMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.conversationMembers.userId))
    .leftJoin(schema.contacts, and(eq(schema.contacts.ownerId, meId), eq(schema.contacts.targetId, schema.users.id)))
    .where(eq(schema.conversationMembers.conversationId, conversationId));

  const mine = rows.find((r) => r.user.id === meId);
  const countRows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.messages)
    .where(and(eq(schema.messages.conversationId, conversationId), sql`${schema.messages.kind} <> 'system'`));
  const messageCount = countRows[0]?.n ?? 0;
  const now = Date.now();

  const members = rows
    .map((r) => ({
      userId: r.user.id,
      username: r.user.username,
      alias: r.alias ?? null,
      color: r.user.color ?? null,
      emoji: r.user.emoji ?? null,
      gigascore: r.user.gigascore,
      role: r.user.role,
      online: hub.isOnline(r.user.id) || isRecentlySeen(r.user.lastSeen, now),
      lastSeen: iso(r.user.lastSeen),
      joinedAt: r.member.joinedAt.toISOString(),
      lastReadMessageId: r.member.lastReadMessageId ?? null,
    }))
    .sort((a, b) => a.username.localeCompare(b.username, 'de'));

  let name = conv.name ?? 'Gruppe';
  if (conv.kind === 'dm') {
    const other = members.find((m) => m.userId !== meId);
    name = other ? other.alias?.trim() || other.username : 'Chat';
  }

  return {
    id: conv.id,
    kind: conv.kind as ConversationDetail['kind'],
    name,
    createdBy: conv.createdBy ?? null,
    createdAt: conv.createdAt.toISOString(),
    members,
    score: messageCount,
    messageCount,
    pinned: mine?.member.pinned ?? false,
    archived: mine?.member.archived ?? false,
    myLastReadMessageId: mine?.member.lastReadMessageId ?? null,
  };
}

export function conversationRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db, conversations } = ctx;

  app.get('/api/conversations/with/:userId', async (req) => {
    const me = requireAuth(req);
    const otherId = toInt((req.params as { userId: string }).userId, 'userId');
    const id = await conversations.getOrCreateDm(me.id, otherId);
    return { conversation: await conversationDetail(ctx, id, me.id) };
  });

  app.get('/api/conversations/:id', async (req) => {
    const me = requireAuth(req);
    const id = toInt((req.params as { id: string }).id);
    await conversations.assertMember(id, me.id);
    return { conversation: await conversationDetail(ctx, id, me.id) };
  });

  app.get('/api/conversations/:id/messages', async (req) => {
    const me = requireAuth(req);
    const id = toInt((req.params as { id: string }).id);
    await conversations.assertMember(id, me.id);
    const q = parse(messagesQuerySchema, req.query);
    return conversations.listMessages(id, q);
  });

  app.post('/api/conversations/:id/messages', async (req, reply) => {
    const me = requireAuth(req);
    ctx.limits.send.check(`send:${me.id}`);
    const id = toInt((req.params as { id: string }).id);
    const input = parse(sendMessageSchema, req.body);
    const message =
      input.kind === 'text'
        ? await conversations.send({ conversationId: id, senderId: me.id, kind: 'text', body: input.body, senderName: me.username })
        : await conversations.send({ conversationId: id, senderId: me.id, kind: 'gif', mediaUrl: input.gifUrl, senderName: me.username });
    return reply.code(201).send({ message, clientId: input.clientId ?? null });
  });

  app.post('/api/conversations/:id/read', async (req) => {
    const me = requireAuth(req);
    const id = toInt((req.params as { id: string }).id);
    const input = parse(markReadSchema, req.body);
    const lastReadMessageId = await conversations.markRead(id, me.id, input.lastReadMessageId);
    return { lastReadMessageId };
  });

  app.patch('/api/conversations/:id/membership', async (req) => {
    const me = requireAuth(req);
    const id = toInt((req.params as { id: string }).id);
    await conversations.assertMember(id, me.id);
    const input = parse(membershipSchema, req.body);
    const set: Record<string, boolean> = {};
    if (input.pinned !== undefined) set.pinned = input.pinned;
    if (input.archived !== undefined) set.archived = input.archived;
    if (Object.keys(set).length) {
      await db
        .update(schema.conversationMembers)
        .set(set)
        .where(and(eq(schema.conversationMembers.conversationId, id), eq(schema.conversationMembers.userId, me.id)));
    }
    return { ok: true };
  });

  app.patch('/api/messages/:id', async (req) => {
    const me = requireAuth(req);
    const id = toInt((req.params as { id: string }).id);
    const input = parse(editMessageSchema, req.body);
    return { message: await conversations.edit(id, me.id, input.body) };
  });

  app.delete('/api/messages/:id', async (req) => {
    const me = requireAuth(req);
    const id = toInt((req.params as { id: string }).id);
    return { message: await conversations.remove(id, me.id, me.role >= ROLES.ADMIN) };
  });

  app.post('/api/conversations/:id/upload', async (req, reply) => {
    const me = requireAuth(req);
    ctx.limits.upload.check(`upload:${me.id}`);
    const id = toInt((req.params as { id: string }).id);
    await conversations.assertMember(id, me.id);

    const part = await req.file();
    if (!part) throw badRequest('no_file', 'Keine Datei empfangen');
    const originalName = (part.filename || 'datei').slice(0, 200);
    const ext = extname(originalName).slice(1).toLowerCase();
    if (!(ALLOWED_UPLOAD_EXTENSIONS as readonly string[]).includes(ext)) {
      throw badRequest('type_not_allowed', 'Dateityp nicht erlaubt');
    }

    let buffer: Buffer;
    try {
      buffer = await part.toBuffer();
    } catch {
      throw badRequest('too_large', `Datei zu groß (max. ${UPLOAD_MAX_BYTES / 1024 / 1024} MB)`);
    }
    if (buffer.length === 0) throw badRequest('empty_file', 'Leere Datei');

    const now = new Date();
    const relDir = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const absDir = join(ctx.uploadsDir, relDir);
    await mkdir(absDir, { recursive: true });
    const base = randomBytes(12).toString('base64url');

    const isImage = (IMAGE_EXTENSIONS as readonly string[]).includes(ext);
    if (isImage) {
      let outExt = ext;
      let out: Buffer = buffer;
      let width: number | null = null;
      let height: number | null = null;
      try {
        if (ext === 'gif') {
          const meta = await sharp(buffer, { animated: true }).metadata();
          width = meta.width ?? null;
          height = meta.pageHeight ?? meta.height ?? null;
        } else {
          let pipeline = sharp(buffer).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true });
          if (ext === 'png') pipeline = pipeline.png({ compressionLevel: 8, palette: false });
          else if (ext === 'webp') pipeline = pipeline.webp({ quality: 82 });
          else {
            pipeline = pipeline.jpeg({ quality: 82, mozjpeg: true });
            outExt = 'jpg';
          }
          const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
          out = data;
          width = info.width;
          height = info.height;
        }
      } catch {
        throw badRequest('bad_image', 'Bild konnte nicht verarbeitet werden');
      }
      const file = `${base}.${outExt}`;
      await writeFile(join(absDir, file), out);
      const message = await conversations.send({
        conversationId: id,
        senderId: me.id,
        kind: 'image',
        mediaUrl: `/uploads/${relDir}/${file}`,
        mediaName: originalName,
        mediaSize: out.length,
        mediaWidth: width,
        mediaHeight: height,
        senderName: me.username,
      });
      return reply.code(201).send({ message });
    }

    const file = `${base}.${ext}`;
    await writeFile(join(absDir, file), buffer);
    const message = await conversations.send({
      conversationId: id,
      senderId: me.id,
      kind: 'file',
      mediaUrl: `/uploads/${relDir}/${file}`,
      mediaName: originalName,
      mediaSize: buffer.length,
      senderName: me.username,
    });
    return reply.code(201).send({ message });
  });
}
