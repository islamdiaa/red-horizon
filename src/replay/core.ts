/**
 * Replay core (no DOM, no rendering): record the human player's command stream plus periodic
 * state hashes, and feed a recording back into a fresh World. Used by the Game-level recorder /
 * playback and directly by the headless tests.
 */
import type { Command } from '../sim/types';
import type { World } from '../sim/world';
import { HASH_EVERY } from './format';
import { worldHash } from './hash';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/**
 * Wrap world.step with before / after hooks (every stepping path — the frame loop, fast-forward,
 * tools — goes through it). Returns an unhook function.
 */
export function hookStep(world: World, before: (() => void) | null, after: (() => void) | null): () => void {
  const orig = world.step;
  const step = () => {
    before?.();
    orig.call(world);
    after?.();
  };
  world.step = step;
  return () => { if (world.step === step) world.step = orig; };
}

export class CommandRecorder {
  cmds: [number, Command][];
  hashes: [number, string][];

  constructor(private world: World, restore?: { cmds: [number, Command][]; hashes: [number, string][] }) {
    this.cmds = restore ? clone(restore.cmds) : [];
    this.hashes = restore ? clone(restore.hashes) : [];
  }

  /** A command the human player just issued (it is processed when the world next steps). */
  record(cmd: Command) {
    this.cmds.push([this.world.tick, clone(cmd)]);
  }

  /** Call after every world step. */
  afterStep() {
    const t = this.world.tick;
    if (t % HASH_EVERY === 0 && (!this.hashes.length || this.hashes[this.hashes.length - 1][0] < t)) this.hashes.push([t, worldHash(this.world)]);
  }
}

export class CommandFeeder {
  private next = 0;
  private hashIdx = 0;
  /** First tick whose state hash differed from the recording (-1 = in sync so far). */
  desyncTick = -1;
  /** Hashes compared so far. */
  checked = 0;

  constructor(private world: World, readonly cmds: [number, Command][], readonly hashes: [number, string][]) {
    // a world restored mid-way (not used today) would skip what it already processed
    while (this.next < cmds.length && cmds[this.next][0] < world.tick) this.next++;
  }

  /** Call right before world.step(): issues the commands recorded at the current tick. */
  beforeStep() {
    const t = this.world.tick;
    while (this.next < this.cmds.length && this.cmds[this.next][0] <= t) {
      const [ct, cmd] = this.cmds[this.next++];
      if (ct === t) this.world.issue(clone(cmd));
    }
  }

  /** Call right after world.step(): compares the state hash when the recording has one. */
  afterStep() {
    const t = this.world.tick;
    while (this.hashIdx < this.hashes.length && this.hashes[this.hashIdx][0] < t) this.hashIdx++;
    const h = this.hashes[this.hashIdx];
    if (h && h[0] === t) {
      this.checked++;
      if (this.desyncTick < 0 && h[1] !== worldHash(this.world)) this.desyncTick = t;
      this.hashIdx++;
    }
  }

  get pendingCommands(): number {
    return this.cmds.length - this.next;
  }
}
