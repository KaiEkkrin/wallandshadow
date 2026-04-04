import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    root: path.resolve(__dirname, 'src/__tests__'),
    globals: true,
    environment: 'node',
    include: ['**/*.test.ts'],
    setupFiles: [path.resolve(__dirname, 'src/__tests__/setup.ts')],
    testTimeout: 30000,
    // Tests share a database — no parallel execution
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@wallandshadow/shared': path.resolve(__dirname, '../packages/shared/src/index.ts'),
    },
  },
});
