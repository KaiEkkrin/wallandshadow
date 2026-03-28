import { useContext, useState, useCallback } from 'react';
import '../App.css';

import AdventureCards from './AdventureCards';
import { AnalyticsContext } from './AnalyticsContext';
import AdventureModal from './AdventureModal';
import { StatusContext } from './StatusContext';
import { UserContext } from './UserContext';

import { IAdventureSummary } from '../data/profile';

import { useNavigate } from 'react-router-dom';
import { v7 as uuidv7 } from 'uuid';

interface IAdventureCollectionProps {
  uid: string | undefined;
  adventures: IAdventureSummary[];
  showNewAdventure: boolean;
}

function AdventureCollection(props: IAdventureCollectionProps) {
  const userContext = useContext(UserContext);
  const analyticsContext = useContext(AnalyticsContext);
  const statusContext = useContext(StatusContext);
  const navigate = useNavigate();

  const [editName, setEditName] = useState("New adventure");
  const [editDescription, setEditDescription] = useState("");
  const [showEditAdventure, setShowEditAdventure] = useState(false);

  const handleNewAdventureClick = useCallback(() => {
    setEditName("New adventure");
    setEditDescription("");
    setShowEditAdventure(true);
  }, [setEditName, setEditDescription, setShowEditAdventure]);

  const handleNewAdventureSave = useCallback(async () => {
    const functionsService = userContext.functionsService;
    if (functionsService === undefined) {
      return;
    }

    try {
      const id = await functionsService.createAdventure(editName, editDescription);
      navigate('/adventure/' + id, { replace: true });
    } catch (e: unknown) {
      setShowEditAdventure(false);
      analyticsContext.logError('Failed to create adventure', e);
      const message = e instanceof Error ? e.message : String(e);
      if (message) {
        statusContext.toasts.next({ id: uuidv7(), record: {
          title: "Error creating adventure", message: message
        } });
      }
    }
  }, [analyticsContext, editName, editDescription, navigate, statusContext, userContext]);

  return (
    <div>
      <AdventureCards handleCreate={handleNewAdventureClick} adventures={props.adventures}
        showNewAdventureCard={props.showNewAdventure} />
      <AdventureModal description={editDescription}
        name={editName}
        show={showEditAdventure}
        handleClose={() => setShowEditAdventure(false)}
        handleSave={handleNewAdventureSave}
        setDescription={setEditDescription}
        setName={setEditName} />
    </div>
  );
}

export default AdventureCollection;