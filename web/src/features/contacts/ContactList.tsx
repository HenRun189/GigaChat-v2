import { ROLES, scoreTier, type Contact } from '@gigachat/shared';
import { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { BellIcon, ChevronDownIcon, PinIcon, PlusIcon, SearchIcon, UsersIcon } from '../../components/icons';
import { Avatar, Empty, ScorePill, Spinner, contactAvatarProps } from '../../components/ui';
import { fmtListTime } from '../../lib/format';
import { pushSupport, subscribePush } from '../../lib/push';
import { useStore } from '../../lib/store';

function ContactRow({ c, active, typing }: { c: Contact; active: boolean; typing: boolean }) {
  const navigate = useNavigate();
  const me = useStore((s) => s.me)!;
  const tier = c.kind === 'user' ? scoreTier(c.gigascore, me.role >= ROLES.BETA) : null;
  return (
    <button
      className={`contact ${active ? 'active' : ''} ${c.unread > 0 ? 'unread' : ''}`}
      onClick={() => navigate(c.kind === 'group' ? `/c/${c.id}` : c.conversationId ? `/c/${c.conversationId}` : `/u/${c.id}`)}
    >
      <Avatar {...contactAvatarProps(c)} />
      <div style={{ minWidth: 0 }}>
        <div className="name-row">
          <span className="name truncate">{c.name}</span>
          {tier ? <span title={`${tier.label} · ${c.gigascore}`} aria-label={`GigaScore ${c.gigascore}`} style={{ fontSize: '0.85rem' }}>{tier.emoji}</span> : null}
          {c.pinned ? <PinIcon className="pin" /> : null}
        </div>
        <div className={`preview truncate ${typing ? 'faint' : ''}`} style={typing ? { color: 'var(--accent)' } : undefined}>
          {typing ? 'schreibt…' : c.lastMessagePreview ?? (c.kind === 'group' ? `${c.memberCount ?? 0} Mitglieder` : c.online ? 'online' : 'Sag Hallo 👋')}
        </div>
      </div>
      <div className="meta">
        <span className="num">{fmtListTime(c.lastMessageAt)}</span>
        {c.unread > 0 ? <span className="badge">{c.unread > 99 ? '99+' : c.unread}</span> : <span style={{ height: 20 }} />}
      </div>
    </button>
  );
}

function PushBanner() {
  const config = useStore((s) => s.config);
  const toast = useStore((s) => s.toast);
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem('gc-push-hint') === new Date().toISOString().slice(0, 10) || Notification?.permission === 'granted';
    } catch {
      return true;
    }
  });
  const support = pushSupport();
  if (hidden || !config?.pushEnabled || support === 'unsupported') return null;
  if (typeof Notification !== 'undefined' && Notification.permission === 'denied') return null;

  const dismiss = () => {
    try {
      localStorage.setItem('gc-push-hint', new Date().toISOString().slice(0, 10));
    } catch {
      /* ignore */
    }
    setHidden(true);
  };

  return (
    <div className="push-banner" role="region" aria-label="Benachrichtigungen aktivieren">
      <BellIcon />
      <div className="body">
        <strong>{support === 'install-first' ? 'Als App installieren' : 'Benachrichtigungen aktivieren'}</strong>
        {support === 'install-first'
          ? 'Teilen-Button → „Zum Home-Bildschirm“. Danach bekommst du Push-Nachrichten wie in jeder App.'
          : 'Erfahre sofort, wenn dir jemand schreibt – auch wenn GigaChat geschlossen ist.'}
        <div className="actions">
          {support === 'ok' ? (
            <button
              className="btn btn-primary btn-sm"
              onClick={async () => {
                const r = await subscribePush(config.vapidPublicKey);
                if (r === 'granted') toast('Benachrichtigungen sind an', 'success');
                else if (r === 'denied') toast('Benachrichtigungen wurden abgelehnt', 'error');
                else toast('Aktivieren hat nicht geklappt', 'error');
                dismiss();
              }}
            >
              Aktivieren
            </button>
          ) : null}
          <button className="btn btn-ghost btn-sm" onClick={dismiss}>Später</button>
        </div>
      </div>
    </div>
  );
}

export function ContactList({ onNewGroup }: { onNewGroup: () => void }) {
  const contacts = useStore((s) => s.contacts);
  const loaded = useStore((s) => s.contactsLoaded);
  const typing = useStore((s) => s.typing);
  const me = useStore((s) => s.me)!;
  const location = useLocation();
  const [q, setQ] = useState('');
  const [showArchived, setShowArchived] = useState(false);

  const activeId = location.pathname.startsWith('/c/') ? Number(location.pathname.slice(3)) : null;
  const activeUser = location.pathname.startsWith('/u/') ? Number(location.pathname.slice(3)) : null;

  const { visible, archived } = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = needle
      ? contacts.filter((c) => c.name.toLowerCase().includes(needle) || (c.username ?? '').toLowerCase().includes(needle))
      : contacts;
    return { visible: filtered.filter((c) => !c.archived), archived: filtered.filter((c) => c.archived) };
  }, [contacts, q]);

  const isTyping = (c: Contact) => {
    if (!c.conversationId) return false;
    const t = typing[c.conversationId];
    if (!t) return false;
    const now = Date.now();
    return Object.entries(t).some(([uid, ts]) => Number(uid) !== me.id && now - ts < 4000);
  };

  return (
    <>
      <div className="pane-header">
        <h1>Chats</h1>
        <ScorePill score={me.gigascore} extended={me.role >= ROLES.BETA} />
        <button className="icon-btn" aria-label="Neue Gruppe" title="Neue Gruppe" onClick={onNewGroup}>
          <PlusIcon />
        </button>
      </div>
      <div className="list-tools">
        <label className="search">
          <SearchIcon />
          <input type="search" placeholder="Suchen" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Kontakte durchsuchen" />
        </label>
      </div>
      <PushBanner />
      <div className="pane-body">
        {!loaded ? (
          <div className="loading-more"><Spinner /></div>
        ) : contacts.length === 0 ? (
          <Empty icon={<UsersIcon />} title="Noch niemand hier" text="Sobald sich weitere Leute registrieren, erscheinen sie hier." />
        ) : (
          <div className="contact-list">
            {visible.map((c) => (
              <ContactRow key={`${c.kind}-${c.id}`} c={c} active={(c.kind === 'group' ? c.id === activeId : c.conversationId === activeId || c.id === activeUser)} typing={isTyping(c)} />
            ))}
            {visible.length === 0 && q ? <p className="faint" style={{ padding: 16, textAlign: 'center' }}>Nichts gefunden.</p> : null}
            {archived.length > 0 ? (
              <>
                <div className="section-label">
                  <button className={showArchived ? 'open' : ''} onClick={() => setShowArchived((v) => !v)} aria-expanded={showArchived}>
                    Archiviert ({archived.length}) <ChevronDownIcon />
                  </button>
                </div>
                {showArchived
                  ? archived.map((c) => (
                      <ContactRow key={`${c.kind}-${c.id}`} c={c} active={(c.kind === 'group' ? c.id === activeId : c.conversationId === activeId || c.id === activeUser)} typing={isTyping(c)} />
                    ))
                  : null}
              </>
            ) : null}
          </div>
        )}
      </div>
    </>
  );
}
