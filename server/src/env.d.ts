// The game modules the server bundles mention Vite's import.meta.env in browser-only code paths.
interface ImportMetaEnv { readonly BASE_URL: string; readonly DEV: boolean; readonly PROD: boolean; readonly MODE: string; readonly [key: string]: any }
interface ImportMeta { readonly env: ImportMetaEnv }
