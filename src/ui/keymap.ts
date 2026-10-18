/**
 * Key bindings: the rebindable battle hotkeys, their defaults, conflict detection and event matching.
 *
 * A binding is a canonical string: optional modifiers in the order `Ctrl+`, `Alt+`, `Shift+`, then a base key.
 * The base is the lower-cased `KeyboardEvent.key` (`a`, `f6`, `arrowup`, `[`, `space` for the space bar), or
 * `#` + `KeyboardEvent.code` for keys matched by position (`#Backquote`: the key left of 1 on every layout).
 *
 * Matching keeps the original hotkey behaviour: a binding without Shift also fires with Shift held (Shift+S still
 * stops), Ctrl must match exactly, Alt is ignored unless the binding asks for it. `lookup()` prefers the binding
 * whose modifiers match exactly, so `E` and `Shift+E` can be different actions.
 *
 * Pure module (no DOM): the settings store the overrides, `setKeymap()` makes them active, input.ts reads them.
 */
import { KEY_TEXT, ACTION_TEXT, GROUP_TEXT } from './a11y-strings';
import tCommon from '../i18n/en/common';

export type ActionId =
  | 'camUp' | 'camDown' | 'camLeft' | 'camRight' | 'rotateLeft' | 'rotateRight' | 'resetNorth' | 'zoomIn' | 'zoomOut'
  | 'home' | 'lastAttack' | 'follow' | 'bookmark1' | 'bookmark2' | 'bookmark3' | 'bookmark4'
  | 'attackMove' | 'stop' | 'scatter' | 'attackGround' | 'deploy' | 'patrol' | 'guard' | 'formation' | 'layMines'
  | 'stanceAggressive' | 'stanceGuard' | 'stanceHold' | 'stancePassive'
  | 'selectCombat' | 'selectType' | 'selectScreen' | 'nextIdle' | 'army' | 'selectDamaged' | 'sendRepair'
  | 'sell' | 'repair' | 'powers' | 'speedDown' | 'speedUp' | 'photo';

export type ActionGroup = 'camera' | 'orders' | 'stances' | 'selection' | 'base' | 'game';
export type GroupMod = 'ctrl' | 'shift' | 'alt';
export interface GroupMods { assign: GroupMod; add: GroupMod }

export interface ActionDef {
  id: ActionId;
  group: ActionGroup;
  /** Default bindings (at most two). */
  def: readonly string[];
  /** Held keys (camera scrolling): modifiers are ignored. */
  held?: boolean;
}

/** Up to this many keys per action. */
export const MAX_BINDINGS = 2;

export const ACTIONS: readonly ActionDef[] = [
  { id: 'camUp', group: 'camera', def: ['arrowup'], held: true },
  { id: 'camDown', group: 'camera', def: ['arrowdown'], held: true },
  { id: 'camLeft', group: 'camera', def: ['arrowleft'], held: true },
  { id: 'camRight', group: 'camera', def: ['arrowright'], held: true },
  { id: 'rotateLeft', group: 'camera', def: ['q', ','] },
  { id: 'rotateRight', group: 'camera', def: ['.'] },
  { id: 'resetNorth', group: 'camera', def: ['backspace'] },
  { id: 'zoomIn', group: 'camera', def: ['+', '='] },
  { id: 'zoomOut', group: 'camera', def: ['-'] },
  { id: 'home', group: 'camera', def: ['h'] },
  { id: 'lastAttack', group: 'camera', def: ['space'] },
  { id: 'follow', group: 'camera', def: ['f'] },
  { id: 'bookmark1', group: 'camera', def: ['f6'] },
  { id: 'bookmark2', group: 'camera', def: ['f7'] },
  { id: 'bookmark3', group: 'camera', def: ['f8'] },
  { id: 'bookmark4', group: 'camera', def: ['f9'] },
  { id: 'attackMove', group: 'orders', def: ['a'] },
  { id: 'stop', group: 'orders', def: ['s'] },
  { id: 'scatter', group: 'orders', def: ['x'] },
  { id: 'attackGround', group: 'orders', def: ['g'] },
  { id: 'deploy', group: 'orders', def: ['d'] },
  { id: 'patrol', group: 'orders', def: ['p'] },
  { id: 'guard', group: 'orders', def: ['c'] },
  { id: 'formation', group: 'orders', def: ['l'] },
  { id: 'layMines', group: 'orders', def: ['m'] },
  { id: 'stanceAggressive', group: 'stances', def: ['f1'] },
  { id: 'stanceGuard', group: 'stances', def: ['f2'] },
  { id: 'stanceHold', group: 'stances', def: ['f3'] },
  { id: 'stancePassive', group: 'stances', def: ['f4'] },
  { id: 'selectCombat', group: 'selection', def: ['e'] },
  { id: 'selectType', group: 'selection', def: ['w'] },
  { id: 'selectScreen', group: 'selection', def: ['Ctrl+a'] },
  { id: 'nextIdle', group: 'selection', def: ['i'] },
  { id: 'army', group: 'selection', def: ['#Backquote'] },
  { id: 'selectDamaged', group: 'selection', def: ['Shift+#KeyE'] },
  { id: 'sendRepair', group: 'selection', def: ['Shift+#KeyR'] },
  { id: 'sell', group: 'base', def: ['z'] },
  { id: 'repair', group: 'base', def: ['r'] },
  { id: 'powers', group: 'game', def: ['t'] },
  { id: 'speedDown', group: 'game', def: ['['] },
  { id: 'speedUp', group: 'game', def: [']'] },
  { id: 'photo', group: 'game', def: ['u'] },
];

export const ACTION_IDS = ACTIONS.map((a) => a.id);
const DEF = new Map(ACTIONS.map((a) => [a.id, a]));
export const GROUP_ORDER: readonly ActionGroup[] = ['camera', 'orders', 'stances', 'selection', 'base', 'game'];
export const DEFAULT_GROUP_MODS: GroupMods = { assign: 'ctrl', add: 'shift' };

/**
 * The single-key commands input.ts runs (`InputController.keyCommand`, also used by the HUD, touch and gamepad
 * buttons): an action's internal command id, independent of the key bound to it.
 */
export const ACTION_COMMAND: Partial<Record<ActionId, string>> = {
  stop: 's', attackMove: 'a', attackGround: 'g', scatter: 'x', deploy: 'd', sell: 'z', repair: 'r', patrol: 'p', guard: 'c',
  home: 'h', lastAttack: ' ', rotateLeft: 'q', rotateRight: '.', selectCombat: 'e', layMines: 'm', selectType: 'w', follow: 'f',
  resetNorth: 'backspace', photo: 'u', speedDown: '[', speedUp: ']', zoomIn: '+', zoomOut: '-',
};
const COMMAND_ACTION = new Map(Object.entries(ACTION_COMMAND).map(([a, c]) => [c, a as ActionId]));

export type Keymap = Record<ActionId, string[]>;
/** What the settings store: only the actions that differ from the defaults. */
export type KeymapOverrides = Partial<Record<string, string[]>>;

export function defaultKeymap(): Keymap {
  const km = {} as Keymap;
  for (const a of ACTIONS) km[a.id] = [...a.def];
  return km;
}

// ---------------------------------------------------------------------------
// Binding strings
// ---------------------------------------------------------------------------

export interface ParsedBinding { ctrl: boolean; alt: boolean; shift: boolean; base: string }

const MOD_ORDER = ['Ctrl', 'Alt', 'Shift'] as const;

const parsed = new Map<string, Readonly<ParsedBinding> | null>();

/** Split a binding string into modifiers and base (null for malformed input). Memoised: treat the result as read-only. */
export function parseBinding(b: unknown): Readonly<ParsedBinding> | null {
  if (typeof b !== 'string' || !b || b.length > 40) return null;
  let p = parsed.get(b);
  if (p === undefined) {
    p = parseUncached(b);
    if (parsed.size > 512) parsed.clear();
    parsed.set(b, p);
  }
  return p;
}

function parseUncached(b: string): ParsedBinding | null {
  let rest = b;
  const out: ParsedBinding = { ctrl: false, alt: false, shift: false, base: '' };
  for (;;) {
    const m = /^(Ctrl|Alt|Shift)\+(?=.)/.exec(rest);
    if (!m) break;
    out[m[1].toLowerCase() as 'ctrl' | 'alt' | 'shift'] = true;
    rest = rest.slice(m[0].length);
  }
  if (rest.startsWith('#')) {
    if (!/^#[A-Za-z0-9]{1,24}$/.test(rest)) return null;
  } else if (rest !== rest.toLowerCase() || /\s/.test(rest) || [...rest].length > 1 && !/^[a-z0-9]{2,20}$/.test(rest)) return null;
  if (['shift', 'control', 'alt', 'meta', 'os', 'altgraph'].includes(rest)) return null;
  out.base = rest;
  return out;
}

export function formatBinding(p: Readonly<ParsedBinding>): string {
  return MOD_ORDER.filter((m) => p[m.toLowerCase() as 'ctrl' | 'alt' | 'shift']).map((m) => m + '+').join('') + p.base;
}

/** Canonical form of a binding string (null when malformed). */
export function normalizeBinding(b: unknown): string | null {
  const p = parseBinding(b);
  return p ? formatBinding(p) : null;
}

/** The subset of KeyboardEvent the matcher reads (tests pass plain objects). */
export interface KeyLike { key: string; code: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean }

/** The base key of an event, as stored in bindings. */
export function eventBase(e: KeyLike): string {
  const k = e.key ?? '';
  if (!k || k === 'Dead' || k === 'Unidentified' || k === 'Process') return '#' + e.code;
  if (k === ' ') return 'space';
  return k.toLowerCase();
}

/** A binding for a key press (for the rebinding screen); null for a lone modifier key. */
export function bindingFromEvent(e: KeyLike): string | null {
  if (['Shift', 'Control', 'Alt', 'Meta', 'OS', 'AltGraph'].includes(e.key)) return null;
  return normalizeBinding(formatBinding({ ctrl: !!(e.ctrlKey || e.metaKey), alt: !!e.altKey, shift: !!e.shiftKey, base: eventBase(e) }));
}

function baseMatches(base: string, e: KeyLike): boolean {
  if (base.startsWith('#')) return e.code === base.slice(1);
  const eb = eventBase(e);
  if (eb === base) return true;
  // a letter binding on a non-Latin layout (Cyrillic, Greek…): fall back to the key's position
  return /^[a-z]$/.test(base) && !/^[\x20-\x7e]$/.test(eb) && e.code === 'Key' + base.toUpperCase();
}

export interface MatchOpts {
  /** The binding's Shift must equal the event's (default: a Shift-less binding also fires with Shift). */
  exactShift?: boolean;
  /** The binding's Alt must equal the event's (default: Alt is ignored unless the binding has it). */
  exactAlt?: boolean;
  /** Ignore Ctrl / Shift / Alt entirely (stances, bookmarks: the modifiers pick a variant). */
  anyMods?: boolean;
}

/** Does this binding fire for the event? */
export function matchesBinding(binding: string, e: KeyLike, o: MatchOpts = {}): boolean {
  const p = parseBinding(binding);
  if (!p || !baseMatches(p.base, e)) return false;
  if (o.anyMods) return true;
  const ctrl = !!(e.ctrlKey || e.metaKey);
  if (p.ctrl !== ctrl) return false;
  if (p.shift && !e.shiftKey) return false;
  if (!p.shift && e.shiftKey && o.exactShift) return false;
  if (p.alt && !e.altKey) return false;
  if (!p.alt && e.altKey && o.exactAlt) return false;
  return true;
}

/** How precisely a binding matches (higher is better; -1 = no match). */
function score(binding: string, e: KeyLike, o: MatchOpts): number {
  if (!matchesBinding(binding, e, o)) return -1;
  const p = parseBinding(binding)!;
  return (p.shift === !!e.shiftKey ? 2 : 0) + (p.alt === !!e.altKey ? 1 : 0);
}

// ---------------------------------------------------------------------------
// Reserved keys (not rebindable: menus, control groups, the build bar, the browser)
// ---------------------------------------------------------------------------

/** Why a binding can't be used, or null when it is free to bind. */
export function reservedReason(binding: string): string | null {
  const p = parseBinding(binding);
  if (!p) return KEY_TEXT.reservedInvalid;
  const b = p.base;
  if (b === 'escape') return KEY_TEXT.reservedEsc;
  if (b === 'enter' || b === 'tab' || b === 'meta') return KEY_TEXT.reservedMenus;
  if (/^[0-9]$/.test(b) || /^#(Digit|Numpad)[0-9]$/.test(b)) return KEY_TEXT.reservedGroups;
  if (b === 'b' && !p.ctrl && !p.alt) return KEY_TEXT.reservedBuild;
  if (b === 'f5' || b === 'f11' || b === 'f12' || (p.ctrl && ['w', 't', 'n', 'r', 'l', 'q', 'tab', 'f4'].includes(b))) return KEY_TEXT.reservedBrowser;
  return null;
}

// ---------------------------------------------------------------------------
// Resolving and validating
// ---------------------------------------------------------------------------

/** The full keymap from stored overrides (unknown actions and malformed / reserved keys are dropped). */
export function resolveKeymap(over: unknown): Keymap {
  const km = defaultKeymap();
  if (!over || typeof over !== 'object' || Array.isArray(over)) return km;
  for (const [id, list] of Object.entries(over as Record<string, unknown>)) {
    if (!DEF.has(id as ActionId) || !Array.isArray(list)) continue;
    const clean: string[] = [];
    for (const b of list.slice(0, 8)) {
      const n = normalizeBinding(b);
      if (n && !reservedReason(n) && !clean.includes(n)) clean.push(n);
      if (clean.length >= MAX_BINDINGS) break;
    }
    km[id as ActionId] = clean;
  }
  return km;
}

/** The overrides to store for a keymap (actions equal to their defaults are left out). */
export function keymapOverrides(km: Keymap): KeymapOverrides {
  const out: KeymapOverrides = {};
  for (const a of ACTIONS) {
    const cur = km[a.id] ?? [];
    if (cur.length !== a.def.length || cur.some((b, i) => b !== a.def[i])) out[a.id] = [...cur];
  }
  return out;
}

export function resolveGroupMods(v: unknown): GroupMods {
  const ok = (m: unknown): m is GroupMod => m === 'ctrl' || m === 'shift' || m === 'alt';
  const o = (v && typeof v === 'object' ? v : {}) as Partial<GroupMods>;
  const assign = ok(o.assign) ? o.assign : DEFAULT_GROUP_MODS.assign;
  const add = ok(o.add) ? o.add : DEFAULT_GROUP_MODS.add;
  return assign === add ? { ...DEFAULT_GROUP_MODS } : { assign, add };
}

export interface Conflict { binding: string; actions: ActionId[] }

/**
 * Keys bound to more than one action. (A Shift binding next to the plain key, E and Shift+E, is not a
 * conflict: the exact modifiers win.) Only the first action in the list would fire for a conflicting key.
 */
export function findConflicts(km: Keymap, mods: GroupMods = DEFAULT_GROUP_MODS): Conflict[] {
  const by = new Map<string, ActionId[]>();
  for (const a of ACTIONS) {
    for (const b of km[a.id] ?? []) {
      const list = by.get(b) ?? [];
      if (!list.includes(a.id)) list.push(a.id);
      by.set(b, list);
    }
  }
  const out: Conflict[] = [];
  for (const [binding, actions] of by) if (actions.length > 1) out.push({ binding, actions });
  if (mods.assign === mods.add) out.push({ binding: mods.assign, actions: [] });
  return out;
}

/** The actions (other than `except`) already using this binding. */
export function actionsUsing(km: Keymap, binding: string, except?: ActionId): ActionId[] {
  return ACTIONS.filter((a) => a.id !== except && (km[a.id] ?? []).includes(binding)).map((a) => a.id);
}

// ---------------------------------------------------------------------------
// The active keymap (module state: settings → setKeymap → input.ts / army.ts / commander.ts)
// ---------------------------------------------------------------------------

let active: Keymap = defaultKeymap();
let activeMods: GroupMods = { ...DEFAULT_GROUP_MODS };
let version = 0;

export function setKeymap(over: unknown, mods?: unknown) {
  active = resolveKeymap(over);
  activeMods = resolveGroupMods(mods);
  version++;
}
export const keymap = (): Readonly<Keymap> => active;
export const groupMods = (): Readonly<GroupMods> => activeMods;
/** Bumped whenever the bindings change (for UI that caches key labels). */
export const keymapVersion = () => version;

/** Is the control-group modifier held (`ctrl` counts Cmd on a Mac)? */
export function modHeld(e: KeyLike, m: GroupMod): boolean {
  return m === 'ctrl' ? !!(e.ctrlKey || e.metaKey) : m === 'shift' ? !!e.shiftKey : !!e.altKey;
}

/** Does the event trigger this action (with the active keymap)? */
export function isAction(id: ActionId, e: KeyLike, o: MatchOpts = {}, km: Keymap = active): boolean {
  return (km[id] ?? []).some((b) => matchesBinding(b, e, o));
}

/** The best-matching action among `ids` (all actions by default), or null. */
export function lookup(e: KeyLike, ids: readonly ActionId[] = ACTION_IDS, o: MatchOpts = {}, km: Keymap = active): ActionId | null {
  let best: ActionId | null = null, bestS = -1;
  for (const id of ids) {
    for (const b of km[id] ?? []) {
      const s = score(b, e, o);
      if (s > bestS) { bestS = s; best = id; }
    }
  }
  return best;
}

/** Held-key test for camera scrolling: `held` holds the pressed keys' bases (`eventBase`) and `#` + codes. */
export function isHeld(id: ActionId, held: ReadonlySet<string>, km: Keymap = active): boolean {
  for (const b of km[id] ?? []) {
    const p = parseBinding(b);
    if (p && held.has(p.base)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

/** Key caps with a name (translated: common.keys); the arrows are symbols in every language. */
const ARROWS: Record<string, string> = { arrowup: '↑', arrowdown: '↓', arrowleft: '←', arrowright: '→' };
type KeyCap = Parameters<typeof tCommon>[0] & `keys.${string}`;
const NAMED: Record<string, KeyCap> = {
  space: 'keys.space', backspace: 'keys.backspace', escape: 'keys.esc', enter: 'keys.enter', tab: 'keys.tab', delete: 'keys.delete',
  insert: 'keys.insert', home: 'keys.home', end: 'keys.end', pageup: 'keys.pageUp', pagedown: 'keys.pageDown',
  capslock: 'keys.capsLock', contextmenu: 'keys.contextMenu',
};

/** Human label of a key base (`a` → A, `f6` → F6, `#Backquote` → `). */
export function baseLabel(base: string): string {
  if (base.startsWith('#')) {
    const c = base.slice(1);
    if (c === 'Backquote') return '`';
    const m = /^(Key|Digit)(.)$/.exec(c);
    if (m) return m[2];
    const n = /^Numpad(.+)$/.exec(c);
    if (n) return tCommon('keys.numpad', { n: n[1] });
    return c;
  }
  if (ARROWS[base]) return ARROWS[base];
  if (NAMED[base]) return tCommon(NAMED[base]);
  if (/^f[0-9]{1,2}$/.test(base)) return base.toUpperCase();
  if ([...base].length === 1) return base.toUpperCase();
  return base.charAt(0).toUpperCase() + base.slice(1);
}

const MOD_KEY = { ctrl: 'keys.ctrl', alt: 'keys.alt', shift: 'keys.shift' } as const;
/** A modifier's key cap (Ctrl, Alt, Shift: common.keys). */
const modLabel = (m: 'ctrl' | 'alt' | 'shift'): string => tCommon(MOD_KEY[m]);
export const groupModLabel = (m: GroupMod) => modLabel(m);

/** `Shift+e` → `Shift + E`. */
export function bindingLabel(b: string): string {
  const p = parseBinding(b);
  if (!p) return '?';
  const mods = (['ctrl', 'alt', 'shift'] as const).filter((m) => p[m]).map(modLabel);
  return [...mods, baseLabel(p.base)].join(' + ');
}

/** The label of an action's first binding (`''` when it is unbound). */
export function keyLabel(id: ActionId, km: Keymap = active): string {
  const b = km[id]?.[0];
  return b ? bindingLabel(b) : '';
}

/** All of an action's keys, `Q / ,` style (`—` when unbound). */
export function keysLabel(id: ActionId, km: Keymap = active): string {
  const list = km[id] ?? [];
  return list.length ? list.map(bindingLabel).join(' / ') : '—';
}

/** The key label for a `keyCommand` id (`'s'` → the key bound to Stop), for buttons that show their hotkey. */
export function commandKeyLabel(cmd: string, km: Keymap = active): string {
  const id = COMMAND_ACTION.get(cmd.toLowerCase());
  return id ? keyLabel(id, km) : cmd.toUpperCase();
}

export const actionName = (id: ActionId): string => ACTION_TEXT[id] ?? id;
export const groupName = (g: ActionGroup): string => GROUP_TEXT[g] ?? g;

/**
 * Fill key placeholders in UI text with the active bindings: `{key:deploy}` → `D`, `{mod:assign}` → `Ctrl`.
 * The labels are HTML-escaped (the text may be HTML).
 */
export function fillKeys(text: string, km: Keymap = active): string {
  const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return text
    .replace(/\{key:(\w+)\}/g, (m, id: string) => (DEF.has(id as ActionId) ? escape(keyLabel(id as ActionId, km) || '—') : m))
    .replace(/\{mod:(assign|add)\}/g, (_m, w: 'assign' | 'add') => escape(modLabel(activeMods[w])));
}
