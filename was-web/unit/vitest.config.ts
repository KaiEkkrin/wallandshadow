import { defineConfig } from 'vitest/config';
import path from 'path';

const nodeModules = path.resolve(__dirname, '../node_modules');

export default defineConfig({
  test: {
    root: path.resolve(__dirname),
    globals: true,
    environment: 'node',
    include: ['**/*.test.ts'],
    exclude: ['**/e2e/**'],
    setupFiles: [path.resolve(__dirname, 'vitest.setup.ts')],
    testTimeout: 30000,
    // Disable file parallelism - functions.test.ts needs Firebase emulator
    // and can conflict with other tests accessing the same emulator
    fileParallelism: false,
  },
  // Fix Firebase ESM/CJS resolution issue
  // Vite/Vitest mixes ESM and CJS versions of Firebase packages which causes
  // "Expected first argument to collection()" errors because the type checks fail.
  // Force all Firebase packages to use CJS versions for consistency.
  // See: https://github.com/firebase/firebase-js-sdk/issues/6905
  resolve: {
    alias: {
      '@firebase/rules-unit-testing': path.join(nodeModules, '@firebase/rules-unit-testing/dist/index.cjs.js'),
      'firebase/firestore': path.join(nodeModules, 'firebase/firestore/dist/index.cjs.js'),
      'firebase/auth': path.join(nodeModules, 'firebase/auth/dist/index.cjs.js'),
      'firebase/functions': path.join(nodeModules, 'firebase/functions/dist/index.cjs.js'),
      'firebase/storage': path.join(nodeModules, 'firebase/storage/dist/index.cjs.js'),
      'firebase/app': path.join(nodeModules, 'firebase/app/dist/index.cjs.js'),
    },
  },
});
