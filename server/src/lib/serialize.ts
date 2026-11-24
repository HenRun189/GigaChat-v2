import { ONLINE_WINDOW_SECONDS, THEMES, type Me, type Message, type PublicUser, type Theme } from '@gigachat/shared';
import type { MessageRow, UserRow } from '../db/schema';

export const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

export function isRecentlySeen(lastSeen: Date | null | undefined, now = Date.now()): boolean {
  return !!lastSeen && now - lastSeen.getTime() < ONLINE_WINDOW_SECONDS * 1000;
}

export function toPublicUser(u: UserRow, online: boolean): PublicUser {
  return {
    id: u.id,
    username: u.username,
    color: u.color ?? null,
    emoji: u.emoji ?? null,
    gigascore: u.gigascore,
    role: u.role,
    online,
    lastSeen: iso(u.lastSeen),
  };
}

export function toMe(u: UserRow, online: boolean): Me {
  const theme = (THEMES as readonly string[]).includes(u.theme) ? (u.theme as Theme) : 'default';
  return {
    ...toPublicUser(u, online),
    theme,
    pixelsSet: u.pixelsSet,
    createdAt: u.createdAt.toISOString(),
  };
}

export function toMessage(m: MessageRow): Message {
  const deleted = !!m.deletedAt;
  return {
    id: m.id,
    conversationId: m.conversationId,
    senderId: m.senderId ?? null,
    kind: deleted ? 'text' : (m.kind as Message['kind']),
    body: deleted ? '' : m.body,
    mediaUrl: deleted ? null : m.mediaUrl,
    mediaName: deleted ? null : m.mediaName,
    mediaSize: deleted ? null : m.mediaSize,
    mediaWidth: deleted ? null : m.mediaWidth,
    mediaHeight: deleted ? null : m.mediaHeight,
    createdAt: m.createdAt.toISOString(),
    editedAt: iso(m.editedAt),
    deletedAt: iso(m.deletedAt),
  };
}

export function messagePreview(m: Pick<MessageRow, 'kind' | 'body' | 'deletedAt' | 'mediaName'>): string {
  if (m.deletedAt) return 'Nachricht gelöscht';
  switch (m.kind) {
    case 'gif':
      return 'GIF';
    case 'image':
      return '📷 Bild';
    case 'file':
      return `📎 ${m.mediaName ?? 'Datei'}`;
    default:
      return m.body.length > 80 ? `${m.body.slice(0, 80)}…` : m.body;
  }
}
