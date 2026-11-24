import { nextScoreTier, scoreTier, type Contact } from '@gigachat/shared';
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { colorFor, initials } from '../lib/format';
import { useStore } from '../lib/store';
import { UsersIcon, XIcon } from './icons';

/* ---------- Avatar ---------- */
export function Avatar({
  name,
  color,
  emoji,
  kind = 'user',
  size = 'md',
  online,
  seed,
}: {
  name: string;
  color?: string | null;
  emoji?: string | null;
  kind?: 'user' | 'group';
  size?: 'sm' | 'md' | 'lg';
  online?: boolean;
  seed?: string | number;
}) {
  const cls = `avatar ${kind === 'group' ? 'group' : ''} ${size === 'md' ? '' : size}`;
  if (kind === 'group') {
    return (
      <span className={cls} aria-hidden="true">
        <UsersIcon width={size === 'lg' ? 30 : size === 'sm' ? 15 : 20} height={size === 'lg' ? 30 : size === 'sm' ? 15 : 20} />
      </span>
    );
  }
  const bg = color || colorFor(seed ?? name);
  return (
    <span className={cls} style={{ background: emoji ? 'var(--surface-3)' : bg }} aria-hidden="true">
      {emoji ? <span className="emoji">{emoji}</span> : initials(name)}
      {online ? <span className="dot" /> : null}
    </span>
  );
}

export function contactAvatarProps(c: Contact) {
  return c.kind === 'group'
    ? { name: c.name, kind: 'group' as const }
    : { name: c.username ?? c.name, color: c.color, emoji: c.emoji, online: c.online, seed: c.id };
}

/* ---------- Score ring ---------- */
export function ScoreRing({ score, size = 40, extended = false }: { score: number; size?: number; extended?: boolean }) {
  const tier = scoreTier(score, extended);
  const next = nextScoreTier(score, extended);
  const span = next ? next.min - tier.min : 1;
  const progress = next ? Math.min(1, (score - tier.min) / span) : 1;
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  return (
    <span className="score-ring" style={{ width: size, height: size }} title={`${tier.label} · ${score} GigaScore${next ? ` · ${next.min - score} bis ${next.label}` : ''}`}>
      <svg width={size} height={size}>
        <circle className="track" cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth="3" />
        <circle className="bar" cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth="3" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - progress)} />
      </svg>
      <span className="tier">{tier.emoji}</span>
    </span>
  );
}

export function ScorePill({ score, extended = false }: { score: number; extended?: boolean }) {
  const tier = scoreTier(score, extended);
  return (
    <span className="score-pill" title={`${tier.label} – GigaScore`}>
      <span aria-hidden="true">{tier.emoji}</span>
      <span className="num">{score}</span>
    </span>
  );
}

/* ---------- Switch ---------- */
export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} className="switch" onClick={() => onChange(!checked)} />;
}

/* ---------- Spinner ---------- */
export function Spinner({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-label="Lädt" role="img">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
        <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite" />
      </path>
    </svg>
  );
}

/* ---------- Empty state ---------- */
export function Empty({ icon, title, text, action }: { icon: ReactNode; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="glyph">{icon}</div>
      <h2>{title}</h2>
      {text ? <p>{text}</p> : null}
      {action}
    </div>
  );
}

/* ---------- Sheet (bottom sheet on phones, centered dialog on desktop) ---------- */
export function Sheet({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    ref.current?.querySelector<HTMLElement>('input, textarea, button:not(.icon-btn)')?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return createPortal(
    <>
      <div className="scrim" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="grab" />
        <div className="sheet-header">
          <h2>{title}</h2>
          <button className="icon-btn icon-btn-sm" onClick={onClose} aria-label="Schließen">
            <XIcon />
          </button>
        </div>
        <div className="sheet-body">{children}</div>
        {footer}
      </div>
    </>,
    document.body,
  );
}

/* ---------- Context menu ---------- */
export interface MenuItem {
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  onClick: () => void;
}

export function ContextMenu({ x, y, items, info, onClose }: { x: number; y: number; items: MenuItem[]; info?: string; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const nx = Math.min(x, window.innerWidth - rect.width - 8);
    const ny = Math.min(y, window.innerHeight - rect.height - 8);
    el.style.left = `${Math.max(8, nx)}px`;
    el.style.top = `${Math.max(8, ny)}px`;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [x, y, onClose]);
  return createPortal(
    <>
      <div className="scrim" style={{ background: 'transparent' }} onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
      <div className="menu" ref={ref} role="menu" style={{ left: x, top: y }}>
        {info ? <div className="menu-info">{info}</div> : null}
        {items.map((it) => (
          <button key={it.label} role="menuitem" className={it.danger ? 'danger' : ''} onClick={() => { it.onClick(); onClose(); }}>
            {it.icon}
            {it.label}
          </button>
        ))}
      </div>
    </>,
    document.body,
  );
}

/* ---------- Toasts ---------- */
export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);
  if (!toasts.length) return null;
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} onClick={() => dismiss(t.id)}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

/* ---------- Confirm (uses Sheet) ---------- */
export function Confirm({
  title,
  text,
  confirmLabel = 'Bestätigen',
  danger,
  onConfirm,
  onClose,
}: {
  title: string;
  text: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet title={title} onClose={onClose}>
      <p className="muted" style={{ marginBottom: 18 }}>{text}</p>
      <div className="inline-actions" style={{ justifyContent: 'flex-end' }}>
        <button className="btn" onClick={onClose}>Abbrechen</button>
        <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => { onConfirm(); onClose(); }}>
          {confirmLabel}
        </button>
      </div>
    </Sheet>
  );
}
