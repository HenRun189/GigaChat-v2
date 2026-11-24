import type { Theme } from './constants';

export interface PublicUser {
  id: number;
  username: string;
  color: string | null;
  emoji: string | null;
  gigascore: number;
  role: number;
  online: boolean;
  lastSeen: string | null;
}

export interface Me extends PublicUser {
  theme: Theme;
  pixelsSet: number;
  createdAt: string;
}

export interface AppConfig {
  version: string;
  vapidPublicKey: string;
  giphyApiKey: string;
  pushEnabled: boolean;
}

export type ConversationKind = 'dm' | 'group';
export type MessageKind = 'text' | 'gif' | 'image' | 'file' | 'system';

export interface Message {
  id: number;
  conversationId: number;
  senderId: number | null;
  kind: MessageKind;
  body: string;
  mediaUrl: string | null;
  mediaName: string | null;
  mediaSize: number | null;
  mediaWidth: number | null;
  mediaHeight: number | null;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
}

export interface MessagePage {
  messages: Message[];
  hasMore: boolean;
}

export interface Contact {
  /** 'user' entries are keyed by userId, 'group' entries by conversationId */
  kind: 'user' | 'group';
  id: number;
  conversationId: number | null;
  name: string;
  username: string | null;
  alias: string | null;
  color: string | null;
  emoji: string | null;
  gigascore: number;
  role: number;
  online: boolean;
  lastSeen: string | null;
  pinned: boolean;
  archived: boolean;
  unread: number;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  memberCount: number | null;
}

export interface ConversationMember {
  userId: number;
  username: string;
  alias: string | null;
  color: string | null;
  emoji: string | null;
  gigascore: number;
  role: number;
  online: boolean;
  lastSeen: string | null;
  joinedAt: string;
  lastReadMessageId: number | null;
}

export interface ConversationDetail {
  id: number;
  kind: ConversationKind;
  name: string;
  createdBy: number | null;
  createdAt: string;
  members: ConversationMember[];
  /** group: total messages; dm: messages in this chat */
  score: number;
  messageCount: number;
  pinned: boolean;
  archived: boolean;
  myLastReadMessageId: number | null;
}

export interface BugReport {
  id: number;
  userId: number;
  username: string;
  type: 'bug' | 'feature' | 'question';
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high';
  status: 'open' | 'in_progress' | 'closed';
  createdAt: string;
}

export interface StatsOverview {
  onlineNow: number;
  onlineUsers: Array<{ id: number; username: string; lastSeen: string | null }>;
  viewsToday: number;
  uniqueToday: number;
  viewsTotal: number;
  uniqueTotal: number;
  accountsTotal: number;
  messagesToday: number;
  messagesTotal: number;
  messagesPerDay: Array<{ day: string; count: number }>;
  topSenders: Array<{ id: number; username: string; count: number }>;
  dailyTable: Array<{ day: string; views: number; unique: number; messages: number }>;
  extended: null | {
    lastOnline: Array<{ id: number; username: string; lastSeen: string | null; role: number }>;
  };
}

export interface AdminUserSummary {
  id: number;
  username: string;
  role: number;
  gigascore: number;
  createdAt: string;
  lastSeen: string | null;
}

export interface AdminUserDetail extends AdminUserSummary {
  color: string | null;
  emoji: string | null;
  counts: {
    messagesSent: number;
    dmReceived: number;
    groups: number;
    pushSubscriptions: number;
    sessions: number;
  };
  recentMessages: Array<{
    id: number;
    conversationId: number;
    conversationName: string;
    kind: ConversationKind;
    body: string;
    messageKind: MessageKind;
    createdAt: string;
    deletedAt: string | null;
  }>;
}

export interface PlaceLeaderboardEntry {
  id: number;
  username: string;
  pixelsSet: number;
}

/* ---------- WebSocket protocol ---------- */

export type ClientEvent =
  | { t: 'focus'; conversationId: number | null; visible: boolean }
  | { t: 'typing'; conversationId: number }
  | { t: 'ping' };

export type ServerEvent =
  | { t: 'hello'; userId: number; serverTime: string }
  | { t: 'pong' }
  | { t: 'message.new'; message: Message; conversationId: number }
  | { t: 'message.updated'; message: Message }
  | { t: 'read'; conversationId: number; userId: number; lastReadMessageId: number }
  | { t: 'typing'; conversationId: number; userId: number }
  | { t: 'presence'; userId: number; online: boolean; lastSeen: string | null }
  | { t: 'score'; scores: Array<{ userId: number; gigascore: number }> }
  | { t: 'contacts.changed' }
  | { t: 'conversation.changed'; conversationId: number }
  | { t: 'user.updated'; user: PublicUser }
  | { t: 'place.pixel'; x: number; y: number; color: string; userId: number }
  | { t: 'session.expired' };
