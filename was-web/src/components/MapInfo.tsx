import { useMemo } from 'react';

import { IPlayer } from '../data/adventure';
import { ITokenProperties } from '../data/feature';
import { IMap } from '../data/map';
import MapInfoCard from './MapInfoCard';
import NetworkStatus, { INetworkStatusProps } from './NetworkStatus';
import PlayerHelp from './PlayerHelp';
import PlayerInfoList from './PlayerInfoList';

import Badge from 'react-bootstrap/Badge';

import { faUsers, faQuestion } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';

import fluent from 'fluent-iterable';

// A quick utility function for figuring out whether a player has any
// tokens assigned to them so we can show status.
// Returns undefined for the owner, who is a special case (we don't care.)
function hasAnyTokens(map: IMap | undefined, player: IPlayer, tokens: ITokenProperties[]) {
  if (player.playerId === map?.owner) {
    return undefined;
  }

  return fluent(tokens).any(
    t => t.players.find(pId => pId === player.playerId) !== undefined
  );
}

// Provides informational things on the right-hand side of the map view.
// All of them should default to unexpanded (button only form) and
// toggle to expand.

interface IMapInfoProps extends INetworkStatusProps {
  map: IMap | undefined;
  players: IPlayer[];
  tokens: ITokenProperties[];
  canDoAnything: boolean;
  resetView: (centreOn?: string | undefined) => void;
}

function MapInfo(props: IMapInfoProps) {
  const numberOfPlayersWithNoTokens = useMemo(
    () => fluent(props.players).filter(p => hasAnyTokens(props.map, p, props.tokens) === false).count(),
    [props.map, props.players, props.tokens]
  );

  const hideNumberOfPlayersWithNoTokens = useMemo(
    () => numberOfPlayersWithNoTokens === 0,
    [numberOfPlayersWithNoTokens]
  );

  const ownerUid = useMemo(() => props.map?.owner, [props.map]);

  const playerInfoButton = useMemo(() => (
    <div>
      <FontAwesomeIcon icon={faUsers} color="white" />
      <Badge className="ms-1" hidden={hideNumberOfPlayersWithNoTokens} bg="warning">
        {numberOfPlayersWithNoTokens}
      </Badge>
    </div>
  ), [numberOfPlayersWithNoTokens, hideNumberOfPlayersWithNoTokens]);

  return (
    <div className="Map-info">
      <MapInfoCard title="Help" buttonContent={(
        <FontAwesomeIcon icon={faQuestion} color="white" />
      )}>
        <PlayerHelp canDoAnything={props.canDoAnything} />
      </MapInfoCard>
      <MapInfoCard title="Players" buttonContent={playerInfoButton}>
        <PlayerInfoList ownerUid={ownerUid} showNoTokenWarning={true} {...props} />
      </MapInfoCard>
      <NetworkStatus {...props} />
    </div>
  );
}

export default MapInfo;