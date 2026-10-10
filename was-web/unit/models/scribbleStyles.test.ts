import { describe, test, expect } from 'vitest';
import chroma from 'chroma-js';
import { defaultTokenProperties, ITokenProperties } from '@wallandshadow/shared';
import { buildScribbleStyles } from './scribbleStyles';
import { standardColours } from './featureColour';
import { Rgb, SCRIBBLE_GM_WIDTH_SCALE } from './scribbleTypes';

function lchOf(c: Rgb) {
  return chroma.gl(c.r, c.g, c.b).lch();
}

function hueDistance(a: number, b: number) {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
}

function token(id: string, players: string[], colour: number, characterId = ''): ITokenProperties {
  return { ...defaultTokenProperties, id, players, colour, characterId };
}

function sameColour(a: Rgb, b: Rgb) {
  expect(a.r).toBeCloseTo(b.r, 5);
  expect(a.g).toBeCloseTo(b.g, 5);
  expect(a.b).toBeCloseTo(b.b, 5);
}

describe('buildScribbleStyles', () => {
  test('players are spaced evenly around the wheel in id order', () => {
    const styleFor = buildScribbleStyles({ ownerId: 'o', playerIds: ['c', 'a', 'b'], tokens: [] });
    const hues = ['a', 'b', 'c'].map(id => lchOf(styleFor(id).outline)[2]);
    expect(hueDistance(hues[0], 0)).toBeLessThan(1);
    expect(hueDistance(hues[1], 120)).toBeLessThan(1);
    expect(hueDistance(hues[2], 240)).toBeLessThan(1);
    for (const id of ['a', 'b', 'c']) {
      expect(lchOf(styleFor(id).outline)[0]).toBeCloseTo(38, 0);
      expect(styleFor(id).widthScale).toBe(1);
    }
  });

  test('outline hues stay exact where the full chroma is out of gamut', () => {
    const ids = Array.from({ length: 12 }, (_, k) => String.fromCharCode(97 + k));
    const styleFor = buildScribbleStyles({ ownerId: 'o', playerIds: ids, tokens: [] });
    ids.forEach((id, k) => {
      const [l, c, h] = lchOf(styleFor(id).outline);
      expect(l).toBeCloseTo(38, 0);
      expect(c).toBeGreaterThan(20);
      expect(hueDistance(h, k * 30)).toBeLessThan(1);
    });
  });

  test('the owner is excluded from the wheel and drawn colourless and thicker', () => {
    const withOwner = buildScribbleStyles({ ownerId: 'o', playerIds: ['o', 'a', 'b'], tokens: [] });
    const without = buildScribbleStyles({ ownerId: 'o', playerIds: ['a', 'b'], tokens: [] });
    sameColour(withOwner('a').outline, without('a').outline);
    sameColour(withOwner('b').outline, without('b').outline);

    const gm = withOwner('o');
    expect(gm.widthScale).toBe(SCRIBBLE_GM_WIDTH_SCALE);
    const [l, c] = lchOf(gm.outline);
    expect(l).toBeGreaterThan(90);
    expect(c).toBeLessThan(1);
  });

  test('duplicate player ids are counted once', () => {
    const dup = buildScribbleStyles({ ownerId: 'o', playerIds: ['a', 'b', 'a'], tokens: [] });
    const single = buildScribbleStyles({ ownerId: 'o', playerIds: ['a', 'b'], tokens: [] });
    sameColour(dup('b').outline, single('b').outline);
  });

  test('fill prefers the first character token over non-character tokens', () => {
    const styleFor = buildScribbleStyles({
      ownerId: 'o', playerIds: ['a'],
      tokens: [token('01', ['a'], 1), token('02', ['a'], 3, 'char-1')],
    });
    sameColour(styleFor('a').fill, standardColours[3].light);
  });

  test('fill falls back to the first non-character token', () => {
    const styleFor = buildScribbleStyles({
      ownerId: 'o', playerIds: ['a'],
      tokens: [token('02', ['a'], 4), token('01', ['a'], 2)],
    });
    sameColour(styleFor('a').fill, standardColours[2].light);
  });

  test('token order is by id, not by input order', () => {
    const tokens = [token('03', ['a'], 5, 'c3'), token('01', ['a'], 1, 'c1'), token('02', ['a'], 2, 'c2')];
    const forward = buildScribbleStyles({ ownerId: 'o', playerIds: ['a'], tokens });
    const reversed = buildScribbleStyles({ ownerId: 'o', playerIds: ['a'], tokens: [...tokens].reverse() });
    sameColour(forward('a').fill, standardColours[1].light);
    sameColour(reversed('a').fill, standardColours[1].light);
  });

  test('tokens belonging to other players are ignored', () => {
    const styleFor = buildScribbleStyles({
      ownerId: 'o', playerIds: ['a', 'b'],
      tokens: [token('01', ['b'], 1, 'char-b'), token('02', ['a', 'b'], 4)],
    });
    sameColour(styleFor('a').fill, standardColours[4].light);
    sameColour(styleFor('b').fill, standardColours[1].light);
  });

  test('no tokens, or an out-of-range colour, gives a mid-grey fill', () => {
    const styleFor = buildScribbleStyles({
      ownerId: 'o', playerIds: ['a', 'b'],
      tokens: [token('01', ['b'], 99)],
    });
    for (const id of ['a', 'b']) {
      const [l, c] = lchOf(styleFor(id).fill);
      expect(l).toBeCloseTo(60, 0);
      expect(c).toBeLessThan(1);
    }
  });

  test('an unknown author gets a grey outline at player width', () => {
    const styleFor = buildScribbleStyles({ ownerId: 'o', playerIds: ['a'], tokens: [] });
    const style = styleFor('stranger');
    expect(style.widthScale).toBe(1);
    const [l, c] = lchOf(style.outline);
    expect(l).toBeCloseTo(38, 0);
    expect(c).toBeLessThan(1);
  });

  test('six players stay clear of the six pickable token hues', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
    const styleFor = buildScribbleStyles({ ownerId: 'o', playerIds: ids, tokens: [] });
    const paletteHues = standardColours.map(c => lchOf(c.light)[2]);
    for (const id of ids) {
      const hue = lchOf(styleFor(id).outline)[2];
      for (const p of paletteHues) {
        expect(hueDistance(hue, p)).toBeGreaterThanOrEqual(10);
      }
    }
  });

  test('the same inputs give the same styles', () => {
    const inputs = { ownerId: 'o', playerIds: ['b', 'a'], tokens: [token('01', ['a'], 2)] };
    const first = buildScribbleStyles(inputs);
    const second = buildScribbleStyles(inputs);
    expect(second('a')).toEqual(first('a'));
    expect(second('b')).toEqual(first('b'));
  });
});
