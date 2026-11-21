import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

// Relative base: the site works from any static path (Pages root or a nested folder).
export default defineConfig({
  root: here('.'),
  base: './',
  worker: { format: 'es' },
  build: {
    outDir: here('dist'),
    emptyOutDir: true,
    target: 'es2022',
    assetsInlineLimit: (file: string) => (file.endsWith('.wasm') ? false : undefined),
    chunkSizeWarningLimit: 8_000,
    rollupOptions: { input: { main: here('index.html'), host: here('host/index.html') } },
  },
  server: { port: 5180 },
});
