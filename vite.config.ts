import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    host: true,
    // The project lives on a network share where inotify events are unreliable; poll instead,
    // and skip the large reference source tree.
    watch: { usePolling: true, interval: 300, ignored: ['**/reference/**', '**/screenshots/**', '**/node_modules/**'] },
  },
  // pre-bundle three.js add-ons together so the dev server never loads two copies of three
  optimizeDeps: { include: ['three', 'three/examples/jsm/postprocessing/GTAOPass.js', 'three/examples/jsm/postprocessing/EffectComposer.js'] },
  build: { target: 'es2022', chunkSizeWarningLimit: 2500 },
});
