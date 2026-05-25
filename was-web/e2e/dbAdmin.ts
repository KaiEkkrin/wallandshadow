import pg from 'pg';

/**
 * Sets an account's tier directly in the database. Used by e2e tests that
 * need to flip a freshly-registered account out of its default Basic tier
 * (e.g. to a tier that can upload images, or to admin) before exercising
 * tier-gated UI. The documented operator-bootstrap step does the same thing.
 */
export async function setUserLevel(email: string, level: 'basic' | 'higher' | 'admin'): Promise<void> {
  const pool = new pg.Pool({
    connectionString:
      process.env.DATABASE_URL ?? 'postgresql://was:wasdev@localhost:5432/wallandshadow',
  });
  try {
    await pool.query('UPDATE users SET level = $2 WHERE email = $1', [email, level]);
  } finally {
    await pool.end();
  }
}

/**
 * Promotes an account to the admin tier directly in the database.
 * Session 2 has no admin-promotion API (that arrives in Session 5), so the
 * e2e test reaches past the API — exactly as the documented operator
 * bootstrap step does (see docs/DEVELOPMENT.md). Runs against the dev
 * database used by the locally running server.
 */
export async function promoteToAdmin(email: string): Promise<void> {
  await setUserLevel(email, 'admin');
}
