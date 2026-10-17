/**
 * From a started room to the GameSetup every client builds its World from. Deterministic: the same start
 * message gives every client the same setup (only `net.local`, the player this client commands, differs), so
 * the worlds are identical. DOM-free (the headless clients of the tests and tools use it too).
 */
import type { GameSetup } from '../game';
import type { Faction } from '../data/rules';
import type { AIDifficulty } from '../sim/ai';
import type { PlayerSetup } from '../sim/world';
import { getMapDef } from '../maps';
import { validDoctrine } from '../sim/doctrine';
import type { ModSet } from '../mods/format';
import type { MatchStart, SlotView } from './protocol';
import { activeSlots, SLOT_COLORS, slotTeam, type NetMode } from './settings';

/** One player of a multiplayer match (GameSetup.net.players, in World player order). */
export interface NetPlayer {
  name: string;
  faction: Faction;
  color: number;
  team: number;
  human: boolean;
  ai?: AIDifficulty;
  /** Relay seat id of a human. */
  seat?: number;
  /** Lobby slot (0-3). */
  slot: number;
}

/** GameSetup.net: what makes a setup a multiplayer match (saves and replays carry it). */
export interface NetSetup {
  room: string;
  mode: NetMode;
  players: NetPlayer[];
  /** World player index this client commands (-1: watching). */
  local: number;
  /** [tick, player] humans replaced by the AI during the match (replays apply them at those ticks). */
  drops?: [number, number][];
}

/** Difficulty of the AI that takes over a dropped player (no economy bonus). */
export const TAKEOVER_AI: AIDifficulty = 'normal';

const NAMES_AI = ['Gen. Volkov', 'Marshal Krukov', 'Col. Nadia', 'Gen. Stavros', 'Cdr. Bennett', 'Maj. Kane'];

/** Resolve a faction pick ('random' draws from the match seed, per slot). */
function faction(pick: SlotView['faction'], seed: number, slot: number): Faction {
  if (pick === 'allies' || pick === 'soviet') return pick;
  let h = (seed ^ Math.imul(slot + 1, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  return (h >>> 7) & 1 ? 'allies' : 'soviet';
}

/** The players of a started room, in World order. */
export function netPlayers(start: MatchStart): NetPlayer[] {
  const mode = start.room.settings.mode;
  let ai = 0;
  return activeSlots(start.room).map(({ slot, index }) => {
    const human = slot.kind === 'human';
    return {
      name: human ? slot.name ?? 'Commander' : NAMES_AI[(start.seed + ai++) % NAMES_AI.length],
      faction: faction(slot.faction, start.seed, index),
      color: SLOT_COLORS[index] ?? SLOT_COLORS[0],
      team: slotTeam(mode, index, slot.kind),
      human,
      ai: human ? undefined : slot.ai ?? 'normal',
      seat: human ? slot.seat : undefined,
      slot: index,
    };
  });
}

/**
 * The GameSetup of a started match for the client in `localSeat` (null: a spectator). `quality` and `mods` are
 * per device (every member's mod set has the room's hash, so the content is the same).
 */
export function matchSetup(start: MatchStart, localSeat: number | null, quality: GameSetup['quality'], mods?: ModSet | null): GameSetup {
  const s = start.room.settings;
  const players = netPlayers(start);
  const local = localSeat === null ? -1 : players.findIndex((p) => p.human && p.seat === localSeat);
  const curated = s.map !== 'gen' ? getMapDef(s.map) : undefined;
  const slots = activeSlots(start.room);
  return {
    // the first player stands in for "the human" of a skirmish setup (the roster below replaces the player list)
    faction: players[0].faction, color: players[0].color,
    opponents: players.slice(1).map((p) => ({ faction: p.faction, difficulty: p.ai ?? 'normal' })),
    mapSize: curated?.size ?? s.size, water: s.water, trees: s.trees, ore: s.ore, credits: s.credits, startUnits: s.startUnits,
    fog: s.fog, timeOfDay: 'day', quality, seed: start.seed, climate: curated?.climate ?? s.climate, weather: 'auto', dayCycle: true,
    intro: false, mapId: curated?.id, rules: s.rules, mutators: s.mutators, events: s.events, ceasefire: s.ceasefire || undefined,
    doctrines: s.rules === 'commander' ? players.map((p, i) => (p.human ? validDoctrine(slots[i].slot.doctrine ?? null, p.faction) : null)) : undefined,
    mods: mods ?? undefined,
    net: { room: start.room.code, mode: s.mode, players, local },
    dmath: true, // every client computes the same maths (src/net/dmath.ts)
  };
}

/** Replace a skirmish player list with the match roster (game.ts and modes/headless.ts, before the World is built). */
export function applyNetRoster(players: PlayerSetup[], net: NetSetup) {
  players.length = 0;
  for (const p of net.players) {
    players.push({ name: p.name, faction: p.faction, color: p.color, team: p.team, isHuman: p.human, ai: p.human ? undefined : p.ai ?? 'normal' });
  }
}
