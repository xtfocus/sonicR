import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// index.html is the default entry; help.html must be listed so `vite build`
// emits it too (the dev server serves any root html automatically).
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('index.html', import.meta.url)),
        help: fileURLToPath(new URL('help.html', import.meta.url)),
      },
    },
  },
});
