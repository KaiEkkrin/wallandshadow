import { useState } from 'react';

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
  isSelected: boolean;
  onSelect: () => void;
}

function ColourButton({ id, value, colour, isSelected, onSelect }: IColourButtonProps) {
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

  return (
    <ToggleButton id={id} type="radio" variant="dark" value={value}
      checked={isSelected}
      onChange={onSelect}
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
}

type IColourSelectionProps = ISingleColourSelectionProps | IMultiColourSelectionProps;

// Multi-select mode never includes the negative ("black") colour — issue #332
// requires it to be excluded from group-vision selections.
function ColourSelection(props: IColourSelectionProps) {
  const isMulti = 'selectedColours' in props;

  const buttons = hexColours.map((c, i) => (
    <ColourButton
      key={i}
      id={`${props.id}-${i}`}
      value={i}
      colour={c}
      isSelected={isMulti ? props.selectedColours.has(i) : props.selectedColour === i}
      onSelect={() => isMulti ? props.toggleColour(i) : props.setSelectedColour(i)}
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
          isSelected={props.selectedColour === -1}
          onSelect={() => props.setSelectedColour(-1)}
        />
      )}
    </ButtonGroup>
  );
}

export default ColourSelection;
