/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Firebase web config — NEVER put AI provider keys here (§11, §13). */
  readonly VITE_FIREBASE_API_KEY?: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string;
  readonly VITE_FIREBASE_PROJECT_ID?: string;
  readonly VITE_FIREBASE_STORAGE_BUCKET?: string;
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID?: string;
  readonly VITE_FIREBASE_APP_ID?: string;
  /** Base URL of the deployed Cloud Functions (AI proxy + backup). */
  readonly VITE_FUNCTIONS_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
