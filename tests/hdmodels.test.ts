// Baked HD models (public/models): every manifest entry is a valid, CSP-safe GLB that the runtime
// (src/render/models/hd.ts) can graft onto the procedural model, within the size / triangle budgets.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { BUILDINGS, UNITS } from '../src/data/rules';
import { HD_HIGH_BUDGET, HD_IDLE_MS, hdSwapMoment, pickSweep, type SweepItem } from '../src/render/models/hd';
import { MODULE_MODEL_IDS } from '../src/render/models/commander-structures'; // upgrade-module models

const DIR = join(import.meta.dirname, '..', 'public', 'models');
const MAN = join(DIR, 'manifest.json');
/** Model budgets (bytes) with a little slack on triangles (build.mjs warns at the exact limits). */
const BUDGET: Record<string, { bytes: number; tris: number }> = {
  structure: { bytes: 1_000_000, tris: 9000 }, defense: { bytes: 1_000_000, tris: 9000 }, naval: { bytes: 1_000_000, tris: 9000 },
  vehicle: { bytes: 400_000, tris: 5500 }, aircraft: { bytes: 400_000, tris: 5500 }, infantry: { bytes: 250_000, tris: 3000 },
};
const ALLOWED_EXT = new Set(['KHR_mesh_quantization', 'EXT_texture_webp']);

interface Entry { file: string; bytes: number; type: string; faction: string | null; kind: string; tris: number }

function readGlb(file: string): { json: Record<string, any>; bin: Buffer } { // eslint-disable-line @typescript-eslint/no-explicit-any
  const b = readFileSync(file);
  assert.equal(b.readUInt32LE(0), 0x46546c67, `${file}: not a GLB (magic)`);
  assert.equal(b.readUInt32LE(4), 2, `${file}: glTF version 2`);
  assert.equal(b.readUInt32LE(8), b.length, `${file}: header length matches the file`);
  const jl = b.readUInt32LE(12);
  assert.equal(b.readUInt32LE(16), 0x4e4f534a, `${file}: first chunk is JSON`);
  const json = JSON.parse(b.subarray(20, 20 + jl).toString('utf8'));
  const bl = b.readUInt32LE(20 + jl);
  return { json, bin: b.subarray(28 + jl, 28 + jl + bl) };
}

describe('HD models (public/models)', () => {
  const man = existsSync(MAN) ? (JSON.parse(readFileSync(MAN, 'utf8')) as { version: number; models: Record<string, Entry> }) : null;

  test('manifest is present and well-formed', () => {
    assert.ok(man, 'public/models/manifest.json exists');
    assert.equal(man!.version, 1, 'manifest version 1');
    assert.ok(Object.keys(man!.models).length > 0, 'manifest lists models');
  });

  for (const [key, e] of Object.entries(man?.models ?? {})) {
    test(`${key}: valid CSP-safe GLB within budget`, () => {
      const file = join(DIR, e.file);
      assert.ok(existsSync(file), `${e.file} exists`);
      assert.equal(statSync(file).size, e.bytes, `${key}: manifest bytes match the file (rebuild with build.mjs)`);
      assert.equal(key, e.faction ? `${e.type}.${e.faction}` : e.type, `${key}: key = type[.faction]`);
      assert.ok(BUILDINGS[e.type] || UNITS[e.type] || MODULE_MODEL_IDS.includes(e.type), `${key}: ${e.type} is a game type or an upgrade module`);
      const b = BUDGET[e.kind] ?? BUDGET.structure;
      assert.ok(e.bytes <= b.bytes, `${key}: ${e.bytes} bytes within ${b.bytes}`);
      assert.ok(e.tris <= b.tris, `${key}: ${e.tris} triangles within ${b.tris}`);
      const { json } = readGlb(file);
      for (const x of [...(json.extensionsUsed ?? []), ...(json.extensionsRequired ?? [])]) {
        assert.ok(ALLOWED_EXT.has(x), `${key}: extension ${x} allowed (no Draco / meshopt / KTX2: CSP has no wasm-unsafe-eval)`);
      }
      for (const im of json.images ?? []) {
        assert.equal(im.mimeType, 'image/webp', `${key}: images are embedded WebP`);
        assert.ok(im.bufferView !== undefined && !im.uri, `${key}: images embedded (no external URIs)`);
      }
      assert.ok(!(json.buffers ?? []).some((b: { uri?: string }) => b.uri), `${key}: no external buffers`);
      const root = json.nodes[json.scenes[json.scene ?? 0].nodes[0]];
      assert.equal(root.name, 'root', `${key}: scene root node is 'root'`);
      assert.ok(root.extras?.rh, `${key}: root carries extras.rh metadata`);
      const mats = new Set((json.materials ?? []).map((m: { name: string }) => m.name));
      assert.ok(mats.has('body'), `${key}: has the 'body' atlas material`);
      for (const n of mats) assert.ok(/^(body|glass|track|glow:.+|fx:.+)$/.test(n as string), `${key}: material '${n}' is a known slot`);
      const atlasMats = [...mats].filter((n) => n === 'body' || n === 'glass');
      assert.ok(atlasMats.length <= 2, `${key}: at most 2 atlas materials`);
    });
  }
});

describe('HD template sweep (registry logic)', () => {
  const MB = 1024 * 1024;
  const item = (key: string, o: Partial<SweepItem> = {}): SweepItem => ({ key, loaded: true, refs: 0, holds: 0, lastUsed: 0, bytes: 13 * MB, ...o });
  const over = (n: number, lastUsed = 0) => Array.from({ length: n }, (_, i) => item(`t${i}`, { lastUsed: lastUsed + i }));
  const n = Math.ceil(HD_HIGH_BUDGET / (13 * MB)) + 4; // enough templates to be over the High budget

  test('a template loaded with 0 refs is not swept within 5 minutes, even over budget', () => {
    const items = over(n, 1000);
    assert.deepEqual(pickSweep(items, 1000 + HD_IDLE_MS - 1, 'high'), [], 'nothing idle for 5 minutes yet (High)');
    assert.deepEqual(pickSweep(items, 1000 + HD_IDLE_MS - 1, 'medium'), [], 'nothing idle for 5 minutes yet (Medium)');
  });

  test('over budget after 5 idle minutes: least recently used first, only down to the budget (High)', () => {
    const items = over(n, 0);
    const out = pickSweep(items, HD_IDLE_MS + n, 'high');
    assert.ok(out.length > 0 && out.length < n, `some but not all dropped (${out.length} of ${n})`);
    assert.deepEqual(out, items.slice(0, out.length).map((i) => i.key), 'oldest first');
    const left = items.reduce((a, i) => a + i.bytes, 0) - out.length * 13 * MB;
    assert.ok(left <= HD_HIGH_BUDGET && left + 13 * MB > HD_HIGH_BUDGET, 'stops at the budget');
  });

  test('High under budget keeps idle templates; Medium drops every idle one', () => {
    const items = [item('a'), item('b')];
    assert.deepEqual(pickSweep(items, HD_IDLE_MS + 1, 'high'), [], 'High: under budget, nothing dropped');
    assert.deepEqual(pickSweep(items, HD_IDLE_MS + 1, 'medium'), ['a', 'b'], 'Medium: idle templates dropped');
  });

  test('live and pending refs block the sweep, even over budget', () => {
    const items = over(n, 0);
    for (const i of items) i.holds = 1; // views waiting for their swap (construction, a hidden moment)
    items[0].holds = 0;
    items[0].refs = 2; // live instances
    assert.deepEqual(pickSweep(items, 10 * HD_IDLE_MS, 'high'), [], 'nothing in use is dropped (stays over budget)');
    assert.deepEqual(pickSweep(items, 10 * HD_IDLE_MS, 'medium'), [], 'Medium too');
    items[1].holds = 0; // its view swapped / died
    assert.deepEqual(pickSweep(items, 10 * HD_IDLE_MS, 'medium'), ['t1'], 'released template becomes sweepable');
  });

  test('not-loaded entries are ignored', () => {
    assert.deepEqual(pickSweep([item('x', { loaded: false })], 10 * HD_IDLE_MS, 'medium'), [], 'nothing to drop');
  });
});

describe('HD swap moments (lazy swaps never visible)', () => {
  const on = { shown: true, visible: true, inView: true };
  test('a finished structure on screen waits; any hidden moment swaps', () => {
    assert.equal(hdSwapMoment(on), false, 'on screen: keep waiting (and holding the template)');
    assert.equal(hdSwapMoment({ ...on, shown: false }), true, 'never shown yet');
    assert.equal(hdSwapMoment({ ...on, visible: false }), true, 'hidden / fogged');
    assert.equal(hdSwapMoment({ ...on, inView: false }), true, 'off-screen');
  });
  test('construction and factory exits are cover', () => {
    assert.equal(hdSwapMoment({ ...on, constructing: true }), true, 'hologram + build-up');
    assert.equal(hdSwapMoment({ ...on, insideStructure: true }), true, 'unit still inside its factory');
  });
});
