import { describe, expect, test } from 'vitest';
import { MapType } from '@wallandshadow/shared';

import { HonoApi } from '../../src/services/honoApi';
import {
  ApiError,
  HonoApiClient,
  type AdventureDetailRow,
  type MapRow,
  type PlayerRow,
} from '../../src/services/honoApiClient';

function makeAdventureRow(overrides: Partial<AdventureDetailRow> = {}): AdventureDetailRow {
  return {
    id: 'adv-1',
    name: 'Adv',
    description: 'd',
    owner: 'owner-uid',
    ownerName: 'Owner',
    imagePath: '',
    maps: [],
    ...overrides,
  };
}

function makePlayer(overrides: Partial<PlayerRow> = {}): PlayerRow {
  return {
    playerId: 'uid-1',
    playerName: 'Alice',
    allowed: true,
    characters: [],
    ...overrides,
  };
}

function makeMapRow(overrides: Partial<MapRow> = {}): MapRow {
  return {
    adventureId: 'adv-1',
    id: 'map-1',
    name: 'Map',
    description: 'd',
    ty: MapType.Square,
    imagePath: '',
    ffa: false,
    enableGroupVision: false,
    ...overrides,
  };
}

function stubClient(stubs: Partial<HonoApiClient>): HonoApiClient {
  return stubs as unknown as HonoApiClient;
}

describe('HonoApi.listPlayers error handling', () => {
  test('happy path: returns players annotated with the adventure', async () => {
    const adv = makeAdventureRow({ owner: 'owner-uid', name: 'Adv' });
    const players = [makePlayer({ playerId: 'uid-1' }), makePlayer({ playerId: 'uid-2' })];
    const api = new HonoApi(stubClient({
      getAdventure: async () => adv,
      getPlayers: async () => players,
    }));

    const result = await api.listPlayers('adv-1');

    expect(result).toHaveLength(2);
    expect(result[0].playerId).toBe('uid-1');
    expect(result[0].owner).toBe('owner-uid');
    expect(result[0].name).toBe('Adv');
  });

  test('players 404 yields an empty list', async () => {
    const api = new HonoApi(stubClient({
      getAdventure: async () => makeAdventureRow(),
      getPlayers: async () => { throw new ApiError('Not found', 404); },
    }));

    expect(await api.listPlayers('adv-1')).toEqual([]);
  });

  test('adventure 404 + players 200 falls back to the empty adventure stub', async () => {
    const players = [makePlayer({ playerId: 'uid-1' })];
    const api = new HonoApi(stubClient({
      getAdventure: async () => { throw new ApiError('Not found', 404); },
      getPlayers: async () => players,
    }));

    const result = await api.listPlayers('adv-1');

    expect(result).toHaveLength(1);
    expect(result[0].playerId).toBe('uid-1');
    // Empty stub has owner='' / name='' — that's the documented soft-failure
    // shape consumers can detect.
    expect(result[0].owner).toBe('');
    expect(result[0].name).toBe('');
  });

  test('adventure 500 propagates instead of silently masking', async () => {
    const players = [makePlayer({ playerId: 'uid-1' })];
    const api = new HonoApi(stubClient({
      getAdventure: async () => { throw new ApiError('Internal', 500); },
      getPlayers: async () => players,
    }));

    await expect(api.listPlayers('adv-1')).rejects.toMatchObject({ status: 500 });
  });

  test('non-ApiError from adventure fetch propagates', async () => {
    // Network failure presents as a non-ApiError (TypeError from fetch).
    const players = [makePlayer({ playerId: 'uid-1' })];
    const api = new HonoApi(stubClient({
      getAdventure: async () => { throw new TypeError('network down'); },
      getPlayers: async () => players,
    }));

    await expect(api.listPlayers('adv-1')).rejects.toThrow('network down');
  });
});

describe('HonoApi.listMaps error handling', () => {
  test('adventure 404 falls back to empty adventure stub', async () => {
    const maps = [makeMapRow({ id: 'map-1' })];
    const api = new HonoApi(stubClient({
      getMaps: async () => maps,
      getAdventure: async () => { throw new ApiError('Not found', 404); },
    }));

    const result = await api.listMaps('adv-1');

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('map-1');
    expect(result[0].record.adventureName).toBe('');
    expect(result[0].record.owner).toBe('');
  });

  test('adventure 500 propagates', async () => {
    const maps = [makeMapRow()];
    const api = new HonoApi(stubClient({
      getMaps: async () => maps,
      getAdventure: async () => { throw new ApiError('Internal', 500); },
    }));

    await expect(api.listMaps('adv-1')).rejects.toMatchObject({ status: 500 });
  });
});

describe('HonoApi.getMap error handling', () => {
  test('map 404 resolves to undefined', async () => {
    const api = new HonoApi(stubClient({
      getMap: async () => { throw new ApiError('Not found', 404); },
      getAdventure: async () => makeAdventureRow(),
    }));

    expect(await api.getMap('adv-1', 'map-1')).toBeUndefined();
  });

  test('adventure 500 propagates', async () => {
    const api = new HonoApi(stubClient({
      getMap: async () => makeMapRow(),
      getAdventure: async () => { throw new ApiError('Internal', 500); },
    }));

    await expect(api.getMap('adv-1', 'map-1')).rejects.toMatchObject({ status: 500 });
  });
});
