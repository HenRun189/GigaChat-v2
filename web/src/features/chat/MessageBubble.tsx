import { scoreTier, type ConversationMember, type Message } from '@gigachat/shared';
import { memo, useRef, type PointerEvent as RPointerEvent } from 'react';
import { CheckIcon, ClockIcon, DoubleCheckIcon, FileIcon } from '../../components/icons';
import { Avatar } from '../../components/ui';
import { colorFor, fmtBytes, fmtTime, linkify } from '../../lib/format';
import type { PendingMessage } from '../../lib/store';

function Text({ body }: { body: string }) {
  const parts = linkify(body);
  return (
    <span className="text">
      {parts.map((p, i) =>
        p.type === 'link' ? (
          <a key={i} href={p.href} target="_blank" rel="noopener noreferrer nofollow">{p.value}</a>
        ) : (
          <span key={i}>{p.value}</span>
        ),
      )}
    </span>
  );
}

interface Props {
  m: Message;
  mine: boolean;
  first: boolean;
  last: boolean;
  isGroup: boolean;
  members: ConversationMember[];
  meId: number;
  extended: boolean;
  onMenu: (m: Message, x: number, y: number) => void;
  onImage: (src: string) => void;
}

export const MessageBubble = memo(function MessageBubble({ m, mine, first, last, isGroup, members, meId, extended, onMenu, onImage }: Props) {
  const sender = members.find((x) => x.userId === m.senderId);
  const senderName = sender ? sender.alias?.trim() || sender.username : 'Unbekannt';
  const senderColor = sender?.color || colorFor(m.senderId ?? 0);
  const readers = members.filter((x) => x.userId !== meId && x.userId !== m.senderId && (x.lastReadMessageId ?? 0) >= m.id);
  const read = mine && readers.length > 0;
  const pressTimer = useRef<number | null>(null);
  const moved = useRef(false);

  const onPointerDown = (e: RPointerEvent) => {
    if (e.pointerType === 'mouse') return;
    moved.current = false;
    const { clientX, clientY } = e;
    pressTimer.current = window.setTimeout(() => {
      if (!moved.current) {
        navigator.vibrate?.(10);
        onMenu(m, clientX, clientY);
      }
    }, 450);
  };
  const cancelPress = () => {
    if (pressTimer.current) clearTimeout(pressTimer.current);
    pressTimer.current = null;
  };

  let content: React.ReactNode;
  let media = false;
  if (m.deletedAt) {
    content = <span className="text">Nachricht gelöscht</span>;
  } else if (m.kind === 'gif' && m.mediaUrl) {
    media = true;
    content = <img className="gif" src={m.mediaUrl} alt="GIF" loading="lazy" decoding="async" referrerPolicy="no-referrer" />;
  } else if (m.kind === 'image' && m.mediaUrl) {
    media = true;
    const ratio = m.mediaWidth && m.mediaHeight ? `${m.mediaWidth} / ${m.mediaHeight}` : undefined;
    content = (
      <img
        className="pic"
        src={m.mediaUrl}
        alt={m.mediaName ?? 'Bild'}
        loading="lazy"
        decoding="async"
        style={ratio ? { aspectRatio: ratio } : undefined}
        onClick={() => onImage(m.mediaUrl!)}
      />
    );
  } else if (m.kind === 'file' && m.mediaUrl) {
    content = (
      <a className="file" href={m.mediaUrl} target="_blank" rel="noopener" download={m.mediaName ?? undefined}>
        <span className="ico"><FileIcon /></span>
        <span>
          <span className="fname truncate" style={{ display: 'block' }}>{m.mediaName ?? 'Datei'}</span>
          <span className="fsize">{fmtBytes(m.mediaSize)}</span>
        </span>
      </a>
    );
  } else {
    content = <Text body={m.body} />;
  }

  return (
    <div className={`msg-row ${mine ? 'me' : 'you'} ${first ? 'first' : ''} ${last ? 'last' : ''}`}>
      {!mine && isGroup ? (
        <span className="gutter">
          <Avatar name={sender?.username ?? '?'} color={sender?.color} emoji={sender?.emoji} size="sm" seed={m.senderId ?? 0} />
        </span>
      ) : null}
      <div
        className={`bubble ${media ? 'media' : ''} ${m.deletedAt ? 'deleted' : ''}`}
        onContextMenu={(e) => {
          e.preventDefault();
          onMenu(m, e.clientX, e.clientY);
        }}
        onPointerDown={onPointerDown}
        onPointerMove={() => { moved.current = true; cancelPress(); }}
        onPointerUp={cancelPress}
        onPointerCancel={cancelPress}
        onPointerLeave={cancelPress}
      >
        {!mine && isGroup && first && !media && !m.deletedAt ? (
          <span className="sender" style={{ color: senderColor }}>
            {sender?.emoji ? `${sender.emoji} ` : ''}{senderName}
            {sender ? <span title={scoreTier(sender.gigascore, extended).label} style={{ marginLeft: 4, fontSize: '0.75rem' }}>{scoreTier(sender.gigascore, extended).emoji}</span> : null}
          </span>
        ) : null}
        {content}
        {!m.deletedAt ? (
          <span className="meta">
            {m.editedAt ? <span>bearbeitet ·</span> : null}
            <span className="num">{fmtTime(m.createdAt)}</span>
            {mine ? (read ? <DoubleCheckIcon className="read" aria-label="gelesen" /> : <CheckIcon aria-label="zugestellt" />) : null}
          </span>
        ) : null}
      </div>
    </div>
  );
});

export function PendingBubble({ p, onRetry }: { p: PendingMessage; onRetry: () => void }) {
  return (
    <div className="msg-row me first last">
      <div className={`bubble pending ${p.failed ? 'failed' : ''}`} onClick={p.failed ? onRetry : undefined} title={p.failed ? 'Erneut senden' : undefined}>
        <Text body={p.body} />
        <span className="meta">
          {p.failed ? <span>Nicht gesendet – tippen zum Wiederholen</span> : null}
          <span className="num">{fmtTime(p.createdAt)}</span>
          <ClockIcon />
        </span>
      </div>
    </div>
  );
}
