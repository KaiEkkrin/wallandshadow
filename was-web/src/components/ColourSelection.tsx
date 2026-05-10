import { useCallback, useRef, useState } from 'react';

import { IClickAnchor, resolveMultiSelectClick } from '../models/colourSelection';
import { hexColours } from '../models/featureColour';

import ButtonGroup from 'react-bootstrap/ButtonGroup';
import ToggleButton from 'react-bootstrap/ToggleButton';

const BORDER_UNSELECTED = '#212529';
const BORDER_HOVER = '#424649';
const BORDER_SELECTED = '#0d6efd';
const BORDER_WIDTH = '6px';

interface IColourButtonProps {
  id: string;
  value: number;
  colour: string;
  type: 'radio' | 'checkbox';
  isSelected: boolean;
  onSelect: (modifiers: { shiftKey: boolean }) => void;
}

function ColourButton({ id, value, colour, type, isSelected, onSelect }: IColourButtonProps) {
  const [isHovered, setIsHovered] = useState(false);

  const borderColour = isSelected ? BORDER_SELECTED
    : isHovered ? BORDER_HOVER
    : BORDER_UNSELECTED;

  const style: React.CSSProperties = {
    '--bs-btn-bg': colour,
    '--bs-btn-border-color': borderColour,
    '--bs-btn-hover-bg': colour,
    '--bs-btn-active-bg': colour,
    '--bs-btn-active-border-color': BORDER_SELECTED,
    borderWidth: BORDER_WIDTH,
    minWidth: '2.5rem',
    minHeight: '2.5rem',
  } as React.CSSProperties;

  // Use onClick rather than onChange because radio inputs don't fire onChange
  // when re-clicking the already-checked option, which would prevent deselect
  // in checkbox mode too on some browsers. onClick also exposes shiftKey for
  // range selection.
  const handleClick = useCallback(
    (e: React.MouseEvent) => onSelect({ shiftKey: e.shiftKey }),
    [onSelect],
  );

  return (
    <ToggleButton id={id} type={type} variant="dark" value={value}
      checked={isSelected}
      onChange={() => undefined}
      onClick={handleClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={style}>
    </ToggleButton>
  );
}

interface IColourSelectionPropsBase {
  className?: string | undefined;
  hidden?: boolean;
  id: string;
  isVertical: boolean;
}

interface ISingleColourSelectionProps extends IColourSelectionPropsBase {
  includeNegative: boolean;
  selectedColour: number;
  setSelectedColour(value: number): void;
}

interface IMultiColourSelectionProps extends IColourSelectionPropsBase {
  selectedColours: ReadonlySet<number>;
  toggleColour(value: number): void;
  // Inclusive on both ends. Used for shift-click range selection.
  addColourRange(from: number, to: number): void;
  removeColourRange(from: number, to: number): void;
}

type IColourSelectionProps = ISingleColourSelectionProps | IMultiColourSelectionProps;

// Multi-select mode never includes the negative ("black") colour — issue #332
// requires it to be excluded from group-vision selections.
function ColourSelection(props: IColourSelectionProps) {
  const isMulti = 'selectedColours' in props;

  const anchorRef = useRef<IClickAnchor | null>(null);

  const handleSelect = useCallback((value: number, shiftKey: boolean) => {
    if (!isMulti) {
      props.setSelectedColour(value);
      return;
    }
    const { action, anchor } = resolveMultiSelectClick(
      value, shiftKey, props.selectedColours.has(value), anchorRef.current,
    );
    anchorRef.current = anchor;
    switch (action.kind) {
      case 'toggle': props.toggleColour(action.value); break;
      case 'addRange': props.addColourRange(action.from, action.to); break;
      case 'removeRange': props.removeColourRange(action.from, action.to); break;
    }
  }, [isMulti, props]);

  const buttons = hexColours.map((c, i) => (
    <ColourButton
      key={i}
      id={`${props.id}-${i}`}
      value={i}
      colour={c}
      type={isMulti ? 'checkbox' : 'radio'}
      isSelected={isMulti ? props.selectedColours.has(i) : props.selectedColour === i}
      onSelect={({ shiftKey }) => handleSelect(i, shiftKey)}
    />
  ));

  const showNegative = !isMulti && props.includeNegative;

  return (
    <ButtonGroup className={props.className} id={props.id} hidden={props.hidden}
      vertical={props.isVertical === true}>
      {buttons}
      {showNegative && (
        <ColourButton
          id={`${props.id}-neg`}
          value={-1}
          colour="#1a1a1a"
          type="radio"
          isSelected={props.selectedColour === -1}
          onSelect={() => handleSelect(-1, false)}
        />
      )}
    </ButtonGroup>
  );
}

export default ColourSelection;
