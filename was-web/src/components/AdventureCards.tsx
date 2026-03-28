import { useMemo } from 'react';
import * as React from 'react';
import '../App.css';

import ExpansionToggle from './ExpansionToggle';

import { IAdventureSummary } from '../data/profile';

import Accordion from 'react-bootstrap/Accordion';
import Button from 'react-bootstrap/Button';
import Card from 'react-bootstrap/Card';

import { LinkContainer } from 'react-router-bootstrap';
import useMeasure from 'react-use-measure';
import ImageCardContent from './ImageCardContent';

interface IAdventureCardProps {
  adventure: IAdventureSummary;
  collapsing: boolean;
}

const AdventureCard = ({ adventure, collapsing }: IAdventureCardProps) => {
  const content = useMemo(
    () => (
      <React.Fragment>
        <Card.Subtitle>By {adventure.ownerName}</Card.Subtitle>
        <Card.Text>{adventure.description}</Card.Text>
        <LinkContainer to={"/adventure/" + adventure.id}>
          <Card.Link>Open adventure</Card.Link>
        </LinkContainer>
      </React.Fragment>
    ),
    [adventure]
  );

  if (collapsing) {
    // TODO #108 I don't know how to include an image in a collapsing card for now
    return (
      <Card bg="dark" text="white">
        <ExpansionToggle direction="down" eventKey={adventure.id}>{adventure.name}</ExpansionToggle>
        <Accordion.Collapse eventKey={adventure.id}>
          <Card.Body>
            {content}
          </Card.Body>
        </Accordion.Collapse>
      </Card>
    );
  } else {
    return (
      <div className="col">
        <Card className="h-100" bg="dark" text="white">
          <ImageCardContent altName={adventure.name} imagePath={adventure.imagePath}>
            <Card.Title className="h5">{adventure.name}</Card.Title>
            {content}
          </ImageCardContent>
        </Card>
      </div>
    );
  }
}

interface IAdventureCardsProps {
  showNewAdventureCard: boolean;
  handleCreate: () => void;
  adventures: IAdventureSummary[];
}

const AdventureCardsCollapsing = ({ showNewAdventureCard, handleCreate, adventures }: IAdventureCardsProps) => {
  const cards = useMemo(() => {
    const cardList = [...adventures.map(v => (
      <AdventureCard key={v.id} adventure={v} collapsing={true} />
    ))];

    if (showNewAdventureCard) {
      cardList.splice(0, 0, (
        <Card bg="dark" text="white" key="new">
          <Card.Header>
            <Button onClick={handleCreate}>New adventure</Button>
          </Card.Header>
        </Card>
      ));
    }

    return cardList;
  }, [adventures, handleCreate, showNewAdventureCard]);

  return (
    <Accordion className="mt-4">
      {cards}
    </Accordion>
  );
}

const AdventureCardsLarge = ({ showNewAdventureCard, handleCreate, adventures }: IAdventureCardsProps) => {
  const cards = useMemo(() => {
    const cardList = [...adventures.map(v => (
      <AdventureCard key={v.id} adventure={v} collapsing={false} />
    ))];

    if (showNewAdventureCard) {
      cardList.splice(0, 0, (
        <div className="col" key="new">
          <Card className="h-100" bg="dark" text="white">
            <Card.Body>
              <Button onClick={handleCreate}>New adventure</Button>
            </Card.Body>
          </Card>
        </div>
      ));
    }

    return cardList;
  }, [showNewAdventureCard, handleCreate, adventures]);

  return (
    <div className="row row-cols-1 row-cols-md-2 row-cols-lg-3 g-4 mt-2">
      {cards}
    </div>
  );
}

function AdventureCards(props: IAdventureCardsProps) {
  const [measureRef, bounds] = useMeasure();
  const cards = useMemo(
    () => bounds.width === 0 || bounds.width <= 400 ? (
      <AdventureCardsCollapsing {...props} />
    ) : (
      <AdventureCardsLarge {...props} />
    ), [props, bounds.width]
  );

  return (
    <div ref={measureRef}>
      {cards}
    </div>
  );
}

export default AdventureCards;
