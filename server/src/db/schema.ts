import { sql } from 'drizzle-orm';
import {
  boolean,
  customType,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  serial,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const users = pgTable(
  'users',
  {
    id: serial('id').primaryKey(),
    username: varchar('username', { length: 30 }).notNull(),
    passwordHash: text('password_hash').notNull(),
    role: smallint('role').notNull().default(0),
    color: varchar('color', { length: 16 }),
    emoji: varchar('emoji', { length: 16 }),
    gigascore: integer('gigascore').notNull().default(0),
    pixelsSet: integer('pixels_set').notNull().default(0),
    theme: varchar('theme', { length: 32 }).notNull().default('default'),
    lastSeen: ts('last_seen'),
    lastPixelAt: ts('last_pixel_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('users_username_lower_idx').on(sql`lower(${t.username})`)],
);

export const sessions = pgTable(
  'sessions',
  {
    id: varchar('id', { length: 64 }).primaryKey(), // sha256(token)
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: ts('expires_at').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
    lastUsedAt: ts('last_used_at').notNull().defaultNow(),
    userAgent: varchar('user_agent', { length: 255 }),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export const conversations = pgTable(
  'conversations',
  {
    id: serial('id').primaryKey(),
    kind: varchar('kind', { length: 8 }).notNull(), // 'dm' | 'group'
    name: varchar('name', { length: 60 }),
    dmKey: varchar('dm_key', { length: 32 }), // "<lowId>:<highId>" for dms
    createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: ts('created_at').notNull().defaultNow(),
    lastMessageAt: ts('last_message_at'),
  },
  (t) => [uniqueIndex('conversations_dm_key_idx').on(t.dmKey)],
);

export const conversationMembers = pgTable(
  'conversation_members',
  {
    conversationId: integer('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    joinedAt: ts('joined_at').notNull().defaultNow(),
    lastReadMessageId: integer('last_read_message_id'),
    pinned: boolean('pinned').notNull().default(false),
    archived: boolean('archived').notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.conversationId, t.userId] }), index('conversation_members_user_idx').on(t.userId)],
);

export const contacts = pgTable(
  'contacts',
  {
    ownerId: integer('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    targetId: integer('target_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    alias: varchar('alias', { length: 40 }),
    pinned: boolean('pinned').notNull().default(false),
    archived: boolean('archived').notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.ownerId, t.targetId] })],
);

export const messages = pgTable(
  'messages',
  {
    id: serial('id').primaryKey(),
    conversationId: integer('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    senderId: integer('sender_id').references(() => users.id, { onDelete: 'cascade' }),
    kind: varchar('kind', { length: 8 }).notNull().default('text'),
    body: text('body').notNull().default(''),
    mediaUrl: varchar('media_url', { length: 1000 }),
    mediaName: varchar('media_name', { length: 255 }),
    mediaSize: integer('media_size'),
    mediaWidth: integer('media_width'),
    mediaHeight: integer('media_height'),
    createdAt: ts('created_at').notNull().defaultNow(),
    editedAt: ts('edited_at'),
    deletedAt: ts('deleted_at'),
  },
  (t) => [index('messages_conversation_id_idx').on(t.conversationId, t.id), index('messages_sender_idx').on(t.senderId)],
);

export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    endpoint: varchar('endpoint', { length: 2000 }).notNull(),
    p256dh: varchar('p256dh', { length: 500 }).notNull(),
    auth: varchar('auth', { length: 500 }).notNull(),
    userAgent: varchar('user_agent', { length: 255 }),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('push_subscriptions_endpoint_idx').on(t.endpoint), index('push_subscriptions_user_idx').on(t.userId)],
);

export const notes = pgTable('notes', {
  userId: integer('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  content: text('content').notNull().default(''),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const bugReports = pgTable(
  'bug_reports',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 16 }).notNull().default('bug'),
    title: varchar('title', { length: 120 }).notNull(),
    description: text('description').notNull(),
    priority: varchar('priority', { length: 8 }).notNull().default('medium'),
    status: varchar('status', { length: 16 }).notNull().default('open'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('bug_reports_user_idx').on(t.userId)],
);

export const statsDaily = pgTable(
  'stats_daily',
  {
    day: date('day', { mode: 'string' }).notNull(),
    page: varchar('page', { length: 64 }).notNull(),
    views: integer('views').notNull().default(0),
    uniqueVisitors: integer('unique_visitors').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.day, t.page] })],
);

export const statsUniques = pgTable(
  'stats_uniques',
  {
    day: date('day', { mode: 'string' }).notNull(),
    page: varchar('page', { length: 64 }).notNull(),
    visitorHash: varchar('visitor_hash', { length: 64 }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.day, t.page, t.visitorHash] })],
);

export const placeCanvas = pgTable('place_canvas', {
  id: smallint('id').primaryKey(),
  pixels: bytea('pixels').notNull(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const rateLimits = pgTable('rate_limits', {
  key: varchar('key', { length: 128 }).primaryKey(),
  count: integer('count').notNull().default(0),
  windowStart: ts('window_start').notNull().defaultNow(),
});

export type UserRow = typeof users.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;
export type ConversationRow = typeof conversations.$inferSelect;
