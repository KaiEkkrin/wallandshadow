import { serve } from '@hono/node-server';
import { pool } from './db/connection.js';
import { createApp } from './app.js';

const app = createApp();

const port = parseInt(process.env.PORT ?? '3000', 10);
serve({ fetch: app.fetch, port }, () => {
  console.log(`Server running on http://localhost:${port}`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  await pool.end();
  process.exit(0);
});
