/**
 * Battle report sampler for the post-match results screen (src/ui/results.ts): every 10 s of battle it records
 * each player's army value, income, kills and losses, keeps the local MVP unit and notes the match's
 * highlights (first blood, superweapons, elite promotions, captures, eliminations). It also hands the local
 * player's numbers to the MetaTracker (contracts such as "field an army worth $20k").
 *
 * Read-only: it never changes the world, and it is not part of the simulation state (saves and replays do
 * not carry it; a loaded game reports from the moment it was loaded). game.ts calls afterStep() after every
 * world step, before the step's events are drained. Cost: a switch over the tick's events, plus one pass
 * over the units every 10 s.
 */
import type { Player } from '../sim/player';
import type { Unit } from '../sim/entities';
import type { World } from '../sim/world';
import { TICK_HZ } from '../sim/types';
import { BUILDINGS, UNITS } from '../data/rules';
import type { LiveSample } from './index';
import { englishCatalog, fmtMoney, fmtPct, type Params } from '../i18n/core';
import { formatMessage } from '../i18n/format';
import { typeName } from '../i18n/names';
import tMeta from '../i18n/en/meta';
import { moneyShort } from './contracts';

export const SAMPLE_SECONDS = 10;

export interface PlayerSample {
  /** Value of combat units alive. */
  army: number;
  /** Ore income over the last minute (six samples: harvester deliveries are lumpy), $ per minute. */
  income: number;
  harvested: number;
  /** Cumulative kills (units + structures) and losses. */
  kills: number;
  losses: number;
}

export interface ReportSample {
  /** Battle time, seconds. */
  t: number;
  players: PlayerSample[];
}

export type HighlightKind = 'first-blood' | 'superweapon' | 'elite' | 'capture' | 'eliminated' | 'peak' | 'clash' | 'comeback' | 'chrono';

export interface Highlight {
  t: number;
  kind: HighlightKind;
  /** In the active language. */
  text: string;
  /** In English (clip file names). */
  en: string;
}

type ReportKey = 'firstBlood' | 'nuke' | 'elite' | 'captured' | 'capturedUnknown' | 'chrono' | 'overrun' | 'eliminated' | 'peak' | 'clash' | 'comeback';
/** A highlight's text (src/i18n/en/meta.ts report.*): `en` gives the English, for file names. */
type HlText = (en: boolean) => string;
const say = (key: ReportKey, params?: Params, enParams: Params | undefined = params): HlText => (en) =>
  (en ? formatMessage(englishCatalog()[`meta.report.${key}`] ?? '', enParams, 'en') : tMeta(`report.${key}`, params));

/** A highlight noted during the battle: its text is made when the report is shown (in the language of that moment). */
interface PendingHighlight {
  t: number;
  kind: HighlightKind;
  text: HlText;
}

export interface MvpInfo {
  id: number;
  type: string;
  name: string;
  kills: number;
  /** Value destroyed (veterancy XP). */
  xp: number;
  rank: number;
  alive: boolean;
}

export class BattleReport {
  readonly samples: ReportSample[] = [];
  private events: PendingHighlight[] = [];
  private last = -1;
  private done = false;
  private best: MvpInfo | null = null;
  private firstBlood = false;
  private elites = 0;

  constructor(private world: World, private local: () => Player, private onSample?: (s: LiveSample) => void) {}

  /** Call after every world step (before the step's events are drained). */
  afterStep() {
    const w = this.world;
    if (this.done) return;
    const me = this.local();
    if (w.events.length) this.scanEvents(me);
    if (!this.firstBlood && me.stats.unitsKilled + me.stats.buildingsKilled > 0) {
      this.firstBlood = true;
      this.events.push({ t: w.time, kind: 'first-blood', text: say('firstBlood') });
    }
    if (w.gameOver) { this.done = true; this.sample(); return; }
    if (this.last >= 0 && w.tick - this.last < SAMPLE_SECONDS * TICK_HZ) return;
    this.sample();
  }

  private scanEvents(me: Player) {
    const w = this.world;
    for (const ev of w.events) {
      switch (ev.e) {
        case 'announce':
          if (ev.player === me.id && ev.key === 'nuke_launched') this.events.push({ t: w.time, kind: 'superweapon', text: say('nuke') });
          break;
        case 'promoted':
          if (ev.rank >= 2) {
            const u = w.getEntity(ev.id);
            if (u && u.owner === me && ++this.elites === 1) {
              const type = u.type;
              this.events.push({ t: w.time, kind: 'elite', text: say('elite', { unit: typeName(type) }, { unit: type.name }) });
            }
          }
          break;
        case 'captured':
          if (ev.to === me.id && ev.from !== me.id) {
            const b = w.getEntity(ev.id);
            const def = b ? (BUILDINGS[b.type.id] ?? b.type) : null;
            this.events.push({ t: w.time, kind: 'capture', text: def ? say('captured', { building: typeName(def) }, { building: def.name }) : say('capturedUnknown') });
          }
          break;
        case 'teleport': {
          const u = w.getEntity(ev.id);
          const type = u?.type;
          if (u && type && u.owner === me) this.events.push({ t: w.time, kind: 'chrono', text: say('chrono', { unit: typeName(type) }, { unit: type.name }) });
          break;
        }
        case 'eliminated': {
          const p = w.players[ev.player];
          const name = p?.name ?? '';
          if (p) this.events.push({ t: w.time, kind: 'eliminated', text: p === me ? say('overrun') : say('eliminated', { player: name }) });
          break;
        }
      }
    }
  }

  private sample() {
    const w = this.world;
    const me = this.local();
    this.last = w.tick;
    const army = new Array<number>(w.players.length).fill(0);
    // the MVP so far fell since the last sample: its record stands
    if (this.best?.alive && !w.getEntity(this.best.id)?.alive) this.best = { ...this.best, alive: false };
    for (const u of w.units) {
      if (!u.alive || u.ut.harvester || !u.weapons.length) continue;
      const i = u.owner.id;
      if (i >= 0 && i < army.length) army[i] += u.ut.cost;
      if (u.owner === me && u.kills > 0) this.considerMvp(u);
    }
    const base = this.samples[Math.max(0, this.samples.length - 6)];
    const dt = base ? Math.max(1, w.time - base.t) : 0;
    const players: PlayerSample[] = w.players.map((p, i) => {
      const h = p.stats.harvested;
      const income = base && dt ? Math.max(0, ((h - (base.players[i]?.harvested ?? 0)) / dt) * 60) : 0;
      return { army: army[i], income: Math.round(income), harvested: Math.round(h), kills: p.stats.unitsKilled + p.stats.buildingsKilled, losses: p.stats.unitsLost + p.stats.buildingsLost };
    });
    this.samples.push({ t: w.time, players });
    try { this.onSample?.({ world: w, local: me.id, army: army[me.id] ?? 0 }); } catch (e) { console.warn('report sample', e); }
  }

  /** The local unit with the most kills (value destroyed breaks ties), alive or fallen. */
  mvp(): MvpInfo | null {
    if (!this.done) this.sampleMvpOnly();
    return this.best;
  }

  private sampleMvpOnly() {
    const me = this.local();
    if (this.best?.alive && !this.world.getEntity(this.best.id)?.alive) this.best = { ...this.best, alive: false };
    for (const u of this.world.units) if (u.alive && u.owner === me && u.kills > 0) this.considerMvp(u);
  }

  private considerMvp(u: Unit) {
    const b = this.best;
    if (b && b.id !== u.id && (u.kills < b.kills || (u.kills === b.kills && u.xp <= b.xp))) return;
    this.best = { id: u.id, type: u.type.id, name: UNITS[u.type.id]?.name ?? u.type.name, kills: u.kills, xp: u.xp, rank: u.rank, alive: true };
  }

  /** Highlights of the battle, in time order (event moments plus what the samples show). */
  highlights(won: boolean, max = 6): Highlight[] {
    const out: Highlight[] = [];
    const add = (t: number, kind: HighlightKind, text: HlText) => out.push({ t, kind, text: text(false), en: text(true) });
    for (const e of this.events) add(e.t, e.kind, e.text);
    const me = this.local().id;
    const s = this.samples;
    if (s.length >= 3) {
      // peak army
      let peak = 0, peakT = 0;
      for (const x of s) if ((x.players[me]?.army ?? 0) > peak) { peak = x.players[me].army; peakT = x.t; }
      if (peak >= 3000) add(peakT, 'peak', say('peak', { money: money(peak) }, { money: moneyEn(peak) }));
      // biggest clash: most losses on all sides in one interval
      let clash = 0, clashT = 0;
      for (let i = 1; i < s.length; i++) {
        let lost = 0;
        for (let p = 0; p < s[i].players.length; p++) lost += (s[i].players[p]?.losses ?? 0) - (s[i - 1].players[p]?.losses ?? 0);
        if (lost > clash) { clash = lost; clashT = s[i].t; }
      }
      if (clash >= 6) add(clashT, 'clash', say('clash', { n: clash, s: SAMPLE_SECONDS }, { n: String(clash), s: String(SAMPLE_SECONDS) }));
      // comeback: the lowest share of the army strength, after the opening
      let low = 1, lowT = 0;
      for (const x of s) {
        if (x.t < 180) continue;
        const mine = x.players[me]?.army ?? 0;
        const all = x.players.reduce((a, p) => a + p.army, 0);
        if (all > 2000 && mine / all < low) { low = mine / all; lowT = x.t; }
      }
      if (won && low < 0.35) add(lowT, 'comeback', say('comeback', { pct: fmtPct(Math.round(low * 100) / 100) }, { pct: `${Math.round(low * 100)}%` }));
    }
    return out.sort((a, b) => a.t - b.t).slice(0, max);
  }
}

function money(n: number): string {
  return n >= 10000 ? moneyShort(n, 1) : fmtMoney(Math.round(n));
}
function moneyEn(n: number): string {
  return n >= 10000 ? `$${(n / 1000).toFixed(1)}k` : `$${Math.round(n).toLocaleString('en-US')}`;
}
