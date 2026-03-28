import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgresql://was:wasdev@localhost:5432/wallandshadow',
});

export const db = drizzle(pool, { schema });
export type Db = typeof db;

// Expose pool for health checks and graceful shutdown
export { pool };
