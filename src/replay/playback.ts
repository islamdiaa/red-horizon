/**
 * Replay playback: the regular Game (same deterministic simulation, AI included) built from the
 * recorded setup, with the human player's orders fed from the recording at their ticks.
 *
 *  - controls: pause (Space), 1× / 2× / 4× / 8× ([ / ]), skip ±30 s, restart, timeline scrubber
 *    (forward seeks step the simulation fast; backward seeks restart the match and fast-forward)
 *  - player view: any player's eyes (their fog, HUD and radar) or an observer view without fog (V)
 *  - read-only spectator HUD (no build / sell / power / unit orders)
 *  - desync detection against the recorded state hashes
 */
import type { Game, GameSetup } from '../game';
import { BUILDINGS, UNITS } from '../data/rules';
import { formatTime } from '../core/util';
import { DT, TICK_HZ } from '../sim/types';
import { Building } from '../sim/entities';
import type { Player } from '../sim/player';
import { Hud } from '../ui/hud';
import { ICONS, factionEmblem } from '../ui/icons';
import { el, esc, hexColor } from '../ui/dom';
import { renderThumbnails } from '../render/thumbnails';
import { CommandFeeder } from './core';
import type { PlaybackOptions, ReplayData } from './format';
import { branchSetup, defaultTakeoverAI, makeBranch, replayStartTick } from './branch'; // rewind & take command
import { openMomentPanel, weather } from '../ui/moment';
import { challengeGameSetup } from '../modes/author';
import type { AIDifficulty } from '../sim/ai';
import { picto } from '../meta';
import { clipButton, recordClip, startPendingClip } from '../ui/clips';
import { SIM_VERSION, otherSimVersion, simVersionOf } from '../sim/version';
import { ensureModesCss } from '../ui/modes-css'; // the bar's Take command / challenge buttons are styled there // highlight clips
import tReplay from '../i18n/en/replay';
import tShare from '../i18n/en/share';
import { fmtInt } from '../i18n/core';
import { replayMapName } from './store';

export interface PlaybackHost {
  /** Start a new game from this setup (seeking backwards, watching again). */
  restart(setup: GameSetup): void;
  /** Leave the replay: to the replay list, or the main menu. */
  exit(toReplays: boolean): void;
}

const SPEEDS = [1, 2, 4, 8];
const SKIP = 30 * TICK_HZ;

export function attachPlayback(game: Game, host: PlaybackHost): ReplayPlayback {
  const pb = new ReplayPlayback(game, host);
  game.attachments.push(pb);
  return pb;
}

export class ReplayPlayback {
  readonly data: ReplayData;
  private opts: PlaybackOptions;
  private feeder: CommandFeeder;
  private unhook: () => void;
  /** Viewed player index; -1 = observer (no fog). */
  view: number;
  /** Player whose HUD is shown in observer mode. */
  private hudPlayer: number;
  private speed = 1;
  private paused = false;
  private seeking = false;
  private ended = false;
  private disposed = false;
  private endTimer = 0;
  private bar: HTMLElement;
  private panel: HTMLElement;
  private endBox: HTMLElement | null = null;
  private seekBox: HTMLElement | null = null;
  private timer = 0;
  private dragFrac = -1;
  private keyHandler = (e: KeyboardEvent) => this.onKey(e);
  /** First tick of the recording (a branch starts at its branch point). */
  readonly startTick: number;
  private closeMoment: (() => void) | null = null;
  private tookCommand = false;
  /** The first state-hash mismatch has been announced (once per playback). */
  private desyncWarned = false;

  constructor(private game: Game, private host: PlaybackHost) {
    this.opts = game.setup.replay!;
    this.data = this.opts.data;
    this.startTick = replayStartTick(this.data);
    const world = game.world;
    this.feeder = new CommandFeeder(world, this.data.cmds, this.data.hashes);
    // feed the recorded orders; a recording that stops before the match ended freezes on its last tick
    const orig = world.step;
    const step = () => {
      if (this.ended && !world.gameOver) return;
      this.feeder.beforeStep();
      orig.call(world);
      this.feeder.afterStep();
      if (!this.ended && world.tick >= this.data.ticks) this.reachEnd();
    };
    world.step = step;
    this.unhook = () => { if (world.step === step) world.step = orig; };
    game.hints = null;
    if (game.input) game.input.spectator = true;
    document.body.classList.add('spectating');
    this.renderMissingThumbs();
    this.view = this.opts.view ?? this.data.local;
    this.hudPlayer = this.view >= 0 ? this.view : this.data.local;
    ensureModesCss();
    this.bar = el('div', 'rp-bar panel');
    this.bar.id = 'replay-bar';
    this.panel = el('div', 'rp-players panel');
    document.body.append(this.bar, this.panel);
    this.buildBar();
    this.setView(this.view);
    this.setSpeed(this.opts.speed ?? 1);
    if (this.opts.paused) this.setPaused(true);
    window.addEventListener('keydown', this.keyHandler);
    this.timer = window.setInterval(() => this.refresh(), 250);
    this.refresh();
    if (this.opts.seekTo && this.opts.seekTo > world.tick) this.seek(this.opts.seekTo);
    startPendingClip(game, this); // "Record clip" from the results screen: records once the seek is done
  }

  /** Fast-forwarding to a tick right now (clips wait for it). */
  get isSeeking(): boolean {
    return this.seeking;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.unhook();
    window.clearInterval(this.timer);
    window.clearTimeout(this.endTimer);
    window.removeEventListener('keydown', this.keyHandler);
    this.closeMoment?.();
    document.body.classList.remove('spectating');
    this.bar.remove();
    this.panel.remove();
    this.endBox?.remove();
    this.seekBox?.remove();
  }

  // ---------------------------------------------------------------------------
  // Time control
  // ---------------------------------------------------------------------------
  setSpeed(s: number) {
    this.speed = s;
    if (!this.paused && !this.seeking) this.game.speed = s;
    for (const b of this.bar.querySelectorAll<HTMLElement>('[data-speed]')) b.classList.toggle('on', +b.dataset.speed! === s);
  }

  setPaused(p: boolean) {
    if (this.ended && !p && !this.game.world.gameOver) return;
    this.paused = p;
    if (!this.seeking) this.game.speed = p ? 0 : this.speed;
    const b = this.bar.querySelector('.rp-play');
    if (b) b.innerHTML = p ? ICONS.play : ICONS.pause;
    this.bar.classList.toggle('paused', p);
  }

  /** Jump to a tick: forward by fast simulation, backward by restarting the match and seeking. */
  seek(tick: number) {
    const world = this.game.world;
    tick = Math.max(this.startTick, Math.min(this.data.ticks, Math.round(tick))); // a branch begins at its branch point
    if (this.seeking) return;
    if (tick < world.tick) {
      const { load: _l, ...setup } = this.game.setup;
      this.host.restart({ ...setup, intro: false, replay: { ...this.opts, seekTo: tick, view: this.view, speed: this.speed, paused: this.paused } });
      return;
    }
    if (tick === world.tick) return;
    this.seeking = true;
    this.game.speed = 0;
    this.endBox?.remove();
    this.endBox = null;
    const box = el('div', 'rp-seek panel', `<b>${tReplay.html('bar.seeking')}</b><span class="rp-seek-t"></span><span class="rp-seek-bar"><i></i></span>`);
    document.body.appendChild(box);
    this.seekBox = box;
    const from = world.tick;
    const step = () => {
      if (this.disposed) return;
      const t0 = performance.now();
      while (world.tick < tick && performance.now() - t0 < 45) {
        world.step();
        world.events.length = 0;
      }
      const f = (world.tick - from) / Math.max(1, tick - from);
      (box.querySelector('.rp-seek-bar i') as HTMLElement).style.width = `${(f * 100).toFixed(1)}%`;
      (box.querySelector('.rp-seek-t') as HTMLElement).textContent = `${formatTime(world.tick * DT)} / ${formatTime(tick * DT)}`;
      this.refresh();
      if (world.tick < tick) { window.setTimeout(step, 0); return; }
      this.finishSeek();
    };
    window.setTimeout(step, 30);
  }

  private finishSeek() {
    this.seeking = false;
    this.seekBox?.remove();
    this.seekBox = null;
    const g = this.game, w = g.world;
    // structures placed while skipping: hide the trees under them, then snap the fog
    const cells: number[] = [];
    for (const b of w.buildings) for (let dy = 0; dy < b.h; dy++) for (let dx = 0; dx < b.w; dx++) cells.push(w.map.idx(b.cx + dx, b.cy + dy));
    g.gfx.vegetation.hideCells(cells);
    g.gfx.fog.snap(g.local);
    if (!this.ended) g.speed = this.paused ? 0 : this.speed;
    this.refresh();
    // "Continue" from the replay list: take command at the end of the recording
    const tc = this.opts.takeCommand;
    if (tc && !this.tookCommand && !w.gameOver) this.takeCommand(tc.local, tc.ai ?? defaultTakeoverAI(this.data));
  }

  // ---------------------------------------------------------------------------
  // Rewind & take command · make a challenge from this moment
  // ---------------------------------------------------------------------------
  /** Start a live game from this exact moment with `local` as the human (a branch of this replay). */
  takeCommand(local: number, ai: AIDifficulty) {
    if (this.tookCommand || this.seeking || this.game.world.gameOver) return;
    this.tookCommand = true;
    const g = this.game, cam = g.gfx.cam;
    // looking through someone else's eyes: open the branch over the new commander's base
    let at: [number, number] = [cam.x, cam.y];
    if (local !== this.view) {
      const p = g.world.players[local];
      const b = g.world.buildings.find((x) => x.alive && x.owner === p && x.bt.id === 'fact') ?? g.world.buildings.find((x) => x.alive && x.owner === p && !x.bt.wall);
      const u = g.world.units.find((x) => x.alive && x.owner === p);
      const s = g.world.map.startPositions[local % g.world.map.startPositions.length];
      at = b ? [b.x, b.y + 2] : u ? [u.x, u.y] : [s.x, s.y];
    }
    const branch = makeBranch(this.data, g.world, local, ai, { cam: { x: at[0], y: at[1], dist: cam.targetDist, yaw: cam.targetYaw }, hours: g.hours, ...weather(g) });
    this.host.restart(branchSetup(this.data.setup, branch, g.setup.quality));
  }

  /** The moment panel (take command / make a challenge), paused at the current tick. */
  openMoment(tab: 'take' | 'challenge') {
    if (this.closeMoment || this.seeking) return;
    const wasPaused = this.paused;
    this.setPaused(true);
    this.closeMoment = openMomentPanel({
      game: this.game, data: this.data, view: this.view, tab,
      onTake: (local, ai) => this.takeCommand(local, ai),
      onPlayChallenge: (c) => { this.tookCommand = true; this.host.restart(challengeGameSetup(c, this.game.setup.quality)); },
      onClose: () => { this.closeMoment = null; if (!wasPaused && !this.tookCommand && !this.disposed) this.setPaused(false); },
    });
  }

  private reachEnd() {
    this.ended = true;
    const w = this.game.world;
    if (w.gameOver) {
      // let the game's own finale (slow motion, banner) play, then offer the next steps
      this.endTimer = window.setTimeout(() => this.showEnd(), 5200);
    } else {
      this.setPaused(true);
      this.showEnd();
    }
  }

  private showEnd() {
    if (this.disposed || this.endBox) return;
    const d = this.data;
    const winner = d.players.find((p) => p.team === d.winnerTeam);
    const time = formatTime(d.ticks * DT);
    const title = d.result === 'abandoned' ? tReplay.html('end.abandoned') : winner ? tReplay.html('end.wins', { name: winner.name }) : tReplay.html('end.over');
    const sub = d.result === 'abandoned' ? tReplay.html('end.leftAt', { time })
      : tReplay.html(d.result === 'victory' ? 'end.victoryFor' : 'end.defeatFor', { name: d.players[d.local]?.name ?? tReplay('end.commander'), time });
    const box = el('div', 'rp-end panel', `<div class="rp-end-ic">${ICONS.replay}</div><div class="rp-end-txt"><small>${tReplay.html('end.kicker')}</small><b>${title}</b><span>${sub}</span></div>`);
    const btns = el('div', 'rp-end-btns');
    const mk = (label: string, icon: string, fn: () => void, cls = 'btn') => {
      const b = el('button', cls, `${icon}<span>${esc(label)}</span>`);
      b.onclick = fn;
      btns.appendChild(b);
    };
    mk(tReplay('end.again'), ICONS.restart, () => this.seek(0), 'btn-primary');
    mk(tReplay('end.replays'), ICONS.history, () => this.host.exit(true));
    mk(tReplay('end.mainMenu'), ICONS.exit, () => this.host.exit(false));
    box.appendChild(btns);
    document.body.appendChild(box);
    this.endBox = box;
  }

  // ---------------------------------------------------------------------------
  // Player view
  // ---------------------------------------------------------------------------
  /** Look through a player's eyes (their fog, HUD, radar), or -1 for an observer view without fog. */
  setView(view: number) {
    const g = this.game, w = g.world;
    this.view = view;
    if (view >= 0) this.hudPlayer = view;
    const p = w.players[this.hudPlayer] ?? w.players[0];
    const observer = view < 0;
    g.local = p;
    // renderers that colour own / allied / enemy and fog ghosts
    const ents = g.ents as unknown as { local: Player; views?: Map<number, { seen?: boolean; wasExplored?: boolean; fogged?: boolean; ghostDead?: boolean }> };
    ents.local = p;
    (g.walls as unknown as { local: Player }).local = p;
    if (ents.views) for (const v of ents.views.values()) { v.seen = false; v.wasExplored = false; v.fogged = false; }
    g.gfx.fog.enabled = w.fog && !observer;
    g.gfx.fog.snap(p);
    g.input?.setLocal(p);
    document.body.classList.toggle('faction-soviet', p.faction === 'soviet');
    g.hud = new Hud({
      world: w, local: p, thumbs: g.thumbs, selection: g.selection, audio: g.audio, spectator: true,
      issue: () => {},
      beginPlacement: () => {},
      setMode: (m) => g.input?.setMode(m),
      getMode: () => g.input?.mode ?? 'normal',
      beginSuperweapon: () => {},
      select: (ids) => g.input?.select(ids),
      focusOn: (x, y) => g.gfx.cam.flyToPoint(x, y),
      minimapPoint: (x, y, b) => { if (b === 0) g.gfx.cam.jumpTo(x, y); },
      openPauseMenu: () => g.pause(),
      setSpeed: (s) => this.setSpeed(s),
      getSpeed: () => this.speed,
      keyCommand: (k, b) => g.input?.keyCommand(k, b),
      getGroups: () => g.input?.groups ?? new Map(),
      stats: () => `${g.gfx.stats.calls} calls · ${(g.gfx.stats.tris / 1000).toFixed(0)}k tris`,
    });
    g.hud.minimap.structures = observer ? null : () => g.ents.structureMarkers();
    g.hud.minimap.revealAll = observer;
    this.refresh(true);
  }

  private cycleView(dir = 1) {
    const n = this.game.world.players.length;
    const order = [...Array(n).keys(), -1];
    const i = order.indexOf(this.view);
    this.setView(order[(i + dir + order.length) % order.length]);
  }

  /** Portraits for the other faction's units (the game only renders the local faction's). */
  private renderMissingThumbs() {
    const g = this.game;
    const seen = new Set<string>();
    for (const p of g.world.players) {
      if (seen.has(p.faction)) continue;
      seen.add(p.faction);
      const ids = [...Object.keys(BUILDINGS), ...Object.keys(UNITS)].filter((id) => {
        const t = BUILDINGS[id] ?? UNITS[id];
        return t.owner.includes(p.faction) && !g.thumbs.has(id);
      });
      if (!ids.length) continue;
      try {
        for (const [id, url] of renderThumbnails(ids, p.color)) g.thumbs.set(id, url);
      } catch (e) {
        console.warn('thumbnails failed', e);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // UI
  // ---------------------------------------------------------------------------
  private buildBar() {
    const d = this.data;
    const btn = (cls: string, icon: string, tip: string, fn: () => void) => {
      const b = el('button', 'rp-btn ' + cls, icon);
      b.title = tip;
      b.setAttribute('aria-label', tip);
      b.onclick = fn;
      b.addEventListener('mousedown', (e) => e.preventDefault());
      return b;
    };
    const left = el('div', 'rp-ctl');
    left.append(
      btn('rp-restart', ICONS.skipBack, tReplay('bar.restart'), () => this.seek(0)),
      btn('rp-back', ICONS.rewind, tReplay('bar.back'), () => this.seek(this.game.world.tick - SKIP)),
      btn('rp-play', ICONS.pause, tReplay('bar.play'), () => this.setPaused(!this.paused)),
      btn('rp-fwd', ICONS.forward, tReplay('bar.skip'), () => this.seek(this.game.world.tick + SKIP)),
    );
    const speeds = el('div', 'rp-speeds');
    for (const s of SPEEDS) {
      const b = el('button', 'rp-speed', `${s}×`);
      b.dataset.speed = String(s);
      b.title = tReplay('bar.speed', { s });
      b.onclick = () => this.setSpeed(s);
      b.addEventListener('mousedown', (e) => e.preventDefault());
      speeds.appendChild(b);
    }
    const tl = el('div', 'rp-timeline', `<span class="rp-time">00:00</span><div class="rp-track"><i class="rp-fill"></i><i class="rp-head"></i><i class="rp-desync"></i><span class="rp-hover"></span></div><span class="rp-total">${formatTime(d.ticks * DT)}</span>`);
    const track = tl.querySelector('.rp-track') as HTMLElement;
    if (this.startTick > 0) {
      // the part before the branch point belongs to the parent recording
      const pre = el('i', 'rp-pre');
      pre.style.width = `${((this.startTick / Math.max(1, d.ticks)) * 100).toFixed(2)}%`;
      pre.title = tReplay('bar.branchedAt', { time: formatTime(this.startTick * DT) });
      track.prepend(pre);
    }
    const fracAt = (e: PointerEvent) => {
      const r = track.getBoundingClientRect();
      return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    };
    track.addEventListener('pointerdown', (e) => {
      track.setPointerCapture(e.pointerId);
      this.dragFrac = fracAt(e);
      this.refresh();
    });
    track.addEventListener('pointermove', (e) => {
      const f = fracAt(e);
      const hv = track.querySelector('.rp-hover') as HTMLElement;
      hv.style.left = `${(f * 100).toFixed(2)}%`;
      hv.textContent = formatTime(f * d.ticks * DT);
      if (this.dragFrac >= 0) { this.dragFrac = f; this.refresh(); }
    });
    track.addEventListener('pointerup', (e) => {
      if (this.dragFrac < 0) return;
      const f = fracAt(e);
      this.dragFrac = -1;
      this.seek(f * d.ticks);
    });
    const right = el('div', 'rp-side');
    const fog = btn('rp-fog', ICONS.eye, tReplay('bar.observer'), () => this.setView(this.view < 0 ? this.hudPlayer : -1));
    const sync = el('span', 'rp-sync');
    const exit = btn('rp-exit', ICONS.close, tReplay('bar.leave'), () => this.host.exit(true));
    // rewind & take command · challenge from this moment
    const take = btn('rp-take', `${ICONS.flag}<span>${tReplay.html('bar.take')}</span>`, tReplay('bar.takeTip'), () => this.openMoment('take'));
    const chal = btn('rp-chal', picto('trophy', 'ic'), tReplay('bar.challengeTip'), () => this.openMoment('challenge'));
    // highlight clips (the file name keeps the English label)
    const clip = clipButton(() => void recordClip(this.game, this, { label: tShare('clip.mapHighlight', { map: replayMapName(d) }), fileLabel: `${d.mapName} highlight` }));
    right.append(take, chal, ...(clip ? [clip] : []), fog, sync, exit);
    const br = d.setup.branch;
    const map = replayMapName(d);
    const tag = el('div', 'rp-tag', `${ICONS.replay}<span><b${br ? ' class="rp-branchtag"' : ''}>${tReplay.html(br ? 'bar.branch' : 'bar.replay')}</b><small>${br ? tReplay.html('bar.branchFrom', { map, time: formatTime(br.tick * DT) }) : esc(map)}</small></span>`);
    this.bar.append(tag, left, speeds, tl, right);
  }

  /** Refresh the bar (time, sync) and the players panel. */
  private refresh(rebuildPanel = false) {
    if (this.disposed) return;
    const g = this.game, w = g.world, d = this.data;
    const frac = this.dragFrac >= 0 ? this.dragFrac : Math.min(1, w.tick / Math.max(1, d.ticks));
    (this.bar.querySelector('.rp-fill') as HTMLElement).style.width = `${(frac * 100).toFixed(2)}%`;
    (this.bar.querySelector('.rp-head') as HTMLElement).style.left = `${(frac * 100).toFixed(2)}%`;
    (this.bar.querySelector('.rp-time') as HTMLElement).textContent = formatTime((this.dragFrac >= 0 ? frac * d.ticks : Math.min(w.tick, d.ticks)) * DT);
    const sync = this.bar.querySelector('.rp-sync') as HTMLElement;
    const ds = this.feeder.desyncTick;
    if (ds >= 0 && !this.desyncWarned) {
      // (a recording from another simulation version, src/sim/version.ts, is expected to drift: say so once)
      this.desyncWarned = true;
      const time = formatTime(ds * DT);
      g.hud?.message(otherSimVersion(d)
        ? tReplay(simVersionOf(d) < SIM_VERSION ? 'sync.olderVersion' : 'sync.newerVersion', { time })
        : tReplay('sync.drifts', { time }), true);
    }
    const html = ds >= 0
      ? `${ICONS.warn}<span>${tReplay.html('sync.desyncAt', { time: formatTime(ds * DT) })}</span>`
      : `${ICONS.check}<span>${tReplay.html(this.feeder.checked ? 'sync.inSync' : 'sync.verifying')}</span>`;
    if (sync.innerHTML !== html) {
      sync.innerHTML = html;
      sync.className = 'rp-sync ' + (ds >= 0 ? 'bad' : 'ok');
      sync.title = ds >= 0
        ? tReplay('sync.desyncTip', { time: formatTime(ds * DT), build: String(d.gameVersion), sim: String(simVersionOf(d)), mine: String(SIM_VERSION) })
        : tReplay('sync.verifiedTip', { n: this.feeder.checked, total: d.hashes.length });
      const mark = this.bar.querySelector('.rp-desync') as HTMLElement;
      mark.style.display = ds >= 0 ? 'block' : 'none';
      if (ds >= 0) mark.style.left = `${((ds / Math.max(1, d.ticks)) * 100).toFixed(2)}%`;
    }
    this.bar.querySelector('.rp-fog')?.classList.toggle('on', this.view < 0);
    this.renderPlayers(rebuildPanel);
  }

  private panelKey = '';
  private renderPlayers(force: boolean) {
    const w = this.game.world;
    const key = `${this.view}|${this.hudPlayer}`;
    if (force || key !== this.panelKey || !this.panel.childElementCount) {
      this.panelKey = key;
      this.panel.innerHTML = `<div class="rp-ph"><span>${ICONS.people}<b>${tReplay.html('players.title')}</b></span><small>${tReplay.html('players.switchHint')}</small></div>`;
      w.players.forEach((p, i) => {
        const row = el('button', 'rp-pl' + (i === this.view ? ' on' : '') + (i === this.hudPlayer && this.view < 0 ? ' hud' : ''));
        row.style.setProperty('--c', hexColor(p.color));
        row.innerHTML = `<span class="rp-em">${factionEmblem(p.faction)}</span><span class="rp-nm"><b>${esc(p.name)}</b><small>${esc(this.data.players[i]?.ai ? tReplay('players.ai', { level: this.data.players[i].ai }) : tReplay('players.commander'))}</small></span>
          <span class="rp-st" data-k="cr"></span><span class="rp-st" data-k="pw"></span><span class="rp-st" data-k="army"></span>`;
        row.title = tReplay('players.viewAs', { name: p.name });
        row.onclick = () => this.setView(i);
        row.addEventListener('mousedown', (e) => e.preventDefault());
        this.panel.appendChild(row);
      });
      const obs = el('button', 'rp-pl rp-obs' + (this.view < 0 ? ' on' : ''), `<span class="rp-em">${ICONS.eye}</span><span class="rp-nm"><b>${tReplay.html('players.observer')}</b><small>${tReplay.html('players.noFog')}</small></span>`);
      obs.onclick = () => this.setView(-1);
      obs.addEventListener('mousedown', (e) => e.preventDefault());
      this.panel.appendChild(obs);
    }
    const rows = this.panel.querySelectorAll<HTMLElement>('.rp-pl:not(.rp-obs)');
    w.players.forEach((p, i) => {
      const row = rows[i];
      if (!row) return;
      row.classList.toggle('dead', p.defeated);
      let army = 0;
      for (const u of w.units) if (u.alive && u.owner === p && u.weapons.length && !u.ut.harvester) army++;
      let blds = 0;
      for (const b of w.buildings) if (b.alive && b.owner === p && b instanceof Building && !b.bt.wall) blds++;
      const set = (k: string, html: string) => {
        const e = row.querySelector(`[data-k="${k}"]`) as HTMLElement;
        if (e.innerHTML !== html) e.innerHTML = html;
      };
      set('cr', `${ICONS.coin}<b>${fmtInt(p.credits)}</b>`);
      set('pw', `${ICONS.bolt}<b class="${p.lowPower ? 'low' : ''}">${p.powerOut}/${p.powerUse}</b>`);
      set('army', `${ICONS.target}<b>${army}</b><small>· ${blds}</small>`);
    });
  }

  private onKey(e: KeyboardEvent) {
    const t = e.target as HTMLElement;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
    if (this.game.paused) return;
    const k = e.key.toLowerCase();
    if (k === ' ') { e.preventDefault(); this.setPaused(!this.paused); }
    else if (k === '[' || k === ']') {
      const i = SPEEDS.indexOf(this.speed);
      this.setSpeed(SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, (i < 0 ? 0 : i) + (k === ']' ? 1 : -1)))]);
    } else if (k === 'v' && !e.ctrlKey && !e.metaKey) this.cycleView(e.shiftKey ? -1 : 1);
    else if (k === 'home') this.seek(0);
    else if (k === 't' && !e.ctrlKey && !e.metaKey) this.openMoment('take');
    else if (k === 'c' && !e.ctrlKey && !e.metaKey) this.openMoment('challenge');
  }
}
