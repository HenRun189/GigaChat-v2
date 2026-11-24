import fastifyCookie from '@fastify/cookie';
import fastifyMultipart from '@fastify/multipart';
import fastifyWebsocket from '@fastify/websocket';
import { UPLOAD_MAX_BYTES } from '@gigachat/shared';
import Fastify, { type FastifyInstance } from 'fastify';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createLimits, type AppContext } from './context';
import { createDb, type DbHandle } from './db';
import { readEnv, type Env } from './env';
import { AppError } from './lib/errors';
import { adminRoutes } from './modules/admin/routes';
import { authRoutes } from './modules/auth/routes';
import { bugRoutes } from './modules/bugs/routes';
import { contactRoutes } from './modules/contacts/routes';
import { conversationRoutes } from './modules/conversations/routes';
import { ConversationService } from './modules/conversations/service';
import { groupRoutes } from './modules/groups/routes';
import { notesRoutes } from './modules/notes/routes';
import { placeRoutes } from './modules/place/routes';
import { PlaceService } from './modules/place/service';
import { pushRoutes } from './modules/push/routes';
import { statsRoutes } from './modules/stats/routes';
import { userRoutes } from './modules/users/routes';
import { authPlugin } from './plugins/auth';
import { securityPlugin } from './plugins/security';
import { PushService, resolveVapidKeys } from './push/push';
import { Hub } from './realtime/hub';
import { registerWebsocket } from './realtime/ws';
import { registerStatic } from './static';

export interface BuildOptions {
  env?: Partial<Env>;
  db?: DbHandle;
  memoryDb?: boolean;
  serveStatic?: boolean;
  logger?: boolean;
}

export interface BuiltApp {
  app: FastifyInstance;
  ctx: AppContext;
  close: () => Promise<void>;
}

export async function buildApp(opts: BuildOptions = {}): Promise<BuiltApp> {
  const env = readEnv(opts.env);
  mkdirSync(env.dataDir, { recursive: true });
  const uploadsDir = join(env.dataDir, 'uploads');
  mkdirSync(uploadsDir, { recursive: true });

  const handle = opts.db ?? (await createDb(opts.memoryDb ? { memory: true } : { url: env.databaseUrl, dataDir: env.dataDir }));
  const db = handle.db;

  const app = Fastify({
    logger:
      opts.logger ?? env.nodeEnv !== 'test'
        ? { level: env.isProd ? 'info' : 'debug', ...(env.isProd ? {} : { transport: undefined }) }
        : false,
    trustProxy: env.trustProxy,
    bodyLimit: 1024 * 1024,
    disableRequestLogging: env.isProd,
  });

  await app.register(fastifyCookie);
  await app.register(fastifyWebsocket, { options: { maxPayload: 64 * 1024 } });
  await app.register(fastifyMultipart, { limits: { fileSize: UPLOAD_MAX_BYTES, files: 1, fields: 5 } });

  const hub = new Hub();
  const push = new PushService(db, hub, env, resolveVapidKeys(env), app.log);
  const conversations = new ConversationService(db, hub, push);
  const place = new PlaceService(db, hub);
  await place.load();

  const ctx: AppContext = { env, db, hub, push, conversations, place, uploadsDir, limits: createLimits() };

  app.setErrorHandler((rawErr: unknown, req, reply) => {
    const err = rawErr as Error & { code?: string; statusCode?: number };
    if (err instanceof AppError) {
      return reply.code(err.status).send({ error: { code: err.code, message: err.message, details: err.details ?? undefined } });
    }
    const code = (err as { code?: string }).code;
    if (code === 'FST_REQ_FILE_TOO_LARGE') {
      return reply.code(413).send({ error: { code: 'too_large', message: 'Datei zu groß' } });
    }
    if (code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE' || code === 'FST_ERR_CTP_EMPTY_JSON_BODY' || code === 'FST_ERR_CTP_INVALID_JSON_BODY') {
      return reply.code(400).send({ error: { code: 'bad_request', message: 'Ungültiger Request-Body' } });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      return reply.code(status).send({ error: { code: 'bad_request', message: err.message } });
    }
    req.log.error({ err }, 'unhandled error');
    return reply.code(500).send({ error: { code: 'internal', message: 'Interner Fehler' } });
  });

  await app.register(securityPlugin, { ctx });
  await app.register(authPlugin, { ctx });

  app.get('/api/health', async () => ({ ok: true, db: handle.kind, connections: hub.connectionCount }));

  authRoutes(app, ctx);
  userRoutes(app, ctx);
  contactRoutes(app, ctx);
  conversationRoutes(app, ctx);
  groupRoutes(app, ctx);
  notesRoutes(app, ctx);
  pushRoutes(app, ctx);
  statsRoutes(app, ctx);
  bugRoutes(app, ctx);
  adminRoutes(app, ctx);
  placeRoutes(app, ctx);
  registerWebsocket(app, ctx);

  if (opts.serveStatic !== false) await registerStatic(app, ctx);

  app.addHook('onClose', async () => {
    await place.flush();
    if (!opts.db) await handle.close();
  });

  return { app, ctx, close: () => app.close() };
}
