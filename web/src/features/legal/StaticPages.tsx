import { APP_VERSION, ROLES, SCORE_TIERS } from '@gigachat/shared';
import { Link, Navigate, useNavigate } from 'react-router';
import { PageFrame } from '../../app/Shell';
import { useStore } from '../../lib/store';

function Frame({ title, children }: { title: string; children: React.ReactNode }) {
  const me = useStore((s) => s.me);
  const navigate = useNavigate();
  if (me) return <PageFrame title={title}>{children}</PageFrame>;
  return (
    <main className="auth" style={{ alignItems: 'start' }}>
      <div className="auth-card" style={{ maxWidth: 760 }}>
        <button className="btn btn-ghost btn-sm" onClick={() => navigate(-1)} style={{ marginBottom: 12 }}>← Zurück</button>
        <h1 style={{ marginBottom: 12 }}>{title}</h1>
        {children}
      </div>
    </main>
  );
}

export function ImpressumPage() {
  return (
    <Frame title="Impressum">
      <div className="prose">
        <p>Henri Himmelmann<br />Allensbach, Deutschland<br />E-Mail: henri@linhi.de</p>
        <p>Dieses Projekt ist ein privates Chat-Angebot für einen begrenzten Nutzerkreis (z. B. Freunde und schulisches Umfeld).</p>
        <h2>Haftung für Inhalte</h2>
        <p>Die Inhalte dieser Website wurden mit größtmöglicher Sorgfalt erstellt. Für die Richtigkeit, Vollständigkeit und Aktualität der Inhalte kann jedoch keine Gewähr übernommen werden.</p>
        <h2>Haftung für Links</h2>
        <p>Diese Website enthält ggf. Links zu externen Websites Dritter. Auf deren Inhalte besteht kein Einfluss, weshalb für diese fremden Inhalte keine Haftung übernommen wird.</p>
        <h2>Urheberrecht</h2>
        <p>Die durch den Betreiber erstellten Inhalte unterliegen dem deutschen Urheberrecht. Eine Vervielfältigung oder Verwendung außerhalb der Grenzen des Urheberrechts bedarf der Zustimmung des jeweiligen Autors.</p>
        <p><Link to="/datenschutz">Datenschutzerklärung</Link></p>
      </div>
    </Frame>
  );
}

export function DatenschutzPage() {
  return (
    <Frame title="Datenschutzerklärung">
      <div className="prose">
        <h2>1. Verantwortlicher</h2>
        <p>Henri Himmelmann, Allensbach, Deutschland. E-Mail: henri@linhi.de</p>
        <h2>2. Server-Logfiles</h2>
        <p>Beim Aufruf dieser Website erhebt der Hostinganbieter automatisch technische Zugriffsdaten (z. B. IP-Adresse, Datum und Uhrzeit, aufgerufene Seiten, Browsertyp). Diese Daten sind technisch erforderlich, um einen sicheren und stabilen Betrieb der Website zu gewährleisten. Eine Zusammenführung mit anderen Datenquellen findet nicht statt.</p>
        <h2>3. Registrierung und Login</h2>
        <p>Für die Nutzung des Chats ist eine Registrierung erforderlich. Dabei werden ausschließlich ein Benutzername und ein Passwort verarbeitet. Das Passwort wird nicht im Klartext gespeichert. Zur Aufrechterhaltung des Login-Status wird ein technisch notwendiges Session-Cookie eingesetzt.</p>
        <h2>4. Chat-Funktion</h2>
        <p>Im Rahmen der Nutzung des Chats werden Nachrichteninhalte, hochgeladene Dateien sowie technische Metadaten (z. B. Zeitpunkt, Lesestatus) verarbeitet und gespeichert, um die Kommunikation zwischen den Nutzern zu ermöglichen. Der Zugriff auf gespeicherte Daten erfolgt ausschließlich im Rahmen des technischen Betriebs, zur Fehleranalyse oder zur Gewährleistung der Sicherheit des Systems.</p>
        <h2>5. Statistik</h2>
        <p>Diese Website nutzt eine einfache statistische Auswertung zur Erfassung von Besucherzahlen (z. B. Seitenaufrufe). Dabei werden keine Nutzerprofile erstellt und keine Daten zu Werbezwecken verwendet. Die Verarbeitung erfolgt auf Grundlage des berechtigten Interesses an der Analyse und Optimierung des Websitebetriebs.</p>
        <h2>6. Push-Benachrichtigungen</h2>
        <p>Sofern du Push-Benachrichtigungen aktivierst, wird eine technisch notwendige Information (Push-Endpunkt deines Browsers) gespeichert, um dich über neue Nachrichten zu informieren. Die Aktivierung ist freiwillig und kann jederzeit in den Einstellungen oder über deinen Browser widerrufen werden.</p>
        <h2>7. GIFs</h2>
        <p>Die GIF-Suche nutzt den Dienst GIPHY. Bei einer Suche wird der Suchbegriff an GIPHY übermittelt; eingebettete GIFs werden von GIPHY-Servern geladen.</p>
        <h2>8. Speicherdauer</h2>
        <p>Personenbezogene Daten werden nur so lange gespeichert, wie dies für die Nutzung des Chats und den technischen Betrieb erforderlich ist. Mit dem Löschen des Kontos werden alle zugehörigen Daten entfernt.</p>
        <h2>9. Weitergabe von Daten</h2>
        <p>Eine Weitergabe personenbezogener Daten an Dritte findet nicht statt, sofern keine gesetzliche Verpflichtung besteht.</p>
        <h2>10. Rechte der Nutzer</h2>
        <p>Du hast das Recht auf Auskunft, Berichtigung oder Löschung deiner personenbezogenen Daten. Anfragen können per E-Mail an die oben genannte Adresse gerichtet werden.</p>
        <p><Link to="/impressum">Impressum</Link></p>
      </div>
    </Frame>
  );
}

export function ReleaseNotesPage() {
  return (
    <PageFrame title="Release Notes">
      <h1>GigaChat {APP_VERSION}</h1>
      <p className="lead">Komplett neu gebaut. Schneller, sicherer, überall installierbar.</p>
      <div className="release">
        <div className="card"><h3>⚡ Echtzeit statt Warten</h3><p>Nachrichten, Lesebestätigungen, Online-Status und Tipp-Anzeige kommen sofort per Live-Verbindung. Kein 5-Sekunden-Polling mehr.</p></div>
        <div className="card"><h3>📱 Echte App auf jedem Gerät</h3><p>Installierbar auf iPhone, iPad, Android, Windows und Mac. Push-Benachrichtigungen auf allen Plattformen, inklusive iOS ab 16.4 als installierte App.</p></div>
        <div className="card"><h3>🎨 Neues Design</h3><p>Hell- und Dunkelmodus, acht Akzentfarben für alle, ruhige Chat-Blasen, ein Score-Ring, der zeigt, wie weit es bis zur nächsten Stufe ist.</p></div>
        <div className="card"><h3>👁️ Gelesen von …</h3><p>In Gruppen siehst du pro Nachricht, wer sie schon gelesen hat. Privat wie gewohnt ✔️ zugestellt und ✔️✔️ gelesen.</p></div>
        <div className="card"><h3>🏅 Gruppen-Score</h3><p>Jede Gruppe hat jetzt einen eigenen Score. Jede Nachricht zählt für alle Mitglieder weiter +1 GigaScore.</p></div>
        <div className="card"><h3>🔒 Sicherheit</h3><p>Moderne Passwort-Hashes, CSRF-Schutz, Rate-Limits, keine Geheimnisse mehr im Code. Bestehende Passwörter funktionieren weiter.</p></div>
        <div className="card"><h3>📝 Alles ist noch da</h3><p>Aliase, Anpinnen, Archiv, GIFs, Bilder und Dateien bis 20 MB, Notizen, Statistik, Bug-Tickets, Admin-Panel, r/place.</p></div>
      </div>

      <section>
        <h2>GigaScore-Stufen</h2>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Stufe</th><th>Ab Score</th><th>Bedeutung</th></tr></thead>
            <tbody>
              {[...SCORE_TIERS].reverse().map((t) => (
                <tr key={t.min}><td>{t.emoji}</td><td className="num">{t.min}</td><td className="muted">{t.label}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="hint" style={{ marginTop: 8 }}>+1 für jede gesendete und jede empfangene Nachricht. Gruppen zählen für alle Mitglieder. Die Stufe ist rein visuell.</p>
      </section>

      <section className="prose">
        <h2>Frühere Versionen</h2>
        <p><strong>3.0</strong> – GigaScore, Notizen, Online-Status, GIFs, Push-Fixes, bessere Handy-Ansicht, Admin-Panel.</p>
        <p><strong>2.6</strong> – Statistik-Seite mit Online-Zahl, Views und Top 10.</p>
        <p><strong>2.5</strong> – Push-Benachrichtigungen, „Angemeldet bleiben“, eigene Gruppen, Anpinnen/Archivieren, Bilder und Dateien bis 20 MB.</p>
      </section>
    </PageFrame>
  );
}

export function RoadmapPage() {
  const me = useStore((s) => s.me)!;
  if (me.role < ROLES.BETA) return <Navigate to="/" replace />;
  const planned = [
    ['Kontakte suchen', 'Jetzt in 4.0: Suchfeld über der Liste'],
    ['Nachrichten anpinnen', 'Wichtiges in einer Gruppe oben festhalten'],
    ['Antworten auf Nachrichten', 'Zitat-Antworten mit Sprung zur Originalnachricht'],
    ['Umfragen', 'Schnelle Abstimmungen in Gruppen'],
    ['Spiele', 'TicTacToe, 4 gewinnt – direkt im Chat'],
    ['Konto mit Code schützen', 'Zusätzlicher Zugangscode beim Login'],
    ['Eigene Benachrichtigungstöne', 'Pro Chat ein anderer Sound'],
    ['Benachrichtigungen pro Chat stummschalten', 'Gruppen leise stellen, Personen nicht'],
    ['Blockieren', 'Personen blocken und in den Einstellungen wieder freigeben'],
    ['Server-News', 'Neuheiten als Hinweis in der App'],
  ];
  return (
    <PageFrame title="Roadmap">
      <p className="lead">Was als Nächstes kommen könnte. Nur für Beta-Tester sichtbar – sag Bescheid, was dir wichtig ist.</p>
      <div className="group-list">
        {planned.map(([t, d]) => (
          <div key={t} className="row">
            <div className="row-text"><div className="t">{t}</div><div className="d">{d}</div></div>
          </div>
        ))}
      </div>
    </PageFrame>
  );
}
