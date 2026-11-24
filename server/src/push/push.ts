import { and, eq, inArray } from 'drizzle-orm';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import webpush from 'web-push';
import type { Db } from '../db';
import { schema } from '../db';
import type { Env } from '../env';
import type { Hub } from '../realtime/hub';

export interface PushPayload {
  title: string;
  body: string;
  conversationId: number;
  tag: string;
  url: string;
  icon?: string;
}

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

export function resolveVapidKeys(env: Env): VapidKeys | null {
  if (env.vapidPublicKey && env.vapidPrivateKey) {
    return { publicKey: env.vapidPublicKey, privateKey: env.vapidPrivateKey };
  }
  if (env.isProd) return null;
  // Development convenience: generate once and persist in DATA_DIR.
  const file = join(env.dataDir, 'vapid.json');
  if (existsSync(file)) {
    try {
      return JSON.parse(readFileSync(file, 'utf8')) as VapidKeys;
    } catch {
      /* regenerate below */
    }
  }
  const keys = webpush.generateVAPIDKeys();
  mkdirSync(env.dataDir, { recursive: true });
  writeFileSync(file, JSON.stringify(keys, null, 2));
  return keys;
}

export class PushService {
  readonly enabled: boolean;
  readonly publicKey: string;

  constructor(
    private readonly db: Db,
    private readonly hub: Hub,
    private readonly env: Env,
    keys: VapidKeys | null,
    private readonly log: { warn: (o: unknown, msg?: string) => void } = console,
  ) {
    this.enabled = !!keys;
    this.publicKey = keys?.publicKey ?? '';
    if (keys) webpush.setVapidDetails(env.vapidSubject, keys.publicKey, keys.privateKey);
  }

  /**
   * Send a push to every member (except `excludeUserId`) that is NOT currently
   * looking at the conversation on any device.
   */
  async notifyMembers(memberIds: number[], excludeUserId: number | null, payload: PushPayload): Promise<void> {
    if (!this.enabled) return;
    const targets = memberIds.filter(
      (id) => id !== excludeUserId && !this.hub.hasVisibleOn(id, payload.conversationId),
    );
    if (targets.length === 0) return;

    const subs = await this.db
      .select()
      .from(schema.pushSubscriptions)
      .where(inArray(schema.pushSubscriptions.userId, targets));
    if (subs.length === 0) return;

    const body = JSON.stringify({ ...payload, icon: payload.icon ?? '/icons/icon-192.png' });
    const stale: number[] = [];

    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            body,
            { TTL: 60 * 60 * 24, urgency: 'high', topic: payload.tag.slice(0, 32) },
          );
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) stale.push(s.id);
          else this.log.warn({ err, endpoint: s.endpoint.slice(0, 60) }, 'push failed');
        }
      }),
    );

    if (stale.length) {
      await this.db.delete(schema.pushSubscriptions).where(inArray(schema.pushSubscriptions.id, stale));
    }
  }

  async removeForUser(userId: number, endpoint?: string): Promise<void> {
    const where = endpoint
      ? and(eq(schema.pushSubscriptions.userId, userId), eq(schema.pushSubscriptions.endpoint, endpoint))
      : eq(schema.pushSubscriptions.userId, userId);
    await this.db.delete(schema.pushSubscriptions).where(where);
  }
}
