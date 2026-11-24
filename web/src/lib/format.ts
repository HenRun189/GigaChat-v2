const timeFmt = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
const shortDayFmt = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit' });
const weekdayFmt = new Intl.DateTimeFormat('de-DE', { weekday: 'short' });
const dateTimeFmt = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export const fmtTime = (iso: string) => timeFmt.format(new Date(iso));
export const fmtDateTime = (iso: string) => dateTimeFmt.format(new Date(iso));

export function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function fmtDay(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round((today.getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86_400_000);
  if (diffDays === 0) return 'Heute';
  if (diffDays === 1) return 'Gestern';
  return dayFmt.format(d);
}

/** Compact timestamp for list rows: time today, weekday this week, date otherwise. */
export function fmtListTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (dayKey(iso) === dayKey(now.toISOString())) return timeFmt.format(d);
  if (diff < 6 * 86_400_000) return weekdayFmt.format(d);
  return shortDayFmt.format(d);
}

export function fmtLastSeen(lastSeen: string | null, online: boolean): string {
  if (online) return 'online';
  if (!lastSeen) return 'noch nie online';
  const seconds = (Date.now() - new Date(lastSeen).getTime()) / 1000;
  if (seconds < 90) return 'gerade eben online';
  if (seconds < 3600) return `zuletzt vor ${Math.floor(seconds / 60)} Min`;
  const d = new Date(lastSeen);
  if (dayKey(lastSeen) === dayKey(new Date().toISOString())) return `zuletzt um ${timeFmt.format(d)}`;
  return `zuletzt ${shortDayFmt.format(d)} · ${timeFmt.format(d)}`;
}

export function fmtBytes(n: number | null): string {
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export const fmtNumber = (n: number) => new Intl.NumberFormat('de-DE').format(n);

const URL_RE = /((?:https?:\/\/|www\.)[^\s<]+[^\s<.,;:!?)\]'"])/gi;

export interface TextPart {
  type: 'text' | 'link';
  value: string;
  href?: string;
}

export function linkify(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) parts.push({ type: 'text', value: text.slice(last, idx) });
    const raw = m[0];
    parts.push({ type: 'link', value: raw, href: raw.startsWith('http') ? raw : `https://${raw}` });
    last = idx + raw.length;
  }
  if (last < text.length) parts.push({ type: 'text', value: text.slice(last) });
  return parts;
}

export function initials(name: string): string {
  const clean = name.replace(/[^\p{L}\p{N} ]/gu, '').trim();
  if (!clean) return '?';
  const parts = clean.split(/\s+/);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : clean.slice(0, 2)).toUpperCase();
}

/** Deterministic pastel from a string, used when a user has no colour set. */
export function colorFor(seed: string | number): string {
  let h = 0;
  const s = String(seed);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 55% 58%)`;
}
