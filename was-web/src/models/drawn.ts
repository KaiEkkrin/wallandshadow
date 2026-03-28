import { IGridGeometry } from "./gridGeometry";
import { RedrawFlag } from "./redrawFlag";

// A helpful basis for anything that we draw with Three, and
// sometimes needs a redraw.
export abstract class Drawn {
  private readonly _geometry: IGridGeometry;
  private readonly _redrawFlag: RedrawFlag;

  constructor(geometry: IGridGeometry, redrawFlag: RedrawFlag) {
    this._geometry = geometry;
    this._redrawFlag = redrawFlag;
  }

  protected get geometry() { return this._geometry; }

  protected setNeedsRedraw() { this._redrawFlag.setNeedsRedraw(); }
  abstract dispose(): void;
}