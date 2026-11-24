import type { ServerEvent } from '@gigachat/shared';
import type { WebSocket } from 'ws';

export interface Client {
  id: number;
  userId: number;
  ws: WebSocket;
  activeConversationId: number | null;
  visible: boolean;
  alive: boolean;
}

type PresenceListener = (userId: number, online: boolean) => void;

/**
 * In-memory registry of connected sockets. One user may have several
 * sockets (phone + desktop). All fan-out goes through here.
 */
export class Hub {
  private clients = new Map<number, Set<Client>>();
  private seq = 0;
  private presenceListeners: PresenceListener[] = [];

  add(userId: number, ws: WebSocket): Client {
    const client: Client = { id: ++this.seq, userId, ws, activeConversationId: null, visible: true, alive: true };
    let set = this.clients.get(userId);
    const wasOnline = !!set && set.size > 0;
    if (!set) {
      set = new Set();
      this.clients.set(userId, set);
    }
    set.add(client);
    if (!wasOnline) this.emitPresence(userId, true);
    return client;
  }

  remove(client: Client): void {
    const set = this.clients.get(client.userId);
    if (!set) return;
    set.delete(client);
    if (set.size === 0) {
      this.clients.delete(client.userId);
      this.emitPresence(client.userId, false);
    }
  }

  onPresence(listener: PresenceListener): void {
    this.presenceListeners.push(listener);
  }

  private emitPresence(userId: number, online: boolean): void {
    for (const l of this.presenceListeners) {
      try {
        l(userId, online);
      } catch {
        /* ignore listener errors */
      }
    }
  }

  isOnline(userId: number): boolean {
    return (this.clients.get(userId)?.size ?? 0) > 0;
  }

  onlineUserIds(): number[] {
    return [...this.clients.keys()];
  }

  /** True if the user is looking at this conversation right now on any device. */
  hasVisibleOn(userId: number, conversationId: number): boolean {
    const set = this.clients.get(userId);
    if (!set) return false;
    for (const c of set) if (c.visible && c.activeConversationId === conversationId) return true;
    return false;
  }

  sendToUser(userId: number, event: ServerEvent): void {
    const set = this.clients.get(userId);
    if (!set) return;
    const payload = JSON.stringify(event);
    for (const c of set) this.raw(c, payload);
  }

  sendToUsers(userIds: Iterable<number>, event: ServerEvent): void {
    const payload = JSON.stringify(event);
    const seen = new Set<number>();
    for (const id of userIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      const set = this.clients.get(id);
      if (!set) continue;
      for (const c of set) this.raw(c, payload);
    }
  }

  broadcast(event: ServerEvent, except?: number): void {
    const payload = JSON.stringify(event);
    for (const [uid, set] of this.clients) {
      if (uid === except) continue;
      for (const c of set) this.raw(c, payload);
    }
  }

  closeUser(userId: number, code = 4001, reason = 'session ended'): void {
    const set = this.clients.get(userId);
    if (!set) return;
    for (const c of [...set]) {
      try {
        c.ws.close(code, reason);
      } catch {
        /* ignore */
      }
    }
  }

  private raw(c: Client, payload: string): void {
    if (c.ws.readyState !== c.ws.OPEN) return;
    try {
      c.ws.send(payload);
    } catch {
      /* socket is going away; the close handler cleans up */
    }
  }

  get connectionCount(): number {
    let n = 0;
    for (const s of this.clients.values()) n += s.size;
    return n;
  }
}
