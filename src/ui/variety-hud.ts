/**
 * [VARIETY] In-match presentation of the variety systems (reads World.variety only; never changes the sim except
 * through Game.issue):
 *  - a status strip: rules, active mutators (tooltip), dynamic difficulty level (transparent: always shown when on)
 *  - battlefield event radio cards (title, briefing, countdown; "Hire" for mercenary offers), mirrored in the
 *    event log, with a minimap ping and a sound
 *  - markers on the terrain: event zones (airdrop, pilot, ore surge, convoy exit) and rings around the neutral
 *    tech structures nobody holds yet
 *  - the storm front: the renderer's storm weather while aircraft are grounded
 */
import * as THREE from 'three';
import type { Game } from '../game';
import { picto } from '../meta';
import { MUTATOR_BY_ID, normaliseMutators } from '../modes/mutators';
import { dynamicStatus, type BattleEvent, type NewsItem, type VarietyState } from '../sim/events';
import { TICK_HZ } from '../sim/types';
import type { WeatherKind } from '../render/weather';
import { el, esc } from './dom';
import { ICONS } from './icons';

const CSS = `
.vr-strip { position: absolute; z-index: 6; top: calc(var(--edge) + 3.3rem); left: 50%; transform: translateX(-50%); display: flex; flex-wrap: wrap; justify-content: center; gap: .3rem; max-width: 40rem; pointer-events: auto;
  font-family: var(--font); transition: opacity .3s; }
body.vr-koth .vr-strip { top: calc(var(--edge) + 8.6rem); }
body.vr-koth .vr-radio { top: calc(var(--edge) + 10.6rem); }
body.cine-active .vr-strip, body.cine-active .vr-radio { opacity: 0; pointer-events: none; }
.vr-pill { display: inline-flex; align-items: center; gap: .35rem; height: 1.6rem; padding: 0 .55rem; border-radius: .45rem; background: rgba(8,12,18,.78); border: 1px solid var(--line-2);
  color: var(--text-2); font-size: .72rem; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); cursor: default; }
.vr-pill svg { font-size: .9rem; color: var(--accent); }
.vr-pill.dyn.up { border-color: rgba(var(--danger-rgb), .6); color: #ffc0b8; }
.vr-pill.dyn.down { border-color: rgba(var(--ok-rgb), .55); color: #b8ffd6; }
.vr-pill.ev { border-color: rgba(var(--warn-rgb), .6); color: #ffe2b0; }
.vr-pill.ev svg { color: var(--warn); }
.vr-radio { position: absolute; z-index: 7; top: calc(var(--edge) + 5.4rem); left: 50%; transform: translateX(-50%); width: min(25rem, 44vw); display: flex; flex-direction: column; gap: .4rem; pointer-events: none; font-family: var(--font); }
.vr-card2 { pointer-events: auto; position: relative; padding: .6rem .75rem .65rem .8rem; border-radius: .65rem; background: linear-gradient(180deg, rgba(20,28,39,.94), rgba(8,12,18,.94));
  border: 1px solid rgba(var(--warn-rgb), .5); box-shadow: 0 0 1.4rem rgba(var(--warn-rgb), .16), 0 .6rem 1.6rem rgba(0,0,0,.5); color: var(--text); animation: vrIn .45s var(--spring) both; overflow: hidden; }
.vr-card2.reward { border-color: rgba(var(--ok-rgb), .55); box-shadow: 0 0 1.4rem rgba(var(--ok-rgb), .14), 0 .6rem 1.6rem rgba(0,0,0,.5); }
.vr-card2.site { border-color: rgba(var(--accent-rgb), .5); }
.vr-card2.leaving { animation: vrOut .35s var(--ease) forwards; }
@keyframes vrIn { from { opacity: 0; transform: translateY(-.8rem) scale(.97); } }
@keyframes vrOut { to { opacity: 0; transform: translateY(-.6rem); } }
.vr-card2 .vr-k { display: flex; align-items: center; gap: .4rem; font-size: .62rem; font-weight: 700; letter-spacing: .3em; text-transform: uppercase; color: var(--warn); }
.vr-card2.reward .vr-k { color: var(--ok); }
.vr-card2.site .vr-k { color: var(--accent); }
.vr-card2 .vr-k svg { font-size: .85rem; }
.vr-card2 .vr-k .vr-live { width: .45rem; height: .45rem; border-radius: 50%; background: currentColor; box-shadow: 0 0 .5rem currentColor; animation: vrBlink 1s steps(2) infinite; }
@keyframes vrBlink { 50% { opacity: .2; } }
.vr-card2 h4 { margin: .15rem 0 .2rem; font-size: 1.02rem; letter-spacing: .1em; text-transform: uppercase; color: #fff; }
.vr-card2 p { margin: 0; font-size: .8rem; line-height: 1.35; color: var(--text-2); }
.vr-card2 .vr-act { display: flex; gap: .4rem; margin-top: .5rem; align-items: center; }
.vr-card2 .vr-act button { height: 1.9rem; padding: 0 .8rem; border-radius: .45rem; border: 1px solid rgba(var(--warn-rgb), .7); background: rgba(var(--warn-rgb), .2); color: #fff;
  font: 700 .74rem var(--font); letter-spacing: .14em; text-transform: uppercase; cursor: pointer; }
.vr-card2 .vr-act button:hover { background: rgba(var(--warn-rgb), .35); }
.vr-card2 .vr-act button:disabled { opacity: .45; cursor: default; }
.vr-card2 .vr-act small { color: var(--muted); font-size: .72rem; }
.vr-card2 .vr-bar { position: absolute; left: 0; bottom: 0; height: 2px; background: var(--warn); opacity: .7; transform-origin: left; }
.vr-card2 .vr-x { position: absolute; right: .35rem; top: .3rem; border: 0; background: transparent; color: var(--muted); cursor: pointer; font-size: .9rem; padding: .1rem; }
@media (prefers-reduced-motion: reduce) { .vr-card2, .vr-card2.leaving { animation: none; } .vr-live { animation: none !important; } }
body.reduce-motion .vr-card2, body.reduce-motion .vr-card2.leaving { animation: none; }
`;
let cssDone = false;
function ensureCss() {
  if (cssDone) return;
  cssDone = true;
  const s = document.createElement('style');
  s.id = 'variety-hud-css';
  s.textContent = CSS;
  document.head.appendChild(s);
}

const KIND_ICON: Record<string, string> = { convoy: 'tank', airdrop: 'crate', pilot: 'parachute', storm: 'storm', mercs: 'money', surge: 'ore' };
const SEG = 64;

interface Marker { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; key: string; x: number; y: number; r: number; color: number; seen: number }

/** Unit ring geometry (radius 1, flat): scaled per marker. */
let ringGeo: THREE.BufferGeometry | null = null;
function ringGeometry(): THREE.BufferGeometry {
  if (ringGeo) return ringGeo;
  const pos: number[] = [], idx: number[] = [];
  for (let k = 0; k <= SEG; k++) {
    const a = (k / SEG) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    pos.push(c * 0.94, 0, s * 0.94, c, 0, s);
    if (k < SEG) { const b = k * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
  }
  ringGeo = new THREE.BufferGeometry();
  ringGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  ringGeo.setIndex(idx);
  return ringGeo;
}

export class VarietyHud {
  private strip: HTMLElement;
  private radio: HTMLElement;
  private seenNews = 0;
  private timer = 0;
  private raf = 0;
  private markers = new Map<string, Marker>();
  private group = new THREE.Group();
  private stripKey = '';
  private cards: { el: HTMLElement; until: number; event?: number; bar?: HTMLElement; life: number }[] = [];
  private stormWas: WeatherKind | null = null;
  private disposed = false;

  constructor(private game: Game) {
    ensureCss();
    const ui = document.getElementById('ui') ?? document.body;
    this.strip = el('div', 'vr-strip');
    this.radio = el('div', 'vr-radio');
    ui.append(this.strip, this.radio);
    document.body.classList.toggle('vr-koth', !!game.world.mission?.flags.koth);
    game.gfx.scene.add(this.group);
    // old news (a loaded game) is not announced again
    this.seenNews = this.state()?.newsSeq ?? 0;
    this.timer = window.setInterval(() => this.tick(), 200);
    const anim = () => { if (this.disposed) return; this.raf = requestAnimationFrame(anim); this.animate(); };
    this.raf = requestAnimationFrame(anim);
    this.tick();
  }

  private state(): VarietyState | null {
    return this.game.world.variety;
  }

  private tick() {
    const v = this.state();
    if (!v) { this.strip.innerHTML = ''; return; }
    this.renderStrip(v);
    for (const n of v.news) {
      if (n.seq <= this.seenNews) continue;
      this.seenNews = n.seq;
      this.announce(v, n);
    }
    this.updateCards(v);
    this.updateMarkers(v);
    this.updateStorm(v);
  }

  private renderStrip(v: VarietyState) {
    const dyn = dynamicStatus(this.game.world);
    const live = v.active.filter((e) => e.phase === 'live' || e.phase === 'warn');
    const ids = normaliseMutators(v.mutators);
    const key = `${v.rules}|${ids.join(',')}|${dyn.on ? dyn.level : 'x'}|${live.map((e) => e.kind + e.phase).join(',')}`;
    if (key === this.stripKey) return;
    this.stripKey = key;
    const pills: string[] = [];
    if (v.rules === 'commander') pills.push(`<span class="vr-pill" title="Commander rules: doctrines, commander powers${v.events ? ', battlefield events' : ''} and neutral tech structures (capture them with an Engineer).">${picto('chevrons', 'ic')}Commander</span>`);
    for (const id of ids) {
      const m = MUTATOR_BY_ID[id];
      pills.push(`<span class="vr-pill" title="${esc(m.name)}: ${esc(m.desc)}">${picto(m.icon, 'ic')}${esc(m.name)}</span>`);
    }
    if (dyn.on) {
      const cls = dyn.level > 0 ? ' up' : dyn.level < 0 ? ' down' : '';
      const txt = dyn.level ? `AI ${dyn.pct > 0 ? '+' : ''}${dyn.pct}%` : 'even';
      pills.push(`<span class="vr-pill dyn${cls}" title="Dynamic difficulty is on: the AI's income, build speed and aggression flex (up to ±24%) to keep the match close. ${dyn.level > 0 ? 'You are ahead: the AI is pushing harder.' : dyn.level < 0 ? 'The AI is easing off.' : 'The match is even.'}">${picto('chart', 'ic')}Dynamic · ${txt}</span>`);
    }
    for (const e of live) {
      const label = e.kind === 'convoy' ? 'Convoy' : e.kind === 'airdrop' ? 'Airdrop' : e.kind === 'pilot' ? 'Pilot down' : e.kind === 'storm' ? 'Storm' : e.kind === 'mercs' ? 'Mercenaries' : 'Ore surge';
      pills.push(`<span class="vr-pill ev">${picto(KIND_ICON[e.kind] ?? 'flag', 'ic')}${label}${e.phase === 'warn' ? ' · inbound' : ''}</span>`);
    }
    this.strip.innerHTML = pills.join('');
  }

  private announce(v: VarietyState, n: NewsItem) {
    const g = this.game;
    const me = g.local.id;
    // rewards and captures concern their commander; the rest goes out to everyone
    if (n.player >= 0 && n.player !== me && n.phase === 'reward') {
      g.hud?.message(`${n.title}: ${n.text}`);
      return;
    }
    const ev = n.event ? v.active.find((e) => e.id === n.event) : undefined;
    const kind = n.kind === 'site' ? 'site' : n.phase === 'reward' ? 'reward' : 'event';
    const card = el('div', `vr-card2 ${kind}`);
    const icon = n.kind === 'site' ? picto('capture', 'ic') : n.kind === 'dyn' ? picto('chart', 'ic') : picto(ev ? KIND_ICON[ev.kind] ?? 'flag' : 'flag', 'ic');
    const kicker = n.kind === 'site' ? 'Tech structure' : n.kind === 'dyn' ? 'Dynamic difficulty' : n.phase === 'reward' ? 'Reward' : 'Battlefield event';
    card.innerHTML = `<div class="vr-k">${n.phase === 'warn' || n.phase === 'offer' ? '<i class="vr-live"></i>' : icon}<span>${kicker}</span></div><h4>${esc(n.title)}</h4><p>${esc(n.text)}</p>`;
    const x = el('button', 'vr-x', ICONS.close);
    x.title = 'Dismiss';
    card.appendChild(x);
    let life = n.phase === 'warn' ? 12 : n.phase === 'offer' ? 60 : 8;
    let bar: HTMLElement | undefined;
    if (ev && ev.kind === 'mercs' && n.phase === 'offer' && !g.setup.replay && g.input) {
      const act = el('div', 'vr-act');
      const btn = el('button', '', `Hire · $${(ev.price ?? 0).toLocaleString('en-US')}`) as HTMLButtonElement;
      const note = el('small', '');
      btn.onclick = () => {
        if (g.local.credits < (ev.price ?? 0)) { note.textContent = 'Not enough credits'; g.audio.play('error'); return; }
        g.issue({ c: 'battleEvent', player: me, event: ev.id, act: 'hire' });
        btn.disabled = true;
        note.textContent = 'Squad inbound';
        g.audio.play('click');
      };
      act.append(btn, note);
      card.appendChild(act);
      life = Math.max(1, (ev.until - g.world.tick) / TICK_HZ);
    }
    bar = el('i', 'vr-bar');
    card.appendChild(bar);
    const entry = { el: card, until: performance.now() + life * 1000, event: ev?.id, bar, life };
    x.onclick = () => this.dismiss(entry);
    this.radio.prepend(card);
    this.cards.unshift(entry);
    if (this.cards.length > 3) this.dismiss(this.cards[this.cards.length - 1]);
    // minimap ping and sound (the card is the announcement: no duplicate toast)
    if (n.x >= 0 && n.y >= 0) g.hud?.minimap.ping(n.x, n.y, n.kind === 'site' ? '#5ab4ff' : n.phase === 'reward' ? '#4dff9a' : '#ffb43c');
    if (n.phase === 'warn' || n.phase === 'offer' || n.phase === 'start') g.audio.play('ready_ping');
    else if (n.phase === 'reward' && n.player === me) g.audio.play('cash_tick');
  }

  private dismiss(c: { el: HTMLElement }) {
    const i = this.cards.indexOf(c as never);
    if (i >= 0) this.cards.splice(i, 1);
    c.el.classList.add('leaving');
    setTimeout(() => c.el.remove(), 380);
  }

  private updateCards(v: VarietyState) {
    const now = performance.now();
    for (const c of [...this.cards]) {
      // an offer card closes with its offer
      if (c.event && !v.active.some((e) => e.id === c.event)) { this.dismiss(c); continue; }
      if (now >= c.until) { this.dismiss(c); continue; }
      if (c.bar) c.bar.style.transform = `scaleX(${Math.max(0, (c.until - now) / (c.life * 1000)).toFixed(3)})`;
    }
  }

  /** Rings: event zones and the convoy's exit, and the unclaimed tech structures. */
  private updateMarkers(v: VarietyState) {
    const w = this.game.world;
    const stamp = performance.now();
    const want = (key: string, x: number, y: number, r: number, color: number) => {
      let m = this.markers.get(key);
      if (!m) {
        const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4 });
        const mesh = new THREE.Mesh(ringGeometry(), mat);
        mesh.renderOrder = 5;
        this.group.add(mesh);
        m = { mesh, mat, key, x, y, r, color, seen: stamp };
        this.markers.set(key, m);
      }
      m.x = x; m.y = y; m.r = r; m.seen = stamp;
    };
    for (const e of v.active) this.eventMarkers(e, want);
    for (const b of w.buildings) {
      if (!b.alive || !b.bt.tech || b.owner.id >= 0) continue;
      if (!this.game.local.explored[w.map.idx(Math.floor(b.x), Math.floor(b.y))]) continue;
      want(`t${b.id}`, b.x, b.y, Math.max(b.w, b.h) * 0.85, 0xdfe6ee);
    }
    for (const [k, m] of this.markers) {
      if (m.seen === stamp) continue;
      this.group.remove(m.mesh);
      m.mat.dispose();
      this.markers.delete(k);
    }
  }

  private eventMarkers(e: BattleEvent, want: (key: string, x: number, y: number, r: number, color: number) => void) {
    const w = this.game.world;
    if (e.kind === 'airdrop' || e.kind === 'surge') want(`e${e.id}`, e.x, e.y, e.r, 0xffb43c);
    else if (e.kind === 'pilot' && e.phase === 'live' && e.pilot) {
      const u = w.entities.get(e.pilot);
      if (u?.alive) want(`e${e.id}`, u.x, u.y, 1.3, 0x4dff9a);
    } else if (e.kind === 'pilot') want(`e${e.id}`, e.x, e.y, 2, 0x4dff9a);
    else if (e.kind === 'convoy' && e.route) {
      const [sx, sy] = e.route[0], [ex, ey] = e.route[e.route.length - 1];
      if (e.phase === 'warn') want(`e${e.id}s`, sx, sy, 2.5, 0xffb43c);
      want(`e${e.id}x`, ex, ey, 2.5, 0x4dff9a);
      for (const id of e.trucks ?? []) {
        const u = w.entities.get(id);
        if (u?.alive) want(`u${id}`, u.x, u.y, 0.75, 0xffb43c);
      }
    }
  }

  private animate() {
    if (!this.markers.size) return;
    const t = performance.now() / 1000;
    const map = this.game.world.map;
    const fog = this.game.gfx.fog;
    const calm = document.body.classList.contains('reduce-motion');
    for (const m of this.markers.values()) {
      const pulse = calm ? 1 : 1 + Math.sin(t * 3 + m.x) * 0.06;
      m.mesh.position.set(m.x, map.surfaceAt(m.x, m.y) + 0.08, m.y);
      m.mesh.scale.setScalar(m.r * pulse);
      const vis = fog.enabled ? Math.max(0.25, fog.visibilityAt(m.x, m.y)) : 1;
      m.mat.opacity = (calm ? 0.65 : 0.5 + 0.25 * Math.sin(t * 4 + m.y)) * vis;
    }
  }

  /** The storm front event: the existing storm weather while it lasts. */
  private updateStorm(v: VarietyState) {
    const wx = this.game.gfx.weather;
    const storm = v.storm > this.game.world.tick;
    if (storm && this.stormWas === null) {
      this.stormWas = wx.kind;
      if (wx.kind !== 'storm') wx.set('storm', 6);
    } else if (!storm && this.stormWas !== null) {
      if (this.stormWas !== 'storm') wx.set(this.stormWas, 10);
      this.stormWas = null;
    }
  }

  dispose() {
    this.disposed = true;
    window.clearInterval(this.timer);
    cancelAnimationFrame(this.raf);
    this.strip.remove();
    this.radio.remove();
    document.body.classList.remove('vr-koth');
    for (const m of this.markers.values()) m.mat.dispose();
    this.markers.clear();
    this.group.removeFromParent();
  }
}

/** Mount the variety HUD on a match (no-op without variety state or for the menu backdrop). */
export function attachVariety(game: Game): void {
  if (game.setup.demo || !game.world.variety) return;
  game.attachments.push(new VarietyHud(game));
}
