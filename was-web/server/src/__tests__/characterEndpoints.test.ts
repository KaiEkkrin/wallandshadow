import { describe, test, expect } from 'vitest';
import {
  ChangeCategory,
  ChangeType,
  type ICharacter,
  type TokenAdd,
} from '@wallandshadow/shared';
import { createApp } from '../app.js';
import { db } from '../db/connection.js';
import { spritesheets } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import {
  registerUser,
  apiGet,
  apiPost,
  apiPatch,
  apiPut,
  apiDelete,
  getBaseChange,
  postMapChanges,
} from './helpers.js';
import { createAdventure, createMap, joinAdventure } from './wsTestHelpers.js';

const app = createApp();

async function listCharacters(token: string, adventureId: string, uid: string): Promise<ICharacter[]> {
  const res = await apiGet(app, `/api/adventures/${adventureId}/players`, token);
  expect(res.status).toBe(200);
  const players = (await res.json()) as { playerId: string; characters: ICharacter[] }[];
  return players.find(p => p.playerId === uid)?.characters ?? [];
}

function makeCharacter(id: string, name: string, sprites: { source: string; geometry: string }[] = []): ICharacter {
  return { id, name, text: name.slice(0, 2).toUpperCase(), sprites };
}

// ─── PUT /api/adventures/:id/players/:userId/characters/:characterId ──────────

describe('PUT character', () => {
  test('player can upsert their own character (insert + update)', async () => {
    const { token, uid } = await registerUser(app);
    const adventureId = await createAdventure(app, token);

    // Insert.
    const inserted = makeCharacter('c-1', 'Alice');
    const r1 = await apiPut(app, `/api/adventures/${adventureId}/players/${uid}/characters/c-1`, inserted, token);
    expect(r1.status).toBe(204);
    expect(await listCharacters(token, adventureId, uid)).toEqual([inserted]);

    // Update in place — preserve insertion order even after second character is added.
    const second = makeCharacter('c-2', 'Bob');
    await apiPut(app, `/api/adventures/${adventureId}/players/${uid}/characters/c-2`, second, token);
    const renamed = makeCharacter('c-1', 'Alice Renamed');
    await apiPut(app, `/api/adventures/${adventureId}/players/${uid}/characters/c-1`, renamed, token);

    const after = await listCharacters(token, adventureId, uid);
    expect(after.map(c => c.id)).toEqual(['c-1', 'c-2']);
    expect(after[0].name).toBe('Alice Renamed');
  });

  test('owner can upsert another player\'s character', async () => {
    const owner = await registerUser(app, 'Owner');
    const player = await registerUser(app, 'Player');
    const adventureId = await createAdventure(app, owner.token);
    await joinAdventure(app, owner.token, player.token, adventureId);

    const ch = makeCharacter('c-1', 'Owned by Player, edited by Owner');
    const r = await apiPut(app, `/api/adventures/${adventureId}/players/${player.uid}/characters/c-1`, ch, owner.token);
    expect(r.status).toBe(204);

    expect((await listCharacters(owner.token, adventureId, player.uid))[0].name).toBe(ch.name);
  });

  test('non-owner player editing someone else is forbidden', async () => {
    const owner = await registerUser(app, 'Owner');
    const playerA = await registerUser(app, 'A');
    const playerB = await registerUser(app, 'B');
    const adventureId = await createAdventure(app, owner.token);
    await joinAdventure(app, owner.token, playerA.token, adventureId);
    await joinAdventure(app, owner.token, playerB.token, adventureId);

    const ch = makeCharacter('c-1', 'meddling');
    const r = await apiPut(app, `/api/adventures/${adventureId}/players/${playerB.uid}/characters/c-1`, ch, playerA.token);
    // assertAdventureOwner returns 'permission-denied' which maps to 403.
    expect(r.status).toBe(403);
  });

  test('body id must match path id (rejects id-laundering)', async () => {
    const { token, uid } = await registerUser(app);
    const adventureId = await createAdventure(app, token);
    const ch = makeCharacter('different', 'X');
    const r = await apiPut(app, `/api/adventures/${adventureId}/players/${uid}/characters/c-1`, ch, token);
    expect(r.status).toBe(400);
  });

  test('concurrent upserts on the same player serialise — both writes land', async () => {
    // Without FOR UPDATE both transactions would read the pre-change array
    // and the second write would clobber the first — only one character
    // would survive.
    const { token, uid } = await registerUser(app);
    const adventureId = await createAdventure(app, token);

    const c1 = makeCharacter('c-1', 'Alice');
    const c2 = makeCharacter('c-2', 'Bob');

    const [r1, r2] = await Promise.all([
      apiPut(app, `/api/adventures/${adventureId}/players/${uid}/characters/c-1`, c1, token),
      apiPut(app, `/api/adventures/${adventureId}/players/${uid}/characters/c-2`, c2, token),
    ]);
    expect(r1.status).toBe(204);
    expect(r2.status).toBe(204);

    const after = await listCharacters(token, adventureId, uid);
    expect(after.map(c => c.id).sort()).toEqual(['c-1', 'c-2']);
  });
});

// ─── Request body validation ─────────────────────────────────────────────────

describe('character body validation', () => {
  test.each([
    ['a non-object body', 'not-an-object'],
    ['a blank id', { id: '', name: 'A', text: 'A', sprites: [] }],
    ['a non-string name', { id: 'c-1', name: 42, text: 'A', sprites: [] }],
    ['sprites that are not an array', { id: 'c-1', name: 'A', text: 'A', sprites: 'nope' }],
    ['a sprite missing geometry', { id: 'c-1', name: 'A', text: 'A', sprites: [{ source: 'images/uid/x' }] }],
  ])('PUT rejects %s', async (_label, body) => {
    const { token, uid } = await registerUser(app);
    const adventureId = await createAdventure(app, token);
    const r = await apiPut(app, `/api/adventures/${adventureId}/players/${uid}/characters/c-1`, body, token);
    expect(r.status).toBe(400);
  });

  test('PATCH rejects a characters array with a malformed element', async () => {
    const { token, uid } = await registerUser(app);
    const adventureId = await createAdventure(app, token);
    const r = await apiPatch(app, `/api/adventures/${adventureId}/players/${uid}`,
      { characters: [makeCharacter('c-1', 'OK'), { id: 'c-2' }] }, token);
    expect(r.status).toBe(400);
  });

  test('PATCH rejects a non-boolean allowed', async () => {
    const owner = await registerUser(app, 'Owner');
    const player = await registerUser(app, 'Player');
    const adventureId = await createAdventure(app, owner.token);
    await joinAdventure(app, owner.token, player.token, adventureId);
    const r = await apiPatch(app, `/api/adventures/${adventureId}/players/${player.uid}`,
      { allowed: 'yes' }, owner.token);
    expect(r.status).toBe(400);
  });
});

// ─── DELETE /api/adventures/:id/players/:userId/characters/:characterId ───────

describe('DELETE character', () => {
  test('player can delete their own character', async () => {
    const { token, uid } = await registerUser(app);
    const adventureId = await createAdventure(app, token);
    await apiPut(app, `/api/adventures/${adventureId}/players/${uid}/characters/c-1`, makeCharacter('c-1', 'A'), token);

    const r = await apiDelete(app, `/api/adventures/${adventureId}/players/${uid}/characters/c-1`, token);
    expect(r.status).toBe(204);
    expect(await listCharacters(token, adventureId, uid)).toEqual([]);
  });

  test('DELETE on a missing character is a 204 no-op (idempotent)', async () => {
    const { token, uid } = await registerUser(app);
    const adventureId = await createAdventure(app, token);
    const r = await apiDelete(app, `/api/adventures/${adventureId}/players/${uid}/characters/nope`, token);
    expect(r.status).toBe(204);
  });

  test('non-owner deleting another player\'s character is forbidden', async () => {
    const owner = await registerUser(app, 'Owner');
    const playerA = await registerUser(app, 'A');
    const playerB = await registerUser(app, 'B');
    const adventureId = await createAdventure(app, owner.token);
    await joinAdventure(app, owner.token, playerA.token, adventureId);
    await joinAdventure(app, owner.token, playerB.token, adventureId);
    await apiPut(app, `/api/adventures/${adventureId}/players/${playerB.uid}/characters/c-1`, makeCharacter('c-1', 'X'), playerB.token);

    const r = await apiDelete(app, `/api/adventures/${adventureId}/players/${playerB.uid}/characters/c-1`, playerA.token);
    expect(r.status).toBe(403);
  });
});

// ─── Consolidation reconciles stale token sprite references (item 8) ──────────

describe('tryConsolidateMapChanges reconciles dead sprite refs', () => {
  test('token sprite whose source vanished from spritesheets is dropped at next consolidation', async () => {
    const { token, uid } = await registerUser(app);
    const adventureId = await createAdventure(app, token);
    const mapId = await createMap(app, token, adventureId);

    // Pretend a spritesheet existed referencing 'images/uid/x' — write the
    // row directly so we can scrub it without going through the
    // image-deletion path (which would itself scrub the token).
    const sheetId = '00000000-0000-7000-8000-000000000001';
    await db.insert(spritesheets).values({
      id: sheetId,
      adventureId,
      sprites: ['images/uid/x'] as unknown as object,
      geometry: '1x1',
      freeSpaces: 0,
      supersededBy: null,
      refs: 0,
    });

    const tokenAdd: TokenAdd = {
      ty: ChangeType.Add,
      cat: ChangeCategory.Token,
      feature: {
        position: { x: 0, y: 0 },
        colour: 1,
        id: 'sprite-token',
        players: [uid],
        size: '1',
        text: 'SP',
        note: '',
        noteVisibleToPlayers: false,
        characterId: '',
        sprites: [{ source: 'images/uid/x', geometry: '1x1' }],
        outline: false,
      },
    };
    await postMapChanges(app, token, adventureId, mapId, [tokenAdd]);

    await apiPost(app, `/api/adventures/${adventureId}/maps/${mapId}/consolidate`, {}, token);
    const beforeBase = await getBaseChange(mapId);
    const beforeToken = beforeBase!.chs.find(c => c.cat === ChangeCategory.Token) as TokenAdd | undefined;
    expect(beforeToken?.feature.sprites).toEqual([{ source: 'images/uid/x', geometry: '1x1' }]);

    // Direct DB delete — the image-delete API would itself run
    // scrubMapSpriteReferences, defeating the point of this test.
    await db.delete(spritesheets).where(eq(spritesheets.id, sheetId));

    // Force a fresh consolidation. `tryConsolidateMapChanges` short-circuits
    // when there are no incrementals to fold in, so push a real move first.
    await postMapChanges(app, token, adventureId, mapId, [{
      ty: ChangeType.Move,
      cat: ChangeCategory.Token,
      newPosition: { x: 1, y: 0 },
      oldPosition: { x: 0, y: 0 },
      tokenId: 'sprite-token',
    }]);
    await apiPost(app, `/api/adventures/${adventureId}/maps/${mapId}/consolidate`, {}, token);

    const afterBase = await getBaseChange(mapId);
    const afterToken = afterBase!.chs.find(c => c.cat === ChangeCategory.Token) as TokenAdd | undefined;
    expect(afterToken?.feature.id).toBe('sprite-token');
    expect(afterToken?.feature.sprites).toEqual([]);
  }, 30000);
});
