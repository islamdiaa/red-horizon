import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    host: true,
    // The project lives on a network share where inotify events are unreliable; poll instead,
    // and skip the large reference source tree.
    watch: { usePolling: true, interval: 300, ignored: ['**/reference/**', '**/screenshots/**', '**/node_modules/**'] },
  },
  build: { target: 'es2022', chunkSizeWarningLimit: 2500 },
});
