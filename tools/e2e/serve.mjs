// A small static server for production builds that behaves like the shipped nginx image (docker/nginx.conf):
// the same security headers (read from docker/security-headers.conf, so the CSP is the real one), the same
// cache rules (index.html, sw.js and the manifest no-cache; /assets/ immutable) and the SPA fallback.
// The root can be swapped while it runs (the PWA update journey serves build A, then build B).
//
//   node tools/e2e/serve.mjs <distDir> [port=5302] [host=127.0.0.1]
//
// Binds to 127.0.0.1 by default. To serve the test VMs on libvirt's NAT network, pass that bridge's
// address as the host (never a LAN address).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** The `add_header Name "value" always;` lines of docker/security-headers.conf. */
export function securityHeaders() {
  const conf = fs.readFileSync(path.join(ROOT, 'docker/security-headers.conf'), 'utf8');
  const out = {};
  for (const m of conf.matchAll(/^\s*add_header\s+([\w-]+)\s+"([^"]*)"/gm)) out[m[1]] = m[2];
  return out;
}

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.mjs': 'application/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.glb': 'model/gltf-binary',
  '.wasm': 'application/wasm', '.txt': 'text/plain; charset=utf-8', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
};

/**
 * Start serving `dir`. Returns { url, setRoot(dir), close(), hits }.
 * `hits` counts requests per path (the PWA journey checks what an offline start fetched).
 */
export function serve(dir, { port = 5302, host = '127.0.0.1', log = false } = {}) {
  let root = path.resolve(dir);
  const headers = securityHeaders();
  const hits = new Map();
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const send = (status, body, extra = {}) => {
      res.writeHead(status, { ...headers, ...extra });
      res.end(req.method === 'HEAD' ? undefined : body);
    };
    let p;
    try { p = decodeURIComponent(url.pathname); } catch { return send(400, 'bad request'); } // (malformed %-escapes)
    hits.set(p, (hits.get(p) ?? 0) + 1);
    if (log) console.log(req.method, req.url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, 'method not allowed');
    if (p.split('/').some((s) => s.startsWith('.'))) return send(403, 'forbidden'); // location ~ /\. { deny all; }
    let file = path.join(root, p);
    if (file !== root && !file.startsWith(root + path.sep)) return send(403, 'forbidden');
    try { if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html'); } catch { /* not found below */ }
    let exists = false;
    try { exists = fs.statSync(file).isFile(); } catch { /* missing */ }
    if (!exists) {
      // /assets/ and /fonts/ are try_files $uri =404; everything else falls back to index.html
      if (p.startsWith('/assets/') || p.startsWith('/fonts/')) return send(404, 'not found', { 'Content-Type': 'text/plain' });
      file = path.join(root, 'index.html');
      p = '/index.html';
    }
    const ext = path.extname(file).toLowerCase();
    const extra = { 'Content-Type': TYPES[ext] ?? 'application/octet-stream' };
    if (p.startsWith('/assets/')) extra['Cache-Control'] = 'public, max-age=31536000, immutable';
    else if (p.startsWith('/fonts/')) extra['Cache-Control'] = 'public, max-age=2592000';
    else if (p === '/index.html' || p === '/' || p === '/sw.js' || p === '/manifest.webmanifest') extra['Cache-Control'] = 'no-cache';
    fs.readFile(file, (err, buf) => (err ? send(500, 'error') : send(200, buf, extra)));
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve({
      url: `http://${host}:${server.address().port}/`, // (port 0: the one the system picked)
      setRoot: (d) => { root = path.resolve(d); },
      hits,
      close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }),
    }));
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [dir, port = '5302', host = '127.0.0.1'] = process.argv.slice(2);
  if (!dir) { console.error('usage: node tools/e2e/serve.mjs <distDir> [port=5302] [host=127.0.0.1]'); process.exit(2); }
  const s = await serve(dir, { port: +port, host, log: !!process.env.SERVE_LOG });
  console.log(`serving ${dir} at ${s.url} (production headers)`);
}
