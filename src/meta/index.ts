/**
 * Progression layer: telemetry-driven XP, commander ranks, medals / achievements, lifetime stats,
 * match history, survival records and the daily-challenge leaderboard and streak.
 *
 * The game feeds it three things: onGameStart(), every simulation event through onEvent() (O(1)
 * per event: a switch, a few map lookups and, for rare events, a bounded neighbourhood scan) and
 * onGameEnd(). Unlocks surface through the onUnlock callback (see showAchievementToast).
 */
import { BUILDINGS, UNITS } from '../data/rules';
import type { Entity } from '../sim/entities';
import type { PlayerStats } from '../sim/player';
import type { GameEvent } from '../sim/types';
import type { World } from '../sim/world';
import { campaignMissions, getMission } from '../missions';
import { loadProgress, recordResult, type MissionRecord } from '../missions/progress';
import { SURVIVAL_VARIANTS, currentDailyDay } from '../missions/special';
import { DAILY_MEDAL_BONUS, dailyConfig, prevDay } from './daily';
import {
  ACHIEVEMENTS, ACH_BY_ID, BY_COUNTER, TIER_NAMES, achievementDesc, achievementMetal, achievementRarity, achievementXp, isTiered, tierCount,
  type AchievementDef,
} from './achievements';
import { insigniaSvg, medalSvg } from './art';
import { MAX_RANK, RANKS, rankIndexFor, rankName, rankProgress } from './ranks';
import { defaultStorage, loadProfile, saveProfile, type DiffKey, type FactionKey, type KV, type MatchRecord, type Profile } from './profile';
import { showAchievementToast, showXpSummary, type ToastInfo, type XpSummary } from './toast';

export * from './achievements';
export * from './ranks';
export * from './daily';
export { insigniaSvg, medalSvg, picto, PICTO } from './art';
export { loadProfile, saveProfile, defaultProfile, normalizeProfile, PROFILE_KEY, PROFILE_VERSION, type Profile, type MatchRecord, type LifetimeStats } from './profile';
export { showAchievementToast, showXpSummary, setToastSound, type ToastInfo, type XpSummary } from './toast';

export type GameMode = 'skirmish' | 'mission';

export interface GameStartInfo {
  mode: GameMode;
  missionId?: string;
  /** Hardest AI difficulty in the match (skirmish). Missions derive it from their definition. */
  difficulty?: string;
  /** Every opponent's difficulty (optional; enables "three Brutal AIs at once"). */
  difficulties?: string[];
  faction: string;
  opponents: number;
  seed: number;
  /** Optional extras; climate is otherwise read from world.map on the first event. */
  climate?: string;
  weather?: string;
}

export interface EventContext {
  localPlayerId: number;
  world: World;
  /**
   * The entity behind a 'death' event, if the caller still has it (the world drops dead entities
   * before events are drained; game.ts has it as `deadEnt`). Optional but improves attribution.
   */
  dead?: Entity;
}

export interface GameEndInfo {
  won: boolean;
  /** Seconds. */
  time: number;
  mode: GameMode;
  missionId?: string;
  stars?: number;
  score?: number;
  stats: PlayerStats;
  /** Weather at the end (a thunderstorm at any point also counts via noteWeather / start info). */
  weather?: string;
  /** Survival waves survived / boss waves destroyed (default: read from world.mission.flags). */
  waves?: number;
  bosses?: number;
  world?: World;
}

export type UnlockInfo = ToastInfo & { id?: string };

export interface MatchSummary extends XpSummary {
  medalIds: string[];
  record: MatchRecord;
}

const TANKS = new Set(['1tnk', '2tnk', '3tnk', '4tnk']);
const DIFF_XP: Record<string, number> = { easy: 0.5, normal: 1, hard: 1.6, brutal: 2.5 };
const DIFF_ORDER = ['easy', 'normal', 'hard', 'brutal'];
const CLIMATES = ['temperate', 'winter', 'desert'];

interface FireInfo { st: string; sk: string; vt: string; vk: string; vo: number }

interface Match {
  info: GameStartInfo;
  local: number;
  xpAtStart: number;
  climate?: string;
  storm: boolean;
  factLost: boolean;
  killXp: number;
  xp: number;
  lines: Map<string, number>;
  medals: string[];
  kills: number;
  structures: number;
  nukeTick: number;
  nukeX: number;
  nukeY: number;
  nukeKills: number;
  wallParent: Map<number, number>;
  wallSize: Map<number, number>;
  lastSaveTick: number;
  dirty: boolean;
  prior?: MissionRecord;
  dailyDay?: string;
  world?: World;
}

const LIVE = new Set<MetaTracker>();

/** Rename the commander (persists, and updates live trackers so a later save cannot undo it). */
export function setCommanderName(name: string, storage: KV = defaultStorage()): string {
  const clean = name.replace(/\s+/g, ' ').trim().slice(0, 24) || 'Commander';
  const p = loadProfile(storage);
  p.name = clean;
  saveProfile(p, storage);
  for (const t of LIVE) t.profile.name = clean;
  return clean;
}

export class MetaTracker {
  profile: Profile;
  /** Called for every medal tier and promotion (wire it to showAchievementToast). */
  onUnlock?: (a: UnlockInfo) => void;
  private match: Match | null = null;
  private fire = new Map<number, FireInfo>();
  private storage: KV;
  private now: () => number;

  constructor(opts: { storage?: KV; now?: () => number } = {}) {
    this.storage = opts.storage ?? defaultStorage();
    this.now = opts.now ?? (() => Date.now());
    this.profile = loadProfile(this.storage);
    LIVE.add(this);
  }

  get active(): boolean {
    return !!this.match;
  }

  /** Re-read the profile (e.g. after the profile screen renamed the commander). */
  reload() {
    if (!this.match) this.profile = loadProfile(this.storage);
  }

  save() {
    saveProfile(this.profile, this.storage);
    if (this.match) this.match.dirty = false;
  }

  // ===========================================================================
  // Game lifecycle
  // ===========================================================================
  onGameStart(info: GameStartInfo) {
    if (this.match) this.abandon();
    this.reload();
    this.fire.clear();
    const def = info.missionId ? getMission(info.missionId) : undefined;
    let difficulty = info.difficulty;
    if (!difficulty && info.difficulties?.length) difficulty = [...info.difficulties].sort((a, b) => DIFF_ORDER.indexOf(b) - DIFF_ORDER.indexOf(a))[0];
    if (!difficulty && def) {
      const ais = def.players.slice(1).map((p) => p.ai).filter((a): a is NonNullable<typeof a> => !!a && DIFF_ORDER.includes(a));
      difficulty = ais.sort((a, b) => DIFF_ORDER.indexOf(b) - DIFF_ORDER.indexOf(a))[0];
    }
    this.match = {
      info: { ...info, difficulty }, local: 0, xpAtStart: this.profile.xp, climate: info.climate, storm: info.weather === 'storm', factLost: false,
      killXp: 0, xp: 0, lines: new Map(), medals: [], kills: 0, structures: 0, nukeTick: -1, nukeX: 0, nukeY: 0, nukeKills: 0,
      wallParent: new Map(), wallSize: new Map(), lastSaveTick: 0, dirty: false,
    };
    if (info.faction === 'allies' || info.faction === 'soviet') this.profile.faction = info.faction;
    if (info.missionId) {
      try { this.match.prior = loadProgress()[info.missionId]; } catch { /* no storage */ }
      if (info.missionId === 'daily') this.match.dailyDay = currentDailyDay();
    }
  }

  /** Weather changes during the match (a thunderstorm at any point counts for "Riders on the Storm"). */
  noteWeather(kind: string) {
    if (this.match && kind === 'storm') this.match.storm = true;
  }

  /** Feed every simulation event. Cheap: O(1) per event. */
  onEvent(ev: GameEvent, ctx: EventContext) {
    const m = this.match;
    if (!m) return;
    const world = ctx.world;
    if (!m.world) {
      m.world = world;
      m.local = ctx.localPlayerId;
      m.climate ??= world.map.climate;
    }
    const local = ctx.localPlayerId;
    switch (ev.e) {
      case 'fire': {
        if (ev.target === undefined) return;
        const s = world.getEntity(ev.shooter);
        if (!s || s.owner.id !== local) return;
        const t = world.getEntity(ev.target);
        if (t) this.fire.set(ev.target, { st: s.type.id, sk: s.kind, vt: t.type.id, vk: t.kind, vo: t.owner.id });
        return;
      }
      case 'death':
        this.onDeath(ev, ctx);
        break;
      case 'impact':
        if (ev.kind === 'nuke' && ev.owner === local) { m.nukeTick = world.tick; m.nukeX = ev.x; m.nukeY = ev.y; m.nukeKills = 0; }
        return;
      case 'promoted':
        if (ev.rank >= 2 && world.getEntity(ev.id)?.owner.id === local) this.bump('elite');
        break;
      case 'captured':
        if (ev.to === local && ev.from !== local) this.bump('captures');
        break;
      case 'crate':
        if (ev.player === local) this.bump('crates');
        break;
      case 'placed': {
        const b = world.getEntity(ev.id);
        if (b && b.kind === 'building' && b.owner.id === local && BUILDINGS[b.type.id]?.wall) this.wallJoin(world, b, local);
        return;
      }
      case 'teleport': {
        const u = world.getEntity(ev.id);
        if (u && u.owner.id === local && u.kind === 'vehicle' && u.weapons.length && this.enemyBaseNear(world, local, ev.x, ev.y, 7)) this.unlock('out-of-time');
        break;
      }
      default:
        return;
    }
    m.dirty = true;
    if (world.tick - m.lastSaveTick > 20 * 30) {
      m.lastSaveTick = world.tick;
      this.flushKillXp();
      this.save();
    }
  }

  private onDeath(ev: Extract<GameEvent, { e: 'death' }>, ctx: EventContext) {
    const m = this.match!;
    const world = ctx.world;
    const local = ctx.localPlayerId;
    const fc = this.fire.get(ev.id);
    if (fc) this.fire.delete(ev.id);
    if (ev.how === 'sold') return;
    const dead = ctx.dead ?? world.getEntity(ev.id);
    let vOwner: number, vType: string, vKind: string;
    if (dead) { vOwner = dead.owner.id; vType = dead.type.id; vKind = dead.kind; }
    else if (fc) { vOwner = fc.vo; vType = fc.vt; vKind = fc.vk; }
    else return;
    if (vOwner === local) {
      if (vType === 'fact') m.factLost = true;
      return;
    }
    const me = world.players[local], vp = world.players[vOwner];
    if (!me || !vp || !me.isEnemy(vp)) return;
    if (vKind === 'building' && BUILDINGS[vType]?.wall) return;

    // who did it?
    let kType: string | null = null, kKind: string | null = null, nuke = false;
    if (m.nukeTick === world.tick && Math.hypot(ev.x - m.nukeX, ev.y - m.nukeY) < 6.5) {
      kType = 'mslo'; kKind = 'building'; nuke = true;
    } else if (ev.how === 'crushed') {
      const u = this.localUnitNear(world, local, ev.x, ev.y, 1.3, (u) => u.kind === 'vehicle');
      if (!u) return;
      kType = u.type.id; kKind = 'vehicle';
    } else {
      const k = dead && dead.lastAttacker ? world.getEntity(dead.lastAttacker) : undefined;
      if (k) {
        if (k.owner.id !== local) return;
        kType = k.type.id; kKind = k.kind;
      } else if (fc) {
        kType = fc.st; kKind = fc.sk;
      } else if (ev.how === 'blown' && vKind === 'building') {
        const t = this.localUnitNear(world, local, ev.x, ev.y, 3.5, (u) => !!UNITS[u.type.id]?.c4);
        if (!t) return;
        kType = t.type.id; kKind = t.kind;
      } else return;
    }

    if (vKind === 'building') {
      m.structures++;
      this.bump('structures');
      this.killXp(8 + (BUILDINGS[vType]?.cost ?? 0) / 150);
    } else {
      m.kills++;
      this.bump('kills');
      this.killXp(2 + (UNITS[vType]?.cost ?? 0) / 200);
      if (TANKS.has(vType)) this.bump('tanks');
      if (vType === '4tnk') this.bump('mammoths');
      if (vKind === 'aircraft') this.bump('aircraft');
      if (vKind === 'infantry') {
        if (ev.how === 'crushed') this.bump('crushed');
        if (kType === 'e7') this.bump('commando');
        if (kType === 'dog') this.bump('dogs');
        if (ev.how === 'burn' && !nuke) this.bump('burned');
      }
    }
    if (kType === 'tsla') this.bump('tesla');
    if (kKind === 'aircraft') this.bump('airKills');
    if (UNITS[kType]) {
      const ku = this.profile.stats.killsByUnit;
      ku[kType] = (ku[kType] ?? 0) + 1;
    }
    if (nuke) {
      m.nukeKills++;
      if (vKind === 'building') this.unlock('mutually-assured');
      if (m.nukeKills >= 8) this.unlock('overkill');
    }
  }

  private localUnitNear(world: World, local: number, x: number, y: number, r: number, ok: (u: Entity) => boolean): Entity | null {
    let found: Entity | null = null;
    world.grid.query(x, y, r, (u) => {
      if (!found && u.alive && u.owner.id === local && Math.hypot(u.x - x, u.y - y) <= r && ok(u)) found = u;
    });
    return found;
  }

  /** Any enemy (non-wall) structure within r cells (bounded scan of the occupancy grid). */
  private enemyBaseNear(world: World, local: number, x: number, y: number, r: number): boolean {
    const me = world.players[local];
    const map = world.map;
    const cx = Math.floor(x), cy = Math.floor(y);
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const qx = cx + dx, qy = cy + dy;
      if (!map.inBounds(qx, qy) || dx * dx + dy * dy > r * r) continue;
      const id = map.occupant[map.idx(qx, qy)];
      if (!id) continue;
      const e = world.getEntity(id);
      if (e && e.alive && e.kind === 'building' && !BUILDINGS[e.type.id]?.wall && me.isEnemy(e.owner)) return true;
    }
    return false;
  }

  /** Union-find over this match's wall cells: tracks the longest connected wall. */
  private wallJoin(world: World, b: Entity, local: number) {
    const m = this.match!;
    const map = world.map;
    const bx = Math.floor(b.x), by = Math.floor(b.y);
    const i = map.idx(bx, by);
    const par = m.wallParent, size = m.wallSize;
    const find = (a: number): number => {
      let r = a;
      while (par.get(r) !== r) r = par.get(r)!;
      while (par.get(a) !== r) { const n = par.get(a)!; par.set(a, r); a = n; }
      return r;
    };
    par.set(i, i);
    size.set(i, 1);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const x = bx + dx, y = by + dy;
      if (!map.inBounds(x, y)) continue;
      const j = map.idx(x, y);
      if (!par.has(j)) continue;
      const occ = map.occupant[j];
      const e = occ ? world.getEntity(occ) : undefined;
      if (!e || !e.alive || e.owner.id !== local || !BUILDINGS[e.type.id]?.wall) continue;
      const ra = find(i), rb = find(j);
      if (ra === rb) continue;
      const [big, small] = size.get(ra)! >= size.get(rb)! ? [ra, rb] : [rb, ra];
      par.set(small, big);
      size.set(big, size.get(big)! + size.get(small)!);
    }
    this.setMax('wall', size.get(find(i))!);
  }

  /** Quit mid-game: kills and medals earned so far are kept; logged as an abandoned battle. */
  abandon() {
    const m = this.match;
    if (!m) return;
    this.flushKillXp();
    const st = this.profile.stats;
    st.kills += m.kills;
    st.structuresDestroyed += m.structures;
    this.pushHistory({
      at: this.now(), mode: m.info.mode, missionId: m.info.missionId, title: this.titleFor(m.info), faction: m.info.faction, difficulty: m.info.difficulty,
      opponents: m.info.opponents, won: false, abandoned: true, time: m.world?.time ?? 0, kills: m.kills + m.structures, lost: m.world?.players[m.local]?.stats.unitsLost ?? 0,
      xp: m.xp, medals: [...m.medals], climate: m.climate,
    });
    this.match = null;
    this.save();
  }

  onGameEnd(r: GameEndInfo): MatchSummary | null {
    const m = this.match;
    if (!m) return null;
    this.flushKillXp();
    const p = this.profile, st = p.stats;
    const world = r.world ?? m.world;
    const won = r.won;
    const info = m.info;
    const faction: FactionKey = info.faction === 'soviet' ? 'soviet' : 'allies';
    const diff = (DIFF_ORDER.includes(info.difficulty ?? '') ? info.difficulty : undefined) as DiffKey | undefined;
    const missionId = r.missionId ?? info.missionId;
    const survival = SURVIVAL_VARIANTS.find((v) => v.id === missionId);
    const daily = missionId === 'daily';
    const campaign = r.mode === 'mission' && !survival && !daily && !!missionId;

    // ---- lifetime stats
    st.games++;
    if (won) st.wins++; else st.losses++;
    st.timePlayed += r.time;
    st.gamesByFaction[faction]++;
    if (won) st.winsByFaction[faction]++;
    if (r.mode === 'skirmish') {
      st.skirmishes++;
      if (won) st.skirmishWins++;
      if (diff) { st.gamesByDifficulty[diff]++; if (won) st.winsByDifficulty[diff]++; }
      if (won && (st.fastestWin === null || r.time < st.fastestWin)) st.fastestWin = r.time;
    } else {
      st.missions++;
      if (won) st.missionWins++;
    }
    st.kills += m.kills;
    st.structuresDestroyed += m.structures;
    st.unitsLost += r.stats.unitsLost;
    st.structuresLost += r.stats.buildingsLost;
    st.unitsBuilt += r.stats.unitsBuilt;
    st.structuresBuilt += r.stats.buildingsBuilt;
    st.harvested += Math.round(r.stats.harvested);
    st.spent += Math.round(r.stats.spent);

    // ---- XP: experience, victory, mission results
    this.addXp(Math.min(160, Math.round((r.time / 60) * 4)), 'Combat experience');
    if (r.mode === 'skirmish' && won) {
      const opp = Math.max(1, info.opponents);
      this.addXp(Math.round(400 * (DIFF_XP[diff ?? 'normal'] ?? 1) * (1 + 0.5 * (opp - 1))), `Victory${diff ? ' · ' + diff.charAt(0).toUpperCase() + diff.slice(1) : ''}${opp > 1 ? ` x${opp}` : ''}`);
    }
    let waves = 0, bosses = 0;
    if (survival) {
      const flags = world?.mission?.flags ?? {};
      waves = r.waves ?? flags.survived ?? 0;
      bosses = r.bosses ?? flags.bosses ?? 0;
      const score = r.score ?? world?.mission?.score ?? 0;
      st.survivalRuns++;
      st.bestSurvivalWave = Math.max(st.bestSurvivalWave, waves);
      st.bestSurvivalScore = Math.max(st.bestSurvivalScore, score);
      const rec = p.survival[survival.id] ?? { bestScore: 0, bestWave: 0, runs: 0, at: 0 };
      const pb = score > rec.bestScore;
      p.survival[survival.id] = { bestScore: Math.max(rec.bestScore, score), bestWave: Math.max(rec.bestWave, waves), runs: rec.runs + 1, at: pb ? this.now() : rec.at };
      this.addXp(25 * waves + 2 * waves * waves, `Survival · ${waves} wave${waves === 1 ? '' : 's'}`);
      this.addXp(150 * bosses, 'Boss waves destroyed');
      if (pb && rec.runs > 0) this.addXp(100, 'New personal best');
      this.setMax('bestWave', waves);
      this.setMax('bestSurvival', score);
      if (bosses) this.bump('bosses', bosses);
      // five waves "complete" the operation so the next special op unlocks in the campaign list
      if (waves >= 5) {
        try { recordResult(survival.id, { won: true, stars: waves >= 15 ? 3 : waves >= 10 ? 2 : 1, time: r.time, score }); } catch { /* no storage */ }
      }
    } else if (campaign && won) {
      const stars = r.stars ?? 1;
      const prior = m.prior;
      this.addXp(150 + 100 * stars, `Mission complete · ${stars} star${stars === 1 ? '' : 's'}`);
      if (!prior?.completed) this.addXp(250, 'First completion');
      const better = stars - (prior?.stars ?? 0);
      if (prior?.completed && better > 0) this.addXp(100 * better, 'New stars');
    }

    // ---- achievements
    this.bump('games');
    if (won) { this.bump('wins'); this.unlock('first-victory'); }
    this.bump('harvested', Math.round(r.stats.harvested));
    const climate = m.climate ?? world?.map.climate;
    if (climate) {
      p.climates[climate] = (p.climates[climate] ?? 0) + 1;
      this.setMax('climates', CLIMATES.filter((c) => (p.climates[c] ?? 0) > 0).length);
    }
    if (r.weather === 'storm') m.storm = true;
    if (won) {
      if (m.storm) this.unlock('riders-on-the-storm');
      if (m.factLost) this.unlock('phoenix');
    }
    if (r.mode === 'skirmish' && won) {
      if (diff === 'brutal') this.unlock('iron-will');
      if (r.stats.buildingsLost === 0) this.unlock('untouchable');
      if (r.time < 600) this.unlock('blitzkrieg');
      if (r.time < 360) this.unlock('lightning-war');
      if (info.opponents >= 3) this.unlock('against-all-odds');
      const all = info.difficulties ?? (diff ? Array(info.opponents).fill(diff) : []);
      if (info.opponents >= 3 && all.length >= 3 && all.every((d) => d === 'brutal')) this.unlock('hell-march');
    }
    if (r.mode === 'mission') this.checkCampaigns(campaign && won ? { id: missionId!, stars: r.stars ?? 1 } : undefined);

    // ---- daily challenge
    let dailyScore: number | undefined;
    if (daily) {
      const day = m.dailyDay ?? currentDailyDay();
      const cfg = dailyConfig(day);
      const d = p.daily;
      const firstPlayToday = d.lastDay !== day;
      if (firstPlayToday) {
        d.streak = d.lastDay === prevDay(day) ? d.streak + 1 : 1;
        d.lastDay = day;
        d.longest = Math.max(d.longest, d.streak);
      }
      st.dailyPlayed++;
      const prev = d.best[day];
      const firstWinToday = won && !prev?.won;
      if (won) { st.dailyWins++; this.bump('dailyWins'); }
      this.setMax('streak', d.streak);
      if (firstWinToday) {
        this.addXp(600 + 100 * cfg.modifiers.length, 'Daily Challenge');
        this.addXp(50 * Math.min(d.streak, 10), `Streak bonus · ${d.streak} day${d.streak === 1 ? '' : 's'}`);
      } else if (won) this.addXp(150, 'Daily Challenge (replay)');
      else if (firstPlayToday) this.addXp(100, 'Daily Challenge attempt');
      dailyScore = Math.round((r.score ?? world?.mission?.score ?? 0) + DAILY_MEDAL_BONUS * m.medals.length);
      d.best[day] = {
        score: Math.max(prev?.score ?? 0, dailyScore), won: won || !!prev?.won,
        time: won ? Math.min(prev?.won ? prev.time : Infinity, r.time) : prev?.time ?? 0,
        attempts: (prev?.attempts ?? 0) + 1, at: this.now(),
      };
      // keep the leaderboard to the last 60 days
      const keys = Object.keys(d.best).sort();
      for (const k of keys.slice(0, Math.max(0, keys.length - 60))) delete d.best[k];
    }

    // ---- history & summary
    const record: MatchRecord = {
      at: this.now(), mode: r.mode, missionId, title: this.titleFor(info), faction, difficulty: info.difficulty, opponents: info.opponents, won, time: r.time,
      kills: r.stats.unitsKilled + r.stats.buildingsKilled, lost: r.stats.unitsLost, score: daily ? dailyScore : r.score, stars: campaign ? r.stars : undefined,
      wave: survival ? waves : undefined, xp: m.xp, medals: [...m.medals], climate,
    };
    this.pushHistory(record);
    const after = rankProgress(p.xp, p.faction);
    const before = rankProgress(m.xpAtStart, p.faction);
    const summary: MatchSummary = {
      xp: m.xp, lines: [...m.lines].map(([label, xp]) => ({ label, xp })).sort((a, b) => b.xp - a.xp), xpBefore: m.xpAtStart, xpAfter: p.xp,
      rankBefore: before.index, rankAfter: after.index, rankName: after.name, nextName: after.next ? rankName(after.next.index, p.faction) : null,
      fracBefore: before.frac, fracAfter: after.frac, intoAfter: after.into, spanAfter: after.span, faction: p.faction, medals: m.medals.length, won,
      dailyScore, medalIds: [...m.medals], record,
    };
    this.match = null;
    this.save();
    return summary;
  }

  // ===========================================================================
  // Counters, medals, XP
  // ===========================================================================
  private bump(counter: string, by = 1) {
    if (by <= 0) return;
    const c = this.profile.counters;
    c[counter] = (c[counter] ?? 0) + by;
    this.checkCounter(counter);
  }
  private setMax(counter: string, v: number) {
    const c = this.profile.counters;
    if (!(v > (c[counter] ?? 0))) return;
    c[counter] = v;
    this.checkCounter(counter);
  }
  private checkCounter(counter: string) {
    const list = BY_COUNTER[counter];
    if (!list) return;
    const v = this.profile.counters[counter] ?? 0;
    for (const a of list) {
      const tiers = a.tiers!;
      const have = this.profile.medals[a.id]?.tier ?? 0;
      let reach = have;
      while (reach < tiers.length && v >= tiers[reach]) reach++;
      for (let t = have; t < reach; t++) this.grant(a, t);
    }
  }
  /** Unlock a single-tier medal by id (no-op when already earned). */
  unlock(id: string) {
    const a = ACH_BY_ID[id];
    if (!a || this.profile.medals[id]) return;
    this.grant(a, 0);
  }
  private grant(a: AchievementDef, t: number) {
    const rec = this.profile.medals[a.id] ?? { tier: 0, at: [] };
    rec.tier = Math.max(rec.tier, t + 1);
    rec.at.push(this.now());
    this.profile.medals[a.id] = rec;
    const xp = achievementXp(a, t);
    this.match?.medals.push(a.id);
    const rarity = achievementRarity(a, t);
    this.notify({
      id: a.id, kind: 'medal', title: a.title, desc: achievementDesc(a, t), xp, rarity,
      tier: isTiered(a) ? TIER_NAMES[t] : rarity.charAt(0).toUpperCase() + rarity.slice(1),
      icon: medalSvg({ metal: achievementMetal(a, t), picto: a.picto, category: a.category }),
    });
    this.addXp(xp, 'Medals');
    this.save();
  }
  private killXp(v: number) {
    const m = this.match;
    if (!m) return;
    m.killXp += v;
    if (m.killXp >= 25) this.flushKillXp();
  }
  private flushKillXp() {
    const m = this.match;
    if (!m || m.killXp < 1) return;
    const whole = Math.floor(m.killXp);
    m.killXp -= whole;
    this.addXp(whole, 'Enemies destroyed');
  }
  private addXp(xp: number, label: string) {
    xp = Math.round(xp);
    if (xp <= 0) return;
    const before = rankIndexFor(this.profile.xp);
    this.profile.xp += xp;
    if (this.match) {
      this.match.xp += xp;
      this.match.lines.set(label, (this.match.lines.get(label) ?? 0) + xp);
    }
    const after = rankIndexFor(this.profile.xp);
    if (after > before) {
      const next = after < MAX_RANK ? RANKS[after + 1] : null;
      const name = rankName(after, this.profile.faction);
      this.notify({
        kind: 'rank', title: name, xp: 0, icon: insigniaSvg(after, this.profile.faction),
        desc: next ? `Promoted for valour. Next: ${rankName(next.index, this.profile.faction)} at ${next.xp.toLocaleString('en-US')} XP` : 'The highest rank a commander can hold.',
      });
    }
  }
  private notify(a: UnlockInfo) {
    try { this.onUnlock?.(a); } catch (e) { console.warn('onUnlock failed', e); }
  }

  private checkCampaigns(extra?: { id: string; stars: number }) {
    let prog: Record<string, MissionRecord> = {};
    try { prog = loadProgress(); } catch { /* no storage */ }
    if (extra) prog[extra.id] = { ...prog[extra.id], completed: true, stars: Math.max(prog[extra.id]?.stars ?? 0, extra.stars) };
    const allies = campaignMissions('allies'), soviet = campaignMissions('soviet');
    if (allies.length && allies.every((d) => prog[d.id]?.completed)) this.unlock('for-liberty');
    if (soviet.length && soviet.every((d) => prog[d.id]?.completed)) this.unlock('for-the-motherland');
    const all = [...allies, ...soviet];
    if (all.length && all.every((d) => (prog[d.id]?.stars ?? 0) >= 3)) this.unlock('perfectionist');
  }

  private titleFor(info: GameStartInfo): string {
    if (info.missionId) {
      if (info.missionId === 'daily') return `Daily Challenge #${dailyConfig(this.match?.dailyDay ?? currentDailyDay()).number}`;
      return getMission(info.missionId)?.title ?? info.missionId;
    }
    return `Skirmish · ${info.opponents} AI${info.opponents === 1 ? '' : 's'}`;
  }
  private pushHistory(r: MatchRecord) {
    this.profile.history.unshift(r);
    if (this.profile.history.length > 20) this.profile.history.length = 20;
  }
}

// =============================================================================
// Read-only helpers for the menus
// =============================================================================
export interface AchievementState {
  def: AchievementDef;
  /** Tiers earned (0 = locked). */
  tier: number;
  tiers: number;
  done: boolean;
  cur: number;
  target: number;
  /** 0..1 towards the next tier (1 when complete). */
  frac: number;
  /** Shown as "Classified" while locked. */
  secret: boolean;
  unlockedAt?: number;
}

export function achievementState(a: AchievementDef, p: Profile, prog?: Record<string, MissionRecord>): AchievementState {
  const tier = p.medals[a.id]?.tier ?? 0;
  const tiers = tierCount(a);
  const done = tier >= tiers;
  let cur = tier ? 1 : 0, target = 1;
  if (a.counter && a.tiers) {
    cur = p.counters[a.counter] ?? 0;
    target = a.tiers[Math.min(tier, a.tiers.length - 1)];
  } else if (a.category === 'campaign') {
    const pr = prog ?? (() => { try { return loadProgress(); } catch { return {}; } })();
    const allies = campaignMissions('allies'), soviet = campaignMissions('soviet');
    const list = a.id === 'for-liberty' ? allies : a.id === 'for-the-motherland' ? soviet : [...allies, ...soviet];
    if (a.id === 'perfectionist') { target = list.length * 3; cur = list.reduce((s, d) => s + Math.min(3, pr[d.id]?.stars ?? 0), 0); }
    else { target = list.length; cur = list.filter((d) => pr[d.id]?.completed).length; }
    if (done) cur = target;
  }
  const frac = done ? 1 : target > 0 ? Math.min(1, cur / target) : 0;
  const at = p.medals[a.id]?.at;
  return { def: a, tier, tiers, done, cur: Math.min(cur, target), target, frac, secret: !!a.hidden && tier === 0, unlockedAt: at?.[at.length - 1] };
}

export function allAchievementStates(p: Profile = loadProfile()): AchievementState[] {
  let prog: Record<string, MissionRecord> = {};
  try { prog = loadProgress(); } catch { /* none */ }
  return ACHIEVEMENTS.map((a) => achievementState(a, p, prog));
}

/** Medals earned (tiers count individually) / total. */
export function medalTotals(p: Profile = loadProfile()): { earned: number; total: number; achievements: number; complete: number } {
  let earned = 0, total = 0, complete = 0;
  for (const a of ACHIEVEMENTS) {
    const t = tierCount(a);
    total += t;
    const have = Math.min(t, p.medals[a.id]?.tier ?? 0);
    earned += have;
    if (have >= t) complete++;
  }
  return { earned, total, achievements: ACHIEVEMENTS.length, complete };
}

/** Favourite unit: the unit type with the most kills. */
export function favouriteUnit(p: Profile): { id: string; name: string; kills: number } | null {
  let best: string | null = null, bk = 0;
  for (const [id, k] of Object.entries(p.stats.killsByUnit)) if (UNITS[id] && k > bk) { bk = k; best = id; }
  return best ? { id: best, name: UNITS[best].name, kills: bk } : null;
}

// =============================================================================
// Rank badge for the main menu
// =============================================================================
const BADGE_CSS = `
.rh-cmdr { display: inline-flex; align-items: center; gap: .75rem; padding: .4rem 1rem .4rem .45rem; border-radius: .7rem; cursor: pointer; text-align: left;
  background: linear-gradient(90deg, rgba(255, 255, 255, .07), rgba(255, 255, 255, .015)); border: 1px solid rgba(255, 255, 255, .1);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, .06), 0 .5rem 1.4rem rgba(0, 0, 0, .3); transition: border-color .25s, background .25s, transform .25s; font-family: var(--font, sans-serif); color: var(--text, #e9f0f7); }
.rh-cmdr:hover { border-color: rgba(255, 207, 63, .5); background: linear-gradient(90deg, rgba(255, 207, 63, .12), rgba(255, 255, 255, .02)); transform: translateY(-1px); }
.rh-cmdr > svg { width: 2.6rem; height: 2.6rem; flex-shrink: 0; filter: drop-shadow(0 .2rem .35rem rgba(0, 0, 0, .55)); }
.rh-cmdr-t { display: flex; flex-direction: column; min-width: 9.5rem; }
.rh-cmdr-t small { font-size: .62rem; font-weight: 700; letter-spacing: .3em; text-transform: uppercase; color: #ffd34d; white-space: nowrap; }
.rh-cmdr-t b { font-size: 1.12rem; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; line-height: 1.15; white-space: nowrap; }
.rh-cmdr-bar { display: block; position: relative; height: .22rem; margin-top: .3rem; border-radius: 1rem; background: rgba(255, 255, 255, .09); overflow: hidden; }
.rh-cmdr-bar i { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 1rem; background: linear-gradient(90deg, #a8741a, #ffcf3f); box-shadow: 0 0 .5rem rgba(255, 207, 63, .7); }
.rh-cmdr-x { font-family: var(--mono, monospace); font-size: .66rem; color: var(--muted, #7d8c9d); margin-top: .18rem; letter-spacing: .04em; white-space: nowrap; }
.mm-nav-btn .nb-label:has(.rh-daily-pill) { white-space: nowrap; }
.rh-daily-pill { display: inline-block; margin-left: .45rem; padding: .06rem .3rem; border-radius: .3rem; font-style: normal; font-size: .52rem; letter-spacing: .14em; vertical-align: .2em;
  color: #ffb45a; border: 1px solid rgba(255, 170, 80, .55); background: rgba(255, 130, 50, .14); box-shadow: 0 0 .6rem rgba(255, 130, 50, .25); animation: rhPill 1.4s ease-in-out infinite alternate; }
@keyframes rhPill { to { box-shadow: 0 0 1rem rgba(255, 130, 50, .55); color: #ffd9a8; } }
`;

/** True when today's daily challenge has not been attempted yet. */
export function dailyPending(p: Profile = loadProfile()): boolean {
  return !p.daily.best[currentDailyDay()];
}

/** Compact commander badge (insignia, rank, name, XP bar) as HTML. Injects its CSS on first use. */
export function rankBadge(p: Profile = loadProfile()): string {
  if (typeof document !== 'undefined' && !document.getElementById('rh-cmdr-style')) {
    const st = document.createElement('style');
    st.id = 'rh-cmdr-style';
    st.textContent = BADGE_CSS;
    document.head.appendChild(st);
  }
  const rp = rankProgress(p.xp, p.faction);
  const name = p.name.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  const nextTxt = rp.next ? `${p.xp.toLocaleString('en-US')} / ${rp.next.xp.toLocaleString('en-US')} XP` : `${p.xp.toLocaleString('en-US')} XP · max rank`;
  return `<span class="rh-cmdr" title="Commander profile">${insigniaSvg(rp.index, p.faction)}<span class="rh-cmdr-t"><small>${rp.name}</small><b>${name}</b>`
    + `<span class="rh-cmdr-bar"><i style="width:${(rp.frac * 100).toFixed(1)}%"></i></span><span class="rh-cmdr-x">${nextTxt}</span></span></span>`;
}

/** Convenience: wire a tracker's unlocks to the animated toasts. */
export function toastUnlocks(t: MetaTracker) {
  t.onUnlock = (a) => showAchievementToast(a);
}
export { showXpSummary as showMatchSummary };
