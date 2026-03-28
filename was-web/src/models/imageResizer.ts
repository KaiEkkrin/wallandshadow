import { Change, createImageAdd, createImageRemove } from "../data/change";
import { IIdDictionary } from "../data/identified";
import { Anchor, anchorsEqual, anchorString, IMapControlPointDictionary, IMapControlPointIdentifier, IMapImage } from "../data/image";
import { IGridGeometry } from "./gridGeometry";

import * as THREE from 'three';

// Manages image sizing via the (start, end) control points.
// For now we support only one selected image at a time.
// Because we're okay with supporting a quite limited number of live control points,
// it's okay to identify them by iterating.
// TODO #135 Would it be cleaner if this class took over responsibility for image
// drag-move as well?
export class ImageResizer {
  private readonly _gridGeometry: IGridGeometry;
  private readonly _images: IIdDictionary<IMapImage>; // only read this
  private readonly _imageHighlights: IIdDictionary<IMapImage>; // write to this during drag only
  private readonly _highlights: IMapControlPointDictionary; // we manage this
  private readonly _selection: IMapControlPointDictionary; // and this

  private readonly _scratchVector1 = new THREE.Vector3();
  private readonly _scratchVector2 = new THREE.Vector3();

  private _dragging: IMapControlPointIdentifier | undefined;
  private _dragMode: 'vertex' | 'pixel' = 'vertex';

  constructor(
    gridGeometry: IGridGeometry,
    images: IIdDictionary<IMapImage>,
    imageHighlights: IIdDictionary<IMapImage>,
    highlights: IMapControlPointDictionary,
    selection: IMapControlPointDictionary,
  ) {
    this._gridGeometry = gridGeometry;
    this._images = images;
    this._imageHighlights = imageHighlights;
    this._highlights = highlights;
    this._selection = selection;
  }

  private areValidAnchorPositions(a: Anchor, b: Anchor | undefined): boolean {
    if (b === undefined) {
      return false;
    }

    // Don't allow images to end up super thin or super narrow, because they'll
    // become unselectable.  Because of the fun of the hex grid we need to do this
    // with world positions:
    const aPosition = this._gridGeometry.createAnchorPosition(this._scratchVector1, a);
    const separation = this._gridGeometry.createAnchorPosition(this._scratchVector2, b).sub(aPosition);
    const threshold = 5.0;
    return Math.abs(separation.x) > threshold && Math.abs(separation.y) > threshold;
  }

  get inDrag() { return this._dragging !== undefined; }

  dragCancel() {
    if (this._dragging !== undefined) {
      this._imageHighlights.remove(this._dragging.id);
    }

    this._highlights.clear();
    this._dragging = undefined;
  }

  // Populates a list of changes that would create the image edit.
  dragEnd(
    getAnchor: (mode: 'vertex' | 'pixel') => Anchor | undefined,
    changes: Change[]
  ): IMapImage | undefined {
    this.moveHighlight(getAnchor);
    if (this._dragging === undefined) {
      return undefined;
    }

    const image = this._images.get(this._dragging.id);
    const startedAt = this._selection.get(this._dragging);
    const movedTo = this._highlights.get(this._dragging);
    const otherAnchor = this._dragging.which === 'start' ? image?.end : image?.start;
    if (
      image !== undefined && startedAt !== undefined && movedTo !== undefined &&
      !anchorsEqual(startedAt.anchor, movedTo.anchor) &&
      this.areValidAnchorPositions(movedTo.anchor, otherAnchor) // TODO #135 draw highlights in red when this is false
    ) {
      // _images.get() may have returned internal fields, which we don't want to include!
      const updatedImage: IMapImage = {
        id: image.id,
        image: image.image,
        rotation: image.rotation,
        start: this._dragging.which === 'start' ? movedTo.anchor : image.start,
        end: this._dragging.which === 'end' ? movedTo.anchor : image.end
      };

      changes.push(
        createImageRemove(this._dragging.id),
        createImageAdd(updatedImage)
      );

      this.dragCancel();
      return updatedImage;
    } else {
      this.dragCancel();
      return undefined;
    }
  }

  // Returns true if we started a drag, else false.
  dragStart(hitTest: (anchor: Anchor) => boolean, shiftKey: boolean): boolean {
    this.dragCancel();
    for (const s of this._selection) {
      if (hitTest(s.anchor) === true) {
        this._dragging = s;
        this._dragMode = shiftKey ? 'pixel' : 'vertex';
        this._highlights.add(s);
        return true;
      }
    }
    
    return false;
  }

  // Returns the anchor moved to if a move was made, else false.
  moveHighlight(getAnchor: (mode: 'vertex' | 'pixel') => Anchor | undefined): boolean {
    if (this._dragging === undefined) {
      return false;
    }

    const anchor = getAnchor(this._dragMode);
    const currently = this._highlights.get(this._dragging);
    const currentImageHighlight = this._imageHighlights.get(this._dragging.id);
    console.debug(`moving: ${anchorString(currently?.anchor)} -> ${anchorString(anchor)}`);
    if (currently !== undefined && (anchor === undefined || anchorsEqual(currently.anchor, anchor))) {
      // No change.
      return false;
    }

    if (currently !== undefined) {
      this._highlights.remove(currently);
    }

    if (currentImageHighlight !== undefined) {
      this._imageHighlights.remove(currentImageHighlight.id);
    }

    if (anchor !== undefined) {
      console.debug(`adding highlight at ${anchorString(anchor)}`);
      const image = this._images.get(this._dragging.id);
      const otherAnchor = this._dragging.which === 'start' ? image?.end : image?.start;
      this._highlights.add({
        ...this._dragging, anchor: anchor, invalid: this.areValidAnchorPositions(anchor, otherAnchor) === false
      });

      if (image !== undefined && otherAnchor !== undefined) {
        const updatedImageHighlight: IMapImage = {
          id: image.id,
          image: image.image,
          rotation: image.rotation,
          start: this._dragging.which === 'start' ? anchor : otherAnchor,
          end: this._dragging.which === 'end' ? anchor : otherAnchor
        };
        this._imageHighlights.add(updatedImageHighlight);
      }
    }

    return true;
  }

  // Draws the highlights for an image (or removes them.)
  setSelectedImage(image: IMapImage | undefined) {
    if (image !== undefined) {
      console.debug(`selecting image ${image.id} at ${anchorString(image.start)}, ${anchorString(image.end)}`);
    }
    this.dragCancel();
    this._selection.clear();
    if (image !== undefined) {
      this._selection.add({ anchor: image.start, id: image.id, which: 'start' });
      this._selection.add({ anchor: image.end, id: image.id, which: 'end' });
    }
  }
}