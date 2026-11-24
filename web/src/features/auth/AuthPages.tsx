import { PASSWORD_MIN, USERNAME_RE, type AppConfig, type Me } from '@gigachat/shared';
import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { api, errorMessage } from '../../lib/api';
import { useStore } from '../../lib/store';

function Wordmark({ sub }: { sub: string }) {
  return (
    <div className="wordmark">
      <div className="mark" aria-hidden="true">G</div>
      <div>
        <h1>GigaChat</h1>
        <p>{sub}</p>
      </div>
    </div>
  );
}

export function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const setAuth = useStore((s) => s.setAuth);
  const navigate = useNavigate();
  const location = useLocation();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ user: Me; config: AppConfig }>('/api/auth/login', { username: username.trim(), password, remember });
      setAuth(r.user, r.config);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from && from !== '/login' ? from : '/', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth">
      <div className="auth-card">
        <Wordmark sub="Melde dich an, um weiterzuchatten." />
        <form onSubmit={submit} autoComplete="on">
          {error ? <div className="form-error" role="alert">{error}</div> : null}
          <div className="field">
            <label htmlFor="login-user">Benutzername</label>
            <input id="login-user" className="input" autoComplete="username" autoCapitalize="none" autoCorrect="off" required value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
          </div>
          <div className="field">
            <label htmlFor="login-pass">Passwort</label>
            <input id="login-pass" className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <label className="checkbox">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            Angemeldet bleiben
          </label>
          <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
            {busy ? 'Anmelden…' : 'Anmelden'}
          </button>
        </form>
        <p className="alt">
          Noch kein Konto? <Link to="/register">Registrieren</Link>
        </p>
        <p className="alt small faint">
          <Link to="/impressum">Impressum</Link> · <Link to="/datenschutz">Datenschutz</Link>
        </p>
      </div>
    </main>
  );
}

export function RegisterPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [website, setWebsite] = useState(''); // honeypot
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const setAuth = useStore((s) => s.setAuth);
  const navigate = useNavigate();

  const nameOk = USERNAME_RE.test(username.trim());
  const passOk = password.length >= PASSWORD_MIN;
  const matchOk = password === password2;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!nameOk) return setError('Benutzername: 3–30 Zeichen, nur Buchstaben, Zahlen, . _ -');
    if (!passOk) return setError(`Das Passwort braucht mindestens ${PASSWORD_MIN} Zeichen.`);
    if (!matchOk) return setError('Die Passwörter stimmen nicht überein.');
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ user: Me; config: AppConfig }>('/api/auth/register', { username: username.trim(), password, remember: true, website });
      setAuth(r.user, r.config);
      navigate('/', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth">
      <div className="auth-card">
        <Wordmark sub="Erstelle dein Konto. Dauert zehn Sekunden." />
        <form onSubmit={submit} autoComplete="on">
          {error ? <div className="form-error" role="alert">{error}</div> : null}
          <div className="field">
            <label htmlFor="reg-user">Benutzername</label>
            <input id="reg-user" className="input" autoComplete="username" autoCapitalize="none" autoCorrect="off" required minLength={3} maxLength={30} value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
            <span className="hint">3–30 Zeichen: Buchstaben, Zahlen, Punkt, Unterstrich, Bindestrich.</span>
          </div>
          <div className="field">
            <label htmlFor="reg-pass">Passwort</label>
            <input id="reg-pass" className="input" type="password" autoComplete="new-password" required minLength={PASSWORD_MIN} value={password} onChange={(e) => setPassword(e.target.value)} />
            <span className="hint">Mindestens {PASSWORD_MIN} Zeichen.</span>
          </div>
          <div className="field">
            <label htmlFor="reg-pass2">Passwort wiederholen</label>
            <input id="reg-pass2" className="input" type="password" autoComplete="new-password" required value={password2} onChange={(e) => setPassword2(e.target.value)} />
          </div>
          <input className="hp" tabIndex={-1} autoComplete="off" name="website" value={website} onChange={(e) => setWebsite(e.target.value)} aria-hidden="true" />
          <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
            {busy ? 'Konto wird erstellt…' : 'Konto erstellen'}
          </button>
        </form>
        <p className="alt">
          Schon registriert? <Link to="/login">Anmelden</Link>
        </p>
        <p className="alt small faint">
          Mit der Registrierung akzeptierst du die <Link to="/datenschutz">Datenschutzerklärung</Link>.
        </p>
      </div>
    </main>
  );
}
