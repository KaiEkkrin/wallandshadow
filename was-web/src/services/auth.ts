import { IAuth, IAuthProvider, IUser } from "./interfaces";

import {
  Auth,
  User as FirebaseUser,
  AuthProvider,
  GoogleAuthProvider,
  EmailAuthProvider,
  createUserWithEmailAndPassword as createUserWithEmailAndPasswordFn,
  signInWithEmailAndPassword as signInWithEmailAndPasswordFn,
  signInWithPopup as signInWithPopupFn,
  signOut as signOutFn,
  onAuthStateChanged as onAuthStateChangedFn,
  fetchSignInMethodsForEmail as fetchSignInMethodsForEmailFn,
  sendPasswordResetEmail as sendPasswordResetEmailFn,
  reauthenticateWithCredential,
  updatePassword as updatePasswordFn,
  updateProfile as updateProfileFn,
  sendEmailVerification as sendEmailVerificationFn
} from 'firebase/auth';

import md5 from 'blueimp-md5';

function createUser(user: FirebaseUser | null) {
  return user === null ? null : new User(user);
}

// Wraps the real Firebase auth service and the providers we recognise
// into our IAuth abstraction.

export class FirebaseAuth implements IAuth {
  private readonly _auth: Auth;

  constructor(auth: Auth) {
    this._auth = auth;
  }

  async createUserWithEmailAndPassword(email: string, password: string, displayName: string) {
    const credential = await createUserWithEmailAndPasswordFn(this._auth, email, password);
    const user = createUser(credential.user);
    if (user) {
      await user.updateProfile({ displayName: displayName });
    }

    return user;
  }

  fetchSignInMethodsForEmail(email: string) {
    return fetchSignInMethodsForEmailFn(this._auth, email);
  }

  sendPasswordResetEmail(email: string) {
    return sendPasswordResetEmailFn(this._auth, email);
  }

  async signInWithEmailAndPassword(email: string, password: string) {
    const credential = await signInWithEmailAndPasswordFn(this._auth, email, password);
    return createUser(credential.user);
  }

  async signInWithPopup(provider: IAuthProvider | undefined) {
    if (provider instanceof PopupAuthProviderWrapper) {
      const credential = await signInWithPopupFn(this._auth, provider.provider);
      return createUser(credential.user);
    }

    throw Error("Incompatible auth provider");
  }

  signOut() {
    return signOutFn(this._auth);
  }

  onAuthStateChanged(onNext: (user: IUser | null) => void, onError?: ((e: Error) => void) | undefined) {
    return onAuthStateChangedFn(
      this._auth,
      u => onNext(createUser(u)),
      e => onError?.(new Error(e.message))
    );
  }
}

class PopupAuthProviderWrapper implements IAuthProvider {
  private readonly _provider: AuthProvider;

  constructor(provider: AuthProvider) {
    this._provider = provider;
  }

  get provider(): AuthProvider {
    return this._provider;
  }
}

export class User implements IUser {
  private readonly _user: FirebaseUser;
  private readonly _userExtra: { emailMd5: string | null };

  constructor(user: FirebaseUser) {
    this._user = user;
    const emailMd5 = (this._user.email === null) ? null : md5(this._user.email);
    this._userExtra = {
      emailMd5: emailMd5
    };
  }

  get displayName() { return this._user.displayName; }
  get email() { return this._user.email; }
  get emailMd5() { return this._userExtra.emailMd5; }
  get emailVerified() { return this._user.emailVerified; }
  get providerId() { return this._user.providerId; }
  get uid() { return this._user.uid; }

  async changePassword(oldPassword: string, newPassword: string) {
    if (this._user.email === null) {
      return;
    }

    // We always re-authenticate first to make sure we're not stale
    const credential = EmailAuthProvider.credential(this._user.email, oldPassword);
    const updated = await reauthenticateWithCredential(this._user, credential);

    if (updated.user === null) {
      throw Error("Unable to reauthenticate (wrong password?)");
    }

    await updatePasswordFn(updated.user, newPassword);
  }

  sendEmailVerification() {
    return sendEmailVerificationFn(this._user);
  }

  updateProfile(p: { displayName?: string | null; photoURL?: string | null }) {
    return updateProfileFn(this._user, p);
  }
}

export const googleAuthProviderWrapper = new PopupAuthProviderWrapper(new GoogleAuthProvider());