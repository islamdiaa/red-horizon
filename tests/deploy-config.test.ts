// The two shipped hosting configs (docker/nginx.conf + docker/security-headers.conf for the Docker image, vercel.json for
// static hosting) must keep the same security headers and cache rules, and the nginx proxy in front of the relay must keep
// what the relay relies on (docs/MULTIPLAYER.md). Checked against a test copy of the stack; this guards the files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p: string) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
// (RH_NGINX_CONF=<file> checks a candidate nginx config instead of the shipped one)
const nginx = process.env.RH_NGINX_CONF ? fs.readFileSync(process.env.RH_NGINX_CONF, 'utf8') : read('docker/nginx.conf');
const headersConf = read('docker/security-headers.conf');
const vercel = JSON.parse(read('vercel.json')) as { headers: { source: string; headers: { key: string; value: string }[] }[] };

/** `add_header Name "value" always;` lines of security-headers.conf. */
const nginxHeaders = Object.fromEntries([...headersConf.matchAll(/^\s*add_header\s+([\w-]+)\s+"([^"]*)"/gm)].map((m) => [m[1], m[2]]));
/** The headers vercel.json sets on every path. */
const vercelAll = Object.fromEntries((vercel.headers.find((h) => h.source === '/(.*)')?.headers ?? []).map((h) => [h.key, h.value]));
const vercelFor = (source: string, key: string) => vercel.headers.find((h) => h.source === source)?.headers.find((h) => h.key === key)?.value;

/** nginx `location <spec> { ... }` blocks (no nested braces in this config except types {}). */
function locations(raw: string): { spec: string; body: string }[] {
  const conf = raw.replace(/#.*$/gm, ''); // (comments mention locations too)
  const out: { spec: string; body: string }[] = [];
  const re = /location\s+([^{]+)\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(conf))) {
    let depth = 1, i = re.lastIndex;
    for (; i < conf.length && depth; i++) depth += conf[i] === '{' ? 1 : conf[i] === '}' ? -1 : 0;
    out.push({ spec: m[1].trim(), body: conf.slice(re.lastIndex, i - 1) });
  }
  return out;
}

test('deploy config: the same strict security headers on nginx and Vercel', () => {
  const csp = nginxHeaders['Content-Security-Policy'] ?? '';
  assert.ok(csp.length > 0, 'nginx sets a CSP');
  assert.equal(vercelAll['Content-Security-Policy'], csp, 'vercel.json carries the same CSP as docker/security-headers.conf');
  for (const bad of ["'unsafe-eval'", "'wasm-unsafe-eval'", 'http:', 'https:', '*']) assert.ok(!csp.split(/\s+/).includes(bad), `the CSP never allows ${bad}`);
  for (const d of ["script-src 'self'", "connect-src 'self'", "object-src 'none'", "frame-ancestors 'none'", "base-uri 'self'"]) assert.ok(csp.includes(d), `the CSP keeps ${d}`);
  for (const [k, v] of Object.entries(nginxHeaders)) assert.equal(vercelAll[k], v, `vercel.json sets ${k} like nginx`);
  assert.equal(nginxHeaders['X-Content-Type-Options'], 'nosniff', 'nosniff');
  assert.ok(/^\s*server_tokens\s+off;/m.test(nginx), 'nginx does not advertise its version');
});

test('deploy config: every nginx location answers with the security headers', () => {
  // an add_header inside a location replaces all inherited ones, so a location without the include ships no CSP
  const locs = locations(nginx);
  assert.ok(locs.length >= 5, `found the locations (${locs.map((l) => l.spec).join(' | ')})`);
  for (const l of locs) {
    if (/deny all;/.test(l.body) && !/add_header/.test(l.body)) continue; // a bare refusal (nginx's own error page)
    assert.ok(l.body.includes('include /etc/nginx/security-headers.conf;'), `location ${l.spec} includes security-headers.conf`);
  }
});

test('deploy config: cache rules (hashed bundles forever, the page/worker/manifest always revalidated)', () => {
  const loc = (spec: string) => locations(nginx).find((l) => l.spec === spec)?.body ?? '';
  assert.match(loc('/assets/'), /Cache-Control "public, max-age=31536000, immutable"/, 'nginx: /assets/ immutable');
  assert.match(loc('/assets/'), /try_files \$uri =404;/, 'nginx: a missing bundle is a 404, never the page');
  for (const f of ['= /index.html', '= /sw.js', '= /manifest.webmanifest']) assert.match(loc(f), /Cache-Control "no-cache"/, `nginx: ${f} no-cache`);
  assert.equal(vercelFor('/assets/(.*)', 'Cache-Control'), 'public, max-age=31536000, immutable', 'vercel: /assets/ immutable');
  assert.equal(vercelFor('/(index.html|sw.js|manifest.webmanifest)?', 'Cache-Control'), 'no-cache', 'vercel: page, worker and manifest no-cache');
});

test('deploy config: the /relay/ proxy keeps WebSockets, the real Host, an unspoofable address and long idle timeouts', () => {
  const relay = locations(nginx).find((l) => l.spec === '/relay/')?.body ?? '';
  assert.ok(relay, 'nginx proxies /relay/');
  assert.match(relay, /proxy_set_header Upgrade \$http_upgrade;/, 'WebSocket upgrade passed on');
  assert.match(relay, /proxy_set_header Connection \$rh_connection_upgrade;/, 'Connection: upgrade passed on');
  assert.match(relay, /proxy_set_header Host \$http_host;/, 'the browser\'s Host reaches the relay (its Origin check compares them)');
  // the relay's per-address limits trust X-Real-IP (RELAY_TRUST_PROXY=1): it must be nginx's view of the client, never a
  // header the client sent
  assert.match(relay, /proxy_set_header X-Real-IP \$remote_addr;/, 'X-Real-IP is set from the connection, not passed through');
  const timeout = Number(/proxy_read_timeout (\d+)s;/.exec(relay)?.[1] ?? 0);
  assert.ok(timeout > 30, `proxy_read_timeout ${timeout}s outlasts the relay's 30 s heartbeat timeout`);
  assert.match(relay, /add_header Cache-Control "no-store" always;/, 'relay answers are never cached');
});

test('deploy config: compression, HD content and font caching, an address-free log, a lean build context', () => {
  assert.match(nginx, /^\s*gzip_vary on;/m, 'gzip answers say Vary: Accept-Encoding (a cache in between must not serve gzip to a client that did not ask)');
  const types = /gzip_types ([^;]+);/.exec(nginx)?.[1].split(/\s+/) ?? [];
  for (const t of ['application/javascript', 'text/css', 'application/json', 'model/gltf-binary']) assert.ok(types.includes(t), `gzip covers ${t}`);
  for (const t of ['image/webp', 'font/woff2', 'image/png', 'image/jpeg']) assert.ok(!types.includes(t), `${t} is not compressed twice`);
  // HD files are requested as <file>?v=<content hash>: immutable with the hash, revalidated without (their manifests)
  assert.match(nginx, /map \$arg_v \$rh_content_cache \{\s*''\s+"no-cache";\s*default\s+"public, max-age=31536000, immutable";\s*\}/, 'the ?v= cache map');
  const locs = locations(nginx);
  const hd = locs.filter((l) => /models|textures/.test(l.spec));
  assert.ok(hd.length >= 1 && hd.every((l) => /add_header Cache-Control \$rh_content_cache;/.test(l.body) && /try_files \$uri =404;/.test(l.body)), `HD locations cache by hash and 404 a missing file (${hd.map((l) => l.spec).join(' | ')})`);
  assert.ok(hd.some((l) => /default_type model\/gltf-binary;/.test(l.body)), 'models are served as model/gltf-binary (so gzip applies)');
  // fonts keep their names while the CJK subset is rebuilt with new text: never a long max-age
  assert.match(locs.find((l) => l.spec === '/fonts/')?.body ?? '', /Cache-Control "no-cache"/, 'nginx: fonts revalidate');
  assert.equal(vercelFor('/fonts/(.*)', 'Cache-Control'), 'no-cache', 'vercel: fonts revalidate');
  // docs/MULTIPLAYER.md: client addresses are never logged
  const fmt = /log_format (\w+) '([^;]*)';/.exec(nginx);
  assert.ok(fmt && !/\$(remote_addr|http_x_forwarded_for|http_user_agent|binary_remote_addr)/.test(fmt[2]), 'the access log format has no client address or user agent');
  assert.match(nginx, new RegExp(`access_log \\S+ ${fmt?.[1]};`), 'the server logs with that format');
  const ignore = read('.dockerignore').split('\n').map((l) => l.trim());
  for (const p of ['tools', '**/.env', '**/.env.*', 'node_modules', '.git']) assert.ok(ignore.includes(p), `.dockerignore keeps ${p} out of the build context`);
});
