import { Fragment, useContext, useMemo } from 'react';
import '../App.css';

import ExpansionToggle from './ExpansionToggle';
import { UserContext } from './UserContext';
import { IMapSummary } from '../data/adventure';
import { IAdventureSummary } from '../data/profile';

import Accordion from 'react-bootstrap/Accordion';
import Button from 'react-bootstrap/Button';
import ButtonGroup from 'react-bootstrap/ButtonGroup';
import Card from 'react-bootstrap/Card';
import OverlayTrigger from 'react-bootstrap/OverlayTrigger';
import Tooltip from 'react-bootstrap/Tooltip';

import useMeasure from 'react-use-measure';
import { LinkContainer } from 'react-router-bootstrap';

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCopy, faImage, faTimes } from '@fortawesome/free-solid-svg-icons';
import ImageCardContent from './ImageCardContent';

interface INewMapCardProps {
  collapsing: boolean;
  handleNewMapClick: (() => void) | undefined;
}

function NewMapCard({ collapsing, handleNewMapClick }: INewMapCardProps) {
  return collapsing ? (
    <Card bg="dark" text="white">
      <Card.Header>
        <Button onClick={() => handleNewMapClick?.()}>New map</Button>
      </Card.Header>
    </Card>
  ) : (
    <div className="col">
      <Card className="h-100" bg="dark" text="white">
        <Card.Body>
          <Button onClick={() => handleNewMapClick?.()}>New map</Button>
        </Card.Body>
      </Card>
    </div>
  );
}

interface IMapCardProps {
  collapsing: boolean;
  adventures: IAdventureSummary[];
  map: IMapSummary;
  cloneMap: ((map: IMapSummary) => void) | undefined;
  deleteMap: ((map: IMapSummary) => void) | undefined;
  pickImage: ((map: IMapSummary) => void) | undefined;
}

function MapCard({ collapsing, adventures, map, cloneMap, deleteMap, pickImage }: IMapCardProps) {
  const userContext = useContext(UserContext);

  // Create various buttons and thingies

  const cloneMapButton = useMemo(() => {
    const key = "clone-" + map.id;
    return cloneMap === undefined ? undefined : (
      <OverlayTrigger key={key} placement="top" overlay={
        <Tooltip id={key + "-tooltip"}>Clone map</Tooltip>
      }>
        <Button variant="secondary" onClick={() => cloneMap?.(map)}>
          <FontAwesomeIcon icon={faCopy} color="white" />
        </Button>
      </OverlayTrigger>
    );
  }, [cloneMap, map]);

  const deleteMapButton = useMemo(() => {
    const key = "delete-" + map.id;
    return deleteMap === undefined ? undefined : (
      <OverlayTrigger key={key} placement="top" overlay={
        <Tooltip id={key + "-tooltip"}>Delete map</Tooltip>
      }>
        <Button variant="danger" onClick={() => deleteMap?.(map)}>
          <FontAwesomeIcon icon={faTimes} color="white" />
        </Button>
      </OverlayTrigger>
    );
  }, [deleteMap, map]);

  const pickImageButton = useMemo(() => {
    const key = "pick-" + map.id;
    return pickImage === undefined ? undefined : (
      <OverlayTrigger key={key} placement="top" overlay={
        <Tooltip id={key + "-tooltip"}>Pick an image</Tooltip>
      }>
        <Button variant="secondary" onClick={() => pickImage?.(map)}>
          <FontAwesomeIcon icon={faImage} color="white" />
        </Button>
      </OverlayTrigger>
    );
  }, [pickImage, map]);

  const manageButtons = useMemo(() => {
    if (adventures.find(a => a.id === map.adventureId)?.owner !== userContext.user?.uid) {
      // We don't own this adventure, so we can't manage the map
      return undefined;
    }

    const buttons = [pickImageButton, cloneMapButton, deleteMapButton]
      .filter(b => b !== undefined);
    return buttons.length === 0 ? undefined : (
      <ButtonGroup>
        {buttons}
      </ButtonGroup>
    );
  }, [cloneMapButton, deleteMapButton, pickImageButton, adventures, map, userContext]);

  const content = useMemo(
    () => (
      <Fragment>
        <Card.Subtitle className="text-muted">{map.ty} map</Card.Subtitle>
        <Card.Text>{map.description}</Card.Text>
        <div className="card-row-spaced">
          <LinkContainer to={"/adventure/" + map.adventureId + "/map/" + map.id}>
            <Card.Link>Open map</Card.Link>
          </LinkContainer>
          {manageButtons}
        </div>
      </Fragment>
    ),
    [map, manageButtons]
  );

  return collapsing ? (
    <Card bg="dark" text="white" key={map.id}>
      <ExpansionToggle direction="down" eventKey={map.id}>{map.name}</ExpansionToggle>
      <Accordion.Collapse eventKey={map.id}>
        <Card.Body>
          {content}
        </Card.Body>
      </Accordion.Collapse>
    </Card>
  ) : (
    <div className="col" key={map.id}>
      <Card className="h-100" bg="dark" text="white">
        <ImageCardContent altName={map.name} imagePath={map.imagePath}>
          <Card.Title>{map.name}</Card.Title>
          {content}
        </ImageCardContent>
      </Card>
    </div>
  );
}

export interface IMapCardsProps {
  showNewMapCard: boolean;
  adventures: IAdventureSummary[];
  maps: IMapSummary[];
  createMap: (() => void) | undefined;
  cloneMap: ((map: IMapSummary) => void) | undefined;
  deleteMap: ((map: IMapSummary) => void) | undefined;
  pickImage: ((map: IMapSummary) => void) | undefined;
}

function MapCards(props: IMapCardsProps) {
  const [measureRef, bounds] = useMeasure();
  const collapsing = useMemo(() => bounds.width === 0 || bounds.width <= 400, [bounds.width]);

  // don't offer the option to clone a map if we wouldn't offer the option of a new map
  const cloneMap = useMemo(() => props.showNewMapCard ? props.cloneMap : undefined, [props]);
  const cards = useMemo(() => {
    const cardList = [...props.maps.map(v => (
      <MapCard collapsing={collapsing} key={v.id} adventures={props.adventures} map={v}
        cloneMap={cloneMap} deleteMap={props.deleteMap} pickImage={props.pickImage} />
    ))];

    if (props.showNewMapCard && props.createMap !== undefined) {
      cardList.splice(0, 0, (
        <NewMapCard collapsing={collapsing} key="new" handleNewMapClick={props.createMap} />
      ));
    }

    return collapsing ? (
      <Accordion className="mt-4">
        {cardList}
      </Accordion>
    ) : (
      <div className="row row-cols-1 row-cols-md-2 row-cols-lg-3 g-4 mt-2">
        {cardList}
      </div>
    );
  }, [props, cloneMap, collapsing]);

  return (
    <div ref={measureRef}>
      {cards}
    </div>
  );
}

export default MapCards;