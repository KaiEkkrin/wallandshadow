import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    root: path.resolve(__dirname),
    globals: true,
    environment: 'node',
    include: ['**/*.test.ts'],
    exclude: ['**/e2e/**'],
    setupFiles: [path.resolve(__dirname, 'vitest.setup.ts')],
    testTimeout: 30000,
  },
  resolve: {
    alias: {
      '@wallandshadow/shared': path.resolve(__dirname, '../packages/shared/src/index.ts'),
    },
  },
});
