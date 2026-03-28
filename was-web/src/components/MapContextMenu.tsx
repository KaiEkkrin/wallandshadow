import { useMemo, useCallback } from 'react';
import * as React from 'react';

import { EditMode } from './MapControls.types'; // TODO remove it from there entirely and prune some?
import { IAnnotation } from '../data/annotation';
import { ITokenProperties } from '../data/feature';
import { IMapImageProperties } from '../data/image';

import Card from 'react-bootstrap/Card';
import ListGroup from 'react-bootstrap/ListGroup';

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPlus, faMapMarker, faSquare, faDrawPolygon, faArrowsAltH, faImage, faUser, faBezierCurve } from '@fortawesome/free-solid-svg-icons';

interface IMapContextMenuItemProps {
  visible?: boolean | undefined;
  children: React.ReactNode;
  onClick: (e: React.MouseEvent<Element, MouseEvent>) => void;
}

function MapContextMenuItem(props: IMapContextMenuItemProps) {
  return props.visible === false ? null : (
    <ListGroup.Item className="Map-info-list-item" action onClick={props.onClick}>
      {props.children}
    </ListGroup.Item>
  );
}

interface IEditTokenMenuItemProps {
  token: ITokenProperties;
  editToken: (id: string | undefined) => void;
}

function EditTokenMenuItem({ token, editToken }: IEditTokenMenuItemProps) {
  const icon = useMemo(() => token.characterId.length > 0 ? faUser : faPlus, [token.characterId]);
  return <MapContextMenuItem onClick={() => editToken(token.id)}>
    <FontAwesomeIcon className="me-1" icon={icon} color="white" />Edit token {token.text}
  </MapContextMenuItem>;
}

interface IFlipTokenMenuItemProps {
  token: ITokenProperties;
  flipToken: (id: string) => void;
}

function FlipTokenMenuItem({ token, flipToken }: IFlipTokenMenuItemProps) {
  return <MapContextMenuItem onClick={() => flipToken(token.id)}>
    <FontAwesomeIcon className="me-1" icon={faArrowsAltH} color="white" />Flip token {token.text}
  </MapContextMenuItem>;
}

interface IMapContextMenuProps {
  // True if shown, else false.
  show: boolean;
  hide: () => void;

  // The window co-ordinates where it was opened (so we can position it.)
  x: number;
  y: number;
  pageRight: number;
  pageBottom: number;

  // What was here in the map (if anything)
  tokens: ITokenProperties[];
  note: IAnnotation | undefined;
  image: IMapImageProperties | undefined;
  editToken: (id: string | undefined) => void;
  editCharacterToken: (id: string | undefined) => void;
  flipToken: (id: string) => void;
  editNote: () => void;
  editImage: () => void;

  editMode: EditMode;
  setEditMode: (m: EditMode) => void;
}

// We replace the context menu with this when the map is seen.
function MapContextMenu(
  { show, hide, x, y, pageRight, pageBottom, tokens, note, image,
    editToken, editCharacterToken, flipToken, editNote, editImage, setEditMode }: IMapContextMenuProps
) {
  const hidden = useMemo(() => !show, [show]);
  const noteLabel = useMemo(() => note === undefined ? "Add note" : "Edit note", [note]);
  const imageLabel = useMemo(() => image === undefined ? "Add image" : "Edit image", [image]);

  const left = useMemo(() => x > pageRight / 2 ? undefined : x, [x, pageRight]);
  const right = useMemo(() => x > pageRight / 2 ? pageRight - x : undefined, [x, pageRight]);

  const top = useMemo(() => y > pageBottom / 2 ? undefined : y, [y, pageBottom]);
  const bottom = useMemo(() => y > pageBottom / 2 ? pageBottom - y : undefined, [y, pageBottom]);

  const handleTokenClick = useCallback((id: string | undefined) => {
    editToken(id);
    hide();
  }, [editToken, hide]);

  const handleCharacterTokenClick = useCallback((id: string | undefined) => {
    editCharacterToken(id);
    hide();
  }, [editCharacterToken, hide]);

  const handleFlipTokenClick = useCallback((id: string) => {
    flipToken(id);
    hide();
  }, [flipToken, hide]);

  const editTokenItems = useMemo(() => {
    const items: React.ReactNode[] = [];
    for (const token of tokens) {
      const handleFn = token.characterId.length > 0 ? handleCharacterTokenClick : handleTokenClick;
      items.push(<EditTokenMenuItem key={`editToken${token.id}`} token={token} editToken={handleFn} />);
    }

    // With less than 2 tokens (implicitly, the max of one regular, one outline),
    // we can add another one
    if (tokens.length < 2) {
      items.push(<MapContextMenuItem key="addToken" onClick={() => handleTokenClick(undefined)}>
        <FontAwesomeIcon className="me-1" icon={faPlus} color="white" />Add token
      </MapContextMenuItem>);
    }

    // If there isn't a regular token there already, we can add a character token
    // (always regular)
    if (tokens.find(t => t.outline === false) === undefined) {
      items.push(<MapContextMenuItem key="addCharacterToken" onClick={() => handleCharacterTokenClick(undefined)}>
        <FontAwesomeIcon className="me-1" icon={faUser} color="white" />Add character token
      </MapContextMenuItem>);
    }

    return <React.Fragment>{items}</React.Fragment>;
  }, [handleCharacterTokenClick, handleTokenClick, tokens]);

  const flipTokenItems = useMemo(() => {
    const items: React.ReactNode[] = [];
    for (const token of tokens) {
      items.push(<FlipTokenMenuItem key={`flipToken${token.id}`} token={token} flipToken={handleFlipTokenClick} />);
    }

    return <React.Fragment>{items}</React.Fragment>;
  }, [handleFlipTokenClick, tokens]);

  const handleNoteClick = useCallback(() => {
    editNote();
    hide();
  }, [editNote, hide]);

  const handleImageClick = useCallback(() => {
    editImage();
    hide();
  }, [editImage, hide]);

  const setAreaMode = useCallback(() => {
    setEditMode(EditMode.Area);
    hide();
  }, [setEditMode, hide]);

  const setWallMode = useCallback(() => {
    setEditMode(EditMode.Wall);
    hide();
  }, [setEditMode, hide]);

  const setRoomMode = useCallback(() => {
    setEditMode(EditMode.Room);
    hide();
  }, [setEditMode, hide]);

  return (
    <Card bg="dark" text="white" hidden={hidden} style={{
      position: "absolute",
      left: left,
      right: right,
      top: top,
      bottom: bottom,
      zIndex: 2002
    }}>
      <ListGroup variant="flush">
        {editTokenItems}
        {flipTokenItems}
        <MapContextMenuItem onClick={handleNoteClick}>
          <FontAwesomeIcon className="me-1" icon={faMapMarker} color="white" />{noteLabel}
        </MapContextMenuItem>
        <MapContextMenuItem onClick={handleImageClick}>
          <FontAwesomeIcon className="me-1" icon={faImage} color="white" />{imageLabel}
        </MapContextMenuItem>
        <MapContextMenuItem onClick={setAreaMode}>
          <FontAwesomeIcon className="me-1" icon={faSquare} color="white" />Paint <u>a</u>rea
        </MapContextMenuItem>
        <MapContextMenuItem onClick={setWallMode}>
          <FontAwesomeIcon className="me-1" icon={faBezierCurve} color="white" />Paint <u>w</u>all
        </MapContextMenuItem>
        <MapContextMenuItem onClick={setRoomMode}>
          <FontAwesomeIcon className="me-1" icon={faDrawPolygon} color="white" />Paint <u>r</u>oom
        </MapContextMenuItem>
      </ListGroup>
    </Card>
  );
}

export default MapContextMenu;