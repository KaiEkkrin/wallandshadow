import { useCallback, useContext, useState, useEffect, useMemo } from 'react';
import './App.css';

import { AnalyticsContext } from './components/AnalyticsContext';
import { FirebaseContext } from './components/FirebaseContext';
import Navigation from './components/Navigation';
import * as Policy from '@wallandshadow/shared';
import { ProfileContext } from './components/ProfileContext';
import { StatusContext } from './components/StatusContext';
import { useDocumentTitle } from './hooks/useDocumentTitle';

import { IUser } from '@wallandshadow/shared';

import Button from 'react-bootstrap/Button';
import Form from 'react-bootstrap/Form';
import Modal from 'react-bootstrap/Modal';
import Tab from 'react-bootstrap/Tab';
import Tabs from 'react-bootstrap/Tabs';

import { useNavigate, useLocation } from 'react-router-dom';
import { getPostLoginPath } from './utils/loginRedirect';
import { v7 as uuidv7 } from 'uuid';

interface ILoginMessageProps {
  isVisible: boolean;
  text: string;
}

function LoginFailedMessage(props: ILoginMessageProps) {
  return props.isVisible ? <p style={{ color: "red" }}>Login failed. {props.text}</p> : <div></div>;
}

interface INewUserFormProps {
  shown: boolean;
  initialTab: "new" | "existing";
  handleClose: () => void;
  handleSignIn: (email: string, password: string) => void;
  handleSignUp: (displayName: string, email: string, password: string) => void;
  handleGoogleSignUp: (displayName: string) => void;
  handleGoogleSignIn: () => void;
}

function EmailPasswordModal({ shown, initialTab, handleClose, handleSignIn, handleSignUp, handleGoogleSignUp, handleGoogleSignIn }: INewUserFormProps) {
  const { auth } = useContext(FirebaseContext);
  const { logError } = useContext(AnalyticsContext);

  const [key, setKey] = useState<"new" | "existing">("new");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordResetTarget, setPasswordResetTarget] = useState<string | undefined>(undefined);
  const [authMethod, setAuthMethod] = useState<'email' | 'google'>('email');

  // reset the password fields, auth method, and tab when the shown status changes
  useEffect(() => {
    if (shown === true) {
      setKey(initialTab);
      setPassword("");
      setConfirmPassword("");
      setPasswordResetTarget(undefined);
      setAuthMethod('email');
    }
  }, [shown, initialTab]);

  const signInDisabled = useMemo(() => {
    // For Google auth, only require display name for new users
    if (authMethod === 'google') {
      if (key === 'new') {
        return displayName.length === 0;
      }
      return false; // Existing users with Google don't need anything pre-filled
    }

    // For email/password auth, validate email and password
    if (!Policy.emailIsValid(email) || !Policy.passwordIsValid(password)) {
      return true;
    }

    if (key === 'new' && (displayName.length === 0 || confirmPassword !== password)) {
      return true;
    }

    return false;
  }, [authMethod, displayName, email, key, password, confirmPassword]);

  const signInText = useMemo(() => key === 'new' ? 'Sign up' : 'Sign in', [key]);

  const handleSave = useCallback(() => {
    if (authMethod === 'google') {
      if (key === 'new') {
        handleGoogleSignUp(displayName);
      } else {
        handleGoogleSignIn();
      }
    } else {
      if (key === 'new') {
        handleSignUp(displayName, email, password);
      } else {
        handleSignIn(email, password);
      }
    }
  }, [authMethod, displayName, email, key, password, handleSignIn, handleSignUp, handleGoogleSignUp, handleGoogleSignIn]);

  // The password reset helpers
  const handleResetPassword = useCallback(() => {
    const target = email; // just in case it changes during the async operation
    if (!Policy.emailIsValid(target)) {
      return;
    }

    auth?.sendPasswordResetEmail(target)
      .then(() => setPasswordResetTarget(target))
      .catch(e => logError("Error sending password reset email", e));
  }, [logError, email, auth, setPasswordResetTarget]);

  const passwordResetComponent = useMemo(() => {
    if (!Policy.emailIsValid(email)) {
      return (
        <Form.Text className="text-muted"></Form.Text>
      );
    } else if (passwordResetTarget === undefined) {
      return (
        <Form.Text className="text-muted">
          Forgot your password?  <Button variant="link" size="sm" onClick={handleResetPassword}>Send a password reset email.</Button>
        </Form.Text>
      );
    } else {
      return (
        <Form.Text className="text-muted">
          A password reset email was sent to {passwordResetTarget}.
        </Form.Text>
      );
    }
  }, [email, handleResetPassword, passwordResetTarget]);

  return (
    <Modal show={shown} onHide={handleClose}>
      <Modal.Header closeButton>
        <Modal.Title>Sign in to Wall &amp; Shadow</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <Tabs activeKey={key} onSelect={k => setKey((k as "new" | "existing") ?? "new")} id="signIn">
          <Tab eventKey="new" title="New user">
            <Form>
              <Form.Group>
                <Form.Label htmlFor="nameInput">Display name</Form.Label>
                <Form.Control id="nameInput" type="text" value={displayName}
                  onChange={e => setDisplayName(e.target.value)} />
                <Form.Text className="text-muted">
                  This is the name that will be shown to other users of Wall &amp; Shadow.
                </Form.Text>
              </Form.Group>
              <Form.Group>
                <Form.Label>Authentication method</Form.Label>
                <Form.Check
                  type="radio"
                  id="newUserEmailRadio"
                  name="newUserAuthMethod"
                  label="Email address and password"
                  checked={authMethod === 'email'}
                  onChange={() => setAuthMethod('email')}
                />
                <Form.Check
                  type="radio"
                  id="newUserGoogleRadio"
                  name="newUserAuthMethod"
                  label="Google account"
                  checked={authMethod === 'google'}
                  onChange={() => setAuthMethod('google')}
                />
              </Form.Group>
              {authMethod === 'email' && (
                <>
                  <Form.Group>
                    <Form.Label htmlFor="newEmailInput">Email address</Form.Label>
                    <Form.Control id="newEmailInput" type="text" value={email}
                      onChange={e => setEmail(e.target.value)} />
                    <Form.Text className="text-muted">
                      Other users of Wall &amp; Shadow will not see your email address.
                    </Form.Text>
                  </Form.Group>
                  <Form.Group>
                    <Form.Label htmlFor="newPasswordInput">Password</Form.Label>
                    <Form.Control id="newPasswordInput" type="password" value={password}
                      onChange={e => setPassword(e.target.value)} />
                    <Form.Text className="text-muted">
                      Your password must be at least 8 characters long and contain at least one letter and one number.
                    </Form.Text>
                  </Form.Group>
                  <Form.Group>
                    <Form.Label htmlFor="confirmPasswordInput">Confirm password</Form.Label>
                    <Form.Control id="confirmPasswordInput" type="password" value={confirmPassword}
                      onChange={e => setConfirmPassword(e.target.value)} />
                  </Form.Group>
                </>
              )}
            </Form>
          </Tab>
          <Tab eventKey="existing" title="Existing user">
            <Form>
              <Form.Group>
                <Form.Label>Authentication method</Form.Label>
                <Form.Check
                  type="radio"
                  id="existingUserEmailRadio"
                  name="existingUserAuthMethod"
                  label="Email address and password"
                  checked={authMethod === 'email'}
                  onChange={() => setAuthMethod('email')}
                />
                <Form.Check
                  type="radio"
                  id="existingUserGoogleRadio"
                  name="existingUserAuthMethod"
                  label="Google account"
                  checked={authMethod === 'google'}
                  onChange={() => setAuthMethod('google')}
                />
              </Form.Group>
              {authMethod === 'email' && (
                <>
                  <Form.Group>
                    <Form.Label htmlFor="emailInput">Email address</Form.Label>
                    <Form.Control id="emailInput" type="text" value={email}
                      onChange={e => setEmail(e.target.value)} />
                  </Form.Group>
                  <Form.Group>
                    <Form.Label htmlFor="passwordInput">Password</Form.Label>
                    <Form.Control id="passwordInput" type="password" value={password}
                      onChange={e => setPassword(e.target.value)} />
                    {passwordResetComponent}
                  </Form.Group>
                </>
              )}
            </Form>
          </Tab>
        </Tabs>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={handleClose}>Close</Button>
        <Button variant="primary" disabled={signInDisabled} onClick={handleSave}>{signInText}</Button>
      </Modal.Footer>
    </Modal>
  );
}

function Login() {
  const { auth, googleAuthProvider } = useContext(FirebaseContext);
  const { profile, expectNewUser, expectGoogleSignup } = useContext(ProfileContext);
  const { logError } = useContext(AnalyticsContext);
  const { toasts } = useContext(StatusContext);
  const navigate = useNavigate();

  useDocumentTitle('Login');

  const [showEmailForm, setShowEmailForm] = useState(false);
  const [initialTab, setInitialTab] = useState<"new" | "existing">("new");
  const [loginFailedVisible, setLoginFailedVisible] = useState(false);
  const [loginFailedText, setLoginFailedText] = useState("");

  // Reset those message statuses as appropriate
  useEffect(() => {
    if (profile !== undefined) {
      setLoginFailedVisible(false);
    }
  }, [profile, setLoginFailedVisible]);

  const handleLoginResult = useCallback(async (user: IUser | null | undefined, sendEmailVerification?: boolean | undefined) => {
    if (user === undefined) {
      throw Error("Undefined auth context or user");
    }

    if (user === null) {
      setLoginFailedVisible(true);
      return false;
    }

    if (sendEmailVerification === true) {
      if (!user.emailVerified) {
        await user.sendEmailVerification();
        toasts.next({
          id: uuidv7(),
          record: { title: "Email/password login", message: "A verification email has been sent to " + user.email }
        });
      }
    }

    return true;
  }, [setLoginFailedVisible, toasts]);

  const location = useLocation();
  const finishLogin = useCallback((success: boolean) => {
    if (success) {
      navigate(getPostLoginPath(location.state?.from), { replace: true });
    }
  }, [navigate, location.state?.from]);

  const handleLoginError = useCallback((e: unknown) => {
    setLoginFailedVisible(true);
    setLoginFailedText(e instanceof Error ? e.message : String(e));
    logError("Login failed", e);
  }, [logError, setLoginFailedVisible]);

  const handleEmailFormClose = useCallback(() => {
    setShowEmailForm(false);
  }, [setShowEmailForm]);

  const handleEmailFormSignUp = useCallback((displayName: string, email: string, password: string) => {
    setShowEmailForm(false);
    setLoginFailedVisible(false);
    expectNewUser?.(email, displayName);
    auth?.createUserWithEmailAndPassword(email, password, displayName)
      .then(u => handleLoginResult(u, true))
      .then(finishLogin)
      .catch(handleLoginError);
  }, [auth, expectNewUser, finishLogin, handleLoginError, handleLoginResult, setLoginFailedVisible, setShowEmailForm]);

  const handleEmailFormSignIn = useCallback((email: string, password: string) => {
    setShowEmailForm(false);
    setLoginFailedVisible(false);
    auth?.signInWithEmailAndPassword(email, password)
      .then(handleLoginResult)
      .then(finishLogin)
      .catch(handleLoginError);
  }, [auth, finishLogin, handleLoginError, handleLoginResult, setLoginFailedVisible, setShowEmailForm]);

  const handleGoogleSignUp = useCallback((displayName: string) => {
    setShowEmailForm(false);
    setLoginFailedVisible(false);
    if (googleAuthProvider !== undefined) {
      // Register the display name before the popup opens so that the profile context
      // can apply it when the auth state change fires (which happens before our .then()
      // callback runs, so we can't rely on calling expectNewUser inside .then()).
      expectGoogleSignup?.(displayName);
      auth?.signInWithPopup(googleAuthProvider)
        .then(async (user) => {
          // Also update the Firebase Auth profile so the display name is consistent
          if (user && displayName) {
            await user.updateProfile({ displayName });
          }
          return user;
        })
        .then(handleLoginResult)
        .then(finishLogin)
        .catch(handleLoginError);
    }
  }, [auth, expectGoogleSignup, googleAuthProvider, finishLogin, handleLoginError, handleLoginResult, setLoginFailedVisible, setShowEmailForm]);

  const handleGoogleSignIn = useCallback(() => {
    setShowEmailForm(false);
    setLoginFailedVisible(false);
    if (googleAuthProvider !== undefined) {
      auth?.signInWithPopup(googleAuthProvider)
        .then(handleLoginResult)
        .then(finishLogin)
        .catch(handleLoginError);
    }
  }, [finishLogin, auth, googleAuthProvider, handleLoginError, handleLoginResult, setLoginFailedVisible, setShowEmailForm]);

  const handleSignUpClick = useCallback(() => {
    setInitialTab("new");
    setShowEmailForm(true);
  }, []);

  const handleLoginClick = useCallback(() => {
    setInitialTab("existing");
    setShowEmailForm(true);
  }, []);

  return (
    <div>
      <Navigation />
      <header className="App-header">
        <div className="App-login-text">
          Sign in to get started with Wall &amp; Shadow.
        </div>
        <Button onClick={handleSignUpClick}>Sign up new user</Button>
        <Button className="mt-2" onClick={handleLoginClick}>Login existing user</Button>
        <LoginFailedMessage isVisible={loginFailedVisible} text={loginFailedText} />
      </header>
      <EmailPasswordModal shown={showEmailForm} initialTab={initialTab} handleClose={handleEmailFormClose}
        handleSignIn={handleEmailFormSignIn}
        handleSignUp={handleEmailFormSignUp}
        handleGoogleSignUp={handleGoogleSignUp}
        handleGoogleSignIn={handleGoogleSignIn} />
    </div>
  );
}

export default Login;