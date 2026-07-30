import { defineConfig } from 'vite';

// Served from https://<user>.github.io/web-map-story/ as a project page.
export default defineConfig({
  base: '/web-map-story/',
  build: {
    outDir: 'dist',
  },
});
