import { useMemo } from 'react';
import * as React from 'react';

import { ICharacter } from '../data/character';
import { IPlayer } from '../data/adventure';

import Button from 'react-bootstrap/Button';
import ButtonGroup from 'react-bootstrap/ButtonGroup';
import ListGroup from 'react-bootstrap/ListGroup';

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faEdit, faTimes } from '@fortawesome/free-solid-svg-icons';
import SpriteImage from './SpriteImage';

interface ICharacterBaseProps {
  canEdit?: boolean | undefined;
  itemClassName?: string | undefined;
  handleEdit?: ((c: ICharacter) => void) | undefined;
  handleDelete?: ((c: ICharacter) => void) | undefined;
  setActiveId?: ((id: string) => void) | undefined;
  showPlayerNames?: boolean | undefined;
}

interface ICharacterItemProps extends ICharacterBaseProps {
  character: ICharacter;
  playerName: string;
}

function CharacterItem({
  canEdit, character, handleEdit, handleDelete, itemClassName, playerName, setActiveId, showPlayerNames
}: ICharacterItemProps) {
  const eventKey = useMemo(
    () => setActiveId !== undefined ? character.id : undefined,
    [character, setActiveId]
  );

  const desc = useMemo(() => (
    <React.Fragment>
      {character.name}
      {character.sprites.length > 0 ? (
        <SpriteImage className="ms-2" sprite={character.sprites[0]} altName=""
          size={32} border="1px solid" borderColour="grey" />
      ) : null}
    </React.Fragment>
  ), [character.name, character.sprites]);

  const pn = useMemo(
    () => showPlayerNames === true ? (<div>{playerName}</div>) : null,
    [playerName, showPlayerNames]
  );

  return (
    <ListGroup.Item className={itemClassName} eventKey={eventKey}>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between' }}
        onClick={() => setActiveId?.(character.id)}
      >
        <div>{desc}</div>
        {pn}
        {canEdit === true ? (
          <ButtonGroup className="ms-2">
            <Button variant="primary" onClick={() => handleEdit?.(character)}>
              <FontAwesomeIcon icon={faEdit} color="white" />
            </Button>
            <Button variant="danger" onClick={() => handleDelete?.(character)}>
              <FontAwesomeIcon icon={faTimes} color="white" />
            </Button>
          </ButtonGroup>
        ) : null}
      </div>
    </ListGroup.Item>
  );
}

interface ICharacterListProps extends ICharacterBaseProps {
  activeId?: string | undefined;
  players: IPlayer[];
  style?: React.CSSProperties | undefined;
}

function CharacterList({ activeId, players, style, ...otherProps }: ICharacterListProps) {
  return (
    <ListGroup variant="flush" activeKey={activeId} style={style}>
      {players.flatMap(p => p.characters.map(c =>
        (<CharacterItem key={c.id} character={c} playerName={p.playerName} {...otherProps} />)
      ))}
    </ListGroup>
  );
}

export default CharacterList;