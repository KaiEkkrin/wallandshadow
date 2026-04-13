/// <reference types="vite/client" />

// Build-time constants injected by Vite
declare const __GIT_COMMIT__: string;
declare const __HONO_WS_BASE__: string;

// Environment-specific type definitions
interface ImportMetaEnv {
  readonly VITE_DEPLOY_ENV?: 'production' | 'test' | 'development';
  readonly VITE_BACKEND?: 'firebase' | 'hono';
  readonly VITE_HONO_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
