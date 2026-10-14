import * as THREE from 'three';
import { BUILDINGS, UNITS, type Faction } from './data/rules';
import { generateMap } from './sim/mapgen';
import { World, type PlayerSetup } from './sim/world';
import { DT, type Command, type GameEvent } from './sim/types';
import type { AIDifficulty } from './sim/ai';
import { Building, Unit } from './sim/entities';
import { GameRenderer, type Quality, type TimeOfDay } from './render/renderer';
import { Effects } from './render/effects';
import { EntityRenderer } from './render/entities';
import { Overlay } from './render/overlay';
import { PlacementGhost } from './render/placement';
import { renderThumbnails } from './render/thumbnails';
import { LightPools } from './render/lightpools';
import { Hud } from './ui/hud';
import { InputController } from './ui/input';
import type { AudioSystem } from './audio';
import type { SfxKey } from './audio/types';
import type { SuperKind } from './sim/superweapons';
import { setupScenario } from './debug';
import { recalcPlayerEconomy } from './sim/production';

export interface OpponentSetup {
  faction: Faction | 'random';
  difficulty: AIDifficulty;
}

export interface GameSetup {
  faction: Faction;
  color: number;
  opponents: OpponentSetup[];
  mapSize: number;
  water: number;
  trees: number;
  ore: number;
  credits: number;
  startUnits: 'mcv' | 'light' | 'heavy';
  fog: boolean;
  timeOfDay: TimeOfDay;
  quality: Quality;
  seed: number;
  demo?: boolean;
}

export interface GameCallbacks {
  onPause(game: Game): void;
  onEnd(game: Game, won: boolean): void;
  onProgress?(frac: number, label: string): void;
}

export const TEAM_COLORS = [0x3d7be0, 0xd23a2c, 0xe0b030, 0x3fa34d, 0xe07b2a, 0x8e4fd0, 0x2aa8a8, 0x9aa0aa];

const AI_NAMES = ['Gen. Volkov', 'Marshal Krukov', 'Col. Nadia', 'Gen. Stavros', 'Cdr. Bennett', 'Maj. Kane'];

export class Game {
  world: World;
  gfx: GameRenderer;
  effects: Effects;
  ents: EntityRenderer;
  overlay: Overlay | null = null;
  placement: PlacementGhost;
  lightPools: LightPools | null = null;
  hud: Hud | null = null;
  input: InputController | null = null;
  local;
  selection = new Set<number>();
  paused = false;
  speed = 1;
  alpha = 0;
  time = 0;
  thumbs = new Map<string, string>();
  private acc = 0;
  private last = 0;
  private raf = 0;
  private running = false;
  private heat = 0;
  private minimapT = 0;
  private harvestSfxT = 0;
  private endTimer = -1;
  private demoCam = { angle: 0, tx: 0, ty: 0, retarget: 0 };
  private canvas: HTMLCanvasElement;

  constructor(readonly setup: GameSetup, readonly audio: AudioSystem, private cb: GameCallbacks) {
    cb.onProgress?.(0.05, 'Generating battlefield');
    const nPlayers = 1 + setup.opponents.length;
    const map = generateMap({ size: setup.mapSize, players: nPlayers, seed: setup.seed, water: setup.water, trees: setup.trees, ore: setup.ore });
    const rngFaction = (i: number): Faction => ((setup.seed >> i) & 1 ? 'allies' : 'soviet');
    const usedColors = new Set([setup.color]);
    const players: PlayerSetup[] = [{ name: setup.demo ? 'Allied Command' : 'Commander', faction: setup.faction, color: setup.color, team: 0, isHuman: !setup.demo, ai: setup.demo ? 'hard' : undefined }];
    setup.opponents.forEach((o, i) => {
      const color = TEAM_COLORS.find((c) => !usedColors.has(c))!;
      usedColors.add(color);
      const faction = o.faction === 'random' ? rngFaction(i + 1) : o.faction;
      players.push({ name: AI_NAMES[(setup.seed + i) % AI_NAMES.length], faction, color, team: i + 1, isHuman: false, ai: o.difficulty });
    });
    // shuffle start positions so the player isn't always bottom-left
    if (!setup.demo && (setup.seed & 2)) map.startPositions.reverse();
    this.world = new World({ map, players, credits: setup.credits, startUnits: setup.startUnits, fog: setup.fog && !setup.demo, seed: setup.seed });
    this.local = this.world.players[0];

    cb.onProgress?.(0.3, 'Rendering terrain');
    const old = document.getElementById('game-canvas');
    old?.remove();
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'game-canvas';
    document.body.prepend(this.canvas);
    this.gfx = new GameRenderer(this.canvas, map, { quality: setup.quality, timeOfDay: setup.timeOfDay });
    this.gfx.fog.enabled = this.world.fog;
    this.effects = new Effects({ scene: this.gfx.scene, camera: this.gfx.cam.camera, renderer: this.gfx.renderer, getHeight: (x, z) => map.surfaceAt(x, z) });
    this.effects.setSunDirection?.(this.gfx.sunDir);
    if (setup.quality === 'low') this.effects.setDensity?.(0.5);
    this.ents = new EntityRenderer(this.gfx.scene, this.world, this.effects, this.local, this.gfx.fog);
    this.placement = new PlacementGhost(map);
    this.gfx.scene.add(this.placement.group);
    if (setup.timeOfDay === 'night') {
      this.lightPools = new LightPools(this.world, this.ents);
      this.gfx.scene.add(this.lightPools.mesh);
    }

    const start = map.startPositions[0];
    this.gfx.cam.jumpTo(start.x, start.y + 2);
    this.gfx.fog.snap(this.local);

    if (!setup.demo) {
      cb.onProgress?.(0.55, 'Preparing armoury');
      const ids = [...Object.keys(BUILDINGS), ...Object.keys(UNITS)].filter((id) => {
        const t = BUILDINGS[id] ?? UNITS[id];
        return t.owner.includes(this.local.faction);
      });
      this.thumbs = renderThumbnails(ids, this.local.color);
      cb.onProgress?.(0.9, 'Establishing battle control');
      this.overlay = new Overlay(document.body);
      document.body.classList.toggle('faction-soviet', this.local.faction === 'soviet');
      this.hud = new Hud({
        world: this.world, local: this.local, thumbs: this.thumbs, selection: this.selection, audio: this.audio,
        issue: (c) => this.issue(c),
        beginPlacement: (t) => this.input?.beginPlacement(t),
        setMode: (m) => this.input?.setMode(m),
        getMode: () => this.input?.mode ?? 'normal',
        beginSuperweapon: (k: SuperKind) => this.input?.beginSuperweapon(k),
        select: (ids) => this.input?.select(ids),
        focusOn: (x, y) => this.gfx.cam.flyToPoint(x, y),
        minimapPoint: (x, y, b, drag) => this.minimapPoint(x, y, b, drag),
        openPauseMenu: () => this.pause(),
        setSpeed: (s) => { this.speed = s; },
        getSpeed: () => this.speed,
        keyCommand: (k) => this.input?.keyCommand(k),
        stats: () => `${this.gfx.stats.calls} calls · ${(this.gfx.stats.tris / 1000).toFixed(0)}k tris`,
      });
      const game = this;
      this.input = new InputController({
        world: this.world, local: this.local, gfx: this.gfx, ents: this.ents, overlay: this.overlay, placement: this.placement,
        effects: this.effects, audio: this.audio, selection: this.selection,
        get alpha() { return game.alpha; },
        get paused() { return game.paused; },
        issue: (c) => this.issue(c),
        message: (t, w) => this.hud?.message(t, w),
        openPauseMenu: () => this.pause(),
      });
      this.audio.onAnnounce = (text, key) => this.hud?.message(text, key === 'base_under_attack' || key === 'low_power' || key === 'nuke_warning' || key === 'insufficient_funds' || key === 'unit_lost' || key === 'structure_lost');
      // select the MCV at start
      const mcv = this.world.units.find((u) => u.owner === this.local && u.ut.deploysInto);
      if (mcv) this.selection.add(mcv.id);
    } else {
      this.gfx.cam.dist = this.gfx.cam.targetDist = 30;
      this.demoCam.tx = map.w / 2;
      this.demoCam.ty = map.h / 2;
    }
    cb.onProgress?.(1, 'Ready');
  }

  issue(cmd: Command) {
    this.world.issue(cmd);
  }

  /** Debug / test scenarios (see debug.ts). */
  applyScenario(name: string) {
    setupScenario(this.world, name);
    for (const p of this.world.players) recalcPlayerEconomy(this.world, p);
    const cells: number[] = [];
    for (const b of this.world.buildings) {
      for (let dy = 0; dy < b.h; dy++) for (let dx = 0; dx < b.w; dx++) cells.push(this.world.map.idx(b.cx + dx, b.cy + dy));
    }
    this.gfx.vegetation.hideCells(cells);
    this.world.step();
    this.world.events.length = 0;
    this.gfx.fog.snap(this.local);
  }

  /** Advance the simulation quickly (testing). */
  fastForward(seconds: number) {
    const n = Math.round(seconds / DT);
    for (let i = 0; i < n; i++) {
      this.world.step();
      if (i > n - 40) this.processEvents();
      else this.world.events.length = 0;
    }
    this.gfx.fog.snap(this.local);
  }

  start() {
    this.running = true;
    this.last = performance.now();
    if (!this.setup.demo) {
      this.audio.announce('mission_start');
      this.audio.startMusic();
      this.audio.setMusicIntensity(0.1);
    }
    const loop = (now: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      this.frame(now);
    };
    this.raf = requestAnimationFrame(loop);
  }

  pause() {
    if (this.paused || this.setup.demo) return;
    this.paused = true;
    this.input?.setMode('normal');
    this.cb.onPause(this);
  }

  resume() {
    this.paused = false;
    this.last = performance.now();
  }

  private minimapPoint(x: number, y: number, button: number, drag: boolean) {
    if (button === 0) {
      this.gfx.cam.jumpTo(x, y);
    } else if (button === 2 && !drag) {
      const ids = [...this.selection].filter((id) => {
        const e = this.world.getEntity(id);
        return e instanceof Unit && e.alive && e.owner === this.local;
      });
      if (ids.length) {
        this.issue({ c: 'move', player: this.local.id, units: ids, x, y });
        this.effects.orderMarker(new THREE.Vector3(x, this.world.map.surfaceAt(x, y), y), 'move');
      }
    }
  }

  private frame(now: number) {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const world = this.world;
    if (!this.paused) {
      this.time += dt;
      this.acc += dt * this.speed;
      let steps = 0;
      while (this.acc >= DT && steps < 8) {
        world.step();
        this.processEvents();
        this.acc -= DT;
        steps++;
      }
      if (steps >= 8) this.acc = 0;
    }
    this.alpha = Math.min(1, this.acc / DT);
    const fdt = this.paused ? 0 : dt;

    // selection housekeeping
    for (const id of this.selection) {
      const e = world.getEntity(id);
      if (!e?.alive || (e instanceof Unit && e.transport)) this.selection.delete(id);
    }

    if (this.setup.demo) this.updateDemoCamera(dt);
    this.input?.update(dt, this.time);
    this.gfx.fog.update(this.local, dt);
    this.ents.update(this.alpha, fdt, this.time, this.selection, this.input?.hovered ?? 0);
    this.lightPools?.update(this.alpha, this.time);
    for (const p of this.gfx.vegetation.syncTrees()) {
      if (this.gfx.fog.visibilityAt(p.x, p.z) > 0.2) this.effects.explosion(p.clone().setY(p.y + 0.4), 'fire', 0.8);
    }
    this.effects.setAmbientCenter?.(this.gfx.cam.x, this.gfx.cam.y);
    this.effects.update(fdt, this.time);

    // camera shake
    const shake = Math.min(1.2, this.effects.shake);
    this.effects.shake = Math.max(0, this.effects.shake - dt * 2.5) * Math.pow(0.02, dt);
    this.gfx.cam.shakeOffset.set((Math.random() - 0.5) * shake * 0.5, (Math.random() - 0.5) * shake * 0.3, (Math.random() - 0.5) * shake * 0.5);

    this.gfx.render(dt, this.time);
    if (this.overlay) this.overlay.draw(this.gfx.cam.camera, world, this.ents, this.local, this.selection, this.input?.hovered ?? 0, this.alpha, fdt);
    if (this.hud) {
      this.hud.update(dt);
      this.minimapT -= dt;
      if (this.minimapT <= 0) {
        this.minimapT = 0.1;
        this.hud.minimap.draw(this.input!.viewPolygon(), 0.1, this.time);
      }
    }
    // audio listener & adaptive music
    this.audio.setListener(this.gfx.cam.x, this.gfx.cam.y, this.gfx.cam.viewRadius);
    this.heat = Math.max(0, this.heat - dt * 2.5);
    if (!this.setup.demo) this.audio.setMusicIntensity(Math.min(1, 0.12 + this.heat / 40));
    this.audio.update(dt);

    if (this.endTimer > 0) {
      this.endTimer -= dt;
      if (this.endTimer <= 0) this.cb.onEnd(this, world.winnerTeam === this.local.team);
    }
  }

  private inView(x: number, y: number): boolean {
    const c = this.gfx.cam;
    return Math.abs(x - c.x) < c.dist * 0.9 && Math.abs(y - c.y) < c.dist * 0.7;
  }

  private processEvents() {
    const world = this.world;
    const fog = this.gfx.fog;
    const demo = !!this.setup.demo;
    for (const ev of world.events) {
      this.ents.handleEvent(ev);
      switch (ev.e) {
        case 'fire': {
          const vis = fog.visibilityAt(ev.fx, ev.fy) > 0.25;
          if (vis) {
            this.audio.play(ev.weapon.report as SfxKey, { x: ev.fx, y: ev.fy });
            if (this.inView(ev.fx, ev.fy)) this.heat += ev.weapon.damage >= 100 ? 2 : 0.6;
          }
          break;
        }
        case 'impact':
          if (fog.visibilityAt(ev.x, ev.y) > 0.2 || ev.kind === 'nuke') {
            this.audio.play(('expl_' + ev.kind) as SfxKey, { x: ev.x, y: ev.y });
            if (ev.kind === 'nuke') {
              this.gfx.flash = 1.4;
              this.effects.shake += 3;
              this.heat += 40;
            }
          }
          break;
        case 'death': {
          const e = world.getEntity(ev.id);
          if (ev.how === 'sold' || fog.visibilityAt(ev.x, ev.y) < 0.2) break;
          if (e instanceof Building) this.audio.play('expl_building', { x: ev.x, y: ev.y });
          else if (e instanceof Unit && e.kind === 'infantry') {
            const key: SfxKey = ev.how === 'burn' ? 'inf_burn' : ev.how === 'electro' ? 'inf_electro' : ev.how === 'crushed' ? 'crush' : world.rng.chance(0.4) ? 'inf_scream' : 'inf_die';
            this.audio.play(key, { x: ev.x, y: ev.y });
          } else this.audio.play('vehicle_die', { x: ev.x, y: ev.y });
          break;
        }
        case 'sfx':
          if (ev.x < 0 || fog.visibilityAt(ev.x, ev.y) > 0.2) this.audio.play(ev.key, ev.x < 0 ? undefined : { x: ev.x, y: ev.y });
          break;
        case 'harvest':
          this.harvestSfxT -= 1;
          if (this.harvestSfxT <= 0 && fog.visibilityAt(ev.x, ev.y) > 0.3) { this.harvestSfxT = 4; this.audio.play('harvest', { x: ev.x, y: ev.y }, { volume: 0.5 }); }
          break;
        case 'credits':
          if (!demo && ev.player === this.local.id && this.overlay) this.overlay.addFloat(ev.x, world.map.heightAt(ev.x, ev.y) + 1.4, ev.y, `+$${ev.amount}`);
          break;
        case 'announce':
          if (!demo && ev.player === this.local.id) {
            this.audio.announce(ev.key);
            if (ev.key === 'base_under_attack' || ev.key === 'harvester_under_attack') this.hud?.minimap.ping(this.local.lastAttackX, this.local.lastAttackY);
          }
          break;
        case 'placed': {
          const b = world.getEntity(ev.id);
          if (b instanceof Building) {
            const cells: number[] = [];
            for (let dy = 0; dy < b.h; dy++) for (let dx = 0; dx < b.w; dx++) cells.push(world.map.idx(b.cx + dx, b.cy + dy));
            this.gfx.vegetation.hideCells(cells);
            if (fog.visibilityAt(b.x, b.y) > 0.2) this.audio.play('build_rise', { x: b.x, y: b.y });
          }
          break;
        }
        case 'nuke':
          this.audio.play('nuke_launch');
          break;
        case 'eliminated':
          if (!demo) {
            const p = world.players[ev.player];
            this.hud?.message(p === this.local ? 'You have been defeated' : `${p.name} has been eliminated`, p === this.local);
          }
          break;
        case 'gameover':
          if (!demo) {
            const won = world.winnerTeam === this.local.team;
            this.audio.announce(won ? 'mission_accomplished' : 'mission_failed');
            this.endTimer = 3.5;
          } else {
            this.endTimer = -1;
          }
          break;
      }
    }
    world.events.length = 0;
  }

  /** Cinematic camera for the menu background: drift towards the action. */
  private updateDemoCamera(dt: number) {
    const c = this.demoCam;
    c.retarget -= dt;
    if (c.retarget <= 0) {
      c.retarget = 9;
      // find the busiest area (most units near each other, preferring combat)
      let best: Unit | null = null, bestScore = -1;
      for (const u of this.world.units) {
        if (!u.alive) continue;
        let s = u.target ? 4 : 0;
        for (const o of this.world.units) if (o.alive && Math.abs(o.x - u.x) < 6 && Math.abs(o.y - u.y) < 6) s += o.owner !== u.owner ? 3 : 1;
        if (s > bestScore) { bestScore = s; best = u; }
      }
      if (best) { c.tx = best.x; c.ty = best.y; }
    }
    const cam = this.gfx.cam;
    c.angle += dt * 0.05;
    cam.x += (c.tx + Math.cos(c.angle) * 3 - cam.x) * Math.min(1, dt * 0.35);
    cam.y += (c.ty + Math.sin(c.angle) * 2 - cam.y) * Math.min(1, dt * 0.35);
    cam.targetDist = 24 + Math.sin(c.angle * 3) * 4;
  }

  dispose() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.input?.dispose();
    this.ents.dispose();
    this.effects.dispose?.();
    this.gfx.dispose();
    this.gfx.renderer.forceContextLoss();
    this.overlay?.canvas.remove();
    document.getElementById('tooltip')?.remove();
    const ui = document.getElementById('ui');
    if (ui) ui.innerHTML = '';
    this.canvas.remove();
    this.audio.onAnnounce = undefined;
    document.body.classList.remove('faction-soviet');
  }
}

export type { GameEvent };
