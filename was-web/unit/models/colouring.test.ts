import { MapColouring } from './colouring';
import { HexGridGeometry } from './hexGridGeometry';
import { SquareGridGeometry } from './squareGridGeometry';
import { FeatureDictionary, IFeature } from '../data/feature';
import { GridCoord, coordString } from '../data/coord';

// TODO This will be a super trivial test because expressing complex maps in
// code isn't nice -- to better exercise it, I should create a map colouring
// visualisation mode, enabled if you're the map owner.

test('Surround one square on a square grid', () => {
  let colouring = new MapColouring(new SquareGridGeometry(100, 8));

  // At the beginning we should just have colour 0 everywhere
  const surrounded = { x: 0, y: 0 };
  const notSurrounded = [
    { x: -1, y: 0 },
    { x: 0, y: -1 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: -2, y: 2 },
    { x: 10, y: -20 }
  ];

  expect(colouring.colourOf(surrounded)).toBe(0);
  notSurrounded.forEach(c => expect(colouring.colourOf(c)).toBe(0));

  // Add these walls and there should be no change, although the colour
  // number might be different
  colouring.setWall({ x: 0, y: 0, edge: 0 }, true);
  colouring.setWall({ x: 0, y: 0, edge: 1 }, true);
  colouring.setWall({ x: 1, y: 0, edge: 0 }, true);
  colouring.recalculate();

  let colour = colouring.colourOf(surrounded);
  notSurrounded.forEach(c => expect(colouring.colourOf(c)).toBe(colour));

  // Add the final one and (0, 0) should be entirely surrounded, and
  // a different colour to the others
  colouring.setWall({ x: 0, y: 1, edge: 1 }, true);
  colouring.recalculate();

  let colourInside = colouring.colourOf(surrounded);
  let colourOutside = colouring.colourOf(notSurrounded[0]);
  expect(colourOutside).not.toBe(colourInside);
  notSurrounded.slice(1).forEach(c => expect(colouring.colourOf(c)).toBe(colourOutside));

  // Remove one of those walls again and once more everything should be
  // the same colour
  colouring.setWall({ x: 0, y: 0, edge: 0 }, false);
  colouring.recalculate();

  colour = colouring.colourOf(surrounded);
  notSurrounded.forEach(c => expect(colouring.colourOf(c)).toBe(colour));
});

test('Surround three hexes on a hex grid', () => {
  let colouring = new MapColouring(new HexGridGeometry(100, 8));

  // We'll surround these three, and then "zero" by itself
  const zero = { x: 0, y: 0 };
  const inner = [{ x: 0, y: 1 }, { x: 1, y: 0 }];

  // These are all the hexes right around them
  const outer = [
    { x: 0, y: -1 },
    { x: -1, y: 0 },
    { x: -1, y: 1 },
    { x: -1, y: 2 },
    { x: 0, y: 2 },
    { x: 1, y: 1 },
    { x: 2, y: 0 },
    { x: 2, y: -1 },
    { x: 1, y: -1 }
  ];

  // These are a few further away for sanity
  const further = [
    { x: -2, y: 2 },
    { x: 0, y: -2 },
    { x: 3, y: 3 },
    { x: 3, y: -3 }
  ];

  // At the beginning everything should be 0
  expect(colouring.colourOf(zero)).toBe(0);
  inner.forEach(c => expect(colouring.colourOf(c)).toBe(0));
  outer.forEach(c => expect(colouring.colourOf(c)).toBe(0));
  further.forEach(c => expect(colouring.colourOf(c)).toBe(0));

  // Do most of the surround except for the two walls on the right-hand side
  [
    { x: 1, y: 0, edge: 1 },
    { x: 0, y: 0, edge: 2 },
    { x: 0, y: 0, edge: 1 },
    { x: 0, y: 0, edge: 0 },
    { x: -1, y: 1, edge: 2 },
    { x: 0, y: 1, edge: 0 },
    { x: -1, y: 2, edge: 2 },
    { x: 0, y: 2, edge: 1 },
    { x: 1, y: 1, edge: 0 },
    { x: 1, y: 1, edge: 1 }
  ].forEach(w => colouring.setWall(w, true));
  colouring.recalculate();

  // Everything should still be the same colour after that
  let colour = colouring.colourOf(zero);
  inner.forEach(c => expect(colouring.colourOf(c)).toBe(colour));
  outer.forEach(c => expect(colouring.colourOf(c)).toBe(colour));
  further.forEach(c => expect(colouring.colourOf(c)).toBe(colour));

  // Close off the right-hand side and the three inner hexes should be a different
  // colour to the rest
  [
    { x: 2, y: 0, edge: 0 },
    { x: 1, y: 0, edge: 2 }
  ].forEach(w => colouring.setWall(w, true));
  colouring.recalculate();

  let innerColour = colouring.colourOf(zero);
  let outerColour = colouring.colourOf(outer[0]);
  expect(innerColour).not.toBe(outerColour);

  inner.forEach(c => expect(colouring.colourOf(c)).toBe(innerColour));
  outer.forEach(c => expect(colouring.colourOf(c)).toBe(outerColour));
  further.forEach(c => expect(colouring.colourOf(c)).toBe(outerColour));

  // Put down walls between "zero" and the others and it should end up different again
  [
    { x: 0, y: 1, edge: 1 },
    { x: 1, y: 0, edge: 0 }
  ].forEach(w => colouring.setWall(w, true));
  colouring.recalculate();

  let zeroColour = colouring.colourOf(zero);
  innerColour = colouring.colourOf(inner[0]);
  outerColour = colouring.colourOf(outer[0]);
  
  expect(zeroColour).not.toBe(innerColour);
  expect(zeroColour).not.toBe(outerColour);
  expect(innerColour).not.toBe(outerColour);

  inner.forEach(c => expect(colouring.colourOf(c)).toBe(innerColour));
  outer.forEach(c => expect(colouring.colourOf(c)).toBe(outerColour));
  further.forEach(c => expect(colouring.colourOf(c)).toBe(outerColour));

  // The same should hold for the visualisation, except we can't expect the further-away
  // hexes to be visualised
  let vis = new FeatureDictionary<GridCoord, IFeature<GridCoord>>(coordString);
  colouring.visualise(vis, (p, c, cc) => { return { position: p, colour: c / cc }; });

  let zeroVisColour = vis.get(zero)?.colour ?? -1;
  let innerVisColour = vis.get(inner[0])?.colour ?? -1;
  let outerVisColour = vis.get(outer[0])?.colour ?? -1;

  expect(zeroVisColour).not.toBe(innerVisColour);
  expect(zeroVisColour).not.toBe(outerVisColour);
  expect(innerVisColour).not.toBe(outerVisColour);

  [zeroVisColour, innerVisColour, outerVisColour].forEach(c => {
    expect(c).toBeGreaterThanOrEqual(0);
    expect(c).toBeLessThan(1);
  });

  inner.forEach(c => expect(vis.get(c)?.colour).toBe(innerVisColour));
  outer.forEach(c => expect(vis.get(c)?.colour).toBe(outerVisColour));

  // Bust the inner area open and the outer colour should flood into it, but the
  // zero hex should stay its own
  colouring.setWall({ x: 1, y: 0, edge: 1 }, false);
  colouring.recalculate();

  zeroColour = colouring.colourOf(zero);
  outerColour = colouring.colourOf(outer[0]);
  
  expect(zeroColour).not.toBe(outerColour);

  inner.forEach(c => expect(colouring.colourOf(c)).toBe(outerColour));
  outer.forEach(c => expect(colouring.colourOf(c)).toBe(outerColour));
  further.forEach(c => expect(colouring.colourOf(c)).toBe(outerColour));
});

// We export these functions so that the LoS test can use them too
export function *enumerateSquares(radius: number, step: number) {
  for (let j = -radius; j < radius; j += step) {
    for (let i = -radius; i < radius; i += step) {
      yield { x: i, y: j };
    }
  }
}

export function walledSquare(x: number, y: number) {
  return [
    // Top
    { x: x, y: y, edge: 1 },
    { x: x + 1, y: y, edge: 1 },
    { x: x + 2, y: y, edge: 1 },

    // Right
    { x: x + 3, y: y, edge: 0 },
    { x: x + 3, y: y + 1, edge: 0 },
    { x: x + 3, y: y + 2, edge: 0 },

    // Bottom
    { x: x + 2, y: y + 3, edge: 1 },
    { x: x + 1, y: y + 3, edge: 1 },
    { x: x, y: y + 3, edge: 1 },

    // Left
    { x: x, y: y + 2, edge: 0 },
    { x: x, y: y + 1, edge: 0 },
    { x: x, y: y, edge: 0 }
  ];
}

test('Surround lots of 3-square rooms on a square grid', () => {
  // This test is intended to both confirm the functionality (it should) and
  // exercise the performance of the colouring algorithm.
  const radius = 100;
  const step = 6;
  const colouring = new MapColouring(new SquareGridGeometry(75, 12));

  for (const sq of enumerateSquares(radius, step)) {
    walledSquare(sq.x, sq.y).forEach(w => colouring.setWall(w, true));
  }
  colouring.recalculate();

  // Each of the faces at offset (0, 0) and (1, 2) should be in the same colour
  // as each other and different to all the other ones
  const innerColours = new Map<number, number>();
  for (const sq of enumerateSquares(radius, step)) {
    const atZero = colouring.colourOf(sq);
    expect(innerColours.has(atZero)).toBeFalsy();
    innerColours.set(atZero, 0);

    const atOneTwo = colouring.colourOf({ x: sq.x + 1, y: sq.y + 2 });
    expect(atOneTwo).toBe(atZero);
  }

  // Each of the faces at offset (3, 3) should be in the outside colour, which is
  // different again
  let outsideColour: number | undefined = undefined;
  for (const sq of enumerateSquares(radius, step)) {
    const atThree = colouring.colourOf({ x: sq.x + 3, y: sq.y + 3 });
    if (outsideColour === undefined) {
      outsideColour = atThree;
    } else {
      expect(atThree).toBe(outsideColour);
    }

    expect(atThree in innerColours).toBeFalsy();
  }
});