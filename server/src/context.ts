import type { Db } from './db';
import type { Env } from './env';
import { RateLimiter } from './lib/ratelimit';
import type { ConversationService } from './modules/conversations/service';
import type { PlaceService } from './modules/place/service';
import type { PushService } from './push/push';
import type { Hub } from './realtime/hub';

export interface AppContext {
  env: Env;
  db: Db;
  hub: Hub;
  push: PushService;
  conversations: ConversationService;
  place: PlaceService;
  uploadsDir: string;
  limits: {
    login: RateLimiter;
    register: RateLimiter;
    send: RateLimiter;
    upload: RateLimiter;
    general: RateLimiter;
  };
}

export function createLimits(): AppContext['limits'] {
  return {
    login: new RateLimiter(20, 15 * 60_000),
    register: new RateLimiter(5, 60 * 60_000),
    send: new RateLimiter(20, 10_000),
    upload: new RateLimiter(20, 60_000),
    general: new RateLimiter(600, 60_000),
  };
}
