// Minimal static server for the production-bundle smoke test.
//
// Mirrors how the Hono server serves the built SPA in production
// (`server/src/static.ts`): the landing page at `/`, real files where they
// exist, and `app.html` for every SPA route. It is deliberately standalone —
// the point of this smoke test is to load the built bundle with no database,
// no object storage and no API server behind it.

import { createServer } from 'http';
import { existsSync, readFileSync, statSync } from 'fs';
import path from 'path';

const BUILD_DIR = path.resolve(import.meta.dirname, '../build');
const PORT = Number(process.env.SMOKE_PORT ?? 4180);

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};

function contentTypeOf(filePath: string): string {
  return CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

// Resolve a request path to a file inside BUILD_DIR, or undefined if it
// escapes the directory or names something that isn't a regular file.
function resolveFile(urlPath: string): string | undefined {
  const resolved = path.resolve(BUILD_DIR, `.${urlPath}`);
  if (resolved !== BUILD_DIR && !resolved.startsWith(BUILD_DIR + path.sep)) {
    return undefined;
  }

  return existsSync(resolved) && statSync(resolved).isFile() ? resolved : undefined;
}

if (!existsSync(path.join(BUILD_DIR, 'app.html'))) {
  console.error(`No build found at ${BUILD_DIR} — run \`npm run build\` first.`);
  process.exit(1);
}

const server = createServer((req, res) => {
  const urlPath = new URL(req.url ?? '/', `http://localhost:${PORT}`).pathname;

  const filePath = urlPath === '/'
    ? path.join(BUILD_DIR, 'index.html')
    : resolveFile(urlPath) ?? path.join(BUILD_DIR, 'app.html');

  res.writeHead(200, { 'Content-Type': contentTypeOf(filePath) });
  res.end(readFileSync(filePath));
});

server.listen(PORT, () => {
  console.log(`Serving ${BUILD_DIR} on http://localhost:${PORT}`);
});
