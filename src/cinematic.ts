import type { Game } from './game';

const OPERATIONS = ['IRON DAWN', 'RED TEMPEST', 'NORTHERN WRATH', 'STEEL CURTAIN', 'SILENT THUNDER', 'BROKEN ARROW', 'CRIMSON TIDE', 'GLASS HAMMER', 'WINTER SUN', 'LONG SHADOW'];
const SECTORS = ['Carpathian Front', 'Baltic Coast', 'Danube Valley', 'Bavarian Highlands', 'Vistula Basin', 'Black Forest', 'Thuringian Gap', 'Silesian Plains', 'Alpine Pass', 'Pomeranian Lakes'];

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
  const op = OPERATIONS[seed % OPERATIONS.length];
  const sector = SECTORS[(seed >> 4) % SECTORS.length];
  const faction = game.local.faction === 'allies' ? 'Allied Expeditionary Force' : 'Red Army Group "Vostok"';
  const h = Math.floor(game.hours), m = Math.floor((game.hours % 1) * 60);
  const clock = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  const text = mk('cine-text', `<div class="op">OPERATION <b>${op}</b></div><div class="rule"></div><div class="line" data-l="1"></div><div class="line" data-l="2"></div>`);
  mk('cine-skip', 'PRESS ANY KEY TO SKIP');
  body.classList.add('cine-active');

  // camera: start high and rotated over the map, sweep down onto the base
  const cam = game.gfx.cam;
  const start = game.world.map.startPositions[0];
  const map = game.world.map;
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
    cam.targetDist = 20;
    if (skipped) cam.flyToPoint(start.x, start.y + 1, 0.6);
    timers.push(window.setTimeout(() => { cam.zoomDamp = 0.0001; cam.yawDamp = 0.001; }, 1500));
    body.classList.remove('cine-on');
    body.classList.remove('cine-active');
    fade.style.opacity = '0';
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
    cam.flyToPoint(start.x, start.y + 1, 4.2);
    cam.targetDist = 22;
  }, 600));
  const l1 = text.querySelector('[data-l="1"]') as HTMLElement;
  const l2 = text.querySelector('[data-l="2"]') as HTMLElement;
  void (async () => {
    await new Promise((r) => timers.push(window.setTimeout(r, 700)));
    await typeInto(l1, `${sector.toUpperCase()}  ·  ${faction.toUpperCase()}`, 38, () => skipped);
    await typeInto(l2, `DAY 1  ·  ${clock} LOCAL  ·  ${game.world.players.length - 1} HOSTILE FORCE${game.world.players.length > 2 ? 'S' : ''} DETECTED`, 38, () => skipped);
    timers.push(window.setTimeout(finish, 1800));
  })();
}
