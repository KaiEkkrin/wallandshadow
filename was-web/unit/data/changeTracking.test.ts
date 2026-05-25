import { Change, ChangeType, ChangeCategory, TokenMove, TokenRemove, createTokenAdd, createWallAdd, createTokenMove, createWallRemove, createImageAdd, createImageRemove } from './change';
import { trackChanges, SimpleChangeTracker } from './changeTracking';
import { GridCoord, coordString, edgeString, GridEdge } from './coord';
import { defaultTokenProperties, FeatureDictionary, IFeature, StripedArea, TokenSize } from './feature';
import { IMap, MapType } from './map';
import { IAnnotation } from './annotation';
import { IdDictionary } from './identified';
import { createPixelAnchor, createVertexAnchor, IMapImage } from './image';
import { IUserPolicy, higherUser } from './policy';
import { getTokenGeometry } from './tokenGeometry';
import { SimpleTokenDrawing, Tokens } from './tokens';

function createChangeTracker(ty: MapType, userPolicy?: IUserPolicy | undefined) {
  return new SimpleChangeTracker(
    new FeatureDictionary<GridCoord, StripedArea>(coordString),
    new FeatureDictionary<GridCoord, StripedArea>(coordString),
    new Tokens(getTokenGeometry(ty), new SimpleTokenDrawing()),
    new Tokens(getTokenGeometry(ty), new SimpleTokenDrawing()),
    new FeatureDictionary<GridEdge, IFeature<GridEdge>>(edgeString),
    new FeatureDictionary<GridCoord, IAnnotation>(coordString),
    new IdDictionary<IMapImage>(),
    userPolicy
  );
}

const ownerUid = "ownerUid";
function createTestMap(ffa: boolean, ty?: MapType | undefined): IMap {
  return {
    adventureName: "Test Adventure",
    name: "Test map",
    description: "Sphinx of black quartz, judge my vow",
    owner: ownerUid,
    ty: ty ?? MapType.Hex,
    ffa: ffa,
    imagePath: ""
  };
}

// == AREAS ==

test('One area can be added and removed', () => {
  let map = createTestMap(false);
  let tracker = createChangeTracker(map.ty);
  let chs: Change[] = [{
    ty: ChangeType.Add,
    cat: ChangeCategory.Area,
    feature: {
      position: { x: 1, y: 2 },
      colour: 3,
      stripe: 0
    }
  }];

  let ok = trackChanges(map, tracker, chs, ownerUid);
  expect(ok).toBeTruthy();
  expect(tracker.objectCount).toBe(1);

  let chs2: Change[] = [{
    ty: ChangeType.Remove,
    cat: ChangeCategory.Area,
    position: { x: 1, y: 2 }
  }];

  ok = trackChanges(map, tracker, chs2, ownerUid);
  expect(ok).toBeTruthy();
  expect(tracker.objectCount).toBe(0);

  // ...but not twice
  ok = trackChanges(map, tracker, chs2, ownerUid);
  expect(ok).toBeFalsy();
});

test('Multiple areas can be added and removed', () => {
  let map = createTestMap(false);
  let tracker = createChangeTracker(map.ty);
  let chs: Change[] = [{
    ty: ChangeType.Add,
    cat: ChangeCategory.Area,
    feature: {
      position: { x: 1, y: 2 },
      colour: 1,
      stripe: 0
    }
  }, {
    ty: ChangeType.Add,
    cat: ChangeCategory.Area,
    feature: {
      position: { x: 1, y: 4 },
      colour: 2,
      stripe: 0
    }
  }, {
    ty: ChangeType.Add,
    cat: ChangeCategory.Area,
    feature: {
      position: { x: 2, y: 4 },
      colour: 3,
      stripe: 0
    }
  }];

  let ok = trackChanges(map, tracker, chs, ownerUid);
  expect(ok).toBeTruthy();
  expect(tracker.objectCount).toBe(3);

  let chs2: Change[] = [{
    ty: ChangeType.Remove,
    cat: ChangeCategory.Area,
    position: { x: 1, y: 2 }
  }, {
    ty: ChangeType.Remove,
    cat: ChangeCategory.Area,
    position: { x: 2, y: 4 }
  }]

  ok = trackChanges(map, tracker, chs2, ownerUid);
  expect(ok).toBeTruthy();
  expect(tracker.objectCount).toBe(1);
});

test('Areas cannot be added on top of each other', () => {
  let map = createTestMap(false);
  let tracker = createChangeTracker(map.ty);
  let chs: Change[] = [{
    ty: ChangeType.Add,
    cat: ChangeCategory.Area,
    feature: {
      position: { x: 1, y: 2 },
      colour: 3,
      stripe: 0
    }
  }];

  let ok = trackChanges(map, tracker, chs, ownerUid);
  expect(ok).toBeTruthy();
  expect(tracker.objectCount).toBe(1);

  let chs2: Change[] = [{
    ty: ChangeType.Add,
    cat: ChangeCategory.Area,
    feature: {
      position: { x: 0, y: 2 },
      colour: 3,
      stripe: 0
    }
  }, {
    ty: ChangeType.Add,
    cat: ChangeCategory.Area,
    feature: {
      position: { x: 1, y: 2 },
      colour: 4,
      stripe: 0
    }
  }];

  ok = trackChanges(map, tracker, chs2, ownerUid);
  expect(ok).toBeFalsy();
  expect(tracker.objectCount).toBe(1);

  // After that operation, we should still have the area added the first time
  // but not the other area added the second time -- the whole second operation
  // should have been cancelled
  let chs3: Change[] = [{
    ty: ChangeType.Remove,
    cat: ChangeCategory.Area,
    position: { x: 1, y: 2 }
  }];

  ok = trackChanges(map, tracker, chs3, ownerUid);
  expect(ok).toBeTruthy();
  expect(tracker.objectCount).toBe(0);

  let chs4: Change[] = [{
    ty: ChangeType.Remove,
    cat: ChangeCategory.Area,
    position: { x: 0, y: 2 }
  }];

  ok = trackChanges(map, tracker, chs4, ownerUid);
  expect(ok).toBeFalsy();
});

test('A double-remove area operation is also cancelled', () => {
  let map = createTestMap(false);
  let tracker = createChangeTracker(map.ty);
  let chs: Change[] = [{
    ty: ChangeType.Add,
    cat: ChangeCategory.Area,
    feature: {
      position: { x: 1, y: 2 },
      colour: 1,
      stripe: 0
    }
  }, {
    ty: ChangeType.Add,
    cat: ChangeCategory.Area,
    feature: {
      position: { x: 1, y: 4 },
      colour: 2,
      stripe: 0
    }
  }, {
    ty: ChangeType.Add,
    cat: ChangeCategory.Area,
    feature: {
      position: { x: 2, y: 4 },
      colour: 3,
      stripe: 0
    }
  }];

  let ok = trackChanges(map, tracker, chs, ownerUid);
  expect(ok).toBeTruthy();

  // This should remove nothing
  let chs2: Change[] = [{
    ty: ChangeType.Remove,
    cat: ChangeCategory.Area,
    position: { x: 1, y: 2 }
  }, {
    ty: ChangeType.Remove,
    cat: ChangeCategory.Area,
    position: { x: 2, y: 4 }
  }, {
    ty: ChangeType.Remove,
    cat: ChangeCategory.Area,
    position: { x: 2, y: 4 }
  }];

  ok = trackChanges(map, tracker, chs2, ownerUid);
  expect(ok).toBeFalsy();

  // ...as exemplified by this proper removal
  let chs3: Change[] = [{
    ty: ChangeType.Remove,
    cat: ChangeCategory.Area,
    position: { x: 1, y: 2 }
  }, {
    ty: ChangeType.Remove,
    cat: ChangeCategory.Area,
    position: { x: 2, y: 4 }
  }];

  ok = trackChanges(map, tracker, chs3, ownerUid);
  expect(ok).toBeTruthy();
});

// == WALLS ==
// Since they're very similar to areas I won't do all the same tests

test('Walls cannot be added on top of each other', () => {
  let map = createTestMap(false);
  let tracker = createChangeTracker(map.ty);
  let chs: Change[] = [{
    ty: ChangeType.Add,
    cat: ChangeCategory.Wall,
    feature: {
      position: { x: 1, y: 2, edge: 0 },
      colour: 3
    }
  }];

  let ok = trackChanges(map, tracker, chs, ownerUid);
  expect(ok).toBeTruthy();

  let chs2: Change[] = [{
    ty: ChangeType.Add,
    cat: ChangeCategory.Wall,
    feature: {
      position: { x: 1, y: 2, edge: 1 },
      colour: 3
    }
  }, {
    ty: ChangeType.Add,
    cat: ChangeCategory.Wall,
    feature: {
      position: { x: 1, y: 2, edge: 0 },
      colour: 4
    }
  }];

  ok = trackChanges(map, tracker, chs2, ownerUid);
  expect(ok).toBeFalsy();

  // After that operation, we should still have the wall added the first time
  // but not the other area added the second time -- the whole second operation
  // should have been cancelled
  let chs3: Change[] = [{
    ty: ChangeType.Remove,
    cat: ChangeCategory.Wall,
    position: { x: 1, y: 2, edge: 0 }
  }];

  ok = trackChanges(map, tracker, chs3, ownerUid);
  expect(ok).toBeTruthy();

  let chs4: Change[] = [{
    ty: ChangeType.Remove,
    cat: ChangeCategory.Wall,
    position: { x: 0, y: 2, edge: 1 }
  }];

  ok = trackChanges(map, tracker, chs4, ownerUid);
  expect(ok).toBeFalsy();
});

test('A double-remove wall operation is also cancelled', () => {
  let map = createTestMap(false);
  let tracker = createChangeTracker(map.ty);
  let chs: Change[] = [{
    ty: ChangeType.Add,
    cat: ChangeCategory.Wall,
    feature: {
      position: { x: 1, y: 2, edge: 0 },
      colour: 1
    }
  }, {
    ty: ChangeType.Add,
    cat: ChangeCategory.Wall,
    feature: {
      position: { x: 1, y: 2, edge: 1 },
      colour: 2
    }
  }, {
    ty: ChangeType.Add,
    cat: ChangeCategory.Wall,
    feature: {
      position: { x: 2, y: 4, edge: 0 },
      colour: 3
    }
  }];

  let ok = trackChanges(map, tracker, chs, ownerUid);
  expect(ok).toBeTruthy();

  // This should remove nothing
  let chs2: Change[] = [{
    ty: ChangeType.Remove,
    cat: ChangeCategory.Wall,
    position: { x: 1, y: 2, edge: 0 }
  }, {
    ty: ChangeType.Remove,
    cat: ChangeCategory.Wall,
    position: { x: 1, y: 2, edge: 1 }
  }, {
    ty: ChangeType.Remove,
    cat: ChangeCategory.Wall,
    position: { x: 1, y: 2, edge: 1 }
  }];

  ok = trackChanges(map, tracker, chs2, ownerUid);
  expect(ok).toBeFalsy();

  // ...as exemplified by this proper removal
  let chs3: Change[] = [{
    ty: ChangeType.Remove,
    cat: ChangeCategory.Wall,
    position: { x: 1, y: 2, edge: 0 }
  }, {
    ty: ChangeType.Remove,
    cat: ChangeCategory.Wall,
    position: { x: 1, y: 2, edge: 1 }
  }];

  ok = trackChanges(map, tracker, chs3, ownerUid);
  expect(ok).toBeTruthy();
});

// == TOKENS ==

// We'll do many of these tests separately for both regular and outline tokens,
// which should behave the same (although not interact).
for (const isOutline of [false, true]) {
  // Repeat the superposition test
  test(`Tokens cannot be added on top of each other (outline=${isOutline})`, () => {
    let map = createTestMap(false);
    let tracker = createChangeTracker(map.ty);
    let chs: Change[] = [{
      ty: ChangeType.Add,
      cat: ChangeCategory.Token,
      feature: {
        ...defaultTokenProperties,
        position: { x: 1, y: 2 },
        colour: 3,
        text: "a",
        id: "a",
        outline: isOutline
      }
    }];

    let ok = trackChanges(map, tracker, chs, ownerUid);
    expect(ok).toBeTruthy();

    let chs2: Change[] = [{
      ty: ChangeType.Add,
      cat: ChangeCategory.Token,
      feature: {
        ...defaultTokenProperties,
        position: { x: 0, y: 2 },
        colour: 3,
        text: "b",
        id: "b",
        size: "1",
        outline: isOutline
      }
    }, {
      ty: ChangeType.Add,
      cat: ChangeCategory.Token,
      feature: {
        ...defaultTokenProperties,
        position: { x: 1, y: 2 },
        colour: 4,
        text: "c",
        id: "c",
        size: "1",
        outline: isOutline
      }
    }];

    ok = trackChanges(map, tracker, chs2, ownerUid);
    expect(ok).toBeFalsy();

    // After that operation, we should still have the token added the first time
    // but not the other area added the second time -- the whole second operation
    // should have been cancelled
    let chs3: Change[] = [{
      ty: ChangeType.Remove,
      cat: ChangeCategory.Token,
      position: { x: 1, y: 2 },
      tokenId: "a"
    }];

    ok = trackChanges(map, tracker, chs3, ownerUid);
    expect(ok).toBeTruthy();

    let chs4: Change[] = [{
      ty: ChangeType.Remove,
      cat: ChangeCategory.Token,
      position: { x: 0, y: 2 },
      tokenId: "b"
    }];

    ok = trackChanges(map, tracker, chs4, ownerUid);
    expect(ok).toBeFalsy();
  });

  test(`A token can be moved around (isOutline=${isOutline})`, () => {
    let map = createTestMap(false);
    let tracker = createChangeTracker(map.ty);
    let chs: Change[] = [{
      ty: ChangeType.Add,
      cat: ChangeCategory.Token,
      feature: {
        ...defaultTokenProperties,
        position: { x: 1, y: 2 },
        colour: 3,
        text: "a",
        id: "a",
        size: "1",
        outline: isOutline
      }
    }];

    let ok = trackChanges(map, tracker, chs, ownerUid);
    expect(ok).toBeTruthy();

    let chs2: Change[] = [{
      ty: ChangeType.Move,
      cat: ChangeCategory.Token,
      newPosition: { x: 2, y: 2 },
      oldPosition: { x: 1, y: 2 },
      tokenId: "a"
    }];

    ok = trackChanges(map, tracker, chs2, ownerUid);
    expect(ok).toBeTruthy();

    let chs3: Change[] = [{
      ty: ChangeType.Move,
      cat: ChangeCategory.Token,
      newPosition: { x: 1, y: 2 },
      oldPosition: { x: 2, y: 2 },
      tokenId: "a"
    }];

    ok = trackChanges(map, tracker, chs3, ownerUid);
    expect(ok).toBeTruthy();

    // A redundant move from its current position back to the same position
    // should be fine
    let chs4: Change[] = [{
      ty: ChangeType.Move,
      cat: ChangeCategory.Token,
      newPosition: { x: 1, y: 2 },
      oldPosition: { x: 1, y: 2 },
      tokenId: "a"
    }];

    ok = trackChanges(map, tracker, chs4, ownerUid);
    expect(ok).toBeTruthy();

    // We shouldn't be able to move it from a non-existent position, though
    let chs5: Change[] = [{
      ty: ChangeType.Move,
      cat: ChangeCategory.Token,
      newPosition: { x: 3, y: 2 },
      oldPosition: { x: 2, y: 2 },
      tokenId: "a"
    }];

    ok = trackChanges(map, tracker, chs5, ownerUid);
    expect(ok).toBeFalsy();
  });

  test(`Multiple tokens can be moved together (isOutline=${isOutline})`, () => {
    let map = createTestMap(false);
    let tracker = createChangeTracker(map.ty);
    let chs: Change[] = [{
      ty: ChangeType.Add,
      cat: ChangeCategory.Token,
      feature: {
        ...defaultTokenProperties,
        position: { x: 1, y: 2 },
        colour: 3,
        text: "a",
        id: "a",
        size: "1",
        outline: isOutline
      }
    }, {
      ty: ChangeType.Add,
      cat: ChangeCategory.Token,
      feature: {
        ...defaultTokenProperties,
        position: { x: 1, y: 3 },
        colour: 1,
        text: "b",
        id: "b",
        size: "1",
        outline: isOutline
      }
    }, {
      ty: ChangeType.Add,
      cat: ChangeCategory.Token,
      feature: {
        ...defaultTokenProperties,
        position: { x: 2, y: 2 },
        colour: 2,
        text: "c",
        id: "c",
        size: "1",
        outline: isOutline
      }
    }];

    let ok = trackChanges(map, tracker, chs, ownerUid);
    expect(ok).toBeTruthy();

    // I should not be able to move the two row-aligned tokens diagonally left-down one, because
    // token "b" is in the way:
    let chs2: Change[] = [{
      ty: ChangeType.Move,
      cat: ChangeCategory.Token,
      newPosition: { x: 0, y: 3 },
      oldPosition: { x: 1, y: 2 },
      tokenId: "a"
    }, {
      ty: ChangeType.Move,
      cat: ChangeCategory.Token,
      newPosition: { x: 1, y: 3 },
      oldPosition: { x: 2, y: 2 },
      tokenId: "c"
    }];

    ok = trackChanges(map, tracker, chs2, ownerUid);
    expect(ok).toBeFalsy();

    // I should be able to move the two row-aligned tokens left one, so that
    // "c" occupies the position "a" previously had, with no problems:
    let chs3: Change[] = [{
      ty: ChangeType.Move,
      cat: ChangeCategory.Token,
      newPosition: { x: 0, y: 2 },
      oldPosition: { x: 1, y: 2 },
      tokenId: "a"
    }, {
      ty: ChangeType.Move,
      cat: ChangeCategory.Token,
      newPosition: { x: 1, y: 2 },
      oldPosition: { x: 2, y: 2 },
      tokenId: "c"
    }];

    ok = trackChanges(map, tracker, chs3, ownerUid);
    expect(ok).toBeTruthy();
  });

  test(`Multiple tokens can be moved together (in the other order) (isOutline=${isOutline})`, () => {
    let map = createTestMap(false);
    let tracker = createChangeTracker(map.ty);
    let chs: Change[] = [{
      ty: ChangeType.Add,
      cat: ChangeCategory.Token,
      feature: {
        ...defaultTokenProperties,
        position: { x: 1, y: 2 },
        colour: 3,
        text: "a",
        id: "a",
        size: "1",
        outline: isOutline
      }
    }, {
      ty: ChangeType.Add,
      cat: ChangeCategory.Token,
      feature: {
        ...defaultTokenProperties,
        position: { x: 1, y: 3 },
        colour: 1,
        text: "b",
        id: "b",
        size: "1",
        outline: isOutline
      }
    }, {
      ty: ChangeType.Add,
      cat: ChangeCategory.Token,
      feature: {
        ...defaultTokenProperties,
        position: { x: 2, y: 2 },
        colour: 2,
        text: "c",
        id: "c",
        size: "1",
        outline: isOutline
      }
    }];

    let ok = trackChanges(map, tracker, chs, ownerUid);
    expect(ok).toBeTruthy();

    // I should not be able to move the two row-aligned tokens diagonally left-down one, because
    // token "b" is in the way:
    let chs2: Change[] = [{
      ty: ChangeType.Move,
      cat: ChangeCategory.Token,
      newPosition: { x: 1, y: 3 },
      oldPosition: { x: 2, y: 2 },
      tokenId: "c"
    }, {
      ty: ChangeType.Move,
      cat: ChangeCategory.Token,
      newPosition: { x: 0, y: 3 },
      oldPosition: { x: 1, y: 2 },
      tokenId: "a"
    }];

    ok = trackChanges(map, tracker, chs2, ownerUid);
    expect(ok).toBeFalsy();

    // I should be able to move the two row-aligned tokens left one, so that
    // "c" occupies the position "a" previously had, with no problems:
    let chs3: Change[] = [{
      ty: ChangeType.Move,
      cat: ChangeCategory.Token,
      newPosition: { x: 1, y: 2 },
      oldPosition: { x: 2, y: 2 },
      tokenId: "c"
    }, {
      ty: ChangeType.Move,
      cat: ChangeCategory.Token,
      newPosition: { x: 0, y: 2 },
      oldPosition: { x: 1, y: 2 },
      tokenId: "a"
    }];

    ok = trackChanges(map, tracker, chs3, ownerUid);
    expect(ok).toBeTruthy();
  });

  test(`I can move a token and add another one in its place (outline=${isOutline})`, () => {
    let map = createTestMap(false);
    let tracker = createChangeTracker(map.ty);
    let chs: Change[] = [{
      ty: ChangeType.Add,
      cat: ChangeCategory.Token,
      feature: {
        ...defaultTokenProperties,
        position: { x: 1, y: 2 },
        colour: 3,
        text: "a",
        id: "a",
        size: "1",
        outline: isOutline
      }
    }, {
      ty: ChangeType.Add,
      cat: ChangeCategory.Token,
      feature: {
        ...defaultTokenProperties,
        position: { x: 1, y: 1 },
        colour: 2,
        text: "blocker",
        id: "b",
        size: "1",
        outline: isOutline
      }
    }];

    let ok = trackChanges(map, tracker, chs, ownerUid);
    expect(ok).toBeTruthy();

    // This won't work, because the "blocker" token hasn't moved
    let chs2: Change[] = [{
      ty: ChangeType.Add,
      cat: ChangeCategory.Token,
      feature: {
        ...defaultTokenProperties,
        position: { x: 1, y: 1 },
        colour: 1,
        text: "new",
        id: "n",
        size: "1",
        outline: isOutline
      }
    }, {
      ty: ChangeType.Move,
      cat: ChangeCategory.Token,
      newPosition: { x: 2, y: 2 },
      oldPosition: { x: 1, y: 2 },
      tokenId: "a"
    }];

    ok = trackChanges(map, tracker, chs2, ownerUid);
    expect(ok).toBeFalsy();

    // This will work, because the "a" token has moved
    let chs3: Change[] = [{
      ty: ChangeType.Add,
      cat: ChangeCategory.Token,
      feature: {
        ...defaultTokenProperties,
        position: { x: 1, y: 2 },
        colour: 1,
        text: "new",
        id: "n",
        size: "1",
        outline: isOutline
      }
    }, {
      ty: ChangeType.Move,
      cat: ChangeCategory.Token,
      newPosition: { x: 2, y: 2 },
      oldPosition: { x: 1, y: 2 },
      tokenId: "a"
    }];

    ok = trackChanges(map, tracker, chs3, ownerUid);
    expect(ok).toBeTruthy();

    // Removing them checks they all appeared as expected
    let chs4: Change[] = [{
      ty: ChangeType.Remove,
      cat: ChangeCategory.Token,
      position: { x: 1, y: 1 },
      tokenId: "b"
    }, {
      ty: ChangeType.Remove,
      cat: ChangeCategory.Token,
      position: { x: 1, y: 2 },
      tokenId: "n"
    }, {
      ty: ChangeType.Remove,
      cat: ChangeCategory.Token,
      position: { x: 2, y: 2 },
      tokenId: "a"
    }];

    ok = trackChanges(map, tracker, chs4, ownerUid);
    expect(ok).toBeTruthy();
  });

  test(`Walls cannot be created inside tokens (isOutline=${isOutline})`, () => {
    const map = createTestMap(false);
    const tracker = createChangeTracker(map.ty);

    const chs1 = [
      createTokenAdd({
        ...defaultTokenProperties,
        position: { x: 0, y: 0 },
        colour: 0,
        id: 'a',
        size: '2 (left)',
        text: 'A',
        outline: isOutline
      })
    ];

    let ok = trackChanges(map, tracker, chs1, ownerUid);
    expect(ok).toBeTruthy();

    // We can't create this wall...
    const chs2 = [
      createWallAdd({
        position: { x: -1, y: 1, edge: 1 },
        colour: 0
      })
    ];

    ok = trackChanges(map, tracker, chs2, ownerUid);
    expect(ok).toBeFalsy();

    // ...but we can create this one
    const chs3 = [
      createWallAdd({
        position: { x: -1, y: 1, edge: 0 },
        colour: 0
      })
    ];

    ok = trackChanges(map, tracker, chs3, ownerUid);
    expect(ok).toBeTruthy();

    // If we move the token away, we can create the one we tried earlier
    const chs4 = [
      createTokenMove(
        { x: 0, y: 0 },
        { x: 0, y: 1 },
        'a'
      ),
      ...chs2
    ];

    ok = trackChanges(map, tracker, chs4, ownerUid);
    expect(ok).toBeTruthy();
  });

  test(`Tokens cannot be created inside walls (outline=${isOutline})`, () => {
    const map = createTestMap(false);
    const tracker = createChangeTracker(map.ty);

    const chs1 = [
      createWallAdd({
        position: { x: -1, y: 1, edge: 1 },
        colour: 0
      })
    ];

    let ok = trackChanges(map, tracker, chs1, ownerUid);
    expect(ok).toBeTruthy();

    // This would create a token that is inside that wall
    const chs2 = [
      createTokenAdd({
        position: { x: 0, y: 0 },
        colour: 0,
        id: 'a',
        note: '',
        noteVisibleToPlayers: false,
        players: [],
        size: '2 (left)',
        text: 'A',
        characterId: "",
        sprites: [],
        outline: isOutline
      })
    ];

    ok = trackChanges(map, tracker, chs2, ownerUid);
    expect(ok).toBeFalsy();

    // If we move the wall somewhere else that change will work
    const chs3 = [
      createWallAdd({
        position: { x: -1, y: 1, edge: 0 },
        colour: 0
      }),
      createWallRemove({ x: -1, y: 1, edge: 1 }),
      ...chs2
    ];

    ok = trackChanges(map, tracker, chs3, ownerUid);
    expect(ok).toBeTruthy();
  });

  test(`Tokens cannot be moved into walls (outline=${isOutline})`, () => {
    const map = createTestMap(false);
    const tracker = createChangeTracker(map.ty);

    const chs1 = [
      createWallAdd({
        position: { x: -1, y: 1, edge: 1 },
        colour: 0
      }),
      createTokenAdd({
        position: { x: 0, y: 1 },
        colour: 0,
        id: 'a',
        note: '',
        noteVisibleToPlayers: false,
        players: [],
        size: '2 (left)',
        text: 'A',
        characterId: "",
        sprites: [],
        outline: isOutline
      })
    ];

    let ok = trackChanges(map, tracker, chs1, ownerUid);
    expect(ok).toBeTruthy();

    const chs2 = [
      createTokenMove(
        { x: 0, y: 1 },
        { x: 0, y: 0 },
        'a'
      )
    ];

    ok = trackChanges(map, tracker, chs2, ownerUid);
    expect(ok).toBeFalsy();

    // Move that wall away and it is okay
    const chs3 = [
      createWallAdd({
        position: { x: -1, y: 1, edge: 0 },
        colour: 0
      }),
      createWallRemove({ x: -1, y: 1, edge: 1 }),
      ...chs2
    ];

    ok = trackChanges(map, tracker, chs3, ownerUid);
    expect(ok).toBeTruthy();
  });
}

test(`Regular and outline tokens can exist atop each other`, () => {
  const map = createTestMap(false);
  const tracker = createChangeTracker(map.ty);
  const chs: Change[] = [];
  for (const x of [1, 2]) {
    for (const isOutline of [false, true]) {
      chs.push({
        ty: ChangeType.Add,
        cat: ChangeCategory.Token,
        feature: {
          ...defaultTokenProperties,
          position: { x: x, y: 0 },
          colour: 1,
          text: "a",
          id: `a_${x}_${isOutline}`,
          size: "1",
          outline: isOutline
        }
      });
    }
  }

  let ok = trackChanges(map, tracker, chs, ownerUid);
  expect(ok).toBeTruthy();

  // Move the outline tokens along one step, then move the regular tokens
  // along one to match
  for (const isOutline of [true, false]) {
    const chs2: Change[] = [1, 2].map(x => ({
      ty: ChangeType.Move,
      cat: ChangeCategory.Token,
      newPosition: { x: x + 1, y: 0 },
      oldPosition: { x: x, y: 0 },
      tokenId: `a_${x}_${isOutline}`
    }));

    ok = trackChanges(map, tracker, chs2, ownerUid);
    expect(ok).toBeTruthy();
  }
});

test(`The outline flag can be changed only iff it would not conflict`, () => {
  const map = createTestMap(false);
  const tracker = createChangeTracker(map.ty);
  const chs: Change[] = [];
  for (const x of [1, 2]) {
    for (const isOutline of [false, true]) {
      chs.push({
        ty: ChangeType.Add,
        cat: ChangeCategory.Token,
        feature: {
          ...defaultTokenProperties,
          position: { x: x, y: 0 },
          colour: 1,
          text: "a",
          id: `a_${x}_${isOutline}`,
          size: "1",
          outline: isOutline
        }
      });
    }
  }

  let ok = trackChanges(map, tracker, chs, ownerUid);
  expect(ok).toBeTruthy();

  const toggleOutline: (x: number, isOutline: boolean, id: string) => Change[] = (x: number, isOutline: boolean, id: string) => [{
    ty: ChangeType.Remove,
    cat: ChangeCategory.Token,
    position: { x: x, y: 0 },
    tokenId: id
  }, {
    ty: ChangeType.Add,
    cat: ChangeCategory.Token,
    feature: {
      ...defaultTokenProperties,
      position: { x: x, y: 0 },
      colour: 1,
      text: "a",
      id: id,
      size: "1",
      outline: !isOutline
    }
  }];

  // We can't swap the regular token on the right to outline until we move it
  ok = trackChanges(map, tracker, toggleOutline(2, false, 'a_2_false'), ownerUid);
  expect(ok).toBeFalsy();

  const chs2: Change[] = [{
    ty: ChangeType.Move,
    cat: ChangeCategory.Token,
    oldPosition: { x: 2, y: 0 },
    newPosition: { x: 3, y: 0 },
    tokenId: 'a_2_false'
  }];
  ok = trackChanges(map, tracker, chs2, ownerUid);
  expect(ok).toBeTruthy();

  ok = trackChanges(map, tracker, toggleOutline(3, false, 'a_2_false'), ownerUid);
  expect(ok).toBeTruthy();

  // Similarly, we can't swap the outline token on the left to regular until we move it
  ok = trackChanges(map, tracker, toggleOutline(1, true, 'a_1_true'), ownerUid);
  expect(ok).toBeFalsy();

  const chs3: Change[] = [{
    ty: ChangeType.Move,
    cat: ChangeCategory.Token,
    oldPosition: { x: 1, y: 0 },
    newPosition: { x: 0, y: 0 },
    tokenId: 'a_1_true'
  }];
  ok = trackChanges(map, tracker, chs3, ownerUid);
  expect(ok).toBeTruthy();

  ok = trackChanges(map, tracker, toggleOutline(0, true, 'a_1_true'), ownerUid);
  expect(ok).toBeTruthy();
});

// I seem to have hit a bug where we can't toggle the outline flag on large tokens:
for (const { ty, size } of [
  ...(['1', '2', '3', '4'].map(sz => ({ ty: MapType.Square, size: sz }))),
  ...(['1', '2 (left)', '2 (right)', '3', '4 (left)', '4 (right)'].map(sz => ({ ty: MapType.Hex, size: sz })))
]) {
  test(`${ty}: We can toggle the outline flag of a token of size ${size}`, () => {
    const map = createTestMap(false, ty);
    const tracker = createChangeTracker(ty);
    const chs: Change[] = [{
      ty: ChangeType.Add,
      cat: ChangeCategory.Token,
      feature: {
        ...defaultTokenProperties,
        position: { x: 0, y: 0 },
        colour: 1,
        text: 'a',
        id: 'a',
        size: size as TokenSize,
        outline: false
      }
    }];

    let ok = trackChanges(map, tracker, chs, ownerUid);
    expect(ok).toBeTruthy();

    const toggle: (outline: boolean) => Change[] = (outline: boolean) => [{
      ty: ChangeType.Remove,
      cat: ChangeCategory.Token,
      position: { x: 0, y: 0 },
      tokenId: 'a'
    }, {
      ty: ChangeType.Add,
      cat: ChangeCategory.Token,
      feature: {
        ...defaultTokenProperties,
        position: { x: 0, y: 0 },
        colour: 1,
        text: 'a',
        id: 'a',
        size: size as TokenSize,
        outline: outline
      }
    }];

    const chs2 = toggle(true);
    ok = trackChanges(map, tracker, chs2, ownerUid);
    expect(ok).toBeTruthy();

    const chs3 = toggle(false);
    ok = trackChanges(map, tracker, chs3, ownerUid);
    expect(ok).toBeTruthy();
  });
}

test('Images can be added and removed', () => {
  const map = createTestMap(false);
  const tracker = createChangeTracker(map.ty);

  const chs1 = [
    createImageAdd({
      image: { name: 'image1', path: '/image1.png' }, id: 'a', rotation: '0',
      start: createVertexAnchor(0, 0, 1), end: createVertexAnchor(1, 1, 1)
    }),
    createImageAdd({
      image: { name: 'image2', path: '/image2.png' }, id: 'b', rotation: '0',
      start: createPixelAnchor(0, 0), end: createPixelAnchor(100, 100)
    })
  ];

  let ok = trackChanges(map, tracker, chs1, ownerUid);
  expect(ok).toBeTruthy();

  // We can't remove an image that isn't there
  const chs2 = [createImageRemove('c')];
  ok = trackChanges(map, tracker, chs2, ownerUid);
  expect(ok).toBeFalsy();

  // ...or re-add the same one
  ok = trackChanges(map, tracker, chs1, ownerUid);
  expect(ok).toBeFalsy();

  // ...but we can move an existing image, and remove one that *is* there
  const chs3 = [
    createImageAdd({
      image: { name: 'image1', path: './image1.png' }, id: 'a', rotation: '0',
      start: createVertexAnchor(1, 1, 1), end: createVertexAnchor(3, 3, 0)
    }),
    createImageRemove('a'),
    createImageRemove('b')
  ];
  ok = trackChanges(map, tracker, chs3, ownerUid);
  expect(ok).toBeTruthy();

  // That kept image a
  const chs4 = [createImageRemove('a')];
  ok = trackChanges(map, tracker, chs4, ownerUid);
  expect(ok).toBeTruthy();
});

// == FFA OFF: USER VALIDATION ==

const uid1 = "uid1";
const uid2 = "uid2";

test('A non-owner cannot add and remove areas', () => {
  let map = createTestMap(false);
  let tracker = createChangeTracker(map.ty);
  let chs: Change[] = [{
    ty: ChangeType.Add,
    cat: ChangeCategory.Area,
    feature: {
      position: { x: 1, y: 2 },
      colour: 3,
      stripe: 0
    }
  }];

  let ok = trackChanges(map, tracker, chs, uid1);
  expect(ok).toBeFalsy();

  ok = trackChanges(map, tracker, chs, ownerUid);
  expect(ok).toBeTruthy();

  let chs2: Change[] = [{
    ty: ChangeType.Remove,
    cat: ChangeCategory.Area,
    position: { x: 1, y: 2 }
  }];

  ok = trackChanges(map, tracker, chs2, uid1);
  expect(ok).toBeFalsy();

  ok = trackChanges(map, tracker, chs2, ownerUid);
  expect(ok).toBeTruthy();

  // ...but not twice
  ok = trackChanges(map, tracker, chs2, ownerUid);
  expect(ok).toBeFalsy();
});

test('A non-owner *can* add and remove player areas', () => {
  // TODO #197 Test multiple stripings across the same area (requires me to
  // move the stripe into the key)
  let map = createTestMap(false);
  let tracker = createChangeTracker(map.ty);
  let chs: Change[] = [{
    ty: ChangeType.Add,
    cat: ChangeCategory.PlayerArea,
    feature: {
      position: { x: 1, y: 2 },
      colour: 3,
      stripe: 1
    }
  }, {
    ty: ChangeType.Add,
    cat: ChangeCategory.PlayerArea,
    feature: {
      position: { x: 2, y: 2 },
      colour: 3,
      stripe: 2
    }
  }];

  let ok = trackChanges(map, tracker, chs, uid1);
  expect(ok).toBeTruthy();

  let chs2: Change[] = [{
    ty: ChangeType.Remove,
    cat: ChangeCategory.PlayerArea,
    position: { x: 1, y: 2 }
  }, {
    ty: ChangeType.Remove,
    cat: ChangeCategory.PlayerArea,
    position: { x: 2, y: 2 }
  }];

  ok = trackChanges(map, tracker, chs2, uid1);
  expect(ok).toBeTruthy();

  // ...but not twice
  ok = trackChanges(map, tracker, chs2, uid1);
  expect(ok).toBeFalsy();
});

test('A non-owner cannot add and remove walls', () => {
  let map = createTestMap(false);
  let tracker = createChangeTracker(map.ty);
  let chs: Change[] = [{
    ty: ChangeType.Add,
    cat: ChangeCategory.Wall,
    feature: {
      position: { x: 1, y: 2, edge: 1 },
      colour: 3
    }
  }];

  let ok = trackChanges(map, tracker, chs, uid1);
  expect(ok).toBeFalsy();

  ok = trackChanges(map, tracker, chs, ownerUid);
  expect(ok).toBeTruthy();

  let chs2: Change[] = [{
    ty: ChangeType.Remove,
    cat: ChangeCategory.Wall,
    position: { x: 1, y: 2, edge: 1 }
  }];

  ok = trackChanges(map, tracker, chs2, uid1);
  expect(ok).toBeFalsy();

  ok = trackChanges(map, tracker, chs2, ownerUid);
  expect(ok).toBeTruthy();

  // ...but not twice
  ok = trackChanges(map, tracker, chs2, ownerUid);
  expect(ok).toBeFalsy();
});

test('A non-owner cannot add and remove images', () => {
  const map = createTestMap(false);
  const tracker = createChangeTracker(map.ty);

  const chs1 = [
    createImageAdd({
      image: { name: 'image1', path: '/image1.png' }, id: 'a', rotation: '0',
      start: createVertexAnchor(0, 0, 1), end: createVertexAnchor(1, 1, 1)
    }),
    createImageAdd({
      image: { name: 'image2', path: '/image2.png' }, id: 'b', rotation: '0',
      start: createPixelAnchor(0, 0), end: createPixelAnchor(100, 100)
    })
  ];

  let ok = trackChanges(map, tracker, chs1, uid1);
  expect(ok).toBeFalsy();

  ok = trackChanges(map, tracker, chs1, ownerUid);
  expect(ok).toBeTruthy();

  const chs2 = [createImageRemove('b')];
  ok = trackChanges(map, tracker, chs2, uid1);
  expect(ok).toBeFalsy();

  ok = trackChanges(map, tracker, chs2, ownerUid);
  expect(ok).toBeTruthy();
});

test('A non-owner cannot alter tokens', () => {
  let map = createTestMap(false);
  let tracker = createChangeTracker(map.ty);
  let chs: Change[] = [{
    ty: ChangeType.Add,
    cat: ChangeCategory.Token,
    feature: {
      ...defaultTokenProperties,
      position: { x: 1, y: 2 },
      colour: 3,
      text: "a",
      id: "a",
      size: "1"
    }
  }];

  let ok = trackChanges(map, tracker, chs, uid1);
  expect(ok).toBeFalsy();

  ok = trackChanges(map, tracker, chs, ownerUid);
  expect(ok).toBeTruthy();

  let chs2: Change[] = [{
    ty: ChangeType.Remove,
    cat: ChangeCategory.Token,
    position: { x: 1, y: 2 },
    tokenId: "a"
  }];

  ok = trackChanges(map, tracker, chs2, uid1);
  expect(ok).toBeFalsy();

  ok = trackChanges(map, tracker, chs2, ownerUid);
  expect(ok).toBeTruthy();

  ok = trackChanges(map, tracker, chs2, ownerUid);
  expect(ok).toBeFalsy();
});

test('Users can move only their own tokens', () => {
  let map = createTestMap(false);
  let tracker = createChangeTracker(map.ty);
  let chs: Change[] = [{
    ty: ChangeType.Add,
    cat: ChangeCategory.Token,
    feature: {
      ...defaultTokenProperties,
      position: { x: 1, y: 2 },
      colour: 3,
      id: "tid1",
      text: "a",
      size: "1",
      players: [uid1]
    }
  }, {
    ty: ChangeType.Add,
    cat: ChangeCategory.Token,
    feature: {
      ...defaultTokenProperties,
      position: { x: 2, y: 2 },
      colour: 2,
      id: "tid2",
      text: "b",
      size: "1",
      players: [uid2]
    }
  }, {
    ty: ChangeType.Add,
    cat: ChangeCategory.Token,
    feature: {
      ...defaultTokenProperties,
      position: { x: 3, y: 2 },
      colour: 1,
      id: "tid3",
      text: "c",
      size: "1",
      players: []
    }
  }];

  let ok = trackChanges(map, tracker, chs, ownerUid);
  expect(ok).toBeTruthy();

  function move(x: number, oldY: number, newY: number, tokenId: string): TokenMove {
    return {
      ty: ChangeType.Move,
      cat: ChangeCategory.Token,
      newPosition: { x: x, y: newY },
      oldPosition: { x: x, y: oldY },
      tokenId: tokenId
    };
  }

  // This definitely shouldn't succeed
  ok = trackChanges(map, tracker, [move(1, 2, 1, "tid1"), move(2, 2, 1, "tid2"), move(3, 2, 1, "tid3")], uid1);
  expect(ok).toBeFalsy();

  // Nor should this attempt of uid1 to move uid2's token
  ok = trackChanges(map, tracker, [move(2, 2, 1, "tid2")], uid1);
  expect(ok).toBeFalsy();

  // ...or these attempts to move tokens using the wrong ids...
  ok = trackChanges(map, tracker, [move(1, 2, 1, "tid2")], uid1);
  expect(ok).toBeFalsy();

  ok = trackChanges(map, tracker, [move(2, 2, 1, "tid1")], uid2);
  expect(ok).toBeFalsy();

  // It should be fine for each of them to move their own though
  ok = trackChanges(map, tracker, [move(1, 2, 1, "tid1")], uid1);
  expect(ok).toBeTruthy();

  ok = trackChanges(map, tracker, [move(2, 2, 1, "tid2")], uid2);
  expect(ok).toBeTruthy();

  ok = trackChanges(map, tracker, [move(3, 2, 1, "tid3")], ownerUid);
  expect(ok).toBeTruthy();

  // The owner can move them all together
  ok = trackChanges(map, tracker, [move(1, 1, 0, "tid1"), move(2, 1, 0, "tid2"), move(3, 1, 0, "tid3")], ownerUid);
  expect(ok).toBeTruthy();

  // We can also move them back again
  ok = trackChanges(map, tracker, [move(1, 0, 1, "tid1")], uid1);
  expect(ok).toBeTruthy();

  ok = trackChanges(map, tracker, [move(2, 0, 1, "tid2")], uid2);
  expect(ok).toBeTruthy();

  ok = trackChanges(map, tracker, [move(3, 0, 1, "tid3")], ownerUid);
  expect(ok).toBeTruthy();
});

// == FFA ON: ANY USER ==

test('In FFA mode, a non-owner can create areas', () => {
  let map = createTestMap(true);
  let tracker = createChangeTracker(map.ty);
  let chs: Change[] = [{
    ty: ChangeType.Add,
    cat: ChangeCategory.Area,
    feature: {
      position: { x: 1, y: 2 },
      colour: 3,
      stripe: 0
    }
  }];

  let ok = trackChanges(map, tracker, chs, uid1);
  expect(ok).toBeTruthy();

  let chs2: Change[] = [{
    ty: ChangeType.Remove,
    cat: ChangeCategory.Area,
    position: { x: 1, y: 2 }
  }];

  ok = trackChanges(map, tracker, chs2, uid2);
  expect(ok).toBeTruthy();

  // ...but not twice
  ok = trackChanges(map, tracker, chs2, uid1);
  expect(ok).toBeFalsy();
});

test('In FFA mode, a non-owner can create walls', () => {
  let map = createTestMap(true);
  let tracker = createChangeTracker(map.ty);
  let chs: Change[] = [{
    ty: ChangeType.Add,
    cat: ChangeCategory.Wall,
    feature: {
      position: { x: 1, y: 2, edge: 1 },
      colour: 3
    }
  }];

  let ok = trackChanges(map, tracker, chs, uid1);
  expect(ok).toBeTruthy();

  let chs2: Change[] = [{
    ty: ChangeType.Remove,
    cat: ChangeCategory.Wall,
    position: { x: 1, y: 2, edge: 1 }
  }];

  ok = trackChanges(map, tracker, chs2, uid2);
  expect(ok).toBeTruthy();

  // ...but not twice
  ok = trackChanges(map, tracker, chs2, uid1);
  expect(ok).toBeFalsy();
});

test('In FFA mode, a non-owner can add and remove images', () => {
  const map = createTestMap(true);
  const tracker = createChangeTracker(map.ty);

  const chs1 = [
    createImageAdd({
      image: { name: 'image1', path: '/image1.png' }, id: 'a', rotation: '0',
      start: createVertexAnchor(0, 0, 1), end: createVertexAnchor(1, 1, 1)
    }),
    createImageAdd({
      image: { name: 'image2', path: '/image2.png' }, id: 'b', rotation: '0',
      start: createPixelAnchor(0, 0), end: createPixelAnchor(100, 100)
    })
  ];

  let ok = trackChanges(map, tracker, chs1, uid1);
  expect(ok).toBeTruthy();

  const chs2 = [createImageRemove('b')];
  ok = trackChanges(map, tracker, chs2, uid1);
  expect(ok).toBeTruthy();
})

test('In FFA mode, a non-owner can do all token operations', () => {
  let map = createTestMap(true);
  let tracker = createChangeTracker(map.ty);
  let chs: Change[] = [{
    ty: ChangeType.Add,
    cat: ChangeCategory.Token,
    feature: {
      ...defaultTokenProperties,
      position: { x: 1, y: 2 },
      colour: 3,
      text: "a",
      players: [uid1],
      id: "a",
      size: "1"
    }
  }, {
    ty: ChangeType.Add,
    cat: ChangeCategory.Token,
    feature: {
      ...defaultTokenProperties,
      position: { x: 2, y: 2 },
      colour: 2,
      text: "b",
      players: [uid2],
      id: "b",
      size: "1"
    }
  }, {
    ty: ChangeType.Add,
    cat: ChangeCategory.Token,
    feature: {
      ...defaultTokenProperties,
      position: { x: 3, y: 2 },
      colour: 1,
      text: "c",
      id: "c",
      size: "1"
    }
  }];

  let ok = trackChanges(map, tracker, chs, uid1);
  expect(ok).toBeTruthy();

  function move(x: number, oldY: number, newY: number, id: string): TokenMove {
    return {
      ty: ChangeType.Move,
      cat: ChangeCategory.Token,
      newPosition: { x: x, y: newY },
      oldPosition: { x: x, y: oldY },
      tokenId: id
    };
  }

  // This will succeed now!
  ok = trackChanges(map, tracker, [move(1, 2, 1, 'a'), move(2, 2, 1, 'b'), move(3, 2, 1, 'c')], uid2);
  expect(ok).toBeTruthy();

  // I can remove them too
  function remove(x: number, y: number, id: string): TokenRemove {
    return {
      ty: ChangeType.Remove,
      cat: ChangeCategory.Token,
      position: { x: x, y: y },
      tokenId: id
    };
  }

  ok = trackChanges(map, tracker, [remove(1, 1, 'a'), remove(2, 1, 'b'), remove(3, 1, 'c')], uid2);
  expect(ok).toBeTruthy();

  ok = trackChanges(map, tracker, [remove(1, 1, 'a'), remove(2, 1, 'b'), remove(3, 1, 'c')], uid2);
  expect(ok).toBeFalsy();
});

// == POLICY ==

test('Policy blocks us from adding too many objects', () => {
  let map = createTestMap(false);
  let tracker = createChangeTracker(map.ty, {
    ...higherUser,
    objects: 3 // a low limit makes it easy to test :)
  });

  // We should be able to add up to the limit
  let chs: Change[] = [{
    ty: ChangeType.Add,
    cat: ChangeCategory.Area,
    feature: {
      position: { x: 0, y: 0 },
      colour: 2,
      stripe: 0
    }
  }, {
    ty: ChangeType.Add,
    cat: ChangeCategory.Token,
    feature: {
      ...defaultTokenProperties,
      position: { x: 0, y: 0 },
      colour: 1,
      text: "a",
      id: "token1",
      size: "1"
    }
  }, {
    ty: ChangeType.Add,
    cat: ChangeCategory.Wall,
    feature: {
      position: { x: 0, y: 0, edge: 0 },
      colour: 3
    }
  }];

  let ok = trackChanges(map, tracker, chs, ownerUid);
  expect(ok).toBeTruthy();
  expect(tracker.objectCount).toBe(3);

  // At this point we shouldn't be able to add any more...
  let chs2: Change[] = [{
    ty: ChangeType.Add,
    cat: ChangeCategory.Token,
    feature: {
      ...defaultTokenProperties,
      position: { x: 0, y: 1 },
      colour: 1,
      text: "b",
      id: "token2",
      size: "1"
    }
  }];

  ok = trackChanges(map, tracker, chs2, ownerUid);
  expect(ok).toBeFalsy();
  expect(tracker.objectCount).toBe(3);

  // ...but we should still be able to move existing tokens...
  let chs3: Change[] = [{
    ty: ChangeType.Move,
    cat: ChangeCategory.Token,
    oldPosition: { x: 0, y: 0 },
    newPosition: { x: 1, y: 0 },
    tokenId: "token1"
  }];

  ok = trackChanges(map, tracker, chs3, ownerUid);
  expect(ok).toBeTruthy();
  expect(tracker.objectCount).toBe(3);

  // ...and if we remove an existing object, we can add a new one
  let chs4: Change[] = [{
    ty: ChangeType.Remove,
    cat: ChangeCategory.Wall,
    position: { x: 0, y: 0, edge: 0 }
  }, ...chs2];

  ok = trackChanges(map, tracker, chs4, ownerUid);
  expect(ok).toBeTruthy();
  expect(tracker.objectCount).toBe(3);
});

// TODO #197 Add player area tests including ffa/non-ffa
