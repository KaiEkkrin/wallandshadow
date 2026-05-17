import { describe, expect, test } from 'vitest';
import { MapType } from '@wallandshadow/shared';

import {
  adventureRowToIAdventure,
  adventureRowToSummary,
  emptyAdventureRow,
  inviteRowToIInvite,
  mapRowToIMap,
  playerRowToIPlayer,
  spritesheetRowToISpritesheet,
} from '../../src/services/honoConverters';
import type {
  AdventureDetailRow,
  AdventureRow,
  InviteDetailRow,
  MapRow,
  PlayerRow,
  SpritesheetRow,
} from '../../src/services/honoApiClient';

const baseAdventureRow: AdventureRow = {
  id: 'adv-1',
  name: 'Adventure One',
  description: 'A test adventure',
  owner: 'user-1',
  ownerName: 'Alice',
  imagePath: 'images/adv-1.png',
};

describe('emptyAdventureRow', () => {
  test('produces an all-blank row carrying only the id', () => {
    const row = emptyAdventureRow('adv-7');
    expect(row).toEqual({
      id: 'adv-7',
      name: '',
      description: '',
      owner: '',
      ownerName: '',
      imagePath: '',
    });
  });
});

describe('adventureRowToIAdventure', () => {
  test('a plain AdventureRow (no maps) yields an empty maps array', () => {
    const adventure = adventureRowToIAdventure(baseAdventureRow);
    expect(adventure.name).toBe('Adventure One');
    expect(adventure.owner).toBe('user-1');
    expect(adventure.ownerName).toBe('Alice');
    expect(adventure.imagePath).toBe('images/adv-1.png');
    expect(adventure.maps).toEqual([]);
  });

  test('an AdventureDetailRow maps its maps into IMapSummary entries', () => {
    const detailRow: AdventureDetailRow = {
      ...baseAdventureRow,
      maps: [
        {
          adventureId: 'ignored-by-converter',
          id: 'map-1',
          name: 'Hex Map',
          description: 'pointy',
          ty: 'hex',
          imagePath: 'images/map-1.png',
        },
        {
          adventureId: 'ignored-by-converter',
          id: 'map-2',
          name: 'Square Map',
          description: 'grid',
          ty: 'square',
          imagePath: '',
        },
      ],
    };

    const adventure = adventureRowToIAdventure(detailRow);
    expect(adventure.maps).toHaveLength(2);
    // adventureId is taken from the parent row, not the nested map row.
    expect(adventure.maps[0]).toEqual({
      adventureId: 'adv-1',
      id: 'map-1',
      name: 'Hex Map',
      description: 'pointy',
      ty: MapType.Hex,
      imagePath: 'images/map-1.png',
    });
    expect(adventure.maps[1].ty).toBe(MapType.Square);
  });

  test('an unrecognised map type from the server is rejected', () => {
    const detailRow: AdventureDetailRow = {
      ...baseAdventureRow,
      maps: [
        {
          adventureId: 'adv-1',
          id: 'map-bad',
          name: 'Bad Map',
          description: '',
          ty: 'octagon',
          imagePath: '',
        },
      ],
    };
    expect(() => adventureRowToIAdventure(detailRow)).toThrow(/Unrecognised map type/);
  });
});

describe('adventureRowToSummary', () => {
  test('copies the summary fields verbatim', () => {
    expect(adventureRowToSummary(baseAdventureRow)).toEqual({
      id: 'adv-1',
      name: 'Adventure One',
      description: 'A test adventure',
      owner: 'user-1',
      ownerName: 'Alice',
      imagePath: 'images/adv-1.png',
    });
  });
});

describe('mapRowToIMap', () => {
  const mapRow: MapRow = {
    adventureId: 'adv-1',
    id: 'map-1',
    name: 'Hex Map',
    description: 'pointy',
    ty: 'hex',
    imagePath: 'images/map-1.png',
    ffa: true,
    enableGroupVision: false,
  };

  test('threads adventureName/owner through and validates the map type', () => {
    const map = mapRowToIMap(mapRow, 'Adventure One', 'user-1');
    expect(map).toEqual({
      adventureName: 'Adventure One',
      name: 'Hex Map',
      description: 'pointy',
      owner: 'user-1',
      ty: MapType.Hex,
      ffa: true,
      enableGroupVision: false,
      imagePath: 'images/map-1.png',
    });
  });

  test('rejects an unrecognised map type', () => {
    expect(() => mapRowToIMap({ ...mapRow, ty: 'hexx' }, 'Adventure One', 'user-1'))
      .toThrow(/Unrecognised map type/);
  });
});

describe('playerRowToIPlayer', () => {
  test('merges the player row with the adventure row', () => {
    const playerRow: PlayerRow = {
      playerId: 'user-2',
      playerName: 'Bob',
      allowed: true,
      characters: [],
    };
    const player = playerRowToIPlayer(playerRow, baseAdventureRow);
    expect(player.id).toBe('adv-1');
    expect(player.name).toBe('Adventure One');
    expect(player.owner).toBe('user-1');
    expect(player.playerId).toBe('user-2');
    expect(player.playerName).toBe('Bob');
    expect(player.allowed).toBe(true);
    expect(player.characters).toEqual([]);
  });

  test('a missing characters field defaults to an empty array', () => {
    const playerRow = {
      playerId: 'user-3',
      playerName: 'Carol',
      allowed: false,
    } as PlayerRow;
    expect(playerRowToIPlayer(playerRow, baseAdventureRow).characters).toEqual([]);
  });
});

describe('inviteRowToIInvite', () => {
  test('converts the ISO expiry string to a millisecond timestamp', () => {
    const inviteRow: InviteDetailRow = {
      id: 'inv-1',
      adventureId: 'adv-1',
      adventureName: 'Adventure One',
      ownerName: 'Alice',
      expiresAt: '2026-05-17T12:00:00.000Z',
    };
    const invite = inviteRowToIInvite(inviteRow);
    expect(invite.adventureId).toBe('adv-1');
    expect(invite.adventureName).toBe('Adventure One');
    expect(invite.ownerName).toBe('Alice');
    expect(invite.timestamp).toBe(Date.parse('2026-05-17T12:00:00.000Z'));
  });
});

describe('spritesheetRowToISpritesheet', () => {
  test('copies sprite metadata and stamps the local date', () => {
    const before = Date.now();
    const sheetRow: SpritesheetRow = {
      id: 'sheet-1',
      sprites: ['a.png', 'b.png'],
      geometry: 'hex',
      freeSpaces: 3,
      supersededBy: '',
      refs: 2,
    };
    const sheet = spritesheetRowToISpritesheet(sheetRow);
    expect(sheet.sprites).toEqual(['a.png', 'b.png']);
    expect(sheet.geometry).toBe('hex');
    expect(sheet.freeSpaces).toBe(3);
    expect(sheet.supersededBy).toBe('');
    expect(sheet.refs).toBe(2);
    expect(sheet.date).toBeGreaterThanOrEqual(before);
  });
});
