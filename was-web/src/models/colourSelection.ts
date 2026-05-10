// Pure click-resolution logic for the multi-select colour picker.
// Extracted from ColourSelection.tsx so the anchor-and-polarity rules can
// be unit-tested without React.

export type Polarity = 'add' | 'remove';

export interface IClickAnchor {
  index: number;
  polarity: Polarity;
}

export type ClickAction =
  | { kind: 'toggle'; value: number }
  | { kind: 'addRange'; from: number; to: number }
  | { kind: 'removeRange'; from: number; to: number };

export interface IClickResolution {
  action: ClickAction;
  anchor: IClickAnchor;
}

// `isCurrentlySelected` is the selection state of `value` *before* this click.
// Used to set the anchor's polarity for plain clicks: a plain click on an
// already-selected colour deselects it (polarity 'remove'); on an
// unselected colour it selects it (polarity 'add'). A subsequent
// shift-click extends the range with that same effect, leaving the anchor
// unchanged so successive shift-clicks keep extending from the original.
export function resolveMultiSelectClick(
  value: number,
  shiftKey: boolean,
  isCurrentlySelected: boolean,
  anchor: IClickAnchor | null,
): IClickResolution {
  if (shiftKey && anchor !== null) {
    const action: ClickAction = anchor.polarity === 'add'
      ? { kind: 'addRange', from: anchor.index, to: value }
      : { kind: 'removeRange', from: anchor.index, to: value };
    return { action, anchor };
  }
  return {
    action: { kind: 'toggle', value },
    anchor: { index: value, polarity: isCurrentlySelected ? 'remove' : 'add' },
  };
}
