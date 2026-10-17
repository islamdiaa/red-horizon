/**
 * Compact state hash of a running World for replay desync detection (browser-safe, no crypto).
 * Covers the RNG, every player's economy, every unit / structure / projectile and the ore map,
 * hashing floats bit-exactly. Two FNV-1a lanes give 64 bits. Read-only: never touches world.rng.
 */
import type { World } from '../sim/world';

const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);

export function worldHash(world: World): string {
  let a = 0x811c9dc5, b = 0x9747b28c;
  const int = (v: number) => {
    a = Math.imul(a ^ (v | 0), 0x01000193);
    b = Math.imul(b ^ ((v | 0) + 0x9e3779b9), 0x01000193) ^ (b >>> 13);
  };
  const num = (v: number) => { f64[0] = v; int(u32[0]); int(u32[1]); };
  const str = (s: string) => { for (let i = 0; i < s.length; i++) int(s.charCodeAt(i)); int(s.length); };
  const w = world as unknown as { rng: { s: number }; nextId: number; crates: { id: number; x: number; y: number }[] };
  int(world.tick);
  int(w.rng.s);
  int(w.nextId);
  int(world.gameOver ? 1 : 0);
  int(world.winnerTeam);
  for (const p of world.players) {
    num(p.cash); num(p.ore); int(p.storage); int(p.powerOut); int(p.powerUse); int(p.defeated ? 1 : 0);
    for (const q of Object.values(p.queues)) { int(q.items.length); for (const it of q.items) { str(it.type); num(it.progress); } }
    for (const v of Object.values(p.superCharge)) num(v);
  }
  int(world.units.length);
  for (const u of world.units) {
    int(u.id); str(u.ut.id); int(u.owner.id); num(u.x); num(u.y); num(u.hp); num(u.heading); int(u.alive ? 1 : 0);
    int(u.target?.id ?? 0); str(u.order.type);
  }
  int(world.buildings.length);
  for (const b of world.buildings) { int(b.id); str(b.bt.id); int(b.owner.id); int(b.cx); int(b.cy); num(b.hp); }
  int(world.projectiles.length);
  for (const pr of world.projectiles) { num(pr.x); num(pr.y); num(pr.t); }
  for (const c of w.crates ?? []) { int(c.id); num(c.x); num(c.y); }
  if (world.commander) for (const c of world.commander.players) { // [DOCTRINE] Commander rules (Classic worlds: nothing)
    num(c.points); int(c.unlocked.length); int(c.eliteLeft); int(c.rally.size + c.aegis.size + c.offline.size);
    for (const id of c.unlocked) int(c.ready[id] ?? 0);
  }
  const vr = world.variety; // [VARIETY] event schedule and dynamic difficulty (Classic worlds: nothing)
  if (vr) { int(vr.rng); int(vr.rng2); int(vr.next); int(vr.active.length); int(vr.dd.level); int(vr.captures); }
  const ore = world.map.ore;
  for (let i = 0; i < ore.length; i += 4) int(ore[i] | (ore[i + 1] << 8) | (ore[i + 2] << 16) | (ore[i + 3] << 24));
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}
