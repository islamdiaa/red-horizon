import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    host: true,
    // Poll for changes (inotify events are unreliable on network shares) and skip large local-only
    // folders: reference/ (an optional checkout of the original Red Alert source) and screenshots/.
    watch: { usePolling: true, interval: 300, ignored: ['**/reference/**', '**/screenshots/**', '**/node_modules/**'] },
  },
  // pre-bundle three.js add-ons together so the dev server never loads two copies of three
  optimizeDeps: {
    include: [
      'three',
      'three/examples/jsm/postprocessing/GTAOPass.js',
      'three/examples/jsm/postprocessing/EffectComposer.js',
      'three/examples/jsm/postprocessing/Pass.js',
      'three/examples/jsm/postprocessing/ShaderPass.js',
      'three/examples/jsm/postprocessing/SMAAPass.js',
      'three/examples/jsm/shaders/FXAAShader.js',
      'three/examples/jsm/environments/RoomEnvironment.js',
      'three/examples/jsm/utils/BufferGeometryUtils.js',
      'three/examples/jsm/loaders/GLTFLoader.js', // baked models (src/render/models/hd.ts)
    ],
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2500,
    rolldownOptions: {
      output: {
        // three.js (core + the examples add-ons we use) in its own chunk: it changes far less often than the
        // game code, so returning players keep it cached across updates. index.html modulepreloads it, so the
        // service worker precaches it like the main bundle.
        codeSplitting: {
          groups: [{ name: 'three', test: /[\\/]node_modules[\\/]three[\\/]/ }],
        },
      },
    },
  },
});
