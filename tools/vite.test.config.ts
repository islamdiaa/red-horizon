// Stable dev server for screenshot testing: no HMR, no file watching.
import { defineConfig } from 'vite';
export default defineConfig({
  root: new URL('..', import.meta.url).pathname,
  server: { port: 5181, strictPort: true, hmr: false, watch: null },
  optimizeDeps: { include: ['three', 'three/examples/jsm/postprocessing/GTAOPass.js', 'three/examples/jsm/postprocessing/EffectComposer.js'] },
});
