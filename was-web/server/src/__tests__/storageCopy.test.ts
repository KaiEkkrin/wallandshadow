import { describe, test, expect, afterEach } from 'vitest';
import { storage } from '../services/storage.js';
import { deleteS3Object, s3ObjectExists, TINY_PNG } from './helpers.js';
import './setup.js';

const cleanupKeys: string[] = [];
afterEach(async () => {
  for (const k of cleanupKeys.splice(0)) {
    await deleteS3Object(k).catch(() => {});
  }
});

describe('storage.copy', () => {
  test('copies an existing object to a new key; source remains', async () => {
    const src = `test-copy/src-${Date.now()}.png`;
    const dst = `test-copy/dst-${Date.now()}.png`;
    cleanupKeys.push(src, dst);

    const buf = Uint8Array.from(TINY_PNG);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    await storage.ref(src).put(new Blob([ab], { type: 'image/png' }), { contentType: 'image/png' });

    await storage.copy(src, dst);

    expect(await s3ObjectExists(src)).toBe(true);
    expect(await s3ObjectExists(dst)).toBe(true);
  });

  test('copying a missing source throws', async () => {
    const src = `test-copy/missing-${Date.now()}.png`;
    const dst = `test-copy/dst-missing-${Date.now()}.png`;
    cleanupKeys.push(dst);

    await expect(storage.copy(src, dst)).rejects.toBeDefined();
  });
});
