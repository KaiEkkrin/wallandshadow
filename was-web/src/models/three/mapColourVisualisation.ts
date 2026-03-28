import { GridCoord, coordString } from '../../data/coord';
import { IFeature } from '../../data/feature';
import { createPaletteColouredAreaObject } from './areas';
import { MapColouring } from '../colouring';
import { FeatureColour } from '../featureColour';
import { IGridGeometry } from '../gridGeometry';
import { InstancedFeatures } from './instancedFeatures';
import { PaletteColouredFeatureObject } from './paletteColouredFeatureObject';
import { RedrawFlag } from '../redrawFlag';

import * as THREE from 'three';

// Visualises the map colours as areas.
// Don't addToScene() it directly, but call visualise(), so that it can manage its palette.

const defaultColour = new THREE.Color(0x222222); // should be distinctive -- I shouldn't see this

export class MapColourVisualisation extends InstancedFeatures<GridCoord, IFeature<GridCoord>> {
  private _colourCount = 0;

  // We start off with no colours; you need to call visualise() to define colours.
  constructor(
    gridGeometry: IGridGeometry,
    redrawFlag: RedrawFlag,
    alpha: number,
    areaZ: number,
    maxInstances?: number | undefined
  ) {
    super(
      gridGeometry,
      redrawFlag,
      coordString,
      createPaletteColouredAreaObject(gridGeometry, alpha, areaZ, {
        palette: [], defaultColour: defaultColour, blending: THREE.AdditiveBlending, transparent: true
      }),
      maxInstances
    );
  }

  visualise(scene: THREE.Scene, colouring: MapColouring) {
    colouring.visualise(this, (position: GridCoord, mapColour: number, mapColourCount: number) => {
      // If our scene has changed or the number of map colours has changed, we need to re-colour
      // our objects:
      if (scene !== this.scene || mapColourCount !== this._colourCount) {
        const colours = [...Array(mapColourCount).keys()].map(c => {
          return new FeatureColour(c / mapColourCount).dark;
        });

        this._colourCount = colours.length;
        for (const o of this.featureObjects) {
          if (o instanceof PaletteColouredFeatureObject) {
            o.setPalette(colours);
          }
        }

        this.addToScene(scene);
      }

      return { position: position, colour: mapColour };
    });
  }
}