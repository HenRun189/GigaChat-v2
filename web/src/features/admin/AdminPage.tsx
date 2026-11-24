import { PASSWORD_MIN, ROLES, ROLE_LABELS, type AdminUserDetail, type AdminUserSummary } from '@gigachat/shared';
import { useEffect, useState } from 'react';
import { Navigate } from 'react-router';
import { PageFrame } from '../../app/Shell';
import { Confirm, Sheet, Spinner } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { fmtDateTime, fmtLastSeen } from '../../lib/format';
import { useStore } from '../../lib/store';

export function AdminPage() {
  const me = useStore((s) => s.me)!;
  const toast = useStore((s) => s.toast);
  const [users, setUsers] = useState<AdminUserSummary[] | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [detail, setDetail] = useState<AdminUserDetail | null>(null);
  const [q, setQ] = useState('');
  const [pw, setPw] = useState('');
  const [role, setRole] = useState(0);
  const [confirm, setConfirm] = useState<null | { title: string; text: string; run: () => Promise<unknown> }>(null);
  const [showPw, setShowPw] = useState(false);

  const loadUsers = () => api.get<{ users: AdminUserSummary[] }>('/api/admin/users').then((r) => setUsers(r.users)).catch((e) => toast(errorMessage(e), 'error'));
  const loadDetail = (id: number) =>
    api
      .get<{ user: AdminUserDetail }>(`/api/admin/users/${id}`)
      .then((r) => {
        setDetail(r.user);
        setRole(r.user.role);
      })
      .catch((e) => toast(errorMessage(e), 'error'));

  useEffect(() => {
    void loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (selected) void loadDetail(selected);
    else setDetail(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  if (me.role < ROLES.ADMIN) return <Navigate to="/" replace />;

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast(ok, 'success');
      await Promise.all([loadUsers(), selected ? loadDetail(selected) : Promise.resolve()]);
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  const list = (users ?? []).filter((u) => !q || u.username.toLowerCase().includes(q.toLowerCase()) || String(u.id) === q);

  return (
    <PageFrame title="Admin-Panel" wide>
      <div style={{ display: 'grid', gridTemplateColumns: detail ? 'minmax(220px, 320px) minmax(0, 1fr)' : '1fr', gap: 20 }}>
        <section style={{ marginTop: 0 }}>
          <input className="input" placeholder="Name oder ID" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Nutzer suchen" style={{ marginBottom: 10 }} />
          {!users ? <div className="loading-more"><Spinner /></div> : null}
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>ID</th><th>Name</th><th>Rolle</th><th className="num">Score</th></tr></thead>
              <tbody>
                {list.map((u) => (
                  <tr key={u.id} onClick={() => setSelected(u.id)} style={{ cursor: 'pointer', background: selected === u.id ? 'var(--accent-soft)' : undefined }}>
                    <td className="num muted">{u.id}</td>
                    <td style={{ fontWeight: 600 }}>{u.username}</td>
                    <td className="muted">{ROLE_LABELS[u.role]}</td>
                    <td className="num">{u.gigascore}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {detail ? (
          <section style={{ marginTop: 0 }}>
            <div className="group-list" style={{ padding: 16, display: 'grid', gap: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                <div>
                  <h2>{detail.emoji ? `${detail.emoji} ` : ''}{detail.username} <span className="muted small">#{detail.id}</span></h2>
                  <div className="muted small">{ROLE_LABELS[detail.role]} · GigaScore {detail.gigascore} · dabei seit {fmtDateTime(detail.createdAt)} · {fmtLastSeen(detail.lastSeen, false)}</div>
                </div>
                <button className="btn btn-ghost btn-sm" onClick={() => setSelected(null)}>Schließen</button>
              </div>

              <div className="kpis">
                <div className="kpi"><div className="v num">{detail.counts.messagesSent}</div><div className="l">gesendet</div></div>
                <div className="kpi"><div className="v num">{detail.counts.dmReceived}</div><div className="l">privat empfangen</div></div>
                <div className="kpi"><div className="v num">{detail.counts.groups}</div><div className="l">Gruppen</div></div>
                <div className="kpi"><div className="v num">{detail.counts.pushSubscriptions}</div><div className="l">Push-Geräte</div></div>
                <div className="kpi"><div className="v num">{detail.counts.sessions}</div><div className="l">Sitzungen</div></div>
              </div>

              <h3>Support-Aktionen</h3>
              <div className="inline-actions">
                <button className="btn btn-sm" onClick={() => act(() => api.post(`/api/admin/users/${detail.id}/revoke-push`), 'Push-Geräte entfernt')}>Push deaktivieren</button>
                <button className="btn btn-sm" onClick={() => act(() => api.post(`/api/admin/users/${detail.id}/revoke-sessions`), 'Alle Sitzungen beendet')}>Überall abmelden</button>
                <button className="btn btn-sm" onClick={() => setShowPw(true)}>Passwort zurücksetzen</button>
                {me.role >= ROLES.OWNER ? (
                  <span style={{ display: 'inline-flex', gap: 6 }}>
                    <select className="input" style={{ minHeight: 36, padding: '4px 36px 4px 10px' }} value={role} onChange={(e) => setRole(Number(e.target.value))} aria-label="Rolle">
                      {[0, 1, 2, 3].map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                    </select>
                    <button className="btn btn-sm" disabled={role === detail.role} onClick={() => act(() => api.post(`/api/admin/users/${detail.id}/role`, { role }), 'Rolle geändert')}>Rolle setzen</button>
                  </span>
                ) : null}
                {detail.id !== me.id ? (
                  <button className="btn btn-danger btn-sm" onClick={() => setConfirm({ title: `${detail.username} löschen?`, text: 'Konto, Nachrichten und Daten werden endgültig gelöscht.', run: () => api.post(`/api/admin/users/${detail.id}/delete`).then(() => setSelected(null)) })}>
                    Konto löschen
                  </button>
                ) : null}
              </div>

              <h3>Letzte Nachrichten ({detail.recentMessages.length})</h3>
              <div className="table-wrap" style={{ maxHeight: 420, overflowY: 'auto' }}>
                <table className="table">
                  <thead><tr><th>Wo</th><th>Inhalt</th><th>Zeit</th><th /></tr></thead>
                  <tbody>
                    {detail.recentMessages.map((m) => (
                      <tr key={m.id} style={m.deletedAt ? { opacity: 0.5 } : undefined}>
                        <td className="muted">{m.kind === 'group' ? '👥 ' : ''}{m.conversationName}</td>
                        <td style={{ maxWidth: 360, wordBreak: 'break-word' }}>{m.deletedAt ? <i>gelöscht</i> : m.body}</td>
                        <td className="muted num" style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(m.createdAt)}</td>
                        <td>
                          {!m.deletedAt && m.messageKind !== 'system' ? (
                            <button className="btn btn-ghost btn-sm" onClick={() => act(() => api.delete(`/api/admin/messages/${m.id}`), 'Nachricht gelöscht')}>Löschen</button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        ) : null}
      </div>

      {showPw && detail ? (
        <Sheet title={`Neues Passwort für ${detail.username}`} onClose={() => setShowPw(false)}>
          <div className="field"><label htmlFor="adm-pw">Neues Passwort</label><input id="adm-pw" className="input" value={pw} onChange={(e) => setPw(e.target.value)} placeholder={`mind. ${PASSWORD_MIN} Zeichen`} /></div>
          <p className="hint" style={{ marginTop: 6 }}>Gib das Passwort der Person persönlich weiter. Alle ihre Sitzungen werden beendet.</p>
          <div className="inline-actions" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
            <button className="btn" onClick={() => setShowPw(false)}>Abbrechen</button>
            <button className="btn btn-primary" disabled={pw.length < PASSWORD_MIN} onClick={() => act(() => api.post(`/api/admin/users/${detail.id}/reset-password`, { newPassword: pw }), 'Passwort gesetzt').then(() => { setShowPw(false); setPw(''); })}>Setzen</button>
          </div>
        </Sheet>
      ) : null}
      {confirm ? <Confirm title={confirm.title} text={confirm.text} confirmLabel="Löschen" danger onClose={() => setConfirm(null)} onConfirm={() => act(confirm.run, 'Konto gelöscht')} /> : null}
    </PageFrame>
  );
}
