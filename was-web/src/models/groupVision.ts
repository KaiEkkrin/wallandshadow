import { IToken } from '@wallandshadow/shared';
import { MapColourVisualisationMode } from './displayMode';

export interface ILoSSourceInput {
  uid: string;
  owner: string;
  ffa: boolean;
  enableGroupVision: boolean;
  displayMode: MapColourVisualisationMode;
  groupVisionColours: ReadonlySet<number>;
  myCharacterIds: ReadonlySet<string>;
  allTokens: readonly IToken[];
  selectedTokenIds: ReadonlySet<string>;
}

// Decides which tokens project line-of-sight.
//   undefined → no LoS pass at all
//   []        → LoS pass with no sources (whole map fully black)
//   non-empty → those tokens project LoS
// The undefined/empty distinction is load-bearing: in owner/FFA group-vision
// mode with no colours selected we still want a fully-black map (issue #332),
// not the default owner behaviour of suppressing LoS entirely.
export function chooseLoSSourceTokens(input: ILoSSourceInput): readonly IToken[] | undefined {
  const seeEverything = input.uid === input.owner || input.ffa;
  const groupVisionActive = seeEverything
    ? input.displayMode === MapColourVisualisationMode.GroupVision
    : input.enableGroupVision;
  const selected = input.allTokens.filter(t => input.selectedTokenIds.has(t.id));

  if (selected.length > 0) {
    if (groupVisionActive) {
      // `-1` ("black") never participates in group vision, so a selected black
      // token does not widen the pool. If the entire selection is black, fall
      // back to the selection itself so the LoS pool isn't accidentally empty.
      const selectedColours = new Set<number>();
      for (const t of selected) if (t.colour !== -1) selectedColours.add(t.colour);
      if (selectedColours.size === 0) return selected;
      return input.allTokens.filter(t => selectedColours.has(t.colour));
    }
    return selected;
  }

  if (seeEverything) {
    if (input.displayMode === MapColourVisualisationMode.GroupVision) {
      return input.allTokens.filter(t => input.groupVisionColours.has(t.colour));
    }
    return undefined;
  }

  if (input.enableGroupVision) {
    const myColours = derivePlayerGroupVisionColours(input.allTokens, input.uid, input.myCharacterIds);
    return input.allTokens.filter(t => myColours.has(t.colour));
  }

  return input.allTokens.filter(t => t.players.includes(input.uid));
}

// `-1` ("black") never participates in group vision.
export function derivePlayerGroupVisionColours(
  allTokens: readonly IToken[],
  uid: string,
  myCharacterIds: ReadonlySet<string>,
): ReadonlySet<number> {
  const colours = new Set<number>();
  for (const t of allTokens) {
    if (t.colour === -1) continue;
    const ownsByPlayer = t.players.includes(uid);
    const ownsByCharacter = t.characterId !== '' && myCharacterIds.has(t.characterId);
    if (ownsByPlayer || ownsByCharacter) {
      colours.add(t.colour);
    }
  }
  return colours;
}
