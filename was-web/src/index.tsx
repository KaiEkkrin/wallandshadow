import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import * as serviceWorker from './serviceWorker';

import 'bootstrap/dist/css/bootstrap.min.css';

// Self-hosted brand display font (SIL OFL 1.1) — used by the nav-bar logo.
// Self-hosting keeps it out of Google's CDN and under the build-time licence
// notice generator.
import '@fontsource/princess-sofia';

// Delete the static banner made to appease non-React-aware search engines
const staticBanner = document.getElementById('static_banner');
staticBanner?.remove();

const container = document.getElementById('root');
if (!container) throw new Error('Root element not found');

const root = createRoot(container);
root.render(
  <StrictMode>
    <App />
  </StrictMode>
);

// If you want your app to work offline and load faster, you can change
// unregister() to register() below. Note this comes with some pitfalls.
// Learn more about service workers: https://bit.ly/CRA-PWA
serviceWorker.unregister();
