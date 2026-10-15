// Stable dev server for screenshot testing: no HMR, no file watching (restart it after edits).
import { defineConfig, mergeConfig } from 'vite';
import base from '../vite.config';
export default mergeConfig(base, defineConfig({
  root: new URL('..', import.meta.url).pathname,
  // watch nothing (mergeConfig ignores null): tests run against a fixed tree, restart after edits
  server: { port: 5181, strictPort: true, hmr: false, watch: { ignored: ['**/*'] } },
}));
