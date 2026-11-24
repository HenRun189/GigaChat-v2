import { ROLES, type BugReport } from '@gigachat/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { PageFrame } from '../../app/Shell';
import { Sheet } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { useStore } from '../../lib/store';

const TYPE_LABEL: Record<BugReport['type'], string> = { bug: '🐞 Bug', feature: '✨ Vorschlag', question: '❓ Frage' };
const STATUS_LABEL: Record<BugReport['status'], string> = { open: 'Offen', in_progress: 'In Arbeit', closed: 'Erledigt' };
const PRIO_LABEL: Record<BugReport['priority'], string> = { low: 'niedrig', medium: 'mittel', high: 'hoch' };

export function BugsPage() {
  const me = useStore((s) => s.me)!;
  const toast = useStore((s) => s.toast);
  const navigate = useNavigate();
  const [type, setType] = useState<BugReport['type']>('bug');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<BugReport['priority']>('medium');
  const [mine, setMine] = useState<BugReport[]>([]);
  const [all, setAll] = useState<BugReport[] | null>(null);
  const [filter, setFilter] = useState<{ type: string; status: string; sort: 'new' | 'old' }>({ type: '', status: '', sort: 'new' });
  const [reply, setReply] = useState<BugReport | null>(null);
  const [replyText, setReplyText] = useState('');
  const isAdmin = me.role >= ROLES.ADMIN;

  const loadMine = () => api.get<{ reports: BugReport[] }>('/api/bugs/mine').then((r) => setMine(r.reports)).catch(() => {});
  const loadAll = () => {
    if (!isAdmin) return Promise.resolve();
    const qs = new URLSearchParams();
    if (filter.type) qs.set('type', filter.type);
    if (filter.status) qs.set('status', filter.status);
    qs.set('sort', filter.sort);
    return api.get<{ reports: BugReport[] }>(`/api/bugs?${qs}`).then((r) => setAll(r.reports)).catch((e) => toast(errorMessage(e), 'error'));
  };

  useEffect(() => {
    void loadMine();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter.type, filter.status, filter.sort, isAdmin]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.post('/api/bugs', { type, title: title.trim(), description: description.trim(), priority });
      toast('Danke! Dein Ticket ist angekommen.', 'success');
      setTitle('');
      setDescription('');
      await Promise.all([loadMine(), loadAll()]);
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  const setStatus = async (r: BugReport, status: BugReport['status']) => {
    try {
      await api.patch(`/api/bugs/${r.id}/status`, { status });
      await Promise.all([loadMine(), loadAll()]);
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  const sendReply = async () => {
    if (!reply) return;
    try {
      const r = await api.post<{ conversationId: number }>(`/api/bugs/${reply.id}/reply`, { text: replyText.trim() });
      toast('Rückfrage als Nachricht gesendet', 'success');
      setReply(null);
      setReplyText('');
      navigate(`/c/${r.conversationId}`);
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  return (
    <PageFrame title="Bug · Vorschlag · Frage" wide={isAdmin}>
      <p className="lead">Etwas kaputt? Eine Idee? Schreib es hier auf, damit nichts verloren geht.</p>
      <form className="group-list" style={{ padding: 16, display: 'grid', gap: 12 }} onSubmit={submit}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="field">
            <label htmlFor="b-type">Art</label>
            <select id="b-type" className="input" value={type} onChange={(e) => setType(e.target.value as BugReport['type'])}>
              <option value="bug">🐞 Bug melden</option>
              <option value="feature">✨ Funktionsvorschlag</option>
              <option value="question">❓ Frage stellen</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="b-prio">Dringlichkeit</label>
            <select id="b-prio" className="input" value={priority} onChange={(e) => setPriority(e.target.value as BugReport['priority'])}>
              <option value="low">🟢 Niedrig</option>
              <option value="medium">🟡 Mittel</option>
              <option value="high">🔴 Hoch</option>
            </select>
          </div>
        </div>
        <div className="field"><label htmlFor="b-title">Kurzer Titel</label><input id="b-title" className="input" required minLength={3} maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} /></div>
        <div className="field"><label htmlFor="b-desc">Beschreibung</label><textarea id="b-desc" className="input" required minLength={3} maxLength={5000} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Was ist passiert? Was hast du erwartet? Welches Gerät?" /></div>
        <div><button className="btn btn-primary" type="submit" disabled={title.trim().length < 3 || description.trim().length < 3}>Absenden</button></div>
      </form>

      {mine.length ? (
        <section>
          <h2>Deine Tickets</h2>
          <div className="group-list">
            {mine.map((r) => (
              <div key={r.id} className="row">
                <div className="row-text">
                  <div className="t">{TYPE_LABEL[r.type].slice(0, 2)} {r.title}</div>
                  <div className="d">{fmtDateTime(r.createdAt)} · {PRIO_LABEL[r.priority]}</div>
                </div>
                <span className={`tag ${r.status === 'closed' ? 'ok' : r.status === 'in_progress' ? 'gold' : ''}`}>{STATUS_LABEL[r.status]}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {isAdmin ? (
        <section>
          <h2>Alle Tickets</h2>
          <div className="inline-actions" style={{ marginBottom: 10 }}>
            <select className="input" style={{ width: 'auto', minHeight: 38 }} value={filter.type} onChange={(e) => setFilter({ ...filter, type: e.target.value })} aria-label="Typ filtern">
              <option value="">Alle Typen</option><option value="bug">Bug</option><option value="feature">Vorschlag</option><option value="question">Frage</option>
            </select>
            <select className="input" style={{ width: 'auto', minHeight: 38 }} value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })} aria-label="Status filtern">
              <option value="">Alle Status</option><option value="open">Offen</option><option value="in_progress">In Arbeit</option><option value="closed">Erledigt</option>
            </select>
            <select className="input" style={{ width: 'auto', minHeight: 38 }} value={filter.sort} onChange={(e) => setFilter({ ...filter, sort: e.target.value as 'new' | 'old' })} aria-label="Sortierung">
              <option value="new">Neueste zuerst</option><option value="old">Älteste zuerst</option>
            </select>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Typ</th><th>Titel</th><th>Von</th><th>Datum</th><th>Prio</th><th>Status</th><th /></tr></thead>
              <tbody>
                {(all ?? []).map((r) => (
                  <tr key={r.id}>
                    <td>{TYPE_LABEL[r.type]}</td>
                    <td><div style={{ fontWeight: 600 }}>{r.title}</div><div className="muted small" style={{ maxWidth: 420, whiteSpace: 'pre-wrap' }}>{r.description}</div></td>
                    <td>{r.username}</td>
                    <td className="muted num" style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(r.createdAt)}</td>
                    <td className="muted">{PRIO_LABEL[r.priority]}</td>
                    <td>
                      <select className="input" style={{ minHeight: 34, padding: '2px 32px 2px 8px', width: 'auto' }} value={r.status} onChange={(e) => setStatus(r, e.target.value as BugReport['status'])} aria-label="Status">
                        <option value="open">Offen</option><option value="in_progress">In Arbeit</option><option value="closed">Erledigt</option>
                      </select>
                    </td>
                    <td>{r.userId !== me.id ? <button className="btn btn-ghost btn-sm" onClick={() => setReply(r)}>💬 Rückfrage</button> : null}</td>
                  </tr>
                ))}
                {all && all.length === 0 ? <tr><td colSpan={7} className="muted">Keine Tickets.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {reply ? (
        <Sheet title={`Rückfrage an ${reply.username}`} onClose={() => setReply(null)}>
          <p className="muted small" style={{ marginBottom: 10 }}>Wird als Direktnachricht gesendet, mit Bezug auf „{reply.title}“.</p>
          <textarea className="input" value={replyText} onChange={(e) => setReplyText(e.target.value)} autoFocus />
          <div className="inline-actions" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
            <button className="btn" onClick={() => setReply(null)}>Abbrechen</button>
            <button className="btn btn-primary" disabled={replyText.trim().length < 2} onClick={sendReply}>Senden</button>
          </div>
        </Sheet>
      ) : null}
    </PageFrame>
  );
}
