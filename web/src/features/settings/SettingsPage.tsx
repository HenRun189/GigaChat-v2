import { APP_VERSION, PASSWORD_MIN, ROLES, ROLE_LABELS, THEMES, THEME_LABELS, USERNAME_RE, scoreTier, type Me, type Theme } from '@gigachat/shared';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { PageFrame } from '../../app/Shell';
import { BellIcon, BugIcon, ChartIcon, ChevronIcon, DocIcon, DownloadIcon, KeyIcon, LogoutIcon, MapIcon, PaletteIcon, ShieldIcon, TrashIcon, UsersIcon } from '../../components/icons';
import { Avatar, Confirm, ScoreRing, Sheet, Switch } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { currentSubscription, isIOS, isStandalone, pushSupport, subscribePush, unsubscribePush } from '../../lib/push';
import { useStore, type ColorMode } from '../../lib/store';
import { stopRealtime } from '../../lib/ws';

const THEME_SWATCH: Record<Theme, string> = {
  default: 'linear-gradient(135deg,#6d7cff,#3a47c9)',
  purple: 'linear-gradient(135deg,#a78bfa,#6d28d9)',
  ocean: 'linear-gradient(135deg,#38bdf8,#0369a1)',
  forest: 'linear-gradient(135deg,#4ade80,#15803d)',
  sunset: 'linear-gradient(135deg,#fb7185,#be123c)',
  cyber: 'linear-gradient(135deg,#19e3ff,#0f6fa8)',
  midnight_cherry: 'linear-gradient(135deg,#f0405f,#7f1d1d)',
  aurora_borealis: 'linear-gradient(135deg,#22d3ee,#0e7490)',
};

const EMOJIS = ['😎', '🔥', '🌙', '⚡', '🦊', '🐸', '🍕', '🎮', '🎧', '🏀', '⚽', '🚀', '🌈', '🐼', '🦄', '👾', '🍀', '💎', '🎸', '🧠'];

export function SettingsPage() {
  const me = useStore((s) => s.me)!;
  return (
    <PageFrame title="Einstellungen">
      <ProfileSection me={me} />
      <AppearanceSection me={me} />
      <NotificationSection />
      <MoreSection me={me} />
      <AccountSection />
      <p className="faint small" style={{ textAlign: 'center', marginTop: 28 }}>
        GigaChat {APP_VERSION} · <Link to="/release-notes">Was ist neu</Link> · <Link to="/impressum">Impressum</Link> · <Link to="/datenschutz">Datenschutz</Link>
      </p>
    </PageFrame>
  );
}

function ProfileSection({ me }: { me: Me }) {
  const [username, setUsername] = useState(me.username);
  const [color, setColor] = useState(me.color ?? '#6d7cff');
  const [useColor, setUseColor] = useState(!!me.color);
  const [emoji, setEmoji] = useState(me.emoji ?? '');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const updateMe = useStore((s) => s.updateMe);
  const tier = scoreTier(me.gigascore, me.role >= ROLES.BETA);
  const dirty = username !== me.username || (useColor ? color : null) !== (me.color ?? null) || (emoji || null) !== (me.emoji ?? null);

  const save = async () => {
    if (!USERNAME_RE.test(username.trim())) return setMsg({ ok: false, text: 'Benutzername: 3–30 Zeichen, nur Buchstaben, Zahlen, . _ -' });
    try {
      const r = await api.patch<{ user: Me }>('/api/users/me', { username: username.trim(), color: useColor ? color : null, emoji: emoji.trim() || null });
      updateMe(r.user);
      setMsg({ ok: true, text: 'Profil gespeichert' });
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e) });
    }
  };

  return (
    <section>
      <div className="group-list">
        <div className="profile-hero">
          <Avatar name={username || me.username} color={useColor ? color : null} emoji={emoji || null} size="lg" seed={me.id} />
          <div className="who">
            <div className="n">{me.username}</div>
            <div className="r">{ROLE_LABELS[me.role]} · {tier.emoji} {tier.label}</div>
          </div>
          <ScoreRing score={me.gigascore} size={56} extended={me.role >= ROLES.BETA} />
        </div>
        <div style={{ padding: '4px 16px 16px', display: 'grid', gap: 14 }}>
          <div className="field">
            <label htmlFor="s-user">Benutzername</label>
            <input id="s-user" className="input" value={username} maxLength={30} autoCapitalize="none" onChange={(e) => setUsername(e.target.value)} />
          </div>
          <div className="field">
            <label>Namensfarbe</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Switch checked={useColor} onChange={setUseColor} label="Eigene Farbe verwenden" />
              <input type="color" value={color} onChange={(e) => setColor(e.target.value)} disabled={!useColor} aria-label="Farbe wählen" style={{ width: 44, height: 36, border: 0, background: 'transparent', opacity: useColor ? 1 : 0.4 }} />
              <span className="hint">{useColor ? 'So erscheint dein Name bei anderen.' : 'Automatische Farbe'}</span>
            </div>
          </div>
          <div className="field">
            <label htmlFor="s-emoji">Emoji vor deinem Namen</label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input id="s-emoji" className="input" style={{ width: 90, textAlign: 'center', fontSize: '1.3rem' }} value={emoji} maxLength={4} onChange={(e) => setEmoji(e.target.value)} placeholder="–" />
              <button className="btn btn-ghost btn-sm" onClick={() => setEmoji('')} disabled={!emoji}>Entfernen</button>
            </div>
            <div className="emoji-row" style={{ marginTop: 6 }}>
              {EMOJIS.map((e) => (
                <button key={e} type="button" aria-pressed={emoji === e} onClick={() => setEmoji(e)} aria-label={e}>{e}</button>
              ))}
            </div>
          </div>
          {msg ? <div className={msg.ok ? 'form-ok' : 'form-error'}>{msg.text}</div> : null}
          <div>
            <button className="btn btn-primary" onClick={save} disabled={!dirty}>Profil speichern</button>
          </div>
        </div>
      </div>
    </section>
  );
}

function AppearanceSection({ me }: { me: Me }) {
  const colorMode = useStore((s) => s.colorMode);
  const setColorMode = useStore((s) => s.setColorMode);
  const updateMe = useStore((s) => s.updateMe);
  const toast = useStore((s) => s.toast);
  const pick = async (theme: Theme) => {
    updateMe({ theme });
    try {
      await api.patch('/api/users/me', { theme });
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };
  const modes: Array<[ColorMode, string]> = [['system', 'System'], ['light', 'Hell'], ['dark', 'Dunkel']];
  return (
    <section>
      <h2>Darstellung</h2>
      <div className="group-list">
        <div className="row">
          <span className="row-ico"><PaletteIcon /></span>
          <div className="row-text"><div className="t">Modus</div></div>
          <div className="segmented" role="group" aria-label="Farbmodus">
            {modes.map(([m, label]) => (
              <button key={m} aria-pressed={colorMode === m} onClick={() => setColorMode(m)}>{label}</button>
            ))}
          </div>
        </div>
        <div className="theme-grid" role="group" aria-label="Akzentfarbe">
          {THEMES.map((t) => (
            <button key={t} className="swatch" aria-pressed={me.theme === t} onClick={() => pick(t)}>
              <span className="chip" style={{ background: THEME_SWATCH[t] }} />
              {THEME_LABELS[t]}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function NotificationSection() {
  const config = useStore((s) => s.config);
  const toast = useStore((s) => s.toast);
  const installPrompt = useStore((s) => s.installPrompt);
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const support = pushSupport();
  const permission = typeof Notification !== 'undefined' ? Notification.permission : 'default';

  useEffect(() => {
    currentSubscription().then((s) => setSubscribed(!!s));
  }, []);

  const toggle = async (on: boolean) => {
    if (!config) return;
    setBusy(true);
    try {
      if (on) {
        const r = await subscribePush(config.vapidPublicKey);
        if (r === 'granted') {
          setSubscribed(true);
          toast('Benachrichtigungen sind an', 'success');
        } else if (r === 'denied') toast('Du hast Benachrichtigungen im Browser blockiert. Erlaube sie in den Website-Einstellungen.', 'error');
        else toast('Aktivieren hat nicht geklappt. Auf iPhone/iPad: App neu vom Home-Bildschirm öffnen.', 'error');
      } else {
        await unsubscribePush();
        setSubscribed(false);
        toast('Benachrichtigungen sind aus');
      }
    } finally {
      setBusy(false);
    }
  };

  let description = 'Push bei neuen Nachrichten, auch wenn GigaChat geschlossen ist.';
  if (!config?.pushEnabled) description = 'Auf diesem Server nicht eingerichtet.';
  else if (support === 'install-first') description = isIOS() ? 'Auf iPhone/iPad zuerst installieren: Teilen → „Zum Home-Bildschirm“.' : 'Bitte zuerst als App installieren.';
  else if (support === 'unsupported') description = 'Dein Browser unterstützt keine Push-Benachrichtigungen.';
  else if (permission === 'denied') description = 'Im Browser blockiert. Erlaube Benachrichtigungen in den Website-Einstellungen.';

  return (
    <section>
      <h2>Benachrichtigungen</h2>
      <div className="group-list">
        <div className="row">
          <span className="row-ico"><BellIcon /></span>
          <div className="row-text">
            <div className="t">Push-Benachrichtigungen</div>
            <div className="d">{description}</div>
          </div>
          <Switch checked={!!subscribed} label="Push-Benachrichtigungen" onChange={toggle} />
          {busy ? <span className="sr-only">Bitte warten</span> : null}
        </div>
        {!isStandalone() && (installPrompt || isIOS()) ? (
          <button className="row clickable" onClick={() => (installPrompt ? installPrompt.prompt() : toast('Teilen-Button → „Zum Home-Bildschirm“'))}>
            <span className="row-ico"><DownloadIcon /></span>
            <div className="row-text">
              <div className="t">Als App installieren</div>
              <div className="d">Eigenes Icon, Vollbild, Push-Nachrichten.</div>
            </div>
            <ChevronIcon className="chev" />
          </button>
        ) : null}
      </div>
    </section>
  );
}

function MoreSection({ me }: { me: Me }) {
  const navigate = useNavigate();
  const items: Array<{ to: string; icon: React.ReactNode; title: string; desc: string; min?: number }> = [
    { to: '/stats', icon: <ChartIcon />, title: 'Statistik', desc: 'Wer ist online, Nachrichten pro Tag, Top 10' },
    { to: '/bugs', icon: <BugIcon />, title: 'Bug melden · Vorschlag · Frage', desc: me.role >= ROLES.ADMIN ? 'Tickets verwalten und antworten' : 'Hilf mit, GigaChat besser zu machen' },
    { to: '/release-notes', icon: <DocIcon />, title: 'Release Notes', desc: `Was in ${APP_VERSION} neu ist` },
    { to: '/roadmap', icon: <MapIcon />, title: 'Roadmap (Beta)', desc: 'Was als Nächstes kommen könnte', min: ROLES.BETA },
    { to: '/admin', icon: <ShieldIcon />, title: 'Admin-Panel', desc: 'Nutzer, Passwörter, Rollen', min: ROLES.ADMIN },
  ];
  return (
    <section>
      <h2>Mehr</h2>
      <div className="group-list">
        {items
          .filter((i) => me.role >= (i.min ?? 0))
          .map((i) => (
            <button key={i.to} className="row clickable" onClick={() => navigate(i.to)}>
              <span className="row-ico">{i.icon}</span>
              <div className="row-text">
                <div className="t">{i.title}</div>
                <div className="d">{i.desc}</div>
              </div>
              <ChevronIcon className="chev" />
            </button>
          ))}
      </div>
    </section>
  );
}

function AccountSection() {
  const [pw, setPw] = useState(false);
  const [del, setDel] = useState(false);
  const navigate = useNavigate();
  const setAuth = useStore((s) => s.setAuth);
  const toast = useStore((s) => s.toast);

  const logout = async () => {
    try {
      await api.post('/api/auth/logout');
    } catch {
      /* ignore */
    }
    stopRealtime();
    setAuth(null);
    navigate('/login', { replace: true });
  };

  return (
    <section>
      <h2>Konto</h2>
      <div className="group-list">
        <button className="row clickable" onClick={() => setPw(true)}>
          <span className="row-ico"><KeyIcon /></span>
          <div className="row-text"><div className="t">Passwort ändern</div><div className="d">Meldet andere Geräte ab</div></div>
          <ChevronIcon className="chev" />
        </button>
        <button className="row clickable" onClick={logout}>
          <span className="row-ico"><LogoutIcon /></span>
          <div className="row-text"><div className="t">Abmelden</div></div>
          <ChevronIcon className="chev" />
        </button>
        <button className="row clickable danger" onClick={() => setDel(true)}>
          <span className="row-ico"><TrashIcon /></span>
          <div className="row-text"><div className="t">Konto endgültig löschen</div><div className="d">Löscht alle deine Nachrichten und Daten</div></div>
          <ChevronIcon className="chev" />
        </button>
      </div>
      {pw ? <PasswordSheet onClose={() => setPw(false)} /> : null}
      {del ? (
        <DeleteSheet
          onClose={() => setDel(false)}
          onDone={() => {
            stopRealtime();
            setAuth(null);
            toast('Konto gelöscht');
            navigate('/login', { replace: true });
          }}
        />
      ) : null}
    </section>
  );
}

function PasswordSheet({ onClose }: { onClose: () => void }) {
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [next2, setNext2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const toast = useStore((s) => s.toast);
  const save = async () => {
    if (next.length < PASSWORD_MIN) return setError(`Mindestens ${PASSWORD_MIN} Zeichen.`);
    if (next !== next2) return setError('Die neuen Passwörter stimmen nicht überein.');
    try {
      await api.post('/api/users/me/password', { currentPassword: cur, newPassword: next });
      toast('Passwort geändert', 'success');
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  return (
    <Sheet title="Passwort ändern" onClose={onClose}>
      <div style={{ display: 'grid', gap: 12 }}>
        {error ? <div className="form-error">{error}</div> : null}
        <div className="field"><label htmlFor="pw-cur">Aktuelles Passwort</label><input id="pw-cur" className="input" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} /></div>
        <div className="field"><label htmlFor="pw-new">Neues Passwort</label><input id="pw-new" className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} /></div>
        <div className="field"><label htmlFor="pw-new2">Neues Passwort wiederholen</label><input id="pw-new2" className="input" type="password" autoComplete="new-password" value={next2} onChange={(e) => setNext2(e.target.value)} /></div>
        <div className="inline-actions" style={{ justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onClose}>Abbrechen</button>
          <button className="btn btn-primary" onClick={save} disabled={!cur || !next}>Passwort ändern</button>
        </div>
      </div>
    </Sheet>
  );
}

function DeleteSheet({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [pw, setPw] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const run = async () => {
    try {
      await api.delete('/api/users/me', { password: pw });
      onDone();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  return (
    <>
      <Sheet title="Konto löschen" onClose={onClose}>
        <p className="muted" style={{ marginBottom: 12 }}>Alle deine Nachrichten, Gruppenmitgliedschaften, Notizen und Einstellungen werden endgültig gelöscht. Das lässt sich nicht rückgängig machen.</p>
        {error ? <div className="form-error" style={{ marginBottom: 12 }}>{error}</div> : null}
        <div className="field"><label htmlFor="del-pw">Passwort zur Bestätigung</label><input id="del-pw" className="input" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} /></div>
        <div className="inline-actions" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
          <button className="btn" onClick={onClose}>Abbrechen</button>
          <button className="btn btn-danger" disabled={!pw} onClick={() => setConfirm(true)}>Konto löschen</button>
        </div>
      </Sheet>
      {confirm ? <Confirm title="Wirklich endgültig löschen?" text="Letzte Chance. Danach ist dein Konto weg." confirmLabel="Ja, löschen" danger onClose={() => setConfirm(false)} onConfirm={run} /> : null}
    </>
  );
}

export { UsersIcon };
