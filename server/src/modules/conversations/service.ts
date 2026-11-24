import { MESSAGE_PAGE_SIZE, type Message, type MessagePage } from '@gigachat/shared';
import { and, asc, desc, eq, gt, inArray, isNull, lt, sql } from 'drizzle-orm';
import type { Db, Tx } from '../../db';
import { schema } from '../../db';
import type { MessageRow } from '../../db/schema';
import { forbidden, notFound } from '../../lib/errors';
import { messagePreview, toMessage } from '../../lib/serialize';
import type { PushService } from '../../push/push';
import type { Hub } from '../../realtime/hub';

export interface NewMessageInput {
  conversationId: number;
  senderId: number;
  kind: Message['kind'];
  body?: string;
  mediaUrl?: string | null;
  mediaName?: string | null;
  mediaSize?: number | null;
  mediaWidth?: number | null;
  mediaHeight?: number | null;
  senderName: string;
}

export const dmKey = (a: number, b: number) => `${Math.min(a, b)}:${Math.max(a, b)}`;

export class ConversationService {
  constructor(
    private readonly db: Db,
    private readonly hub: Hub,
    private readonly push: PushService,
  ) {}

  async memberIds(conversationId: number, tx: Db | Tx = this.db): Promise<number[]> {
    const rows = await tx
      .select({ userId: schema.conversationMembers.userId })
      .from(schema.conversationMembers)
      .where(eq(schema.conversationMembers.conversationId, conversationId));
    return rows.map((r) => r.userId);
  }

  async assertMember(conversationId: number, userId: number): Promise<void> {
    const rows = await this.db
      .select({ userId: schema.conversationMembers.userId })
      .from(schema.conversationMembers)
      .where(and(eq(schema.conversationMembers.conversationId, conversationId), eq(schema.conversationMembers.userId, userId)))
      .limit(1);
    if (!rows[0]) throw forbidden('Du bist kein Mitglied dieser Unterhaltung');
  }

  async getConversation(conversationId: number) {
    const rows = await this.db.select().from(schema.conversations).where(eq(schema.conversations.id, conversationId)).limit(1);
    if (!rows[0]) throw notFound('Unterhaltung nicht gefunden');
    return rows[0];
  }

  /** Find or create the direct conversation between two users. */
  async getOrCreateDm(a: number, b: number): Promise<number> {
    if (a === b) throw forbidden('Kein Chat mit dir selbst');
    const key = dmKey(a, b);
    const existing = await this.db
      .select({ id: schema.conversations.id })
      .from(schema.conversations)
      .where(eq(schema.conversations.dmKey, key))
      .limit(1);
    if (existing[0]) return existing[0].id;

    const other = await this.db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.id, b)).limit(1);
    if (!other[0]) throw notFound('Benutzer nicht gefunden');

    return this.db.transaction(async (tx) => {
      const inserted = await tx
        .insert(schema.conversations)
        .values({ kind: 'dm', dmKey: key, createdBy: a })
        .onConflictDoNothing({ target: schema.conversations.dmKey })
        .returning({ id: schema.conversations.id });
      let id = inserted[0]?.id;
      if (!id) {
        const again = await tx.select({ id: schema.conversations.id }).from(schema.conversations).where(eq(schema.conversations.dmKey, key)).limit(1);
        id = again[0]!.id;
        return id;
      }
      await tx.insert(schema.conversationMembers).values([
        { conversationId: id, userId: a },
        { conversationId: id, userId: b },
      ]);
      return id;
    });
  }

  async listMessages(
    conversationId: number,
    opts: { before?: number; after?: number; limit?: number },
  ): Promise<MessagePage> {
    const limit = Math.min(100, opts.limit ?? MESSAGE_PAGE_SIZE);
    const base = eq(schema.messages.conversationId, conversationId);

    if (opts.after !== undefined) {
      const rows = await this.db
        .select()
        .from(schema.messages)
        .where(and(base, gt(schema.messages.id, opts.after)))
        .orderBy(asc(schema.messages.id))
        .limit(limit + 1);
      const hasMore = rows.length > limit;
      return { messages: rows.slice(0, limit).map(toMessage), hasMore };
    }

    const where = opts.before ? and(base, lt(schema.messages.id, opts.before)) : base;
    const rows = await this.db
      .select()
      .from(schema.messages)
      .where(where)
      .orderBy(desc(schema.messages.id))
      .limit(limit + 1);
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit).reverse();
    return { messages: page.map(toMessage), hasMore };
  }

  async send(input: NewMessageInput): Promise<Message> {
    const conv = await this.getConversation(input.conversationId);
    const members = await this.memberIds(conv.id);
    if (!members.includes(input.senderId)) throw forbidden('Du bist kein Mitglied dieser Unterhaltung');

    const row = await this.db.transaction(async (tx) => {
      const inserted = await tx
        .insert(schema.messages)
        .values({
          conversationId: conv.id,
          senderId: input.senderId,
          kind: input.kind,
          body: input.body ?? '',
          mediaUrl: input.mediaUrl ?? null,
          mediaName: input.mediaName ?? null,
          mediaSize: input.mediaSize ?? null,
          mediaWidth: input.mediaWidth ?? null,
          mediaHeight: input.mediaHeight ?? null,
        })
        .returning();
      const msg = inserted[0]!;
      await tx
        .update(schema.conversations)
        .set({ lastMessageAt: msg.createdAt })
        .where(eq(schema.conversations.id, conv.id));
      // Sender has obviously read their own message.
      await tx
        .update(schema.conversationMembers)
        .set({ lastReadMessageId: msg.id })
        .where(and(eq(schema.conversationMembers.conversationId, conv.id), eq(schema.conversationMembers.userId, input.senderId)));
      // GigaScore: +1 for every member (dm: sender + receiver; group: all members).
      await tx
        .update(schema.users)
        .set({ gigascore: sql`${schema.users.gigascore} + 1` })
        .where(inArray(schema.users.id, members));
      return msg;
    });

    const message = toMessage(row);
    this.hub.sendToUsers(members, { t: 'message.new', message, conversationId: conv.id });
    void this.broadcastScores(members);

    const preview = messagePreview(row);
    const title = conv.kind === 'group' ? conv.name ?? 'Gruppe' : input.senderName;
    const body = conv.kind === 'group' ? `${input.senderName}: ${preview}` : preview;
    void this.push
      .notifyMembers(members, input.senderId, {
        title,
        body,
        conversationId: conv.id,
        tag: `conv-${conv.id}`,
        url: `/c/${conv.id}`,
      })
      .catch(() => {});

    return message;
  }

  /** System notice inside a conversation (member joined/left …). No score, no push. */
  async system(conversationId: number, actorId: number | null, body: string, tx: Db | Tx = this.db): Promise<Message> {
    const inserted = await tx
      .insert(schema.messages)
      .values({ conversationId, senderId: actorId, kind: 'system', body })
      .returning();
    const msg = inserted[0]!;
    await tx.update(schema.conversations).set({ lastMessageAt: msg.createdAt }).where(eq(schema.conversations.id, conversationId));
    const message = toMessage(msg);
    const members = await this.memberIds(conversationId, tx);
    this.hub.sendToUsers(members, { t: 'message.new', message, conversationId });
    return message;
  }

  async broadcastScores(userIds: number[]): Promise<void> {
    if (userIds.length === 0) return;
    const rows = await this.db
      .select({ userId: schema.users.id, gigascore: schema.users.gigascore })
      .from(schema.users)
      .where(inArray(schema.users.id, userIds));
    this.hub.broadcast({ t: 'score', scores: rows });
  }

  async getMessage(messageId: number): Promise<MessageRow> {
    const rows = await this.db.select().from(schema.messages).where(eq(schema.messages.id, messageId)).limit(1);
    if (!rows[0]) throw notFound('Nachricht nicht gefunden');
    return rows[0];
  }

  async edit(messageId: number, userId: number, body: string): Promise<Message> {
    const existing = await this.getMessage(messageId);
    if (existing.senderId !== userId) throw forbidden('Nur eigene Nachrichten können bearbeitet werden');
    if (existing.deletedAt) throw forbidden('Gelöschte Nachrichten können nicht bearbeitet werden');
    if (existing.kind !== 'text') throw forbidden('Nur Textnachrichten können bearbeitet werden');
    const updated = await this.db
      .update(schema.messages)
      .set({ body, editedAt: new Date() })
      .where(eq(schema.messages.id, messageId))
      .returning();
    const message = toMessage(updated[0]!);
    const members = await this.memberIds(existing.conversationId);
    this.hub.sendToUsers(members, { t: 'message.updated', message });
    return message;
  }

  async remove(messageId: number, userId: number, isAdmin: boolean): Promise<Message> {
    const existing = await this.getMessage(messageId);
    if (existing.senderId !== userId && !isAdmin) throw forbidden('Nur eigene Nachrichten können gelöscht werden');
    if (existing.deletedAt) return toMessage(existing);
    const updated = await this.db
      .update(schema.messages)
      .set({ deletedAt: new Date() })
      .where(eq(schema.messages.id, messageId))
      .returning();
    const message = toMessage(updated[0]!);
    const members = await this.memberIds(existing.conversationId);
    this.hub.sendToUsers(members, { t: 'message.updated', message });
    return message;
  }

  async markRead(conversationId: number, userId: number, lastReadMessageId: number): Promise<number> {
    await this.assertMember(conversationId, userId);
    const rows = await this.db
      .update(schema.conversationMembers)
      .set({ lastReadMessageId: sql`GREATEST(COALESCE(${schema.conversationMembers.lastReadMessageId}, 0), ${lastReadMessageId})` })
      .where(and(eq(schema.conversationMembers.conversationId, conversationId), eq(schema.conversationMembers.userId, userId)))
      .returning({ lastReadMessageId: schema.conversationMembers.lastReadMessageId });
    const effective = rows[0]?.lastReadMessageId ?? lastReadMessageId;
    const members = await this.memberIds(conversationId);
    this.hub.sendToUsers(
      members.filter((id) => id !== userId),
      { t: 'read', conversationId, userId, lastReadMessageId: effective },
    );
    return effective;
  }

  async unreadCount(conversationId: number, userId: number): Promise<number> {
    const rows = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.messages)
      .innerJoin(
        schema.conversationMembers,
        and(
          eq(schema.conversationMembers.conversationId, schema.messages.conversationId),
          eq(schema.conversationMembers.userId, userId),
        ),
      )
      .where(
        and(
          eq(schema.messages.conversationId, conversationId),
          isNull(schema.messages.deletedAt),
          sql`${schema.messages.id} > COALESCE(${schema.conversationMembers.lastReadMessageId}, 0)`,
          sql`${schema.messages.senderId} IS DISTINCT FROM ${userId}`,
        ),
      );
    return rows[0]?.n ?? 0;
  }
}
