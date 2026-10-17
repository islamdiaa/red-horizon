/**
 * Strict, deterministic checks for commands received from other players. Every client runs the same checks on
 * the same relay-ordered stream, so they all keep or drop exactly the same commands and stay in sync.
 *
 * A command is rebuilt field by field from its known shape: the issuing player is always the sender's seat
 * (never what the message claims), ids are integers, coordinates finite and bounded, type ids must exist in the
 * rules. Unknown command kinds (added later by other systems) keep only flat, bounded fields; their handlers
 * must tolerate unknown ids, as they do for the AI.
 */
import { BUILDINGS, UNITS } from '../data/rules';
import { SUPER_KINDS } from '../sim/superweapons';
import { FORMATION_SHAPES } from '../sim/formation';
import type { Command } from '../sim/types';
import { MAX_UNITS_PER_CMD } from './protocol';

type Raw = Record<string, unknown>;
const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const STANCES = ['aggressive', 'guard', 'hold', 'passive'];
const COORD = 4096;

const int = (v: unknown, lo = 0, hi = 0x7fffffff): number | undefined => (typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi ? v : undefined);
const num = (v: unknown, lim = COORD): number | undefined => (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= lim ? v : undefined);
const bool = (v: unknown): boolean | undefined => (v === undefined ? undefined : typeof v === 'boolean' ? v : undefined);
const typeId = (v: unknown): string | undefined => (typeof v === 'string' && v.length <= 32 && (own(UNITS, v) || own(BUILDINGS, v)) ? v : undefined);
const id = (v: unknown): string | undefined => (typeof v === 'string' && /^[A-Za-z0-9_\-:.]{1,40}$/.test(v) ? v : undefined);
function ids(v: unknown): number[] | undefined {
  if (!Array.isArray(v) || v.length > MAX_UNITS_PER_CMD) return undefined;
  const out: number[] = [];
  for (const x of v) { const n = int(x, 1); if (n === undefined) return undefined; out.push(n); }
  return out;
}

/** Flags that are optional booleans: present only when given (a stray non-boolean drops the command). */
function flags(r: Raw, out: Raw, names: string[]): boolean {
  for (const k of names) {
    if (r[k] === undefined) continue;
    const b = bool(r[k]);
    if (b === undefined) return false;
    out[k] = b;
  }
  return true;
}

/** A command the relay delivered from `player`'s seat, checked and rebuilt; null = dropped. */
export function sanitizeCommand(raw: unknown, player: number): Command | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Raw;
  const c = r.c;
  if (typeof c !== 'string') return null;
  const out: Raw = { c, player };
  const need = (k: string, v: unknown) => { if (v === undefined) throw 0; out[k] = v; };
  try {
    switch (c) {
      case 'move':
        need('units', ids(r.units)); need('x', num(r.x)); need('y', num(r.y));
        if (!flags(r, out, ['attackMove', 'queue'])) return null;
        break;
      case 'attack':
        need('units', ids(r.units)); need('target', int(r.target, 1));
        if (!flags(r, out, ['forced'])) return null;
        break;
      case 'attackGround': case 'harvest': case 'mine':
        need('units', ids(r.units)); need('x', num(r.x)); need('y', num(r.y));
        break;
      case 'stop': case 'scatter': case 'deploy':
        need('units', ids(r.units));
        break;
      case 'enter':
        need('units', ids(r.units)); need('target', int(r.target, 1));
        break;
      case 'build':
        need('type', typeId(r.type));
        if (r.count !== undefined) need('count', int(r.count, 1, 50));
        break;
      case 'cancel':
        need('type', typeId(r.type));
        if (!flags(r, out, ['all'])) return null;
        break;
      case 'pause':
        need('type', typeId(r.type));
        break;
      case 'place':
        need('type', typeId(r.type)); need('cx', int(r.cx, -COORD, COORD)); need('cy', int(r.cy, -COORD, COORD));
        if (r.cx2 !== undefined || r.cy2 !== undefined) { need('cx2', int(r.cx2, -COORD, COORD)); need('cy2', int(r.cy2, -COORD, COORD)); }
        break;
      case 'sell': case 'repair': case 'primary':
        need('building', int(r.building, 1));
        break;
      case 'rally':
        need('building', int(r.building, 1)); need('x', num(r.x)); need('y', num(r.y));
        break;
      case 'superweapon':
        need('kind', SUPER_KINDS.includes(r.kind as never) ? r.kind : undefined); need('x', num(r.x)); need('y', num(r.y));
        if (r.unit !== undefined) need('unit', int(r.unit, 1));
        break;
      case 'stance':
        need('units', ids(r.units)); need('stance', STANCES.includes(r.stance as string) ? r.stance : undefined);
        break;
      case 'repairBridge':
        need('units', ids(r.units)); need('bridge', int(r.bridge, 0, 1e6));
        break;
      case 'chronoJump':
        need('unit', int(r.unit, 1)); need('x', num(r.x)); need('y', num(r.y));
        break;
      case 'patrol': {
        need('units', ids(r.units));
        if (!Array.isArray(r.points) || r.points.length < 1 || r.points.length > 16) return null;
        const pts: [number, number][] = [];
        for (const p of r.points) {
          if (!Array.isArray(p) || p.length !== 2) return null;
          const x = num(p[0]), y = num(p[1]);
          if (x === undefined || y === undefined) return null;
          pts.push([x, y]);
        }
        out.points = pts;
        if (!flags(r, out, ['queue'])) return null;
        break;
      }
      case 'guard':
        need('units', ids(r.units)); need('target', int(r.target, 1));
        if (!flags(r, out, ['queue'])) return null;
        break;
      case 'formation':
        need('units', ids(r.units)); need('shape', FORMATION_SHAPES.includes(r.shape as never) ? r.shape : undefined);
        break;
      case 'rallyUnit':
        need('building', int(r.building, 1)); need('target', int(r.target, 0));
        break;
      case 'queuePlan': {
        if (!Array.isArray(r.items) || r.items.length > 64) return null;
        const items: { type: string; cx: number; cy: number }[] = [];
        for (const it of r.items) {
          if (!it || typeof it !== 'object') return null;
          const o = it as Raw, t = typeId(o.type), cx = int(o.cx, -COORD, COORD), cy = int(o.cy, -COORD, COORD);
          if (t === undefined || cx === undefined || cy === undefined) return null;
          items.push({ type: t, cx, cy });
        }
        out.items = items;
        if (r.mode !== undefined) need('mode', r.mode === 'append' || r.mode === 'replace' || r.mode === 'remove' ? r.mode : undefined);
        break;
      }
      case 'repeat':
        need('building', int(r.building, 0)); need('type', typeId(r.type));
        need('on', bool(r.on));
        break;
      case 'commanderPower':
        need('power', id(r.power));
        if (r.x !== undefined) need('x', num(r.x));
        if (r.y !== undefined) need('y', num(r.y));
        if (r.target !== undefined) need('target', int(r.target, 0));
        break;
      case 'unlockPower':
        need('power', id(r.power));
        break;
      case 'battleEvent':
        need('event', int(r.event, 0)); need('act', r.act === 'hire' ? 'hire' : undefined);
        break;
      case 'upgrade': // Commander economy (sim/economy.ts)
        need('building', int(r.building, 1)); need('upgrade', id(r.upgrade));
        if (!flags(r, out, ['cancel'])) return null;
        break;
      case 'research':
        need('building', int(r.building, 1)); need('tech', id(r.tech));
        if (!flags(r, out, ['cancel'])) return null;
        break;
      case 'evacuate':
        need('building', int(r.building, 1));
        break;
      default: {
        // a command kind this build does not list: flat fields only (numbers, booleans, ids, id lists)
        if (!/^[A-Za-z][A-Za-z0-9]{0,23}$/.test(c)) return null;
        for (const k of Object.keys(r)) {
          if (k === 'c' || k === 'player') continue;
          if (!/^[A-Za-z][A-Za-z0-9]{0,23}$/.test(k)) return null;
          const v = r[k];
          if (typeof v === 'boolean') out[k] = v;
          else if (typeof v === 'number') { const n = num(v, 1e7); if (n === undefined) return null; out[k] = n; }
          else if (typeof v === 'string') { const s = id(v); if (s === undefined) return null; out[k] = s; }
          else if (Array.isArray(v)) { const l = v.every((x) => typeof x === 'number') ? ids(v) : undefined; if (!l) return null; out[k] = l; }
          else return null;
        }
      }
    }
  } catch {
    return null;
  }
  return out as unknown as Command;
}
