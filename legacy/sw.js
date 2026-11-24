/* GigaChat Service Worker – App-Shell-Caching + Push */
const CACHE = 'gigachat-v3.1';
const SHELL = [
  '/index.php',
  '/assets/css/style.css?v=3.1',
  '/assets/js/chat.js?v=3.1',
  '/assets/js/pwa.js?v=3.1',
  '/assets/img/logo-192.png',
  '/assets/img/logo-96.png',
  '/manifest.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* =========================
   AKKTUELLER CHAT-STATE (vom Client)
========================= */
let activeChat = null;      // Chat der gerade offen ist
let chatVisible = false;    // ob der Tab sichtbar ist

self.addEventListener('message', event => {
  if (event.data?.type === 'CHAT_STATE') {
    activeChat = Number(event.data.chatId) || null;
    chatVisible = !!event.data.visible;
  }
});

/* =========================
   FETCH: strategisches Caching
   - Navigation: network-first (Fallback Cache) -> immer frische Session
   - statische Assets: stale-while-revalidate -> sofort, updatet im Hintergrund
   - API: network-only (nie cachen)
========================= */
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.pathname.startsWith('/api/')) return; // nie API cachen

  // Navigation (HTML)
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put('/index.php', copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match('/index.php'))
    );
    return;
  }

  // Statische Assets: Cache-First + Hintergrund-Update
  if (/\.(css|js|png|jpg|jpeg|svg|webp|json)(\?|$)/.test(url.pathname)) {
    event.respondWith(
      caches.match(req).then(cached => {
        const fresh = fetch(req)
          .then(res => {
            if (res && res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
            }
            return res;
          })
          .catch(() => cached);
        return cached || fresh;
      })
    );
    return;
  }
});

/* =========================
   PUSH
========================= */
self.addEventListener('push', event => {
  let data = {};
  try {
    if (event.data) data = event.data.json();
  } catch (e) {}

  const chatId = Number(data.chatId || data.chat || 0);
  const title = data.title || 'Neue Nachricht';

  // Nicht benachrichtigen, wenn genau dieser Chat gerade offen & sichtbar ist
  if (chatVisible && activeChat === chatId) {
    return;
  }

  const options = {
    body: data.body || '',
    icon: 'assets/img/logo-96.png',
    badge: 'assets/img/logo-96.png',
    tag: 'chat_' + chatId,
    renotify: false,

    data: {
      chat: chatId,
      type: data.type || 'user'
    },

    actions: [
      {
        action: 'reply',
        title: 'Antworten',
        type: 'text',
        placeholder: 'Antwort schreiben…'
      }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

/* =========================
   NOTIFICATION CLICK
========================= */
self.addEventListener('notificationclick', event => {
  const action = event.action;
  const data = event.notification.data || {};
  const reply = event.reply;

  event.notification.close();

  /* ✍️ INLINE REPLY (safe) */
  if (action === 'reply' && typeof reply === 'string' && reply.trim()) {
    event.waitUntil(
      fetch('/api/push/push-reply.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat: data.chat,
          type: data.type,
          text: reply
        })
      }).catch(() => {})
    );
    return;
  }

  /* 📲 CHAT ÖFFNEN */
  event.waitUntil(
    self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true
    }).then(clients => {

      if (clients.length > 0) {
        const client = clients[0];

        client.postMessage({
          type: 'OPEN_CHAT',
          chatId: data.chat,
          chatType: data.type || 'user'
        });

        return client.focus();
      }

      let url = '/?from_push=1';
      if (data.type === 'user')  url += '&user_id=' + data.chat;
      if (data.type === 'group') url += '&group_id=' + data.chat;

      return self.clients.openWindow(url);
    })
  );
});