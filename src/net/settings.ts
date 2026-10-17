/**
 * Multiplayer match settings and lobby rules (modes, teams, slots), shared by the lobby UI, the clients and
 * the relay. DOM-free. The relay normalises whatever the host sends with `normaliseSettings`, so every client
 * sees (and builds the match from) the same, valid settings.
 */
import { CURATED_MAPS } from '../maps';
import { normaliseMutators } from '../modes/mutators';
import { MAX_SLOTS, type RoomView, type SlotView } from './protocol';

export type NetMode = '1v1' | '2v2' | 'ffa' | 'coop';
export type FactionPick = 'allies' | 'soviet' | 'random';
export type Climate = 'temperate' | 'winter' | 'desert';

export interface MatchSettings {
  mode: NetMode;
  /** Commander (doctrines, commander powers, battlefield events) or Classic (pure Red Alert) rules. */
  rules: 'commander' | 'classic';
  mutators: string[];
  /** 'gen' = a generated map from the fields below, or a curated map id (src/maps). */
  map: string;
  size: number;
  climate: Climate;
  water: number;
  trees: number;
  ore: number;
  credits: number;
  startUnits: 'mcv' | 'light' | 'heavy';
  fog: boolean;
  /** Build-up time in minutes (0 = none). */
  ceasefire: number;
  /** Battlefield events (Commander rules). */
  events: boolean;
}

export const MODES: { id: NetMode; name: string; desc: string }[] = [
  { id: '1v1', name: '1 vs 1', desc: 'Two commanders, one battlefield.' },
  { id: '2v2', name: '2 vs 2', desc: 'Two teams of two; any seat can be an AI.' },
  { id: 'ffa', name: 'Free for all', desc: 'Up to four commanders, every one for himself.' },
  { id: 'coop', name: 'Co-op vs AI', desc: 'Players team up against AI commanders.' },
];
export const MAP_SIZES = [64, 80, 96, 112, 128];
export const CREDIT_OPTIONS = [2500, 5000, 7500, 10000, 20000];
export const CEASEFIRE_OPTIONS = [0, 1, 2, 3, 5];
export const CLIMATES: Climate[] = ['temperate', 'winter', 'desert'];
/** Player colours by slot (blue, red, yellow, green). */
export const SLOT_COLORS = [0x3d7be0, 0xd23a2c, 0xe0b030, 0x3fa34d];

export const DEFAULT_SETTINGS: MatchSettings = {
  mode: '1v1', rules: 'commander', mutators: [], map: 'gen', size: 96, climate: 'temperate',
  water: 0.4, trees: 0.5, ore: 0.6, credits: 10000, startUnits: 'mcv', fog: true, ceasefire: 0, events: true,
};

const pick = <T>(v: unknown, allowed: readonly T[], def: T): T => (allowed.includes(v as T) ? (v as T) : def);
const unit = (v: unknown, def: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.min(1, Math.max(0, v)) * 20) / 20 : def);

/** Known values only, everything clamped; unknown input gives the defaults. */
export function normaliseSettings(raw: unknown): MatchSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_SETTINGS;
  const map = typeof r.map === 'string' && (r.map === 'gen' || CURATED_MAPS.some((m) => m.id === r.map)) ? r.map : 'gen';
  return {
    mode: pick(r.mode, MODES.map((m) => m.id), d.mode),
    rules: pick(r.rules, ['commander', 'classic'] as const, d.rules),
    mutators: normaliseMutators(Array.isArray(r.mutators) ? r.mutators.slice(0, 12) : []),
    map,
    size: pick(r.size, MAP_SIZES, d.size),
    climate: pick(r.climate, CLIMATES, d.climate),
    water: unit(r.water, d.water),
    trees: unit(r.trees, d.trees),
    ore: unit(r.ore, d.ore),
    credits: pick(r.credits, CREDIT_OPTIONS, d.credits),
    startUnits: pick(r.startUnits, ['mcv', 'light', 'heavy'] as const, d.startUnits),
    fog: typeof r.fog === 'boolean' ? r.fog : d.fog,
    ceasefire: pick(r.ceasefire, CEASEFIRE_OPTIONS, d.ceasefire),
    events: typeof r.events === 'boolean' ? r.events : d.events,
  };
}

/** Slots a mode uses (the others are closed). */
export function modeSlots(mode: NetMode): number {
  return mode === '1v1' ? 2 : MAX_SLOTS;
}

/** Team of a slot: 2v2 pairs slots 0+1 against 2+3; co-op puts every human on one team against the AI. */
export function slotTeam(mode: NetMode, slot: number, kind: SlotView['kind']): number {
  if (mode === '2v2') return slot < 2 ? 0 : 1;
  if (mode === 'coop') return kind === 'ai' ? 1 : 0;
  return slot;
}

/** Fresh slots for a mode: slot 0 for the host, the rest open (co-op: one Normal AI opponent to start). */
export function initialSlots(mode: NetMode): SlotView[] {
  const n = modeSlots(mode);
  return Array.from({ length: MAX_SLOTS }, (_, i): SlotView => {
    if (i >= n) return { kind: 'closed', faction: 'random' };
    if (mode === 'coop' && i === n - 1) return { kind: 'ai', faction: 'random', ai: 'normal' };
    return { kind: 'open', faction: 'random' };
  });
}

/** Players taking part: humans and AI, in slot order. */
export function activeSlots(room: Pick<RoomView, 'slots'>): { slot: SlotView; index: number }[] {
  return room.slots.map((slot, index) => ({ slot, index })).filter((s) => s.slot.kind === 'human' || s.slot.kind === 'ai');
}

/** Why the room cannot start yet (null = it can). */
export function startProblem(room: Pick<RoomView, 'slots' | 'settings'>): string | null {
  const act = activeSlots(room);
  const humans = act.filter((s) => s.slot.kind === 'human');
  if (humans.length < 2) return 'Waiting for another player';
  if (humans.some((s) => !s.slot.connected)) return 'A player is reconnecting';
  if (humans.some((s) => !s.slot.ready)) return 'Waiting for everyone to be ready';
  const mode = room.settings.mode;
  const teams = new Set(act.map((s) => slotTeam(mode, s.index, s.slot.kind)));
  if (teams.size < 2) return mode === 'coop' ? 'Add at least one AI opponent' : 'Both teams need a player';
  if (mode === '2v2' && act.length < 4) return 'Fill all four seats (players or AI)';
  if (mode === 'ffa' && act.length < 3) return 'Free for all needs at least three commanders';
  const curated = room.settings.map !== 'gen' ? CURATED_MAPS.find((m) => m.id === room.settings.map) : undefined;
  if (curated && curated.players < act.length) return `${curated.name} is a ${curated.players}-player map`;
  return null;
}

/** Curated maps that fit a number of players. */
export function mapsFor(players: number) {
  return CURATED_MAPS.filter((m) => m.players >= players);
}
