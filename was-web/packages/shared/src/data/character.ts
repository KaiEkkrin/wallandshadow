// Describes a character, which can be incarnated into a token.

import { ISprite } from "./sprite";

// Starting out very basic -- I expect this to expand with more features in the future.
export interface ICharacter {
  id: string;
  name: string;
  text: string; // maximum of three letters
  sprites: ISprite[]; // should only be 0 or 1, like the token properties.
}

// The character count limit won't be enforced by policy, because that would be irritating
// (requiring character documents separate from the player ones, and enforcement by Function
// for what just seems like nickel-and-diming.)
// Instead we'll let players write as many characters as they want into their player record
// in theory, but in practice we'll only recognise this many, which should be enough for any
// sane use case whilst also few enough to not over-burden the UI.
// I could in future consider raising this limit for map owners only and paginating the
// character selection to let them pre-create repeatedly used monsters with the character system.
export const maxCharacters = 6;