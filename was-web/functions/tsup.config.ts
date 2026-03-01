import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs'],
  target: 'node22',
  sourcemap: true,
  clean: true,
  outDir: 'lib',
  // firebase-admin and firebase-functions are provided by the Firebase runtime;
  // everything else (including @wallandshadow/shared) is bundled inline.
  external: [
    'firebase-admin',
    'firebase-admin/firestore',
    'firebase-functions',
    'firebase-functions/v1',
  ],
  // tsup auto-externalizes packages listed in dependencies; override that for
  // @wallandshadow/shared so it gets bundled into lib/index.js directly.
  noExternal: ['@wallandshadow/shared'],
});
