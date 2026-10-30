import { startView } from './maps/start-view';
import type { Game } from './game';
import { esc } from './ui/dom';
import tCine, { CINE_NAMES } from './i18n/en/cinematic';
import { dt, trSource } from './i18n/core';
import { isTouchDevice } from './ui/touch';

const CSS = `
.cine-bar { position: fixed; left: 0; right: 0; height: 11vh; background: #000; z-index: 40; transition: transform 0.9s cubic-bezier(.7,0,.2,1); pointer-events: none; }
.cine-bar.top { top: 0; transform: translateY(-100%); }
.cine-bar.bottom { bottom: 0; transform: translateY(100%); }
.cine-on .cine-bar { transform: none; }
.cine-text { position: fixed; left: 6vw; bottom: 15vh; z-index: 41; font-family: var(--font, sans-serif); color: #e8f0f8; pointer-events: none; text-shadow: 0 2px 18px rgba(0,0,0,0.9); }
.cine-text .op { font-size: clamp(28px, 4vw, 56px); font-weight: 800; letter-spacing: 0.32em; }
.cine-text .op b { color: rgb(var(--accent-rgb, 90,180,255)); font-weight: 800; }
.cine-text .line { font-family: var(--mono, monospace); font-size: clamp(13px, 1.2vw, 17px); letter-spacing: 0.18em; opacity: 0.85; margin-top: 10px; min-height: 1.3em; }
.cine-text .rule { height: 2px; width: 0; background: linear-gradient(90deg, rgb(var(--accent-rgb, 90,180,255)), transparent); margin: 12px 0 4px; transition: width 1.6s ease-out; }
.cine-on .cine-text .rule { width: 34vw; }
.cine-skip { position: fixed; right: 3vw; bottom: 4vh; z-index: 41; font-family: var(--mono, monospace); font-size: 12px; letter-spacing: 0.2em; color: rgba(255,255,255,0.55); pointer-events: none; }
.cine-fade { position: fixed; inset: 0; background: #000; z-index: 39; pointer-events: none; transition: opacity 1.4s ease-out; }
body.cine-active #ui, body.cine-active .overlay-canvas { opacity: 0; pointer-events: none !important; }
body.cine-active #ui > * { pointer-events: none !important; }
#ui, .overlay-canvas { transition: opacity 0.8s ease-out; }
`;

/** Ease the cinematic lens (depth of field 0..1, camera motion blur 0..1) to new values. */
interface LensHost { cinematicDof: number; cinematicBlur: number }
const lensAnims = new WeakMap<LensHost, number>();
function lensTo(gfx: LensHost, dof: number, blur: number, seconds: number) {
  const prev = lensAnims.get(gfx);
  if (prev) cancelAnimationFrame(prev);
  const d0 = gfx.cinematicDof, b0 = gfx.cinematicBlur, t0 = performance.now();
  const step = () => {
    const k = Math.min(1, (performance.now() - t0) / Math.max(1, seconds * 1000));
    const e = k * k * (3 - 2 * k);
    gfx.cinematicDof = d0 + (dof - d0) * e;
    gfx.cinematicBlur = b0 + (blur - b0) * e;
    if (k < 1) lensAnims.set(gfx, requestAnimationFrame(step));
    else lensAnims.delete(gfx);
  };
  step();
}

function typeInto(el: HTMLElement, text: string, cps: number, cancelled: () => boolean): Promise<void> {
  return new Promise((resolve) => {
    let i = 0;
    const step = () => {
      if (cancelled()) { el.textContent = text; resolve(); return; }
      el.textContent = text.slice(0, ++i);
      if (i >= text.length) resolve();
      else setTimeout(step, 1000 / cps);
    };
    step();
  });
}

/**
 * Opening cinematic: letterbox, typed operation briefing, and a camera that sweeps down from
 * high above the battlefield onto the player's base. Any key or click skips it.
 */
export function playIntro(game: Game, onDone: () => void) {
  if (!document.getElementById('cine-style')) {
    const st = document.createElement('style');
    st.id = 'cine-style';
    st.textContent = CSS;
    document.head.appendChild(st);
  }
  const body = document.body;
  const els: HTMLElement[] = [];
  const mk = (cls: string, html = '') => {
    const e = document.createElement('div');
    e.className = cls;
    e.innerHTML = html;
    body.appendChild(e);
    els.push(e);
    return e;
  };
  const fade = mk('cine-fade');
  fade.style.opacity = '1';
  mk('cine-bar top');
  mk('cine-bar bottom');
  const seed = game.setup.seed >>> 0;
  const md = game.missionDef;
  const ops = CINE_NAMES.operations, sectors = CINE_NAMES.sectors;
  const op = md ? trSource(md.codename) : ops[seed % ops.length]; // (mission code names are registered source text)
  const sector = md ? dt('mission', md.id, 'location', trSource(md.location)) : sectors[(seed >> 4) % sectors.length];
  const faction = tCine(game.local.faction === 'allies' ? 'intro.allies' : 'intro.soviet');
  const h = Math.floor(game.hours), m = Math.floor((game.hours % 1) * 60);
  const clock = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  const text = mk('cine-text', `<div class="op">${tCine.html('intro.operation', { name: op })}</div><div class="rule"></div><div class="line" data-l="1"></div><div class="line" data-l="2"></div>`);
  mk('cine-skip', tCine.html(isTouchDevice() ? 'intro.skipTouch' : 'intro.skip')); // (E2E/MOBILE: a tap skips on touch screens)
  body.classList.add('cine-active');

  // camera: start high and rotated over the map, sweep down onto the base
  const cam = game.gfx.cam;
  const start = game.world.map.startPositions[0];
  const map = game.world.map;
  const focus = startView(map, innerWidth, innerHeight); // (a World Conquest battlefield frames its landmark on this viewport; elsewhere the start at 20)
  const oldMax = cam.maxDist;
  cam.maxDist = 75;
  cam.jumpTo(map.w / 2 + (start.x - map.w / 2) * 0.35, map.h / 2 + (start.y - map.h / 2) * 0.35);
  cam.dist = cam.targetDist = 72;
  cam.yaw = cam.targetYaw = -0.55;
  game.paused = true;
  // satellite recon: terrain is revealed during the intro, the shroud rolls back in as we land
  const fogU = game.gfx.fogPass.material.uniforms.uEnabled;
  fogU.value = 0;

  let done = false;
  let skipped = false;
  const timers: number[] = [];
  const finish = () => {
    if (done) return;
    done = true;
    for (const t of timers) clearTimeout(t);
    window.removeEventListener('keydown', skip, true);
    window.removeEventListener('pointerdown', skip, true);
    cam.maxDist = oldMax;
    cam.targetYaw = 0;
    cam.targetDist = focus.dist;
    if (skipped) cam.flyToPoint(focus.x, focus.y, 0.6);
    timers.push(window.setTimeout(() => { cam.zoomDamp = 0.0001; cam.yawDamp = 0.001; }, 1500));
    body.classList.remove('cine-on');
    body.classList.remove('cine-active');
    fade.style.opacity = '0';
    lensTo(game.gfx, 0, 0, 1.4);
    timers.push(window.setTimeout(() => els.forEach((e) => e.remove()), 1200));
    game.resume();
    const t0 = performance.now();
    const rollIn = () => {
      const k = Math.min(1, (performance.now() - t0) / 1800);
      fogU.value = k * k;
      if (k < 1) requestAnimationFrame(rollIn);
    };
    rollIn();
    onDone();
  };
  const skip = (e: Event) => {
    e.stopPropagation();
    if (e instanceof KeyboardEvent) e.preventDefault();
    skipped = true;
    finish();
  };
  window.addEventListener('keydown', skip, true);
  window.addEventListener('pointerdown', skip, true);

  requestAnimationFrame(() => {
    body.classList.add('cine-on');
    fade.style.opacity = '0';
  });
  // the sweep
  timers.push(window.setTimeout(() => {
    if (done) return;
    cam.zoomDamp = 0.25;
    cam.yawDamp = 0.3;
    cam.targetYaw = 0;
    cam.flyToPoint(focus.x, focus.y, 4.2);
    cam.targetDist = Math.max(22, focus.dist + 2);
    // lens: shallow focus on the base below, motion blur through the dive
    lensTo(game.gfx, 0.55, 0.7, 1.0);
  }, 600));
  const l1 = text.querySelector('[data-l="1"]') as HTMLElement;
  const l2 = text.querySelector('[data-l="2"]') as HTMLElement;
  void (async () => {
    await new Promise((r) => timers.push(window.setTimeout(r, 700)));
    await typeInto(l1, `${sector.toUpperCase()}  ·  ${faction.toUpperCase()}`, 38, () => skipped);
    await typeInto(l2, tCine('intro.status', { clock, n: game.world.players.length - 1 }), 38, () => skipped);
    timers.push(window.setTimeout(finish, 1800));
  })();
}

const NUKE_CSS = `
.nuke-warn { position: fixed; top: 22vh; left: 50%; transform: translateX(calc(-50% - var(--sidebar-w, 312px) / 2)); z-index: 30; pointer-events: none; text-align: center;
  font-family: var(--font, sans-serif); color: #fff; animation: nwIn .3s ease-out; }
.nuke-warn .t1 { font-size: clamp(16px, 1.6vw, 22px); letter-spacing: .5em; color: #ffb0a0; }
.nuke-warn .t2 { font-size: clamp(24px, 2.8vw, 44px); font-weight: 800; letter-spacing: .1em; white-space: nowrap; color: #ff4a3a; text-shadow: 0 0 30px rgba(255,60,40,.8); animation: nwBlink .6s steps(2) infinite; }
.nuke-warn .t3 { font-family: var(--mono, monospace); font-size: 22px; margin-top: 6px; letter-spacing: .2em; }
@keyframes nwIn { from { opacity: 0; transform: translateX(calc(-50% - var(--sidebar-w, 312px) / 2)) scale(1.2); } }
@keyframes nwBlink { 50% { opacity: .55; } }
.danger-vignette { position: fixed; inset: 0; z-index: 3; pointer-events: none; box-shadow: inset 0 0 18vw rgba(255,30,10,.55); animation: dvPulse 1s ease-in-out infinite alternate; }
@keyframes dvPulse { from { opacity: .35; } to { opacity: 1; } }
`;

function ensureStyle(id: string, css: string) {
  if (document.getElementById(id)) return;
  const st = document.createElement('style');
  st.id = id;
  st.textContent = css;
  document.head.appendChild(st);
}

/** Warning overlay for an incoming enemy nuke; returns an updater(secondsLeft) and a remover. */
export function nukeWarning(): { update(seconds: number): void; remove(): void } {
  ensureStyle('nuke-style', NUKE_CSS);
  const v = document.createElement('div');
  v.className = 'danger-vignette';
  const w = document.createElement('div');
  w.className = 'nuke-warn';
  w.innerHTML = `<div class="t1">${tCine.html('nuke.warning')}</div><div class="t2">${tCine.html('nuke.detected')}</div><div class="t3"></div>`;
  document.body.append(v, w);
  const t3 = w.querySelector('.t3') as HTMLElement;
  return {
    update(s: number) { t3.textContent = tCine('nuke.impact', { s: Math.max(0, s).toFixed(1) }); },
    remove() { v.remove(); w.remove(); },
  };
}

/**
 * Cinematic for the player's own nuclear strike: letterbox, watch the launch, follow the missile,
 * slow motion at impact. Returns a cancel function. `progress()` gives the missile's flight progress 0..1.
 */
export function nukeCinematic(game: Game, silo: { x: number; y: number }, target: { x: number; y: number }, flight: number, alive: () => boolean): () => void {
  if (!document.getElementById('cine-style')) {
    const st = document.createElement('style');
    st.id = 'cine-style';
    st.textContent = CSS;
    document.head.appendChild(st);
  }
  const body = document.body;
  const bars = [document.createElement('div'), document.createElement('div')];
  bars[0].className = 'cine-bar top';
  bars[1].className = 'cine-bar bottom';
  body.append(...bars);
  requestAnimationFrame(() => body.classList.add('cine-on'));
  const cam = game.gfx.cam;
  const saved = { x: cam.x, y: cam.y, dist: cam.targetDist, speed: game.speed };
  cam.zoomDamp = 0.2;
  cam.flyToPoint(silo.x, silo.y, 0.7);
  cam.targetDist = 18;
  lensTo(game.gfx, 0.45, 0.6, 0.6); // cinematic lens while following the missile
  const timers: number[] = [];
  let done = false;
  // satellite uplink: the strike is watched through a partly lifted fog of war (shroud would show only black)
  const fogU = game.gfx.fogPass.material.uniforms.uEnabled;
  let fogTarget = 0.3;
  const fogTween = () => {
    fogU.value += (fogTarget - fogU.value) * 0.08;
    if (Math.abs(fogTarget - fogU.value) < 0.005) { fogU.value = fogTarget; if (fogTarget === 1) return; }
    requestAnimationFrame(fogTween);
  };
  requestAnimationFrame(fogTween);
  const finish = () => {
    if (done) return;
    done = true;
    timers.forEach(clearTimeout);
    window.removeEventListener('keydown', skip, true);
    body.classList.remove('cine-on');
    timers.push(window.setTimeout(() => bars.forEach((b) => b.remove()), 1000));
    game.speed = saved.speed;
    cam.zoomDamp = 0.0001;
    fogTarget = 1;
    lensTo(game.gfx, 0, 0, 1.0);
  };
  const skip = (e: KeyboardEvent) => { e.preventDefault(); e.stopPropagation(); cam.flyToPoint(target.x, target.y, 0.4); finish(); };
  window.addEventListener('keydown', skip, true);
  // after the launch, follow the arc towards the target
  timers.push(window.setTimeout(() => {
    if (done) return;
    cam.flyToPoint(target.x, target.y, Math.max(1.5, flight * 0.8));
    cam.targetDist = 34;
  }, 1500));
  // slow motion through the impact
  const watch = window.setInterval(() => {
    if (done) { clearInterval(watch); return; }
    if (!alive()) {
      clearInterval(watch);
      game.speed = 0.3;
      cam.targetDist = 26;
      timers.push(window.setTimeout(finish, 2600));
    }
  }, 50);
  return finish;
}

const END_CSS = `
.end-cine { position: fixed; inset: 0; z-index: 38; display: flex; flex-direction: column; align-items: center; justify-content: center; pointer-events: none; font-family: var(--font, sans-serif); }
.end-cine .big { font-size: clamp(56px, 9vw, 140px); font-weight: 800; letter-spacing: .22em; opacity: 0; transform: scale(1.25); transition: all 1.4s cubic-bezier(.2,.8,.2,1); }
.end-cine.win .big { background: linear-gradient(180deg, #fff, #ffe9a8 45%, #ffb43c); -webkit-background-clip: text; background-clip: text; color: transparent; filter: drop-shadow(0 0 40px rgba(255,190,60,.55)); }
.end-cine.lose .big { background: linear-gradient(180deg, #fff, #ffb0a0 45%, #ff3a2a); -webkit-background-clip: text; background-clip: text; color: transparent; filter: drop-shadow(0 0 40px rgba(255,60,40,.6)); }
.end-cine .sub { margin-top: 10px; font-size: clamp(14px, 1.3vw, 20px); letter-spacing: .5em; color: #dfe8f2; opacity: 0; transition: opacity 1.2s .6s; text-shadow: 0 2px 12px #000; }
.end-cine.on .big { opacity: 1; transform: none; }
.end-cine.on .sub { opacity: .9; }
`;

/** Slow-motion finale overlay: letterbox + VICTORY / DEFEAT title. Returns a remover. */
export function endingCinematic(won: boolean, subtitle: string, gfx?: LensHost): () => void {
  ensureStyle('cine-style', CSS);
  ensureStyle('end-style', END_CSS);
  const body = document.body;
  const bars = [document.createElement('div'), document.createElement('div')];
  bars[0].className = 'cine-bar top';
  bars[1].className = 'cine-bar bottom';
  const t = document.createElement('div');
  t.className = 'end-cine ' + (won ? 'win' : 'lose');
  t.innerHTML = `<div class="big">${tCine.html(won ? 'end.victory' : 'end.defeat')}</div><div class="sub">${esc(subtitle.toUpperCase())}</div>`;
  body.append(...bars, t);
  body.classList.add('cine-active');
  requestAnimationFrame(() => { body.classList.add('cine-on'); t.classList.add('on'); });
  if (gfx) lensTo(gfx, 0.65, 0.25, 2.0); // slow-motion finale through a shallow lens
  return () => {
    if (gfx) lensTo(gfx, 0, 0, 0.8);
    body.classList.remove('cine-on', 'cine-active');
    t.remove();
    setTimeout(() => bars.forEach((b) => b.remove()), 900);
  };
}
