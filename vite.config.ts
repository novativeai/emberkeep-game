import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  publicDir: 'assets',
  server: {
    port: 5173,
    strictPort: false
  },
  preview: {
    port: 4173,
    strictPort: true
  },
  build: {
    outDir: 'dist',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1600
  }
});
