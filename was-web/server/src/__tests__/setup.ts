import { afterAll, beforeEach } from 'vitest';
import { pool } from '../db/connection.js';

// Wipe all data between tests by truncating from the root table.
// CASCADE handles all dependent tables (adventures, maps, map_changes,
// adventure_players, invites, images, spritesheets, app_config).
beforeEach(async () => {
  await pool.query('TRUNCATE users CASCADE');
});

afterAll(async () => {
  await pool.end();
});
