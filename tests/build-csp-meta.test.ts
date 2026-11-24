// The GitHub Pages build (RH_CSP_META=1, vite.config.ts cspMeta): GitHub Pages can't send headers, so the page carries
// the deployment's CSP as a <meta> tag. The tag must come before any script, carry the shipped policy (minus what a
// <meta> ignores), and appear only when asked for: Docker and Vercel send the header, which deployments may widen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cspMeta } from '../vite.config';

const page = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const header = readFileSync(new URL('../docker/security-headers.conf', import.meta.url), 'utf8').match(/Content-Security-Policy\s+"([^"]+)"/)?.[1] ?? '';
type Hook = { handler: (html: string) => string };
const run = (on: boolean, html = page) => ((cspMeta(on).transformIndexHtml as Hook).handler(html));
const metaOf = (html: string) => html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)" \/>/)?.[1];

test('csp meta: injected before the first script, with the shipped policy minus frame-ancestors', () => {
  assert.ok(header.includes("script-src 'self'"), 'read the shipped CSP');
  const html = run(true);
  const csp = metaOf(html);
  assert.ok(csp, 'the tag is there');
  assert.ok(html.indexOf('http-equiv="Content-Security-Policy"') < html.indexOf('<script'), 'before any script');
  const expected = header.split(';').map((d) => d.trim()).filter((d) => d && !d.startsWith('frame-ancestors'));
  assert.deepEqual(csp.split(';').map((d) => d.trim()), expected);
});

test('csp meta: off by default and never doubled', () => {
  assert.equal(run(false), page, 'Docker and Vercel builds keep the header alone');
  const once = run(true);
  assert.equal(run(true, once), once, 'a page that already has the tag is left alone');
  assert.equal(cspMeta(true).apply, 'build', 'the dev server (inline HMR client) is never restricted by it');
});
