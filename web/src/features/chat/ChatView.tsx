import { ROLES } from '@gigachat/shared';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { BackIcon, InfoIcon } from '../../components/icons';
import { Avatar, ScoreRing, Spinner } from '../../components/ui';
import { errorMessage } from '../../lib/api';
import { fmtLastSeen } from '../../lib/format';
import { useStore } from '../../lib/store';
import { sendFocus } from '../../lib/ws';
import { useIsMobile } from '../../app/Shell';
import { Composer } from './Composer';
import { ConversationInfo } from './ConversationInfo';
import { MessageList } from './MessageList';

export function ChatView({ conversationId }: { conversationId: number }) {
  const conv = useStore((s) => s.conversations[conversationId]);
  const me = useStore((s) => s.me)!;
  const typing = useStore((s) => s.typing[conversationId]);
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [info, setInfo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, tick] = useState(0);

  useEffect(() => {
    const s = useStore.getState();
    s.setActiveConversation(conversationId);
    sendFocus();
    s.openConversation(conversationId)
      .then(() => useStore.getState().markConversationRead(conversationId))
      .catch((e) => setError(errorMessage(e)));
    return () => {
      const st = useStore.getState();
      if (st.activeConversationId === conversationId) st.setActiveConversation(null);
      sendFocus();
    };
  }, [conversationId]);

  // Re-render every second while someone is typing so the indicator expires.
  useEffect(() => {
    if (!typing) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [typing]);

  const openInfo = useCallback(() => setInfo(true), []);
  const closeInfo = useCallback(() => setInfo(false), []);

  const detail = conv?.detail;
  const other = detail?.kind === 'dm' ? detail.members.find((m) => m.userId !== me.id) : undefined;
  const typists = typing
    ? Object.entries(typing)
        .filter(([uid, ts]) => Number(uid) !== me.id && Date.now() - ts < 4000)
        .map(([uid]) => detail?.members.find((m) => m.userId === Number(uid)))
        .filter((m): m is NonNullable<typeof m> => !!m)
    : [];

  let sub = '';
  let subCls = '';
  if (typists.length) {
    sub = detail?.kind === 'group' ? `${typists.map((t) => t.alias?.trim() || t.username).join(', ')} schreibt…` : 'schreibt…';
    subCls = 'typing';
  } else if (detail?.kind === 'dm' && other) {
    sub = fmtLastSeen(other.lastSeen, other.online);
    subCls = other.online ? 'online' : '';
  } else if (detail?.kind === 'group') {
    const online = detail.members.filter((m) => m.online && m.userId !== me.id).length;
    sub = `${detail.members.length} Mitglieder${online ? ` · ${online} online` : ''}`;
  }

  return (
    <div className="pane chat-pane" style={{ height: '100dvh' }}>
      <header className="chat-header">
        {isMobile ? (
          <button className="icon-btn" aria-label="Zurück zu den Chats" onClick={() => navigate('/')}>
            <BackIcon />
          </button>
        ) : null}
        <button className="title" onClick={openInfo} aria-label="Chat-Details öffnen">
          {detail ? (
            detail.kind === 'group' ? (
              <Avatar name={detail.name} kind="group" />
            ) : (
              <Avatar name={other?.username ?? detail.name} color={other?.color} emoji={other?.emoji} online={other?.online} seed={other?.userId} />
            )
          ) : (
            <span className="avatar" />
          )}
          <span className="text">
            <span className="name truncate">{detail?.name ?? '…'}</span>
            <span className={`sub truncate ${subCls}`}>{sub}</span>
          </span>
        </button>
        {detail?.kind === 'dm' && other ? (
          <ScoreRing score={other.gigascore} extended={me.role >= ROLES.BETA} />
        ) : detail?.kind === 'group' ? (
          <span className="score-pill" title="Gruppen-Score: Nachrichten in dieser Gruppe">
            <span aria-hidden="true">🏅</span>
            <span className="num">{detail.score}</span>
          </span>
        ) : null}
        <button className="icon-btn" aria-label="Details" onClick={openInfo}>
          <InfoIcon />
        </button>
      </header>

      {error ? (
        <div className="empty">
          <h2>Chat konnte nicht geladen werden</h2>
          <p>{error}</p>
          <button className="btn" onClick={() => navigate('/')}>Zurück</button>
        </div>
      ) : !conv?.loaded ? (
        <div className="messages" style={{ alignItems: 'center', justifyContent: 'center' }}>
          <Spinner size={28} />
        </div>
      ) : (
        <MessageList conversationId={conversationId} />
      )}

      <Composer conversationId={conversationId} disabled={!conv?.loaded || !!error} />
      {info && detail ? <ConversationInfo conversationId={conversationId} onClose={closeInfo} /> : null}
    </div>
  );
}
