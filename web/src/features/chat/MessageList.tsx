import { ROLES, type Message } from '@gigachat/shared';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownIcon, CopyIcon, EditIcon, InfoIcon, TrashIcon } from '../../components/icons';
import { Confirm, ContextMenu, Sheet, Spinner, type MenuItem } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { dayKey, fmtDateTime, fmtDay } from '../../lib/format';
import { useStore, type PendingMessage } from '../../lib/store';
import { MessageBubble, PendingBubble } from './MessageBubble';

type Row =
  | { type: 'day'; key: string; label: string }
  | { type: 'msg'; key: string; m: Message; first: boolean; last: boolean }
  | { type: 'system'; key: string; m: Message };

const GROUP_GAP_MS = 5 * 60_000;

function buildRows(messages: Message[]): Row[] {
  const rows: Row[] = [];
  let lastDay = '';
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const dk = dayKey(m.createdAt);
    if (dk !== lastDay) {
      rows.push({ type: 'day', key: `day-${dk}`, label: fmtDay(m.createdAt) });
      lastDay = dk;
    }
    if (m.kind === 'system') {
      rows.push({ type: 'system', key: `m-${m.id}`, m });
      continue;
    }
    const prev = messages[i - 1];
    const next = messages[i + 1];
    const sameAsPrev = !!prev && prev.kind !== 'system' && prev.senderId === m.senderId && dayKey(prev.createdAt) === dk && Date.parse(m.createdAt) - Date.parse(prev.createdAt) < GROUP_GAP_MS;
    const sameAsNext = !!next && next.kind !== 'system' && next.senderId === m.senderId && dayKey(next.createdAt) === dk && Date.parse(next.createdAt) - Date.parse(m.createdAt) < GROUP_GAP_MS;
    rows.push({ type: 'msg', key: `m-${m.id}`, m, first: !sameAsPrev, last: !sameAsNext });
  }
  return rows;
}

export function MessageList({ conversationId }: { conversationId: number }) {
  const conv = useStore((s) => s.conversations[conversationId])!;
  const me = useStore((s) => s.me)!;
  const typing = useStore((s) => s.typing[conversationId]);
  const toast = useStore((s) => s.toast);
  const loadOlder = useStore((s) => s.loadOlder);
  const scroller = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [unseen, setUnseen] = useState(0);
  const [menu, setMenu] = useState<{ x: number; y: number; m: Message } | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [deleting, setDeleting] = useState<Message | null>(null);
  const [infoMsg, setInfoMsg] = useState<Message | null>(null);
  const [viewer, setViewer] = useState<string | null>(null);
  const prevFirstId = useRef<number | null>(null);
  const prevHeight = useRef(0);
  const prevCount = useRef(0);
  const pendingFirst = useRef(true);

  const rows = useMemo(() => buildRows(conv.messages), [conv.messages]);
  const members = conv.detail?.members ?? [];
  const isGroup = conv.detail?.kind === 'group';
  const extended = me.role >= ROLES.BETA;

  const scrollToBottom = useCallback((smooth = false) => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  // Keep the viewport stable when older messages are prepended; follow new ones when at bottom.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const first = conv.messages[0]?.id ?? null;
    const count = conv.messages.length + conv.pending.length;
    if (pendingFirst.current && conv.messages.length) {
      pendingFirst.current = false;
      el.scrollTop = el.scrollHeight;
    } else if (prevFirstId.current !== null && first !== null && first < prevFirstId.current) {
      el.scrollTop += el.scrollHeight - prevHeight.current;
    } else if (count > prevCount.current) {
      const last = conv.messages.at(-1);
      const mine = last?.senderId === me.id || conv.pending.length > 0;
      if (atBottom || mine) requestAnimationFrame(() => scrollToBottom(count - prevCount.current === 1));
      else setUnseen((n) => n + (count - prevCount.current));
    }
    prevFirstId.current = first;
    prevHeight.current = el.scrollHeight;
    prevCount.current = count;
  }, [conv.messages, conv.pending, atBottom, me.id, scrollToBottom]);

  // Scroll tracking.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
        const bottom = dist < 80;
        setAtBottom(bottom);
        if (bottom) setUnseen(0);
      });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  // Infinite scroll upwards.
  useEffect(() => {
    const sentinel = topRef.current;
    const root = scroller.current;
    if (!sentinel || !root) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && conv.hasMore && !conv.loading) void loadOlder(conversationId);
      },
      { root, rootMargin: '200px 0px 0px 0px' },
    );
    io.observe(sentinel);
    return () => io.disconnect();
  }, [conv.hasMore, conv.loading, conversationId, loadOlder]);

  // Images loading late can push content; stick to bottom while we are there.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onLoad = (e: Event) => {
      if ((e.target as HTMLElement).tagName === 'IMG' && atBottom) scrollToBottom();
    };
    el.addEventListener('load', onLoad, true);
    return () => el.removeEventListener('load', onLoad, true);
  }, [atBottom, scrollToBottom]);

  const typists = typing
    ? Object.entries(typing).filter(([uid, ts]) => Number(uid) !== me.id && Date.now() - ts < 4000).map(([uid]) => members.find((m) => m.userId === Number(uid)))
    : [];

  const openMenu = (m: Message, x: number, y: number) => setMenu({ x, y, m });

  const menuItems = (m: Message): MenuItem[] => {
    const mine = m.senderId === me.id;
    const items: MenuItem[] = [];
    if (m.kind === 'text' && !m.deletedAt) {
      items.push({ label: 'Kopieren', icon: <CopyIcon />, onClick: () => navigator.clipboard?.writeText(m.body).then(() => toast('Kopiert')) });
    }
    if (mine && m.kind === 'text' && !m.deletedAt) items.push({ label: 'Bearbeiten', icon: <EditIcon />, onClick: () => setEditing(m) });
    items.push({ label: 'Details', icon: <InfoIcon />, onClick: () => setInfoMsg(m) });
    if ((mine || me.role >= ROLES.ADMIN) && !m.deletedAt) items.push({ label: 'Löschen', icon: <TrashIcon />, danger: true, onClick: () => setDeleting(m) });
    return items;
  };

  const retryPending = async (p: PendingMessage) => {
    const s = useStore.getState();
    s.resolvePending(conversationId, p.clientId);
    s.addPending(conversationId, { ...p, failed: false });
    try {
      await api.post(`/api/conversations/${conversationId}/messages`, { kind: 'text', body: p.body, clientId: p.clientId });
      useStore.getState().resolvePending(conversationId, p.clientId);
    } catch (e) {
      useStore.getState().resolvePending(conversationId, p.clientId, true);
      toast(errorMessage(e), 'error');
    }
  };

  return (
    <>
      <div className="messages" ref={scroller}>
        <div className="messages-inner">
          <div ref={topRef} className="sentinel" />
          {conv.loading && conv.hasMore ? <div className="loading-more"><Spinner /></div> : null}
          {!conv.hasMore && conv.messages.length > 0 ? <div className="sys-msg">Anfang der Unterhaltung</div> : null}
          {conv.messages.length === 0 && conv.pending.length === 0 ? (
            <div className="sys-msg" style={{ marginTop: 40 }}>Noch keine Nachrichten. Schreib die erste!</div>
          ) : null}
          {rows.map((r) => {
            if (r.type === 'day') return <div key={r.key} className="day-chip">{r.label}</div>;
            if (r.type === 'system') return <div key={r.key} className="sys-msg">{r.m.body}</div>;
            return (
              <MessageBubble
                key={r.key}
                m={r.m}
                mine={r.m.senderId === me.id}
                first={r.first}
                last={r.last}
                isGroup={!!isGroup}
                members={members}
                meId={me.id}
                extended={extended}
                onMenu={openMenu}
                onImage={setViewer}
              />
            );
          })}
          {conv.pending.map((p) => (
            <PendingBubble key={p.clientId} p={p} onRetry={() => retryPending(p)} />
          ))}
          {typists.length ? (
            <div className="typing-row">
              <span className="typing-dots"><i /><i /><i /></span>
              {isGroup ? `${typists.map((t) => t?.alias?.trim() || t?.username).filter(Boolean).join(', ')} schreibt…` : 'schreibt…'}
            </div>
          ) : null}
        </div>
      </div>

      <button className={`jump ${atBottom ? 'hidden' : ''}`} onClick={() => { scrollToBottom(true); setUnseen(0); }} aria-label="Zur neuesten Nachricht">
        <ArrowDownIcon />
        {unseen > 0 ? `${unseen} neu` : 'Neueste'}
      </button>

      {menu ? <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.m)} info={fmtDateTime(menu.m.createdAt)} onClose={() => setMenu(null)} /> : null}
      {editing ? <EditSheet m={editing} onClose={() => setEditing(null)} /> : null}
      {deleting ? (
        <Confirm
          title="Nachricht löschen?"
          text="Die Nachricht wird für alle als gelöscht markiert. Das lässt sich nicht rückgängig machen."
          confirmLabel="Löschen"
          danger
          onClose={() => setDeleting(null)}
          onConfirm={() => api.delete(`/api/messages/${deleting.id}`).catch((e) => toast(errorMessage(e), 'error'))}
        />
      ) : null}
      {infoMsg ? <MessageInfo m={infoMsg} members={members} meId={me.id} isGroup={!!isGroup} onClose={() => setInfoMsg(null)} /> : null}
      {viewer ? <ImageViewer src={viewer} onClose={() => setViewer(null)} /> : null}
    </>
  );
}

function EditSheet({ m, onClose }: { m: Message; onClose: () => void }) {
  const [text, setText] = useState(m.body);
  const [busy, setBusy] = useState(false);
  const toast = useStore((s) => s.toast);
  const save = async () => {
    if (!text.trim() || text.trim() === m.body) return onClose();
    setBusy(true);
    try {
      await api.patch(`/api/messages/${m.id}`, { body: text.trim() });
      onClose();
    } catch (e) {
      toast(errorMessage(e), 'error');
      setBusy(false);
    }
  };
  return (
    <Sheet title="Nachricht bearbeiten" onClose={onClose}>
      <textarea className="input" value={text} onChange={(e) => setText(e.target.value)} rows={4} autoFocus />
      <div className="inline-actions" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
        <button className="btn" onClick={onClose}>Abbrechen</button>
        <button className="btn btn-primary" onClick={save} disabled={busy}>Speichern</button>
      </div>
    </Sheet>
  );
}

function MessageInfo({ m, members, meId, isGroup, onClose }: { m: Message; members: { userId: number; username: string; alias: string | null; lastReadMessageId: number | null }[]; meId: number; isGroup: boolean; onClose: () => void }) {
  const sender = members.find((x) => x.userId === m.senderId);
  const readers = members.filter((x) => x.userId !== m.senderId && (x.lastReadMessageId ?? 0) >= m.id);
  const unread = members.filter((x) => x.userId !== m.senderId && (x.lastReadMessageId ?? 0) < m.id);
  return (
    <Sheet title="Nachricht" onClose={onClose}>
      <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px 16px', margin: 0 }}>
        <dt className="muted">Von</dt><dd style={{ margin: 0 }}>{m.senderId === meId ? 'Dir' : sender?.alias?.trim() || sender?.username || 'Unbekannt'}</dd>
        <dt className="muted">Gesendet</dt><dd style={{ margin: 0 }} className="num">{fmtDateTime(m.createdAt)}</dd>
        {m.editedAt ? <><dt className="muted">Bearbeitet</dt><dd style={{ margin: 0 }} className="num">{fmtDateTime(m.editedAt)}</dd></> : null}
        {m.deletedAt ? <><dt className="muted">Gelöscht</dt><dd style={{ margin: 0 }} className="num">{fmtDateTime(m.deletedAt)}</dd></> : null}
        <dt className="muted">{isGroup ? 'Gelesen von' : 'Status'}</dt>
        <dd style={{ margin: 0 }}>
          {isGroup ? (readers.length ? readers.map((r) => r.alias?.trim() || r.username).join(', ') : 'noch niemand') : readers.length ? 'Gelesen 👁️' : 'Zugestellt ✔️'}
          {isGroup && unread.length ? <div className="faint small">Ungelesen: {unread.map((r) => r.alias?.trim() || r.username).join(', ')}</div> : null}
        </dd>
      </dl>
    </Sheet>
  );
}

function ImageViewer({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  const download = async () => {
    try {
      const res = await fetch(src, { credentials: 'same-origin' });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = src.split('/').pop() || 'bild';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch {
      window.open(src, '_blank', 'noopener');
    }
  };
  return (
    <div className="viewer" role="dialog" aria-label="Bild">
      <button className="icon-btn close" aria-label="Schließen" onClick={onClose}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
      </button>
      <img src={src} alt="" onClick={onClose} />
      <div className="bar">
        <button className="btn" onClick={download}>Speichern</button>
        <a className="btn" href={src} target="_blank" rel="noopener">In neuem Tab</a>
      </div>
    </div>
  );
}
