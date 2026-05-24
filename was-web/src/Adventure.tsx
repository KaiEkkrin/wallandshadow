import { useContext, useEffect, useReducer, useState, useMemo, useCallback } from 'react';
import './App.css';

import { AdventureContext } from './components/AdventureContext';
import { useDocumentTitle } from './hooks/useDocumentTitle';
import AdventureModal from './components/AdventureModal';
import BusyElement from './components/BusyElement';
import CharacterDeletionModal from './components/CharacterDeletionModal';
import CharacterEditorModal from './components/CharacterEditorModal';
import CharacterList from './components/CharacterList';
import ImageCardContent from './components/ImageCardContent';
import ImageDeletionModal from './components/ImageDeletionModal';
import ImagePickerModal from './components/ImagePickerModal';
import MapCollection from './components/MapCollection';
import Navigation from './components/Navigation';
import NetworkStatusBadge from './components/NetworkStatusBadge';
import PlayerInfoList from './components/PlayerInfoList';
import { ProfileContext } from './components/ProfileContext';
import { RequireLoggedIn } from './components/RequireLoggedIn';
import { UserContext } from './components/UserContext';
import { useNetworkStatus } from './hooks/useNetworkStatus';

import { summariseAdventure, IPlayer, IMapSummary, ICharacter, maxCharacters, IImage, canUploadImages, getUserPolicy } from '@wallandshadow/shared';
import { logError } from './services/consoleLogger';

import Button from 'react-bootstrap/Button';
import ButtonGroup from 'react-bootstrap/ButtonGroup';
import Card from 'react-bootstrap/Card';
import Col from 'react-bootstrap/Col';
import Container from 'react-bootstrap/Container';
import Modal from 'react-bootstrap/Modal';
import Row from 'react-bootstrap/Row';

import { Link, useParams, useNavigate } from 'react-router-dom';
import { faImage } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';

interface IAdventureProps {
  adventureId: string;
}

function Adventure({ adventureId }: IAdventureProps) {
  const { api, user } = useContext(UserContext);
  const { profile } = useContext(ProfileContext);
  const { adventure, players, presence, viewerCurrentMapId } = useContext(AdventureContext);
  const navigate = useNavigate();

  const userPolicy = useMemo(
    () => profile === undefined ? undefined : getUserPolicy(profile.level),
    [profile]
  );

  const title = useMemo(() => {
    if (adventure === undefined) {
      return undefined;
    }

    if (adventure?.record.owner !== user?.uid) {
      return adventure?.record.name ?? "";
    }

    const adventureLink = "/adventure/" + adventure.id;
    const objectsString = "(" + (adventure.record.maps.length) + "/" + (userPolicy?.maps ?? 0) + ")";
    return (
      <div style={{ overflowWrap: 'normal' }}>
        <Link aria-label="Link to this adventure" to={adventureLink}>{adventure.record.name}</Link> {objectsString}
      </div>
    );
  }, [adventure, user, userPolicy]);

  useDocumentTitle(adventure?.record.name);

  const { status: netStatus, isConnected: netConnected, rttAverage: netRtt, reconnectCount: netReconnects } = useNetworkStatus();

  // Derive the adventures list for the map collection
  const adventures = useMemo(
    () => adventure === undefined ? [] : [summariseAdventure(adventure.id, adventure.record)],
    [adventure]
  );

  // We want to be able to set the "create invite link" button's text to "Creating..." while it's
  // happening, which might take a moment:
  const [createInviteButtonDisabled, setCreateInviteButtonDisabled] = useState(false);
  useEffect(() => {
    if (adventureId) {
      setCreateInviteButtonDisabled(false);
    }
  }, [adventureId, setCreateInviteButtonDisabled]);

  // Invitations
  const [inviteLink, setInviteLink] = useState<string | undefined>(undefined);
  const createInviteLink = useCallback(() => {
    if (adventure === undefined || api === undefined) {
      return;
    }

    setCreateInviteButtonDisabled(true);
    api.createInvite(adventure.id)
      .then(l => setInviteLink("/invite/" + l))
      .catch(e => {
        setCreateInviteButtonDisabled(false);
        logError("Failed to create invite link for " + adventureId, e);
      });
  }, [adventure, adventureId, setCreateInviteButtonDisabled, setInviteLink, api]);

  // Adventure editing support
  const playersTitle = useMemo(() => {
    if (adventure?.record.owner !== user?.uid) {
      return "Players";
    }
    
    return "Players (" + players.filter(p => p.allowed !== false).length + "/" + (userPolicy?.players ?? 0) + ")";
  }, [adventure, players, user, userPolicy]);

  const canEditAdventure = useMemo(
    () => adventure?.record.owner === user?.uid,
    [user, adventure]
  );

  // Basic tier (images cap = 0) sees no image-related affordances. Used to
  // hide the adventure-banner button here and the per-map image button on the
  // MapCollection below.
  const canPickImages = useMemo(
    () => profile !== undefined && canUploadImages(profile.level),
    [profile]
  );

  const canCreateNewMap = useMemo(() => {
    if (canEditAdventure === false || userPolicy === undefined || adventure === undefined) {
      return false;
    }

    return adventure.record.maps.length < userPolicy.maps;
  }, [adventure, canEditAdventure, userPolicy]);

  const [showEditAdventure, setShowEditAdventure] = useState(false);
  const [editAdventureName, setEditAdventureName] = useState("");
  const [editAdventureDescription, setEditAdventureDescription] = useState("");

  // Adventure image support
  const [showImagePicker, setShowImagePicker] = useState(false);
  const [pickImageForMap, setPickImageForMap] = useState<IMapSummary | undefined>(undefined);
  const [showImageDeletion, setShowImageDeletion] = useState(false);
  const [imageToDelete, setImageToDelete] = useState<IImage | undefined>(undefined);

  // Adventure deletion support
  const canDeleteAdventure = useMemo(
    () => canEditAdventure && adventure?.record.maps.length === 0,
    [canEditAdventure, adventure]
  );
  const cannotDeleteAdventure = useMemo(() => canDeleteAdventure === false, [canDeleteAdventure]);
  const [showDeleteAdventure, setShowDeleteAdventure] = useState(false);

  // Support for leaving the adventure
  const canLeaveAdventure = useMemo(
    () => adventure?.record.owner !== user?.uid,
    [user, adventure]
  );
  const [showLeaveAdventure, setShowLeaveAdventure] = useState(false);

  // Support for the players list
  const ownerUid = useMemo(() => adventure?.record.owner, [adventure]);
  const showBlockButtons = useMemo(() => ownerUid === user?.uid, [ownerUid, user]);
  const showShowBlockedToggle = useMemo(
    () => showBlockButtons && players.find(p => p.allowed === false) !== undefined,
    [showBlockButtons, players]
  );

  const [showBlocked, toggleShowBlocked] = useReducer(state => !state, false);
  const [showBlockPlayer, setShowBlockPlayer] = useState(false);
  const [showUnblockPlayer, setShowUnblockPlayer] = useState(false);
  const [playerToBlock, setPlayerToBlock] = useState<IPlayer | undefined>(undefined);

  const showBlockedText = useMemo(() => showBlocked === true ? "Hide blocked" : "Show blocked", [showBlocked]);

  // Support for the characters list
  const [showEditCharacter, setShowEditCharacter] = useState(false);
  const [showDeleteCharacter, setShowDeleteCharacter] = useState(false);

  const handleModalClose = useCallback(() => {
    setShowBlockPlayer(false);
    setShowUnblockPlayer(false);
    setShowEditAdventure(false);
    setShowImageDeletion(false);
    setShowImagePicker(false);
    setShowDeleteAdventure(false);
    setShowLeaveAdventure(false);
    setShowEditCharacter(false);
    setShowDeleteCharacter(false);
  }, [
    setShowBlockPlayer, setShowUnblockPlayer, setShowEditAdventure, setShowImageDeletion,
    setShowImagePicker, setShowDeleteAdventure, setShowLeaveAdventure, setShowEditCharacter,
    setShowDeleteCharacter
  ]);

  const handleShowBlockPlayer = useCallback((player: IPlayer) => {
    setShowBlockPlayer(true);
    setPlayerToBlock(player);
  }, [setPlayerToBlock, setShowBlockPlayer]);

  const handleShowUnblockPlayer = useCallback((player: IPlayer) => {
    setShowUnblockPlayer(true);
    setPlayerToBlock(player);
  }, [setPlayerToBlock, setShowUnblockPlayer]);

  const handleBlockPlayerSave = useCallback((allowed: boolean) => {
    handleModalClose();
    if (playerToBlock === undefined || api === undefined) {
      return;
    }

    api.updatePlayer(adventureId, playerToBlock.playerId, { allowed })
      .catch(e => logError("Failed to block/unblock player", e));
  }, [handleModalClose, playerToBlock, adventureId, api]);

  const handleShowEditAdventure = useCallback(() => {
    if (adventure === undefined) {
      return;
    }

    setEditAdventureName(adventure.record.name);
    setEditAdventureDescription(adventure.record.description);
    setShowEditAdventure(true);
  }, [adventure, setEditAdventureName, setEditAdventureDescription, setShowEditAdventure]);

  const handleShowImagePicker = useCallback((map?: IMapSummary | undefined) => {
    if (adventure === undefined) {
      return;
    }

    setShowImagePicker(true);
    setPickImageForMap(map);
  }, [adventure, setPickImageForMap, setShowImagePicker]);

  const handleShowImageDeletion = useCallback((image: IImage | undefined) => {
    if (image === undefined) {
      return;
    }

    handleModalClose();
    setShowImageDeletion(true);
    setImageToDelete(image);
  }, [handleModalClose, setImageToDelete, setShowImageDeletion]);

  const handleEditAdventureSave = useCallback(async () => {
    handleModalClose();
    if (adventure === undefined || api === undefined) {
      return;
    }

    await api.updateAdventure(adventureId, {
      name: editAdventureName,
      description: editAdventureDescription,
    });
  }, [api, adventureId, adventure, editAdventureName, editAdventureDescription, handleModalClose]);

  const handleImagePickerSave = useCallback((path: string | undefined) => {
    handleModalClose();
    if (adventure === undefined || api === undefined) {
      return;
    }

    // We might be choosing an image for either the adventure or one of its maps
    if (pickImageForMap === undefined) {
      api.updateAdventure(adventureId, { imagePath: path ?? "" })
        .then(() => console.debug(`Adventure ${adventureId} successfully edited`))
        .catch(e => logError(`Error editing adventure ${adventureId}`, e));
    } else {
      const mapSummary = pickImageForMap;
      api.updateMap(mapSummary.adventureId, mapSummary.id, { imagePath: path ?? "" })
        .then(() => console.debug(`Map ${mapSummary.id} successfully edited`))
        .catch(e => logError(`Error editing map ${mapSummary.id}`, e));
    }
  }, [adventure, handleModalClose, pickImageForMap, adventureId, api]);

  const handleImageDeletionSave = useCallback(() => {
    handleModalClose();
    if (imageToDelete === undefined || api === undefined) {
      return;
    }

    api.deleteImage(imageToDelete.path)
      .then(() => console.debug(`deleted image ${imageToDelete.path}`))
      .catch(e => logError(`failed to delete image ${imageToDelete}`, e));
  }, [handleModalClose, imageToDelete, api]);

  const handleDeleteAdventureSave = useCallback(() => {
    handleModalClose();
    if (api === undefined) {
      return;
    }
    api.deleteAdventure(adventureId)
      .then(() => {
        console.debug("Adventure " + adventureId + " successfully deleted");
        navigate("/app", { replace: true });
      })
      .catch(e => logError("Error deleting adventure " + adventureId, e));
  }, [api, adventureId, navigate, handleModalClose]);

  const handleLeaveAdventureSave = useCallback(() => {
    handleModalClose();
    if (api === undefined) {
      return;
    }
    api.leaveAdventure(adventureId)
      .then(() => {
        console.debug("Successfully left adventure " + adventureId);
        navigate("/app", { replace: true });
      })
      .catch(e => logError("Error leaving adventure " + adventureId, e));
  }, [api, adventureId, handleModalClose, navigate]);

  // Support for the character list
  const myPlayer = useMemo(() => players.filter(p => p.playerId === user?.uid), [players, user]);
  const otherPlayers = useMemo(() => players.filter(p => p.playerId !== user?.uid), [players, user]);
  const showOtherCharacters = useMemo(() => otherPlayers.length > 0, [otherPlayers]);
  const [characterToEdit, setCharacterToEdit] = useState<ICharacter | undefined>(undefined);

  const createCharacterDisabled = useMemo(
    () => myPlayer.length === 0 || myPlayer[0].characters.length >= maxCharacters,
    [myPlayer]
  );

  const myCharactersTitle = useMemo(() => {
    const characterCount = myPlayer.length > 0 ? myPlayer[0].characters.length : 0;
    return `My Characters (${characterCount}/${maxCharacters})`;
  }, [myPlayer]);

  const handleCreateCharacter = useCallback(() => {
    setCharacterToEdit(undefined);
    setShowEditCharacter(true);
  }, [setCharacterToEdit, setShowEditCharacter]);

  const handleEditCharacter = useCallback((character: ICharacter) => {
    setCharacterToEdit(character);
    setShowEditCharacter(true);
  }, [setCharacterToEdit, setShowEditCharacter]);

  const handleDeleteCharacter = useCallback((character: ICharacter) => {
    setCharacterToEdit(character);
    setShowDeleteCharacter(true);
  }, [setCharacterToEdit, setShowDeleteCharacter]);

  const handleCharacterSave = useCallback((character: ICharacter) => {
    handleModalClose();
    if (api === undefined || user?.uid === undefined) return;
    api.editCharacter(adventureId, user.uid, character)
      .then(() => {
        console.debug("Successfully edited character " + character.id);
      })
      .catch(e => logError("Error editing character " + character.id, e));
  }, [api, user, adventureId, handleModalClose]);

  const handleCharacterDeletion = useCallback(() => {
    handleModalClose();
    if (characterToEdit === undefined || api === undefined || user?.uid === undefined) {
      return;
    }

    api.deleteCharacter(adventureId, user.uid, characterToEdit.id)
      .then(() => {
        console.debug("Successfully deleted character " + characterToEdit.id);
      })
      .catch(e => logError("Error deleting character " + characterToEdit.id, e));
  }, [api, user, adventureId, characterToEdit, handleModalClose]);

  // Maps
  const maps = useMemo(() => adventure?.record.maps ?? [], [adventure]);
  const mapDelete = useCallback((id: string) => {
    if (api === undefined) {
      return;
    }
    api.deleteMap(adventureId, id)
      .then(() => console.debug("Map " + id + " successfully deleted"))
      .catch(e => logError("Error deleting map " + id, e));
  }, [api, adventureId]);

  const mapsTitle = useMemo(
    () => `Maps (${maps.length}/${userPolicy?.maps})`,
    [maps, userPolicy]
  );

  return (
    <div>
      <Navigation>{title}</Navigation>
      <Container>
        {adventure !== undefined ?
          <Row className="mt-4 row-cols-1 row-cols-lg-2 g-4">
            <Col>
              <Card className="h-100" bg="dark" text="white">
                <ImageCardContent altName={adventure.record.name} imagePath={adventure.record.imagePath}>
                  <div className="card-content-spaced">
                    <div className="card-body-spaced">
                      <div className="card-row-spaced">
                        <Card.Title>{adventure.record.name}</Card.Title>
                        {canEditAdventure === true ?
                          <ButtonGroup className="ms-2">
                            <Button variant="primary" onClick={handleShowEditAdventure}>Edit</Button>
                            {canPickImages && (
                              <Button variant="primary" aria-label="Set adventure image"
                                onClick={() => handleShowImagePicker()}>
                                <FontAwesomeIcon icon={faImage} color="white" />
                              </Button>
                            )}
                          </ButtonGroup> :
                          <div></div>
                        }
                      </div>
                      <Card.Text>{adventure.record.description}</Card.Text>
                    </div>
                    <div className="card-row-spaced">
                      {canEditAdventure !== true ? <div></div> : inviteLink === undefined ?
                        <Button variant="primary" disabled={createInviteButtonDisabled}
                          onClick={createInviteLink}
                        >
                          <BusyElement normal="Create invite link"
                            busy="Creating invite link..." isBusy={createInviteButtonDisabled} />
                        </Button> :
                        <Link to={inviteLink}>Send this link to other players to invite them.</Link>
                      }
                      {canEditAdventure === true ?
                        <Button variant="danger" onClick={() => setShowDeleteAdventure(true)}>Delete adventure</Button> :
                        canLeaveAdventure === true ? <Button variant="warning" onClick={() => setShowLeaveAdventure(true)}>Leave adventure</Button> :
                          <div></div>
                      }
                    </div>
                  </div>
                </ImageCardContent>
              </Card>
            </Col>
            <Col>
              <Card className="h-100" bg="dark" text="white">
                <Card.Header className="card-header-spaced">
                  <div>{playersTitle}</div>
                  <div className="d-flex align-items-center gap-2">
                    {showShowBlockedToggle &&
                      <Button variant="secondary" onClick={toggleShowBlocked}>{showBlockedText}</Button>
                    }
                    <NetworkStatusBadge status={netStatus} isConnected={netConnected}
                      rttAverage={netRtt} reconnectCount={netReconnects} />
                  </div>
                </Card.Header>
                <PlayerInfoList ownerUid={ownerUid} players={players} tokens={[]}
                  presence={presence}
                  viewerCurrentMapId={viewerCurrentMapId}
                  showBlockedPlayers={showBlocked}
                  showBlockButtons={showBlockButtons}
                  blockPlayer={handleShowBlockPlayer}
                  unblockPlayer={handleShowUnblockPlayer} />
              </Card>
            </Col>
          </Row>
          : null
        }
        <Row className="mt-4">
          {myPlayer !== undefined ? (
            <Col>
              <h5>{myCharactersTitle}</h5>
              <Card className="mt-4" bg="dark" text="white">
                <Card.Header>
                  <Button variant="primary" onClick={handleCreateCharacter} disabled={createCharacterDisabled}>
                    New character
                  </Button>
                </Card.Header>
                <CharacterList canEdit={true} players={myPlayer} handleEdit={handleEditCharacter}
                  handleDelete={handleDeleteCharacter} itemClassName="Map-info-list-item" />
              </Card>
            </Col>
          ) : null}
          {showOtherCharacters ? (<Col>
            <h5>Other Characters</h5>
            <Card className="mt-4" bg="dark" text="white">
              <CharacterList players={otherPlayers} showPlayerNames={true} itemClassName="Map-info-list-item" />
            </Card>
          </Col>) : null}
        </Row>
        <Row className="mt-4">
          <Col>
            <h5>{mapsTitle}</h5>
            <MapCollection
              adventures={adventures}
              maps={maps}
              showNewMap={canCreateNewMap}
              deleteMap={mapDelete}
              pickImage={canPickImages ? handleShowImagePicker : undefined} />
          </Col>
        </Row>
      </Container>
      <AdventureModal
        description={editAdventureDescription}
        name={editAdventureName}
        show={showEditAdventure}
        handleClose={handleModalClose}
        handleSave={handleEditAdventureSave}
        setDescription={setEditAdventureDescription}
        setName={setEditAdventureName} />
      <CharacterEditorModal
        show={showEditCharacter}
        adventureId={adventureId}
        character={characterToEdit}
        handleClose={handleModalClose}
        handleImageDelete={handleShowImageDeletion}
        handleSave={handleCharacterSave} />
      <CharacterDeletionModal
        show={showDeleteCharacter}
        character={characterToEdit}
        handleClose={handleModalClose}
        handleDelete={handleCharacterDeletion} />
      <ImagePickerModal
        show={showImagePicker}
        handleClose={handleModalClose}
        handleDelete={handleShowImageDeletion}
        handleSave={handleImagePickerSave} />
      <ImageDeletionModal
        image={imageToDelete}
        show={showImageDeletion}
        handleClose={handleModalClose}
        handleDelete={handleImageDeletionSave} />
      <Modal show={showBlockPlayer} onHide={handleModalClose}>
        <Modal.Header>
          <Modal.Title>Block {playerToBlock?.playerName}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p>Do you really want to block {playerToBlock?.playerName}?  They will no longer be able to watch or join in with this adventure.</p>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={handleModalClose}>Cancel</Button>
          <Button variant="danger" onClick={() => handleBlockPlayerSave(false)}>
            Yes, block player!
          </Button>
        </Modal.Footer>
      </Modal>
      <Modal show={showUnblockPlayer} onHide={handleModalClose}>
        <Modal.Header>
          <Modal.Title>Unblock {playerToBlock?.playerName}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p>Do you really want to unblock {playerToBlock?.playerName}?  They will once again be able to watch or join in with this adventure.</p>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={handleModalClose}>Cancel</Button>
          <Button variant="success" onClick={() => handleBlockPlayerSave(true)}>
            Yes, unblock player!
          </Button>
        </Modal.Footer>
      </Modal>
      <Modal show={showDeleteAdventure} onHide={handleModalClose}>
        <Modal.Header>
          <Modal.Title>Delete adventure</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {canDeleteAdventure ? <p>Do you really want to delete this adventure?</p> :
          <p>Adventures with maps cannot be deleted.</p>}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={handleModalClose}>Cancel</Button>
          <Button disabled={cannotDeleteAdventure} variant="danger" onClick={handleDeleteAdventureSave}>
            Yes, delete adventure!
          </Button>
        </Modal.Footer>
      </Modal>
      <Modal show={showLeaveAdventure} onHide={handleModalClose}>
        <Modal.Header>
          <Modal.Title>Leave adventure</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p>You will no longer be able to see maps in or participate in this adventure.</p>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={handleModalClose}>Cancel</Button>
          <Button variant="danger" onClick={handleLeaveAdventureSave}>
            Yes, leave adventure!
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
}

function AdventurePage() {
  const { adventureId } = useParams<{ adventureId: string }>();
  return (
    <RequireLoggedIn>
      <Adventure adventureId={adventureId ?? ''} />
    </RequireLoggedIn>
  );
}

export default AdventurePage;