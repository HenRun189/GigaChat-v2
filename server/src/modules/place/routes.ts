import { PLACE_COOLDOWN_SECONDS, PLACE_SIZE, placePixelSchema, type PlaceLeaderboardEntry } from '@gigachat/shared';
import { desc, gt } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../context';
import { schema } from '../../db';
import { parse } from '../../lib/validate';
import { requireAuth } from '../../plugins/auth';

export function placeRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db, place } = ctx;

  app.get('/api/place/canvas', async (req, reply) => {
    requireAuth(req);
    reply.header('Cache-Control', 'no-store');
    reply.header('X-Place-Size', String(PLACE_SIZE));
    return reply.type('application/octet-stream').send(Buffer.from(place.pixels));
  });

  app.get('/api/place/me', async (req) => {
    const me = requireAuth(req);
    const cooldown = await place.cooldownRemaining(me.id);
    return { pixelsSet: me.pixelsSet, cooldown, cooldownTotal: PLACE_COOLDOWN_SECONDS };
  });

  app.get('/api/place/leaderboard', async (req) => {
    requireAuth(req);
    const rows = await db
      .select({ id: schema.users.id, username: schema.users.username, pixelsSet: schema.users.pixelsSet })
      .from(schema.users)
      .where(gt(schema.users.pixelsSet, 0))
      .orderBy(desc(schema.users.pixelsSet))
      .limit(10);
    const leaderboard: PlaceLeaderboardEntry[] = rows;
    return { leaderboard };
  });

  app.post('/api/place/pixel', async (req) => {
    const me = requireAuth(req);
    const input = parse(placePixelSchema, req.body);
    return place.setPixel(me.id, input.x, input.y, input.color);
  });
}
