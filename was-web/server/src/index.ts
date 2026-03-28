import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { pool } from './db/connection.js';
import { authRoutes } from './auth/routes.js';
import { adventureRoutes } from './routes/adventures.js';
import { mapRoutes } from './routes/maps.js';
import { inviteRoutes } from './routes/invites.js';
import { imageRoutes } from './routes/images.js';
import { spritesheetRoutes } from './routes/spritesheets.js';

const app = new Hono();

app.get('/api/health', (c) => c.json({ ok: true }));

app.route('/api/auth', authRoutes);
app.route('/api', adventureRoutes);
app.route('/api', mapRoutes);
app.route('/api', inviteRoutes);
app.route('/api', imageRoutes);
app.route('/api', spritesheetRoutes);

const port = parseInt(process.env.PORT ?? '3000', 10);
serve({ fetch: app.fetch, port }, () => {
  console.log(`Server running on http://localhost:${port}`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  await pool.end();
  process.exit(0);
});
