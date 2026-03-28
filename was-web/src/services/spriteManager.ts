import { IPlayer } from "../data/adventure";
import { ICharacter } from "../data/character";
import { ITokenProperties } from "../data/feature";
import { getSpritePathFromId, ISprite, ISpritesheet } from "../data/sprite";
import { IDataAndReference, IDataService, ISpriteManager, ISpritesheetEntry } from "./interfaces";

import { combineLatest, from, Observable } from 'rxjs';
import { concatMap, map, shareReplay, switchMap } from 'rxjs/operators';

function findCharacterAndSprites(token: ITokenProperties, players: IPlayer[]) {
  if (token.characterId.length > 0) {
    for (const p of players) {
      for (const c of p.characters) {
        if (c.id === token.characterId) {
          return {
            character: c,
            sprites: c.sprites.length > 0 ? c.sprites : token.sprites
          };
        }
      }
    }
  }

  return { character: undefined, sprites: token.sprites };
}

// TODO This is increasingly misnamed, since it's responsible for providing characters
// as well as sprites :)
export class SpriteManager implements ISpriteManager {
  private readonly _adventureId: string;
  private readonly _players: Observable<IPlayer[]>;
  private _unsub: (() => void) | undefined;

  private _published: Observable<{ sheet: ISpritesheet, url: string }[]>;
  private _isDisposed = false;

  constructor(
    dataService: IDataService,
    resolveImageUrl: (path: string) => Promise<string>,
    adventureId: string,
    players: Observable<IPlayer[]> // must be a hot observable that will replay the latest
  ) {
    console.debug(`subscribing to spritesheets of ${adventureId}`);
    this._adventureId = adventureId;
    this._players = players;
    const ssFeed = new Observable<IDataAndReference<ISpritesheet>[]>(sub => {
      this._unsub = dataService.watchSpritesheets(
        adventureId, ss => {
          sub.next(ss.filter(s => s.data.supersededBy === ""));
        }, e => sub.error(e), () => sub.complete()
      );
    });

    // We assume we'll want all download URLs at some point, and resolve them as
    // they come in:
    async function createEntry(s: IDataAndReference<ISpritesheet>) {
      const url = await resolveImageUrl(getSpritePathFromId(s.id));
      return { sheet: s.data, url: url };
    }

    this._published = ssFeed.pipe(switchMap(
      ss => from(Promise.all(ss.map(createEntry)))
    ), shareReplay(1));
  }

  get adventureId() { return this._adventureId; }

  lookupCharacter(token: ITokenProperties): Observable<ICharacter | undefined> {
    if (!token.characterId) {
      return from([undefined]);
    }

    return this._players.pipe(map(players => {
      const { character } = findCharacterAndSprites(token, players);
      return character;
    }));
  }

  lookupSprite(sprite: ISprite): Observable<ISpritesheetEntry> {
    return this._published.pipe(concatMap(
      entries => {
        return from(
          entries.filter(e => e.sheet.sprites.indexOf(sprite.source) >= 0)
          .map(e => ({ ...e, position: e.sheet.sprites.indexOf(sprite.source) }))
        );
      }
    ));
  }

  lookupToken(token: ITokenProperties): Observable<ISpritesheetEntry & { character: ICharacter | undefined }> {
    return combineLatest([this._published, this._players]).pipe(concatMap(
      ([entries, players]) => {
        const { character, sprites } = findCharacterAndSprites(token, players);
        if (sprites.length === 0) {
          return from([]);
        }

        return from(
          entries.filter(e => e.sheet.sprites.indexOf(sprites[0].source) >= 0)
          .map(e => ({ ...e, character: character, position: e.sheet.sprites.indexOf(sprites[0].source) }))
        );
      }
    ));
  }

  dispose() {
    if (!this._isDisposed) {
      console.debug(`unsubscribing from spritesheets`);
      this._unsub?.();
      this._isDisposed = true;
    }
  }
}