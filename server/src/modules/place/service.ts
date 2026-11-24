import { PLACE_COOLDOWN_SECONDS, PLACE_SIZE } from '@gigachat/shared';
import { eq, sql } from 'drizzle-orm';
import type { Db } from '../../db';
import { schema } from '../../db';
import { AppError } from '../../lib/errors';
import type { Hub } from '../../realtime/hub';

const BYTES = PLACE_SIZE * PLACE_SIZE * 3;

export class PlaceService {
  pixels: Buffer = Buffer.alloc(BYTES, 0xff);
  private dirty = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly db: Db,
    private readonly hub: Hub,
  ) {}

  async load(): Promise<void> {
    const rows = await this.db.select().from(schema.placeCanvas).where(eq(schema.placeCanvas.id, 1)).limit(1);
    const row = rows[0];
    if (row && row.pixels && row.pixels.length === BYTES) {
      this.pixels = Buffer.from(row.pixels);
    } else {
      await this.db
        .insert(schema.placeCanvas)
        .values({ id: 1, pixels: this.pixels })
        .onConflictDoUpdate({ target: schema.placeCanvas.id, set: { pixels: this.pixels, updatedAt: new Date() } });
    }
  }

  async cooldownRemaining(userId: number): Promise<number> {
    const rows = await this.db.select({ at: schema.users.lastPixelAt }).from(schema.users).where(eq(schema.users.id, userId)).limit(1);
    const at = rows[0]?.at;
    if (!at) return 0;
    const elapsed = (Date.now() - at.getTime()) / 1000;
    return Math.max(0, Math.ceil(PLACE_COOLDOWN_SECONDS - elapsed));
  }

  async setPixel(userId: number, x: number, y: number, color: string): Promise<{ pixelsSet: number; cooldown: number }> {
    const remaining = await this.cooldownRemaining(userId);
    if (remaining > 0) throw new AppError(429, 'cooldown', `Noch ${remaining}s Abklingzeit`, { seconds: remaining });

    const i = (y * PLACE_SIZE + x) * 3;
    const hex = color.slice(1);
    this.pixels[i] = Number.parseInt(hex.slice(0, 2), 16);
    this.pixels[i + 1] = Number.parseInt(hex.slice(2, 4), 16);
    this.pixels[i + 2] = Number.parseInt(hex.slice(4, 6), 16);
    this.dirty = true;
    this.schedulePersist();

    const updated = await this.db
      .update(schema.users)
      .set({ pixelsSet: sql`${schema.users.pixelsSet} + 1`, lastPixelAt: new Date() })
      .where(eq(schema.users.id, userId))
      .returning({ pixelsSet: schema.users.pixelsSet });

    this.hub.broadcast({ t: 'place.pixel', x, y, color: color.toLowerCase(), userId });
    return { pixelsSet: updated[0]?.pixelsSet ?? 0, cooldown: PLACE_COOLDOWN_SECONDS };
  }

  private schedulePersist(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, 2000);
    this.timer.unref();
  }

  async flush(): Promise<void> {
    if (!this.dirty) return;
    this.dirty = false;
    try {
      await this.db
        .update(schema.placeCanvas)
        .set({ pixels: Buffer.from(this.pixels), updatedAt: new Date() })
        .where(eq(schema.placeCanvas.id, 1));
    } catch {
      this.dirty = true;
    }
  }
}
