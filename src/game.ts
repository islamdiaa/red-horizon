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
import { prewarmModels } from './render/models';
import { LightPools } from './render/lightpools';
import { CrateRenderer } from './render/crates';
import { TrackMarks } from './render/tracks';
import { Rubble } from './render/rubble';
import { AmbientLife } from './render/ambientlife';
import { WallRenderer } from './render/walls';
import { TargetReticle } from './render/reticle';
import { randomWeatherSequence, type WeatherKind, type WeatherStep } from './render/weather';
import type { EmitterHandle } from './render/effects/types';
import { Hud } from './ui/hud';
import { InputController } from './ui/input';
import { Hints } from './ui/hints';
import type { AudioSystem } from './audio';
import type { SfxKey } from './audio/types';
import type { SuperKind } from './sim/superweapons';
import { setupScenario } from './debug';
import { playIntro } from './cinematic';
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
  /** Real-time day/night cycle (time of day advances during the match). */
  dayCycle?: boolean;
  /** Weather: 'auto' cycles naturally, or a fixed kind. */
  weather?: string;
  /** Climate for automatic weather: temperate | winter | desert. */
  climate?: string;
  /** Play the opening cinematic (default true). */
  intro?: boolean;
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
  crates: CrateRenderer;
  tracks: TrackMarks;
  rubble: Rubble;
  life: AmbientLife;
  walls: WallRenderer;
  reticle: TargetReticle;
  private wxSeq: WeatherStep[] | null = null;
  private wxIdx = 0;
  private wxTimer = 0;
  private timedEmitters: { h: EmitterHandle; until: number }[] = [];
  hud: Hud | null = null;
  input: InputController | null = null;
  hints: Hints | null = null;
  local;
  selection = new Set<number>();
  paused = false;
  speed = 1;
  alpha = 0;
  time = 0;
  thumbs = new Map<string, string>();
  /** In-game clock (hours) driving the day/night cycle. */
  hours = 12;
  private acc = 0;
  private last = 0;
  private raf = 0;
  private running = false;
  private heat = 0;
  private minimapT = 0;
  private harvestSfxT = 0;
  private endTimer = -1;
  private lastDeath: [number, number] | null = null;
  private demoCam = { angle: 0, tx: 0, ty: 0, retarget: 0 };
  private canvas: HTMLCanvasElement;

  constructor(readonly setup: GameSetup, readonly audio: AudioSystem, private cb: GameCallbacks) {
    cb.onProgress?.(0.05, 'Generating battlefield');
    const nPlayers = 1 + setup.opponents.length;
    const climate = (setup.climate === 'winter' || setup.climate === 'desert' ? setup.climate : 'temperate') as 'temperate' | 'winter' | 'desert';
    const map = generateMap({
      size: setup.mapSize, players: nPlayers, seed: setup.seed, ore: setup.ore,
      water: climate === 'desert' ? Math.min(setup.water, 0.2) : setup.water,
      trees: climate === 'desert' ? setup.trees * 0.35 : climate === 'winter' ? Math.min(1, setup.trees * 1.2) : setup.trees,
    });
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

    cb.onProgress?.(0.2, 'Assembling armies');
    prewarmModels();
    cb.onProgress?.(0.3, 'Rendering terrain');
    const old = document.getElementById('game-canvas');
    old?.remove();
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'game-canvas';
    document.body.prepend(this.canvas);
    this.gfx = new GameRenderer(this.canvas, map, { quality: setup.quality, timeOfDay: setup.timeOfDay, climate });
    this.gfx.fog.enabled = this.world.fog;
    this.effects = new Effects({ scene: this.gfx.scene, camera: this.gfx.cam.camera, renderer: this.gfx.renderer, getHeight: (x, z) => map.surfaceAt(x, z) });
    this.effects.setSunDirection?.(this.gfx.sunDir);
    if (setup.quality === 'low') this.effects.setDensity?.(0.5);
    this.ents = new EntityRenderer(this.gfx.scene, this.world, this.effects, this.local, this.gfx.fog);
    this.ents.weatherUniforms = this.gfx.weather.surfaceUniforms;
    this.placement = new PlacementGhost(map);
    this.gfx.scene.add(this.placement.group);
    this.crates = new CrateRenderer(this.world, this.gfx.fog);
    this.tracks = new TrackMarks(this.world, this.gfx.fog);
    this.gfx.scene.add(this.tracks.mesh);
    this.rubble = new Rubble(map);
    this.gfx.scene.add(this.rubble.mesh);
    this.life = new AmbientLife(map, (x, y) => this.gfx.terrain.renderHeight(x, y));
    this.walls = new WallRenderer(this.world, this.gfx.fog, this.local);
    this.gfx.scene.add(this.walls.group);
    this.reticle = new TargetReticle(map);
    this.gfx.scene.add(this.reticle.mesh);
    // weather: a natural sequence for the climate, or a fixed kind
    const wx = setup.weather ?? 'auto';
    if (wx === 'auto') {
      this.wxSeq = randomWeatherSequence(setup.seed, climate, 7200);
      this.gfx.weather.set(this.wxSeq[0].kind, 0);
    } else {
      this.gfx.weather.set(wx as WeatherKind, 0);
    }
    this.gfx.weather.onLightning = (intensity, pos, cloud) => {
      const d = Math.hypot(pos.x - this.gfx.cam.x, pos.z - this.gfx.cam.y);
      const a = this.audio as unknown as { thunder?: (dist: number, i: number) => void };
      window.setTimeout(() => a.thunder?.(d, intensity * (cloud ? 0.6 : 1)), Math.min(3500, d * 22));
    };
    this.gfx.scene.add(this.life.group);
    this.gfx.scene.add(this.crates.group);
    this.lightPools = new LightPools(this.world, this.ents);
    this.gfx.scene.add(this.lightPools.mesh);
    this.hours = setup.timeOfDay === 'night' ? 22.5 : setup.timeOfDay === 'dusk' ? 17.9 : 10.5;
    this.gfx.setTimeOfDay(this.hours);

    const start = map.startPositions[0];
    this.gfx.cam.jumpTo(start.x, start.y + 1);
    if (!setup.demo) {
      // cinematic drop-in from high altitude
      this.gfx.cam.dist = 48;
      this.gfx.cam.targetDist = 20;
    }
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
        keyCommand: (k, b) => this.input?.keyCommand(k, b),
        stats: () => `${this.gfx.stats.calls} calls · ${(this.gfx.stats.tris / 1000).toFixed(0)}k tris`,
      });
      const game = this;
      this.input = new InputController({
        world: this.world, local: this.local, gfx: this.gfx, ents: this.ents, overlay: this.overlay, placement: this.placement,
        effects: this.effects, audio: this.audio, selection: this.selection, reticle: this.reticle,
        get alpha() { return game.alpha; },
        get paused() { return game.paused; },
        issue: (c) => this.issue(c),
        message: (t, w) => this.hud?.message(t, w),
        openPauseMenu: () => this.pause(),
      });
      this.audio.onAnnounce = (text, key) => this.hud?.message(text, key === 'base_under_attack' || key === 'low_power' || key === 'nuke_warning' || key === 'insufficient_funds' || key === 'unit_lost' || key === 'structure_lost');
      this.hints = new Hints(document.getElementById('ui')!, this.world, this.local);
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
      const begin = () => {
        this.audio.announce('mission_start');
        this.audio.startMusic();
        this.audio.setMusicIntensity(0.1);
      };
      if (this.setup.intro !== false) playIntro(this, begin);
      else begin();
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
    if (this.world.gameOver && this.speed < 1) this.speed = 1;
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
    if (this.setup.dayCycle !== false && !this.paused) {
      // a full day passes in ~18 minutes of play
      this.hours = (this.hours + (dt * this.speed) / 45) % 24;
    }
    this.gfx.setTimeOfDay(this.hours);
    this.effects.setSunDirection?.(this.gfx.sunDir);
    if (this.wxSeq && !this.paused) {
      this.wxTimer += dt * this.speed;
      const cur = this.wxSeq[this.wxIdx];
      if (cur && this.wxTimer > cur.duration && this.wxIdx + 1 < this.wxSeq.length) {
        this.wxTimer = 0;
        const next = this.wxSeq[++this.wxIdx];
        this.gfx.weather.set(next.kind, next.fade);
      }
    }
    this.effects.setWind?.(this.gfx.weather.wind.x, this.gfx.weather.wind.y);
    if (this.lightPools) {
      this.lightPools.mesh.visible = this.gfx.night > 0.05;
      if (this.lightPools.mesh.visible) this.lightPools.update(this.alpha, this.time, this.gfx.night);
    }
    this.crates.update(this.time);
    this.walls.update();
    if (!this.paused) this.tracks.update(this.alpha, this.time);
    this.life.update(fdt, this.time, this.gfx.night, this.gfx.cam.x, this.gfx.cam.y);
    if (this.timedEmitters.length) {
      for (const t of this.timedEmitters) if (this.time > t.until) t.h.dispose();
      this.timedEmitters = this.timedEmitters.filter((t) => this.time <= t.until);
    }
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
    if (!this.setup.demo && !this.paused) this.gfx.adaptResolution(dt * 1000);
    if (this.overlay) this.overlay.draw(this.gfx.cam.camera, world, this.ents, this.local, this.selection, this.input?.hovered ?? 0, this.alpha, fdt);
    if (this.hud) {
      this.hud.update(dt);
      if (this.world.tick % 10 === 0) this.hints?.update();
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
      // dead entities are already removed from the world; their view still knows them
      const deadEnt = ev.e === 'death' ? this.ents.views.get(ev.id)?.ent : undefined;
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
          if (ev.kind === 'medium' || ev.kind === 'large' || ev.kind === 'huge' || ev.kind === 'nuke') this.life.startle(ev.x, ev.y, ev.kind === 'nuke' ? 4 : 1);
          if (fog.visibilityAt(ev.x, ev.y) > 0.2 || ev.kind === 'nuke') {
            this.audio.play(('expl_' + ev.kind) as SfxKey, { x: ev.x, y: ev.y });
            if (ev.kind === 'nuke') {
              this.gfx.flash = 0.45;
              this.effects.shake += 3;
              this.heat += 40;
            }
          }
          break;
        case 'death': {
          const e = deadEnt ?? world.getEntity(ev.id);
          if (e instanceof Building && ev.how !== 'sold') {
            this.rubble.add(e.cx, e.cy, e.w, e.h, e.id);
            const h = this.effects.createEmitter('smoke', new THREE.Vector3(e.x, world.map.heightAt(e.x, e.y) + 0.3, e.y));
            h.setIntensity(0.6 + Math.max(e.w, e.h) * 0.2);
            this.timedEmitters.push({ h, until: this.time + 25 });
            this.life.startle(e.x, e.y, 1.5);
          }
          if (ev.how === 'sold' || fog.visibilityAt(ev.x, ev.y) < 0.2) break;
          if (e instanceof Building) { this.audio.play('expl_building', { x: ev.x, y: ev.y }); this.lastDeath = [ev.x, ev.y]; }
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
            this.rubble.clear(b.cx, b.cy, b.w, b.h);
            if (fog.visibilityAt(b.x, b.y) > 0.2) this.audio.play('build_rise', { x: b.x, y: b.y });
          }
          break;
        }
        case 'nuke':
          this.audio.play('nuke_launch');
          break;
        case 'captured': {
          const b = world.getEntity(ev.id);
          if (b instanceof Building && fog.visibilityAt(b.x, b.y) > 0.2) {
            const p3 = new THREE.Vector3(b.x, world.map.heightAt(b.x, b.y) + 0.2, b.y);
            this.effects.chronoFlash(p3);
            this.effects.constructionBurst(p3, Math.max(b.w, b.h));
            if (!demo && this.overlay && (ev.to === this.local.id || ev.from === this.local.id)) this.overlay.addFloat(b.x, p3.y + 1.2, b.y, ev.to === this.local.id ? 'CAPTURED' : 'STRUCTURE LOST', ev.to === this.local.id ? '#8dffb0' : '#ff6a5a');
          }
          break;
        }
        case 'promoted': {
          const u = world.getEntity(ev.id);
          if (u && fog.visibilityAt(u.x, u.y) > 0.2) {
            const p3 = new THREE.Vector3(u.x, world.map.surfaceAt(u.x, u.y) + 0.4, u.y);
            this.effects.oreSparkle(p3, false);
            this.effects.healPulse(p3);
            if (!demo && u.owner === this.local && this.overlay) this.overlay.addFloat(u.x, p3.y + 0.5, u.y, ev.rank >= 2 ? '★ ELITE' : '▲ VETERAN', '#ffe27a');
          }
          break;
        }
        case 'crate': {
          const p3 = new THREE.Vector3(ev.x, world.map.surfaceAt(ev.x, ev.y) + 0.3, ev.y);
          if (fog.visibilityAt(ev.x, ev.y) > 0.2) {
            if (ev.reward === 'unit') this.effects.chronoFlash(p3);
            else this.effects.oreSparkle(p3, ev.reward !== 'money');
            this.effects.healPulse(p3);
          }
          if (!demo && ev.player === this.local.id && this.overlay) {
            const label = ev.reward === 'money' ? `+$${ev.amount}` : ev.reward === 'unit' ? 'Reinforcements!' : ev.reward === 'heal' ? 'Field repair' : 'Area revealed';
            this.overlay.addFloat(ev.x, p3.y + 0.8, ev.y, label, ev.reward === 'money' ? '#ffd34d' : '#8dffb0');
          }
          break;
        }
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
            this.endTimer = 4;
            // slow-motion sweep to the final explosion
            this.speed = 0.35;
            if (this.lastDeath) this.gfx.cam.flyToPoint(this.lastDeath[0], this.lastDeath[1]);
            this.gfx.cam.targetDist = 16;
            this.input?.setMode('normal');
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
