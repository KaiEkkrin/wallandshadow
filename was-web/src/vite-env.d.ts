/// <reference types="vite/client" />

// Build-time constants injected by Vite
declare const __GIT_COMMIT__: string;
declare const __HONO_WS_BASE__: string;

// Environment-specific type definitions
interface ImportMetaEnv {
  readonly VITE_DEPLOY_ENV?: 'production' | 'test' | 'development';
  readonly VITE_HONO_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Third-party licence notices, generated at build time by the
// `thirdPartyNotices` plugin in vite-plugins/third-party-notices.ts.
declare module 'virtual:third-party-notices' {
  const notices: string;
  export default notices;
}
