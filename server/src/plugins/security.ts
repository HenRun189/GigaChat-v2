import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import type { AppContext } from '../context';
import { forbidden } from '../lib/errors';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * CSRF + security headers.
 *  - Mutating requests must carry `X-Requested-With: gigachat` (a custom header
 *    can only be set by same-origin scripts or after a CORS preflight, which we
 *    never answer) and, when present, an Origin matching PUBLIC_URL / Host.
 *  - Conservative security headers incl. a CSP that allows Giphy/Tenor media.
 */
export const securityPlugin = fp(async (app: FastifyInstance, opts: { ctx: AppContext }) => {
  const { env } = opts.ctx;
  const allowedOrigins = new Set<string>([env.publicUrl]);
  if (!env.isProd) {
    allowedOrigins.add('http://localhost:5173');
    allowedOrigins.add('http://127.0.0.1:5173');
    allowedOrigins.add(`http://localhost:${env.port}`);
    allowedOrigins.add(`http://127.0.0.1:${env.port}`);
  }

  app.addHook('onRequest', async (req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (env.isProd) reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');

    if (!MUTATING.has(req.method)) return;
    if (!req.url.startsWith('/api/')) return;

    const xrw = req.headers['x-requested-with'];
    if (xrw !== 'gigachat') throw forbidden('CSRF-Schutz: ungültige Anfrage');

    const origin = req.headers.origin;
    if (origin) {
      const host = req.headers.host;
      const sameHost = (() => {
        try {
          return new URL(origin).host === host;
        } catch {
          return false;
        }
      })();
      if (!allowedOrigins.has(origin) && !sameHost) throw forbidden('CSRF-Schutz: Origin nicht erlaubt');
    }
  });

  app.addHook('onSend', async (req, reply, payload) => {
    const type = String(reply.getHeader('content-type') ?? '');
    if (type.includes('text/html')) {
      reply.header(
        'Content-Security-Policy',
        [
          "default-src 'self'",
          "script-src 'self'",
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data: blob: https://*.giphy.com https://media.tenor.com",
          "media-src 'self' blob:",
          "font-src 'self' data:",
          "connect-src 'self' ws: wss: https://api.giphy.com",
          "worker-src 'self'",
          "manifest-src 'self'",
          "frame-ancestors 'none'",
          "base-uri 'self'",
          "form-action 'self'",
        ].join('; '),
      );
    }
    return payload;
  });
});
