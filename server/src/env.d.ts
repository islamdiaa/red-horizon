// The game modules the server bundles mention Vite's import.meta.env in browser-only code paths.
interface ImportMetaEnv { readonly BASE_URL: string; readonly DEV: boolean; readonly PROD: boolean; readonly MODE: string; readonly [key: string]: any }
// src/i18n/core.ts calls Vite's import.meta.glob for the locale catalogues; outside Vite it is guarded by try/catch.
interface ImportMeta {
  readonly env: ImportMetaEnv;
  glob<T = unknown>(pattern: string): Record<string, () => Promise<T>>;
}
