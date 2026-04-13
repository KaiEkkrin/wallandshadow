// Standalone migration runner for production use.
// Called by docker-entrypoint.sh before starting the server.
// Uses drizzle-orm's built-in migrator (no drizzle-kit needed at runtime).

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

const connectionString = process.env.DATABASE_URL ?? 'postgresql://was:wasdev@localhost:5432/wallandshadow';

const pool = new pg.Pool({ connectionString });
const db = drizzle(pool);

console.log('Running database migrations...');
await migrate(db, { migrationsFolder: './drizzle' });
console.log('Migrations complete.');

await pool.end();
