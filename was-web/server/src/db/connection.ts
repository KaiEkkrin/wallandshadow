import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgresql://was:wasdev@localhost:5432/wallandshadow',
});

export const db = drizzle(pool, { schema });
export type Db = typeof db;

// The transaction handle passed into the callback of `db.transaction(...)`.
// Useful for helpers that need to run inside an existing transaction (e.g.
// scrubUserFootprint, which is called by both deleteUser and banUser).
export type DbTransaction = Parameters<Parameters<Db['transaction']>[0]>[0];

// Expose pool for health checks and graceful shutdown
export { pool };
