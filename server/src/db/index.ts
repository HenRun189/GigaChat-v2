import { PGlite } from '@electric-sql/pglite';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import * as schema from './schema';

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export interface DbHandle {
  db: Db;
  kind: 'postgres' | 'pglite';
  close: () => Promise<void>;
}

export interface DbOptions {
  url?: string;
  dataDir?: string;
  /** in-memory PGlite (tests) */
  memory?: boolean;
}

/** Opens the data directory in a throw-away child process; false when PGlite aborts on it. */
function pgliteOpens(dir: string): boolean {
  const pgliteUrl = import.meta.resolve('@electric-sql/pglite');
  const script = `
    const { PGlite } = await import(${JSON.stringify(pgliteUrl)});
    const db = new PGlite(${JSON.stringify(dir)});
    await db.query('select 1');
    await db.close();
    process.exit(0);
  `;
  const res = spawnSync(process.execPath, ['--input-type=module', '-e', script], { timeout: 60_000, stdio: 'ignore' });
  return res.status === 0;
}

function findMigrationsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, 'drizzle'), // dist/server.js -> dist/drizzle
    join(here, '..', 'drizzle'), // src/db -> server/drizzle
    join(here, '..', '..', 'drizzle'),
    resolve(process.cwd(), 'drizzle'),
    resolve(process.cwd(), 'server', 'drizzle'),
  ];
  for (const c of candidates) if (existsSync(join(c, 'meta', '_journal.json'))) return c;
  throw new Error('Could not locate the drizzle migrations folder');
}

export async function createDb(opts: DbOptions): Promise<DbHandle> {
  const migrationsFolder = findMigrationsDir();

  if (opts.url) {
    const pool = new pg.Pool({ connectionString: opts.url, max: 10 });
    const db = drizzlePg(pool, { schema });
    await migratePg(db, { migrationsFolder });
    return { db: db as unknown as Db, kind: 'postgres', close: () => pool.end() };
  }

  if (opts.memory) {
    const client = new PGlite();
    const db = drizzlePglite(client, { schema });
    await migratePglite(db, { migrationsFolder });
    return { db: db as unknown as Db, kind: 'pglite', close: () => client.close() };
  }

  const dir = join(opts.dataDir ?? resolve(process.cwd(), 'data'), 'pglite');
  mkdirSync(dir, { recursive: true });

  // After an unclean shutdown (pid file left behind) verify the cluster in a child
  // process first: an aborted PGlite instance keeps its files open, so a corrupt
  // directory can only be moved aside *before* this process touches it.
  const pid = join(dir, 'postmaster.pid');
  if (existsSync(pid) && existsSync(join(dir, 'PG_VERSION'))) {
    rmSync(pid, { force: true });
    if (!pgliteOpens(dir)) {
      const broken = `${dir}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}`;
      renameSync(dir, broken);
      mkdirSync(dir, { recursive: true });
      console.error(
        `[db] The embedded PGlite database could not be opened after an unclean shutdown. ` +
          `It was moved to ${broken} and a fresh database was created. ` +
          `For anything beyond local development set DATABASE_URL to a PostgreSQL server.`,
      );
    }
  }

  const client = new PGlite(dir);
  await migratePglite(drizzlePglite(client, { schema }), { migrationsFolder });

  // Keep the WAL short so a crash can only lose the last few seconds.
  const checkpoint = setInterval(() => {
    void client.exec('CHECKPOINT').catch(() => {});
  }, 30_000);
  checkpoint.unref();

  const db = drizzlePglite(client, { schema });
  return {
    db: db as unknown as Db,
    kind: 'pglite',
    close: async () => {
      clearInterval(checkpoint);
      await client.exec('CHECKPOINT').catch(() => {});
      await client.close();
    },
  };
}

export { schema };
