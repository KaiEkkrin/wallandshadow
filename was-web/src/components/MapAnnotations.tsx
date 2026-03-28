import { forwardRef, useState, useEffect, useMemo } from 'react';
import '../App.css';
import '../Map.css';

import { IPositionedAnnotation } from '../data/annotation';
import { ShowAnnotationFlags } from './MapAnnotations.types';

import OverlayTrigger from 'react-bootstrap/OverlayTrigger';
import Popover from 'react-bootstrap/Popover';

import { faMapMarker } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';

interface IMapPopoverProps {
  id: string;
  left: string;
  bottom: string;
  children: React.ReactNode;
  // react-bootstrap v2 injects these props
  [key: string]: unknown;
}

// See https://react-bootstrap.github.io/components/overlays/#tooltips
const UpdatingPopover = forwardRef<HTMLDivElement, IMapPopoverProps>(
  ({ children, left: _left, bottom: _bottom, ...props }, ref) => {
    return (
      <Popover ref={ref} {...props}>
        <Popover.Body>{children as React.ReactNode}</Popover.Body>
      </Popover>
    );
  }
);

// Wrapper for FontAwesomeIcon to support refs required by OverlayTrigger in react-bootstrap v2
interface IRefIconProps {
  icon: typeof faMapMarker;
  color: string;
  onClick: () => void;
  style: React.CSSProperties;
}

const RefIcon = forwardRef<HTMLSpanElement, IRefIconProps>(
  ({ icon, color, onClick, style }, ref) => (
    <span ref={ref} onClick={onClick} style={style}>
      <FontAwesomeIcon icon={icon} color={color} />
    </span>
  )
);

interface IMapAnnotationProps {
  annotation: IPositionedAnnotation;
  showFlags: ShowAnnotationFlags;
  customFlags: boolean;
  setCustomFlags: (custom: boolean) => void;
  suppressAnnotations: boolean;
}

const defaultPinColour = "#5bc0de";

function MapAnnotation(props: IMapAnnotationProps) {
  // Show tooltips by default, unless you click them off.
  // If this is unset, we'll use what the flags say.
  const [showTooltip, setShowTooltip] = useState<boolean | undefined>(undefined);

  function viewToPercent(c: number) {
    return 50.0 * (c + 1);
  }

  const [left, setLeft] = useState("0vw");
  const [bottom, setBottom] = useState("0vh");
  const [pinColour, setPinColour] = useState(defaultPinColour);
  const [placement, setPlacement] = useState<"top" | "bottom">("top");
  const [zIndex, setZIndex] = useState(1);

  const isToken = useMemo(() => props.annotation.id.startsWith("Token"), [props.annotation.id]);

  useEffect(() => {
    setLeft(viewToPercent(props.annotation.clientX) + "vw");
    setBottom(viewToPercent(props.annotation.clientY) + "vh");
    if (isToken) {
      // I think this was generated from a token and I should make it look different
      setPinColour(props.annotation.visibleToPlayers === true ? "green" : "red");
      setPlacement("bottom");
      setZIndex(2);
    } else {
      setPinColour(props.annotation.visibleToPlayers === true ? defaultPinColour : "orange");
      setPlacement("top");
      setZIndex(1);
    }
  }, [props.annotation, isToken]);

  // When the show flags change, force that change over the top of our current
  // tooltip setting.
  useEffect(() => {
    if (props.customFlags === false) {
      setShowTooltip(undefined);
    }
  }, [props.customFlags]);

  // When the user customises the show flag, inform the container that flags are customised:
  useEffect(() => {
    if (showTooltip !== undefined) {
      props.setCustomFlags(true);
    }
  }, [props, showTooltip]);

  const show = useMemo(() => {
    if (props.suppressAnnotations) {
      // Annotations are always hidden while dragging the view and re-shown afterwards,
      // for performance reasons
      return false;
    } else if (showTooltip !== undefined) {
      return showTooltip;
    } else if (isToken) {
      return (props.showFlags & ShowAnnotationFlags.TokenNotes) !== 0;
    } else {
      return (props.showFlags & ShowAnnotationFlags.MapNotes) !== 0;
    }
  }, [props.suppressAnnotations, props.showFlags, isToken, showTooltip]);

  return (
    <OverlayTrigger placement={placement} show={show} overlay={
      <UpdatingPopover id={props.annotation.id + "-tooltip"} left={left} bottom={bottom}>
        {props.annotation.text}
      </UpdatingPopover>
    }>
      <RefIcon icon={faMapMarker} color={pinColour}
        onClick={() => setShowTooltip(!showTooltip)}
        style={{
          position: 'fixed',
          left: left,
          bottom: bottom,
          zIndex: zIndex,
        }}
      />
    </OverlayTrigger>
  );
}

interface IMapAnnotationsProps {
  annotations: IPositionedAnnotation[];
  showFlags: ShowAnnotationFlags;
  customFlags: boolean;
  setCustomFlags: (custom: boolean) => void;
  suppressAnnotations: boolean;
}

// This component draws annotations floating above the map.
function MapAnnotations(props: IMapAnnotationsProps) {
  return (
    <div>{props.annotations.map(a => <MapAnnotation
      key={a.id}
      annotation={a}
      showFlags={props.showFlags}
      customFlags={props.customFlags}
      setCustomFlags={props.setCustomFlags}
      suppressAnnotations={props.suppressAnnotations}
    />)}</div>
  );
}

export default MapAnnotations;