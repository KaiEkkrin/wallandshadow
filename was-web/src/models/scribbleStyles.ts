import chroma from 'chroma-js';
import { ITokenProperties } from '@wallandshadow/shared';
import { standardColours } from './featureColour';
import { Rgb, ScribbleStyle, SCRIBBLE_GM_WIDTH_SCALE } from './scribbleTypes';

// Hue of wheel slot 0. With the current token palette, 0° maximises the
// minimum hue gap to the six pickable colours for six players (~15°); the
// darker outline lightness does most of the separating work.
export const SCRIBBLE_HUE_OFFSET_DEG = 0;
const OUTLINE_L = 38;
const OUTLINE_C = 60;

export interface ScribbleStyleInputs {
  // The adventure owner -- the GM.
  ownerId: string;
  // Every player in the adventure (blocked ones included, so blocking someone
  // does not recolour everyone else).
  playerIds: readonly string[];
  // Every token on the current map.
  tokens: Iterable<ITokenProperties>;
}

function lch(l: number, c: number, h: number): Rgb {
  const [r, g, b] = chroma.lch(l, c, h).rgb();
  return { r: r / 255, g: g / 255, b: b / 255 };
}

// The outline at hue h, desaturated just enough to fit in sRGB. Letting
// chroma-js clip instead would shift the hue -- by up to ~33° around blue --
// and could make two players' outlines look alike.
function outlineAt(h: number): Rgb {
  if (!chroma.lch(OUTLINE_L, OUTLINE_C, h).clipped()) {
    return lch(OUTLINE_L, OUTLINE_C, h);
  }
  let lo = 0;
  let hi = OUTLINE_C;
  for (let i = 0; i < 16; ++i) {
    const mid = (lo + hi) / 2;
    if (chroma.lch(OUTLINE_L, mid, h).clipped()) {
      hi = mid;
    } else {
      lo = mid;
    }
  }
  return lch(OUTLINE_L, lo, h);
}

const MID_GREY_FILL = lch(60, 0, 0);
const UNKNOWN_OUTLINE = lch(OUTLINE_L, 0, 0);
// Near-white: the default map background is near-black, against which a
// dark outline disappears.
const GM_OUTLINE = lch(95, 0, 0);

function tokenFill(t: ITokenProperties): Rgb {
  return standardColours[t.colour]?.light ?? MID_GREY_FILL;
}

// Builds the authorId -> style lookup for one map. The fill is the colour of
// the author's first character token on the map (else first other token, else
// mid-grey); the outline is a hue evenly spaced around the LCH wheel by sorted
// player id, except for the GM, whose outline is colourless and line thicker.
// Every client derives the same styles from the same inputs.
export function buildScribbleStyles(inputs: ScribbleStyleInputs): (authorId: string) => ScribbleStyle {
  // Token ids are UUIDv7, so id order is creation order -- and, unlike the
  // map's own iteration order, the same on every client.
  const tokens = [...inputs.tokens].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const characterFills = new Map<string, Rgb>();
  const otherFills = new Map<string, Rgb>();
  for (const t of tokens) {
    const fills = t.characterId ? characterFills : otherFills;
    for (const uid of t.players) {
      if (!fills.has(uid)) {
        fills.set(uid, tokenFill(t));
      }
    }
  }

  const wheel = [...new Set(inputs.playerIds)].filter(id => id !== inputs.ownerId).sort();
  const outlines = new Map<string, Rgb>(wheel.map((id, k) => [
    id, outlineAt(SCRIBBLE_HUE_OFFSET_DEG + k * 360 / wheel.length)
  ]));

  return authorId => {
    const fill = characterFills.get(authorId) ?? otherFills.get(authorId) ?? MID_GREY_FILL;
    if (authorId === inputs.ownerId) {
      return { fill, outline: GM_OUTLINE, widthScale: SCRIBBLE_GM_WIDTH_SCALE };
    }
    return { fill, outline: outlines.get(authorId) ?? UNKNOWN_OUTLINE, widthScale: 1 };
  };
}
