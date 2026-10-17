// Share links (src/share): maps, challenges and short replays travel gzip + base64url in the URL fragment.
// Round trips must be exact; anything malformed, oversized or hostile must be refused with a user-facing
// message before it reaches an importer, and whatever gets through is cleaned like an imported file.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import {
  decodeSharePayload, encodeSharePayload, fromBase64Url, linkReach, payloadFromHash, shareFragment, ShareLinkError, SHARE_LIMITS, toBase64Url,
} from '../src/share/codec';
import { mapShareData, replayShareData, validateShared, MAX_SHARED_REPLAY_TICKS } from '../src/share/content';
import { parseRhMap } from '../src/editor/store';
import { getMapDef } from '../src/maps';
import { BUILTIN_LIST } from '../src/modes/builtins';
import { REPLAY_VERSION, type ReplayData } from '../src/replay/format';

/** A fragment payload built by hand from arbitrary JSON text (for hostile envelopes). */
const rawPayload = (json: string | Uint8Array) => `1.${toBase64Url(gzipSync(typeof json === 'string' ? Buffer.from(json) : json))}`;

const rejects = async (payload: string, re: RegExp, what: string) => {
  await assert.rejects(decodeSharePayload(payload), (e: unknown) => {
    assert.ok(e instanceof ShareLinkError, `${what}: a ShareLinkError, got ${String(e)}`);
    assert.match((e as Error).message, re, `${what}: message`);
    return true;
  }, what);
};

function sampleMapDoc() {
  const def = getMapDef('proving-grounds');
  assert.ok(def, 'curated map exists');
  const { doc, errors } = parseRhMap(JSON.stringify({ format: 'rhmap', version: 1, map: { ...def, name: 'Shared <b>Grounds</b>' } }));
  assert.ok(doc, `sample map parses: ${errors.join(', ')}`);
  return doc!;
}

function sampleReplay(ticks = 20 * 90): ReplayData {
  return {
    v: REPLAY_VERSION, id: 'r-test', createdAt: 1_700_000_000_000, storedAt: 1_700_000_100_000, gameVersion: 'test',
    setup: { faction: 'allies', color: 0x3d7be0, opponents: [{ faction: 'soviet', difficulty: 'normal' }], mapSize: 64, water: 0.5, trees: 0.5, ore: 0.6, credits: 10000, startUnits: 'mcv', fog: true, timeOfDay: 'day', seed: 1234 },
    mapName: 'Random 64×64', mapW: 64, mapH: 64,
    players: [{ name: 'Commander', faction: 'allies', color: 0x3d7be0, team: 0 }, { name: 'Gen. Volkov', faction: 'soviet', color: 0xd23a2c, team: 1, ai: 'normal' }],
    local: 0, ticks, result: 'victory', winnerTeam: 0,
    cmds: [[1, { c: 'deploy', player: 0, units: [1] }], [40, { c: 'build', player: 0, type: 'powr' }]],
    hashes: [[200, 'abc123']],
  } as ReplayData;
}

describe('base64url', () => {
  test('round-trips every length and byte value', () => {
    for (let n = 0; n < 40; n++) {
      const bytes = new Uint8Array(n).map((_, i) => (i * 97 + n * 13) & 255);
      const s = toBase64Url(bytes);
      assert.ok(/^[A-Za-z0-9_-]*$/.test(s), `url-safe alphabet (${s})`);
      assert.deepEqual([...fromBase64Url(s)], [...bytes], `length ${n} round-trips`);
    }
  });
  test('refuses characters outside the alphabet', () => {
    assert.throws(() => fromBase64Url('ab+/'), ShareLinkError, '+ and / are not base64url');
    assert.throws(() => fromBase64Url('<script>'), ShareLinkError, 'markup is refused');
    assert.throws(() => fromBase64Url('abcde'), ShareLinkError, 'impossible length is refused');
  });
});

describe('share fragment', () => {
  test('finds the payload among other fragment parts', () => {
    assert.equal(payloadFromHash('#share=1.abc'), '1.abc', 'plain');
    assert.equal(payloadFromHash('#x=1&share=1.def'), '1.def', 'after another part');
    assert.equal(payloadFromHash('#sharex=1'), null, 'a different key');
    assert.equal(payloadFromHash(''), null, 'no fragment');
    assert.equal(shareFragment('1.abc'), '#share=1.abc', 'builds the fragment');
  });
  test('reach: chat apps, browsers, too long', () => {
    assert.equal(linkReach(500), 'chat', 'short link');
    assert.equal(linkReach(SHARE_LIMITS.chatFriendlyChars + 1), 'browser', 'longer than a Discord message');
    assert.equal(linkReach(SHARE_LIMITS.maxFragmentChars + 1), 'too-long', 'over the cap');
  });
});

describe('share codec round trips', () => {
  test('a custom map', async () => {
    const doc = sampleMapDoc();
    const payload = await encodeSharePayload('map', doc.map.name, mapShareData(doc));
    assert.ok(payload.length < SHARE_LIMITS.chatFriendlyChars, `a curated-size map fits a chat message (${payload.length} chars)`);
    const env = await decodeSharePayload(payload);
    assert.equal(env.k, 'map', 'kind');
    const item = await validateShared(env);
    assert.equal(item.kind, 'map', 'validated as a map');
    if (item.kind !== 'map') return;
    assert.deepEqual(item.doc.map.features, doc.map.features, 'features survive');
    assert.equal(item.doc.map.size, doc.map.size, 'size survives');
    assert.notEqual(item.doc.id, doc.id, 'an imported map gets a fresh id (never overwrites)');
    assert.ok(!/[<>]/.test(item.title), `markup in the name is neutralised (${item.title})`);
  });
  test('a challenge', async () => {
    const c = BUILTIN_LIST[0];
    const env = await decodeSharePayload(await encodeSharePayload('challenge', c.title, c));
    const item = await validateShared(env);
    assert.equal(item.kind, 'challenge', 'validated as a challenge');
    if (item.kind !== 'challenge') return;
    assert.deepEqual(item.challenge.goal, c.goal, 'goal survives');
    assert.equal(item.challenge.timeLimit, c.timeLimit, 'time limit survives');
    assert.equal(item.challenge.builtin, c.builtin, 'built-in id survives');
  });
  test('a short replay', async () => {
    const r = sampleReplay();
    const env = await decodeSharePayload(await encodeSharePayload('replay', r.mapName, replayShareData(r)));
    const item = await validateShared(env);
    assert.equal(item.kind, 'replay', 'validated as a replay');
    if (item.kind !== 'replay') return;
    assert.deepEqual(item.replay.cmds, r.cmds, 'commands survive exactly');
    assert.deepEqual(item.replay.hashes, r.hashes, 'hashes survive');
    assert.equal(item.replay.setup.seed, r.setup.seed, 'seed survives');
    assert.equal(item.replay.storedAt, undefined, 'storage bookkeeping is not shared');
  });
});

describe('share limits', () => {
  test('an over-long fragment is refused before decoding', async () => {
    await rejects('1.' + 'A'.repeat(SHARE_LIMITS.maxFragmentChars), /too long/i, 'long fragment');
  });
  test('a gzip bomb is refused by the inflate cap', async () => {
    const bomb = gzipSync(Buffer.alloc(SHARE_LIMITS.maxJsonBytes + 4096, 0x20), { level: 9 });
    const payload = `1.${toBase64Url(bomb)}`;
    assert.ok(payload.length < SHARE_LIMITS.maxFragmentChars, `the bomb itself fits a link (${payload.length})`);
    await rejects(payload, /more data/i, 'gzip bomb');
  });
  test('too many JSON values are refused', async () => {
    const many = `{"v":1,"k":"replay","t":"x","d":{"a":[${'0,'.repeat(SHARE_LIMITS.maxNodes + 10)}0]}}`;
    await rejects(rawPayload(many), /more data/i, 'node flood');
  });
  test('deep nesting is refused', async () => {
    const deep = `{"v":1,"k":"map","t":"x","d":${'['.repeat(200)}${']'.repeat(200)}}`;
    await rejects(rawPayload(deep), /more data/i, 'deep nesting');
  });
  test('a replay longer than a link may carry is refused on validation', async () => {
    const r = sampleReplay(MAX_SHARED_REPLAY_TICKS + 1);
    const env = await decodeSharePayload(await encodeSharePayload('replay', r.mapName, replayShareData(r)));
    await assert.rejects(validateShared(env), ShareLinkError, 'over-long replay');
  });
});

describe('hostile share fragments', () => {
  test('malformed links are refused with a message', async () => {
    await rejects('', /empty/i, 'empty');
    await rejects('1.<script>alert(1)</script>', /damaged/i, 'markup in the payload');
    await rejects('1.' + toBase64Url(new TextEncoder().encode('{"v":1}{"v":1}{"v":1}')), /damaged/i, 'not gzip');
    await rejects(rawPayload('this is not json'), /damaged/i, 'gzip of non-JSON');
    await rejects('9.' + toBase64Url(gzipSync(Buffer.from('{}'))), /newer version/i, 'future version');
    await rejects('x.abc', /damaged/i, 'garbage version');
    await rejects(rawPayload('[1,2,3]'), /not a red horizon/i, 'an array');
    await rejects(rawPayload('{"v":1,"k":"script","t":"x","d":{}}'), /cannot open/i, 'unknown kind');
    await rejects(rawPayload('{"v":1,"k":"map","t":"x","d":"<img src=x onerror=alert(1)>"}'), /empty/i, 'a string instead of a document');
  });
  test('prototype pollution and markup are neutralised', async () => {
    const env = await decodeSharePayload(rawPayload('{"v":1,"k":"map","t":"<img src=x onerror=alert(1)>","d":{"__proto__":{"polluted":1},"constructor":{"prototype":{"polluted":1}},"name":"\\u202e<b>x</b>"}}'));
    assert.ok(!/[<>]/.test(env.t), `title is inert (${env.t})`);
    const d = env.d as Record<string, unknown>;
    assert.ok(!Object.prototype.hasOwnProperty.call(d, '__proto__') && !Object.prototype.hasOwnProperty.call(d, 'constructor'), 'prototype keys dropped');
    assert.equal(({} as Record<string, unknown>).polluted, undefined, 'Object.prototype untouched');
    assert.ok(!/[<>\u202e]/.test(String(d.name)), `strings are inert (${String(d.name)})`);
  });
  test('a shared replay cannot ask for an absurd battlefield', async () => {
    for (const setup of [{ mapSize: 1e6 }, { opponents: Array(50).fill({ faction: 'soviet', difficulty: 'easy' }) }, { customMap: { size: 4096 } }, { credits: -5 }, { mods: { hash: 'x', mods: [{ format: 'nope' }] } }]) {
      const r = { ...sampleReplay(), setup: { ...sampleReplay().setup, ...setup } };
      const env = await decodeSharePayload(await encodeSharePayload('replay', 'x', replayShareData(r as ReplayData)));
      await assert.rejects(validateShared(env), ShareLinkError, `rejects ${JSON.stringify(setup).slice(0, 60)}`);
    }
  });
  test('a well-formed envelope with a bogus document fails its importer', async () => {
    await assert.rejects(validateShared(await decodeSharePayload(rawPayload('{"v":1,"k":"map","t":"x","d":{"format":"rhmap","version":1,"map":{"size":1e9}}}'))), ShareLinkError, 'bogus map');
    await assert.rejects(validateShared(await decodeSharePayload(rawPayload('{"v":1,"k":"challenge","t":"x","d":{"v":1,"id":"c","title":"t"}}'))), ShareLinkError, 'bogus challenge');
    await assert.rejects(validateShared(await decodeSharePayload(rawPayload('{"v":1,"k":"replay","t":"x","d":{"v":1,"id":"r","cmds":"no"}}'))), ShareLinkError, 'bogus replay');
  });
});
