import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { authRoutes } from './auth/routes.js';
import { adventureRoutes } from './routes/adventures.js';
import { mapRoutes } from './routes/maps.js';
import { playerRoutes } from './routes/players.js';
import { inviteRoutes } from './routes/invites.js';
import { imageRoutes } from './routes/images.js';
import { spritesheetRoutes } from './routes/spritesheets.js';
import { configureStaticServing } from './static.js';
import { logger } from './services/logger.js';

export function createApp(): Hono {
  const app = new Hono();

  app.onError((err, c) => {
    if (err instanceof HTTPException) {
      return err.getResponse();
    }
    logger.logError(`Unhandled error on ${c.req.method} ${c.req.path}`, err);
    return c.json({ error: 'Internal server error' }, 500);
  });

  app.get('/api/health', (c) => c.json({ ok: true }));

  app.route('/api/auth', authRoutes);
  app.route('/api', adventureRoutes);
  app.route('/api', mapRoutes);
  app.route('/api', playerRoutes);
  app.route('/api', inviteRoutes);
  app.route('/api', imageRoutes);
  app.route('/api', spritesheetRoutes);

  // Static file serving (production only — no-op when build/ doesn't exist)
  configureStaticServing(app);

  return app;
}
