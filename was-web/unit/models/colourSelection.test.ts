import { describe, expect, test } from 'vitest';
import {
  IClickAnchor,
  resolveMultiSelectClick,
} from './colourSelection';

const RED = 0;
const GREEN = 4;

describe('resolveMultiSelectClick', () => {
  describe('plain click (no shift)', () => {
    test('on unselected colour, no anchor → toggle and seed anchor with "add" polarity', () => {
      const { action, anchor } = resolveMultiSelectClick(RED, false, false, null);
      expect(action).toEqual({ kind: 'toggle', value: RED });
      expect(anchor).toEqual({ index: RED, polarity: 'add' });
    });

    test('on already-selected colour, no anchor → toggle and seed anchor with "remove" polarity', () => {
      const { action, anchor } = resolveMultiSelectClick(RED, false, true, null);
      expect(action).toEqual({ kind: 'toggle', value: RED });
      expect(anchor).toEqual({ index: RED, polarity: 'remove' });
    });

    test('on unselected colour with prior anchor → toggle, anchor moves to clicked index with "add"', () => {
      const prior: IClickAnchor = { index: RED, polarity: 'remove' };
      const { action, anchor } = resolveMultiSelectClick(GREEN, false, false, prior);
      expect(action).toEqual({ kind: 'toggle', value: GREEN });
      expect(anchor).toEqual({ index: GREEN, polarity: 'add' });
    });

    test('on already-selected colour with prior anchor → toggle, anchor moves with "remove"', () => {
      const prior: IClickAnchor = { index: RED, polarity: 'add' };
      const { action, anchor } = resolveMultiSelectClick(GREEN, false, true, prior);
      expect(action).toEqual({ kind: 'toggle', value: GREEN });
      expect(anchor).toEqual({ index: GREEN, polarity: 'remove' });
    });
  });

  describe('shift-click without an anchor', () => {
    test('falls through to plain-click semantics on unselected colour', () => {
      const { action, anchor } = resolveMultiSelectClick(RED, true, false, null);
      expect(action).toEqual({ kind: 'toggle', value: RED });
      expect(anchor).toEqual({ index: RED, polarity: 'add' });
    });

    test('falls through to plain-click semantics on already-selected colour', () => {
      const { action, anchor } = resolveMultiSelectClick(RED, true, true, null);
      expect(action).toEqual({ kind: 'toggle', value: RED });
      expect(anchor).toEqual({ index: RED, polarity: 'remove' });
    });
  });

  describe('shift-click with an anchor', () => {
    test('"add" anchor → addRange from anchor.index to clicked value, anchor unchanged', () => {
      const prior: IClickAnchor = { index: RED, polarity: 'add' };
      const { action, anchor } = resolveMultiSelectClick(GREEN, true, false, prior);
      expect(action).toEqual({ kind: 'addRange', from: RED, to: GREEN });
      expect(anchor).toBe(prior);
    });

    test('"remove" anchor → removeRange from anchor.index to clicked value, anchor unchanged', () => {
      const prior: IClickAnchor = { index: RED, polarity: 'remove' };
      const { action, anchor } = resolveMultiSelectClick(GREEN, true, true, prior);
      expect(action).toEqual({ kind: 'removeRange', from: RED, to: GREEN });
      expect(anchor).toBe(prior);
    });

    test('isCurrentlySelected is ignored when shift+anchor produces a range', () => {
      // Polarity comes from the anchor, not from the clicked colour's state.
      const prior: IClickAnchor = { index: RED, polarity: 'add' };
      const r1 = resolveMultiSelectClick(GREEN, true, false, prior);
      const r2 = resolveMultiSelectClick(GREEN, true, true, prior);
      expect(r1.action).toEqual(r2.action);
    });

    test('clicked value < anchor.index → from/to preserved as (anchor, clicked), not normalised', () => {
      // The caller normalises with min/max for the actual set update; the
      // helper keeps the user's intent (anchor → click direction) so tests
      // stay precise.
      const prior: IClickAnchor = { index: GREEN, polarity: 'add' };
      const { action } = resolveMultiSelectClick(RED, true, false, prior);
      expect(action).toEqual({ kind: 'addRange', from: GREEN, to: RED });
    });

    test('shift-click on the anchor itself → single-point range (from === to)', () => {
      const prior: IClickAnchor = { index: RED, polarity: 'add' };
      const { action, anchor } = resolveMultiSelectClick(RED, true, true, prior);
      expect(action).toEqual({ kind: 'addRange', from: RED, to: RED });
      expect(anchor).toBe(prior);
    });

    test('successive shift-clicks both extend from the original anchor', () => {
      // Real flow: plain-click at RED to start, shift-click GREEN, shift-click 2.
      // Both ranges should originate from RED, the anchor never moves.
      const after1 = resolveMultiSelectClick(RED, false, false, null);
      const after2 = resolveMultiSelectClick(GREEN, true, false, after1.anchor);
      const after3 = resolveMultiSelectClick(2, true, false, after2.anchor);
      expect(after2.action).toEqual({ kind: 'addRange', from: RED, to: GREEN });
      expect(after3.action).toEqual({ kind: 'addRange', from: RED, to: 2 });
      expect(after2.anchor).toBe(after1.anchor);
      expect(after3.anchor).toBe(after1.anchor);
    });
  });

  describe('end-to-end flows', () => {
    test('plain-add then shift-extend then plain-remove then shift-extend-remove', () => {
      // 1. plain-click RED on empty selection → toggle + anchor (RED, 'add')
      const r1 = resolveMultiSelectClick(RED, false, false, null);
      expect(r1.action).toEqual({ kind: 'toggle', value: RED });
      expect(r1.anchor).toEqual({ index: RED, polarity: 'add' });

      // 2. shift-click GREEN → addRange from RED, anchor unchanged
      const r2 = resolveMultiSelectClick(GREEN, true, false, r1.anchor);
      expect(r2.action).toEqual({ kind: 'addRange', from: RED, to: GREEN });
      expect(r2.anchor).toBe(r1.anchor);

      // 3. plain-click GREEN (now selected) → toggle + anchor (GREEN, 'remove')
      const r3 = resolveMultiSelectClick(GREEN, false, true, r2.anchor);
      expect(r3.action).toEqual({ kind: 'toggle', value: GREEN });
      expect(r3.anchor).toEqual({ index: GREEN, polarity: 'remove' });

      // 4. shift-click 2 (which is selected from step 2) → removeRange GREEN..2
      const r4 = resolveMultiSelectClick(2, true, true, r3.anchor);
      expect(r4.action).toEqual({ kind: 'removeRange', from: GREEN, to: 2 });
      expect(r4.anchor).toBe(r3.anchor);
    });
  });
});
