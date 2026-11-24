import type { AppConfig, Contact, ConversationDetail, Me, Message, MessagePage, PublicUser } from '@gigachat/shared';
import { create } from 'zustand';
import { api } from './api';

export interface ConversationState {
  detail: ConversationDetail | null;
  messages: Message[];
  hasMore: boolean;
  loaded: boolean;
  loading: boolean;
  /** optimistic messages not yet confirmed */
  pending: PendingMessage[];
}

export interface PendingMessage {
  clientId: string;
  body: string;
  createdAt: string;
  failed?: boolean;
}

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error' | 'success';
}

export type ColorMode = 'system' | 'light' | 'dark';

interface State {
  me: Me | null;
  config: AppConfig | null;
  authChecked: boolean;
  contacts: Contact[];
  contactsLoaded: boolean;
  conversations: Record<number, ConversationState>;
  typing: Record<number, Record<number, number>>;
  activeConversationId: number | null;
  wsStatus: 'idle' | 'connecting' | 'open' | 'closed';
  toasts: Toast[];
  colorMode: ColorMode;
  installPrompt: BeforeInstallPromptEvent | null;

  bootstrap: () => Promise<void>;
  setAuth: (me: Me | null, config?: AppConfig | null) => void;
  updateMe: (patch: Partial<Me>) => void;
  loadContacts: () => Promise<void>;
  openConversation: (id: number) => Promise<void>;
  loadOlder: (id: number) => Promise<void>;
  syncConversation: (id: number) => Promise<void>;
  setActiveConversation: (id: number | null) => void;
  addMessage: (message: Message) => void;
  updateMessage: (message: Message) => void;
  addPending: (conversationId: number, p: PendingMessage) => void;
  resolvePending: (conversationId: number, clientId: string, failed?: boolean) => void;
  setRead: (conversationId: number, userId: number, lastReadMessageId: number) => void;
  setTyping: (conversationId: number, userId: number) => void;
  setPresence: (userId: number, online: boolean, lastSeen: string | null) => void;
  setScores: (scores: Array<{ userId: number; gigascore: number }>) => void;
  setUserUpdated: (user: PublicUser) => void;
  setWsStatus: (s: State['wsStatus']) => void;
  toast: (text: string, kind?: Toast['kind']) => void;
  dismissToast: (id: number) => void;
  setColorMode: (m: ColorMode) => void;
  setInstallPrompt: (e: BeforeInstallPromptEvent | null) => void;
  markConversationRead: (conversationId: number) => Promise<void>;
}

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const emptyConv = (): ConversationState => ({ detail: null, messages: [], hasMore: false, loaded: false, loading: false, pending: [] });

let toastSeq = 0;

function applyMode(mode: ColorMode) {
  const dark = mode === 'dark' || (mode === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.mode = dark ? 'dark' : 'light';
  try {
    localStorage.setItem('gc-mode', mode);
  } catch {
    /* ignore */
  }
}

export function applyTheme(theme: string) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem('gc-theme', theme);
  } catch {
    /* ignore */
  }
}

const storedMode = (): ColorMode => {
  try {
    const m = localStorage.getItem('gc-mode');
    return m === 'light' || m === 'dark' ? m : 'system';
  } catch {
    return 'system';
  }
};

export const useStore = create<State>((set, get) => ({
  me: null,
  config: null,
  authChecked: false,
  contacts: [],
  contactsLoaded: false,
  conversations: {},
  typing: {},
  activeConversationId: null,
  wsStatus: 'idle',
  toasts: [],
  colorMode: storedMode(),
  installPrompt: null,

  async bootstrap() {
    applyMode(get().colorMode);
    try {
      const r = await api.get<{ user: Me; config: AppConfig }>('/api/auth/me');
      get().setAuth(r.user, r.config);
    } catch {
      set({ me: null, authChecked: true });
    }
  },

  setAuth(me, config) {
    if (me) applyTheme(me.theme);
    set({ me, config: config ?? get().config, authChecked: true, ...(me ? {} : { contacts: [], contactsLoaded: false, conversations: {} }) });
  },

  updateMe(patch) {
    const me = get().me;
    if (!me) return;
    const next = { ...me, ...patch };
    if (patch.theme) applyTheme(patch.theme);
    set({ me: next });
  },

  async loadContacts() {
    const r = await api.get<{ contacts: Contact[] }>('/api/contacts');
    set({ contacts: r.contacts, contactsLoaded: true });
  },

  async openConversation(id) {
    const existing = get().conversations[id];
    if (existing?.loaded || existing?.loading) {
      if (existing.loaded) void get().syncConversation(id);
      return;
    }
    set((s) => ({ conversations: { ...s.conversations, [id]: { ...(existing ?? emptyConv()), loading: true } } }));
    try {
      const [d, page] = await Promise.all([
        api.get<{ conversation: ConversationDetail }>(`/api/conversations/${id}`),
        api.get<MessagePage>(`/api/conversations/${id}/messages`),
      ]);
      set((s) => ({
        conversations: {
          ...s.conversations,
          [id]: { detail: d.conversation, messages: page.messages, hasMore: page.hasMore, loaded: true, loading: false, pending: [] },
        },
      }));
    } catch (err) {
      set((s) => ({ conversations: { ...s.conversations, [id]: { ...(s.conversations[id] ?? emptyConv()), loading: false } } }));
      throw err;
    }
  },

  async loadOlder(id) {
    const c = get().conversations[id];
    if (!c || !c.hasMore || c.loading || c.messages.length === 0) return;
    set((s) => ({ conversations: { ...s.conversations, [id]: { ...c, loading: true } } }));
    try {
      const before = c.messages[0].id;
      const page = await api.get<MessagePage>(`/api/conversations/${id}/messages?before=${before}`);
      set((s) => {
        const cur = s.conversations[id];
        const known = new Set(cur.messages.map((m) => m.id));
        const fresh = page.messages.filter((m) => !known.has(m.id));
        return { conversations: { ...s.conversations, [id]: { ...cur, messages: [...fresh, ...cur.messages], hasMore: page.hasMore, loading: false } } };
      });
    } catch {
      set((s) => ({ conversations: { ...s.conversations, [id]: { ...s.conversations[id], loading: false } } }));
    }
  },

  /** After reconnect: fetch messages newer than the last one we have + refresh detail. */
  async syncConversation(id) {
    const c = get().conversations[id];
    if (!c?.loaded) return;
    const last = c.messages.at(-1)?.id ?? 0;
    try {
      const [d, page] = await Promise.all([
        api.get<{ conversation: ConversationDetail }>(`/api/conversations/${id}`),
        api.get<MessagePage>(`/api/conversations/${id}/messages?after=${last}&limit=100`),
      ]);
      set((s) => {
        const cur = s.conversations[id];
        const known = new Set(cur.messages.map((m) => m.id));
        const fresh = page.messages.filter((m) => !known.has(m.id));
        return { conversations: { ...s.conversations, [id]: { ...cur, detail: d.conversation, messages: [...cur.messages, ...fresh] } } };
      });
    } catch {
      /* keep what we have */
    }
  },

  setActiveConversation(id) {
    set({ activeConversationId: id });
  },

  addMessage(message) {
    set((s) => {
      const id = message.conversationId;
      const cur = s.conversations[id];
      const contacts = s.contacts.map((c) => {
        if (c.conversationId !== id) return c;
        const isMine = message.senderId === s.me?.id;
        const isActive = s.activeConversationId === id && document.visibilityState === 'visible';
        return {
          ...c,
          lastMessageAt: message.createdAt,
          lastMessagePreview: previewOf(message),
          unread: isMine || isActive || message.kind === 'system' ? c.unread : c.unread + 1,
        };
      });
      if (!cur?.loaded) return { contacts };
      if (cur.messages.some((m) => m.id === message.id)) return { contacts };
      const pending = message.senderId === s.me?.id ? cur.pending.filter((p) => p.body !== message.body) : cur.pending;
      return { contacts, conversations: { ...s.conversations, [id]: { ...cur, messages: [...cur.messages, message], pending } } };
    });
  },

  updateMessage(message) {
    set((s) => {
      const cur = s.conversations[message.conversationId];
      if (!cur) return {};
      return {
        conversations: {
          ...s.conversations,
          [message.conversationId]: { ...cur, messages: cur.messages.map((m) => (m.id === message.id ? message : m)) },
        },
      };
    });
  },

  addPending(conversationId, p) {
    set((s) => {
      const cur = s.conversations[conversationId] ?? emptyConv();
      return { conversations: { ...s.conversations, [conversationId]: { ...cur, pending: [...cur.pending, p] } } };
    });
  },

  resolvePending(conversationId, clientId, failed) {
    set((s) => {
      const cur = s.conversations[conversationId];
      if (!cur) return {};
      const pending = failed
        ? cur.pending.map((p) => (p.clientId === clientId ? { ...p, failed: true } : p))
        : cur.pending.filter((p) => p.clientId !== clientId);
      return { conversations: { ...s.conversations, [conversationId]: { ...cur, pending } } };
    });
  },

  setRead(conversationId, userId, lastReadMessageId) {
    set((s) => {
      const cur = s.conversations[conversationId];
      if (!cur?.detail) return {};
      const members = cur.detail.members.map((m) =>
        m.userId === userId ? { ...m, lastReadMessageId: Math.max(m.lastReadMessageId ?? 0, lastReadMessageId) } : m,
      );
      return { conversations: { ...s.conversations, [conversationId]: { ...cur, detail: { ...cur.detail, members } } } };
    });
  },

  setTyping(conversationId, userId) {
    set((s) => ({ typing: { ...s.typing, [conversationId]: { ...(s.typing[conversationId] ?? {}), [userId]: Date.now() } } }));
  },

  setPresence(userId, online, lastSeen) {
    set((s) => ({
      contacts: s.contacts.map((c) => (c.kind === 'user' && c.id === userId ? { ...c, online, lastSeen } : c)),
      conversations: mapMembers(s.conversations, userId, (m) => ({ ...m, online, lastSeen })),
    }));
  },

  setScores(scores) {
    const map = new Map(scores.map((x) => [x.userId, x.gigascore]));
    set((s) => ({
      me: s.me && map.has(s.me.id) ? { ...s.me, gigascore: map.get(s.me.id)! } : s.me,
      contacts: s.contacts.map((c) => (c.kind === 'user' && map.has(c.id) ? { ...c, gigascore: map.get(c.id)! } : c)),
      conversations: Object.fromEntries(
        Object.entries(s.conversations).map(([k, v]) => [
          k,
          v.detail
            ? {
                ...v,
                detail: {
                  ...v.detail,
                  members: v.detail.members.map((m) => (map.has(m.userId) ? { ...m, gigascore: map.get(m.userId)! } : m)),
                },
              }
            : v,
        ]),
      ),
    }));
  },

  setUserUpdated(user) {
    set((s) => ({
      contacts: s.contacts.map((c) =>
        c.kind === 'user' && c.id === user.id
          ? { ...c, username: user.username, name: c.alias?.trim() || user.username, color: user.color, emoji: user.emoji, role: user.role, gigascore: user.gigascore }
          : c,
      ),
      conversations: mapMembers(s.conversations, user.id, (m) => ({ ...m, username: user.username, color: user.color, emoji: user.emoji, role: user.role })),
    }));
  },

  setWsStatus(wsStatus) {
    set({ wsStatus });
  },

  toast(text, kind = 'info') {
    const id = ++toastSeq;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, text, kind }] }));
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 5000 : 3000);
  },

  dismissToast(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },

  setColorMode(colorMode) {
    applyMode(colorMode);
    set({ colorMode });
  },

  setInstallPrompt(installPrompt) {
    set({ installPrompt });
  },

  async markConversationRead(conversationId) {
    const s = get();
    const c = s.conversations[conversationId];
    const last = c?.messages.at(-1);
    const contact = s.contacts.find((x) => x.conversationId === conversationId);
    if (contact && contact.unread > 0) {
      set({ contacts: s.contacts.map((x) => (x.conversationId === conversationId ? { ...x, unread: 0 } : x)) });
    }
    if (!last) return;
    if (c.detail && (c.detail.myLastReadMessageId ?? 0) >= last.id) return;
    set((st) => {
      const cur = st.conversations[conversationId];
      return cur?.detail
        ? { conversations: { ...st.conversations, [conversationId]: { ...cur, detail: { ...cur.detail, myLastReadMessageId: last.id } } } }
        : {};
    });
    try {
      await api.post(`/api/conversations/${conversationId}/read`, { lastReadMessageId: last.id });
    } catch {
      /* retried on next change */
    }
  },
}));

function mapMembers(
  conversations: Record<number, ConversationState>,
  userId: number,
  fn: (m: ConversationDetail['members'][number]) => ConversationDetail['members'][number],
): Record<number, ConversationState> {
  let changed = false;
  const out: Record<number, ConversationState> = {};
  for (const [k, v] of Object.entries(conversations)) {
    if (v.detail?.members.some((m) => m.userId === userId)) {
      changed = true;
      out[Number(k)] = { ...v, detail: { ...v.detail, members: v.detail.members.map((m) => (m.userId === userId ? fn(m) : m)) } };
    } else out[Number(k)] = v;
  }
  return changed ? out : conversations;
}

export function previewOf(m: Message): string {
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

matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  const mode = useStore.getState().colorMode;
  if (mode === 'system') applyMode('system');
});
