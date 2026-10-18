/**
 * Conquest battles. When the player commits to a battle the run freezes a BattleSpec (it travels in
 * GameSetup.conquest and therefore in save games); conquestMission() turns it into a MissionDef for the
 * MissionRuntime: the battlefield, both armies (the core veterans with their ranks), objectives per battle kind,
 * scripted enemy pressure shaped by the enemy commander's personality, perk effects and the radio.
 * battleOutcome() reads the finished world back into the run (survivors, recruits, credits, objectives).
 *
 * Deterministic: setup / update only use the spec and world.rng, and keep their state in m.flags.
 */
import { BUILDINGS, UNITS, type Faction } from '../data/rules';
import type { AIDifficulty } from '../sim/ai';
import type { MissionDef, MissionMapSpec, MissionPlayerSpec, MissionRuntime, Portrait } from '../sim/mission';
import { Building, Unit } from '../sim/entities';
import type { World } from '../sim/world';
import { launchSortie } from '../sim/powers';
import { MISSIONS } from '../missions';
import { edgeNear, ground, hunt, huntWave, layout, nudgeEntries, quietSetup } from '../missions/common';
import type { Climate, Terrain } from './geo';
import { ENEMY_POOLS, PERSONALITIES, type PersonalityId } from './data';
import { BATTLE as T, BATTLE_LOCAL as TL } from '../i18n/en/conquest-battle'; // the English these battles emit
import { fill as en } from './text';

export type BattleKind = 'assault' | 'capture' | 'hold' | 'defend' | 'naval' | 'boss';
export const BATTLE_KINDS: BattleKind[] = ['assault', 'capture', 'hold', 'defend', 'naval', 'boss'];

/** Battle types (English: src/i18n/en/conquest-battle.ts, translated where shown). */
export const KIND_INFO: Record<BattleKind, { name: string; icon: string; desc: string }> = {
  assault: { ...T.kind.assault, icon: 'crosshair' },
  capture: { ...T.kind.capture, icon: 'capture' },
  hold: { ...T.kind.hold, icon: 'flag' },
  defend: { ...T.kind.defend, icon: 'shield' },
  naval: { ...T.kind.naval, icon: 'anchor' },
  boss: { ...T.kind.boss, icon: 'skull' },
};

/** A core veteran deployed into the battle. */
export interface CoreSlot {
  vet: number;
  type: string;
  rank: number;
  xp: number;
  name: string;
}

/** Perk / research / territory effects resolved for one battle. */
export interface BattleMods {
  buildSpeed: number;
  income: number;
  /** Extra battle tanks in the landing force. */
  tanks: number;
  outpost: boolean;
  commandos: boolean;
  engineers: number;
  drill: boolean;
  tankAces: boolean;
  bounty: boolean;
  cheapNavy: boolean;
  recon: boolean;
  /** Superweapons start this charged (fraction). */
  superCharge: number;
  /** Extra pre-built defences in defence battles. */
  fortified: boolean;
  /** Starting warships in naval battles. */
  escorts: number;
  /** Paratrooper sticks: seconds into the battle and the rank they land with. */
  drops: { at: number; rank: number }[];
}

export type BattleMap = MissionMapSpec & { mapId?: string; rocks?: number };

export interface BattleSpec {
  v: number;
  id: string;
  runId: string;
  territory: string;
  name: string;
  /** Territory the attack comes from (name, '' for a defence) and its id (the attacking enemy territory for a defence). */
  from: string;
  fromId: string;
  kind: BattleKind;
  turn: number;
  date: string;
  faction: Faction;
  enemy: Faction;
  neutral: boolean;
  commander: string;
  personality: PersonalityId;
  strength: number;
  ai: AIDifficulty;
  terrain: Terrain;
  climate: Climate;
  map: BattleMap;
  mapLabel: string;
  credits: number;
  enemyCredits: number;
  core: CoreSlot[];
  allowed: string[];
  mods: BattleMods;
  partisans: boolean;
  superweapon: 'nuke' | 'iron' | 'chrono' | null;
  fort: number;
  parTime: number;
}

/** What GameSetup.conquest carries (src/game.ts). */
export interface ConquestSetup {
  runId: string;
  territory: string;
  battle: BattleSpec;
}

// =====================================================================================================
// Battlefields
// =====================================================================================================
const HOURS = [7.5, 9, 10.5, 12, 13.5, 15, 16.5, 18, 19.5, 22];

/** Pick the battlefield for a battle: generator options (or a curated map) matching the territory. */
export function battleMap(kind: BattleKind, terrain: Terrain, climate: Climate, seed: number, strength: number): { map: BattleMap; label: string } {
  const size = kind === 'boss' ? 80 : kind === 'naval' ? 72 : strength >= 4 ? 72 : 64;
  const hour = HOURS[seed % HOURS.length];
  const base: BattleMap = { size, seed, players: kind === 'boss' ? 3 : 2, climate, hour, weather: 'auto', dayCycle: true, ore: 0.7, trees: 0.45, water: 0.3 };
  const pick = (n: number) => (seed >>> 3) % n === 0;
  if (kind === 'boss') return { map: { ...base, water: 0.25, trees: 0.4, ore: 0.85, rocks: 0.25 }, label: T.map.capital };
  if (kind === 'naval') {
    if (terrain === 'islands' && climate !== 'winter') return { map: { ...base, size: 96, mapId: 'archipelago' }, label: T.map.archipelago };
    return { map: { ...base, water: 0.95, trees: 0.4, ore: 0.75 }, label: climate === 'winter' ? T.map.frozenCoast : T.map.coastalWaters };
  }
  switch (terrain) {
    case 'plains': return { map: { ...base, water: 0.25, trees: 0.35, ore: 0.75 }, label: T.map.farmland };
    case 'forest': return { map: { ...base, water: 0.3, trees: 0.9, ore: 0.6 }, label: T.map.forest };
    case 'mountain':
      if (climate === 'desert' && pick(2)) return { map: { ...base, size: 96, mapId: 'red-canyon' }, label: T.map.canyon };
      return { map: { ...base, water: 0.1, trees: 0.45, ore: 0.65, rocks: 0.85 }, label: T.map.pass };
    case 'lakes':
      if (climate === 'winter' && pick(2)) return { map: { ...base, size: 96, mapId: 'frozen-lakes' }, label: T.map.frozenLakes };
      return { map: { ...base, water: 0.75, trees: 0.55, ore: 0.65 }, label: T.map.lakes };
    case 'river':
      if (climate !== 'desert' && climate !== 'winter' && pick(3)) return { map: { ...base, size: 96, mapId: 'bridgewater' }, label: T.map.bridgewater };
      return { map: { ...base, water: 0.62, trees: 0.45, ore: 0.7 }, label: T.map.river };
    case 'coast': return { map: { ...base, water: 0.92, trees: 0.4, ore: 0.75 }, label: T.map.coastline };
    case 'urban': return { map: { ...base, water: 0.3, trees: 0.2, ore: 0.9 }, label: T.map.industrial };
    case 'steppe': return { map: { ...base, water: 0.12, trees: 0.1, ore: 0.85 }, label: T.map.steppe };
    case 'islands': return { map: { ...base, water: 0.8, trees: 0.45, ore: 0.7 }, label: T.map.islands };
  }
  return { map: base, label: T.map.default };
}

/** Sea maps let the human build naval yards whatever the research. */
export function isSeaBattle(S: Pick<BattleSpec, 'map'>): boolean {
  return (S.map.water ?? 0) >= 0.9 || S.map.mapId === 'archipelago';
}
const NAVAL_TYPES = ['syrd', 'spen', 'pt', 'dd', 'ss', 'lst'];

// =====================================================================================================
// Cast & helpers
// =====================================================================================================
const COLOR: Record<Faction, number> = { allies: 0x3d7be0, soviet: 0xd23a2c };
const NEUTRAL_COLOR = 0xe0b030, GUARD_COLOR = 0xe07b2a;
const mainTank = (f: Faction) => (f === 'allies' ? '2tnk' : '3tnk');
const B = (f: Faction, allies: string, soviet: string) => (f === 'allies' ? allies : soviet);
const TANKS = new Set(['1tnk', '2tnk', '3tnk', '4tnk', 'ttnk', 'ctnk', 'qtnk', 'stnk']);

function hq(S: BattleSpec): { name: string; portrait: Portrait } {
  return S.faction === 'allies' ? { name: T.speaker.allied, portrait: 'commander' } : { name: T.speaker.soviet, portrait: 'enemy' };
}
const INTEL: { name: string; portrait: Portrait } = { name: T.speaker.intel, portrait: 'intel' };
function foe(S: BattleSpec): { name: string; portrait: Portrait } {
  return { name: S.commander, portrait: S.enemy === 'soviet' ? 'enemy' : 'commander' };
}
const say = (m: MissionRuntime, who: { name: string; portrait: Portrait }, text: string) => m.say(who.name, text, who.portrait);
export const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** Non-wall, non-mine structures of every enemy of the human. */
function enemyStructures(m: MissionRuntime): Building[] {
  return m.world.buildings.filter((b) => b.alive && m.human.isEnemy(b.owner) && !b.bt.wall && !b.bt.mine);
}

/** Centre of the human base (construction yard, else structures, else the landing zone). */
function humanBase(m: MissionRuntime): [number, number] {
  const bs = m.buildings(0).filter((b) => !b.bt.wall && !b.bt.mine);
  const fact = bs.find((b) => b.bt.id === 'fact');
  if (fact) return [fact.x, fact.y];
  if (bs.length) return [bs.reduce((s, b) => s + b.x, 0) / bs.length, bs.reduce((s, b) => s + b.y, 0) / bs.length];
  const s = m.start(0);
  return [s.x, s.y];
}

/** A free naval spot in the water nearest to a point (null if there is no water around). */
function waterSpot(m: MissionRuntime, x: number, y: number, r = 14): [number, number] | null {
  const [wx, wy] = m.world.findFreeSpot(x, y, r, true, true);
  return m.world.map.navalPassable(Math.floor(wx), Math.floor(wy)) ? [wx, wy] : null;
}

/** Place a water structure (shipyard / sub pen) on open water close to a point, touching the shore. */
function placeOnWater(m: MissionRuntime, p: number, type: string, x: number, y: number): Building | null {
  const bt = BUILDINGS[type];
  const map = m.world.map;
  const [w, h] = bt.size;
  for (let r = 0; r <= 14; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const cx = Math.round(x) + dx, cy = Math.round(y) + dy;
      let ok = true, shore = false;
      for (let yy = -1; yy <= h && ok; yy++) for (let xx = -1; xx <= w; xx++) {
        const qx = cx + xx, qy = cy + yy;
        if (!map.inBounds(qx, qy)) { ok = false; break; }
        const i = map.idx(qx, qy);
        const inner = xx >= 0 && yy >= 0 && xx < w && yy < h;
        if (inner && (map.terrain[i] !== 1 || map.occupant[i])) { ok = false; break; }
        if (!inner && map.terrain[i] !== 1) shore = true;
      }
      if (!ok || !shore) continue;
      const b = m.placeBuilding(p, type, cx, cy);
      if (b) return b;
    }
  }
  return null;
}

/** Fill a list of unit types from a pool up to a budget (world.rng). */
function fill(m: MissionRuntime, pool: string[], budget: number, out: string[], cap: number) {
  let spent = 0;
  for (let guard = 0; spent < budget && out.length < cap && guard < 60; guard++) {
    const t = m.world.rng.pick(pool);
    if (!UNITS[t]) continue;
    out.push(t);
    spent += UNITS[t].cost;
  }
}

/** Unit mix for a garrison / wave by personality. */
function armyMix(m: MissionRuntime, f: Faction, pers: PersonalityId, budget: number, cap = 14, air = false, sea = false): string[] {
  const P = ENEMY_POOLS[f];
  const out: string[] = [];
  const split: [string[], number][] = (() => {
    switch (pers) {
      case 'steamroller': return [[P.armour, 0.55], [P.heavy, 0.25], [P.inf, 0.2]];
      case 'siege': return [[P.arty, 0.4], [P.armour, 0.35], [P.inf, 0.25]];
      case 'blitz': return [[P.light, 0.6], [P.armour, 0.3], [P.inf, 0.1]];
      case 'horde': return [[P.inf, 0.8], [P.armour, 0.2]];
      case 'raider': return [[P.light, 0.7], [P.inf, 0.3]];
      case 'fortress': return [[P.armour, 0.5], [P.inf, 0.5]];
      default: return [[P.armour, 0.5], [P.inf, 0.5]];
    }
  })();
  for (const [pool, frac] of split) fill(m, pool, budget * frac, out, cap);
  if (air) for (let k = 0; k < 2 + Math.floor(budget / 2500); k++) out.push(m.world.rng.pick(P.air));
  if (sea) for (let k = 0; k < 1 + Math.floor(budget / 3000); k++) out.push(m.world.rng.pick(P.navy));
  return out;
}

const DEFENCES: Record<Faction, string[]> = {
  allies: ['pbox', 'gun', 'pbox', 'agun', 'gun', 'gun', 'pbox', 'agun', 'gun', 'pbox', 'gun'],
  soviet: ['ftur', 'tsla', 'ftur', 'sam', 'tsla', 'ftur', 'tsla', 'sam', 'ftur', 'tsla', 'tsla'],
};

/** Keep a player's power positive by adding power plants behind the base. */
function topUpPower(m: MissionRuntime, p: number, anchor: { x: number; y: number }, facing: { x: number; y: number }) {
  const pl = m.player(p);
  for (let k = 0; k < 4 && pl.powerUse > pl.powerOut; k++) layout(m, p, anchor, facing, [[k % 2 ? 'apwr' : 'powr', -6 - k, k % 2 ? 7 : -7]]);
}

interface BaseOpts { capture?: boolean; superweapon?: 'nuke' | 'iron' | 'chrono' | null; sea?: boolean }

/** A pre-built enemy base sized by garrison strength and shaped by the commander's personality. */
function enemyBase(m: MissionRuntime, p: number, anchor: { x: number; y: number }, facing: { x: number; y: number }, str: number, pers: PersonalityId, opts: BaseOpts) {
  const f = m.player(p).faction;
  const items: [string, number, number][] = [['fact', 0, 0], ['powr', -3.5, 3.5], ['proc', -1.5, -5], [B(f, 'tent', 'barr'), 3.5, 4]];
  if (str >= 2) items.push(['weap', 3.5, -3], ['powr', -4.5, -1]);
  if (str >= 3) items.push(['dome', -6, 4.5], ['powr', -7, -3]);
  if (str >= 4) items.push([B(f, 'atek', 'stek'), -2, 8], ['apwr', -8, 1], ['proc', 2, -9]);
  if (str >= 5) items.push(['fix', 6.5, 1], ['weap', 6, -7], ['apwr', -9, -6]);
  if (str >= 6) items.push(['apwr', -5, -9], [B(f, 'hpad', 'afld'), -2, -11]);
  if (pers === 'air' && str >= 2) items.push([B(f, 'hpad', 'afld'), -6, 8.5]);
  if (pers === 'fortress' && str >= 3 && f === 'soviet') items.push(['kenn', 1, 7]);
  const placed = layout(m, p, anchor, facing, items);
  const fact = placed[0];
  if (fact) m.flags[`fact${p}`] = fact.id;
  // a harvester for every refinery (instant structures do not deliver their free unit)
  for (const b of placed) if (b && b.bt.id === 'proc') m.spawnUnit(p, 'harv', b.x + 1, b.y + 2);
  if (opts.capture) {
    const [cp] = layout(m, p, anchor, facing, [[str >= 3 ? B(f, 'atek', 'stek') : 'dome', -3.5, -0.5]]);
    if (cp) { m.flags.target = cp.id; m.flags.targetName = cp.bt.name; }
  }
  if (opts.superweapon) {
    // the Iron Curtain is Soviet and the Chronosphere Allied: each side readies its own device
    const t = opts.superweapon === 'nuke' ? 'mslo' : f === 'allies' ? 'pdox' : 'iron';
    const [sw] = layout(m, p, anchor, facing, [[t, -7, -0.5]]);
    if (sw) {
      m.flags.sw = sw.id;
      m.flags.swName = sw.bt.name;
      const kind = sw.bt.superweapon;
      if (kind) m.setSuperCharge(p, kind, kind === 'nuke' ? -200 : -150);
    }
  }
  // defences in an arc facing the attacker (the heavy ones only for stronger garrisons)
  const n = Math.max(1, Math.min(11, str + (pers === 'fortress' ? 2 : 0) - (pers === 'blitz' || pers === 'raider' ? 1 : 0) + (str >= 6 ? 2 : 0)));
  const list = DEFENCES[f];
  const defs: [string, number, number][] = [];
  for (let k = 0; k < n; k++) {
    let t = list[k % list.length];
    if (str < 3 && (t === 'tsla' || t === 'gun')) t = B(f, 'pbox', 'ftur');
    if (str < 2 && (t === 'sam' || t === 'agun')) t = B(f, 'pbox', 'ftur');
    if (pers === 'air' && k === 1 && str >= 2) t = B(f, 'agun', 'sam');
    if (!BUILDINGS[t]) continue;
    const row = Math.floor(k / 2);
    defs.push([t, 7.8 - row * 0.4, (k % 2 ? 1 : -1) * (2.2 + row * 2.6)]);
  }
  layout(m, p, anchor, facing, defs);
  topUpPower(m, p, anchor, facing);
  // garrison
  const value = 400 + 420 * str;
  const left = armyMix(m, f, pers, value * 0.55, 10);
  const right = armyMix(m, f, pers, value * 0.45, 10);
  const L = m.toward(anchor, facing, 4.5, 3.5), R = m.toward(anchor, facing, 4.5, -3.5);
  const spawn = (types: string[], at: [number, number]) => {
    const [gx, gy] = ground(m, at[0], at[1], 6);
    const heading = Math.atan2(facing.y - gy, facing.x - gx);
    for (const t of types) {
      if (UNITS[t]?.kind === 'aircraft' || UNITS[t]?.kind === 'naval') continue;
      const u = m.spawnUnit(p, t, gx, gy, heading);
      if (str >= 5 && u.kind !== 'infantry') u.rank = 1;
    }
  };
  spawn(left, L);
  spawn(right, R);
  if (opts.sea) {
    const bay = m.toward(anchor, { x: m.mapW / 2, y: m.mapH / 2 }, 12);
    const yard = placeOnWater(m, p, B(f, 'syrd', 'spen'), bay[0], bay[1]);
    if (yard) m.flags.yards = [...(m.flags.yards ?? []), yard.id];
    const ships = Math.min(6, 1 + Math.ceil(str * 0.8));
    for (let k = 0; k < ships; k++) {
      const t = m.world.rng.pick(ENEMY_POOLS[f].navy);
      const spot = waterSpot(m, bay[0], bay[1], 12);
      if (spot) m.world.addUnit(t, m.player(p), spot[0], spot[1]);
    }
  }
}

// =====================================================================================================
// Setup
// =====================================================================================================
function landingForce(m: MissionRuntime, S: BattleSpec) {
  const s = m.start(0), e = m.start(1);
  const f = S.faction;
  const heading = Math.atan2(e.y - s.y, e.x - s.x);
  if (S.kind === 'defend') {
    // our territory: a standing base to hold
    const items: [string, number, number][] = [['fact', 0, 0], ['powr', -3.5, 3.5], ['powr', -3.5, -1], ['proc', -1.5, -5.5], [B(f, 'tent', 'barr'), 3.5, 4], ['weap', 3.5, -3]];
    const placed = layout(m, 0, s, e, items);
    if (placed[0]) m.flags.hq = placed[0].id;
    for (const b of placed) if (b && b.bt.id === 'proc') m.spawnUnit(0, 'harv', b.x + 1, b.y + 2);
    const n = 2 + 2 * S.fort + (S.mods.fortified ? 2 : 0);
    const list = DEFENCES[f];
    layout(m, 0, s, e, Array.from({ length: n }, (_, k) => [list[k % list.length], 7 - Math.floor(k / 2) * 0.4, (k % 2 ? 1 : -1) * (2.5 + Math.floor(k / 2) * 2.8)] as [string, number, number]));
    topUpPower(m, 0, s, e);
  } else {
    m.spawnUnit(0, 'mcv', s.x, s.y, heading);
  }
  const kit = ['e1', 'e1', 'e1', 'e3', mainTank(f)];
  for (let k = 0; k < S.mods.tanks; k++) kit.push(mainTank(f));
  for (let k = 0; k < S.mods.engineers; k++) kit.push('e6');
  if (S.kind === 'capture') kit.push('e6', 'e6');
  if (S.mods.commandos) kit.push(...(f === 'allies' ? ['e7'] : ['e4', 'e4', 'e4', 'dog', 'dog']));
  kit.forEach((t, k) => {
    if (!UNITS[t]) return;
    const [x, y] = m.toward(s, e, 3 + (k % 2) * 1.2, (k % 5 - 2) * 1.3);
    const [gx, gy] = ground(m, x, y, 6);
    m.spawnUnit(0, t, gx, gy, heading);
  });
  if (S.mods.outpost && S.kind !== 'defend') {
    layout(m, 0, s, e, f === 'soviet' ? [['apwr', -3.5, 5], ['tsla', 6.5, 1]] : [['powr', -3.5, 5], ['gun', 6.5, 0], ['pbox', 6, 3.2], ['pbox', 6, -3.2]]);
  }
  // naval escorts (on sea maps only)
  if (isSeaBattle(S) && S.mods.escorts > 0) {
    const bay = m.toward(s, { x: m.mapW / 2, y: m.mapH / 2 }, 12);
    for (let k = 0; k < S.mods.escorts; k++) {
      const t = f === 'allies' ? (k % 2 ? 'dd' : 'pt') : 'ss';
      const spot = waterSpot(m, bay[0], bay[1]);
      if (!spot) break;
      const u = m.world.addUnit(t, m.human, spot[0], spot[1]);
      (m.flags.navyPaid as number[]).push(u.id);
    }
  }
}

function deployCore(m: MissionRuntime, S: BattleSpec) {
  const s = m.start(0), e = m.start(1);
  const sea = isSeaBattle(S);
  const heading = Math.atan2(e.y - s.y, e.x - s.x);
  let k = 0;
  for (const v of S.core) {
    const ut = UNITS[v.type];
    if (!ut || ut.kind === 'aircraft') continue;
    let u: Unit | null = null;
    if (ut.kind === 'naval') {
      if (!sea) continue;
      const bay = m.toward(s, { x: m.mapW / 2, y: m.mapH / 2 }, 12);
      const spot = waterSpot(m, bay[0], bay[1]);
      if (!spot) continue;
      u = m.world.addUnit(v.type, m.human, spot[0], spot[1]);
      (m.flags.navyPaid as number[]).push(u.id);
    } else {
      const [x, y] = m.toward(s, e, 5.5 + (k % 2) * 1.3, ((k >> 1) % 6 - 2.5) * 1.5);
      const [gx, gy] = ground(m, x, y, 6);
      u = m.spawnUnit(0, v.type, gx, gy, heading);
      k++;
    }
    u.rank = Math.max(0, Math.min(2, v.rank));
    u.xp = Math.max(u.xp, v.xp);
    (m.flags.core as Record<number, number>)[u.id] = v.vet;
  }
}

function setupBattle(m: MissionRuntime, S: BattleSpec) {
  const s = m.start(0), e = m.start(1);
  Object.assign(m.flags, { core: {}, kills: 0, bkills: 0, vetMax: 0, navyPaid: [], swSeen: [], drop: 0, air: [], wave: 0, held: 0, coreLost: 0 });
  m.human.buildSpeed *= S.mods.buildSpeed;
  m.human.incomeBias *= S.mods.income;
  if (S.neutral) m.setAI(1, 'defensive');
  const sea = isSeaBattle(S);
  // ---- the enemy
  enemyBase(m, 1, e, s, S.strength, S.personality, { capture: S.kind === 'capture', superweapon: S.kind === 'boss' ? S.superweapon ?? (S.enemy === 'soviet' ? 'iron' : 'chrono') : S.superweapon, sea: sea && (S.kind === 'naval' || S.personality === 'naval') });
  if (S.kind === 'boss') enemyBase(m, 2, m.start(2), s, Math.max(3, S.strength - 1), 'steamroller', {});
  if (S.kind === 'hold') {
    const [zx, zy] = ground(m, ...m.between(s, e, 0.52), 10);
    m.flags.zone = [zx, zy];
    const f = S.enemy;
    layout(m, 1, { x: zx, y: zy }, s, [[DEFENCES[f][0], 2.5, 2.5], [DEFENCES[f][0], 2.5, -2.5]]);
    const g = armyMix(m, f, S.personality, 300 + 250 * S.strength, 8);
    for (const t of g) if (UNITS[t]?.kind !== 'aircraft') m.spawnUnit(1, t, zx, zy);
  }
  // ---- our forces
  landingForce(m, S);
  deployCore(m, S);
  if (S.partisans) {
    const [px, py] = ground(m, ...m.toward(e, s, 14, 9), 8);
    const ps = ['e1', 'e1', 'e1', 'e3', 'e3', 'e1'].map((t) => m.spawnUnit(0, t, px, py));
    m.flags.partisans = ps.map((u) => u.id);
  }
  if (S.mods.recon) m.reveal(0, e.x, e.y, 13);
  // ---- objectives
  const territory = S.name;
  const O = T.objective;
  switch (S.kind) {
    case 'assault': m.objective('destroy', en(O.destroy, { territory })); break;
    case 'capture': m.objective('capture', en(O.capture, { building: m.flags.targetName ?? T.commandPost })); break;
    case 'hold': m.objective('hold', en(T.zone[zoneOf(S)].objective, { time: fmtTime(holdNeed(S)) })); m.progress('hold', `0:00 / ${fmtTime(holdNeed(S))}`); break;
    case 'defend':
      m.objective('holdout', en(O.holdout, { territory }));
      m.objective('hq', O.hq);
      m.objective('counter', O.counter, false);
      m.startTimer('relief', defendTime(S), T.timer);
      break;
    case 'naval':
      m.objective('yards', O.yards);
      m.objective('fleet', O.fleet);
      break;
    case 'boss':
      m.objective('command', en(O.command, { territory }));
      if (m.flags.sw) m.objective('superweapon', en(TL.superweapon, { building: m.flags.swName }), false);
      break;
  }
  if (S.superweapon && S.kind !== 'boss' && m.flags.sw) m.objective('sw', en(O.sw, { building: m.flags.swName }), false);
  if (S.core.length) m.objective('veterans', O.veterans, false);
  m.objective('swift', en(O.swift, { time: fmtTime(S.parTime) }), false);
  if (S.kind === 'hold') m.beacon(m.flags.zone[0], m.flags.zone[1]);
}

/** The zone to seize in a Seize & Hold battle (its English lines are in T.zone). */
const zoneOf = (S: BattleSpec): keyof typeof T.zone => ({ river: 'bridgehead', urban: 'railJunction', coast: 'harbour', mountain: 'pass', forest: 'crossroads', lakes: 'causeway', steppe: 'supplyDepot', plains: 'crossroads', islands: 'beachhead' } as Record<string, keyof typeof T.zone>)[S.terrain] ?? 'crossroads';
const holdNeed = (S: BattleSpec) => 120 + 15 * S.strength;
const defendTime = (S: BattleSpec) => 420 + 60 * S.strength;

// =====================================================================================================
// Update
// =====================================================================================================
function victory(m: MissionRuntime, S: BattleSpec) {
  if (m.ended) return;
  if (S.core.length && m.state('veterans') === 'active') m.complete('veterans');
  if (m.time <= S.parTime) m.complete('swift'); else m.fail('swift');
  m.win();
}

function intro(m: MissionRuntime, S: BattleSpec) {
  const H = hq(S);
  const territory = S.name, R = T.radio;
  const lines: Record<BattleKind, string> = {
    assault: en(S.neutral ? R.assaultLocal : S.enemy === 'allies' ? R.assaultAllied : R.assaultSoviet, { territory }),
    capture: en(R.capture, { territory }),
    hold: en(T.zone[zoneOf(S)].intro, { territory, time: fmtTime(holdNeed(S)) }),
    defend: en(R.defend, { commander: S.commander, territory }),
    naval: en(R.naval, { territory }),
    boss: en(R.boss, { territory }),
  };
  say(m, H, lines[S.kind]);
  const names = S.core.slice(0, 4).map((v) => v.name).join(', ');
  if (S.core.length) say(m, INTEL, S.core.length > 4 ? en(R.coreMore, { names, n: S.core.length - 4 }) : en(R.core, { names }));
  const P = PERSONALITIES[S.personality];
  if (!S.neutral) say(m, INTEL, en(R.enemy, { commander: S.commander, personality: P.name, desc: P.desc }));
  if (S.partisans) say(m, INTEL, R.partisans);
  if (S.superweapon && m.flags.sw) say(m, INTEL, en(R.superweapon, { building: m.flags.swName }));
}

const TAUNTS: Record<PersonalityId, string> = T.taunt;

/** Perks that act during the battle. */
function perks(m: MissionRuntime, S: BattleSpec) {
  const me = m.human;
  // paratrooper sticks
  const drops = S.mods.drops;
  if (m.flags.drop < drops.length && m.time >= drops[m.flags.drop].at) {
    const d = drops[m.flags.drop++];
    const [bx, by] = humanBase(m);
    const e = m.start(1);
    const [tx, ty] = ground(m, ...m.toward({ x: bx, y: by }, e, 5), 8);
    launchSortie(m.world, me, 'paratroopers', tx, ty);
    m.flags.paraRank = d.rank;
    m.flags.paraUntil = m.time + 14;
    say(m, hq(S), d.rank >= 2 ? T.radio.eliteDrop : T.radio.drop);
  }
  if (!m.every(1, 'perks')) return;
  if (m.flags.paraUntil && m.time <= m.flags.paraUntil) {
    for (const u of m.world.units) if (u.alive && u.owner === me && u.parachute > 0 && u.rank < m.flags.paraRank) u.rank = m.flags.paraRank;
  }
  if (S.mods.drill || S.mods.tankAces) {
    let max = m.flags.vetMax;
    for (const u of m.world.units) {
      if (!u.alive || u.owner !== me || u.id <= m.flags.vetMax) continue;
      if (u.id > max) max = u.id;
      if (u.rank >= 1 || !u.weapons.length) continue;
      if ((S.mods.drill && u.kind === 'infantry') || (S.mods.tankAces && TANKS.has(u.ut.id))) { u.rank = 1; u.xp = Math.max(u.xp, Math.max(300, u.ut.cost)); }
    }
    m.flags.vetMax = max;
  }
  if (S.mods.bounty) {
    const st = me.stats;
    const dk = st.unitsKilled - m.flags.kills, db = st.buildingsKilled - m.flags.bkills;
    if (dk > 0 || db > 0) { m.give(0, dk * 75 + db * 250); m.flags.kills = st.unitsKilled; m.flags.bkills = st.buildingsKilled; }
  }
  if (S.mods.cheapNavy) {
    const paid: number[] = m.flags.navyPaid;
    for (const b of m.world.buildings) if (b.alive && b.owner === me && b.bt.water && b.bt.factory === 'naval' && !paid.includes(b.id)) { paid.push(b.id); m.give(0, Math.round(b.bt.cost * 0.35)); }
    for (const u of m.world.units) if (u.alive && u.owner === me && u.kind === 'naval' && !paid.includes(u.id)) { paid.push(u.id); m.give(0, Math.round(u.ut.cost * 0.35)); }
  }
  if (S.mods.superCharge > 0) {
    const seen: number[] = m.flags.swSeen;
    for (const b of m.world.buildings) {
      const kind = b.bt.superweapon;
      if (!kind || !b.alive || b.owner !== me || seen.includes(b.id) || !b.active) continue;
      seen.push(b.id);
      const st = m.superState(0, kind);
      if (st && st.charge < st.full * S.mods.superCharge) m.setSuperCharge(0, kind, st.full * S.mods.superCharge);
    }
  }
}

/** Scripted enemy pressure on top of the AI, shaped by the commander's personality. */
function waves(m: MissionRuntime, S: BattleSpec) {
  if (S.neutral) return;
  const str = S.strength, pers = S.personality;
  const slow = pers === 'fortress' ? 1.35 : 1;
  const early = pers === 'blitz' || pers === 'raider' ? 0.6 : 1;
  let start = 0, every = 0, budget = 0;
  switch (S.kind) {
    case 'assault': case 'capture':
      if (str < 3) return;
      start = 330 - 20 * str; every = 170 - 10 * str; budget = 400 + 250 * str + 120 * m.flags.wave; break;
    case 'hold': start = 110; every = 80; budget = 300 + 200 * str + 90 * m.flags.wave; break;
    case 'defend': start = 40; every = 72 - 3 * str; budget = 450 + 260 * str + 170 * m.flags.wave; break;
    case 'naval': start = 200; every = 150; budget = 600 + 300 * str; break;
    case 'boss': start = 150; every = 100; budget = 1100 + 280 * m.flags.wave; break;
  }
  start *= early * slow;
  every *= slow;
  if (pers === 'fortress') budget *= 0.7;
  if (m.flags.nextWave === undefined) m.flags.nextWave = start;
  if (m.time < m.flags.nextWave) return;
  m.flags.nextWave = m.time + every;
  const n = ++m.flags.wave;
  const s = m.start(0), e = m.start(1);
  const sea = isSeaBattle(S);
  const air = pers === 'air' ? n % 2 === 0 : n % 4 === 0 && str >= 4;
  const types = armyMix(m, S.enemy, pers, budget, 14, air, false);
  const ground_ = types.filter((t) => UNITS[t].kind !== 'aircraft' && UNITS[t].kind !== 'naval');
  const planes = types.filter((t) => UNITS[t].kind === 'aircraft');
  const [bx, by] = humanBase(m);
  let to: [number, number] = [bx, by];
  if (S.kind === 'hold') to = m.flags.zone;
  let from: [number, number];
  if (S.kind === 'defend') {
    const side = m.world.rng.chance(0.5) ? 1 : -1;
    const [ex, ey] = m.toward(e, s, 6, side * m.world.rng.range(0, 14));
    from = edgeNear(m, ex, ey);
    if (Math.hypot(from[0] - bx, from[1] - by) < 18) from = ground(m, ...m.toward(e, s, 4), 8);
  } else {
    const src = S.kind === 'boss' && n % 2 === 0 ? m.start(2) : e;
    from = ground(m, ...m.toward(src, s, 6), 8);
  }
  const units = huntWave(m, S.kind === 'boss' && n % 2 === 0 ? 2 : 1, ground_, from, to);
  if (str >= 5) for (const u of units) if (u.kind !== 'infantry') u.rank = Math.max(u.rank, 1);
  if (planes.length) {
    const [ax, ay] = m.nearestEdge(e.x, e.y);
    const ps = planes.map((t) => m.spawnUnit(1, t, ax, ay));
    const target = m.nearest(m.buildings(0).filter((b) => !b.bt.wall), bx, by);
    if (target) m.attack(ps, target);
    m.flags.air = [...m.flags.air, ...ps.map((u) => u.id)];
  }
  if (sea && (S.kind === 'naval' || pers === 'naval')) {
    const yard = (m.flags.yards ?? []).map((id: number) => m.world.getEntity(id)).find((b: Building | undefined) => b?.alive) as Building | undefined;
    if (yard) {
      const ships: Unit[] = [];
      for (let k = 0; k < 1 + Math.floor(str / 3); k++) {
        const spot = waterSpot(m, yard.x, yard.y, 8);
        if (spot) ships.push(m.world.addUnit(m.world.rng.pick(ENEMY_POOLS[S.enemy].navy), m.player(1), spot[0], spot[1]));
      }
      const tgt = m.nearest(m.units(0).filter((u) => u.kind === 'naval'), yard.x, yard.y) ?? m.nearest(m.buildings(0).filter((b) => !b.bt.wall), yard.x, yard.y);
      if (tgt && ships.length) m.attack(ships, tgt);
    }
  }
  if (n === 1 || n % 3 === 0) say(m, foe(S), n === 1 ? TAUNTS[pers] : T.radio.waves);
}

/** Wave aircraft: retarget while armed, leave the map when empty. */
function aircraft(m: MissionRuntime) {
  if (!m.flags.air.length || !m.every(1, 'air')) return;
  const keep: number[] = [];
  const [bx, by] = humanBase(m);
  for (const id of m.flags.air as number[]) {
    const u = m.world.getEntity(id) as Unit | undefined;
    if (!u || !u.alive) continue;
    if (u.ammo <= 0) {
      const edge = m.nearestEdge(u.x, u.y);
      if (Math.hypot(u.x - edge[0], u.y - edge[1]) < 2.5) { m.remove(u); continue; }
      if (u.order.type !== 'move') m.world.giveOrder(u, { type: 'move', x: edge[0], y: edge[1], attackMove: false });
    } else if (u.order.type === 'idle') {
      const t = m.nearest(m.buildings(0).filter((b) => !b.bt.wall), bx, by);
      if (t) m.attack([u], t);
    }
    keep.push(id);
  }
  m.flags.air = keep;
}

function coreAlive(m: MissionRuntime): { alive: number; total: number } {
  const core = m.flags.core as Record<number, number>;
  let alive = 0, total = 0;
  for (const id of Object.keys(core)) { total++; if (m.world.getEntity(+id)?.alive) alive++; }
  return { alive, total };
}

function updateBattle(m: MissionRuntime, S: BattleSpec) {
  if (m.ended) return;
  nudgeEntries(m);
  if (m.after(2, 'intro')) intro(m, S);
  perks(m, S);
  waves(m, S);
  aircraft(m);
  hunt(m, 'hunters', 8);
  if (!m.every(1, 'check')) return;
  // optional objectives that can fail along the way
  if (S.core.length && m.state('veterans') === 'active') {
    const { alive, total } = coreAlive(m);
    if (alive < total) { m.fail('veterans'); say(m, INTEL, T.radio.vetLost); }
  }
  if (m.time > S.parTime) m.fail('swift');
  if (m.flags.sw && !m.alive(m.flags.sw) && m.state('sw') === 'active') { m.complete('sw'); say(m, hq(S), T.radio.swDestroyed); }
  if (m.flags.sw && !m.alive(m.flags.sw) && m.state('superweapon') === 'active') m.complete('superweapon');
  const s = m.start(0);
  switch (S.kind) {
    case 'assault': {
      const left = enemyStructures(m).length;
      m.progress('destroy', en(T.progress.left, { n: left }));
      if (left === 0) { m.complete('destroy'); victory(m, S); }
      break;
    }
    case 'capture': {
      const t = m.world.getEntity(m.flags.target) as Building | undefined;
      if (!t || !t.alive) { m.fail('capture'); m.lose(en(T.lose.target, { building: m.flags.targetName ?? T.commandPost })); break; }
      if (t.owner === m.human) { m.complete('capture'); say(m, hq(S), T.radio.captured); victory(m, S); break; }
      if (t.healthFrac <= 0.25 && m.once('weak')) { say(m, INTEL, T.radio.damaged); m.beacon(t.x, t.y); }
      break;
    }
    case 'hold': {
      const [zx, zy] = m.flags.zone as [number, number];
      const need = holdNeed(S);
      const mine = m.unitsNear(0, zx, zy, 5, (u) => u.weapons.length > 0 && u.kind !== 'aircraft').length;
      let theirs = 0;
      for (const u of m.world.units) if (u.alive && m.human.isEnemy(u.owner) && u.kind !== 'aircraft' && Math.hypot(u.x - zx, u.y - zy) <= 5) theirs++;
      for (const b of m.world.buildings) if (b.alive && m.human.isEnemy(b.owner) && !b.bt.wall && !b.bt.mine && Math.hypot(b.x - zx, b.y - zy) <= 5) theirs++;
      if (mine > 0 && theirs === 0) {
        m.flags.held++;
        if (m.flags.held === 1) say(m, hq(S), en(T.zone[zoneOf(S)].held, { time: fmtTime(need) }));
      } else if (mine > 0 && theirs > 0 && m.every(20, 'contested')) say(m, INTEL, T.radio.contested);
      m.progress('hold', `${fmtTime(m.flags.held)} / ${fmtTime(need)}`);
      if (m.every(15, 'zonebeacon')) m.beacon(zx, zy);
      if (m.flags.held >= need) { m.complete('hold'); victory(m, S); }
      break;
    }
    case 'defend': {
      if (m.flags.hq && !m.alive(m.flags.hq)) { m.fail('hq'); m.lose(T.lose.hq); break; }
      if (enemyStructures(m).length === 0) { m.complete('counter'); m.complete('holdout'); m.complete('hq'); victory(m, S); break; }
      if (m.timerDone('relief')) {
        m.clearTimer('relief');
        m.complete('holdout');
        m.complete('hq');
        const [ex, ey] = edgeNear(m, s.x, s.y);
        m.reinforce(0, [mainTank(S.faction), mainTank(S.faction), mainTank(S.faction), 'e3', 'e3'], [ex, ey], humanBase(m));
        say(m, hq(S), en(T.radio.relief, { territory: S.name }));
        victory(m, S);
      }
      break;
    }
    case 'naval': {
      const yards = enemyStructures(m).filter((b) => b.bt.water && b.bt.factory === 'naval').length;
      const fleet = m.world.units.filter((u) => u.alive && m.human.isEnemy(u.owner) && u.kind === 'naval').length;
      m.progress('yards', yards ? en(T.progress.left, { n: yards }) : T.progress.done);
      m.progress('fleet', en(T.progress.shipsLeft, { n: fleet }));
      if (!yards) m.complete('yards');
      if (!yards && !fleet) { m.complete('fleet'); victory(m, S); }
      break;
    }
    case 'boss': {
      const facts = enemyStructures(m).filter((b) => b.bt.id === 'fact').length + m.world.units.filter((u) => u.alive && m.human.isEnemy(u.owner) && u.ut.deploysInto === 'fact').length;
      m.progress('command', en(T.progress.left, { n: facts }));
      if (facts === 0) { m.complete('command'); victory(m, S); }
      break;
    }
  }
}

// =====================================================================================================
// MissionDef
// =====================================================================================================
/** (Briefing and debrief lines are not shown: the Conquest screens present the battle and its report.) */
function briefing(S: BattleSpec): string[] {
  const P = PERSONALITIES[S.personality];
  return [
    `${S.date}. ${KIND_INFO[S.kind].name} at ${S.name}${S.from ? `, striking from ${S.from}` : ''}. ${KIND_INFO[S.kind].desc}`,
    S.neutral ? `${S.commander} will defend their neutrality, but they will not attack.` : `Enemy commander: ${S.commander} ("${P.name}"). ${P.desc}`,
    `Battlefield: ${S.mapLabel.toLowerCase()}, ${S.climate} climate. Garrison strength ${S.strength} of 6.`,
  ];
}

/** Build (and register under the id `conquest`) the mission for a battle. */
export function conquestMission(c: ConquestSetup): MissionDef {
  const S = c.battle;
  const sea = isSeaBattle(S);
  const allowed = sea ? [...new Set([...S.allowed, ...NAVAL_TYPES])] : S.allowed;
  const ai = PERSONALITIES[S.personality]?.ai;
  const players: MissionPlayerSpec[] = [
    { name: T.player, faction: S.faction, color: COLOR[S.faction] },
    // (outlying garrisons, strength 1-2, fight by the book; the commander's own style shows from strength 3)
    { name: S.commander, faction: S.enemy, color: S.neutral ? NEUTRAL_COLOR : COLOR[S.enemy], ai: S.ai, credits: S.enemyCredits, team: 1, ...(ai && !S.neutral && S.strength >= 3 ? { personality: ai } : {}) },
  ];
  if (S.kind === 'boss') players.push({ name: en(TL.guard, { territory: S.name }), faction: S.enemy, color: GUARD_COLOR, ai: S.ai === 'brutal' ? 'hard' : S.ai, credits: Math.round(S.enemyCredits * 0.7), team: 1, personality: 'ironfist' });
  const H = hq(S);
  const def: MissionDef = quietSetup({
    id: 'conquest',
    campaign: 'special',
    index: 90,
    title: en(T.title, { territory: S.name }),
    codename: S.name.toUpperCase(),
    location: S.name,
    date: S.date,
    briefing: briefing(S),
    tips: [KIND_INFO[S.kind].desc],
    map: S.map,
    players,
    fog: true,
    startUnits: 'none',
    credits: S.credits,
    allowedBuild: allowed,
    parTime: S.parTime,
    debrief: { speaker: H.name, portrait: H.portrait, win: `${S.name} is ours. The front moves on, Commander.`, lose: `We have been thrown back from ${S.name}. Regroup and strike again.` },
    setup: (m) => setupBattle(m, S),
    update: (m) => updateBattle(m, S),
  });
  MISSIONS[def.id] = def; // the progression layer looks missions up by id (titles, difficulty)
  return def;
}

// =====================================================================================================
// Outcome
// =====================================================================================================
export interface BattleOutcome {
  battleId: string;
  won: boolean;
  time: number;
  creditsLeft: number;
  objectives: { id: string; text: string; primary: boolean; state: string }[];
  /** Core veterans that came home (with their rank and experience now). */
  survivors: { vet: number; rank: number; xp: number }[];
  /** Units promoted in this battle that may join the core army. */
  recruits: { type: string; rank: number; xp: number }[];
  kills: number;
  losses: number;
  superweaponDestroyed: boolean;
}

/** Read a finished (or abandoned) conquest battle back from its world. */
export function battleOutcome(world: World, spec: BattleSpec): BattleOutcome {
  const rt = world.mission;
  const me = world.players[0];
  const core = (rt?.flags.core ?? {}) as Record<number, number>;
  const all: Unit[] = [];
  for (const u of world.units) {
    if (!u.alive || u.owner !== me) continue;
    all.push(u);
    for (const p of u.passengers) if (p.alive) all.push(p);
  }
  const survivors: BattleOutcome['survivors'] = [];
  const recruits: BattleOutcome['recruits'] = [];
  for (const u of all) {
    const vet = core[u.id];
    if (vet !== undefined) survivors.push({ vet, rank: u.rank, xp: Math.round(u.xp) });
    else if (u.rank >= 1 && u.weapons.length && u.kind !== 'aircraft' && !u.ut.harvester && !u.ut.deploysInto && UNITS[u.ut.id]?.buildable !== false) recruits.push({ type: u.ut.id, rank: u.rank, xp: Math.round(u.xp) });
  }
  recruits.sort((a, b) => b.rank - a.rank || UNITS[b.type].cost - UNITS[a.type].cost);
  return {
    battleId: spec.id,
    won: !!rt?.won,
    time: world.time,
    creditsLeft: Math.max(0, Math.floor(me.credits)),
    objectives: (rt?.objectives ?? []).map((o) => ({ id: o.id, text: o.text, primary: o.primary, state: o.state })),
    survivors,
    recruits,
    kills: me.stats.unitsKilled + me.stats.buildingsKilled,
    losses: me.stats.unitsLost,
    superweaponDestroyed: !!rt?.flags.sw && !world.getEntity(rt.flags.sw)?.alive,
  };
}
