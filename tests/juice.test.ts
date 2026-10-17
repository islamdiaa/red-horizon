/**
 * Game-feel logic without a GPU or an AudioContext: screen-shake trauma and distance falloff, the
 * clash meter behind the battle music, throttled announcer moments, the audio mix policy (priority tiers,
 * voice stealing), and the particle / beam budgets of the new spectacle recipes (LOD must cut them down).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClashMeter, CLASH_START, EventWindow, FIGHT_MEMORY, MomentTracker, ShakeModel, shakeFalloff } from '../src/render/effects/juicelogic';
import { pickVictim, sfxTier, isSmallArms, ducksSmallArms, type VoiceInfo } from '../src/audio/mixer';
import { ParticleSpec } from '../src/render/effects/particles';
import { BeamSpec } from '../src/render/effects/beams';
import type { FxContext } from '../src/render/effects/context';
import { airBurst, columnPuff, heavyDeath, hitFlash, promotionBurst, explosionExtras, milestoneBurst } from '../src/render/effects/spectacle';
import { setTeslaStyle, teslaBolt, tracerBurst } from '../src/render/effects/weapons';
import { STINGER_INFO } from '../src/audio/stingers';
import { ANNOUNCER_TEXT } from '../src/audio/speech';
import { RECIPES } from '../src/audio/sfx';

const peak = (m: ShakeModel, secs: number, camDist = 25, scale = 1): number => {
  const o = { x: 0, y: 0, z: 0 };
  let p = 0;
  for (let t = 0; t < secs; t += 1 / 60) {
    m.update(1 / 60, o, camDist, scale);
    p = Math.max(p, Math.hypot(o.x, o.y, o.z));
  }
  return p;
};

test('shake: small hits are imperceptible, a dying tank nudges, a nuke rocks; it decays and reduceMotion kills it', () => {
  const small = new ShakeModel();
  small.kick(0.03);
  assert.ok(peak(small, 0.3) < 0.005, 'a cannon hit barely moves the camera');
  const tank = new ShakeModel();
  tank.kick(0.28);
  const pt = peak(tank, 0.3);
  assert.ok(pt > 0.01 && pt < 0.08, `a vehicle death is subtle but felt (${pt.toFixed(3)})`);
  const nuke = new ShakeModel();
  nuke.kick(5);
  assert.ok(peak(nuke, 0.3) > 0.25, 'a nuke shakes hard');
  peak(nuke, 1.5);
  assert.equal(nuke.trauma, 0, 'trauma decays to zero within ~1 s');
  const reduced = new ShakeModel();
  reduced.kick(5);
  assert.equal(peak(reduced, 0.5, 25, 0), 0, 'reduceMotion: no offset at all');
  // smooth noise: neighbouring frames move by much less than the amplitude
  const s = new ShakeModel();
  s.kick(2);
  const a = { x: 0, y: 0, z: 0 }, b = { x: 0, y: 0, z: 0 };
  s.update(1 / 120, a);
  s.update(1 / 120, b);
  assert.ok(Math.hypot(a.x - b.x, a.z - b.z) < s.amplitude() * 0.9, 'consecutive offsets are continuous, not white noise');
});

test('shake falloff: full at the view centre, gone off-screen, monotonic', () => {
  assert.equal(shakeFalloff(0, 0, 12), 1, 'centre');
  assert.equal(shakeFalloff(30, 0, 12), 0, 'well off-screen');
  let prev = 1;
  for (let d = 0; d <= 20; d += 1) {
    const k = shakeFalloff(d, 0, 12);
    assert.ok(k <= prev + 1e-9, `monotonic at ${d}`);
    prev = k;
  }
});

test('clash meter: 25+ fighters on screen start a clash, it winds down after the fighting stops, wins are judged', () => {
  const c = new ClashMeter();
  let t = 0;
  const step = (fighters: number, inView: boolean, secs: number): ('start' | 'end' | null)[] => {
    const out: ('start' | 'end' | null)[] = [];
    for (let i = 0; i < secs * 10; i++) {
      t += 0.1;
      for (let id = 0; id < fighters; id++) c.onFire(id + 1, t, inView);
      out.push(c.update(0.1, t));
    }
    return out;
  };
  assert.ok(!step(20, true, 3).includes('start'), '20 fighters is not a clash');
  assert.ok(!step(40, false, 3).includes('start'), 'off-screen fighting does not count');
  assert.ok(step(CLASH_START + 5, true, 2.5).includes('start'), 'a big fight on screen starts a clash');
  assert.ok(c.active && c.level > 0.2, 'level rises');
  for (let i = 0; i < 9; i++) c.onLoss(false);
  c.onLoss(true);
  c.onLoss(true);
  const tail = step(0, true, FIGHT_MEMORY + 6);
  assert.ok(tail.includes('end'), 'clash ends once the fighting stops');
  assert.ok(c.lastResult?.won, 'a lopsided clash is a win');
  assert.equal(c.lastResult?.enemyLosses, 9);
  step(0, true, 6);
  assert.ok(c.level < 0.15, 'music level eases back down');
});

test('moments: armour call-out after 4 kills in 12 s, throttled; heavy attack needs many attackers', () => {
  const m = new MomentTracker();
  assert.equal(m.enemyArmourLost(0), null);
  assert.equal(m.enemyArmourLost(2), null);
  assert.equal(m.enemyArmourLost(4), null);
  assert.equal(m.enemyArmourLost(6), 'armour_neutralised', '4th kill within 12 s');
  for (let i = 0; i < 4; i++) assert.equal(m.enemyArmourLost(8 + i), null, 'throttled');
  assert.equal(m.enemyArmourLost(60), null, 'window restarted after the call-out');
  m.enemyArmourLost(61); m.enemyArmourLost(62);
  assert.equal(m.enemyArmourLost(63), 'armour_neutralised', 'again after the throttle');
  const b = new MomentTracker();
  let r = null;
  for (let i = 0; i < 40; i++) r = b.baseHit(1 + (i % 3), 100 + i * 0.1) ?? r;
  assert.equal(r, null, '3 attackers pecking at the base is not a heavy attack');
  for (let i = 0; i < 30; i++) r = b.baseHit(10 + (i % 8), 110 + i * 0.1) ?? r;
  assert.equal(r, 'base_heavy_attack', 'many attackers at once');
  assert.equal(b.baseLost(112), null, 'within the any-moment gap');
  const w = new EventWindow(5, 8);
  for (let i = 0; i < 12; i++) w.push(i);
  assert.equal(w.count(11), 6, 'sliding window counts only the last 5 s (capacity-bounded)');
});

test('audio mix: priority tiers and voice stealing never let small arms cut off big guns', () => {
  assert.ok(sfxTier('mg') < sfxTier('cannon_med') && sfxTier('cannon_med') < sfxTier('cannon_heavy') && sfxTier('cannon_heavy') < sfxTier('expl_nuke'), 'tier order');
  assert.ok(isSmallArms('rifle') && !isSmallArms('cannon_heavy'), 'small arms category');
  assert.ok(ducksSmallArms('expl_large') && !ducksSmallArms('rifle'), 'big blasts duck small arms');
  const now = 1;
  const mk = (tier: number, vol: number): VoiceInfo => ({ tier, vol, start: 0.8, end: 2, stopping: false });
  const voices = [mk(3, 0.5), mk(1, 0.9), mk(1, 0.2), mk(2, 0.4)];
  assert.equal(pickVictim(voices, 3, 0.6, now), 2, 'a big gun steals the quietest small-arms voice');
  assert.equal(pickVictim([mk(3, 0.5), mk(3, 0.6)], 1, 1, now), -1, 'small arms never steal a big gun');
  assert.equal(pickVictim([mk(1, 0.9), mk(1, 0.8)], 1, 0.1, now), -1, 'a quiet shot is dropped when its tier is full');
});

test('audio content: new kill punches, stingers and call-outs exist', () => {
  for (const k of ['kill_armor', 'kill_heavy', 'metal_groan', 'debris_rain', 'flak_burst', 'milestone'] as const) assert.ok(RECIPES[k], `recipe ${k}`);
  for (const k of ['battle_joined', 'battle_won', 'milestone'] as const) assert.ok(STINGER_INFO[k], `stinger ${k}`);
  for (const k of ['armour_neutralised', 'base_heavy_attack', 'sector_victorious', 'enemy_base_destroyed'] as const) assert.ok(ANNOUNCER_TEXT[k].length > 5, `announcer ${k}`);
});

/** A recipe context whose batches only count what gets emitted. */
function countingCtx(density = 1): FxContext & { n: { main: number; glow: number; beams: number; lights: number } } {
  const n = { main: 0, glow: 0, beams: 0, lights: 0 };
  const ps = new ParticleSpec();
  const bs = new BeamSpec();
  const batch = (k: 'main' | 'glow') => ({ begin: () => ps.reset(), emit: () => { n[k]++; } });
  const ctx = {
    n,
    main: batch('main'),
    glow: batch('glow'),
    beams: { begin: () => bs.reset(), emit: () => { n.beams++; } },
    sprites: {},
    decals: { add: () => {} },
    lights: { flash: () => { n.lights++; } },
    getHeight: () => 0,
    now: 0,
    addShake: () => {},
    density,
    waterLevel: -1,
    isWater: () => false,
    bodies: {},
    cue: () => {},
    dyn: { add: () => { n.lights++; return 0; }, update: () => true, remove: () => {} },
    gpu: null,
    terrain: null,
  };
  return ctx as unknown as FxContext & { n: typeof n };
}

test('spectacle budgets: recipes stay small and LOD / quality cut them down', () => {
  const full = countingCtx();
  heavyDeath(full, 0, 0, 0, 1.5, 1);
  const hd = full.n.main + full.n.glow;
  assert.ok(hd > 60 && hd < 600, `heavy death particles ${hd}`);
  const far = countingCtx(0.5);
  heavyDeath(far, 0, 0, 0, 1.5, 0.35);
  assert.ok(far.n.main + far.n.glow < hd * 0.75, `LOD + Low density cut the cook-off (${far.n.main + far.n.glow} vs ${hd})`);

  const hit = countingCtx();
  hitFlash(hit, 0, 0.5, 0, 0.3, 1, true, 1);
  assert.ok(hit.n.glow + hit.n.main <= 20 && hit.n.lights === 1, `hit flash is cheap (${hit.n.glow + hit.n.main}) and lights the model`);

  const flak = countingCtx();
  airBurst(flak, 0, 3, 0, 1, 0, 1);
  assert.ok(flak.n.main >= 2 && flak.n.main + flak.n.glow <= 25, `air burst ${flak.n.main + flak.n.glow}`);

  const col = countingCtx();
  columnPuff(col, 0, 0, 0, 1, 1);
  assert.equal(col.n.main, 1, 'one particle per column puff');

  const promo = countingCtx();
  promotionBurst(promo, 0, 0, 0, 0.6, 2);
  assert.ok(promo.n.glow > 10 && promo.n.glow < 60, `promotion burst ${promo.n.glow}`);
  const ms = countingCtx();
  milestoneBurst(ms, 0, 0, 0, 1);
  assert.ok(ms.n.glow > 20 && ms.n.glow < 120, `milestone burst ${ms.n.glow}`);

  const ex = countingCtx();
  for (let i = 0; i < 20; i++) explosionExtras(ex, 'large', 0, 0.2, 0, 0, 1, 1);
  assert.ok(ex.n.main + ex.n.glow < 20 * 70, `explosion variety stays bounded (${ex.n.main + ex.n.glow} for 20 blasts)`);
  const off = countingCtx();
  explosionExtras(off, 'large', 0, 0.2, 0, 0, 1, 0);
  assert.equal(off.n.main + off.n.glow, 0, 'off-screen: no extra layers');

  const tb = countingCtx();
  tracerBurst(tb, 0, 1, 0, 6, 0.5, 0, 2);
  assert.equal(tb.n.beams, 4, 'two follow-up rounds, two beam layers each');

  setTeslaStyle(1);
  const t0 = countingCtx();
  teslaBolt(t0, 0, 2, 0, 5, 0.4, 0);
  setTeslaStyle(1.5);
  const t1 = countingCtx();
  teslaBolt(t1, 0, 2, 0, 5, 0.4, 0);
  setTeslaStyle(1);
  assert.ok(t1.n.beams > t0.n.beams && t1.n.beams < 900, `richer tesla bolt (${t0.n.beams} → ${t1.n.beams} beam segments)`);
});

test('announcer voice preset: default when null / unset, live getters apply at speak time, bad values ignored', async () => {
  const { AudioSystem } = await import('../src/audio/index');
  const a = new AudioSystem();
  const opts = () => (a as unknown as { announcerSpeakOpts(): { pitch: number; rate: number; volume: number } }).announcerSpeakOpts();
  const def = opts();
  assert.equal(def.pitch, 0.92, 'default pitch');
  assert.equal(def.rate, 1.04, 'default rate');
  let style: { gender: string; pitch: number; rate: number } | null = null;
  a.setAnnouncerVoice({ get voiceHint() { return style?.gender; }, get pitch() { return style?.pitch; }, get rate() { return style?.rate; } });
  assert.deepEqual(opts(), def, 'no style equipped = the default announcer');
  style = { gender: 'male', pitch: 0.7, rate: 1.2 };
  assert.equal(opts().pitch, 0.7, 'the equipped style applies at speak time');
  assert.equal(opts().rate, 1.2);
  a.setAnnouncerVoice({ pitch: Number.NaN, rate: 99, volume: 0.5 });
  const bad = opts();
  assert.ok(bad.pitch === 0.92 && bad.rate === 2 && Math.abs(bad.volume - def.volume * 0.5) < 1e-9, 'invalid pitch falls back, rate clamps, volume scales');
  a.setAnnouncerVoice(null);
  assert.deepEqual(opts(), def, 'null restores the default');
});
