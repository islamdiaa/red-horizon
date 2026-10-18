/**
 * `?trailer=1`: a ~85 s cut of a staged battle with title cards, for social media. It plays the attract
 * program (attract.ts) with an opening and a closing card, letterboxed, and records it (canvas + the game's
 * audio, recorder.ts) to a WebM the player downloads at the end. Optional: `&tod=day|dusk|night`,
 * `&climate=temperate|winter|desert`, `&autorecord=1` (start at once; needs autoplay permission for sound).
 */
import type { AudioSystem } from '../audio';
import type { Game, GameSetup } from '../game';
import type { Quality, TimeOfDay } from '../render/renderer';
import { ICONS } from '../ui/icons';
import { el } from '../ui/dom';
import { showClipResult } from '../ui/clips';
import { attractSetup, battleProgram, pickBattlefield, stageBattle } from './attract';
import { actionFocus, Director, ease, lerp, type Shot, type TitleCard } from './director';
import { CanvasRecorder, canRecordVideo, paintOverlay } from './recorder';
import { siteUrl } from './links';
import tShare from '../i18n/en/share';
import tCommon from '../i18n/en/common';

export interface TrailerHost {
  audio: AudioSystem;
  /** Create the demo Game for a setup (main.ts: `new Game(setup, audio, …)`). */
  makeGame(setup: GameSetup): Game;
  quality: Quality;
  /** The created game (main.ts keeps it for disposal / debugging). */
  setGame(g: Game | null): void;
  /** Leave the trailer (back to the game's menus). */
  exit(): void;
}

/** The trailer's title cards by shot (in the player's language when the trailer starts). */
function cards(): Record<string, TitleCard> {
  return {
    establish: { at: 'lower', kicker: tShare('trailer.cards.establishKicker'), title: tShare('trailer.cards.establish'), sub: tShare('trailer.cards.establishSub') },
    'soviet-base': { at: 'lower', kicker: tShare('trailer.cards.buildKicker'), title: tShare('trailer.cards.build'), sub: tShare('trailer.cards.buildSub') },
    tesla: { at: 'lower', kicker: tShare('trailer.cards.teslaKicker'), title: tShare('trailer.cards.tesla') },
    clash: { at: 'lower', kicker: tShare('trailer.cards.clashKicker'), title: tShare('trailer.cards.clash') },
    naval: { at: 'lower', kicker: tShare('trailer.cards.navalKicker'), title: tShare('trailer.cards.naval') },
    'allied-base': { at: 'lower', kicker: tShare('trailer.cards.alliedKicker'), title: tShare('trailer.cards.allied') },
    'nuke-launch': { at: 'lower', kicker: tShare('trailer.cards.nukeKicker'), title: tShare('trailer.cards.nuke') },
    aftermath: { at: 'lower', kicker: tShare('trailer.cards.endKicker'), title: tShare('trailer.cards.end') },
  };
}

/** The trailer cut: opening title, the battle program with cards, closing title. */
export function trailerProgram(sea: ReturnType<typeof pickBattlefield>['sea']): Shot[] {
  const site = siteUrl().replace(/^https?:\/\//, '').replace(/\/$/, '');
  const mid = (d: Director) => ({ x: d.world.map.w / 2, y: d.world.map.h / 2 });
  const open: Shot = {
    name: 'title', dur: 6, card: { at: 'center', kicker: tShare('trailer.tagline'), title: 'Red Horizon' },
    begin: (d) => { const m = actionFocus(d.world) ?? mid(d); d.follow.jump(m.x, m.y); return true; },
    pose: (d, t) => ({ x: d.follow.x, y: d.follow.y + lerp(10, 4, ease(t)), dist: lerp(70, 56, ease(t)), yaw: -0.7 + 0.25 * t, blur: 0.1 }),
  };
  const close: Shot = {
    name: 'end', dur: 7, card: { at: 'center', title: 'Red Horizon', sub: site ? tShare('trailer.freeSite', { site }) : tShare('trailer.freeNoInstall') },
    begin: (d) => { const m = actionFocus(d.world) ?? mid(d); d.follow.jump(m.x, m.y); return true; },
    pose: (d, t) => ({ x: d.follow.x, y: d.follow.y, dist: lerp(30, 62, ease(t)), yaw: 0.4 - 0.3 * t, blur: 0.1 }),
  };
  const body = battleProgram({ sea, cards: cards(), pace: 0.95 });
  return [open, ...body, close];
}

const CSS = `
.tr-gate { position: fixed; inset: 0; z-index: 95; display: flex; align-items: center; justify-content: center; background: radial-gradient(ellipse at center, rgba(0,0,0,.35), rgba(0,0,0,.85)); }
.tr-gate .panel { padding: 1.4rem 1.6rem; border-radius: 1rem; max-width: min(34rem, 92vw); text-align: center; }
.tr-gate h2 { margin: 0 0 .4rem; letter-spacing: .2em; text-transform: uppercase; }
.tr-gate p { margin: 0 0 1rem; color: var(--text-2); font-size: .85rem; line-height: 1.45; }
.tr-gate .row { display: flex; gap: .6rem; justify-content: center; flex-wrap: wrap; }
.tr-rec { position: fixed; top: 1.6vh; right: 1.6vw; z-index: 95; font-family: var(--mono, monospace); font-size: .8rem; color: #fff; background: rgba(0,0,0,.55); padding: .35rem .6rem; border-radius: .4rem; }
.tr-rec i { display: inline-block; width: .6rem; height: .6rem; border-radius: 50%; background: #ff3b30; margin-right: .4rem; vertical-align: -.05rem; }
`;

/** Build the trailer battlefield and wait for Play / Record (or start at once with &autorecord=1). */
export function startTrailer(host: TrailerHost, params: URLSearchParams): void {
  if (!document.getElementById('trailer-css')) {
    const st = document.createElement('style');
    st.id = 'trailer-css';
    st.textContent = CSS;
    document.head.appendChild(st);
  }
  const { seed, sea } = pickBattlefield();
  const setup = attractSetup(seed, host.quality);
  const tod = params.get('tod');
  if (tod === 'day' || tod === 'dusk' || tod === 'night') setup.timeOfDay = tod as TimeOfDay;
  else setup.timeOfDay = 'day';
  const climate = params.get('climate');
  setup.climate = climate === 'winter' || climate === 'desert' || climate === 'temperate' ? climate : 'winter';
  const game = host.makeGame(setup);
  stageBattle(game);
  host.setGame(game);
  // hold the first frame (a wide, quiet shot) until the viewer chooses
  game.speed = 0;
  game.gfx.cam.jumpTo(game.world.map.w / 2, game.world.map.h / 2);
  game.gfx.cam.dist = game.gfx.cam.targetDist = 50;
  game.start();
  const go = (record: boolean) => void run(game, host, sea, record);
  if (params.get('autorecord') === '1') { go(canRecordVideo()); return; }
  const gate = el('div', 'tr-gate', `<div class="panel"><h2>${tShare.html('trailer.gateTitle')}</h2>
    <p>${tShare.html(canRecordVideo() ? 'trailer.gateVideo' : 'trailer.gateNoVideo')}</p>
    <div class="row"><button class="btn-primary" data-a="rec" ${canRecordVideo() ? '' : 'disabled'}>${ICONS.download}<span>${tShare.html('trailer.record')}</span></button>
    <button class="btn" data-a="play">${ICONS.play}<span>${tShare.html('trailer.justPlay')}</span></button><button class="btn" data-a="exit">${ICONS.exit}<span>${tCommon.html('menu')}</span></button></div></div>`);
  document.body.appendChild(gate);
  const pick = (record: boolean) => { gate.remove(); go(record); };
  (gate.querySelector('[data-a="rec"]') as HTMLElement).onclick = () => pick(true);
  (gate.querySelector('[data-a="play"]') as HTMLElement).onclick = () => pick(false);
  (gate.querySelector('[data-a="exit"]') as HTMLElement).onclick = () => { gate.remove(); host.exit(); };
}

async function run(game: Game, host: TrailerHost, sea: ReturnType<typeof pickBattlefield>['sea'], record: boolean): Promise<void> {
  // (without a user gesture the audio stays locked: never wait for it for long)
  try { await Promise.race([host.audio.unlock(), new Promise((r) => setTimeout(r, 1500))]); } catch { /* silent */ }
  try { host.audio.startMusic(); host.audio.setMusicIntensity(0.75); } catch { /* no audio */ }
  try { await document.fonts?.load('700 32px Rajdhani'); } catch { /* fallback */ }
  game.speed = 1;
  const dir = new Director(game, trailerProgram(sea), { loop: false, lens: true, letterbox: 1, dip: 0.45 });
  game.cameraDirector = dir;
  let rec: CanvasRecorder | null = null;
  let badge: HTMLElement | null = null;
  if (record) {
    try {
      rec = new CanvasRecorder({ source: game.gfx.renderer.domElement, audio: host.audio.captureStream(), fps: 30, overlay: (ctx, w, h) => paintOverlay(ctx, w, h, dir) });
      rec.start();
      badge = el('div', 'tr-rec', `<i></i>${tShare.html('clip.rec')}`);
      document.body.appendChild(badge);
    } catch (e) {
      console.warn('[trailer] recording unavailable', e);
      rec = null;
    }
  }
  const total = dir.length;
  await new Promise<void>((resolve) => {
    const iv = window.setInterval(() => {
      if (badge && rec) badge.innerHTML = `<i></i>${tShare.html('trailer.recTime', { s: Math.floor(dir.elapsed), total: Math.round(total) })}`;
      if (dir.ended || !document.body.contains(game.gfx.renderer.domElement)) { window.clearInterval(iv); resolve(); }
    }, 250);
  });
  badge?.remove();
  const blob = rec ? await rec.stop().catch(() => null) : null;
  host.audio.releaseCapture();
  (window as unknown as { __trailer?: { blob: Blob | null; ext: string; frames: number } }).__trailer = { blob, ext: rec?.format.ext ?? 'webm', frames: rec?.frames ?? 0 }; // for automated capture
  game.speed = 0;
  if (blob && blob.size) showClipResult(blob, rec!.format.ext, tShare('trailer.label'), rec!.width, rec!.height, () => location.reload(), 'Trailer');
  else {
    const g = el('div', 'tr-gate', `<div class="panel"><h2>${tShare.html('trailer.endTitle')}</h2><p>${tShare.html('trailer.endText')}</p><div class="row"><button class="btn-primary" data-a="exit">${ICONS.play}<span>${tCommon.html('play')}</span></button><button class="btn" data-a="again">${ICONS.restart}<span>${tShare.html('trailer.again')}</span></button></div></div>`);
    document.body.appendChild(g);
    (g.querySelector('[data-a="exit"]') as HTMLElement).onclick = () => { g.remove(); host.exit(); };
    (g.querySelector('[data-a="again"]') as HTMLElement).onclick = () => location.reload();
  }
}
