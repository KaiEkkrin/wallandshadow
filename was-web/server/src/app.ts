import { Hono } from 'hono';
import { authRoutes } from './auth/routes.js';
import { adventureRoutes } from './routes/adventures.js';
import { mapRoutes } from './routes/maps.js';
import { inviteRoutes } from './routes/invites.js';
import { imageRoutes } from './routes/images.js';
import { spritesheetRoutes } from './routes/spritesheets.js';

export function createApp(): Hono {
  const app = new Hono();

  app.get('/api/health', (c) => c.json({ ok: true }));

  app.route('/api/auth', authRoutes);
  app.route('/api', adventureRoutes);
  app.route('/api', mapRoutes);
  app.route('/api', inviteRoutes);
  app.route('/api', imageRoutes);
  app.route('/api', spritesheetRoutes);

  return app;
}
