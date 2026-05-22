import pg from 'pg';

/**
 * Promotes an account to the admin tier directly in the database.
 * Session 2 has no admin-promotion API (that arrives in Session 5), so the
 * e2e test reaches past the API — exactly as the documented operator
 * bootstrap step does (see docs/DEVELOPMENT.md). Runs against the dev
 * database used by the locally running server.
 */
export async function promoteToAdmin(email: string): Promise<void> {
  const pool = new pg.Pool({
    connectionString:
      process.env.DATABASE_URL ?? 'postgresql://was:wasdev@localhost:5432/wallandshadow',
  });
  try {
    await pool.query("UPDATE users SET level = 'admin' WHERE email = $1", [email]);
  } finally {
    await pool.end();
  }
}
