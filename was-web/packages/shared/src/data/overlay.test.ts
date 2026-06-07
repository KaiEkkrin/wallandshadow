import { describe, test, expect } from 'vitest';
import {
  validateOutgoingOverlayItem,
  MAX_SCRIBBLE_POINTS,
  MAX_RULER_NODES,
  MAX_ITEM_ID_LENGTH,
} from './overlay';

describe('validateOutgoingOverlayItem', () => {
  test('accepts a valid scribble and strips unknown fields', () => {
    const result = validateOutgoingOverlayItem({
      itemId: 'item-1',
      phase: 'active',
      authorId: 'spoofed',          // unknown field — must be stripped
      payload: { kind: 'scribble', points: [{ x: 1, y: 2 }, { x: 3, y: 4 }] },
    });
    expect(result).toEqual({
      itemId: 'item-1',
      phase: 'active',
      payload: { kind: 'scribble', points: [{ x: 1, y: 2 }, { x: 3, y: 4 }] },
    });
  });

  test('accepts a valid ruler with a live endpoint', () => {
    const result = validateOutgoingOverlayItem({
      itemId: 'r1',
      phase: 'active',
      payload: { kind: 'ruler', nodes: [{ x: 0, y: 0 }], live: { x: 5, y: 5 } },
    });
    expect(result).toEqual({
      itemId: 'r1',
      phase: 'active',
      payload: { kind: 'ruler', nodes: [{ x: 0, y: 0 }], live: { x: 5, y: 5 } },
    });
  });

  test('accepts a released ruler without a live endpoint', () => {
    const result = validateOutgoingOverlayItem({
      itemId: 'r2',
      phase: 'released',
      payload: { kind: 'ruler', nodes: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
    });
    expect(result).toEqual({
      itemId: 'r2',
      phase: 'released',
      payload: { kind: 'ruler', nodes: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
    });
  });

  test.each([
    ['non-object', 42],
    ['missing itemId', { phase: 'active', payload: { kind: 'scribble', points: [{ x: 0, y: 0 }] } }],
    ['empty itemId', { itemId: '', phase: 'active', payload: { kind: 'scribble', points: [{ x: 0, y: 0 }] } }],
    ['bad phase', { itemId: 'a', phase: 'paused', payload: { kind: 'scribble', points: [{ x: 0, y: 0 }] } }],
    ['unknown kind', { itemId: 'a', phase: 'active', payload: { kind: 'arrow', points: [] } }],
    ['empty scribble', { itemId: 'a', phase: 'active', payload: { kind: 'scribble', points: [] } }],
    ['non-finite coord', { itemId: 'a', phase: 'active', payload: { kind: 'scribble', points: [{ x: Infinity, y: 0 }] } }],
    ['NaN coord', { itemId: 'a', phase: 'active', payload: { kind: 'scribble', points: [{ x: NaN, y: 0 }] } }],
    ['ruler missing nodes', { itemId: 'a', phase: 'active', payload: { kind: 'ruler' } }],
    ['ruler bad live', { itemId: 'a', phase: 'active', payload: { kind: 'ruler', nodes: [{ x: 0, y: 0 }], live: { x: 'z', y: 0 } } }],
  ])('rejects %s', (_label, input) => {
    expect(validateOutgoingOverlayItem(input)).toBeNull();
  });

  test('rejects an over-length scribble', () => {
    const points = Array.from({ length: MAX_SCRIBBLE_POINTS + 1 }, (_, i) => ({ x: i, y: i }));
    expect(validateOutgoingOverlayItem({
      itemId: 'a', phase: 'active', payload: { kind: 'scribble', points },
    })).toBeNull();
  });

  test('rejects an over-length ruler', () => {
    const nodes = Array.from({ length: MAX_RULER_NODES + 1 }, (_, i) => ({ x: i, y: i }));
    expect(validateOutgoingOverlayItem({
      itemId: 'a', phase: 'active', payload: { kind: 'ruler', nodes },
    })).toBeNull();
  });

  test('accepts an itemId at the max length', () => {
    const itemId = 'x'.repeat(MAX_ITEM_ID_LENGTH);
    const result = validateOutgoingOverlayItem({
      itemId, phase: 'active', payload: { kind: 'scribble', points: [{ x: 0, y: 0 }] },
    });
    expect(result?.itemId).toBe(itemId);
  });

  test('rejects an over-length itemId', () => {
    const itemId = 'x'.repeat(MAX_ITEM_ID_LENGTH + 1);
    expect(validateOutgoingOverlayItem({
      itemId, phase: 'active', payload: { kind: 'scribble', points: [{ x: 0, y: 0 }] },
    })).toBeNull();
  });
});
