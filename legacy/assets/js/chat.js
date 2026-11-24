/* GigaChat Chat-Logik (aus index.php ausgelagert) */
window.GIGA = window.GIGA || {};

let currentChat = window.GIGA.chatId;
receiver_id = currentChat;
let lastUnread = {};
let currentType = window.GIGA.chatType;
let lastId = 0;
let totalNewMessages = 0;

// === Lade-Limits: klein starten, mehr nur auf Wunsch (Scroll/Button) ===
const INITIAL_LIMIT = 20;         // erste Ladung: nur die letzten 20 Nachrichten
const OLDER_LIMIT   = 20;         // pro "Ältere laden" (Button/Scrollen nach oben)
const POLL_LIMIT    = 50;         // Polling ist inkrementell (last_id) -> billig
const MEDIA_STICK_TIMEOUT = 8000; // max. Wartezeit auf Medien beim Anspringen ans Ende
let pollInFlight = false;         // verhindert sich überlappende Poll-Requests
const chatbox = document.getElementById("chatbox");
const chatForm = document.getElementById("chatForm");
const messageInput = document.getElementById("message");
const cooldown = 500;
let canSend = true;
const chatWithEl = document.getElementById("chatWith");
let loadingOlder = false;
let reachedTop = false;
let autoScroll = true;
const USER_ID = window.GIGA.userId;
let initialLoading = true;

const SESSION_USER_ID = window.GIGA.sessionUserId;
const SESSION_ROLE = window.GIGA.sessionRole;

/* === Timing-Fix (WhatsApp-Web-Verhalten) ===
 * Der ServiceWorker muss das aktive Control übernommen haben, bevor wir ihm
 * den Chat-State melden – sonst ist navigator.serviceWorker.controller(null)
 * beim Laden und der SW unterdrueckt Push im gerade sichtbaren Chat nicht
 * (doppelte Benachrichtigung).
 * swReady loest sich auf beim ersten controllerchange bzw. beim initialen ready.
 */
let swReadyResolve;
const swReady = new Promise(r => { swReadyResolve = r; });
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('controllerchange', () => swReadyResolve());
  navigator.serviceWorker.ready.then(() => {
    if (navigator.serviceWorker.controller) swReadyResolve();
  });
}

function toggleMode() {
  document.body.classList.toggle('dark');

  // merken im Browser
  if (document.body.classList.contains('dark')) {
    localStorage.setItem('theme', 'dark');
  } else {
    localStorage.setItem('theme', 'light');
  }
}

// FIX LAG: Scroll-Handler auf requestAnimationFrame gedrosselt + passive.
// Vorher lief er bei JEDEM Scroll-Pixel mit Layout-Lesezugriffen.
let scrollTicking = false;
chatbox.addEventListener('scroll', () => {
  if (scrollTicking) return;
  scrollTicking = true;
  requestAnimationFrame(() => {
    scrollTicking = false;

    // AutoScroll: nur "unten", wenn wir wirklich nah am Boden sind
    const distToBottom =
      chatbox.scrollHeight - chatbox.scrollTop - chatbox.clientHeight;
    autoScroll = distToBottom <= 60;

    // "Nach unten"-Button ein-/ausblenden
    updateScrollBottomBtn();

    // Infinite Scroll nach oben
    if (!initialLoading && !reachedTop && chatbox.scrollTop <= 120 && !loadingOlder) {
      loadOlderMessages();
    }
  });
}, { passive: true });

// === Gemeinsamer Nachrichten-Renderer ===
function dayStringFor(date) {
  return date.toLocaleDateString('de-DE', {
    weekday:'short', day:'2-digit', month:'2-digit', year:'numeric'
  });
}

function makeDateDivider(date) {
  const dateDiv = document.createElement("div");
  dateDiv.className = "chat-date";
  dateDiv.textContent = dayStringFor(date);
  return dateDiv;
}

function renderMessage(msg, animate = false) {
  const div = document.createElement("div");
  div.id = "msg_" + msg.id;
  div.dataset.id = msg.id;
  div.className = "message " + (msg.sender_id == USER_ID ? "me" : "");

  if (msg.deleted == 1) div.classList.add("deleted");
  if (animate) div.classList.add("msg-animate");

  const msgDate = new Date(msg.created_at);
  const color = msg.color && msg.color !== 'none' ? msg.color : 'inherit';
  const emoji = msg.emoji && msg.emoji !== 'none' ? msg.emoji + " " : "";
  const timeString = msgDate.toLocaleTimeString('de-DE', { hour:'2-digit', minute:'2-digit' });

  let content = "";
  let status = "";

  if (msg.deleted == 1) {
    content = `<span class="msg-deleted">Nachricht gelöscht</span>`;
  }
  else if (msg.gif_url) {
    content = `<img loading="lazy" decoding="async" src="${msg.gif_url}" class="chat-gif">`;
  }
  else if (msg.is_image == 1 && msg.file_path) {
    content = `<img loading="lazy" decoding="async" src="${msg.file_path}" class="chat-image" data-full="${msg.file_path}">`;
  }
  else if (msg.file_path) {
    const fname = msg.original_name || "Datei";
    content = `<a href="${msg.file_path}" target="_blank">📎 ${fname}</a>`;
  }
  else {
    content = linkify(msg.text || "");
  }

  if (msg.edited == 1) status += "✏️ ";
  if (msg.sender_id == USER_ID) {
    status += msg.read_at ? "👁️" : "✔️";
  }

  div.innerHTML = `
    <b style="color:${color}">
      ${emoji}${msg.username || (msg.sender_id == USER_ID ? "Du" : "Unbekannt")}
    </b>
    <span class="msg-main">${content}</span>
    <span class="msg-status">${msg.deleted == 1 ? "" : status}</span>
    <span class="msg-time">${timeString}</span>
  `;

  return div;
}

// Nachricht vorne (unten) anhängen – mit Datums-Trenner
function appendMessage(msg, animate = false) {
  if (document.getElementById("msg_" + msg.id)) return;

  const msgDate = new Date(msg.created_at);
  const dayString = dayStringFor(msgDate);

  if (window.lastDay !== dayString) {
    const divider = makeDateDivider(msgDate);
    if (animate) divider.classList.add("msg-animate");
    chatbox.appendChild(divider);
    window.lastDay = dayString;
  }

  const div = renderMessage(msg, animate);
  chatbox.appendChild(div);
  lastId = Math.max(lastId, msg.id);
}

// Nachricht hinten (oben) einfügen – für ältere Nachrichten
function prependMessages(msgs) {
  const fragment = document.createDocumentFragment();
  let lastDividerDay = null;

  msgs.forEach(msg => {
    if (document.getElementById("msg_" + msg.id)) return;

    const msgDate = new Date(msg.created_at);
    const dayString = dayStringFor(msgDate);

    // Datums-Trenner nur bei Tag-Wechsel innerhalb der geladenen Nachrichten
    if (lastDividerDay !== dayString) {
      fragment.appendChild(makeDateDivider(msgDate));
      lastDividerDay = dayString;
    }

    fragment.appendChild(renderMessage(msg, false));
  });

  chatbox.insertBefore(fragment, chatbox.firstChild);
  // window.lastDay NICHT ändern – es gehört zur neuesten (untersten) Nachricht
}

// FIX "man ist nicht ganz unten":
// Sofort scrollen UND erneut, sobald Medien fertig geladen sind – mit
// großzügigem 8s-Fenster (langsame Tenor-GIFs!). Durch die fixen Bildgrößen
// passiert kaum noch Layout-Shift, das hier ist das Sicherheitsnetz.
function stickToBottom(chatId, chatType) {
  const doScroll = () => {
    if (chatId === currentChat && chatType === currentType && autoScroll) {
      chatbox.scrollTop = chatbox.scrollHeight;
      updateScrollBottomBtn();
    }
  };
  requestAnimationFrame(doScroll);

  let done = false;
  const onMediaSettled = () => {
    if (!done) requestAnimationFrame(doScroll);
  };
  chatbox.querySelectorAll('img').forEach(img => {
    if (img.complete) return;
    img.addEventListener('load', onMediaSettled, { once: true });
    img.addEventListener('error', onMediaSettled, { once: true });
  });
  setTimeout(() => { done = true; }, MEDIA_STICK_TIMEOUT);
}

// === "Ältere Nachrichten laden"-Button über der Chatbox ===
const loadOlderBtn = document.getElementById("loadOlderBtn");
if (loadOlderBtn) loadOlderBtn.addEventListener("click", () => loadOlderMessages());

// === "Nach unten"-Button: springt weich zur neuesten Nachricht ===
const scrollBottomBtn = document.getElementById("scrollBottomBtn");

function updateScrollBottomBtn() {
  if (!scrollBottomBtn) return;
  const dist = chatbox.scrollHeight - chatbox.scrollTop - chatbox.clientHeight;
  // Zeigen, sobald man spürbar über dem neuesten Stand ist
  scrollBottomBtn.classList.toggle("show", !initialLoading && dist > 260);
}

if (scrollBottomBtn) {
  scrollBottomBtn.addEventListener("click", () => {
    autoScroll = true;
    // bewusst smooth – NUR hier ist die Animation erwünscht
    chatbox.scrollTo({ top: chatbox.scrollHeight, behavior: "smooth" });
  });
}

function updateLoadOlderBtn() {
  if (!loadOlderBtn) return;
  const hasMessages = !!chatbox.querySelector('.message[data-id]');
  loadOlderBtn.style.display = (!initialLoading && !reachedTop && hasMessages) ? "" : "none";
  loadOlderBtn.disabled = loadingOlder;
  loadOlderBtn.textContent = loadingOlder ? "⏳ Lädt…" : "↑ Ältere Nachrichten laden";
}

// Falls die ersten 20 Nachrichten den Bildschirm NICHT füllen, gibt es keinen
// Scrollbalken -> das Scroll-Event würde nie feuern. Deshalb automatisch weiterladen.
function maybeAutoLoadOlder() {
  if (initialLoading || loadingOlder || reachedTop) return;
  if (!chatbox.querySelector('.message[data-id]')) return;
  if (chatbox.scrollHeight <= chatbox.clientHeight + 1) loadOlderMessages();
}

// Nur EIN Poll gleichzeitig; Fehler werden geschluckt (nächster Tick retryt).
// full=true holt auch Kontakte + Partner-Status (alle ~15s).
let lastContacts = [];
function pollNewMessages(full = false, allowHidden = false) {
  if (pollInFlight) return;
  // Background-Light-Poll (allowHidden) hole nur neue Nachrichten, damit eine
  // geöffnete App im Hintergrund ohne Push trotzdem Updates bekommt.
  if (!allowHidden && document.hidden) return;
  if (!currentChat && !full) return; // ohne offenen Chat nur bei Full-Sync
  pollInFlight = true;
  loadMessages(true, full)
    .catch(() => {})
    .finally(() => { pollInFlight = false; });
}

// Nach einer Aktion (Alias, Pin, Gruppe verlassen…) lokale Daten sofort refreshen
function refreshContacts() {
  if (lastContacts.length) renderContacts(lastContacts);
  pollNewMessages(true);
}

// === Konsolidierter Sync-Request (ersetzt 5 einzelne Polling-Requests) ===
// sync.php liefert in EINEM Request: Nachrichten, Kontakte, Lesebestaetigungen,
// Partner-Status und aktualisiert eigenes last_seen (Presence).
// newOnly=true  -> Polling: nur Nachrichten NEUER als last_id
// newOnly=false -> Chat oeffnen: nur die LETZTEN INITIAL_LIMIT Nachrichten
function loadMessages(newOnly = true, full = false) {
  const chatId = currentChat;
  const chatType = currentType;
  if (!chatId && !full) return Promise.resolve();

  const shouldStickToBottom = autoScroll || !newOnly;
  const limit = newOnly ? POLL_LIMIT : INITIAL_LIMIT;
  const fetchLimit = newOnly ? limit : limit + 1;

  const params = new URLSearchParams({
    chat_id: chatId,
    type: chatType,
    last_id: newOnly ? lastId : 0,
    limit: fetchLimit,
    init: newOnly ? 0 : 1,
    full: full ? 1 : 0,
  });

  return fetch(`api/chat/sync.php?${params}`)
    .then(r => {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    })
    .then(data => {
      if (chatId !== currentChat || chatType !== currentType) return;
      if (!data || !data.ok) return;

      // --- Nachrichten ---
      const messages = Array.isArray(data.messages) ? data.messages : [];
      if (messages.length === 0 && !newOnly) {
        reachedTop = true;
        updateLoadOlderBtn();
      }

      if (messages.length > 0) {
        if (!newOnly) {
          if (messages.length <= limit) {
            reachedTop = true;
          } else {
            messages.splice(0, messages.length - limit); // nur NEUESTEN limit behalten
          }
          chatbox.innerHTML = "";
          window.lastDay = null;
          lastId = 0;
        }

        messages.forEach(msg => appendMessage(msg, newOnly));
        if (shouldStickToBottom) stickToBottom(chatId, chatType);
      }

      updateLoadOlderBtn();
      updateScrollBottomBtn();

      // --- Kontakte (nur bei full=1, alle ~15s) ---
      if (Array.isArray(data.contacts)) {
        lastContacts = data.contacts;
        if (full || data.contacts.length > 0) {
          renderContacts(data.contacts);
          updateTitleBadge();
        }
      }

      // --- Lesebestaetigungen ---
      if (Array.isArray(data.readIds) && data.readIds.length > 0) {
        data.readIds.forEach(id => {
          const msg = document.querySelector('.message[data-id="' + id + '"]');
          if (msg) {
            msg.classList.remove("unread");
            msg.classList.add("read");
            const status = msg.querySelector(".msg-status");
            if (status) status.textContent = "👁️";
          }
        });
      }

      // --- Partner-Status (nur Privatchat + full) ---
      if (data.partner && currentType === 'user') {
        renderUserStatus(data.partner);
      }
    });
}

function updateTitleBadge() {
    let newTotal = 0;
    document.querySelectorAll('.users-list .new-badge').forEach(el => {
        newTotal += parseInt(el.textContent) || 0;
    });

    totalNewMessages = newTotal;

    if(totalNewMessages > 0){
        document.title = `(${totalNewMessages}) Neue Nachricht${totalNewMessages > 1 ? 'en' : ''} – Chat`;
    } else {
        document.title = 'Chat';
    }
}

function gigaScoreEmoji(score) {
    if (SESSION_ROLE >= 1) {
         const s = parseInt(score || 0);
        if (s >= 6400) return "💠";
        if (s >= 5600) return "🐉";
        if (s >= 4900) return "👑";
        if (s >= 4200) return "💎";
        if (s >= 3600) return "🦅";
        if (s >= 3000) return "🏆";
        if (s >= 2400) return "🎮";
        if (s >= 1900) return "🧠";
        if (s >= 1400) return "🚀";
        if (s >= 1000) return "🔥";
        if (s >= 700)  return "⚡";
        if (s >= 500)  return "🍗";
        if (s >= 400)  return "🐔";
        if (s >= 300)  return "🐥";
        if (s >= 200)  return "🌲";
        if (s >= 100)  return "🪴";
        if (s >= 50)  return "🍀";
        if (s >= 10)   return "🌱";
        return "🍼"; 
    } else {
        const s = parseInt(score || 0, 10);
        if (s >= 2000) return "👑";
        if (s >= 1000) return "💎";
        if (s >= 500)  return "⭐";
        if (s >= 150)  return "🔥";
        if (s >= 50)   return "⚡";
          return "🌱";
        }
}
// Rendert Kontakte aus dem Sync-Response (data.contacts)
function renderContacts(contacts) {
  const list = document.querySelector(".users-list");
  if (!list) return;

  const scrollTop = list.scrollTop;
  list.innerHTML = "";

  const normal = [];
  const archived = [];

  contacts.forEach(c => {
    if (c.type !== 'user' || (c.archived ?? 0) === 0) normal.push(c);
    else archived.push(c);
  });

  function buildLi(c) {
    const li = document.createElement("li");
    li.dataset.type = c.type || 'user';
    li.dataset.id = c.id;

    if (c.type === 'group' && c.new > 0) li.classList.add('has-new');
    li.dataset.gigascore = c.gigascore ?? 0;

    const color = c.color && c.color !== 'none' ? c.color : 'inherit';
    const emoji = c.emoji && c.emoji !== 'none' ? (c.emoji + " ") : "";

    const isPinned = c.pinned && c.pinned > 0;
    if (isPinned) li.classList.add('pinned');

    if (c.id == currentChat && c.type == currentType) li.classList.add('active-chat');

    const rightEmoji = (c.type === 'group') ? "👥" : gigaScoreEmoji(c.gigascore ?? 0);

    li.innerHTML = `
      <div class="user-btn" style="color:${color}">
        <span class="left">
          <span class="name">${emoji}${c.username}</span>
          ${c.new > 0 ? `<span class="new-badge">${c.new}</span>` : ""}
        </span>
        <span class="score-emoji" title="GigaScore">${rightEmoji}</span>
      </div>
    `;
    return li;
  }

  normal.forEach(c => list.appendChild(buildLi(c)));

  if (archived.length > 0) {
    const headerLi = document.createElement("li");
    headerLi.className = "archive-header";
    headerLi.innerHTML = `<div class="user-btn archive-toggle">📁 Archivierte Kontakte <span class="arrow">▼</span></div>`;
    list.appendChild(headerLi);

    const archContainer = document.createElement("ul");
    archContainer.className = "archive-list";
    archContainer.style.display = "none";
    list.appendChild(archContainer);

    archived.forEach(c => archContainer.appendChild(buildLi(c)));

    headerLi.querySelector(".archive-toggle").addEventListener("click", () => {
      archContainer.style.display = archContainer.style.display !== "none" ? "none" : "block";
    });
  }

  const liMenuBtn = document.createElement("li");
  liMenuBtn.innerHTML = `<div class="user-btn" style="color:var(--text); cursor:pointer; text-align:center; justify-content:center;" onclick="window.open('menu/')">📱 Menü andere Webseiten</div>`;
  list.appendChild(liMenuBtn);

  const liNotesBtn = document.createElement("li");
  liNotesBtn.innerHTML = `<div class="user-btn" style="color:var(--text); text-align:center; justify-content:center; cursor:pointer;">📝 Notizen (privat)</div>`;
  liNotesBtn.onclick = openNotes;
  list.appendChild(liNotesBtn);

  const liEinstellungenBtn = document.createElement("li");
  liEinstellungenBtn.innerHTML = `<div class="user-btn" style="color:var(--text); cursor:pointer; text-align:center; justify-content:center;" onclick="window.open('settings.php')">⚙️ Einstellungen</div>`;
  list.appendChild(liEinstellungenBtn);

  const liLogoutBtn = document.createElement("li");
  liLogoutBtn.style.listStyle = "none";
  liLogoutBtn.innerHTML = `<div class="user-btn" style="background:#ff6b6b; color:#fff; cursor:pointer; text-align:center;" onclick="window.location.href='logout.php'">🔒 Logout</div>`;
  list.appendChild(liLogoutBtn);

  if (scrollTop) list.scrollTop = scrollTop;
}

function updateChatWithName(name) {
    document.getElementById("chatWithName").textContent = name;
}

// === Nachricht senden (optimistisch) ===
const sendBtn = chatForm.querySelector('button[type="submit"]');

chatForm.addEventListener("submit", e => {
    e.preventDefault();
    if(!canSend) return;
    if(!currentChat) return; // Guard: kein Chat geöffnet
    const text = messageInput.value.trim();
    if(text.length < 1) return;

    canSend = false;
    if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = '...'; }
    setTimeout(() => {
        canSend = true;
        if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = 'Senden'; }
    }, cooldown);

    // Optimistisches Anzeigen – Nachricht sofort unten einfügen
    const tempId = 'temp_' + Date.now();
    const tempMsg = {
      id: tempId,
      sender_id: USER_ID,
      username: 'Du',
      text: text,
      created_at: new Date().toISOString(),
      color: null,
      emoji: '',
      read_at: null,
      edited: 0,
      deleted: 0,
      gif_url: null,
      file_path: null,
      is_image: 0
    };
    appendMessage(tempMsg, true);
    messageInput.value = "";
    autoScroll = true;
    chatbox.scrollTop = chatbox.scrollHeight;

    let formData = new FormData();
    formData.append("message", text);
    if(currentType === 'user'){
        formData.append("receiver_id", currentChat);
    } else {
        formData.append("group_id", currentChat);
    }

    const sendUrl = currentType === 'user' ? "api/chat/send_message.php" : "api/group/send_group_message.php";

    fetch(sendUrl, { method:"POST", body: formData })
        .then(r => r.json())
        .then(res => {
            if (res.ok) {
                pollNewMessages();
            } else {
                // Server-Fehler: optimistische Nachricht entfernen
                const tempEl = document.getElementById('msg_' + tempId);
                if (tempEl) tempEl.remove();
                showToast('Nachricht konnte nicht gesendet werden.');
            }
        })
        .catch(() => {
            // Netzwerkfehler: optimistische Nachricht entfernen
            const tempEl = document.getElementById('msg_' + tempId);
            if (tempEl) tempEl.remove();
            showToast('Netzwerkfehler. Bitte erneut versuchen.');
        });
});

const chatMenu = document.getElementById("chatMenu");
const menuTitle = document.getElementById("menuTitle");
const menuMembersList = document.getElementById("menuMembers");
const menuActionBtn = document.getElementById("menuActionBtn");

// Klick auf Chatname
chatWithEl.addEventListener("click", () => {
    openMenu(currentType, currentChat, chatWithEl.textContent.trim());
});

// Klick außerhalb schließt Menü
document.addEventListener("click", (e)=>{
    if(!chatMenu.contains(e.target) && e.target !== chatWithEl){
        chatMenu.style.display = "none";
    }
});

// === Push-Benachrichtigungen ===

const vapidPublicKey = 'BGKaUZpoIpfq4mOBjwj4SnTol4lTpimNI113onzGdUMNMGt0VMiz9sJdYdXwhEeQ_3Z_Jiz7XTZwelw617tcpI8';

async function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

async function subscribeForPush() {
  if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    alert('Push wird von diesem Browser nicht unterstützt');
    return;
  }

    const permission = await Notification.requestPermission(); // muss im Klick-Handler laufen
  if (permission !== 'granted') {
    alert('Benachrichtigungen nicht erlaubt');
    return;
  }

  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: await urlBase64ToUint8Array(vapidPublicKey)
  });

  await fetch('/api/push/save-subscription.php', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sub)
  });

  alert('Benachrichtigungen aktiviert');
}
/*
document.getElementById('enable-notifications').addEventListener('click', () => {
  subscribeForPush().catch(console.error);
});*/


// === Init ===
document.addEventListener("DOMContentLoaded", () => {
    
    // Nur einmal pro Browser: Version-Flag prüfen für konfetti 
    const VERSION_FLAG = 'gigachat_3_0_shown';
    const alreadyShown = localStorage.getItem(VERSION_FLAG) === '1';

    if (!alreadyShown) {
        showReleaseBanner();
        localStorage.setItem(VERSION_FLAG, '1');
    }
   
    const saved = localStorage.getItem('theme');

    if (saved === 'light') {
      document.body.classList.remove('dark');
    } else {
      // default = dark
      document.body.classList.add('dark');
    }

    // === Chat öffnen – mit Retry, falls der erste Request scheitert
    // (früher blieb die Chatbox dann einfach leer) ===
    function openCurrentChat(isRetry) {
      const openedChatId = currentChat;
      const openedChatType = currentType;
      loadMessages(false)
        .catch(err => {
          console.error("Nachrichten laden fehlgeschlagen", err);
          if (isRetry) return undefined;
          // einmalig nach 1,5s erneut versuchen
          return new Promise(res => setTimeout(res, 1500)).then(() => {
            if (openedChatId !== currentChat || openedChatType !== currentType) return undefined;
            return openCurrentChat(true);
          });
        })
        .finally(() => {
          if (openedChatId !== currentChat || openedChatType !== currentType) return;
          requestAnimationFrame(() => {
            if (openedChatId !== currentChat || openedChatType !== currentType) return;
            autoScroll = true;
            chatbox.scrollTop = chatbox.scrollHeight;
            initialLoading = false;
            updateLoadOlderBtn();
            updateScrollBottomBtn();
            // Falls die ersten 20 Nachrichten den Bildschirm nicht füllen,
            // sofort ältere nachladen (kein Scrollbalken = kein Scroll-Event!)
            maybeAutoLoadOlder();

            // Sicherheitsnetz "ganz ganz unten": gestaffelte Nach-Sprünge,
            // falls Bilder/GIFs erst Sekunden später fertig laden. Bricht ab,
            // sobald der User selbst hochscrollt (autoScroll=false).
            [350, 900, 2000, 4000].forEach(ms => setTimeout(() => {
              if (openedChatId !== currentChat || openedChatType !== currentType) return;
              if (!autoScroll || document.hidden) return;
              const d = chatbox.scrollHeight - chatbox.scrollTop - chatbox.clientHeight;
              if (d > 2) chatbox.scrollTop = chatbox.scrollHeight;
              updateScrollBottomBtn();
            }, ms));
          });
        });
    }

        openCurrentChat(false);
    syncSWChatState(); // initialer Chat-State an den SW (Push-Suppression sofort aktiv)

    // Sync-Intervall: EIN Request liefert Nachrichten + Kontakte + Status + Lesebestaetigungen.
    // Volle Sync (Kontakte/Partner) nur alle 3. Runde (~15s).
    let pollTick = 0;
    setInterval(() => {
      pollTick = (pollTick + 1) % 3;
      if (document.hidden) {
        // Hintergrund: langsames Light-Poll (nur neue Nachrichten, keine Kontakte),
        // damit neue Nachrichten auch ohne Push geholt werden – wie WhatsApp Web.
        if (pollTick === 0) pollNewMessages(false, true);
        return;
      }
      pollNewMessages(pollTick === 0);
    }, 5000);

    // Wenn man in den Tab zurückkommt, SOFORT nachladen + Chat-State erneuern
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        pollNewMessages(true);
      }
      notifySWChatState();
    });



    const usersList = document.querySelector(".users-list");


    function switchChat(el) {
      // ── State komplett zurücksetzen ──────────────────────────────
      lastId = 0;
      reachedTop = false;
      loadingOlder = false;
      initialLoading = true;
      autoScroll = true;
      chatbox.innerHTML = '';
      window.lastDay = null;

        currentChat = parseInt(el.parentElement.dataset.id);

        // letzten Chat inkl. TYP merken (30 Tage) – früher ging der Typ verloren,
        // nach einem Reload wurde eine Gruppe fälschlich als Privatchat geöffnet
        document.cookie = "last_chat_user=" + currentChat + "; max-age=" + (60*60*24*30) + "; path=/";

        currentType = el.parentElement.dataset.type || 'user';
        document.cookie = "last_chat_type=" + currentType + "; max-age=" + (60*60*24*30) + "; path=/";
        document.getElementById("receiver_id").value = currentChat;

        // Chatname aktualisieren: nur den reinen Textteil nehmen (ohne Badge-Zahlen)
        const nameEl = el.querySelector('.name');
        const chatName = nameEl ? nameEl.textContent.trim() : el.firstChild?.textContent?.trim() || el.textContent.trim();
        updateChatWithName(chatName);

        const li = el.parentElement;
        const chatGigaScore = li.dataset.gigascore || 0;
        document.getElementById('theirGigaScore').textContent = chatGigaScore;

        // Menü schließen beim Chat-Wechsel
        chatMenu.style.display = 'none';

        updateLoadOlderBtn();
        // "Nach unten"-Button beim Chat-Wechsel ausblenden (initialLoading)
        if (scrollBottomBtn) scrollBottomBtn.classList.remove("show");

        // Nachrichten laden + danach scrollen & Lock freigeben (inkl. Retry)
        openCurrentChat(false);

        // Badge entfernen: markiere alle Nachrichten des Chats als gelesen
        if (currentType === 'group') {
            fetch('api/group/mark_group_read.php?group_id=' + currentChat);
        } else {
            fetch(`api/chat/mark_read.php?user_id=${currentChat}`);
        }

        // Kontakte + Status werden vom Sync-Response mitgeliefert
        clearNotificationsForChat(currentChat, currentType);
        notifySWChatState();
    }

    usersList.addEventListener("click", e => {
        const btn = e.target.closest(".user-btn");
        if (!btn) return;

        // Archiv-Header und Action-Buttons NICHT als Chat behandeln
        if (btn.classList.contains('archive-toggle')) return;
        if (!btn.parentElement?.dataset?.id) return;

        switchChat(btn);
        notifySWChatState();
    });

    const overlay      = document.getElementById('imageOverlay');
    const overlayImg   = document.getElementById('overlayImg');
    const btnClose     = document.getElementById('overlayClose');
    const btnOpenTab   = document.getElementById('overlayOpenTab');
    const btnDownload  = document.getElementById('overlayDownload');
    let currentImgUrl  = null;

    // Delegation: auf Bilder im Chat reagieren
    chatbox.addEventListener('click', e => {
      const img = e.target.closest('.chat-image');
      if (!img) return;

      currentImgUrl = img.getAttribute('data-full') || img.src;
      overlayImg.src = currentImgUrl;
      overlay.style.display = 'flex';
    });

    btnClose.addEventListener('click', () => {
      overlay.style.display = 'none';
      overlayImg.src = '';
    });

    btnOpenTab.addEventListener('click', () => {
      if (!currentImgUrl) return;

      const newWindow = window.open(currentImgUrl, '_blank');

      // iOS PWA blockt das manchmal → Fallback
      if (!newWindow) {
        window.location.href = `https://www.google.com/url?q=${encodeURIComponent(currentImgUrl)}`;
      }
    });


    btnDownload.addEventListener('click', () => {
      if (!currentImgUrl) return;
      const a = document.createElement('a');
      a.href = currentImgUrl;
      a.download = currentImgUrl.split('/').pop();
      a.target = '_blank'; // erzwingt Browser-UI
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    });


    // Klick auf dunklen Hintergrund schließt Overlay
    overlay.addEventListener('click', e => {
      if (e.target === overlay) {
        overlay.style.display = 'none';
        overlayImg.src = '';
      }
    });

});

function openMenu(type, chatId, chatName){
    menuMembersList.innerHTML = "";
    menuActionBtn.style.display = "none";

    if(type === "group"){
        menuTitle.textContent = "Gruppenmitglieder";

        // 1. Gruppeninfo + Owner prüfen
        fetch(`api/group/get_group_info.php?group_id=${chatId}`)
            .then(r => r.json())
            .then(info => {
                const isOwner = info.is_owner;

                // 2. Mitglieder laden
                fetch(`api/group/get_group_members.php?group_id=${chatId}`)
                    .then(r => r.json())
                    .then(data => {
                        data.forEach(m => {
                            const li = document.createElement("li");
                            li.textContent = (m.emoji ? m.emoji + " " : "") + (m.alias || m.username);

                            // Entfernen‑Button nur wenn Owner und nicht er selbst
                            if (isOwner && m.id !== window.GIGA.userId) {
                                const btn = document.createElement("button");
                                btn.textContent = "Entfernen";
                                btn.style.marginLeft = "8px";
                                btn.onclick = () => {
                                    if(confirm("Benutzer aus Gruppe entfernen?")){
                                        fetch(`api/group/remove_from_group.php?group_id=${chatId}&user_id=${m.id}`)
                                            .then(()=> openMenu("group", chatId, chatName)); // neu laden
                                    }
                                };
                                li.appendChild(btn);
                            }

                            menuMembersList.appendChild(li);
                        });

                        // Gruppe verlassen (alle)
                        menuActionBtn.style.display = "block";
                        menuActionBtn.textContent = "🚪 Gruppe verlassen";
                        menuActionBtn.onclick = () => {
                            if(confirm("Willst du die Gruppe wirklich verlassen?")){
                                fetch(`api/group/leave_group.php?group_id=${chatId}`).then(()=>{
                                    alert("Du hast die Gruppe verlassen.");
                                    chatMenu.style.display = "none";
                                    refreshContacts();
                                    chatbox.innerHTML = "";
                                });
                            }
                        };

                        // Extra‑Buttons nur für Owner
                        if (isOwner) {
                            const addBtn = document.createElement("button");
                            addBtn.textContent = "➕ Benutzer hinzufügen";
                            addBtn.onclick = () => {
                                const uid = prompt("User‑ID, die du hinzufügen willst:");
                                if(uid){
                                    fetch(`api/group/add_to_group.php?group_id=${chatId}&user_id=${encodeURIComponent(uid)}`)
                                        .then(()=> openMenu("group", chatId, chatName));
                                }
                            };
                            menuMembersList.appendChild(addBtn);
                        }
                    })
                    .catch(() => showToast("Mitglieder konnten nicht geladen werden."));
            })
            .catch(() => showToast("Gruppeninfo konnte nicht geladen werden."));

        } else if (type === "user") {
            menuTitle.textContent = "Kontakt";
        
            // Name anzeigen
            const nameLi = document.createElement("li");
            nameLi.textContent = chatName;
            menuMembersList.appendChild(nameLi);
        
            // Alias-Anzeige / -Bearbeitung
            const aliasLi = document.createElement("li");
            aliasLi.innerHTML = `
                <label>Alias: 
                    <input type="text" id="aliasInput" style="width:150px;">
                </label>
                <button id="aliasSaveBtn">Speichern</button>
                <button id="aliasClearBtn">Löschen</button>
            `;
            menuMembersList.appendChild(aliasLi);
        
            // Pin / Archiv Buttons
            const actionsLi = document.createElement("li");
            actionsLi.innerHTML = `
                <button id="pinBtn">⭐ An-/Abpinnen</button>
                <button id="archBtn" style="margin-left:8px;">📁 Archivieren / Zurückholen</button>
            `;
            menuMembersList.appendChild(actionsLi);
        
            // Alias des Kontakts vorbefüllen
           // fetch(`get_single_alias.php?target_id=${chatId}`)
           //     .then(r => r.json())
           //     .then(a => {
           //         const inp = document.getElementById('aliasInput');
           //         if (a && a.alias) inp.value = a.alias;
           //     });
            
            // Alias speichern
            document.getElementById('aliasSaveBtn').onclick = () => {
                const val = document.getElementById('aliasInput').value.trim();
                const fd = new URLSearchParams();
                fd.append('target_id', chatId);
                fd.append('action', 'alias');
                fd.append('alias', val);
            
                fetch('api/user/toggle_contact.php', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/x-www-form-urlencoded'},
                    body: fd.toString()
                }).then(() => {
                    refreshContacts();
                    chatMenu.style.display = "none";
                });
            };
            // Alias löschen
            document.getElementById('aliasClearBtn').onclick = () => {
                const fd = new URLSearchParams();
                fd.append('target_id', chatId);
                fd.append('action', 'alias');
                fd.append('alias', '');              // leer ⇒ löschen
            
                fetch('api/user/toggle_contact.php', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/x-www-form-urlencoded'},
                    body: fd.toString()
                }).then(() => {
                    refreshContacts();
                    chatMenu.style.display = "none";
                });
            };

        
            // Pin / Archiv toggeln
            document.getElementById('pinBtn').onclick = () => toggleContact(chatId, 'pin');
            document.getElementById('archBtn').onclick = () => toggleContact(chatId, 'archive');
        }
    chatMenu.style.display = "block";
}



function linkify(text) {
    if (!text) return "";
    return text.replace(/(^|\s)((https?:\/\/|www\.)\S+)/gi, function(match, space, url) {
        let href = url;
        if (!href.match(/^https?:\/\//i)) {
            href = "http://" + href;
        }
        return space + '<a href="' + href + '" target="_blank" rel="noopener noreferrer">' + url + '</a>';
    });
}

const imageInput  = document.getElementById('imageInput');
const addImageBtn = document.getElementById('addImageBtn');

addImageBtn.addEventListener('click', () => {
    imageInput.click();
});

imageInput.addEventListener('change', () => {
  if (!imageInput.files.length) return;
  const file = imageInput.files[0];

  const formData = new FormData();
  formData.append('file', file);
  formData.append('receiver_id', currentChat);
  formData.append('type', currentType);

    fetch('api/misc/upload_file.php', {
        method: 'POST',
        body: formData
    })
    .then(r => r.text())
    .then(text => {
        console.log('UPLOAD RESPONSE:', text);
        try {
            const res = JSON.parse(text);
            if (!res.ok) {
                alert('Upload-Fehler: ' + res.error);
                return;
            }
            imageInput.value = "";
            pollNewMessages();
        } catch(e) {
            alert('Serverfehler: ' + text);
        }
    })
    .catch(err => {
        console.error(err);
        alert('Netzwerkfehler beim Upload');
    }); 
});

function toggleContact(id, action) {
    const fd = new URLSearchParams();
    fd.append('target_id', id);
    fd.append('action', action); // 'pin' oder 'archive'

    fetch('api/user/toggle_contact.php', {
        method: 'POST',
        headers: {'Content-Type': 'application/x-www-form-urlencoded'},
        body: fd.toString()
    }).then(() => {
        refreshContacts();
        chatMenu.style.display = "none";
    });
}

function markCurrentChatAsRead() {
  if (!currentChat) return;

  fetch(`api/chat/mark_read.php?user_id=${currentChat}`)
    .then(() => {
      document.querySelectorAll('.message.unread').forEach(msg => {
        msg.classList.remove('unread');
        msg.classList.add('read');
      });
    });
}

function clearNotificationsForChat(chatId, type = 'user') {
  if (!navigator.serviceWorker) return;

  navigator.serviceWorker.getRegistrations().then(regs => {
    regs.forEach(reg => {
      reg.getNotifications().then(notifications => {
        notifications.forEach(n => {
          if (
            n.data &&
            n.data.chat == chatId &&
            n.data.type === type
          ) {
            n.close();
          }
        });
      });
    });
  });
}

document.addEventListener("visibilitychange", () => {
  notifySWChatState();

  if (!document.hidden) {
    markCurrentChatAsRead();
    clearNotificationsForChat(currentChat, currentType);
  }
});

// Lesebestaetigungen werden jetzt vom Sync-Response mitgeliefert (data.readIds)


function loadOlderMessages() {
  // Guards: kein Doppel-Load, nicht über den Anfang hinaus, nicht beim Öffnen
  if (loadingOlder || reachedTop || initialLoading) return;

  const chatId = currentChat;
  const chatType = currentType;
  const firstMsg = chatbox.querySelector('.message[data-id]');
  if (!firstMsg) return;

  loadingOlder = true;
  updateLoadOlderBtn();

  const oldHeight = chatbox.scrollHeight;
  const oldScrollTop = chatbox.scrollTop;
  const endpoint = chatType === 'user' ? 'api/chat/get_messages.php?user_id=' : 'api/group/get_group_messages.php?group_id=';
  const beforeId = parseInt(firstMsg.dataset.id, 10);

  fetch(`${endpoint}${chatId}&before_id=${beforeId}&limit=${OLDER_LIMIT + 1}`)
    .then(r => {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    })
    .then(messages => {
      if (chatId !== currentChat || chatType !== currentType) return;
      if (!Array.isArray(messages)) return;
      if (messages.length === 0) {
        reachedTop = true;
        return;
      }
      // +1-Trick: weniger als OLDER_LIMIT+1 => Anfang erreicht.
      // Mehr => nur die NEUESTEN OLDER_LIMIT behalten (Liste ist ASC).
      if (messages.length <= OLDER_LIMIT) {
        reachedTop = true;
      } else {
        messages = messages.slice(messages.length - OLDER_LIMIT);
      }

      prependMessages(messages);
      // Scrollposition exakt halten (Inhalt wächst nur nach oben)
      chatbox.scrollTop = oldScrollTop + (chatbox.scrollHeight - oldHeight);

      // Falls die Box immer noch keinen Scrollbalken hat -> weiterladen
      maybeAutoLoadOlder();
    })
    .catch(err => {
      console.error("Ältere Nachrichten laden fehlgeschlagen", err);
    })
    .finally(() => {
      if (chatId === currentChat && chatType === currentType) {
        loadingOlder = false;
        updateLoadOlderBtn();
      }
    });
}



/*ZULEZT ONLINE*/

function formatLastSeen(seconds, lastSeenTs) {
  if (!lastSeenTs || seconds == null) return "–";

  if (seconds < 60) return "gerade eben";
  if (seconds < 1800) {
    return "vor " + Math.floor(seconds / 60) + " Min";
  }

  const d = new Date(lastSeenTs * 1000);
  const now = new Date();

  const sameDay =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();

  const hour = d.getHours().toString().padStart(2, "0") + ":" +
               d.getMinutes().toString().padStart(2, "0");

  if (sameDay) {
    return hour;
  }

  return `${d.getDate()}.${d.getMonth() + 1} · ${hour}`;
}




// Rendert Partner-Status aus dem Sync-Response (data.partner)
function renderUserStatus(partner) {
  const el = document.getElementById("userStatus");
  if (!el) return;

  if (partner.online) {
    el.innerHTML = "🟢 online";
    return;
  }

  const text = formatLastSeen(partner.seconds, partner.lastSeenTs);
  el.innerHTML = "⚪ zuletzt gesehen " + text;
}



/*=== Nachicht bearbeiten/löschen ===*/

let activeMsgMenu = null;

chatbox.addEventListener("click", e => {
  const msg = e.target.closest(".message.me");
  if (!msg) return;
  if (msg.classList.contains("deleted")) return;

  e.stopPropagation();
  openMsgMenu(msg);
});


function openMsgMenu(msg) {
  closeMsgMenu();

  const id = msg.dataset.id;
  if (!id) return;

  const menu = document.createElement("div");
  menu.className = "msg-menu";
  menu.innerHTML = `
    <button onclick="editMessage(${id})">✏️ Bearbeiten</button>
    <button onclick="deleteMessage(${id})">🗑️ Löschen</button>
  `;

  msg.appendChild(menu);
  activeMsgMenu = menu;
}

function closeMsgMenu() {
  if (activeMsgMenu) {
    activeMsgMenu.remove();
    activeMsgMenu = null;
  }
}

document.addEventListener("click", e => {
  if (!e.target.closest(".msg-menu")) {
    closeMsgMenu();
  }
});

function editMessage(id) {
  const msg = document.getElementById("msg_" + id);
  if (!msg) return;

  const textEl = msg.querySelector(".msg-main");
  if (!textEl) return;

  const old = textEl.innerText.trim();

  const neu = prompt("Nachricht bearbeiten:", old);
  if (!neu || neu.trim() === old.trim()) return;

  const endpoint = currentType === 'group' ? "api/group/edit_group_message.php" : "api/chat/edit_message.php";

  fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message_id: id,
      text: neu.trim()
    })
  }).then(r => r.json())
    .then(res => {
      if (res.ok) {
        // Nutzereingabe escapen, bevor sie per innerHTML gerendert wird (XSS-Schutz)
        const safeText = neu.trim().replace(/[&<>"']/g, c => ({
          '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));
        textEl.innerHTML = linkify(safeText);
        const status = msg.querySelector(".msg-status");
        if (status && status.textContent.indexOf("✏️") === -1) {
          status.textContent = "✏️ " + status.textContent;
        }
      } else {
        alert("Bearbeiten fehlgeschlagen.");
      }
    })
    .catch(() => alert("Netzwerkfehler beim Bearbeiten."));
}

function deleteMessage(id) {
  if (!confirm("Nachricht wirklich löschen?")) return;

  const endpoint = currentType === 'group' ? "api/group/delete_group_message.php" : "api/chat/delete_message.php";

  fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message_id: id })
  })
  .then(r => r.json())
  .then(res => {
    if (!res.ok) {
      alert("Löschen fehlgeschlagen.");
      return;
    }

    const msg = document.getElementById("msg_" + id);
    if (!msg) return;

    msg.classList.add("deleted");

    const main = msg.querySelector(".msg-main");
    if (main) {
      main.innerHTML = '<span class="msg-deleted">Nachricht gelöscht</span>';
    }

    const status = msg.querySelector(".msg-status");
    if (status) status.innerHTML = "";
  })
  .catch(() => alert("Netzwerkfehler beim Löschen."));
}



/*=== GIFS ===*/

// === Toast-Benachrichtigung (leichtgewichtig, kein alert()) ===
function showToast(msg, duration = 3500) {
  let toast = document.getElementById('_gc_toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = '_gc_toast';
    toast.style.cssText = [
      'position:fixed', 'bottom:24px', 'left:50%', 'transform:translateX(-50%)',
      'background:#1c1c1e', 'color:#f4f4f5', 'border:1px solid rgba(255,255,255,.12)',
      'border-radius:10px', 'padding:10px 18px', 'font-size:.9rem',
      'box-shadow:0 8px 24px rgba(0,0,0,.5)', 'z-index:99999',
      'max-width:90vw', 'text-align:center',
      'opacity:0', 'transition:opacity .2s ease',
      'pointer-events:none'
    ].join(';');
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.opacity = '1';
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { toast.style.opacity = '0'; }, duration);
}

const API_KEY = ""; // set your Giphy API key

const gifBtn        = document.getElementById("gifBtn");
const gifOverlay    = document.getElementById("gifOverlay");
const gifSearch     = document.getElementById("gifSearchOverlay");
const gifResults    = document.getElementById("gifResultsOverlay");
const gifClose      = document.getElementById("gifClose");

/* Overlay öffnen */
gifBtn.addEventListener("click", () => {
  gifOverlay.style.display = "flex";
  gifSearch.value = "";
  gifResults.innerHTML = "";
  setTimeout(() => gifSearch.focus(), 100);
});

/* Overlay schließen (X) */
gifClose.addEventListener("click", () => {
  gifOverlay.style.display = "none";
});

/* Overlay schließen bei Klick auf dunklen Hintergrund */
gifOverlay.addEventListener("click", (e) => {
  if (e.target === gifOverlay) {
    gifOverlay.style.display = "none";
  }
});

/* GIF suchen */
gifSearch.addEventListener("input", async () => {
  const q = gifSearch.value.trim();
  if (q.length < 2) return;

  try {
    const res = await fetch(
      `https://api.giphy.com/v1/gifs/search?api_key=${API_KEY}&q=${encodeURIComponent(q)}&limit=20`
    );
    const data = await res.json();

    gifResults.innerHTML = "";

    data.data.forEach(gif => {
      const img = document.createElement("img");
      img.src = gif.images.fixed_height.url;
      img.alt = "GIF";

      img.addEventListener("click", () => {
        sendGIF(gif.images.original.url);
        gifOverlay.style.display = "none";
      });

      gifResults.appendChild(img);
    });

  } catch (err) {
    console.error("GIF SEARCH ERROR", err);
  }
});

/* GIF senden */
function sendGIF(url) {
  const isGroup = currentType === 'group';

  fetch(isGroup ? "api/group/send_group_message.php" : "api/chat/send_message.php", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "gif",
      gif_url: url,
      ...(isGroup ? { group_id: currentChat } : { receiver_id: currentChat })
    })
  })
  .then(r => r.json())
  .then(res => {
    if (res.ok) {
      pollNewMessages();
    } else {
      console.error("GIF SEND FAIL", res);
    }
  })
  .catch(err => console.error("GIF SEND ERROR", err));
}





/*NOTIZEN*/ 

function openNotes(){
  fetch("api/misc/get_notes.php")
    .then(r=>r.json())
    .then(d=>{
      document.getElementById("notesText").value = d.content || "";
      document.getElementById("notesOverlay").style.display = "block";
    })
    .catch(() => showToast("Notizen konnten nicht geladen werden."));
}

function closeNotes(){
  document.getElementById("notesOverlay").style.display = "none";
}

function saveNotes(){
  const fd = new FormData();
  fd.append("content", document.getElementById("notesText").value);

  fetch("api/misc/save_notes.php", { method:"POST", body: fd })
    .then(()=> closeNotes());
}



/* BENACHICHTIGUNGEN AKIVIEREN REMINDER*/

function isIosSafari() {
  const ua = navigator.userAgent;
  const isIOS = /iPhone|iPad|iPod/i.test(ua);
  const isSafari = /^((?!chrome|android).)*safari/i.test(ua);
  return isIOS && isSafari && !isStandalone();
}

async function isPushEnabled() {
  if (!("serviceWorker" in navigator)) return false;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  return !!sub;
}
function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true; // iOS
}
function showInstallTutorial() {
  alert(
    "📲 So fügst du Gigachat hinzu:\n\n" +
    "iPhone / iPad:\n" +
    "• Teilen-Button unten\n" +
    "• ‚Zum Home-Bildschirm‘\n\n" +
    "Android:\n" +
    "• ⋮ Menü\n" +
    "• ‚App installieren‘"
  );
}
function notifySWChatState() {
  if (!navigator.serviceWorker?.controller) return;

  navigator.serviceWorker.controller.postMessage({
    type: "CHAT_STATE",
    chatId: currentChat,
    visible: !document.hidden
  });
}

// Timing-fix: wartet, bis der SW das aktive Control hat, und sendet danach
// sofort – verhindert, dass Push im gerade sichtbaren Chat vibriert.
async function syncSWChatState() {
  if (!('serviceWorker' in navigator)) return;
  await swReady;
  notifySWChatState();
}

document.addEventListener("DOMContentLoaded", async () => {

  const modal = document.getElementById("push-modal");
  const text  = document.getElementById("push-text");
  const btn   = document.getElementById("push-action");
  const close = document.getElementById("push-close");

  if (!modal || !btn || !text || !close) return;

  // Nicht öfter als 1x pro Tag nerven
  const lastShown = localStorage.getItem("push_hint_day");
  const today = new Date().toISOString().slice(0,10);

  if (lastShown === today) return;

  const pushEnabled = await isPushEnabled();

  if (pushEnabled) return;

  modal.style.display = "flex";
  localStorage.setItem("push_hint_day", today);

  if (isStandalone() && !isIosSafari()) {
    // ✅ Web-App → Push aktivieren
    text.textContent = "Aktiviere Benachrichtigungen, damit du neue Nachrichten sofort bekommst – auch wenn die App geschlossen ist.";
    btn.textContent = "Benachrichtigungen aktivieren";

    btn.onclick = async () => {
      await subscribeForPush();
      modal.style.display = "none";
    };
  } else {
    // ❌ Safari / Browser ohne Web-App
    text.innerHTML = `
      Für Benachrichtigungen musst du Gigachat als App hinzufügen:
      <br><br>
      📲 <b>iPhone / iPad</b><br>
      • Teilen-Button<br>
      • „Zum Home-Bildschirm“
      <br><br>
      🤖 <b>Android</b><br>
      • ⋮ Menü<br>
      • „App installieren“
    `;
    btn.textContent = "So geht’s";

    btn.onclick = () => {
      showInstallTutorial();
    };
  }

  close.onclick = () => {
    modal.style.display = "none";
  };
});

navigator.serviceWorker?.addEventListener("message", event => {
  if (event.data?.type !== "OPEN_CHAT") return;

  const { chatId, chatType } = event.data;

  const tryOpen = () => {
    const el = document.querySelector(
      `.users-list li[data-id="${chatId}"][data-type="${chatType}"] .user-btn`
    );

    if (el) {
      el.click();
    } else {
      // nochmal versuchen (Kontakte laden async)
      setTimeout(tryOpen, 100);
    }
  };

  tryOpen();
});




// ==== Konfetti + Release-Banner ====

function showReleaseBanner() {
  // 1) Konfetti für ca. 1.5 Sekunden
  const duration = 1500;
  const end = Date.now() + duration;

  (function frame() {
    confetti({
      particleCount: 5,
      angle: 60,
      spread: 55,
      origin: { x: 0 }
    });
    confetti({
      particleCount: 5,
      angle: 120,
      spread: 55,
      origin: { x: 1 }
    });
    if (Date.now() < end) {
      requestAnimationFrame(frame);
    }
  })();

  // 2) Banner-Element bauen
const banner = document.createElement('div');
banner.id = 'gigaToast';
banner.innerHTML = `
  <div class="giga-toast-main">
    <span class="giga-toast-title">🎉 GigaChat 3.0 ist draußen!</span>

    <div class="giga-toast-actions">
      <button class="giga-toast-more">Was ist neu?</button>
      <a href="release-notes-3.0.html" class="giga-toast-release" target="_self">
        Release Notes
      </a>
      <button class="giga-toast-close">&times;</button>
    </div>
  </div>

  <div class="giga-toast-details">
    <p><strong>Neu & verbessert in 3.0:</strong></p>
    <ul class="giga-toast-list">
      <li>📝 <strong>Notizen-Tool</strong> (neu)</li>
      <li>🟢 <strong>Online-Status & zuletzt online</strong></li>
      <li>👁️ <strong>Lesebestätigung</strong> im Chat</li>
      <li>💬 <strong>Direkt auf Nachrichten antworten</strong> 
        <span class="hint">(nicht auf iOS)</span>
      </li>
      <li>🎉 <strong>GIFs verschicken</strong></li>
      <li>📩 Mitteilungen verschwinden korrekt beim Öffnen</li>
      <li>🔔 Push-Benachrichtigungen gefixt 
        <span class="hint">(kein Fake-„gelesen“ mehr)</span>
      </li>
      <li>📱 Handy-Version deutlich verbessert</li>
      <li>👥 Gruppen erstellen & verwalten – schöner & stabiler</li>
      <li>📊 Statistik & Einstellungen überarbeitet</li>
    </ul>

    <p class="hint">
      👉 Alle Details findest du in den vollständigen Release Notes.
    </p>


    <div class="giga-toast-links">
      <a href="release-notes-3.0.html" target="_self">📄 Release Notes öffnen</a>
    </div>
  </div>
`;

  document.body.appendChild(banner);

  const moreBtn   = banner.querySelector('.giga-toast-more');
  const closeBtn  = banner.querySelector('.giga-toast-close');
  const details   = banner.querySelector('.giga-toast-details');


  let pinnedOpen = false;

  // 3) Auto-Hide nach 10s, falls NICHT auf "Mehr Infos" geklickt
  const autoTimer = setTimeout(() => {
    if (!pinnedOpen) {
      banner.classList.add('giga-toast-hide');
      setTimeout(() => banner.remove(), 500);
    }
  }, 10000);

  // Mehr Infos: Details anzeigen und Auto-Hide deaktivieren
  moreBtn.addEventListener('click', () => {
    pinnedOpen = true;
    clearTimeout(autoTimer);
    details.classList.toggle('giga-toast-details-open');
  });

  // Schließen-Button: immer direkt schließen
  closeBtn.addEventListener('click', () => {
    banner.classList.add('giga-toast-hide');
    setTimeout(() => banner.remove(), 500);
  });
}
