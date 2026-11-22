import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { defineConfig, type Plugin } from 'vite';

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/** SDK documents published next to the Arena: the WIT, the rules profile and the fixtures. */
const SDK_FILES: Record<string, string> = {
  'sdk/jungle.wit': here('../wit/jungle.wit'),
  'sdk/desktop-jungle-v1.json': here('../sdk/rules/desktop-jungle-v1.json'),
  'sdk/fixtures/moves.json': here('../sdk/fixtures/moves.json'),
  'sdk/fixtures/adjudication.json': here('../sdk/fixtures/adjudication.json'),
  'sdk/fixtures/opening.json': here('../sdk/fixtures/opening.json'),
};

function sdkFiles(): Plugin {
  return {
    name: 'arena-sdk-files',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split('?')[0]?.replace(/^\//, '') ?? '';
        const source = SDK_FILES[path];
        if (!source) return next();
        res.setHeader('content-type', path.endsWith('.json') ? 'application/json' : 'text/plain; charset=utf-8');
        res.end(readFileSync(source));
      });
    },
    generateBundle() {
      // Emitted byte-for-byte: the rules digest is computed over these exact bytes.
      for (const [fileName, source] of Object.entries(SDK_FILES)) {
        this.emitFile({ type: 'asset', fileName, source: readFileSync(source) });
      }
    },
  };
}

// `base: './'` makes every asset, worker and wasm URL relative, so the built Arena runs
// from any static subpath (dist/arena/ on Pages, or a nested folder in conformance runs).
export default defineConfig({
  root: here('.'),
  base: './',
  plugins: [vue(), tailwindcss(), sdkFiles()],
  worker: { format: 'es' },
  build: {
    outDir: here('../dist/arena'),
    emptyOutDir: true,
    target: 'es2022',
    // Never inline wasm as data: URLs; WebAssembly.compileStreaming needs a real response.
    assetsInlineLimit: (file: string) => (file.endsWith('.wasm') ? false : undefined),
    // jco's bindgen core module is ~5.7 MB; it is fetched only when a new binary is imported.
    chunkSizeWarningLimit: 8_000,
    rollupOptions: {
      // Pages: Arena setup (/arena/), full-screen play (/arena/play/), game upload
      // (/arena/upload/) and the conformance runner.
      input: {
        main: here('index.html'),
        play: here('play/index.html'),
        upload: here('upload/index.html'),
        conformance: here('conformance.html'),
      },
    },
  },
  // The catalog API comes from `npm run dev:full` (wrangler pages dev on ARENA_API_PORT, default 8788).
  server: {
    port: 4322,
    fs: { allow: [here('..')] },
    proxy: { '/api': `http://127.0.0.1:${process.env['ARENA_API_PORT'] ?? 8788}` },
  },
  preview: { port: 4323 },
});
