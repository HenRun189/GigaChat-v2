import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp, type BuiltApp } from '../src/app';
import { RateLimiter } from '../src/lib/ratelimit';

export interface Session {
  cookie: string;
  user: { id: number; username: string; role: number; gigascore: number };
}

export async function createTestApp(): Promise<BuiltApp> {
  const dataDir = mkdtempSync(join(tmpdir(), 'gigachat-test-'));
  const built = await buildApp({
    memoryDb: true,
    serveStatic: false,
    logger: false,
    env: {
      nodeEnv: 'test',
      isProd: false,
      publicUrl: 'http://localhost:3000',
      dataDir,
      vapidPublicKey: undefined,
      vapidPrivateKey: undefined,
    },
  });
  // Tests hammer the API from one IP; keep the limiter logic but widen the windows.
  built.ctx.limits.register = new RateLimiter(10_000, 60_000);
  built.ctx.limits.login = new RateLimiter(10_000, 60_000);
  built.ctx.limits.send = new RateLimiter(10_000, 60_000);
  return built;
}

export const HEADERS = { 'x-requested-with': 'gigachat', 'content-type': 'application/json' };

export function api(built: BuiltApp) {
  const { app } = built;
  return {
    async post<T = any>(url: string, body: unknown, cookie?: string) {
      const res = await app.inject({ method: 'POST', url, payload: body as object, headers: { ...HEADERS, ...(cookie ? { cookie } : {}) } });
      return { status: res.statusCode, body: res.json() as T, raw: res };
    },
    async patch<T = any>(url: string, body: unknown, cookie?: string) {
      const res = await app.inject({ method: 'PATCH', url, payload: body as object, headers: { ...HEADERS, ...(cookie ? { cookie } : {}) } });
      return { status: res.statusCode, body: res.json() as T, raw: res };
    },
    async put<T = any>(url: string, body: unknown, cookie?: string) {
      const res = await app.inject({ method: 'PUT', url, payload: body as object, headers: { ...HEADERS, ...(cookie ? { cookie } : {}) } });
      return { status: res.statusCode, body: res.json() as T, raw: res };
    },
    async del<T = any>(url: string, body: unknown, cookie?: string) {
      const res = await app.inject({ method: 'DELETE', url, payload: body as object, headers: { ...HEADERS, ...(cookie ? { cookie } : {}) } });
      return { status: res.statusCode, body: res.json() as T, raw: res };
    },
    async get<T = any>(url: string, cookie?: string) {
      const res = await app.inject({ method: 'GET', url, headers: cookie ? { cookie } : {} });
      let body: T | null = null;
      try {
        body = res.json() as T;
      } catch {
        body = null;
      }
      return { status: res.statusCode, body: body as T, raw: res };
    },
  };
}

export async function register(built: BuiltApp, username: string, password = 'password123'): Promise<Session> {
  const res = await built.app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, password, remember: true },
    headers: HEADERS,
  });
  if (res.statusCode !== 201) throw new Error(`register failed: ${res.statusCode} ${res.body}`);
  const cookie = res.cookies.find((c) => c.name === 'gc_session');
  if (!cookie) throw new Error('no session cookie');
  return { cookie: `${cookie.name}=${cookie.value}`, user: res.json().user };
}
