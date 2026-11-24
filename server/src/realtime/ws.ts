import type { ClientEvent } from '@gigachat/shared';
import { eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import type { AppContext } from '../context';
import { schema } from '../db';
import type { Client } from './hub';

const HEARTBEAT_MS = 30_000;

export function registerWebsocket(app: FastifyInstance, ctx: AppContext): void {
  const { hub, db } = ctx;

  // Presence broadcast + persist last_seen when a user goes offline.
  hub.onPresence((userId, online) => {
    const lastSeen = new Date();
    void db.update(schema.users).set({ lastSeen }).where(eq(schema.users.id, userId)).catch(() => {});
    hub.broadcast({ t: 'presence', userId, online, lastSeen: lastSeen.toISOString() });
  });

  // Heartbeat: terminate dead sockets, refresh last_seen for live ones.
  const timer = setInterval(() => {
    const live: number[] = [];
    for (const userId of hub.onlineUserIds()) live.push(userId);
    if (live.length) {
      void db.update(schema.users).set({ lastSeen: new Date() }).where(inArray(schema.users.id, live)).catch(() => {});
    }
    for (const c of allClients.values()) {
      if (!c.alive) {
        c.ws.terminate();
        continue;
      }
      c.alive = false;
      try {
        c.ws.ping();
      } catch {
        /* ignore */
      }
    }
  }, HEARTBEAT_MS);
  timer.unref();
  app.addHook('onClose', async () => clearInterval(timer));

  const allClients = new Map<number, Client>();

  app.get('/ws', { websocket: true }, (socket: WebSocket, req) => {
    const user = req.user;
    if (!user) {
      socket.close(4401, 'unauthorized');
      return;
    }

    const client = hub.add(user.id, socket);
    allClients.set(client.id, client);
    socket.send(JSON.stringify({ t: 'hello', userId: user.id, serverTime: new Date().toISOString() }));

    socket.on('pong', () => {
      client.alive = true;
    });

    socket.on('message', (raw) => {
      let msg: ClientEvent | null = null;
      try {
        msg = JSON.parse(raw.toString()) as ClientEvent;
      } catch {
        return;
      }
      if (!msg || typeof msg !== 'object') return;
      client.alive = true;
      switch (msg.t) {
        case 'focus':
          client.activeConversationId = typeof msg.conversationId === 'number' ? msg.conversationId : null;
          client.visible = !!msg.visible;
          break;
        case 'typing':
          if (typeof msg.conversationId === 'number') {
            void ctx.conversations
              .memberIds(msg.conversationId)
              .then((ids) => {
                if (!ids.includes(user.id)) return;
                hub.sendToUsers(
                  ids.filter((id) => id !== user.id),
                  { t: 'typing', conversationId: msg.conversationId, userId: user.id },
                );
              })
              .catch(() => {});
          }
          break;
        case 'ping':
          socket.send(JSON.stringify({ t: 'pong' }));
          break;
      }
    });

    const cleanup = () => {
      allClients.delete(client.id);
      hub.remove(client);
    };
    socket.on('close', cleanup);
    socket.on('error', cleanup);
  });
}
