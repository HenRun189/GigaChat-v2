import { ROLES, ROLE_LABELS, scoreTier, type ConversationDetail, type PublicUser } from '@gigachat/shared';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { ArchiveIcon, EditIcon, LogoutIcon, PinIcon, TrashIcon, UserPlusIcon } from '../../components/icons';
import { Avatar, Confirm, ScoreRing, Sheet, Switch } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { fmtDateTime, fmtLastSeen } from '../../lib/format';
import { useStore } from '../../lib/store';

export function ConversationInfo({ conversationId, onClose }: { conversationId: number; onClose: () => void }) {
  const conv = useStore((s) => s.conversations[conversationId]);
  const me = useStore((s) => s.me)!;
  const contacts = useStore((s) => s.contacts);
  const toast = useStore((s) => s.toast);
  const loadContacts = useStore((s) => s.loadContacts);
  const syncConversation = useStore((s) => s.syncConversation);
  const navigate = useNavigate();
  const detail = conv?.detail as ConversationDetail;
  const [alias, setAlias] = useState('');
  const [groupName, setGroupName] = useState(detail?.name ?? '');
  const [renaming, setRenaming] = useState(false);
  const [adding, setAdding] = useState(false);
  const [candidates, setCandidates] = useState<PublicUser[] | null>(null);
  const [confirm, setConfirm] = useState<null | { kind: 'leave' } | { kind: 'remove'; userId: number; name: string }>(null);
  const extended = me.role >= ROLES.BETA;

  const other = detail.kind === 'dm' ? detail.members.find((m) => m.userId !== me.id) : undefined;
  const contact = other ? contacts.find((c) => c.kind === 'user' && c.id === other.userId) : undefined;
  const groupContact = detail.kind === 'group' ? contacts.find((c) => c.kind === 'group' && c.id === detail.id) : undefined;
  const isManager = detail.kind === 'group' && (detail.createdBy === me.id || me.role >= ROLES.ADMIN);

  useEffect(() => {
    setAlias(contact?.alias ?? '');
  }, [contact?.alias]);

  useEffect(() => {
    if (!adding) return;
    api.get<{ users: PublicUser[] }>('/api/users').then((r) => setCandidates(r.users.filter((u) => !detail.members.some((m) => m.userId === u.id)))).catch(() => setCandidates([]));
  }, [adding, detail.members]);

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      await Promise.all([loadContacts().catch(() => {}), syncConversation(conversationId)]);
      if (ok) toast(ok, 'success');
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  if (detail.kind === 'dm' && other) {
    const tier = scoreTier(other.gigascore, extended);
    return (
      <Sheet title="Kontakt" onClose={onClose}>
        <div className="profile-hero" style={{ padding: '4px 0 16px' }}>
          <Avatar name={other.username} color={other.color} emoji={other.emoji} size="lg" online={other.online} seed={other.userId} />
          <div className="who">
            <div className="n">{contact?.alias?.trim() || other.username}</div>
            {contact?.alias?.trim() ? <div className="r">@{other.username}</div> : null}
            <div className={`r ${other.online ? 'pill-online' : ''}`}>{fmtLastSeen(other.lastSeen, other.online)}</div>
          </div>
          <ScoreRing score={other.gigascore} size={56} extended={extended} />
        </div>
        <div className="group-list" style={{ marginBottom: 14 }}>
          <div className="row">
            <div className="row-text">
              <div className="t">GigaScore</div>
              <div className="d">{tier.emoji} {tier.label} · {other.gigascore} Punkte</div>
            </div>
          </div>
          <div className="row">
            <div className="row-text">
              <div className="t">Rolle</div>
              <div className="d">{ROLE_LABELS[other.role] ?? 'User'}</div>
            </div>
          </div>
          <div className="row">
            <div className="row-text">
              <div className="t">Nachrichten in diesem Chat</div>
              <div className="d num">{detail.messageCount}</div>
            </div>
          </div>
        </div>

        <div className="field" style={{ marginBottom: 14 }}>
          <label htmlFor="alias">Alias (nur für dich sichtbar)</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input id="alias" className="input" value={alias} maxLength={40} placeholder={other.username} onChange={(e) => setAlias(e.target.value)} />
            <button
              className="btn btn-primary"
              onClick={() => run(() => api.patch(`/api/contacts/${other.userId}`, { alias: alias.trim() || null }), alias.trim() ? 'Alias gespeichert' : 'Alias entfernt')}
            >
              Speichern
            </button>
          </div>
        </div>

        <div className="group-list">
          <div className="row">
            <span className="row-ico"><PinIcon /></span>
            <div className="row-text"><div className="t">Anpinnen</div><div className="d">Bleibt oben in der Liste</div></div>
            <Switch checked={!!contact?.pinned} label="Anpinnen" onChange={(v) => run(() => api.patch(`/api/contacts/${other.userId}`, { pinned: v }))} />
          </div>
          <div className="row">
            <span className="row-ico"><ArchiveIcon /></span>
            <div className="row-text"><div className="t">Archivieren</div><div className="d">Wandert in den Archiv-Ordner, keine Badges</div></div>
            <Switch checked={!!contact?.archived} label="Archivieren" onChange={(v) => run(() => api.patch(`/api/contacts/${other.userId}`, { archived: v }))} />
          </div>
        </div>
      </Sheet>
    );
  }

  // ----- group -----
  return (
    <>
      <Sheet title="Gruppe" onClose={onClose}>
        <div className="profile-hero" style={{ padding: '4px 0 16px' }}>
          <Avatar name={detail.name} kind="group" size="lg" />
          <div className="who">
            {renaming ? (
              <div style={{ display: 'flex', gap: 6 }}>
                <input className="input" value={groupName} maxLength={60} onChange={(e) => setGroupName(e.target.value)} autoFocus />
                <button className="btn btn-primary btn-sm" onClick={() => run(() => api.patch(`/api/groups/${detail.id}`, { name: groupName.trim() }), 'Umbenannt').then(() => setRenaming(false))}>OK</button>
              </div>
            ) : (
              <div className="n">
                {detail.name}
                {isManager ? (
                  <button className="icon-btn icon-btn-sm" aria-label="Gruppe umbenennen" onClick={() => setRenaming(true)}><EditIcon /></button>
                ) : null}
              </div>
            )}
            <div className="r">{detail.members.length} Mitglieder · erstellt {fmtDateTime(detail.createdAt)}</div>
          </div>
          <span className="score-pill" title="Gruppen-Score"><span aria-hidden="true">🏅</span><span className="num">{detail.score}</span></span>
        </div>

        <div className="group-list" style={{ marginBottom: 14 }}>
          <div className="row">
            <span className="row-ico"><PinIcon /></span>
            <div className="row-text"><div className="t">Anpinnen</div></div>
            <Switch checked={!!groupContact?.pinned} label="Anpinnen" onChange={(v) => run(() => api.patch(`/api/conversations/${detail.id}/membership`, { pinned: v }))} />
          </div>
          <div className="row">
            <span className="row-ico"><ArchiveIcon /></span>
            <div className="row-text"><div className="t">Archivieren</div></div>
            <Switch checked={!!groupContact?.archived} label="Archivieren" onChange={(v) => run(() => api.patch(`/api/conversations/${detail.id}/membership`, { archived: v }))} />
          </div>
        </div>

        <h3 style={{ margin: '8px 0 6px' }}>Mitglieder</h3>
        <ul>
          {detail.members.map((m) => {
            const t = scoreTier(m.gigascore, extended);
            return (
              <li key={m.userId} className="member-row">
                <Avatar name={m.username} color={m.color} emoji={m.emoji} size="sm" online={m.online} seed={m.userId} />
                <div className="who">
                  <div className="n">
                    {m.alias?.trim() || m.username}
                    {m.userId === me.id ? <span className="tag">du</span> : null}
                    {m.userId === detail.createdBy ? <span className="tag accent">Ersteller</span> : null}
                  </div>
                  <div className="s">{t.emoji} {m.gigascore} · {fmtLastSeen(m.lastSeen, m.online)}</div>
                </div>
                {m.userId !== me.id ? (
                  <button className="btn btn-ghost btn-sm" onClick={() => { onClose(); navigate(`/u/${m.userId}`); }}>Chat</button>
                ) : null}
                {isManager && m.userId !== me.id ? (
                  <button className="icon-btn icon-btn-sm" aria-label={`${m.username} entfernen`} onClick={() => setConfirm({ kind: 'remove', userId: m.userId, name: m.alias?.trim() || m.username })}>
                    <TrashIcon />
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>

        {isManager ? (
          <div style={{ marginTop: 10 }}>
            {!adding ? (
              <button className="btn btn-outline" onClick={() => setAdding(true)}><UserPlusIcon width={18} height={18} /> Mitglied hinzufügen</button>
            ) : (
              <div className="group-list">
                {candidates === null ? <div className="row"><span className="muted">Lädt…</span></div> : null}
                {candidates?.length === 0 ? <div className="row"><span className="muted">Alle sind schon dabei.</span></div> : null}
                {candidates?.map((u) => (
                  <button key={u.id} className="row clickable" onClick={() => run(() => api.post(`/api/groups/${detail.id}/members`, { userId: u.id }), `${u.username} hinzugefügt`).then(() => setAdding(false))}>
                    <Avatar name={u.username} color={u.color} emoji={u.emoji} size="sm" seed={u.id} />
                    <div className="row-text"><div className="t">{u.username}</div></div>
                    <UserPlusIcon className="chev" />
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : null}

        <div className="group-list" style={{ marginTop: 18 }}>
          <button className="row clickable danger" onClick={() => setConfirm({ kind: 'leave' })}>
            <span className="row-ico"><LogoutIcon /></span>
            <div className="row-text"><div className="t">Gruppe verlassen</div></div>
          </button>
        </div>
      </Sheet>

      {confirm?.kind === 'leave' ? (
        <Confirm
          title="Gruppe verlassen?"
          text="Du bekommst keine Nachrichten dieser Gruppe mehr. Ein Mitglied kann dich später wieder hinzufügen."
          confirmLabel="Verlassen"
          danger
          onClose={() => setConfirm(null)}
          onConfirm={() =>
            run(() => api.post(`/api/groups/${detail.id}/leave`, {}), 'Gruppe verlassen').then(() => {
              onClose();
              navigate('/');
            })
          }
        />
      ) : null}
      {confirm?.kind === 'remove' ? (
        <Confirm
          title={`${confirm.name} entfernen?`}
          text="Die Person sieht die Gruppe danach nicht mehr."
          confirmLabel="Entfernen"
          danger
          onClose={() => setConfirm(null)}
          onConfirm={() => run(() => api.delete(`/api/groups/${detail.id}/members/${confirm.userId}`), `${confirm.name} entfernt`)}
        />
      ) : null}
    </>
  );
}
