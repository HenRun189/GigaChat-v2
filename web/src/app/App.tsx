import { useEffect } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router';
import { Toasts } from '../components/ui';
import { AdminPage } from '../features/admin/AdminPage';
import { LoginPage, RegisterPage } from '../features/auth/AuthPages';
import { BugsPage } from '../features/bugs/BugsPage';
import { ChatRoute, DmResolver } from '../features/chat/ChatRoute';
import { ImpressumPage, DatenschutzPage, ReleaseNotesPage, RoadmapPage } from '../features/legal/StaticPages';
import { NotesPage } from '../features/notes/NotesPage';
import { PlacePage } from '../features/place/PlacePage';
import { SettingsPage } from '../features/settings/SettingsPage';
import { StatsPage } from '../features/stats/StatsPage';
import { api, onUnauthorized } from '../lib/api';
import { syncSubscription } from '../lib/push';
import { useStore } from '../lib/store';
import { startRealtime, stopRealtime } from '../lib/ws';
import { Shell } from './Shell';

function Boot() {
  const authChecked = useStore((s) => s.authChecked);
  const me = useStore((s) => s.me);
  const bootstrap = useStore((s) => s.bootstrap);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    const off = onUnauthorized(() => useStore.getState().setAuth(null));
    return () => {
      off();
    };
  }, []);

  // Realtime + contacts follow the auth state.
  useEffect(() => {
    if (!me) {
      stopRealtime();
      return;
    }
    startRealtime();
    void useStore.getState().loadContacts().catch(() => {});
    void syncSubscription();
    void api.post('/api/stats/visit', { page: 'app' }).catch(() => {});
    return () => stopRealtime();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.id]);

  // Notification click -> open the conversation.
  useEffect(() => {
    const handler = (ev: MessageEvent) => {
      const d = ev.data as { type?: string; url?: string } | undefined;
      if (d?.type === 'OPEN_CONVERSATION' && d.url) navigate(d.url);
    };
    navigator.serviceWorker?.addEventListener('message', handler);
    return () => navigator.serviceWorker?.removeEventListener('message', handler);
  }, [navigate]);

  if (!authChecked) {
    return (
      <div className="splash">
        <span className="wordmark-inline">GigaChat</span>
      </div>
    );
  }

  const publicRoute = location.pathname === '/login' || location.pathname === '/register' || location.pathname.startsWith('/impressum') || location.pathname.startsWith('/datenschutz');
  if (!me && !publicRoute) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (me && (location.pathname === '/login' || location.pathname === '/register')) return <Navigate to="/" replace />;
  return <Outlet />;
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Boot />}>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/impressum" element={<ImpressumPage />} />
          <Route path="/datenschutz" element={<DatenschutzPage />} />
          <Route element={<Shell />}>
            <Route index element={null} />
            <Route path="/c/:id" element={<ChatRoute />} />
            <Route path="/u/:userId" element={<DmResolver />} />
          </Route>
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/notes" element={<NotesPage />} />
          <Route path="/stats" element={<StatsPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/bugs" element={<BugsPage />} />
          <Route path="/place" element={<PlacePage />} />
          <Route path="/release-notes" element={<ReleaseNotesPage />} />
          <Route path="/roadmap" element={<RoadmapPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      <Toasts />
    </BrowserRouter>
  );
}
