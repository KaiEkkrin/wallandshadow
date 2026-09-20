import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    root: path.resolve(import.meta.dirname),
    globals: true,
    environment: 'node',
    include: ['**/*.test.ts'],
    exclude: ['**/e2e/**'],
    setupFiles: [path.resolve(import.meta.dirname, 'vitest.setup.ts')],
    testTimeout: 30000,
  },
  resolve: {
    alias: {
      '@wallandshadow/shared': path.resolve(import.meta.dirname, '../packages/shared/src/index.ts'),
    },
  },
});
