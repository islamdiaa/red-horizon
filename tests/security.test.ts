// Security hardening: imported files (maps, missions, mods, challenges, replays) are untrusted. They must
// never inject markup, pollute prototypes or hang the tab, and the HTML escaper must cover every context.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { cleanText, gunzipBounded, parseUntrustedJson, UntrustedInputError } from '../src/platform/untrusted';
import { esc } from '../src/ui/dom';
import { checkMods } from '../src/mods/engine';
import type { ModFile } from '../src/mods/format';
import { parseRhMap } from '../src/editor/store';
import { decodeChallengeFile } from '../src/modes/store';
import { getMapDef } from '../src/maps';

const polluted = () => ({} as Record<string, unknown>);

describe('HTML escaping', () => {
  test('escapes every character that can open a tag or leave an attribute', () => {
    assert.equal(esc(`<img src=x onerror="a('b')">&`), '&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;');
  });
});

describe('cleanText', () => {
  test('neutralises markup, quotes, control and bidi-override characters', () => {
    const s = cleanText('<script>alert("x")</script>\u0000‮\'');
    assert.ok(!/[<>"'\u0000‮]/.test(s), s);
    assert.equal(cleanText('Operation "Red Dawn"'), 'Operation ”Red Dawn”');
  });
  test('keeps newlines and tabs, truncates to the cap', () => {
    assert.equal(cleanText('a\nb\tc'), 'a\nb\tc');
    assert.equal(cleanText('x'.repeat(50), 10).length, 10);
  });
});

describe('parseUntrustedJson', () => {
  test('drops prototype-polluting keys at any depth', () => {
    const v = parseUntrustedJson('{"a":{"__proto__":{"polluted":1},"constructor":{"prototype":{"polluted":1}},"ok":2}}') as { a: Record<string, unknown> };
    assert.deepEqual(Object.keys(v.a), ['ok']);
    assert.equal(polluted().polluted, undefined);
    assert.equal(Object.getPrototypeOf(v.a), Object.prototype);
  });
  test('cleans strings and keys', () => {
    const v = parseUntrustedJson('{"<b>":"<img src=x onerror=alert(1)>"}') as Record<string, string>;
    const [k] = Object.keys(v);
    assert.ok(!/[<>]/.test(k) && !/[<>]/.test(v[k]));
  });
  test('rejects oversized, deeply nested and huge documents', () => {
    assert.throws(() => parseUntrustedJson('[' + '0,'.repeat(100) + '0]', { maxChars: 50 }), UntrustedInputError);
    assert.throws(() => parseUntrustedJson('['.repeat(100) + ']'.repeat(100)), UntrustedInputError);
    assert.throws(() => parseUntrustedJson('[' + '0,'.repeat(5000) + '0]', { maxNodes: 1000 }), UntrustedInputError);
    assert.throws(() => parseUntrustedJson('{nope'), SyntaxError);
  });
  test('passes ordinary documents through unchanged', () => {
    const doc = { a: [1, 2.5, -3], b: { c: true, d: null, e: 'hello world' } };
    assert.deepEqual(parseUntrustedJson(JSON.stringify(doc)), doc);
  });
});

describe('gunzipBounded', () => {
  test('refuses a decompression bomb', async () => {
    const bomb = gzipSync(Buffer.alloc(4 << 20));
    await assert.rejects(gunzipBounded(new Uint8Array(bomb), 1 << 20), UntrustedInputError);
    assert.equal((await gunzipBounded(new Uint8Array(gzipSync(Buffer.from('ok'))), 1 << 20)), 'ok');
  });
});

describe('mods', () => {
  test('a mod cannot patch Object.prototype through "__proto__" / "constructor" ids', () => {
    for (const raw of [
      '{"id":"evil","name":"Evil","units":{"__proto__":{"cost":1}}}',
      '{"id":"evil","name":"Evil","units":{"constructor":{"cost":1}}}',
      '{"id":"evil","name":"Evil","units":{"e1":{"__proto__":{"cost":1}}}}',
      '{"id":"evil","name":"Evil","units":{"x1":{"clone":"constructor"}}}',
    ]) {
      const mod = JSON.parse(raw) as ModFile; // JSON.parse keeps "__proto__" as an own key
      const r = checkMods([mod]);
      assert.equal(polluted().cost, undefined, `prototype polluted by ${raw}`);
      assert.equal((Object as unknown as Record<string, unknown>).cost, undefined, `Object patched by ${raw}`);
      assert.equal(r.ok, false, `accepted: ${raw}`);
    }
  });
  test('references to inherited names are rejected', () => {
    const r = checkMods([JSON.parse('{"id":"evil","name":"Evil","units":{"1tnk":{"primary":"constructor"}}}') as ModFile]);
    assert.equal(r.ok, false);
  });
});

describe('map files', () => {
  test('markup in names and briefings is neutralised on import', () => {
    const def = { ...getMapDef('bridgewater'), name: '<img src=x onerror=alert(1)>', desc: '"><script>alert(1)</script>' };
    const { doc, errors } = parseRhMap(JSON.stringify(def));
    assert.deepEqual(errors, []);
    assert.ok(doc);
    assert.ok(!/[<>"]/.test(doc!.map.name + doc!.map.desc), doc!.map.name + doc!.map.desc);
  });
  test('oversized files are refused with a clear message', () => {
    const { doc, errors } = parseRhMap('"' + 'x'.repeat((4 << 20) + 10) + '"');
    assert.equal(doc, null);
    assert.match(errors[0], /too large/);
  });
});

describe('challenge files', () => {
  test('a gzip bomb is refused', async () => {
    const data = gzipSync(Buffer.alloc((64 << 20) + 1024)).toString('base64');
    await assert.rejects(decodeChallengeFile(JSON.stringify({ rhchallenge: 1, encoding: 'gzip+base64', data })), /expands/);
  });
  test('garbage is refused without crashing', async () => {
    await assert.rejects(decodeChallengeFile('{"rhchallenge":1,"challenge":{"__proto__":{"x":1}}}'));
    await assert.rejects(decodeChallengeFile('[[[[[[[[[['));
    assert.equal(polluted().x, undefined);
  });
});
