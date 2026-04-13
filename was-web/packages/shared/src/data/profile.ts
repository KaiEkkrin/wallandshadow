import { IMapSummary } from './adventure';
import { UserLevel } from './policy';

export interface IProfile {
  name: string; // a friendly user name to have in maps.
                // Use of this property should always be preferred to userContext.displayName
                // except when actually creating the profile.
  email: string; // auto sync with user record; should be useful for looking up accounts to upgrade/downgrade
  level: UserLevel; // the user's permission level.  Firebase rules stop us from
                    // changing this willy nilly.
  adventures: IAdventureSummary[]; 
  latestMaps: IMapSummary[];
}

export interface IAdventureSummary {
  id: string;
  name: string;
  description: string;
  owner: string; // owning uid
  ownerName: string;
  imagePath: string;
}