import { ROLES } from '@gigachat/shared';
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { ChartIcon, ChatIcon, GridIcon, NoteIcon, SettingsIcon, UsersIcon, WifiOffIcon } from '../components/icons';
import { Avatar, Empty, ScoreRing } from '../components/ui';
import { ContactList } from '../features/contacts/ContactList';
import { NewGroupSheet } from '../features/groups/NewGroupSheet';
import { useStore } from '../lib/store';

export function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(() => matchMedia('(max-width: 899px)').matches);
  useEffect(() => {
    const mq = matchMedia('(max-width: 899px)');
    const fn = () => setMobile(mq.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);
  return mobile;
}

export function TabBar() {
  const unread = useStore((s) => s.contacts.reduce((n, c) => n + (c.archived ? 0 : c.unread), 0));
  const me = useStore((s) => s.me);
  return (
    <nav className="tabbar" aria-label="Hauptnavigation">
      <NavLink to="/" end className={({ isActive }) => (isActive ? 'active' : '')} style={{ position: 'relative' }}>
        <ChatIcon />
        Chats
        {unread > 0 ? <span className="badge tab-badge">{unread > 99 ? '99+' : unread}</span> : null}
      </NavLink>
      <NavLink to="/notes" className={({ isActive }) => (isActive ? 'active' : '')}>
        <NoteIcon />
        Notizen
      </NavLink>
      <NavLink to="/place" className={({ isActive }) => (isActive ? 'active' : '')}>
        <GridIcon />
        r/place
      </NavLink>
      <NavLink to="/stats" className={({ isActive }) => (isActive ? 'active' : '')}>
        <ChartIcon />
        Statistik
      </NavLink>
      <NavLink to="/settings" className={({ isActive }) => (isActive ? 'active' : '')}>
        {me ? <Avatar name={me.username} color={me.color} emoji={me.emoji} size="sm" seed={me.id} /> : <SettingsIcon />}
        Ich
      </NavLink>
    </nav>
  );
}

export function OfflineBanner() {
  const ws = useStore((s) => s.wsStatus);
  const [offline, setOffline] = useState(!navigator.onLine);
  useEffect(() => {
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  if (!offline && ws !== 'closed') return null;
  return (
    <div className="net-banner" role="status">
      <WifiOffIcon width={14} height={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />
      {offline ? 'Offline – Nachrichten werden gesendet, sobald du wieder online bist' : 'Verbindung wird wiederhergestellt…'}
    </div>
  );
}

export function Shell() {
  const isMobile = useIsMobile();
  const location = useLocation();
  const navigate = useNavigate();
  const me = useStore((s) => s.me)!;
  const [newGroup, setNewGroup] = useState(false);
  const inChat = location.pathname.startsWith('/c/') || location.pathname.startsWith('/u/');

  if (isMobile) {
    return (
      <>
        <OfflineBanner />
        {inChat ? (
          <div className="shell">
            <Outlet />
          </div>
        ) : (
          <div className="shell">
            <div className="pane list-pane with-tabbar" style={{ height: '100dvh' }}>
              <ContactList onNewGroup={() => setNewGroup(true)} />
            </div>
            <TabBar />
          </div>
        )}
        {newGroup ? <NewGroupSheet onClose={() => setNewGroup(false)} /> : null}
      </>
    );
  }

  return (
    <>
      <OfflineBanner />
      <div className="shell">
        <nav className="rail" aria-label="Hauptnavigation">
          <div className="brand" aria-hidden="true">G</div>
          <NavLink to="/" end className={({ isActive }) => `icon-btn ${isActive || inChat ? 'active' : ''}`} title="Chats" aria-label="Chats">
            <ChatIcon />
          </NavLink>
          <button className="icon-btn" title="Neue Gruppe" aria-label="Neue Gruppe" onClick={() => setNewGroup(true)}>
            <UsersIcon />
          </button>
          <NavLink to="/notes" className={({ isActive }) => `icon-btn ${isActive ? 'active' : ''}`} title="Notizen" aria-label="Notizen">
            <NoteIcon />
          </NavLink>
          <NavLink to="/place" className={({ isActive }) => `icon-btn ${isActive ? 'active' : ''}`} title="r/place" aria-label="r/place">
            <GridIcon />
          </NavLink>
          <NavLink to="/stats" className={({ isActive }) => `icon-btn ${isActive ? 'active' : ''}`} title="Statistik" aria-label="Statistik">
            <ChartIcon />
          </NavLink>
          <div className="spacer" />
          <ScoreRing score={me.gigascore} size={40} extended={me.role >= ROLES.BETA} />
          <button className="icon-btn me" title="Einstellungen" aria-label="Einstellungen" onClick={() => navigate('/settings')}>
            <Avatar name={me.username} color={me.color} emoji={me.emoji} size="sm" seed={me.id} />
          </button>
        </nav>
        <div className="pane list-pane">
          <ContactList onNewGroup={() => setNewGroup(true)} />
        </div>
        <div className="pane chat-pane">
          {inChat ? (
            <Outlet />
          ) : (
            <Empty icon={<ChatIcon />} title="Wähle einen Chat" text="Links findest du alle Leute und Gruppen. Neue Nachrichten erscheinen sofort." />
          )}
        </div>
      </div>
      {newGroup ? <NewGroupSheet onClose={() => setNewGroup(false)} /> : null}
    </>
  );
}

/** Simple page frame with a back button, used by secondary screens. */
export function PageFrame({ title, children, wide, actions }: { title: string; children: React.ReactNode; wide?: boolean; actions?: React.ReactNode }) {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  return (
    <div className={`pane ${isMobile ? 'with-tabbar' : ''}`} style={{ height: '100dvh' }}>
      <OfflineBanner />
      <div className="topbar">
        <button className="icon-btn" aria-label="Zurück" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
        </button>
        <h1>{title}</h1>
        {actions}
      </div>
      <div className="pane-body">
        <div className={`page ${wide ? 'page-wide' : ''}`}>{children}</div>
      </div>
      {isMobile ? <TabBar /> : null}
    </div>
  );
}
