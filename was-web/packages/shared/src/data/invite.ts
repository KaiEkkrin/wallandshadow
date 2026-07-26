// This is an invitation to join an adventure.

export interface IInvite {
  adventureId: string;
  adventureName: string;
  owner: string; // the owner of the adventure
  ownerName: string;
  timestamp: number; // when the invite expires, in milliseconds since the epoch
}
