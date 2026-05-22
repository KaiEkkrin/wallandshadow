import { useContext, useMemo, useCallback, useState } from 'react';
import * as React from 'react';

import './Navigation.css';

import { AuthContext } from './AuthContext';
import DeleteAccountModal from './DeleteAccountModal';
import { logError } from '../services/consoleLogger';
import { ProfileContext } from './ProfileContext';
import { UserContext } from './UserContext';

import Button from 'react-bootstrap/Button';
import ButtonGroup from 'react-bootstrap/ButtonGroup';
import Form from 'react-bootstrap/Form';
import Modal from 'react-bootstrap/Modal';
import Nav from 'react-bootstrap/Nav';
import Navbar from 'react-bootstrap/Navbar';

import useMeasure from 'react-use-measure';
import { LinkContainer } from 'react-router-bootstrap';

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCheck } from '@fortawesome/free-solid-svg-icons';

function NavPageLinks() {
  const userContext = useContext(UserContext);
  const loggedInItemsHidden = useMemo(
    () => userContext.user === null || userContext.user === undefined,
    [userContext.user]
  );

  return (
    <Nav className="me-auto">
      <LinkContainer to="/app">
        <Nav.Link>Home</Nav.Link>
      </LinkContainer>
      <LinkContainer to="/about">
        <Nav.Link>About</Nav.Link>
      </LinkContainer>
      {!loggedInItemsHidden && (
        <LinkContainer to="/all">
          <Nav.Link>My adventures</Nav.Link>
        </LinkContainer>
      )}
      {!loggedInItemsHidden && (
        <LinkContainer to="/shared">
          <Nav.Link>Shared with me</Nav.Link>
        </LinkContainer>
      )}
    </Nav>
  );
}

function Avatar(props: { children?: React.ReactNode }) {
  const { user } = useContext(UserContext);
  const emailMd5 = user?.emailMd5;
  const profileImgUrl = emailMd5
    ? `https://robohash.org/${emailMd5}?gravatar=hashed&set=set2&size=30x30`
    : undefined;
  const title = user?.emailVerified === true
    ? `${user.displayName} (Verified)`
    : `${user?.displayName} (Not verified)`;

  return (
    <div style={{display: "inline-flex", position: "relative", alignItems: "center"}} title={title}>
      <div style={{position: "absolute", backgroundColor: "rgba(0,0,0,1)",
                   borderRadius: "15px", width: "30px", height: "30px"}}></div>
      {profileImgUrl && (
        <div style={{position: "absolute", backgroundImage: `url("${profileImgUrl}")`,
                     backgroundSize: "contain", borderRadius: "15px",
                     width: "30px", height: "30px"}}></div>
      )}
      <div style={{paddingLeft: "30px"}}>
        &nbsp;
        {props.children}
      </div>
    </div>
  );
}

function NavLogin() {
  const { auth } = useContext(AuthContext);
  const { api, user } = useContext(UserContext);
  const { profile } = useContext(ProfileContext);

  const isOidcUser = useMemo(
    () => user?.providerId === 'oidc',
    [user]
  );

  const displayName = useMemo(
    () => profile?.name ?? user?.displayName ?? "",
    [profile, user]
  );

  const handleSignOut = useCallback(() => {
    auth?.signOut()
      .catch(e => logError("Error signing out: ", e));
  }, [auth]);

  // The profile editor:
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [editDisplayName, setEditDisplayName] = useState("");
  const [showDeleteAccount, setShowDeleteAccount] = useState(false);

  const handleEditProfile = useCallback(() => {
    setEditDisplayName(displayName);
    setShowEditProfile(true);
  }, [displayName, setEditDisplayName, setShowEditProfile]);

  const handleModalClose = useCallback(() => {
    setShowEditProfile(false);
  }, [setShowEditProfile]);

  const handleOpenDeleteAccount = useCallback(() => {
    setShowEditProfile(false);
    setShowDeleteAccount(true);
  }, []);

  const handleCloseDeleteAccount = useCallback(() => {
    setShowDeleteAccount(false);
  }, []);

  const handleSaveProfile = useCallback(() => {
    handleModalClose();
    if (api === undefined) {
      return;
    }

    async function doUpdateProfile() {
      if (!user || !api) {
        return;
      }

      await api.updateMe({ name: editDisplayName });
      console.debug(`successfully updated profile of ${editDisplayName}`);
    }

    doUpdateProfile().catch(e => logError("error updating profile", e));
  }, [editDisplayName, handleModalClose, api, user]);

  const saveProfileDisabled = useMemo(
    () => editDisplayName.length === 0 || isOidcUser,
    [editDisplayName, isOidcUser]
  );

  // We show a verified icon if the user's email is verified
  const verifiedIcon = useMemo(() => {
    if (user?.emailVerified === true) {
      return (
        <FontAwesomeIcon className="ms-1" icon={faCheck} color="white" />
      );
    } else {
      return undefined;
    }
  }, [user]);

  return user ? (
    <div className="ms-2 me-2">
      <div className="d-flex">
        <ButtonGroup>
          <Button variant="primary" onClick={handleEditProfile}>
            <Avatar>
              {displayName}{verifiedIcon}
            </Avatar>
          </Button>
          <Button variant="outline-primary" onClick={handleSignOut}>Log out</Button>
        </ButtonGroup>
      </div>
      <Modal show={showEditProfile} onHide={handleModalClose}>
        <Modal.Header closeButton>
          <Modal.Title>User profile settings</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form>
            <Form.Group>
              <Form.Label htmlFor="nameInput">Display name</Form.Label>
              <Form.Control id="nameInput" type="text" maxLength={30} value={editDisplayName}
                disabled={isOidcUser}
                onChange={e => setEditDisplayName(e.target.value)} />
              <Form.Text className="text-muted">
                {isOidcUser
                  ? 'Your display name is managed by your login provider. To change it, update your name there.'
                  : 'This is the name that will be shown to other users of Wall & Shadow.'}
              </Form.Text>
            </Form.Group>
            <Form.Group>
              <Form.Label htmlFor="emailInput">Email address</Form.Label>
              <Form.Control id="emailInput" type="text" maxLength={50} value={profile?.email} disabled={true} />
              <Form.Text className="text-muted">
                This is the email address associated with your Wall &amp; Shadow account. It will not be shown to other users.
              </Form.Text>
            </Form.Group>
          </Form>
          <hr />
          <h6 className="text-danger">Danger zone</h6>
          <p className="text-muted small mb-2">
            Permanently delete your account and everything you own. This cannot be undone.
          </p>
          <Button variant="outline-danger" size="sm" onClick={handleOpenDeleteAccount}>
            Delete account…
          </Button>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={handleModalClose}>Close</Button>
          <Button variant="primary" disabled={saveProfileDisabled} onClick={handleSaveProfile}>Save profile</Button>
        </Modal.Footer>
      </Modal>
      <DeleteAccountModal
        show={showDeleteAccount}
        displayName={displayName}
        api={api}
        auth={auth}
        handleClose={handleCloseDeleteAccount}
      />
    </div>
  ) : (
    <div className="ms-2 me-2">
      <LinkContainer to="/login">
        <Nav.Link>Sign up/Login</Nav.Link>
      </LinkContainer>
    </div>
  );
}

interface INavigationProps {
  children?: React.ReactNode | undefined;
}

function Navigation(props: INavigationProps) {
  const [expanded, setExpanded] = useState(false);
  const [measureRef, bounds] = useMeasure();

  // We don't want the children causing the nav bar to spill into extra lines, because those can
  // easily devour the available map space on a small screen:
  const childrenHidden = useMemo(
    () => expanded === false && bounds.width > 0 && bounds.width < 700,
    [expanded, bounds.width]
  );

  return (
    <div ref={measureRef}>
      <Navbar
        expand="lg"
        sticky="top"
        onToggle={setExpanded}
        variant="dark"
        style={{ backgroundColor: 'var(--env-navbar-bg)' }}
      >
        <LinkContainer to="/app">
          <Navbar.Brand className="Navigation-brand me-3">
            <img src="/logo32.svg" alt="logo" height={32} className="me-2" />
            <div className="Navigation-brand-text">
              <div className="Navigation-brand-main">
                wall &amp; shadow
              </div>
              <div className="Navigation-brand-shadow">
                wall &amp; shadow
              </div>
            </div>
          </Navbar.Brand>
        </LinkContainer>
        <Navbar.Toggle aria-controls="basic-navbar-nav" />
        <Navbar.Collapse id="basic-navbar-nav">
          <NavPageLinks />
          <Nav className="mx-auto" hidden={childrenHidden}>
            <Navbar.Text>{props.children}</Navbar.Text>
          </Nav>
          <Nav className="ms-auto">
            <NavLogin />
          </Nav>
        </Navbar.Collapse>
      </Navbar>
    </div>
  );
}

export default Navigation;
