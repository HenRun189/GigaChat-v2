import { config as loadDotenv } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Load .env from the repo root or the current working directory (first match wins).
for (const candidate of [resolve(process.cwd(), '.env'), resolve(process.cwd(), '..', '.env')]) {
  if (existsSync(candidate)) {
    loadDotenv({ path: candidate });
    break;
  }
}

function bool(v: string | undefined, fallback = false): boolean {
  if (v === undefined || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

export interface Env {
  nodeEnv: 'development' | 'production' | 'test';
  isProd: boolean;
  host: string;
  port: number;
  publicUrl: string;
  databaseUrl: string | undefined;
  dataDir: string;
  vapidPublicKey: string | undefined;
  vapidPrivateKey: string | undefined;
  vapidSubject: string;
  giphyApiKey: string;
  trustProxy: boolean;
}

export function readEnv(overrides: Partial<Env> = {}): Env {
  const nodeEnv = (process.env.NODE_ENV as Env['nodeEnv']) || 'development';
  const env: Env = {
    nodeEnv,
    isProd: nodeEnv === 'production',
    host: process.env.HOST || '0.0.0.0',
    port: Number(process.env.PORT || 3000),
    publicUrl: (process.env.PUBLIC_URL || 'http://localhost:5173').replace(/\/$/, ''),
    databaseUrl: process.env.DATABASE_URL || undefined,
    dataDir: resolve(process.cwd(), process.env.DATA_DIR || './data'),
    vapidPublicKey: process.env.VAPID_PUBLIC_KEY || undefined,
    vapidPrivateKey: process.env.VAPID_PRIVATE_KEY || undefined,
    vapidSubject: process.env.VAPID_SUBJECT || 'mailto:admin@example.com',
    giphyApiKey: process.env.GIPHY_API_KEY || '',
    trustProxy: bool(process.env.TRUST_PROXY),
    ...overrides,
  };

  if (env.isProd && !env.publicUrl.startsWith('https://') && !process.env.ALLOW_INSECURE) {
    throw new Error('PUBLIC_URL must be https:// in production (set ALLOW_INSECURE=1 to override)');
  }
  return env;
}
