import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/db/migrate.ts'],
  format: ['esm'],
  target: 'node22',
  sourcemap: true,
  clean: true,
  outDir: 'dist',
  // tsup auto-externalizes packages listed in dependencies; override that for
  // @wallandshadow/shared so it gets bundled into dist/ directly (it exposes
  // raw TypeScript, so it must be compiled in).
  noExternal: ['@wallandshadow/shared'],
});
