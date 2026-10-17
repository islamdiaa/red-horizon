// HD infantry (public/models/infantry, src/render/models/infantry-hd*.ts): the baked vertex animation texture is
// sound (rigid bones, closed loops, every clip a soldier type needs), every soldier GLB is a valid CSP-safe skinned
// mesh on that rig, and the animation state machine maps the game's animation channels to the right clips.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { UNITS } from '../src/data/rules';
import { parseGlb, readAccessor, readVat, sampleBone } from '../src/render/models/infantry-hd';
import { COMBAT_HOLD, ClipLib, InfantryAnimator, TYPE_SET, clipRow, type ClipInfo, type InfSet } from '../src/render/models/infantry-hd-anim';
import type { ModelAnimState } from '../src/render/models/types';

const DIR = join(import.meta.dirname, '..', 'public', 'models', 'infantry');
const MAN = join(DIR, 'manifest.json');
const ALLOWED_EXT = new Set(['KHR_mesh_quantization', 'EXT_texture_webp']);
const PROPS = new Set(['weapon', 'prop']);

interface Entry { file: string; bytes: number; type: string; faction: string | null; kind: string; tris: number }
const man = existsSync(MAN) ? (JSON.parse(readFileSync(MAN, 'utf8')) as { models: Record<string, Entry> }) : null;
const human = existsSync(join(DIR, 'anim.human.glb')) ? readVat(parseGlb(readFileSync(join(DIR, 'anim.human.glb')))) : null;

/** Model-space joint position of bone b at a texture row: S(row) @ rest. */
function joint(v: NonNullable<typeof human>, row: number, b: number, rest: number[][]): [number, number, number] {
  const s = sampleBone(v.data, v.width, v.height, row, b, new Float32Array(12));
  const [x, y, z] = rest[b];
  return [s[0] * x + s[1] * y + s[2] * z + s[3], s[4] * x + s[5] * y + s[6] * z + s[7], s[8] * x + s[9] * y + s[10] * z + s[11]];
}

describe('HD infantry: vertex animation texture (anim.human.glb)', () => {
  test('the clip set is present', () => {
    assert.ok(human, 'public/models/infantry/anim.human.glb exists (node tools/assets/build.mjs anim.human)');
  });
  if (!human) return;
  const meta = human.meta;
  const bones: string[] = meta.bones;
  const clips: ClipInfo[] = meta.clips;

  test('layout: 3 texels per bone, clips stacked without gaps or overlaps', () => {
    assert.equal(human.width, bones.length * 3, 'width = 3 * bones');
    assert.equal(meta.parents.length, bones.length, 'a parent per bone');
    let row = 0;
    for (const c of clips) {
      assert.equal(c.row, row, `${c.name} starts right after the previous clip`);
      assert.ok(c.frames >= 2, `${c.name} has at least two frames`);
      assert.ok(c.duration > 0 && c.fps > 0, `${c.name} has a duration and a rate`);
      row += c.frames;
    }
    assert.equal(row, human.height, 'the clips fill the texture');
    assert.ok(human.data.every((x) => Number.isFinite(x)), 'every texel is finite');
  });

  test('bones stay rigid in every frame (joint distances match the rest pose within 3 mm)', () => {
    const rest: number[][] = meta.rest;
    let worst = 0;
    let at = '';
    for (const c of clips) {
      for (let f = 0; f < c.frames; f++) {
        const row = c.row + f;
        for (let b = 0; b < bones.length; b++) {
          const p = meta.parents[b];
          if (p < 0 || PROPS.has(bones[b])) continue;
          const a = joint(human, row, b, rest);
          const q = joint(human, row, p, rest);
          const d = Math.hypot(a[0] - q[0], a[1] - q[1], a[2] - q[2]);
          const d0 = Math.hypot(rest[b][0] - rest[p][0], rest[b][1] - rest[p][1], rest[b][2] - rest[p][2]);
          if (Math.abs(d - d0) > worst) { worst = Math.abs(d - d0); at = `${c.name}#${f} ${bones[b]}`; }
        }
      }
    }
    assert.ok(worst < 0.003, `worst bone length error ${(worst * 1000).toFixed(2)} mm at ${at}`);
  });

  test('loops close: the last frame repeats the first', () => {
    for (const c of clips.filter((x) => x.loop)) {
      const a = c.row * human.width * 4;
      const b = (c.row + c.frames - 1) * human.width * 4;
      let d = 0;
      for (let k = 0; k < human.width * 4; k++) d = Math.max(d, Math.abs(human.data[a + k] - human.data[b + k]));
      assert.ok(d < 1e-3, `${c.name}: last frame = first (max delta ${d})`);
    }
  });

  test('feet stay on (or above) the ground and heads up while standing', () => {
    const rest: number[][] = meta.rest;
    const fl = bones.indexOf('foot_l');
    const head = bones.indexOf('head');
    for (const c of clips.filter((x) => /\.(idle|aim|walk|run)$/.test(x.name))) {
      for (let f = 0; f < c.frames; f++) {
        const y = joint(human, c.row + f, fl, rest)[1];
        assert.ok(y > 0.012 && y < 0.2, `${c.name}#${f}: ankle height ${y.toFixed(3)}`);
        const kneel = /launcher\.aim|crouch/.test(c.name);
        assert.ok(joint(human, c.row + f, head, rest)[1] > (kneel ? 0.2 : 0.27), `${c.name}#${f}: head up`);
      }
    }
    for (const c of clips.filter((x) => x.name.startsWith('death.'))) {
      const y = joint(human, c.row + c.frames - 1, head, rest)[1];
      assert.ok(y < 0.09, `${c.name}: ends lying down (head at ${y.toFixed(3)})`);
    }
  });

  test('every soldier type finds the clips it needs', () => {
    const lib = new ClipLib(clips, 0.39);
    const need: [string, string][] = [['idle', ''], ['run', ''], ['walk', '']];
    for (const [type, set] of Object.entries(TYPE_SET)) {
      if (set === 'dog') continue;
      for (const [st] of need) assert.ok(lib.forState(set, st as never), `${type} (${set}) has ${st}`);
      const fire = set === 'grenade' ? 'throw' : ['medi', 'mech', 'e6'].includes(type) ? 'use' : 'fire';
      if (UNITS[type]?.primary) assert.ok(lib.forState(set, fire as never), `${type} (${set}) has ${fire}`);
      for (const k of ['normal', 'blown', 'burn', 'electro', 'bite', 'crushed'] as const) assert.ok(lib.death(set, k, 0.3), `${type} death ${k}`);
    }
    assert.ok(lib.forState('rifle', 'para'), 'paratroopers have their descent');
  });
});

describe('HD infantry: soldier GLBs', () => {
  test('manifest lists soldiers', () => {
    assert.ok(man && Object.values(man.models).some((e) => e.kind === 'infantry'), 'public/models/infantry/manifest.json lists infantry models');
  });
  for (const [key, e] of Object.entries(man?.models ?? {})) {
    if (e.kind !== 'infantry') continue;
    test(`${key}: valid skinned GLB on the shared rig, within budget`, () => {
      const file = join(DIR, e.file);
      assert.ok(existsSync(file), `${e.file} exists`);
      assert.equal(statSync(file).size, e.bytes, `${key}: manifest bytes match the file`);
      assert.ok(UNITS[e.type]?.kind === 'infantry', `${key}: ${e.type} is an infantry type`);
      assert.ok(e.type in TYPE_SET, `${key}: has a clip set`);
      assert.ok(e.bytes <= 250_000, `${key}: ${e.bytes} bytes within 250 KB`);
      assert.ok(e.tris <= 3000, `${key}: ${e.tris} triangles within 3000`);
      const g = parseGlb(readFileSync(file));
      for (const x of [...(g.json.extensionsUsed ?? []), ...(g.json.extensionsRequired ?? [])]) assert.ok(ALLOWED_EXT.has(x), `${key}: extension ${x} allowed (CSP)`);
      for (const im of g.json.images) assert.equal(im.mimeType, 'image/webp', `${key}: embedded WebP`);
      const rigBones: string[] = e.type === 'dog' ? [] : human?.meta.bones ?? [];
      const skin = g.json.skins[0];
      if (rigBones.length) {
        assert.equal(skin.joints.length, rigBones.length, `${key}: skin joints = rig bones`);
        skin.joints.forEach((n: number, i: number) => assert.equal(g.json.nodes[n].name, rigBones[i], `${key}: joint ${i} is ${rigBones[i]}`));
      }
      const nb = skin.joints.length;
      const tris: number[] = [];
      for (const m of g.json.meshes) {
        const p = m.primitives[0];
        const j = readAccessor(g, p.attributes.JOINTS_0);
        const w = readAccessor(g, p.attributes.WEIGHTS_0);
        for (let i = 0; i < j.count; i++) {
          assert.ok(j.array[i * 4] < nb && j.array[i * 4 + 1] < nb, `${key}: joint index in range`);
          const s = w.array[i * 4] + w.array[i * 4 + 1] + w.array[i * 4 + 2] + w.array[i * 4 + 3];
          if (s !== 255) assert.fail(`${key}: weights of vertex ${i} sum to ${s}/255`);
        }
        tris.push(readAccessor(g, p.indices).count / 3);
        assert.ok(m.extras?.rh_dequant?.s > 0, `${key}: dequantisation stored`);
      }
      assert.equal(tris.length, 2, `${key}: a body and its far LOD`);
      assert.ok(tris[1] < tris[0] * 0.7, `${key}: the far LOD is lighter (${tris[1]} vs ${tris[0]})`);
      const meta = g.json.nodes[g.json.scenes[0].nodes[0]].extras.rh;
      assert.ok(meta.height >= (e.type === 'dog' ? 0.15 : 0.3) && meta.radius > 0.05, `${key}: height / radius for rings and health bars`);
      const muzzles = (g.json.nodes as { extras?: { rh_point?: string } }[]).filter((n) => n.extras?.rh_point === 'muzzle').length;
      if (e.type !== 'e6' && e.type !== 'spy') assert.ok(muzzles >= 1, `${key}: has a muzzle point`);
    });
  }
});

describe('HD infantry: animation state mapping', () => {
  const clip = (name: string, frames: number, duration: number, loop: boolean, extra: Partial<ClipInfo> = {}): ClipInfo => ({ name, row: 0, frames, duration, fps: 20, loop, ...extra });
  const names = ['rifle.idle', 'rifle.idle2', 'rifle.idle3', 'rifle.walk', 'rifle.run', 'rifle.aim', 'rifle.fire', 'rifle.reload', 'unarmed.idle', 'unarmed.run', 'unarmed.walk', 'unarmed.use',
    'grenade.aim', 'grenade.throw', 'pistol.idle', 'pistol.run', 'pistol.aim', 'pistol.fire', 'pistol.fire2', 'para', 'death.back', 'death.front', 'death.blown', 'death.burn', 'death.electro'];
  let row = 0;
  const clips = names.map((n) => {
    const loop = !/fire|throw|reload|death/.test(n);
    const dur = n.endsWith('.run') ? 0.62 : n.endsWith('.walk') ? 1 : /fire/.test(n) ? 0.35 : /death/.test(n) ? 1.3 : n.endsWith('throw') ? 0.9 : 2;
    const c = clip(n, Math.round(dur * 20) + 1, dur, loop, n.endsWith('.run') ? { stride: 0.3 } : n.endsWith('.walk') ? { stride: 0.136 } : {});
    c.row = row;
    row += c.frames;
    return c;
  });
  const lib = new ClipLib(human ? (human.meta.clips as ClipInfo[]) : clips, 0.39);
  const S = (o: Partial<ModelAnimState> = {}): ModelAnimState => ({ time: 0, dt: 1 / 60, moving: false, speed: 0, firing: 0, firingMuzzle: 0, powered: true, health: 1, door: 0, load: 0, harvesting: false, charge: 1, dying: 0, ...o });
  const run = (a: InfantryAnimator, frames: number, s: Partial<ModelAnimState>, speed = 0) => { for (let i = 0; i < frames; i++) a.update(S(s), speed, 1 / 60); };
  const mk = (set: InfSet, type: string) => { const a = new InfantryAnimator(lib, set, type, 0.3); a.scale = 1.3; return a; };

  test('idle when standing, run when moving, walk when slow', () => {
    const a = mk('rifle', 'e1');
    run(a, 5, {});
    assert.equal(a.cur?.clip.name, 'rifle.idle', 'standing -> idle');
    run(a, 30, { moving: true, speed: 1 }, 0.8);
    assert.equal(a.cur?.clip.name, 'rifle.run', 'moving at speed -> run');
    run(a, 60, { moving: true, speed: 0.3 }, 0.12);
    assert.equal(a.cur?.clip.name, 'rifle.walk', 'slow -> walk');
  });

  test('the run plays at the ground speed (feet stay planted)', () => {
    const a = mk('rifle', 'e1');
    run(a, 90, { moving: true, speed: 1 }, 0.62);
    const c = a.cur!;
    const base = (c.clip.stride! * 1.3) / c.clip.duration;
    assert.ok(Math.abs(c.rate - Math.min(1.8, Math.max(0.55, 0.62 / base))) < 0.05, `rate ${c.rate.toFixed(2)} follows the ground speed`);
  });

  test('a shot plays fire, then the soldier keeps aiming, then idles again', () => {
    const a = mk('rifle', 'e1');
    run(a, 5, {});
    a.update(S({ firing: 1 }), 0, 1 / 60);
    assert.equal(a.cur?.clip.name, 'rifle.fire', 'shot -> fire');
    run(a, 40, { firing: 0 });
    assert.equal(a.cur?.clip.name, 'rifle.aim', 'after the shot -> aim');
    run(a, Math.ceil(COMBAT_HOLD * 60) + 30, {});
    assert.ok(/rifle\.idle/.test(a.cur?.clip.name ?? ''), 'combat over -> idle');
  });

  test('idle variants play once now and then, then back to the plain idle', () => {
    const a = mk('rifle', 'e1');
    const seen = new Set<string>();
    for (let i = 0; i < 60 * 40; i++) { a.update(S({}), 0, 1 / 60); seen.add(a.cur!.clip.name); }
    assert.ok(seen.has('rifle.idle') && (seen.has('rifle.idle2') || seen.has('rifle.idle3')), `variants seen: ${[...seen].join(', ')}`);
    assert.ok(/rifle\.idle\d?$/.test(a.cur!.clip.name), 'still idling');
    const l = mk('launcher', 'e3');
    for (let i = 0; i < 60 * 40; i++) { l.update(S({}), 0, 1 / 60); assert.ok(l.cur!.clip.name.startsWith('launcher.'), `launcher idles in its own set (${l.cur!.clip.name})`); }
  });

  test('cross-fades between clips', () => {
    const a = mk('rifle', 'e1');
    run(a, 60, {});
    run(a, 1, { moving: true, speed: 1 }, 0.8);
    const r = a.rows({ a: 0, b: 0, w: 0 });
    assert.ok(r.w > 0.5, `the previous clip still dominates right after the change (w ${r.w.toFixed(2)})`);
    run(a, 30, { moving: true, speed: 1 }, 0.8);
    assert.equal(a.rows({ a: 0, b: 0, w: 0 }).w, 0, 'the fade completes');
  });

  test('per-type actions: grenades are thrown, medics work, Tanya alternates guns', () => {
    const g = mk('grenade', 'e2');
    g.update(S({ firing: 1 }), 0, 1 / 60);
    assert.equal(g.cur?.clip.name, 'grenade.throw', 'grenadier -> throw');
    const m = mk('unarmed', 'medi');
    m.update(S({ firing: 1 }), 0, 1 / 60);
    assert.equal(m.cur?.clip.name, 'unarmed.use', 'medic heals -> use');
    const t = mk('pistol', 'e7');
    t.update(S({ firing: 1, firingMuzzle: 1 }), 0, 1 / 60);
    assert.equal(t.cur?.clip.name, 'pistol.fire2', 'second gun -> fire2');
  });

  test('deaths by kind, parachutes', () => {
    for (const [kind, want] of [['burn', 'death.burn'], ['electro', 'death.electro'], ['blown', 'death.blown'], ['bite', 'death.front']] as const) {
      const a = mk('rifle', 'e1');
      run(a, 3, {});
      a.update(S({ dying: 0.1, deathKind: kind }), 0, 1 / 60);
      assert.equal(a.cur?.clip.name, want, `${kind} -> ${want}`);
    }
    const c = mk('rifle', 'e1');
    c.update(S({ dying: 0.1, deathKind: 'crushed' }), 0, 1 / 60);
    assert.equal(c.cur?.t, c.cur?.clip.duration, 'crushed: lying already (the end of the fall)');
    const p = mk('rifle', 'e1');
    p.update(S({ parachute: 1 }), 0, 1 / 60);
    assert.equal(p.cur?.clip.name, 'para', 'parachute -> para');
  });

  test('clip rows: loops wrap, one-shots clamp', () => {
    const l = clip('x', 21, 1, true);
    l.row = 100;
    assert.equal(clipRow(l, 0), 100);
    assert.ok(Math.abs(clipRow(l, 0.5) - 110) < 1e-9, 'mid loop');
    assert.ok(Math.abs(clipRow(l, 1.25) - 105) < 1e-9, 'wraps');
    const o = clip('y', 11, 0.5, false);
    o.row = 10;
    assert.equal(clipRow(o, 2), 20, 'clamps at the last frame');
  });
});
