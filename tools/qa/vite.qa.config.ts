// QA dev server: stable (no HMR, no watching) on port 5192.
import { defineConfig } from 'vite';
export default defineConfig({
  root: new URL('../..', import.meta.url).pathname,
  server: { port: 5192, strictPort: true, hmr: false, watch: null },
  optimizeDeps: { include: ['three', 'three/examples/jsm/postprocessing/GTAOPass.js', 'three/examples/jsm/postprocessing/EffectComposer.js'] },
});
