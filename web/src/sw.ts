/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core';
import { ExpirationPlugin } from 'workbox-expiration';
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst } from 'workbox-strategies';

declare let self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision: string | null }> };

self.skipWaiting();
clientsClaim();

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// App shell for every navigation (except API / uploads).
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('index.html'), {
    denylist: [/^\/api\//, /^\/uploads\//, /^\/ws/],
  }),
);

// Uploaded media and GIFs: cache-first with expiry.
registerRoute(
  ({ url, request }) =>
    request.destination === 'image' &&
    (url.pathname.startsWith('/uploads/') || /giphy\.com$|tenor\.com$/.test(url.hostname)),
  new CacheFirst({
    cacheName: 'gc-media',
    plugins: [new ExpirationPlugin({ maxEntries: 300, maxAgeSeconds: 30 * 24 * 3600, purgeOnQuotaError: true })],
  }),
);

/* ---------- Push ---------- */

interface PushData {
  title?: string;
  body?: string;
  conversationId?: number;
  tag?: string;
  url?: string;
  icon?: string;
}

// Which conversation each window currently shows (reported by the page).
const clientState = new Map<string, { conversationId: number | null; visible: boolean }>();

self.addEventListener('message', (event) => {
  const data = event.data as { type?: string; conversationId?: number | null; visible?: boolean } | undefined;
  if (!data || data.type !== 'CHAT_STATE') return;
  const id = (event.source as Client | null)?.id;
  if (!id) return;
  clientState.set(id, { conversationId: data.conversationId ?? null, visible: !!data.visible });
});

self.addEventListener('push', (event) => {
  let data: PushData = {};
  try {
    data = (event.data?.json() as PushData) ?? {};
  } catch {
    data = { body: event.data?.text() ?? '' };
  }
  const conversationId = Number(data.conversationId || 0);

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const w of windows) {
        const st = clientState.get(w.id);
        const visible = w.visibilityState === 'visible' && (st ? st.visible : true);
        if (visible && st?.conversationId === conversationId) return; // user is looking at it
      }
      await self.registration.showNotification(data.title || 'GigaChat', {
        body: data.body || '',
        icon: data.icon || '/icons/icon-192.png',
        badge: '/icons/icon-96.png',
        tag: data.tag || (conversationId ? `conv-${conversationId}` : 'gigachat'),
        renotify: true,
        data: { conversationId, url: data.url || (conversationId ? `/c/${conversationId}` : '/') },
        // Inline reply where supported (Android Chrome); ignored elsewhere.
        actions: [{ action: 'reply', title: 'Antworten', type: 'text', placeholder: 'Antwort schreiben…' }],
      } as NotificationOptions);
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  const data = (event.notification.data ?? {}) as { conversationId?: number; url?: string };
  const reply = (event as NotificationEvent & { reply?: string }).reply;
  event.notification.close();

  if (event.action === 'reply' && typeof reply === 'string' && reply.trim() && data.conversationId) {
    event.waitUntil(
      fetch('/api/push/reply', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', 'x-requested-with': 'gigachat' },
        body: JSON.stringify({ conversationId: data.conversationId, text: reply.trim() }),
      }).catch(() => {}),
    );
    return;
  }

  const url = data.url || '/';
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const existing = windows[0];
      if (existing) {
        existing.postMessage({ type: 'OPEN_CONVERSATION', conversationId: data.conversationId ?? null, url });
        await existing.focus();
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});

self.addEventListener('pushsubscriptionchange', (event) => {
  const e = event as ExtendableEvent & { oldSubscription?: PushSubscription | null; newSubscription?: PushSubscription | null };
  const sub = e.newSubscription;
  if (!sub) return;
  e.waitUntil(
    fetch('/api/push/subscribe', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json', 'x-requested-with': 'gigachat' },
      body: JSON.stringify(sub.toJSON()),
    }).catch(() => {}),
  );
});
