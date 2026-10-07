import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

export type Db = NodePgDatabase<typeof schema>;
/** A transaction handle; same query API as Db. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbOrTx = Db | Tx;

export interface Database {
  db: Db;
  pool: pg.Pool;
}

/**
 * One pool per process (per Neon Functions isolate). Keep it small: the
 * effective connection count is max × live isolates, and Neon's pooled
 * endpoint absorbs the fan-out.
 */
export function createDatabase(connectionString: string, max = 5): Database {
  const isLocal = /@(localhost|127\.0\.0\.1|host\.docker\.internal)[:/]/.test(connectionString);
  const pool = new pg.Pool({
    connectionString,
    max,
    // Neon requires TLS with a publicly trusted certificate; local Docker has no TLS.
    ssl: isLocal ? false : true,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  return { db: drizzle(pool, { schema }), pool };
}

export { schema };
