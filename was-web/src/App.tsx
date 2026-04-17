import './App.css';

import { lazy, Suspense, useEffect } from 'react';

import AdventureContextProvider from './components/AdventureContextProvider';
import HonoContextProvider from './components/HonoContextProvider';
import Home from './Home';
import MapContextProvider from './components/MapContextProvider';
import ProfileContextProvider from './components/ProfileContextProvider';
import RootRedirect from './RootRedirect';
import Routing from './components/Routing';
import { IRoutingProps } from './components/interfaces';
import Status from './components/Status';
import StatusContextProvider from './components/StatusContextProvider';
import Throbber from './components/Throbber';
import ToastCollection from './components/ToastCollection';
import VersionBadge from './components/VersionBadge';
import VersionChecker from './components/VersionChecker';
import ChunkErrorHandler from './components/ChunkErrorHandler';
import { getEnvironmentColors } from './utils/environment';

import { Route, Routes } from 'react-router-dom';

// Lazy-loaded route components for code splitting
const AdventurePage = lazy(() => import('./Adventure'));
const All = lazy(() => import('./All'));
const InvitePage = lazy(() => import('./Invite'));
const Login = lazy(() => import('./Login'));
const MapPage = lazy(() => import('./Map'));
const OidcCallback = lazy(() => import('./OidcCallback'));
const Shared = lazy(() => import('./Shared'));

function App(props: IRoutingProps) {
  // Set environment-specific CSS custom properties on mount
  useEffect(() => {
    const colors = getEnvironmentColors();
    document.documentElement.style.setProperty('--env-background', colors.background);
    document.documentElement.style.setProperty('--env-navbar-bg', colors.navbar);
  }, []);

  return (
    <div className="App">
      <HonoContextProvider>
        <ProfileContextProvider>
          <StatusContextProvider>
            <Routing {...props}>
              <AdventureContextProvider>
                <MapContextProvider>
                  <Suspense fallback={<Throbber />}>
                    <Routes>
                      <Route path="/" element={<RootRedirect />} />
                      <Route path="/app" element={<Home />} />
                      <Route path="/all" element={<All />} />
                      <Route path="/adventure/:adventureId" element={<AdventurePage />} />
                      <Route path="/adventure/:adventureId/map/:mapId" element={<MapPage />} />
                      <Route path="/invite/:inviteId" element={<InvitePage />} />
                      <Route path="/auth/callback" element={<OidcCallback />} />
                      <Route path="/login" element={<Login />} />
                      <Route path="/shared" element={<Shared />} />
                    </Routes>
                  </Suspense>
                </MapContextProvider>
              </AdventureContextProvider>
            </Routing>
            <Status />
            <ToastCollection />
            <ChunkErrorHandler />
            <VersionChecker />
            <VersionBadge />
          </StatusContextProvider>
        </ProfileContextProvider>
      </HonoContextProvider>
    </div>
  );
}

export default App;