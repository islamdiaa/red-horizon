/**
 * Everything the World Conquest screens write to the player's storage goes through here: the campaign (the rules'
 * storage.ts), the menu badge, the end-of-run record (profile XP, medals, the Weekly World best) and the screens' own
 * small keys (setup choices, the coach's step, "this run's ending was recorded").
 *
 * A demo store (the ?world=<state> test screens, debug builds only) writes nothing at all, so a test or screenshot
 * visit never touches the player's campaign, profile, XP or medals.
 */
import type { WorldRun } from '../../conquest/world/state';
import { W, type EndSummary } from './api';
import { BADGE_KEY } from './entry';

/** The part of Storage the screens use. */
export interface KV { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }

const local = (): KV | null => { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; } };

export class WorldStore {
  constructor(readonly demo: boolean, private kv: KV | null = local()) {}

  /** Save the campaign and refresh the menu badge. */
  save(run: WorldRun | null) {
    if (this.demo || !run || !this.kv) return;
    try { W.saveWorldRun(run, this.kv); } catch (e) { console.warn('world save failed', e); }
    this.badge(run);
  }

  /** The menu entry's "Turn N" pill (src/ui/world/entry.ts reads it). */
  badge(run: WorldRun | null) {
    if (this.demo || !this.kv) return;
    try {
      if (!run || run.status !== 'active') this.kv.removeItem(BADGE_KEY);
      else this.kv.setItem(BADGE_KEY, JSON.stringify({ active: true, turn: run.turn }));
    } catch { /* storage off */ }
  }

  /** Count a finished run once: records, medals, XP (the rules' recordWorldEnd is idempotent per run id). */
  recordEnd(run: WorldRun): EndSummary | null {
    if (this.demo || !this.kv) return null;
    try { return W.recordWorldEnd(run, this.kv, Date.now()); } catch (e) { console.warn('world record failed', e); return null; }
  }

  /** End the campaign for good (abandon, a new campaign after the ending). */
  clear() {
    if (this.demo || !this.kv) return;
    try { W.clearWorldRun(this.kv); } catch { /* */ }
    this.badge(null);
  }

  get(k: string): string | null {
    try { return this.kv?.getItem(k) ?? null; } catch { return null; }
  }

  set(k: string, v: string) {
    if (this.demo) return;
    try { this.kv?.setItem(k, v); } catch { /* storage off */ }
  }
}
