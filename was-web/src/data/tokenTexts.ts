import { ICharacter } from "./character";
import { coordString, edgeString, GridCoord, GridEdge, GridVertex, vertexString } from "./coord";
import { FeatureDictionary, IFeature, IFeatureDictionary, IToken, ITokenProperties, ITokenText } from "./feature";
import { ITokenGeometry } from "./tokenGeometry";
import { BaseTokenDrawing, ITokenDrawing, ITokenFace, ITokenFillEdge, ITokenFillVertex, Tokens } from "./tokens";

import { Observable, Subscription } from 'rxjs';

// Based on ITokenDrawing, describes how to draw tokens' text positioning.
export interface ITokenTextDrawing {
  texts: IFeatureDictionary<GridVertex, ITokenText>;

  createText(
    token: IToken,
    character: ICharacter | undefined,
    position: GridVertex,
    atVertex: boolean
  ): ITokenText;

  dispose(): void;
}

export class BaseTokenDrawingWithText<
  TFacesDict extends IFeatureDictionary<GridCoord, ITokenFace>,
  TFillEdgesDict extends IFeatureDictionary<GridEdge, ITokenFillEdge>,
  TFillVerticesDict extends IFeatureDictionary<GridVertex, ITokenFillVertex>,
  TTextsDict extends IFeatureDictionary<GridVertex, ITokenText>
> extends BaseTokenDrawing<TFacesDict, TFillEdgesDict, TFillVerticesDict> implements ITokenTextDrawing {
  private readonly _texts: TTextsDict;

  constructor(
    faces: TFacesDict,
    fillEdges: TFillEdgesDict,
    fillVertices: TFillVerticesDict,
    texts: TTextsDict
  ) {
    super(faces, fillEdges, fillVertices);
    this._texts = texts;
  }

  get texts() { return this._texts; }

  clear() {
    super.clear();
    this._texts.clear();
  }

  clone() {
    return new BaseTokenDrawingWithText(
      this.faces.clone(), this.fillEdges.clone(), this.fillVertices.clone(), this._texts.clone()
    );
  }

  createText(
    token: ITokenProperties,
    character: ICharacter | undefined,
    position: GridVertex,
    atVertex: boolean
  ) {
    // For outline tokens, we always draw the text in the smallest size and we offset it
    // so that it's both closer to the actual line of the outline, and dodges other
    // token texts:
    return {
      position: position,
      colour: token.colour,
      size: token.outline ? 1 : Number(token.size[0]),
      yOffset: token.outline ? 1.5 : 0,
      text: character?.text ?? token.text,
      atVertex: atVertex
    };
  }
}

// For testing.
export class SimpleTokenTextDrawing extends BaseTokenDrawingWithText<
  IFeatureDictionary<GridCoord, ITokenFace>,
  IFeatureDictionary<GridEdge, ITokenFillEdge>,
  IFeatureDictionary<GridVertex, ITokenFillVertex>,
  IFeatureDictionary<GridCoord, ITokenText>
> {
  constructor(
    faces?: IFeatureDictionary<GridCoord, ITokenFace> | undefined,
    fillEdges?: IFeatureDictionary<GridEdge, ITokenFillEdge> | undefined,
    fillVertices?: IFeatureDictionary<GridVertex, ITokenFillVertex> | undefined,
    texts?: IFeatureDictionary<GridVertex, ITokenText> | undefined
  ) {
    super(
      faces ?? new FeatureDictionary<GridCoord, ITokenFace>(coordString),
      fillEdges ?? new FeatureDictionary<GridEdge, ITokenFillEdge>(edgeString),
      fillVertices ?? new FeatureDictionary<GridVertex, ITokenFillVertex>(vertexString),
      texts ?? new FeatureDictionary<GridCoord, ITokenText>(coordString)
    );
  }
}

// This class includes text that is loaded via an observable.
export class TokensWithObservableText extends Tokens {
  private readonly _textDrawing: ITokenTextDrawing;
  private _observeCharacter: (token: IToken) => Observable<ICharacter | undefined>;

  // We use this to track our character subscriptions and unsubscribe as required
  private readonly _subs = new FeatureDictionary<GridCoord, IFeature<GridCoord> & { sub: Subscription }>(coordString);

  constructor(
    tokenGeometry: ITokenGeometry,
    drawing: ITokenDrawing,
    textDrawing: ITokenTextDrawing,
    observeCharacter: (token: IToken) => Observable<ICharacter | undefined>,
    values?: Map<string, IToken> | undefined,
    byId?: Map<string, IToken> | undefined
  ) {
    super(tokenGeometry, drawing, values, byId);
    this._textDrawing = textDrawing;
    this._observeCharacter = observeCharacter;
  }

  add(token: IToken) {
    if (super.add(token) === false) {
      return false;
    }

    const sub = this._observeCharacter(token).subscribe(c => {
      const textPosition = this.tokenGeometry.getTextPosition(token);
      const text = this._textDrawing.createText(
        token, c, textPosition, this.tokenGeometry.getTextAtVertex(token)
      );

      // Text isn't crucial to token positioning requirements, so we add and
      // forget here (which makes this code simpler!)
      this._textDrawing.texts.remove(text.position);
      this._textDrawing.texts.add(text);
    });

    if (this._subs.add({ position: token.position, colour: 0, sub: sub }) === false) {
      // oops!
      sub.unsubscribe();
      super.remove(token.position);
      return false;
    }

    return true;
  }

  remove(k: GridCoord) {
    const removed = super.remove(k);
    if (removed !== undefined) {
      // Unsubscribe ourselves from that character observer
      const removedSub = this._subs.remove(k);
      removedSub?.sub.unsubscribe();

      // Remove any text
      const textPosition = this.tokenGeometry.getTextPosition(removed);
      this._textDrawing.texts.remove(textPosition);
    }

    return removed;
  }

  setObserveCharacter(observeCharacter: (token: IToken) => Observable<ICharacter | undefined>) {
    this._observeCharacter = observeCharacter;
  }
}