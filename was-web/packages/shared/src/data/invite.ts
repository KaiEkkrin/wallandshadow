import { Timestamp } from './types';

// This is an invitation to join an adventure.

export interface IInvite {
  adventureId: string;
  adventureName: string;
  owner: string; // the owner of the adventure
  ownerName: string;
  timestamp: Timestamp | number; // initialise this to `serverTimestamp`.
                                 // TODO make invites expire?
}