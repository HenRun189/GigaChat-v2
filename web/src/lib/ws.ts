import type { ClientEvent, ServerEvent } from '@gigachat/shared';
import { useStore } from './store';

let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let attempts = 0;
let shouldRun = false;
let lastTyping = 0;
const placeListeners = new Set<(e: Extract<ServerEvent, { t: 'place.pixel' }>) => void>();

export const onPlacePixel = (fn: (e: Extract<ServerEvent, { t: 'place.pixel' }>) => void) => {
  placeListeners.add(fn);
  return () => placeListeners.delete(fn);
};

function url(): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws`;
}

export function startRealtime(): void {
  if (shouldRun) return;
  shouldRun = true;
  attempts = 0;
  connect();
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('online', () => {
    if (shouldRun && (!socket || socket.readyState === WebSocket.CLOSED)) connect();
  });
}

export function stopRealtime(): void {
  shouldRun = false;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
  document.removeEventListener('visibilitychange', onVisibility);
  socket?.close();
  socket = null;
  useStore.getState().setWsStatus('idle');
}

function connect(): void {
  if (!shouldRun) return;
  const store = useStore.getState();
  store.setWsStatus('connecting');
  const ws = new WebSocket(url());
  socket = ws;

  ws.onopen = () => {
    const wasReconnect = attempts > 0;
    attempts = 0;
    useStore.getState().setWsStatus('open');
    sendFocus();
    if (wasReconnect) resync();
  };

  ws.onmessage = (ev) => {
    let event: ServerEvent;
    try {
      event = JSON.parse(ev.data as string) as ServerEvent;
    } catch {
      return;
    }
    handle(event);
  };

  ws.onclose = (ev) => {
    if (socket === ws) socket = null;
    useStore.getState().setWsStatus('closed');
    if (ev.code === 4401) {
      // Session gone: let the auth layer handle it.
      useStore.getState().setAuth(null);
      shouldRun = false;
      return;
    }
    if (!shouldRun) return;
    const delay = Math.min(30_000, 1000 * 2 ** Math.min(attempts, 5)) + Math.random() * 500;
    attempts++;
    reconnectTimer = setTimeout(connect, delay);
  };

  ws.onerror = () => {
    /* onclose follows */
  };
}

function resync(): void {
  const s = useStore.getState();
  void s.loadContacts().catch(() => {});
  if (s.activeConversationId) void s.syncConversation(s.activeConversationId);
}

function onVisibility(): void {
  sendFocus();
  if (document.visibilityState === 'visible') {
    if (!socket || socket.readyState === WebSocket.CLOSED) {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      attempts = 0;
      connect();
    } else {
      resync();
    }
    const s = useStore.getState();
    if (s.activeConversationId) void s.markConversationRead(s.activeConversationId);
  }
}

export function send(event: ClientEvent): void {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(event));
}

export function sendFocus(): void {
  const s = useStore.getState();
  const visible = document.visibilityState === 'visible';
  send({ t: 'focus', conversationId: s.activeConversationId, visible });
  // Mirror to the service worker so push can be suppressed for the open chat.
  navigator.serviceWorker?.controller?.postMessage({ type: 'CHAT_STATE', conversationId: s.activeConversationId, visible });
}

export function sendTyping(conversationId: number): void {
  const now = Date.now();
  if (now - lastTyping < 2500) return;
  lastTyping = now;
  send({ t: 'typing', conversationId });
}

function handle(event: ServerEvent): void {
  const s = useStore.getState();
  switch (event.t) {
    case 'message.new': {
      s.addMessage(event.message);
      const active = s.activeConversationId === event.conversationId && document.visibilityState === 'visible';
      if (active && event.message.senderId !== s.me?.id) void s.markConversationRead(event.conversationId);
      if (!s.contacts.some((c) => c.conversationId === event.conversationId)) void s.loadContacts().catch(() => {});
      break;
    }
    case 'message.updated':
      s.updateMessage(event.message);
      if (s.contacts.some((c) => c.conversationId === event.message.conversationId)) void s.loadContacts().catch(() => {});
      break;
    case 'read':
      s.setRead(event.conversationId, event.userId, event.lastReadMessageId);
      break;
    case 'typing':
      s.setTyping(event.conversationId, event.userId);
      break;
    case 'presence':
      s.setPresence(event.userId, event.online, event.lastSeen);
      break;
    case 'score':
      s.setScores(event.scores);
      break;
    case 'contacts.changed':
      void s.loadContacts().catch(() => {});
      break;
    case 'conversation.changed':
      void s.syncConversation(event.conversationId);
      break;
    case 'user.updated':
      s.setUserUpdated(event.user);
      if (s.me && s.me.id === event.user.id) s.updateMe({ username: event.user.username, color: event.user.color, emoji: event.user.emoji, role: event.user.role });
      break;
    case 'place.pixel':
      for (const l of placeListeners) l(event);
      break;
    case 'session.expired':
      s.setAuth(null);
      break;
    default:
      break;
  }
}
