// The E2E bot's static server (tools/e2e/serve.mjs) must behave like the shipped nginx image: the real security
// headers (so the bot's CSP checks mean something), the cache rules, the SPA fallback, and no way out of the root.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { serve, securityHeaders } from '../tools/e2e/serve.mjs';

function tempSite(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rh-e2e-serve-'));
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>t</title>');
  fs.writeFileSync(path.join(dir, 'assets', 'index-abc.js'), 'export {};');
  fs.writeFileSync(path.join(dir, 'sw.js'), '// sw');
  fs.writeFileSync(path.join(dir, '.secret'), 'no');
  return dir;
}

test('serve.mjs: shipped headers, cache rules, SPA fallback, nothing outside the root', async () => {
  const dir = tempSite();
  const s = await serve(dir, { port: 0, host: '127.0.0.1' });
  try {
    const base = s.url as string;
    const conf = securityHeaders() as Record<string, string>;
    assert.ok(/script-src 'self'/.test(conf['Content-Security-Policy'] ?? ''), 'the CSP is read from docker/security-headers.conf');
    const index = await fetch(base);
    assert.equal(index.status, 200, 'index.html is served');
    assert.equal(index.headers.get('content-security-policy'), conf['Content-Security-Policy'], 'every response carries the shipped CSP');
    assert.equal(index.headers.get('cache-control'), 'no-cache', 'index.html is not cached');
    const asset = await fetch(new URL('assets/index-abc.js', base));
    assert.equal(asset.headers.get('cache-control'), 'public, max-age=31536000, immutable', 'hashed assets are immutable');
    assert.match(asset.headers.get('content-type') ?? '', /javascript/, 'scripts have a JavaScript type (strict MIME checks)');
    assert.equal((await fetch(new URL('sw.js', base))).headers.get('cache-control'), 'no-cache', 'the service worker is revalidated');
    assert.equal((await fetch(new URL('assets/missing.js', base))).status, 404, 'a missing asset is a 404, not the SPA page');
    const spa = await fetch(new URL('some/route', base));
    assert.equal(spa.status, 200, 'other paths fall back to index.html');
    assert.match(await spa.text(), /<title>t<\/title>/, 'the fallback is index.html');
    assert.equal((await fetch(new URL('.secret', base))).status, 403, 'dot files are refused');
    const trav = await fetch(new URL('/assets/%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fhostname', base));
    assert.ok(trav.status === 403 || trav.status === 404, `traversal is refused (got ${trav.status})`);
    assert.equal((await fetch(base, { method: 'POST' })).status, 405, 'only GET and HEAD');
    assert.equal((await fetch(new URL('/%E0%A4%A', base))).status, 400, 'a malformed escape is a 400, not a crash');
    assert.equal((await fetch(base)).status, 200, 'the server is still up after a bad request');
  } finally {
    await s.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
