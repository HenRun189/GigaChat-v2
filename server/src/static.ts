import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AppContext } from './context';

export function findWebDist(): string | null {
  if (process.env.WEB_DIST && existsSync(join(process.env.WEB_DIST, 'index.html'))) return resolve(process.env.WEB_DIST);
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(process.cwd(), 'web', 'dist'),
    resolve(process.cwd(), '..', 'web', 'dist'),
    join(here, '..', '..', 'web', 'dist'),
    join(here, '..', 'web', 'dist'),
    join(here, 'public'),
  ];
  for (const c of candidates) if (existsSync(join(c, 'index.html'))) return c;
  return null;
}

export async function registerStatic(app: FastifyInstance, ctx: AppContext): Promise<void> {
  await app.register(fastifyStatic, {
    root: ctx.uploadsDir,
    prefix: '/uploads/',
    decorateReply: false,
    index: false,
    list: false,
    dotfiles: 'deny',
    maxAge: '365d',
    immutable: true,
    setHeaders(res) {
      res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox");
      res.setHeader('X-Content-Type-Options', 'nosniff');
    },
  });

  const webDist = findWebDist();
  if (!webDist) {
    app.log.warn('web/dist not found – API only (run `pnpm build` to serve the PWA)');
    return;
  }

  await app.register(fastifyStatic, {
    root: webDist,
    prefix: '/',
    wildcard: false,
    index: false,
    setHeaders(res, path) {
      if (/[\\/]assets[\\/]/.test(path)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      } else if (/sw\.js$|workbox-.*\.js$|manifest\.webmanifest$|index\.html$/.test(path)) {
        res.setHeader('Cache-Control', 'no-cache');
        if (path.endsWith('sw.js')) res.setHeader('Service-Worker-Allowed', '/');
      } else {
        res.setHeader('Cache-Control', 'public, max-age=3600');
      }
    },
  });

  app.setNotFoundHandler(async (req, reply) => {
    if (req.url.startsWith('/api/') || req.url.startsWith('/uploads/')) {
      return reply.code(404).send({ error: { code: 'not_found', message: 'Nicht gefunden' } });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return reply.code(404).send({ error: { code: 'not_found', message: 'Nicht gefunden' } });
    }
    reply.header('Cache-Control', 'no-cache');
    return reply.sendFile('index.html');
  });
}
