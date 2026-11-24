export const APP_VERSION = '4.0.0';

export const USERNAME_RE = /^[A-Za-z0-9_.-]{3,30}$/;
export const PASSWORD_MIN = 8;
export const MESSAGE_MAX = 4000;
export const ALIAS_MAX = 40;
export const NOTES_MAX = 50_000;
export const GROUP_NAME_MIN = 3;
export const GROUP_NAME_MAX = 60;
export const UPLOAD_MAX_BYTES = 20 * 1024 * 1024;
export const MESSAGE_PAGE_SIZE = 25;
export const ONLINE_WINDOW_SECONDS = 90;
export const PLACE_SIZE = 200;
export const PLACE_COOLDOWN_SECONDS = 60;

export const ROLES = { USER: 0, BETA: 1, ADMIN: 2, OWNER: 3 } as const;
export type Role = (typeof ROLES)[keyof typeof ROLES];

export const ROLE_LABELS: Record<number, string> = {
  0: 'User',
  1: 'Beta-Tester',
  2: 'Admin',
  3: 'Owner',
};

export const THEMES = [
  'default',
  'purple',
  'ocean',
  'forest',
  'sunset',
  'cyber',
  'midnight_cherry',
  'aurora_borealis',
] as const;
export type Theme = (typeof THEMES)[number];

export const THEME_LABELS: Record<Theme, string> = {
  default: 'Indigo',
  purple: 'Purple',
  ocean: 'Ocean',
  forest: 'Forest',
  sunset: 'Sunset',
  cyber: 'Cyber',
  midnight_cherry: 'Midnight Cherry',
  aurora_borealis: 'Aurora Borealis',
};

export const ALLOWED_UPLOAD_EXTENSIONS = [
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'heic',
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'zip',
] as const;

export const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic'] as const;

export interface ScoreTier {
  min: number;
  emoji: string;
  label: string;
}

/** Standard tiers (documented in the 3.0 release notes). */
export const SCORE_TIERS: ScoreTier[] = [
  { min: 5000, emoji: '👑', label: 'Legende' },
  { min: 1500, emoji: '💎', label: 'Elite' },
  { min: 600, emoji: '⭐', label: 'Pro' },
  { min: 200, emoji: '🔥', label: 'Sehr aktiv' },
  { min: 50, emoji: '⚡', label: 'Aktiv' },
  { min: 0, emoji: '🌱', label: 'Start' },
];

/** Extended tiers (visible to beta testers and above). */
export const SCORE_TIERS_EXTENDED: ScoreTier[] = [
  { min: 6400, emoji: '💠', label: 'Transzendent' },
  { min: 5600, emoji: '🐉', label: 'Drache' },
  { min: 4900, emoji: '👑', label: 'Legende' },
  { min: 4200, emoji: '💎', label: 'Elite' },
  { min: 3600, emoji: '🦅', label: 'Adler' },
  { min: 3000, emoji: '🏆', label: 'Champion' },
  { min: 2400, emoji: '🎮', label: 'Gamer' },
  { min: 1900, emoji: '🧠', label: 'Genie' },
  { min: 1400, emoji: '🚀', label: 'Rakete' },
  { min: 1000, emoji: '🔥', label: 'Feuer' },
  { min: 700, emoji: '⚡', label: 'Blitz' },
  { min: 500, emoji: '🍗', label: 'Hähnchen' },
  { min: 400, emoji: '🐔', label: 'Huhn' },
  { min: 300, emoji: '🐥', label: 'Küken' },
  { min: 200, emoji: '🌲', label: 'Baum' },
  { min: 100, emoji: '🪴', label: 'Pflanze' },
  { min: 50, emoji: '🍀', label: 'Kleeblatt' },
  { min: 10, emoji: '🌱', label: 'Keimling' },
  { min: 0, emoji: '🍼', label: 'Neuling' },
];

export function scoreTier(score: number, extended = false): ScoreTier {
  const tiers = extended ? SCORE_TIERS_EXTENDED : SCORE_TIERS;
  return tiers.find((t) => score >= t.min) ?? tiers[tiers.length - 1];
}

export function nextScoreTier(score: number, extended = false): ScoreTier | null {
  const tiers = extended ? SCORE_TIERS_EXTENDED : SCORE_TIERS;
  const above = [...tiers].reverse().find((t) => t.min > score);
  return above ?? null;
}

export const PLACE_PALETTE = [
  '#ffffff', '#e4e4e7', '#71717a', '#18181b',
  '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899',
  '#92400e', '#14b8a6', '#a3e635', '#f43f5e',
] as const;
