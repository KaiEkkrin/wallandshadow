// Static file serving for production.
// In local dev (no build/ directory), this is a no-op.

import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { existsSync, readFileSync } from 'fs';
import path from 'path';

// SPA routes — serve app.html
const SPA_ROUTES = [
  '/app',
  '/app/*',
  '/adventure/*',
  '/map/*',
  '/invite/*',
  '/shared',
  '/all',
  '/login',
  '/auth/*',
];

export function configureStaticServing(app: Hono): void {
  const staticDir = process.env.STATIC_DIR ?? path.join(process.cwd(), '../build');

  if (!existsSync(staticDir)) {
    console.log(`Static directory ${staticDir} not found — static serving disabled`);
    return;
  }

  const appHtmlPath = path.join(staticDir, 'app.html');
  const indexHtmlPath = path.join(staticDir, 'index.html');

  if (!existsSync(appHtmlPath) || !existsSync(indexHtmlPath)) {
    console.log('app.html or index.html not found in static directory — static serving disabled');
    return;
  }

  // Read HTML files once at startup
  const appHtml = readFileSync(appHtmlPath, 'utf-8');
  const indexHtml = readFileSync(indexHtmlPath, 'utf-8');

  console.log(`Serving static files from ${staticDir}`);

  // Hashed assets — immutable, cache forever
  app.use('/assets/*', serveStatic({
    root: staticDir,
    onFound: (_path, c) => {
      c.header('Cache-Control', 'public, max-age=31536000, immutable');
    },
  }));

  // SPA routes — serve app.html with no-cache
  for (const route of SPA_ROUTES) {
    app.get(route, (c) => {
      c.header('Cache-Control', 'no-cache');
      return c.html(appHtml);
    });
  }

  // Landing page
  app.get('/', (c) => {
    c.header('Cache-Control', 'public, max-age=300');
    return c.html(indexHtml);
  });

  // All other static files (favicon, manifest, logos, fonts, etc.)
  app.use('/*', serveStatic({
    root: staticDir,
    onFound: (_path, c) => {
      // Image files get long cache
      if (/\.(jpg|jpeg|gif|png|svg|webp|ico)$/.test(c.req.path)) {
        c.header('Cache-Control', 'public, max-age=31536000');
      }
    },
  }));
}
