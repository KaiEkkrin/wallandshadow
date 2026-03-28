import { useCallback } from 'react';
import * as React from 'react';

import { IPlayer } from '../data/adventure';

import Form from 'react-bootstrap/Form';

interface ITokenPlayerSelectionProps {
  id: string;
  players: IPlayer[];
  tokenPlayerIds: string[];
  setTokenPlayerIds: (playerIds: string[]) => void;
}

function TokenPlayerSelection({ id, players, tokenPlayerIds, setTokenPlayerIds }: ITokenPlayerSelectionProps) {
  // I need to hack the type here to coerce it into something usable
  // See https://github.com/DefinitelyTyped/DefinitelyTyped/issues/16208
  const handleChange = useCallback((e: React.FormEvent<HTMLSelectElement>) => {
    const selectedIds: string[] = [];
    for (let i = 0; i < e.currentTarget.selectedOptions.length; ++i) {
      const option = e.currentTarget.selectedOptions[i];
      selectedIds.push(option.value);
    }

    setTokenPlayerIds(selectedIds);
  }, [setTokenPlayerIds]);

  return (
    <Form.Control id={id} as="select" multiple value={tokenPlayerIds}
      onChange={e => handleChange(e as unknown as React.FormEvent<HTMLSelectElement>)}>
      {players.map(p =>
        <option key={p.playerId} value={p.playerId}>{p.playerName}</option>
      )}
    </Form.Control>
  );
}

export default TokenPlayerSelection;