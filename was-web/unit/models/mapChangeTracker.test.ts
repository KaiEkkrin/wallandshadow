import { vi } from 'vitest';
import { MapColouring } from './colouring';
import { HexGridGeometry } from './hexGridGeometry';
import { MapChangeTracker } from './mapChangeTracker';
import { ChangeType, ChangeCategory, TokenAdd, TokenMove, WallRemove, WallAdd } from '../data/change';
import { trackChanges, IChangeTracker } from '../data/changeTracking';
import { GridEdge, GridCoord, coordString, edgeString } from '../data/coord';
import { FeatureDictionary, IFeature, StripedArea } from '../data/feature';
import { IdDictionary } from '../data/identified';
import { IMapImage } from '../data/image';
import { MapType } from '../data/map';
import { IAnnotation } from '../data/annotation';
import { SimpleTokenDrawing, Tokens } from '../data/tokens';
import { getTokenGeometry } from '../data/tokenGeometry';

const ownerUid = "owner";
const uid1 = "uid1";
const uid2 = "uid2";
const map = {
  adventureName: "Test Adventure",
  name: "Test Map",
  description: "A test",
  owner: ownerUid,
  ty: MapType.Hex,
  ffa: false,
  imagePath: ""
};

// This function builds the same walls around three hexes, with the 0,0 hex
// closed from the other two inner ones, done by a test in colouring.tests
function buildWallsOfThreeHexes(changeTracker: IChangeTracker) {
  let changes = [
    { x: 1, y: 0, edge: 1 },
    { x: 0, y: 0, edge: 2 },
    { x: 0, y: 0, edge: 1 },
    { x: 0, y: 0, edge: 0 },
    { x: -1, y: 1, edge: 2 },
    { x: 0, y: 1, edge: 0 },
    { x: -1, y: 2, edge: 2 },
    { x: 0, y: 2, edge: 1 },
    { x: 1, y: 1, edge: 0 },
    { x: 1, y: 1, edge: 1 },
    { x: 2, y: 0, edge: 0 },
    { x: 1, y: 0, edge: 2 },
    { x: 0, y: 1, edge: 1 },
    { x: 1, y: 0, edge: 0 }
  ].map(p => {
    return <WallAdd>{
      ty: ChangeType.Add,
      cat: ChangeCategory.Wall,
      feature: { position: p, colour: 0 }
    };
  });

  return trackChanges(map, changeTracker, changes, ownerUid);
}

test('Unprivileged users cannot move other users\' tokens', () => {
  const areas = new FeatureDictionary<GridCoord, StripedArea>(coordString);
  const playerAreas = new FeatureDictionary<GridCoord, StripedArea>(coordString);
  const tokens = new Tokens(getTokenGeometry(MapType.Hex), new SimpleTokenDrawing());
  const outlineTokens = new Tokens(getTokenGeometry(MapType.Hex), new SimpleTokenDrawing());
  const walls = new FeatureDictionary<GridEdge, IFeature<GridEdge>>(edgeString);
  const notes = new FeatureDictionary<GridCoord, IAnnotation>(coordString);
  const images = new IdDictionary<IMapImage>();

  const handleChangesApplied = vi.fn();
  const handleChangesAborted = vi.fn();
  const changeTracker = new MapChangeTracker(
    areas, playerAreas, tokens, outlineTokens, walls, notes, images, undefined, undefined,
    handleChangesApplied, handleChangesAborted
  );

  // The walls should be irrelevant here :)
  let ok = buildWallsOfThreeHexes(changeTracker);
  expect(ok).toBeTruthy();
  expect(handleChangesApplied.mock.calls.length).toBe(1);
  expect(handleChangesApplied.mock.calls[0][0]).toBe(false); // no tokens changed
  expect(handleChangesAborted.mock.calls.length).toBe(0);

  let addTokens = [
    { position: { x: 0, y: 0 }, colour: 0, id: "a", players: [uid1], size: "1", text: "Zero" },
    { position: { x: 0, y: 1 }, colour: 0, id: "b", players: [uid2], size: "1", text: "Inner2" },
  ].map(t => {
    return <TokenAdd>{
      ty: ChangeType.Add,
      cat: ChangeCategory.Token,
      feature: t
    };
  });

  ok = trackChanges(map, changeTracker, addTokens, ownerUid);
  expect(ok).toBeTruthy();
  expect(handleChangesApplied.mock.calls.length).toBe(2);
  expect(handleChangesApplied.mock.calls[1][0]).toBe(true); // this time token changes were made
  expect(handleChangesAborted.mock.calls.length).toBe(0);

  const moveWithinInner = <TokenMove>{
    ty: ChangeType.Move,
    cat: ChangeCategory.Token,
    newPosition: { x: 1, y: 0 },
    oldPosition: { x: 0, y: 1 },
    tokenId: "b"
  };

  // uid1 can't move uid2's token
  ok = trackChanges(map, changeTracker, [moveWithinInner], uid1);
  expect(ok).toBeFalsy();
  expect(handleChangesApplied.mock.calls.length).toBe(2);
  expect(handleChangesAborted.mock.calls.length).toBe(1); // this call failed

  // uid2 can, however :)
  ok = trackChanges(map, changeTracker, [moveWithinInner], uid2);
  expect(ok).toBeTruthy();
  expect(handleChangesApplied.mock.calls.length).toBe(3);
  expect(handleChangesApplied.mock.calls[2][0]).toBe(true); // this time token changes were made
  expect(handleChangesAborted.mock.calls.length).toBe(1);

  // neither of them can move both by swapping their positions:
  const moveSwap: TokenMove[] = [{
    ty: ChangeType.Move,
    cat: ChangeCategory.Token,
    newPosition: { x: 0, y: 0 },
    oldPosition: { x: 1, y: 0 },
    tokenId: "b"
  }, {
    ty: ChangeType.Move,
    cat: ChangeCategory.Token,
    newPosition: { x: 1, y: 0 },
    oldPosition: { x: 0, y: 0 },
    tokenId: "a"
  }];

  ok = trackChanges(map, changeTracker, moveSwap, uid1);
  expect(ok).toBeFalsy();
  expect(handleChangesApplied.mock.calls.length).toBe(3);
  expect(handleChangesAborted.mock.calls.length).toBe(2);

  ok = trackChanges(map, changeTracker, moveSwap, uid2);
  expect(ok).toBeFalsy();
  expect(handleChangesApplied.mock.calls.length).toBe(3);
  expect(handleChangesAborted.mock.calls.length).toBe(3);

  ok = trackChanges(map, changeTracker, moveSwap, ownerUid);
  expect(ok).toBeTruthy();
  expect(handleChangesApplied.mock.calls.length).toBe(4);
  expect(handleChangesApplied.mock.calls[3][0]).toBe(true); // this time token changes were made
  expect(handleChangesAborted.mock.calls.length).toBe(3);

  // ...and after that, uid2 can still move their token back to its
  // now-vacant original position
  const moveBack = <TokenMove>{
    ty: ChangeType.Move,
    cat: ChangeCategory.Token,
    newPosition: { x: 0, y: 1 },
    oldPosition: { x: 0, y: 0 },
    tokenId: "b"
  };

  ok = trackChanges(map, changeTracker, [moveBack], uid2);
  expect(ok).toBeTruthy();
  expect(handleChangesApplied.mock.calls.length).toBe(5);
  expect(handleChangesApplied.mock.calls[4][0]).toBe(true); // this time token changes were made
  expect(handleChangesAborted.mock.calls.length).toBe(3);
});

test('Unprivileged tokens cannot escape from bounded areas', () => {
  const areas = new FeatureDictionary<GridCoord, StripedArea>(coordString);
  const playerAreas = new FeatureDictionary<GridCoord, StripedArea>(coordString);
  const tokens = new Tokens(getTokenGeometry(MapType.Hex), new SimpleTokenDrawing());
  const outlineTokens = new Tokens(getTokenGeometry(MapType.Hex), new SimpleTokenDrawing());
  const walls = new FeatureDictionary<GridEdge, IFeature<GridEdge>>(edgeString);
  const notes = new FeatureDictionary<GridCoord, IAnnotation>(coordString);
  const images = new IdDictionary<IMapImage>();
  const colouring = new MapColouring(new HexGridGeometry(100, 8));

  const handleChangesApplied = vi.fn();
  const handleChangesAborted = vi.fn();
  let changeTracker = new MapChangeTracker(
    areas, playerAreas, tokens, outlineTokens, walls, notes, images, undefined, colouring,
    handleChangesApplied, handleChangesAborted
  );

  let ok = buildWallsOfThreeHexes(changeTracker);
  expect(ok).toBeTruthy();
  expect(handleChangesApplied.mock.calls.length).toBe(1);
  expect(handleChangesApplied.mock.calls[0][0]).toBe(false); // no tokens changed
  expect(handleChangesAborted.mock.calls.length).toBe(0);

  // console.debug("zero colour: " + colouring.colourOf({ x: 0, y: 0 }));
  // console.debug("inner colour: " + colouring.colourOf({ x: 0, y: 1 }));
  // console.debug("outer colour: " + colouring.colourOf({ x: 1, y: -1 }));

  let addTokens = [
    { position: { x: 0, y: 0 }, colour: 0, id: "a", players: [uid1], size: "1", text: "Zero" },
    { position: { x: 0, y: 1 }, colour: 0, id: "b", players: [uid1], size: "1", text: "Inner" },
    { position: { x: -2, y: 2 }, colour: 0, id: "c", players: [uid1], size: "1", text: "Outer" }
  ].map(t => {
    return <TokenAdd>{
      ty: ChangeType.Add,
      cat: ChangeCategory.Token,
      feature: t
    };
  });

  ok = trackChanges(map, changeTracker, addTokens, ownerUid);
  expect(ok).toBeTruthy();
  expect(handleChangesApplied.mock.calls.length).toBe(2);
  expect(handleChangesApplied.mock.calls[1][0]).toBe(true); // this time token changes were made
  expect(handleChangesAborted.mock.calls.length).toBe(0);

  const moveZeroToOuter = <TokenMove>{
    ty: ChangeType.Move,
    cat: ChangeCategory.Token,
    newPosition: { x: 1, y: -1 },
    oldPosition: { x: 0, y: 0 },
    tokenId: "a"
  };

  const moveWithinInner = <TokenMove>{
    ty: ChangeType.Move,
    cat: ChangeCategory.Token,
    newPosition: { x: 1, y: 0 },
    oldPosition: { x: 0, y: 1 },
    tokenId: "b"
  };

  const moveOuterToOuter = <TokenMove>{
    ty: ChangeType.Move,
    cat: ChangeCategory.Token,
    newPosition: { x: -1, y: 1 },
    oldPosition: { x: -2, y: 2 },
    tokenId: "c"
  };

  // We certainly can't do all three together
  ok = trackChanges(map, changeTracker, [moveZeroToOuter, moveWithinInner, moveOuterToOuter], uid1);
  expect(ok).toBeFalsy();
  expect(handleChangesApplied.mock.calls.length).toBe(2);
  expect(handleChangesAborted.mock.calls.length).toBe(1); // this call failed

  // ...or zero-to-outer all by itself
  ok = trackChanges(map, changeTracker, [moveZeroToOuter], uid1);
  expect(ok).toBeFalsy();
  expect(handleChangesApplied.mock.calls.length).toBe(2);
  expect(handleChangesAborted.mock.calls.length).toBe(2); // this call failed

  // We can, however, do the inner-to-inner and outer-to-outer moves
  ok = trackChanges(map, changeTracker, [moveWithinInner, moveOuterToOuter], uid1);
  expect(ok).toBeTruthy();
  expect(handleChangesApplied.mock.calls.length).toBe(3);
  expect(handleChangesApplied.mock.calls[2][0]).toBe(true); // this time token changes were made
  expect(handleChangesAborted.mock.calls.length).toBe(2);

  // If we remove one of the walls between zero and outer, we can do that move too, even
  // if it's not the shortest-path wall
  const removeWall = <WallRemove>{
    ty: ChangeType.Remove,
    cat: ChangeCategory.Wall,
    position: { x: -1, y: 1, edge: 2 }
  };

  ok = trackChanges(map, changeTracker, [removeWall], ownerUid);
  expect(ok).toBeTruthy();
  expect(handleChangesApplied.mock.calls.length).toBe(4);
  expect(handleChangesApplied.mock.calls[3][0]).toBe(false); // this was a wall change
  expect(handleChangesAborted.mock.calls.length).toBe(2);

  ok = trackChanges(map, changeTracker, [moveZeroToOuter], uid1);
  expect(ok).toBeTruthy();
  expect(handleChangesApplied.mock.calls.length).toBe(5);
  expect(handleChangesApplied.mock.calls[4][0]).toBe(true); // this time token changes were made
  expect(handleChangesAborted.mock.calls.length).toBe(2);

  // console.debug("wall removed");
  // console.debug("zero colour: " + colouring.colourOf({ x: 0, y: 0 }));
  // console.debug("inner colour: " + colouring.colourOf({ x: 0, y: 1 }));
  // console.debug("outer colour: " + colouring.colourOf({ x: 1, y: -1 }));

  // We still couldn't move it into the inner area, though
  const moveOuterToInner = <TokenMove>{
    ty: ChangeType.Move,
    cat: ChangeCategory.Token,
    newPosition: { x: 0, y: 1 },
    oldPosition: { x: 1, y: -1 },
    tokenId: "a"
  };

  ok = trackChanges(map, changeTracker, [moveOuterToInner], uid1);
  expect(ok).toBeFalsy();
  expect(handleChangesApplied.mock.calls.length).toBe(5);
  expect(handleChangesAborted.mock.calls.length).toBe(3);

  // The owner can do that, though
  ok = trackChanges(map, changeTracker, [moveOuterToInner], ownerUid);
  expect(ok).toBeTruthy();
  expect(handleChangesApplied.mock.calls.length).toBe(6);
  expect(handleChangesApplied.mock.calls[5][0]).toBe(true); // this time token changes were made
  expect(handleChangesAborted.mock.calls.length).toBe(3);
});