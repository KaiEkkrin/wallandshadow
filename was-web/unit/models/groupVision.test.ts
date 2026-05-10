import { describe, expect, test } from 'vitest';
import { defaultToken, IToken } from '@wallandshadow/shared';
import { MapColourVisualisationMode } from '../../src/models/displayMode';
import {
  chooseLoSSourceTokens,
  derivePlayerGroupVisionColours,
  ILoSSourceInput,
} from './groupVision';

const RED = 0;
const GREEN = 4;
const BLACK = -1;

function token(id: string, opts?: Partial<IToken>): IToken {
  return { ...defaultToken, id, ...opts };
}

function input(overrides: Partial<ILoSSourceInput>): ILoSSourceInput {
  return {
    uid: 'u1',
    owner: 'u1',
    ffa: false,
    enableGroupVision: false,
    displayMode: MapColourVisualisationMode.Areas,
    groupVisionColours: new Set(),
    myCharacterIds: new Set(),
    allTokens: [],
    selectedTokenIds: new Set(),
    ...overrides,
  };
}

function ids(ts: readonly IToken[] | undefined): string[] | undefined {
  return ts === undefined ? undefined : ts.map(t => t.id).sort();
}

describe('chooseLoSSourceTokens', () => {
  test('owner, Areas mode, no selection → undefined', () => {
    const result = chooseLoSSourceTokens(input({
      allTokens: [token('a', { colour: RED })],
    }));
    expect(result).toBeUndefined();
  });

  test('owner, Connectivity mode, no selection → undefined', () => {
    const result = chooseLoSSourceTokens(input({
      displayMode: MapColourVisualisationMode.Connectivity,
      allTokens: [token('a', { colour: RED })],
    }));
    expect(result).toBeUndefined();
  });

  test('owner, GroupVision, single colour, no selection → tokens of that colour', () => {
    const result = chooseLoSSourceTokens(input({
      displayMode: MapColourVisualisationMode.GroupVision,
      groupVisionColours: new Set([RED]),
      allTokens: [
        token('r1', { colour: RED }),
        token('r2', { colour: RED }),
        token('g1', { colour: GREEN }),
      ],
    }));
    expect(ids(result)).toEqual(['r1', 'r2']);
  });

  test('owner, GroupVision, multiple colours → union', () => {
    const result = chooseLoSSourceTokens(input({
      displayMode: MapColourVisualisationMode.GroupVision,
      groupVisionColours: new Set([RED, GREEN]),
      allTokens: [
        token('r1', { colour: RED }),
        token('g1', { colour: GREEN }),
        token('y1', { colour: 2 }),
      ],
    }));
    expect(ids(result)).toEqual(['g1', 'r1']);
  });

  test('owner, GroupVision, empty colour set → empty array (not undefined)', () => {
    const result = chooseLoSSourceTokens(input({
      displayMode: MapColourVisualisationMode.GroupVision,
      groupVisionColours: new Set(),
      allTokens: [token('r1', { colour: RED })],
    }));
    expect(result).toEqual([]);
    expect(result).not.toBeUndefined();
  });

  test('owner, GroupVision, with token selected → only the selected tokens', () => {
    const result = chooseLoSSourceTokens(input({
      displayMode: MapColourVisualisationMode.GroupVision,
      groupVisionColours: new Set([RED]),
      allTokens: [
        token('r1', { colour: RED }),
        token('r2', { colour: RED }),
        token('g1', { colour: GREEN }),
      ],
      selectedTokenIds: new Set(['g1']),
    }));
    expect(ids(result)).toEqual(['g1']);
  });

  test('owner, Areas, with token selected → only the selected tokens', () => {
    const result = chooseLoSSourceTokens(input({
      allTokens: [
        token('a', { colour: RED }),
        token('b', { colour: RED }),
      ],
      selectedTokenIds: new Set(['a']),
    }));
    expect(ids(result)).toEqual(['a']);
  });

  test('FFA non-owner, GroupVision behaves identically to owner', () => {
    const result = chooseLoSSourceTokens(input({
      uid: 'u2',
      owner: 'u1',
      ffa: true,
      displayMode: MapColourVisualisationMode.GroupVision,
      groupVisionColours: new Set([RED]),
      allTokens: [
        token('r1', { colour: RED }),
        token('g1', { colour: GREEN }),
      ],
    }));
    expect(ids(result)).toEqual(['r1']);
  });

  test('player, group vision off, no selection → only their own tokens', () => {
    const result = chooseLoSSourceTokens(input({
      uid: 'p1',
      owner: 'u1',
      allTokens: [
        token('mine', { colour: RED, players: ['p1'] }),
        token('theirs', { colour: RED, players: ['p2'] }),
        token('unowned', { colour: RED, players: [] }),
      ],
    }));
    expect(ids(result)).toEqual(['mine']);
  });

  test('player, group vision on, owns one red token → all red tokens', () => {
    const result = chooseLoSSourceTokens(input({
      uid: 'p1',
      owner: 'u1',
      enableGroupVision: true,
      allTokens: [
        token('mine', { colour: RED, players: ['p1'] }),
        token('teammate', { colour: RED, players: ['p2'] }),
        token('monster', { colour: GREEN, players: [] }),
      ],
    }));
    expect(ids(result)).toEqual(['mine', 'teammate']);
  });

  test('player, group vision on, owns red + green → all red and green tokens', () => {
    const result = chooseLoSSourceTokens(input({
      uid: 'p1',
      owner: 'u1',
      enableGroupVision: true,
      allTokens: [
        token('mine-r', { colour: RED, players: ['p1'] }),
        token('mine-g', { colour: GREEN, players: ['p1'] }),
        token('other-r', { colour: RED, players: ['p2'] }),
        token('other-g', { colour: GREEN, players: ['p2'] }),
        token('monster', { colour: 2, players: [] }),
      ],
    }));
    expect(ids(result)).toEqual(['mine-g', 'mine-r', 'other-g', 'other-r']);
  });

  test('player, group vision on, character-linked token (via characterId) contributes its colour', () => {
    const result = chooseLoSSourceTokens(input({
      uid: 'p1',
      owner: 'u1',
      enableGroupVision: true,
      myCharacterIds: new Set(['char-1']),
      allTokens: [
        token('char-token', { colour: GREEN, players: [], characterId: 'char-1' }),
        token('other-green', { colour: GREEN, players: [] }),
        token('red-monster', { colour: RED, players: [] }),
      ],
    }));
    expect(ids(result)).toEqual(['char-token', 'other-green']);
  });

  test('player, group vision on, with token selected → only selected', () => {
    const result = chooseLoSSourceTokens(input({
      uid: 'p1',
      owner: 'u1',
      enableGroupVision: true,
      allTokens: [
        token('mine', { colour: RED, players: ['p1'] }),
        token('teammate', { colour: RED, players: ['p2'] }),
      ],
      selectedTokenIds: new Set(['mine']),
    }));
    expect(ids(result)).toEqual(['mine']);
  });

  test('player, group vision on, owns no tokens → empty array', () => {
    const result = chooseLoSSourceTokens(input({
      uid: 'p1',
      owner: 'u1',
      enableGroupVision: true,
      allTokens: [
        token('a', { colour: RED, players: ['p2'] }),
      ],
    }));
    expect(result).toEqual([]);
  });

  test('player, group vision on, only owns -1 token → empty array (-1 excluded)', () => {
    const result = chooseLoSSourceTokens(input({
      uid: 'p1',
      owner: 'u1',
      enableGroupVision: true,
      allTokens: [
        token('mine-black', { colour: BLACK, players: ['p1'] }),
        token('other-red', { colour: RED, players: ['p2'] }),
      ],
    }));
    expect(result).toEqual([]);
  });
});

describe('derivePlayerGroupVisionColours', () => {
  test('empty token list → empty set', () => {
    const result = derivePlayerGroupVisionColours([], 'p1', new Set());
    expect(Array.from(result)).toEqual([]);
  });

  test('two red tokens → {red} (deduped)', () => {
    const result = derivePlayerGroupVisionColours(
      [
        token('a', { colour: RED, players: ['p1'] }),
        token('b', { colour: RED, players: ['p1'] }),
      ],
      'p1', new Set(),
    );
    expect(result.size).toBe(1);
    expect(result.has(RED)).toBe(true);
  });

  test('red + green via players[] → {red, green}', () => {
    const result = derivePlayerGroupVisionColours(
      [
        token('a', { colour: RED, players: ['p1'] }),
        token('b', { colour: GREEN, players: ['p1'] }),
      ],
      'p1', new Set(),
    );
    expect(Array.from(result).sort()).toEqual([RED, GREEN].sort());
  });

  test('characterId match (without players[] match) contributes its colour', () => {
    const result = derivePlayerGroupVisionColours(
      [token('a', { colour: GREEN, players: [], characterId: 'c1' })],
      'p1', new Set(['c1']),
    );
    expect(Array.from(result)).toEqual([GREEN]);
  });

  test('token with no players and no characterId → not included', () => {
    const result = derivePlayerGroupVisionColours(
      [token('a', { colour: RED, players: [], characterId: '' })],
      'p1', new Set(),
    );
    expect(result.size).toBe(0);
  });

  test('owned token with colour=-1 → excluded', () => {
    const result = derivePlayerGroupVisionColours(
      [
        token('a', { colour: BLACK, players: ['p1'] }),
        token('b', { colour: RED, players: ['p1'] }),
      ],
      'p1', new Set(),
    );
    expect(result.has(BLACK)).toBe(false);
    expect(result.has(RED)).toBe(true);
  });

  test('character-linked token with colour=-1 → excluded', () => {
    const result = derivePlayerGroupVisionColours(
      [token('a', { colour: BLACK, players: [], characterId: 'c1' })],
      'p1', new Set(['c1']),
    );
    expect(result.size).toBe(0);
  });
});
