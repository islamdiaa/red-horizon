/**
 * [DOCTRINE] Commander powers panel and power visuals (Commander rules, src/sim/commander.ts).
 *
 * A compact panel: the doctrine badge, command points (CP), the commander level and its progress, and the three-tier
 * power tree. Buttons show their state at a glance: locked tier (with the level that opens it), affordable (glows:
 * click to unlock), not enough CP, ready (click to use; aimed powers start the input layer's 'aim' mode with the
 * shared target reticle), recharging (a sweep and the seconds left).
 *
 * Works the same in the Modern and Classic HUD layouts (placed by CSS: right-hand column above the selection panel in
 * Modern, left edge in Classic), with the mouse, touch (taps) and the gamepad (D-pad focus reaches `#cmdpanel button`,
 * A presses). Keyboard: T arms the powers, then 1–9 / 0 picks one in tree order (Esc / right click cancels aiming).
 *
 * Attached by game.ts like the rivals radio (one tagged line); `commanderVisual` is fed the sim's 'commander' events
 * by the Game's event loop. No per-frame allocations: the DOM refreshes at 8 Hz from cached state keys.
 */
import * as THREE from 'three';
import { ICONS } from './icons';
import { el, esc, reducedMotion } from './dom';
import { TargetReticle } from '../render/reticle';
import {
  ELITE_N, LEVELS, POWERS, TIER_COST, TIER_LEVEL, commanderLevel, nextLevelAt, powerCooldown, powerReady, powerTree, sabotageTarget, tierOpen,
  type PowerDef, type PowerId,
} from '../sim/commander';
import { DOCTRINES } from '../sim/doctrine';
import { TICK_HZ, type Command, type GameEvent } from '../sim/types';
import type { World } from '../sim/world';
import type { Player } from '../sim/player';
import type { Entity } from '../sim/entities';
import type { AimRequest } from './input';
import type { Effects } from '../render/effects';
import type { SfxKey } from '../audio/types';

/** Icons of the powers (the shared UI icon set). */
export const POWER_ICONS: Record<PowerId, string> = {
  recon: ICONS.radar, repair: ICONS.wrench, funds: ICONS.coin, rally: ICONS.chevrons, elite: ICONS.star, barrage: ICONS.parabombs,
  reinforce: ICONS.vehicle, sabotage: ICONS.bolt, aegis: ICONS.shield, storm: ICONS.storm,
};
/** Icons of the doctrines (DoctrineDef.icon keys). */
export const DOCTRINE_ICONS: Record<string, string> = {
  tank: ICONS.vehicle, infantry: ICONS.people, bolt: ICONS.boltSolid, rocket: ICONS.aircraft, speed: ICONS.gauge, fort: ICONS.defense,
  target: ICONS.target, eye: ICONS.eye,
};
const ROMAN = ['', 'I', 'II', 'III'];
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];

/** What the panel needs from the running Game (src/game.ts). */
export interface CommanderGame {
  world: World;
  local: Player;
  setup: { replay?: unknown };
  paused: boolean;
  issue(cmd: Command): void;
  input: { beginAim(req: AimRequest): void; mode: string; setMode(m: 'normal'): void } | null;
  hud: { message(text: string, warn?: boolean, kind?: 'warn' | 'info' | 'success' | 'economy'): void } | null;
  audio: { play(key: SfxKey, pos?: { x: number; y: number }, opts?: { volume?: number }): void };
  effects: Effects;
  gfx: { scene: THREE.Scene; fog: { visibilityAt(x: number, y: number): number } };
  overlay?: { addFloat(x: number, y: number, z: number, text: string, color?: string): void } | null;
}

interface Btn { d: PowerDef; el: HTMLButtonElement; cd: HTMLElement; txt: HTMLElement; key: string }

let live: CommanderPanel | null = null;

// =====================================================================================================
// Panel
// =====================================================================================================

class CommanderPanel {
  readonly root: HTMLElement;
  private head: HTMLButtonElement;
  private cpEl: HTMLElement;
  private lvlEl: HTMLElement;
  private barEl: HTMLElement;
  private tierEls: HTMLElement[] = [];
  private btns: Btn[] = [];
  private tip: HTMLElement;
  private tipFor: Btn | null = null;
  private timer = 0;
  private raf = 0;
  private armedUntil = 0;
  private headKey = '';
  private collapsed = false;
  private rings: { r: TargetReticle; x: number; y: number; rad: number; color: number; until: number }[] = [];
  private offKey: () => void;
  private body: HTMLElement;
  private faction = '';
  private hintTimer = 0;
  private readonly spectator: boolean;

  constructor(private g: CommanderGame) {
    injectCss();
    this.spectator = !!g.setup.replay;
    try { this.collapsed = localStorage.getItem('rh.cmdpanel') === 'min'; } catch { /* storage blocked */ }
    const root = el('div', 'cmdp');
    root.id = 'cmdpanel';
    root.classList.toggle('min', this.collapsed);
    this.root = root;
    const head = el('button', 'cmdp-head');
    head.type = 'button';
    head.setAttribute('aria-expanded', String(!this.collapsed));
    head.innerHTML = `<span class="cmdp-doc"></span><span class="cmdp-title"><small>Command</small><b class="cmdp-lvl"></b></span>
      <span class="cmdp-cp"><b></b><small>CP</small></span><i class="cmdp-bar"><i></i></i>`;
    this.head = head;
    this.cpEl = head.querySelector('.cmdp-cp b')!;
    this.lvlEl = head.querySelector('.cmdp-lvl')!;
    this.barEl = head.querySelector('.cmdp-bar i')!;
    head.onclick = () => this.toggle();
    root.appendChild(head);
    this.body = el('div', 'cmdp-body');
    root.appendChild(this.body);
    this.buildTree();
    this.tip = el('div', 'cmdp-tip');
    root.appendChild(this.tip);
    root.classList.toggle('spectator', this.spectator);
    this.mount();
    const onKey = (e: KeyboardEvent) => this.onKey(e);
    window.addEventListener('keydown', onKey, true);
    this.offKey = () => window.removeEventListener('keydown', onKey, true);
    this.refresh();
    this.timer = window.setInterval(() => this.refresh(), 125);
    // a new match: point the newcomer at the panel once
    if (!this.spectator && g.world.tick < TICK_HZ * 5) {
      this.hintTimer = window.setTimeout(() => {
        const c = this.cmd;
        if (c && !c.unlocked.length) g.hud?.message(`Commander rules: you have ${Math.floor(c.points)} command points. Unlock your first power in the Command panel (T, then 1–3).`, false, 'info');
      }, 6000);
    }
    const frame = () => { this.raf = requestAnimationFrame(frame); this.frame(); };
    this.raf = requestAnimationFrame(frame);
  }

  /** The faction's power tree as buttons (rebuilt when a replay viewer switches to a player of the other side). */
  private buildTree() {
    const g = this.g, body = this.body;
    this.faction = g.local.faction;
    body.innerHTML = '';
    this.btns.length = 0;
    this.tierEls.length = 0;
    this.headKey = '';
    let k = 0;
    powerTree(g.local.faction).forEach((tier, ti) => {
      const row = el('div', 'cmdp-tier');
      row.dataset.tier = String(ti + 1);
      row.appendChild(el('span', 'cmdp-tl', `<b>${ROMAN[ti + 1]}</b><small></small>`));
      for (const d of tier) {
        const b = el('button', 'cmdp-pw');
        b.type = 'button';
        b.dataset.power = d.id;
        b.setAttribute('aria-label', d.name);
        const key = KEYS[k++] ?? '';
        b.innerHTML = `<span class="cmdp-ic">${POWER_ICONS[d.id]}</span><i class="cmdp-cd"></i><span class="cmdp-t"></span><kbd>${key}</kbd>`;
        const btn: Btn = { d, el: b, cd: b.querySelector('.cmdp-cd')!, txt: b.querySelector('.cmdp-t')!, key: '' };
        b.onclick = () => this.press(btn);
        b.addEventListener('pointerenter', () => this.showTip(btn));
        b.addEventListener('focus', () => this.showTip(btn));
        b.addEventListener('pointerleave', () => this.hideTip());
        b.addEventListener('blur', () => this.hideTip());
        row.appendChild(b);
        this.btns.push(btn);
      }
      this.tierEls.push(row);
      body.appendChild(row);
    });
    if (!this.spectator) body.appendChild(el('div', 'cmdp-hint', `<kbd>T</kbd> then <kbd>1</kbd>–<kbd>${Math.min(9, k)}</kbd>`));
  }

  /** (Re)attach to the HUD root: the HUD clears it when it rebuilds (layout switch, replays changing view). */
  private mount() {
    const ui = document.getElementById('ui');
    if (ui && this.root.parentElement !== ui) ui.appendChild(this.root);
  }

  dispose() {
    window.clearInterval(this.timer);
    window.clearTimeout(this.hintTimer);
    cancelAnimationFrame(this.raf);
    this.offKey();
    this.root.remove();
    for (const r of this.rings) { this.g.gfx.scene.remove(r.r.mesh); r.r.mesh.geometry.dispose(); (r.r.mesh.material as THREE.Material).dispose(); }
    this.rings.length = 0;
    if (live === this) live = null;
  }

  private toggle() {
    this.collapsed = !this.collapsed;
    this.root.classList.toggle('min', this.collapsed);
    this.head.setAttribute('aria-expanded', String(!this.collapsed));
    try { localStorage.setItem('rh.cmdpanel', this.collapsed ? 'min' : 'max'); } catch { /* */ }
    this.g.audio.play('click', undefined, { volume: 0.6 });
  }

  private get cmd() {
    return this.g.local.cmd;
  }

  // ------------------------------------------------------------------ state → DOM (8 Hz)
  refresh() {
    const c = this.cmd;
    if (!c) return;
    this.mount();
    if (this.g.local.faction !== this.faction) this.buildTree();
    const w = this.g.world;
    const lvl = commanderLevel(c.earned);
    const pts = Math.floor(c.points + 1e-9);
    const next = nextLevelAt(c.earned);
    const prev = LEVELS[Math.max(0, lvl - 1)] ?? 0;
    const frac = next === Infinity ? 1 : (c.earned - prev) / Math.max(1e-6, next - prev);
    const doc = c.doctrine ? DOCTRINES[c.doctrine] : null;
    const hk = `${pts}|${lvl}|${Math.round(frac * 50)}|${doc?.id ?? ''}`;
    if (hk !== this.headKey) {
      this.headKey = hk;
      this.cpEl.textContent = String(pts);
      this.lvlEl.textContent = `Level ${lvl}`;
      this.barEl.style.width = `${Math.round(frac * 100)}%`;
      const docEl = this.head.querySelector('.cmdp-doc') as HTMLElement;
      docEl.innerHTML = doc ? DOCTRINE_ICONS[doc.icon] ?? ICONS.flag : ICONS.flag;
      this.head.title = doc ? `${doc.name}: ${doc.bonuses.join('; ')}; ${doc.drawback}` : 'Commander';
      this.head.dataset.tip = '';
      for (let t = 1; t <= 3; t++) {
        const row = this.tierEls[t - 1];
        const open = tierOpen(c, t);
        row.classList.toggle('closed', !open);
        (row.querySelector('.cmdp-tl small') as HTMLElement).textContent = open ? `${TIER_COST[t]} CP` : `Lv ${TIER_LEVEL[t]}`;
      }
    }
    let canBuy = false;
    for (const b of this.btns) {
      const id = b.d.id;
      const owned = c.unlocked.includes(id);
      let state: string, txt = '', cd = 0;
      if (owned) {
        const left = powerCooldown(w, c, id);
        if (c.disabled) state = 'off';
        else if (left > 0) { state = 'cool'; cd = Math.min(1, left / (c.span[id] || b.d.cooldown * TICK_HZ)); txt = `${Math.ceil(left / TICK_HZ)}`; }
        else state = 'ready';
      } else if (!tierOpen(c, b.d.tier)) state = 'locked';
      else if (c.points + 1e-9 >= TIER_COST[b.d.tier]) { state = 'buy'; canBuy = true; txt = `${TIER_COST[b.d.tier]}`; }
      else { state = 'poor'; txt = `${TIER_COST[b.d.tier]}`; }
      const key = `${state}|${txt}|${Math.round(cd * 60)}`;
      if (key === b.key) continue;
      b.key = key;
      b.el.dataset.state = state;
      b.txt.textContent = txt;
      b.cd.style.setProperty('--cd', String(cd));
      b.el.disabled = this.spectator;
      if (this.tipFor === b) this.showTip(b);
    }
    this.root.classList.toggle('canbuy', canBuy && !this.spectator);
    this.root.classList.toggle('armed', performance.now() < this.armedUntil);
  }

  // ------------------------------------------------------------------ interaction
  private press(b: Btn) {
    const g = this.g, c = this.cmd;
    if (!c || this.spectator || g.paused) return;
    const d = b.d;
    if (!c.unlocked.includes(d.id)) {
      if (!tierOpen(c, d.tier)) { g.hud?.message(`${d.name}: reach commander level ${TIER_LEVEL[d.tier]} to open tier ${ROMAN[d.tier]}`, true); g.audio.play('error'); return; }
      if (c.points + 1e-9 < TIER_COST[d.tier]) { g.hud?.message(`${d.name} needs ${TIER_COST[d.tier]} command points (you have ${Math.floor(c.points + 1e-9)})`, true); g.audio.play('error'); return; }
      g.issue({ c: 'unlockPower', player: g.local.id, power: d.id });
      g.audio.play('ready_ping');
      return;
    }
    if (!powerReady(g.world, c, d.id)) {
      g.hud?.message(`${d.name} recharging: ${Math.ceil(powerCooldown(g.world, c, d.id) / TICK_HZ)} s`, true);
      g.audio.play('error');
      return;
    }
    g.audio.play('click');
    if (d.target === 'none') { g.issue({ c: 'commanderPower', player: g.local.id, power: d.id }); return; }
    g.input?.beginAim({
      r: d.radius, color: d.color,
      label: `${d.name}: ${d.target === 'structure' ? 'click an enemy structure' : 'click the target area'} (right click to cancel)`,
      onTarget: (x, y, picked: Entity | null) => {
        if (d.target === 'structure') {
          const t = sabotageTarget(g.world, g.local, x, y, picked?.kind === 'building' ? picked.id : undefined);
          if (!t) { g.hud?.message('Sabotage: pick an enemy structure you have seen', true); g.audio.play('error'); return false; }
          g.issue({ c: 'commanderPower', player: g.local.id, power: d.id, x: t.x, y: t.y, target: t.id });
          return true;
        }
        g.issue({ c: 'commanderPower', player: g.local.id, power: d.id, x, y });
        return true;
      },
    });
  }

  private onKey(e: KeyboardEvent) {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    if (this.spectator || this.g.paused || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 't' && !e.shiftKey) {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.armedUntil = performance.now() + 2500;
      if (this.collapsed) this.toggle();
      this.refresh();
      return;
    }
    if (performance.now() >= this.armedUntil) return;
    const digit = /^(?:Digit|Numpad)([0-9])$/.exec(e.code)?.[1] ?? (/^[0-9]$/.test(k) ? k : null);
    if (digit === null) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    this.armedUntil = 0;
    const b = this.btns[KEYS.indexOf(digit)];
    if (b) this.press(b);
    this.refresh();
  }

  private showTip(b: Btn) {
    const c = this.cmd;
    if (!c) return;
    this.tipFor = b;
    const d = b.d;
    const owned = c.unlocked.includes(d.id);
    const left = owned ? powerCooldown(this.g.world, c, d.id) : 0;
    const status = owned
      ? (left > 0 ? `Recharging: ${Math.ceil(left / TICK_HZ)} s` : 'Ready')
      : !tierOpen(c, d.tier) ? `Tier ${ROMAN[d.tier]} opens at commander level ${TIER_LEVEL[d.tier]}` : `Unlock: ${TIER_COST[d.tier]} CP`;
    this.tip.innerHTML = `<b>${esc(d.name)}</b><span class="cmdp-tt-meta">Tier ${ROMAN[d.tier]} · ${d.cooldown} s cooldown${d.target === 'none' ? '' : d.target === 'structure' ? ' · aim at a structure' : ' · aimed'}</span>
      <p>${esc(d.desc)}</p><span class="cmdp-tt-st ${owned ? (left > 0 ? 'cool' : 'ok') : 'lock'}">${esc(status)}</span>`;
    const r = b.el.getBoundingClientRect(), pr = this.root.getBoundingClientRect();
    this.tip.style.top = `${Math.round(r.top - pr.top)}px`;
    this.tip.classList.add('on');
  }

  private hideTip() {
    this.tipFor = null;
    this.tip.classList.remove('on');
  }

  // ------------------------------------------------------------------ world visuals
  /** A ground ring for `ticks` sim ticks (barrage / storm warnings, area casts). */
  ring(x: number, y: number, r: number, color: number, ticks: number) {
    let slot = this.rings.find((s) => s.until <= this.g.world.tick);
    if (!slot) {
      if (this.rings.length >= 8) return;
      const ret = new TargetReticle(this.g.world.map);
      this.g.gfx.scene.add(ret.mesh);
      slot = { r: ret, x, y, rad: r, color, until: 0 };
      this.rings.push(slot);
    }
    slot.x = x; slot.y = y; slot.rad = r; slot.color = color; slot.until = this.g.world.tick + ticks;
  }

  private frame() {
    if (!this.rings.length) return;
    const t = performance.now() / 1000, tick = this.g.world.tick;
    for (const s of this.rings) {
      if (s.until > tick) s.r.show(s.x, s.y, Math.max(0.9, s.rad), s.color, t);
      else if (s.r.mesh.visible) s.r.hide();
    }
  }

  flash(cls: 'pulse' | 'level') {
    this.root.classList.remove(cls);
    void this.root.offsetWidth;
    this.root.classList.add(cls);
    window.setTimeout(() => this.root.classList.remove(cls), 1400);
  }
}

/** Attach the powers panel to a running game (Commander rules only; a no-op otherwise). */
export function attachCommanderPanel(g: CommanderGame): { dispose(): void } {
  if (!g.world.commander || !g.local.cmd) return { dispose() {} };
  live?.dispose();
  live = new CommanderPanel(g);
  const p = live;
  return { dispose: () => p.dispose() };
}

// =====================================================================================================
// Event visuals (Game event loop)
// =====================================================================================================

const V = (g: CommanderGame, x: number, y: number, dy = 0.2) => new THREE.Vector3(x, g.world.map.surfaceAt(x, y) + dy, y);

/** React to a 'commander' sim event: effects, rings, panel flashes and messages for the local player. */
export function commanderVisual(g: CommanderGame, ev: Extract<GameEvent, { e: 'commander' }>) {
  const panel = live;
  const mine = ev.player === g.local.id;
  const enemy = !mine && g.local.isEnemy(g.world.players[ev.player]);
  const seen = ev.x >= 0 && (mine || g.gfx.fog.visibilityAt(ev.x, ev.y) > 0.2);
  const d = (POWERS as Record<string, PowerDef>)[ev.power];
  switch (ev.stage) {
    case 'points':
      if (mine && panel) panel.flash('pulse');
      return;
    case 'level':
      if (!mine) return;
      panel?.flash('level');
      for (let t = 2; t <= 3; t++) if (ev.amount === TIER_LEVEL[t]) { g.hud?.message(`Commander level ${ev.amount}: tier ${ROMAN[t]} powers open`, false, 'success'); return; }
      g.hud?.message(`Commander level ${ev.amount}`, false, 'success');
      return;
    case 'unlock':
      if (mine && d) { g.hud?.message(`${d.name} unlocked`, false, 'success'); panel?.flash('pulse'); }
      return;
    case 'warn':
      // the target area of an offensive power: everybody sees it coming
      panel?.ring(ev.x, ev.y, ev.r ?? 3, ev.power === 'storm' ? 0x9ad8ff : 0xff3a1a, Math.round((ev.power === 'storm' ? 10 : 7) * TICK_HZ));
      if (enemy && seen) g.hud?.message(ev.power === 'storm' ? 'Warning: Tesla Storm incoming!' : 'Warning: artillery barrage incoming!', true);
      return;
    case 'bolt':
      if (seen) {
        g.effects.teslaBolt(V(g, ev.x + 0.4, ev.y - 0.6, 11), V(g, ev.x, ev.y, 0.3));
        if (!reducedMotion()) g.effects.shake = Math.min(1.2, g.effects.shake + 0.25);
      }
      return;
    case 'arrive': // (the announcer already says "reinforcements have arrived"); a flash where they enter
      if (seen) g.effects.chronoFlash(V(g, ev.x, ev.y, 0.4));
      return;
    case 'cast':
      break;
  }
  if (!d) return;
  if (mine && d.target === 'none' && ev.power === 'elite') g.hud?.message(`Elite Training: your next ${ELITE_N} combat units arrive as Veterans`, false, 'success');
  if (!seen) return;
  const pos = V(g, ev.x, ev.y);
  switch (ev.power as PowerId) {
    case 'recon':
      g.effects.sonarPing(pos, d.radius);
      panel?.ring(ev.x, ev.y, d.radius, d.color, TICK_HZ * 2);
      break;
    case 'repair':
      g.effects.healPulse(pos);
      for (const u of g.world.units) if (u.alive && u.owner.id === ev.player && Math.hypot(u.x - ev.x, u.y - ev.y) <= d.radius) g.effects.healPulse(V(g, u.x, u.y, 0.35));
      panel?.ring(ev.x, ev.y, d.radius, d.color, TICK_HZ * 2);
      break;
    case 'rally':
      g.effects.radarJamPulse(pos, d.radius);
      panel?.ring(ev.x, ev.y, d.radius, d.color, TICK_HZ * 3);
      break;
    case 'aegis':
      g.effects.ironCurtainPulse(pos, d.radius);
      panel?.ring(ev.x, ev.y, d.radius, d.color, TICK_HZ * 3);
      break;
    case 'sabotage':
      g.effects.radarJamPulse(pos, 2.5);
      g.overlay?.addFloat(ev.x, g.world.map.heightAt(ev.x, ev.y) + 1.6, ev.y, 'SABOTAGED', '#ff6a8a');
      break;
    case 'reinforce':
      panel?.ring(ev.x, ev.y, 1.5, d.color, TICK_HZ * 2);
      break;
    default:
      break;
  }
}

// =====================================================================================================
// Styles
// =====================================================================================================

function injectCss() {
  if (document.getElementById('cmdp-style')) return;
  const st = document.createElement('style');
  st.id = 'cmdp-style';
  st.textContent = CSS;
  document.head.appendChild(st);
}

const CSS = `
#cmdpanel { position: absolute; z-index: 4; left: var(--edge, 0.7rem); top: 50%; transform: translateY(-50%); width: 11.6rem;
  display: flex; flex-direction: column; border-radius: 0.7rem; background: var(--glass); border: 1px solid var(--line-2);
  box-shadow: 0 0.5rem 1.4rem rgba(0, 0, 0, 0.45); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); font-family: var(--font); }
body.hud-modern #cmdpanel { left: auto; right: var(--edge, 0.7rem); top: auto; transform: none; bottom: calc(var(--dock-h, 12rem) + var(--edge, 0.7rem) * 2); }
#cmdpanel.pulse { animation: cmdpPulse 1.2s var(--ease, ease); }
#cmdpanel.level { animation: cmdpLevel 1.4s var(--ease, ease); }
@keyframes cmdpPulse { 0% { box-shadow: 0 0 0 0 rgba(var(--gold-rgb), 0.7); } 100% { box-shadow: 0 0 0 1.1rem rgba(var(--gold-rgb), 0); } }
@keyframes cmdpLevel { 0%, 100% { border-color: var(--line-2); } 25% { border-color: var(--gold); box-shadow: 0 0 1.6rem rgba(var(--gold-rgb), 0.55); } }
.cmdp-head { all: unset; box-sizing: border-box; position: relative; display: flex; align-items: center; gap: 0.5rem; padding: 0.45rem 0.6rem 0.55rem; cursor: pointer; border-radius: 0.7rem 0.7rem 0 0; }
.cmdp-head:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.cmdp-doc { width: 1.9rem; height: 1.9rem; border-radius: 0.45rem; display: grid; place-items: center; font-size: 1.15rem; color: var(--accent-hi);
  background: radial-gradient(circle at 50% 30%, rgba(var(--accent-rgb), 0.35), rgba(var(--accent-rgb), 0.08)); border: 1px solid rgba(var(--accent-rgb), 0.45); }
.cmdp-title { display: flex; flex-direction: column; line-height: 1; flex: 1; min-width: 0; }
.cmdp-title small { font-size: 0.58rem; letter-spacing: 0.22em; text-transform: uppercase; color: var(--muted); font-weight: 700; }
.cmdp-title b { font-size: 0.86rem; letter-spacing: 0.06em; color: var(--text); margin-top: 0.18rem; }
.cmdp-cp { display: flex; align-items: baseline; gap: 0.2rem; color: var(--gold); font-family: var(--mono); }
.cmdp-cp b { font-size: 1.25rem; font-weight: 400; }
.cmdp-cp small { font-size: 0.6rem; color: var(--muted); letter-spacing: 0.1em; }
.cmdp-bar { position: absolute; left: 0.6rem; right: 0.6rem; bottom: 0.22rem; height: 0.16rem; border-radius: 1rem; background: rgba(255, 255, 255, 0.08); overflow: hidden; }
.cmdp-bar i { display: block; height: 100%; width: 0; background: linear-gradient(90deg, rgba(var(--gold-rgb), 0.5), var(--gold)); transition: width 0.4s var(--ease, ease); }
.cmdp-body { display: flex; flex-direction: column; gap: 0.3rem; padding: 0.15rem 0.45rem 0.45rem; }
#cmdpanel.min .cmdp-body { display: none; }
#cmdpanel.min.canbuy .cmdp-head { box-shadow: inset 0 0 0 1px rgba(var(--gold-rgb), 0.6); }
.cmdp-tier { display: flex; align-items: center; gap: 0.3rem; }
.cmdp-tl { width: 1.55rem; display: flex; flex-direction: column; align-items: center; line-height: 1; color: var(--text-2); }
.cmdp-tl b { font-size: 0.78rem; letter-spacing: 0.04em; }
.cmdp-tl small { font-size: 0.56rem; color: var(--muted); margin-top: 0.15rem; white-space: nowrap; font-family: var(--mono); }
.cmdp-tier.closed .cmdp-tl { color: var(--dim); }
.cmdp-pw { all: unset; box-sizing: border-box; position: relative; width: 2.85rem; height: 2.85rem; border-radius: 0.5rem; display: grid; place-items: center; cursor: pointer;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.07), rgba(255, 255, 255, 0.02)); border: 1px solid var(--line-2); color: var(--text-2); overflow: hidden;
  touch-action: manipulation; transition: border-color 0.2s, color 0.2s, background 0.2s, transform 0.12s; }
.cmdp-pw:hover { transform: translateY(-1px); }
.cmdp-pw:active { transform: scale(0.96); }
.cmdp-pw:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.cmdp-ic { font-size: 1.35rem; display: grid; place-items: center; position: relative; z-index: 1; }
.cmdp-pw kbd { position: absolute; left: 0.12rem; top: 0.12rem; font-size: 0.5rem; padding: 0.08rem 0.2rem; opacity: 0; transition: opacity 0.15s; z-index: 2; }
#cmdpanel.armed .cmdp-pw kbd { opacity: 1; }
.cmdp-t { position: absolute; right: 0.18rem; bottom: 0.08rem; font-family: var(--mono); font-size: 0.66rem; z-index: 2; color: var(--text); text-shadow: 0 1px 2px #000; }
.cmdp-cd { position: absolute; inset: 0; z-index: 1; pointer-events: none; --cd: 0;
  background: conic-gradient(rgba(0, 0, 0, 0.62) calc(var(--cd) * 360deg), transparent 0); }
.cmdp-pw[data-state="locked"] { color: var(--dim); opacity: 0.55; }
.cmdp-pw[data-state="locked"] .cmdp-ic, .cmdp-pw[data-state="poor"] .cmdp-ic { filter: grayscale(1); }
.cmdp-pw[data-state="poor"] { color: var(--muted); border-style: dashed; }
.cmdp-pw[data-state="poor"] .cmdp-t { color: var(--muted); }
.cmdp-pw[data-state="buy"] { color: var(--gold); border-color: rgba(var(--gold-rgb), 0.75); background: linear-gradient(180deg, rgba(var(--gold-rgb), 0.22), rgba(var(--gold-rgb), 0.06)); animation: cmdpBuy 1.6s ease-in-out infinite; }
.cmdp-pw[data-state="buy"] .cmdp-t { color: var(--gold); }
@keyframes cmdpBuy { 50% { box-shadow: 0 0 0.75rem rgba(var(--gold-rgb), 0.45); } }
.cmdp-pw[data-state="ready"] { color: var(--accent-hi); border-color: rgba(var(--accent-rgb), 0.7); background: linear-gradient(180deg, rgba(var(--accent-rgb), 0.28), rgba(var(--accent-rgb), 0.07)); }
.cmdp-pw[data-state="cool"] { color: var(--text-2); }
.cmdp-pw[data-state="off"] { opacity: 0.4; }
.cmdp-pw:disabled { cursor: default; }
.cmdp-hint { font-size: 0.6rem; color: var(--muted); text-align: center; letter-spacing: 0.06em; margin-top: 0.1rem; }
.cmdp-hint kbd { font-size: 0.55rem; }
#cmdpanel.spectator .cmdp-hint { display: none; }
.cmdp-tip { position: absolute; left: calc(100% + 0.5rem); top: 0; width: 15rem; padding: 0.55rem 0.65rem; border-radius: 0.55rem; background: var(--glass-flat, rgba(10, 15, 22, 0.94));
  border: 1px solid var(--line-2); box-shadow: 0 0.5rem 1.2rem rgba(0, 0, 0, 0.5); pointer-events: none; opacity: 0; transform: translateX(-0.3rem); transition: opacity 0.12s, transform 0.12s; z-index: 6; }
body.hud-modern .cmdp-tip { left: auto; right: calc(100% + 0.5rem); transform: translateX(0.3rem); }
.cmdp-tip.on { opacity: 1; transform: none; }
.cmdp-tip b { display: block; font-size: 0.9rem; letter-spacing: 0.04em; }
.cmdp-tip p { margin: 0.3rem 0 0.35rem; font-size: 0.74rem; line-height: 1.3; color: var(--text-2); }
.cmdp-tt-meta { display: block; font-size: 0.6rem; color: var(--muted); letter-spacing: 0.08em; text-transform: uppercase; margin-top: 0.15rem; }
.cmdp-tt-st { font-size: 0.68rem; font-family: var(--mono); }
.cmdp-tt-st.ok { color: var(--ok); } .cmdp-tt-st.cool { color: var(--warn); } .cmdp-tt-st.lock { color: var(--gold); }
@media (prefers-reduced-motion: reduce) { #cmdpanel.pulse, #cmdpanel.level, .cmdp-pw[data-state="buy"] { animation: none; } }
body.reduce-motion #cmdpanel.pulse, body.reduce-motion #cmdpanel.level, body.reduce-motion .cmdp-pw[data-state="buy"] { animation: none; }
`;
