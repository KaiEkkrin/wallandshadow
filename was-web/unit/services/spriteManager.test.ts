import { describe, expect, test } from 'vitest';
import { BehaviorSubject, Subject, firstValueFrom } from 'rxjs';
import { take } from 'rxjs/operators';
import {
  ICharacter,
  IIdentified,
  ILiveData,
  IPlayer,
  ISpritesheet,
  ISpritesheetEntry,
  ITokenProperties,
} from '@wallandshadow/shared';

import { SpriteManager } from './spriteManager';

function makeLive(): { live: ILiveData; emit: (snap: IIdentified<ISpritesheet>[]) => void } {
  const subject = new Subject<IIdentified<ISpritesheet>[]>();
  const live = {
    watchSpritesheets: (
      _adventureId: string,
      onNext: (s: IIdentified<ISpritesheet>[]) => void,
    ) => {
      const sub = subject.subscribe(onNext);
      return () => sub.unsubscribe();
    },
  } as unknown as ILiveData;
  return { live, emit: (snap) => subject.next(snap) };
}

function makeToken(overrides: Partial<ITokenProperties> = {}): ITokenProperties {
  return {
    id: 'token-1',
    colour: 0,
    players: [],
    size: '1',
    text: 'T',
    note: '',
    noteVisibleToPlayers: false,
    characterId: '',
    sprites: [],
    outline: false,
    ...overrides,
  };
}

function makeSpritesheet(id: string, sources: string[]): IIdentified<ISpritesheet> {
  return {
    id,
    record: {
      sprites: sources,
      geometry: '1x1',
      freeSpaces: 0,
      date: 0,
      supersededBy: '',
      refs: 0,
    },
  };
}

function makeCharacter(id: string, spriteSources: string[]): ICharacter {
  return {
    id,
    name: `Char ${id}`,
    text: 'C',
    sprites: spriteSources.map(source => ({ source, geometry: '1x1' })),
  };
}

function makePlayer(uid: string, characters: ICharacter[]): IPlayer {
  return {
    playerId: uid,
    playerName: `User ${uid}`,
    allowed: true,
    characters,
  };
}

const resolveUrl = async (path: string) => `https://example.test/${path}`;

describe('SpriteManager.lookupToken', () => {
  test('emits the matching spritesheet entry when the character has a sprite', async () => {
    const { live, emit } = makeLive();
    const players$ = new BehaviorSubject<IPlayer[]>([
      makePlayer('uid-1', [makeCharacter('char-1', ['images/uid-1/a'])]),
    ]);
    const sm = new SpriteManager(live, resolveUrl, 'adv-1', players$);

    const token = makeToken({ characterId: 'char-1' });
    const next = firstValueFrom(sm.lookupToken(token).pipe(take(1)));
    emit([makeSpritesheet('sheet-1', ['images/uid-1/a'])]);
    const entry = await next;

    expect(entry).toBeDefined();
    expect((entry as ISpritesheetEntry & { character: ICharacter }).position).toBe(0);
    expect((entry as ISpritesheetEntry & { character: ICharacter }).character?.id).toBe('char-1');
    sm.dispose();
  });

  test('emits undefined after a character\'s sprite is scrubbed', async () => {
    const { live, emit } = makeLive();
    const players$ = new BehaviorSubject<IPlayer[]>([
      makePlayer('uid-1', [makeCharacter('char-1', ['images/uid-1/a'])]),
    ]);
    const sm = new SpriteManager(live, resolveUrl, 'adv-1', players$);

    const token = makeToken({ characterId: 'char-1' });

    // Drain the initial state once so _published and _players are both warm.
    // shareReplay(1) on _published and BehaviorSubject on _players mean the
    // second subscription below will see the updated player state too.
    const initial = firstValueFrom(sm.lookupToken(token).pipe(take(1)));
    emit([makeSpritesheet('sheet-1', ['images/uid-1/a'])]);
    expect(await initial).toBeDefined();

    players$.next([makePlayer('uid-1', [makeCharacter('char-1', [])])]);

    const cleared = await firstValueFrom(sm.lookupToken(token).pipe(take(1)));
    expect(cleared).toBeUndefined();
    sm.dispose();
  });

  test('emits undefined when the sprite is not present in any current spritesheet', async () => {
    const { live, emit } = makeLive();
    const players$ = new BehaviorSubject<IPlayer[]>([
      makePlayer('uid-1', [makeCharacter('char-1', ['images/uid-1/missing'])]),
    ]);
    const sm = new SpriteManager(live, resolveUrl, 'adv-1', players$);

    const token = makeToken({ characterId: 'char-1' });
    const next = firstValueFrom(sm.lookupToken(token).pipe(take(1)));
    // Emit a spritesheet that does NOT contain the referenced sprite.
    emit([makeSpritesheet('sheet-1', ['images/uid-1/something-else'])]);
    expect(await next).toBeUndefined();
    sm.dispose();
  });

  test('emits undefined when the token has no characterId and no own sprites', async () => {
    const { live, emit } = makeLive();
    const players$ = new BehaviorSubject<IPlayer[]>([]);
    const sm = new SpriteManager(live, resolveUrl, 'adv-1', players$);

    const next = firstValueFrom(sm.lookupToken(makeToken()).pipe(take(1)));
    emit([]);
    expect(await next).toBeUndefined();
    sm.dispose();
  });

  test('falls back to token sprites when the character has no sprites', async () => {
    const { live, emit } = makeLive();
    const players$ = new BehaviorSubject<IPlayer[]>([
      makePlayer('uid-1', [makeCharacter('char-1', [])]),
    ]);
    const sm = new SpriteManager(live, resolveUrl, 'adv-1', players$);

    const token = makeToken({
      characterId: 'char-1',
      sprites: [{ source: 'images/uid-1/token-own', geometry: '1x1' }],
    });
    const next = firstValueFrom(sm.lookupToken(token).pipe(take(1)));
    emit([makeSpritesheet('sheet-1', ['images/uid-1/token-own'])]);
    const entry = await next;
    expect(entry).toBeDefined();
    expect(entry?.position).toBe(0);
    sm.dispose();
  });
});
