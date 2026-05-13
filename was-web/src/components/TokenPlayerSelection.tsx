import { useCallback, useMemo } from 'react';
import * as React from 'react';

import { IPlayer } from '@wallandshadow/shared';

import Form from 'react-bootstrap/Form';

import { DELETED_USER_LABEL } from './userNameText';

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

  // Token player IDs that no longer resolve to a current adventure member —
  // typically because that user deleted their account. Surface them as disabled
  // "Deleted user" options so the editor reveals (rather than hides) the stale
  // entry; the next edit that touches the selection will drop them naturally.
  const orphanedIds = useMemo(() => {
    const known = new Set(players.map(p => p.playerId));
    return tokenPlayerIds.filter(id => !known.has(id));
  }, [players, tokenPlayerIds]);

  return (
    <Form.Control id={id} as="select" multiple value={tokenPlayerIds}
      onChange={e => handleChange(e as unknown as React.FormEvent<HTMLSelectElement>)}>
      {players.map(p =>
        <option key={p.playerId} value={p.playerId}>{p.playerName}</option>
      )}
      {orphanedIds.map(orphanId =>
        <option key={orphanId} value={orphanId} disabled>{DELETED_USER_LABEL}</option>
      )}
    </Form.Control>
  );
}

export default TokenPlayerSelection;