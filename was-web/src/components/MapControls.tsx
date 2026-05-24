import { useCallback, useMemo } from 'react';
import * as React from 'react';

import ColourSelection from './ColourSelection';
import { ShowAnnotationFlags } from './MapAnnotations.types';
import { EditMode, MapColourVisualisationMode } from './MapControls.types';
import { Layer } from '../models/interfaces';
import { hexColours } from '../models/featureColour';

import Button from 'react-bootstrap/Button';
import ButtonGroup from 'react-bootstrap/ButtonGroup';
import Dropdown from 'react-bootstrap/Dropdown';
import OverlayTrigger from 'react-bootstrap/OverlayTrigger';
import ToggleButton from 'react-bootstrap/ToggleButton';
import Tooltip from 'react-bootstrap/Tooltip';

import { faDotCircle, faDrawPolygon, faMousePointer, faPlus, faSquare, faCog, faSuitcase, faMapMarker, faSearchPlus, faSearchMinus, faUser, faImage, faImages, faCubes, faBezierCurve, faEye } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';

// We make the children the tooltip contents, to allow for convenient formatting
interface IModeButtonProps<T> {
  value: T; // the value of this button
  icon: React.ReactNode;
  children: React.ReactNode;
  mode: T; // the currently selected mode
  setMode(value: T): void;
  name: string; // radio group name for react-bootstrap v2
}

function ModeButton<T>({ value, icon, children, mode, setMode, name }: IModeButtonProps<T>) {
  // Deal with a strange `readonly string[]` possibility for type T
  const valueProperty = useMemo(
    () => typeof(value) === 'number' ? value : `${value}`,
    [value]
  );
  const buttonId = `mode-btn-${valueProperty}`;

  // In react-bootstrap v2, ToggleButton renders as input + label.
  // The onChange event doesn't reliably fire in all cases (particularly
  // when buttons are dynamically added/removed based on layer switching).
  // We use onClick on the wrapper span to ensure mode changes are captured.
  // See: https://github.com/react-bootstrap/react-bootstrap/issues/5429
  const handleClick = useCallback(() => {
    if (mode !== value) {
      setMode(value);
    }
  }, [mode, value, setMode]);

  return (
    <OverlayTrigger placement="right" overlay={
      <Tooltip id={value + "-tooltip"}>{children}</Tooltip>
    }>
      <span className="d-block w-100" onClick={handleClick}>
        <ToggleButton id={buttonId} type="radio" variant="dark" value={valueProperty}
          name={name}
          checked={mode === value}
          className="w-100">
          {icon}
        </ToggleButton>
      </span>
    </OverlayTrigger>
  );
}

function AreaIcon({ colour, stripe }: { colour: 'black' | 'white', stripe: number }) {
  if (stripe === 0) {
    return (<FontAwesomeIcon icon={faSquare} color={colour} />);
  } else {
    return (<svg width="16" height="16" viewBox="0 0 16 16">
      <image xlinkHref={`/square_${stripe}_${colour}.svg`} height="16px" width="16px" />
    </svg>);
  }
}

interface IMapControlsProps {
  layer: Layer;
  setLayer(value: Layer): void;
  editMode: EditMode;
  setEditMode(value: EditMode): void;
  selectedColour: number;
  setSelectedColour(value: number): void;
  selectedStripe: number;
  setSelectedStripe(value: number): void;

  zoomInDisabled: boolean;
  zoomOutDisabled: boolean;
  zoomIn: () => void;
  zoomOut: () => void;
  resetView(c?: string | undefined): void;

  mapColourVisualisationMode: MapColourVisualisationMode;
  setMapColourVisualisationMode(mode: MapColourVisualisationMode): void;
  groupVisionColours: ReadonlySet<number>;
  toggleGroupVisionColour(value: number): void;
  addGroupVisionColourRange(from: number, to: number): void;
  removeGroupVisionColourRange(from: number, to: number): void;
  canDoAnything: boolean;
  // True when the signed-in user's tier permits uploading images. Tiers with
  // images cap = 0 (Basic) get the image layer button and the image edit-mode
  // button removed entirely — they can't add images, so the toolbar entry
  // would lead to a dead end.
  canUploadImages: boolean;
  isOwner: boolean;
  openMapEditor(): void;
  setShowAnnotationFlags(flags: ShowAnnotationFlags): void;
}

function MapControls({
  layer, setLayer, editMode, setEditMode, selectedColour, setSelectedColour, selectedStripe, setSelectedStripe,
  zoomInDisabled, zoomOutDisabled, zoomIn, zoomOut, resetView,
  mapColourVisualisationMode, setMapColourVisualisationMode,
  groupVisionColours, toggleGroupVisionColour, addGroupVisionColourRange, removeGroupVisionColourRange,
  canDoAnything, canUploadImages, isOwner, openMapEditor, setShowAnnotationFlags
}: IMapControlsProps) {
  const layerButtons = useMemo(() => {
    if (!canDoAnything) {
      return [];
    }
    const buttons = [];
    if (canUploadImages) {
      buttons.push(
        <ModeButton key={Layer.Image} value={Layer.Image}
          icon={<FontAwesomeIcon icon={faImages} color="white" />}
          mode={layer} setMode={setLayer} name="layer-select"
        >
          Image layer
        </ModeButton>
      );
    }
    buttons.push(
      <ModeButton key={Layer.Object} value={Layer.Object}
        icon={<FontAwesomeIcon icon={faCubes} color="white" />}
        mode={layer} setMode={setLayer} name="layer-select"
      >
        Object layer
      </ModeButton>
    );
    return buttons;
  }, [canDoAnything, canUploadImages, layer, setLayer]);

  // Use layer-specific radio group names to avoid browser radio state conflicts
  // when switching between layers (unmounted buttons can leave stale radio state)
  const editModeRadioName = `edit-mode-${layer}`;

  const modeButtons = useMemo(() => {
    const buttons = [
      <ModeButton key={EditMode.Select} value={EditMode.Select}
        icon={<FontAwesomeIcon icon={faMousePointer} color="white" />}
        mode={editMode} setMode={setEditMode} name={editModeRadioName}
      >
        <u>S</u>elect and move tokens
      </ModeButton>
    ];

    if (canDoAnything) {
      if (layer === Layer.Image && canUploadImages) {
        buttons.push(
          <ModeButton key={EditMode.Image} value={EditMode.Image}
            icon={<FontAwesomeIcon icon={faImage} color="white" />}
            mode={editMode} setMode={setEditMode} name={editModeRadioName}
          >
            Add and edit <u>i</u>mages
        </ModeButton>
        );
      } else if (layer === Layer.Object) {
        buttons.push(...[
          <ModeButton key={EditMode.Token} value={EditMode.Token}
            icon={<FontAwesomeIcon icon={faPlus} color="white" />}
            mode={editMode} setMode={setEditMode} name={editModeRadioName}
          >
            Add and edit <u>t</u>okens
        </ModeButton>,
          <ModeButton key={EditMode.CharacterToken} value={EditMode.CharacterToken}
            icon={<FontAwesomeIcon icon={faUser} color="white" />}
            mode={editMode} setMode={setEditMode} name={editModeRadioName}
          >
            Add and edit <u>c</u>haracter tokens
        </ModeButton>,
          <ModeButton key={EditMode.Notes} value={EditMode.Notes}
            icon={<FontAwesomeIcon icon={faMapMarker} color="white" />}
            mode={editMode} setMode={setEditMode} name={editModeRadioName}
          >
            Add and edit map <u>n</u>otes
        </ModeButton>,
          <ModeButton key={EditMode.Area} value={EditMode.Area}
            icon={<FontAwesomeIcon icon={faSquare} color="white" />}
            mode={editMode} setMode={setEditMode} name={editModeRadioName}
          >
            Paint solid <u>a</u>reas.  Shift-drag to paint a rectangle.
        </ModeButton>
        ]);
      }
    }

    if (layer === Layer.Object) {
      buttons.push(
        <ModeButton key={EditMode.PlayerArea} value={EditMode.PlayerArea}
          icon={<AreaIcon colour="white" stripe={selectedStripe} />}
          mode={editMode} setMode={setEditMode} name={editModeRadioName}
        >
          Paint striped <u>a</u>reas.  Shift-drag to paint a rectangle.
          </ModeButton>
      );
    }

    if (canDoAnything && layer === Layer.Object) {
      buttons.push(...[
        <ModeButton key={EditMode.Wall} value={EditMode.Wall}
          icon={<FontAwesomeIcon icon={faBezierCurve} color="white" />}
          mode={editMode} setMode={setEditMode} name={editModeRadioName}
        >
          Paint <u>w</u>alls.  Shift-drag to paint rectangles of walls.
        </ModeButton>,
        <ModeButton key={EditMode.Room} value={EditMode.Room}
          icon={<FontAwesomeIcon icon={faDrawPolygon} color="white" />}
          mode={editMode} setMode={setEditMode} name={editModeRadioName}
        >
          Paint the union of <u>r</u>ooms.  Shift-drag to paint the difference of rooms.
        </ModeButton>,
      ]);
    }

    return buttons;
  }, [canDoAnything, canUploadImages, editMode, editModeRadioName, layer, selectedStripe, setEditMode]);

  const stripeMenuItems = useMemo(
    () => ([1, 2, 3, 4]).map(s => (
      <Dropdown.Item key={s} onClick={() => setSelectedStripe(s)}>
        <AreaIcon colour="white" stripe={s} />
      </Dropdown.Item>
    )),
    [setSelectedStripe]
  );

  const hideExtraControls = useMemo(() => !canDoAnything, [canDoAnything]);
  const isNotOwner = useMemo(() => !isOwner, [isOwner]);
  const handleResetView = useCallback(() => resetView(), [resetView]);

  const groupVisionEyeColour = useMemo(() => {
    if (groupVisionColours.size === 0) return 'black';
    if (groupVisionColours.size === 1) {
      const [only] = groupVisionColours;
      return hexColours[only];
    }
    return 'white';
  }, [groupVisionColours]);

  const selectGroupVisionMode = useCallback(() => {
    if (mapColourVisualisationMode !== MapColourVisualisationMode.GroupVision) {
      setMapColourVisualisationMode(MapColourVisualisationMode.GroupVision);
    }
  }, [mapColourVisualisationMode, setMapColourVisualisationMode]);

  // Picking colours from the dropdown implies "I want this group's vision",
  // so activate GroupVision mode alongside the colour change.
  const handleToggleGroupVision = useCallback((value: number) => {
    selectGroupVisionMode();
    toggleGroupVisionColour(value);
  }, [selectGroupVisionMode, toggleGroupVisionColour]);
  const handleAddGroupVisionRange = useCallback((from: number, to: number) => {
    selectGroupVisionMode();
    addGroupVisionColourRange(from, to);
  }, [selectGroupVisionMode, addGroupVisionColourRange]);
  const handleRemoveGroupVisionRange = useCallback((from: number, to: number) => {
    selectGroupVisionMode();
    removeGroupVisionColourRange(from, to);
  }, [selectGroupVisionMode, removeGroupVisionColourRange]);

  return (
    <div className="Map-controls">
      <ButtonGroup className="Map-control" vertical>{layerButtons}</ButtonGroup>
      <ButtonGroup className="Map-control" vertical>{modeButtons}</ButtonGroup>
      <ButtonGroup className="Map-control" vertical>
        <OverlayTrigger placement="right" overlay={
          <Tooltip id="zoomin-tooltip">Zoom in</Tooltip>
        }>
          <Button variant="dark" onClick={zoomIn} disabled={zoomInDisabled}>
            <FontAwesomeIcon icon={faSearchPlus} color="white" />
          </Button>
        </OverlayTrigger>
        <OverlayTrigger placement="right" overlay={
          <Tooltip id="zoomin-tooltip">Zoom out</Tooltip>
        }>
          <Button variant="dark" onClick={zoomOut} disabled={zoomOutDisabled}>
            <FontAwesomeIcon icon={faSearchMinus} color="white" />
          </Button>
        </OverlayTrigger>
        <OverlayTrigger placement="right" overlay={
          <Tooltip id="reset-tooltip">Reset the map view to <u>o</u>rigin</Tooltip>
        }>
          <Button variant="dark" onClick={handleResetView}>
            <FontAwesomeIcon icon={faDotCircle} color="white" />
          </Button>
        </OverlayTrigger>
        <Dropdown as={ButtonGroup} drop="end">
          <Dropdown.Toggle variant="dark">
            <FontAwesomeIcon icon={faMapMarker} color="white" />
          </Dropdown.Toggle>
          <Dropdown.Menu>
            <Dropdown.Item onClick={() => setShowAnnotationFlags(ShowAnnotationFlags.None)}>No notes visible</Dropdown.Item>
            <Dropdown.Item onClick={() => setShowAnnotationFlags(ShowAnnotationFlags.MapNotes)}>Map notes only</Dropdown.Item>
            <Dropdown.Item onClick={() => setShowAnnotationFlags(ShowAnnotationFlags.TokenNotes)}>Token notes only</Dropdown.Item>
            <Dropdown.Item onClick={() => setShowAnnotationFlags(ShowAnnotationFlags.All)}>All notes visible</Dropdown.Item>
          </Dropdown.Menu>
        </Dropdown>
        <Dropdown as={ButtonGroup} drop="end">
          <Dropdown.Toggle variant="dark">
            <AreaIcon colour="white" stripe={selectedStripe} />
          </Dropdown.Toggle>
          <Dropdown.Menu>
            {stripeMenuItems}
          </Dropdown.Menu>
        </Dropdown>
      </ButtonGroup>
      <ColourSelection className="Map-control" id="mapColourSelect"
        hidden={hideExtraControls && editMode !== EditMode.PlayerArea}
        includeNegative={true}
        isVertical={true}
        selectedColour={selectedColour}
        setSelectedColour={setSelectedColour} />
      <ButtonGroup className="Map-control" hidden={hideExtraControls} vertical>
        <ModeButton value={MapColourVisualisationMode.Areas}
          icon={<FontAwesomeIcon icon={faSquare} color="white" />}
          mode={mapColourVisualisationMode} setMode={setMapColourVisualisationMode}
          name="colour-visualisation"
        >Show whole map</ModeButton>
        <Dropdown as={ButtonGroup} drop="end" autoClose="outside">
          <OverlayTrigger placement="right" overlay={
            <Tooltip id="group-vision-tooltip">Show group vision</Tooltip>
          }>
            <Button variant="dark"
              active={mapColourVisualisationMode === MapColourVisualisationMode.GroupVision}
              onClick={selectGroupVisionMode}>
              <FontAwesomeIcon icon={faEye} color={groupVisionEyeColour} />
            </Button>
          </OverlayTrigger>
          <Dropdown.Toggle split variant="dark" id="group-vision-dropdown" />
          <Dropdown.Menu>
            <ColourSelection id="groupVisionColourSelect"
              isVertical={false}
              selectedColours={groupVisionColours}
              toggleColour={handleToggleGroupVision}
              addColourRange={handleAddGroupVisionRange}
              removeColourRange={handleRemoveGroupVisionRange} />
          </Dropdown.Menu>
        </Dropdown>
        <ModeButton value={MapColourVisualisationMode.Connectivity}
          icon={<FontAwesomeIcon icon={faSuitcase} color="white" />}
          mode={mapColourVisualisationMode} setMode={setMapColourVisualisationMode}
          name="colour-visualisation"
        >Colourise rooms</ModeButton>
      </ButtonGroup>
      <ButtonGroup className="Map-control" hidden={isNotOwner} vertical>
        <OverlayTrigger placement="right" overlay={
          <Tooltip id="map-editor-tooltip">Open map settings</Tooltip>
        }>
          <Button variant="dark" onClick={() => openMapEditor()}>
            <FontAwesomeIcon icon={faCog} color="white" />
          </Button>
        </OverlayTrigger>
      </ButtonGroup>
    </div>
  );
}

export default MapControls;