// Minimal static file server for local verification. Serves a directory under an
// arbitrary URL prefix, proving the build uses relative paths, with the MIME types
// Cloudflare Pages uses (notably application/wasm for WebAssembly.compileStreaming).
// With --api, requests for <prefix>api/… are forwarded to that origin's /api/… (the
// catalog API from scripts/api-server.ts), as Pages Functions answer them in production.
//
//   node scripts/serve-static.mjs [dir=dist] [--prefix /some/sub/path] [--port 4400] [--api http://127.0.0.1:8788]
import { createReadStream, statSync } from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
  '.wit': 'text/plain; charset=utf-8',
};

function proxy(req, res, target) {
  const upstream = httpRequest(target, { method: req.method, headers: { ...req.headers, host: target.host } }, (reply) => {
    res.writeHead(reply.statusCode ?? 502, reply.headers);
    reply.pipe(res);
  });
  upstream.on('error', () => {
    // Mid-response failures cut the connection; appending text would corrupt the body.
    if (res.headersSent) res.destroy();
    else res.writeHead(502, { 'content-type': 'text/plain' }).end('The catalog API is not running.');
  });
  // A visitor who goes away should not keep the upstream request running.
  res.on('close', () => upstream.destroy());
  req.pipe(upstream);
}

export function startStaticServer({ dir, prefix = '/', port = 0, api = null }) {
  const root = resolve(dir);
  const base = `/${prefix.replace(/^\/+|\/+$/g, '')}/`.replace('//', '/');
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (api && url.pathname.startsWith(`${base}api/`)) {
      proxy(req, res, new URL(`/${url.pathname.slice(base.length)}${url.search}`, api));
      return;
    }
    let path = decodeURIComponent(url.pathname);
    if (!path.startsWith(base)) {
      res.writeHead(404).end('outside prefix');
      return;
    }
    path = path.slice(base.length);
    let file = normalize(join(root, path));
    if (file !== root && !file.startsWith(root + sep)) {
      res.writeHead(403).end();
      return;
    }
    try {
      if (statSync(file).isDirectory()) file = join(file, 'index.html');
      statSync(file);
    } catch {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, {
      'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    createReadStream(file).pipe(res);
  });
  return new Promise((resolveStart) => {
    server.listen(port, '127.0.0.1', () => {
      const { port: actual } = server.address();
      resolveStart({ server, url: `http://127.0.0.1:${actual}${base}`, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const flag = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
  const dir = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--')) ?? 'dist';
  const api = flag('--api', null);
  const { url } = await startStaticServer({ dir, prefix: flag('--prefix', '/'), port: Number(flag('--port', 4400)), api });
  console.log(`serving ${dir} at ${url}${api ? ` (api/ → ${api})` : ''}`);
}
