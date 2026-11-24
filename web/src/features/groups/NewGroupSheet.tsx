import { GROUP_NAME_MIN, type ConversationDetail, type PublicUser } from '@gigachat/shared';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { SearchIcon } from '../../components/icons';
import { Avatar, Sheet, Spinner } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useStore } from '../../lib/store';

export function NewGroupSheet({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [users, setUsers] = useState<PublicUser[] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const toast = useStore((s) => s.toast);
  const loadContacts = useStore((s) => s.loadContacts);

  useEffect(() => {
    api.get<{ users: PublicUser[] }>('/api/users').then((r) => setUsers(r.users)).catch((e) => setError(errorMessage(e)));
  }, []);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (users ?? []).filter((u) => !needle || u.username.toLowerCase().includes(needle));
  }, [users, q]);

  const toggle = (id: number) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const create = async () => {
    if (name.trim().length < GROUP_NAME_MIN) return setError(`Der Gruppenname braucht mindestens ${GROUP_NAME_MIN} Zeichen.`);
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ conversation: ConversationDetail }>('/api/groups', { name: name.trim(), memberIds: [...selected] });
      await loadContacts().catch(() => {});
      toast(`Gruppe „${r.conversation.name}“ erstellt`, 'success');
      onClose();
      navigate(`/c/${r.conversation.id}`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      title="Neue Gruppe"
      onClose={onClose}
      footer={
        <div style={{ padding: '10px 20px 16px', display: 'flex', gap: 8, justifyContent: 'flex-end', borderTop: '1px solid var(--line)' }}>
          <button className="btn" onClick={onClose}>Abbrechen</button>
          <button className="btn btn-primary" onClick={create} disabled={busy || name.trim().length < GROUP_NAME_MIN}>
            {busy ? 'Erstellen…' : `Gruppe erstellen${selected.size ? ` (${selected.size + 1})` : ''}`}
          </button>
        </div>
      }
    >
      {error ? <div className="form-error" style={{ marginBottom: 12 }}>{error}</div> : null}
      <div className="field" style={{ marginBottom: 14 }}>
        <label htmlFor="group-name">Gruppenname</label>
        <input id="group-name" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="z. B. Klasse 10b" />
      </div>
      <div className="field">
        <label>Mitglieder</label>
        <label className="search">
          <SearchIcon />
          <input type="search" placeholder="Leute suchen" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      </div>
      {!users ? (
        <div className="loading-more"><Spinner /></div>
      ) : (
        <ul style={{ marginTop: 8 }}>
          {list.map((u) => (
            <li key={u.id} className="member-row">
              <Avatar name={u.username} color={u.color} emoji={u.emoji} size="sm" seed={u.id} online={u.online} />
              <div className="who">
                <div className="n">{u.username}</div>
              </div>
              <input type="checkbox" aria-label={`${u.username} hinzufügen`} checked={selected.has(u.id)} onChange={() => toggle(u.id)} style={{ width: 20, height: 20, accentColor: 'var(--accent)' }} />
            </li>
          ))}
          {list.length === 0 ? <li className="faint" style={{ padding: 12 }}>Niemand gefunden.</li> : null}
        </ul>
      )}
    </Sheet>
  );
}
