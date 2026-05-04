import { useMemo } from 'react';

import { IPlayer, ITokenProperties, PresenceUserState } from '@wallandshadow/shared';
import { hexColours } from '../models/featureColour';

import SpriteImage from './SpriteImage';

import Badge from 'react-bootstrap/Badge';
import Dropdown from 'react-bootstrap/Dropdown';
import ListGroup from 'react-bootstrap/ListGroup';

interface IPlayerInfoListPropsBase {
  ownerUid: string | undefined;
  tokens: ITokenProperties[];
  presence?: ReadonlyMap<string, PresenceUserState> | undefined;
  viewerCurrentMapId?: string | undefined;
  showBlockedPlayers?: boolean | undefined;
  showBlockButtons?: boolean | undefined;
  showNoTokenWarning?: boolean | undefined;
  blockPlayer?: ((player: IPlayer) => void) | undefined;
  unblockPlayer?: ((player: IPlayer) => void) | undefined;
  resetView?: ((centreOn?: string | undefined) => void) | undefined; // centres on the token with the given id
}

function formatRelativeMinutes(ms: number): string {
  const mins = Math.max(0, Math.round(ms / 60000));
  if (mins < 1) return 'just now';
  if (mins === 1) return '1 minute ago';
  return `${mins} minutes ago`;
}

interface IPresenceBadgeProps {
  presence: PresenceUserState | undefined;
  playerName: string;
  viewerCurrentMapId: string | undefined;
}

const CONNECTED_COLOUR = 'var(--bs-success)';
const DISCONNECTED_COLOUR = 'var(--bs-warning)';
const DOT_SIZE = '0.7em';

function connectedLabel(playerName: string, samePage: boolean, currentMapId: string | undefined): string {
  if (samePage) return `${playerName} is on this page`;
  if (currentMapId === undefined) return `${playerName} is on the adventure overview`;
  return `${playerName} is on a different map`;
}

function PresenceBadge({ presence, playerName, viewerCurrentMapId }: IPresenceBadgeProps) {
  if (presence === undefined) return null;
  if (presence.connected) {
    const samePage = presence.currentMapId === viewerCurrentMapId;
    const label = connectedLabel(playerName, samePage, presence.currentMapId);
    return (
      <span
        aria-label={label}
        title={label}
        className="ms-2"
        style={{
          display: 'inline-block', width: DOT_SIZE, height: DOT_SIZE, borderRadius: '50%',
          backgroundColor: samePage ? CONNECTED_COLOUR : 'transparent',
          border: samePage ? 'none' : `2px solid ${CONNECTED_COLOUR}`,
          boxSizing: 'border-box',
          verticalAlign: 'middle', flexShrink: 0,
        }}
      />
    );
  }
  const sinceMs = Date.now() - presence.lastSeen;
  const label = `${playerName} was here ${formatRelativeMinutes(sinceMs)}`;
  return (
    <span
      aria-label={label}
      title={label}
      className="ms-2"
      style={{
        display: 'inline-block', width: DOT_SIZE, height: DOT_SIZE, borderRadius: '50%',
        backgroundColor: DISCONNECTED_COLOUR, verticalAlign: 'middle', flexShrink: 0,
      }}
    />
  );
}

interface IPlayerInfoListItemProps extends IPlayerInfoListPropsBase {
  player: IPlayer;
}

function PlayerInfoListItem({
  ownerUid, player, tokens, presence, viewerCurrentMapId, showBlockButtons, showNoTokenWarning,
  blockPlayer, resetView, unblockPlayer
}: IPlayerInfoListItemProps) {
  const playerPresence = presence?.get(player.playerId);
  const blockedBadge = useMemo(
    () => player.allowed === false ?
      <Badge className="ms-2 mt-1" bg="danger" title={"Player " + player.playerName + " is blocked"}>BLOCKED</Badge> :
      undefined,
    [player]
  );

  const blockItem = useMemo(
    () => (showBlockButtons !== true || player.playerId === ownerUid) ? undefined :
      player.allowed === false ? <Dropdown.Item onClick={() => unblockPlayer?.(player)}>Unblock</Dropdown.Item> :
      <Dropdown.Item onClick={() => blockPlayer?.(player)}>Block</Dropdown.Item>,
    [ownerUid, player, showBlockButtons, blockPlayer, unblockPlayer]
  );

  const myTokens = useMemo(
    () => tokens.filter(t => t.players.find(p => p === player.playerId) !== undefined),
    [player, tokens]
  );

  const isNoTokenHidden = useMemo(
    () => player.playerId === ownerUid,
    [ownerUid, player]
  );

  const badges = useMemo(() => {
    if (player.playerId === ownerUid) {
      return [(
        <Badge key="ownerBadge" className="ms-2 mt-1" bg="warning"
          title={"Player " + player.playerName + " is the owner"}
        >Owner</Badge>
      )];
    } else if (myTokens.length > 0) {
      return myTokens.map(t => {
        const key = `badge_${t.id}`;
        const title = `Player ${player.playerName} has token ${t.text}`;
        if (t.characterId.length > 0 || t.sprites.length > 0) { // TODO #46 deal with no-image characters...
          return (
            <SpriteImage key={key} className="ms-2 mt-1" altName={player.playerName}
              size={32} border="1px solid" borderColour={hexColours[t.colour]} token={t}
              onClick={() => resetView?.(t.id)} />
          );
        } else {
          return (
            <Badge key={key} className="ms-2 mt-1" title={title}
              style={{ backgroundColor: hexColours[t.colour], color: "black", userSelect: "none" }}
              onClick={() => resetView?.(t.id)}
            >{t.text}</Badge>
          );
        }
      });
    } else if (showNoTokenWarning === true) {
      return [(
        <Badge key="noTokenBadge" className="ms-2 mt-1" hidden={isNoTokenHidden} bg="warning"
          title={"Player " + player.playerName + " has no token"}
        >No token</Badge>
      )];
    } else {
      return [];
    }
  }, [isNoTokenHidden, myTokens, ownerUid, player, resetView, showNoTokenWarning]);

  const contentItems = useMemo(() => {
    // Always show the player name
    const items = [(
      <div key="nameItem"
        style={{ wordBreak: "break-all", wordWrap: "break-word", display: "flex", alignItems: "center" }}
        aria-label={`Player ${player.playerName}`}
      >{player.playerName}<PresenceBadge presence={playerPresence} playerName={player.playerName} viewerCurrentMapId={viewerCurrentMapId} />{blockedBadge}</div>
    )];

    // If we have a block item, show that in a little menu to make it less threatening
    if (blockItem !== undefined) {
      items.push((
        <Dropdown key="manageItem">
          <Dropdown.Toggle className="ms-2" variant="secondary" size="sm">Manage</Dropdown.Toggle>
          <Dropdown.Menu>{blockItem}</Dropdown.Menu>
        </Dropdown>
      ));
    }

    // If we have any badges, include those
    if (badges.length > 0) {
      items.push((
        <div key="badgesItem" style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", alignItems: "center" }}>
          {badges}
        </div>
      ));
    }

    return items;
  }, [badges, blockedBadge, blockItem, player, playerPresence, viewerCurrentMapId]);

  return (
    <ListGroup.Item className="Map-info-list-item">
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between" }}>
        {contentItems}
      </div>
    </ListGroup.Item>
  );
}

export interface IPlayerInfoListProps extends IPlayerInfoListPropsBase {
  players: IPlayer[];
}

function PlayerInfoList(props: IPlayerInfoListProps) {
  return (
    <ListGroup variant="flush">
      {props.players.filter(p => props.showBlockedPlayers === true || p.allowed !== false).map(p => (
        <PlayerInfoListItem key={p.playerId} player={p} {...props} />
      ))}
    </ListGroup>
  );
}

export default PlayerInfoList;