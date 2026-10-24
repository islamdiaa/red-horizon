/**
 * The share card: a 1200x630 PNG of your empire on the globe with your stats and the challenge link, made on a
 * canvas in the browser. Offered as a download and through the Web Share API with the file (no third-party service).
 */
import type { WorldRun } from '../../conquest/world/state';
import { GAME_TITLE } from '../../config';
import tCommon from '../../i18n/en/common';
import { picto } from '../../meta/art';
import type { WorldApp } from './app';
import { W } from './api';
import { copyToClipboard, shareBase } from '../../share/links';
import { diffName, esc, fmtInt, homelandName, tW } from './view';
import { startRating } from './start';

const CW = 1200, CH = 630;

export function challengeUrl(run: WorldRun): string {
  const frag = (() => { try { return W.encodeWorldLink({ seed: run.seed, home: run.home, size: run.size, difficulty: run.difficulty, faction: run.faction, ironman: run.ironman }); } catch { return `world=${run.seed}&home=${encodeURIComponent(run.home)}`; } })();
  // (the public address on itch.io and desktop builds, as the other share links)
  return `${shareBase() ?? `${location.origin}${location.pathname}`}#${frag}`;
}

function headline(run: WorldRun): string {
  const home = homelandName(run.home);
  return run.status === 'won' ? tW('share.headWon', { home, n: run.turn }) : run.status === 'lost' ? tW('share.headLost', { home, n: run.turn }) : tW('share.headRun', { home, n: run.turn });
}

/** Wrap text into lines that fit `max` px. */
function wrap(g: CanvasRenderingContext2D, text: string, max: number): string[] {
  const words = text.split(/(\s+)/).filter((w) => w.trim());
  const cjk = words.length <= 1 && text.length > 8; // (no spaces: wrap by character)
  const units = cjk ? [...text] : words;
  const lines: string[] = [];
  let cur = '';
  for (const u of units) {
    const next = cur ? (cjk ? cur + u : `${cur} ${u}`) : u;
    if (g.measureText(next).width > max && cur) { lines.push(cur); cur = u; } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

export async function makeCard(app: WorldApp): Promise<HTMLCanvasElement> {
  const run = app.run!;
  try { await Promise.all([document.fonts?.load?.("700 46px 'Rajdhani'"), document.fonts?.load?.("400 20px 'Share Tech Mono'")]); } catch { /* system fonts */ }
  const c = document.createElement('canvas');
  c.width = CW; c.height = CH;
  const g = c.getContext('2d')!;
  // backdrop
  const bg = g.createLinearGradient(0, 0, CW, CH);
  bg.addColorStop(0, '#050b12'); bg.addColorStop(1, '#0f1d2c');
  g.fillStyle = bg; g.fillRect(0, 0, CW, CH);
  for (let k = 0; k < 90; k++) { const x = (k * 9973) % CW, y = (k * 7919) % CH; g.fillStyle = `rgba(255,255,255,${0.15 + ((k * 37) % 50) / 100})`; g.fillRect(x, y, 1.4, 1.4); }
  // the empire on the globe
  const mine = run.territories.filter((t) => t.owner === run.player).map((t) => app.siteOf(t.id));
  const view = app.globe.view;
  app.globe.frameSites(mine.length ? mine : run.territories.map((t) => app.siteOf(t.id)), true);
  const shot = app.globe.capture(620, 620);
  app.globe.flyTo(view.lon, view.lat, view.dist, true);
  g.drawImage(shot, 0, 5);
  const vg = g.createRadialGradient(310, 315, 240, 310, 315, 330);
  vg.addColorStop(0, 'rgba(5,11,18,0)'); vg.addColorStop(1, 'rgba(5,11,18,0.9)');
  g.fillStyle = vg; g.fillRect(0, 0, 640, CH);
  // text column
  const X = 650, MAXW = CW - X - 44;
  const won = run.status === 'won';
  const gold = '#ffd34d', accent = run.faction === 'soviet' ? '#ff6a50' : '#5ab4ff';
  g.textBaseline = 'alphabetic';
  g.fillStyle = gold;
  g.font = "700 20px 'Rajdhani', sans-serif";
  const kick = `${GAME_TITLE.toUpperCase()}  ·  ${tW('title').toUpperCase()}`;
  g.fillText(kick, X, 74);
  g.fillStyle = won ? '#ffe7a3' : '#ffffff';
  g.font = "700 50px 'Rajdhani', sans-serif";
  let lines = wrap(g, headline(run), MAXW);
  if (lines.length > 3) { g.font = "700 40px 'Rajdhani', sans-serif"; lines = wrap(g, headline(run), MAXW).slice(0, 3); }
  const lh = lines.length > 2 ? 44 : 52;
  lines.forEach((l, i) => g.fillText(l, X, 132 + i * lh));
  // stats
  const owned = run.territories.filter((t) => t.owner === run.player);
  const score = (() => { try { return W.worldScore(run).total; } catch { return 0; } })();
  const stats: [string, string][] = [
    [tW('share.stat.territories'), `${owned.length}/${run.territories.length}`],
    [tW('share.stat.troops'), fmtInt(owned.reduce((a, t) => a + t.troops, 0))],
    [tW('share.stat.rivals'), fmtInt(run.stats?.eliminated ?? 0)],
    [tW('share.stat.battles'), fmtInt(run.stats?.battlesWon ?? 0)],
    [tW('share.stat.turns'), fmtInt(run.turn)],
    [tW('share.stat.score'), fmtInt(score)],
  ];
  const top = 132 + lines.length * lh + 20, tw = (MAXW - 20) / 3, th = 78;
  stats.forEach(([label, value], i) => {
    const x = X + (i % 3) * (tw + 10), y = top + Math.floor(i / 3) * (th + 10);
    g.fillStyle = 'rgba(255,255,255,0.05)'; g.strokeStyle = 'rgba(255,255,255,0.12)'; g.lineWidth = 1;
    g.beginPath(); g.roundRect(x, y, tw, th, 10); g.fill(); g.stroke();
    g.fillStyle = '#8a99aa'; g.font = "700 14px 'Rajdhani', sans-serif";
    g.fillText(label.toUpperCase().slice(0, 22), x + 12, y + 24);
    g.fillStyle = '#ffffff'; g.font = "400 32px 'Share Tech Mono', monospace";
    g.fillText(value, x + 12, y + 62);
  });
  // the run: difficulty, size, doctrine
  const y2 = top + 2 * (th + 10) + 30;
  g.fillStyle = accent; g.font = "700 18px 'Rajdhani', sans-serif";
  g.fillText([diffName(run.difficulty), tW(run.size === 'blitz' ? 'setup.blitz' : 'setup.world'), tCommon(run.faction === 'allies' ? 'faction.allies' : 'faction.soviet'), run.ironman ? tW('setup.ironman') : ''].filter(Boolean).join('  ·  ').toUpperCase(), X, y2);
  // a measured hard start is a boast worth printing ("I ruled the world from the hardest start")
  if (startRating(run.home, run.size) === 'hard') {
    const label = `${tW('start.hard')}`.toUpperCase();
    g.font = "700 18px 'Rajdhani', sans-serif";
    const w = g.measureText(label).width + 26;
    g.fillStyle = 'rgba(255,90,70,0.18)'; g.strokeStyle = '#ff8a7a'; g.lineWidth = 1.5;
    g.beginPath(); g.roundRect(X, y2 + 14, w, 30, 15); g.fill(); g.stroke();
    g.fillStyle = '#ffb0a0'; g.fillText(label, X + 13, y2 + 35);
  }
  // the challenge
  g.fillStyle = '#c2d0de'; g.font = "600 18px 'Rajdhani', sans-serif";
  g.fillText(tW('share.cta'), X, CH - 62);
  g.fillStyle = gold; g.font = "400 16px 'Share Tech Mono', monospace";
  let url = challengeUrl(run);
  while (g.measureText(url).width > MAXW && url.length > 20) url = url.slice(0, -2);
  g.fillText(url, X, CH - 36);
  return c;
}

export async function openShare(app: WorldApp) {
  const run = app.run;
  if (!run) return;
  const card = await makeCard(app);
  const blob = await new Promise<Blob | null>((r) => card.toBlob(r, 'image/png'));
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  const file = typeof File === 'function' ? new File([blob], 'red-horizon-world.png', { type: 'image/png' }) : null;
  const canFile = !!file && typeof navigator.canShare === 'function' && (() => { try { return navigator.canShare({ files: [file] }); } catch { return false; } })();
  const m = app.modal(`<div class="wc-kick">${esc(tW('kick'))}</div><h2 class="wc-h1">${esc(tW('share.title'))}</h2>
    <img class="wc-share-img" src="${url}" alt="${esc(headline(run))}">
    <div class="acts"><button class="wc-btn" data-s="link">${esc(tW('share.link'))}</button><button class="wc-btn" data-s="dl">${picto('back')}${esc(tW('share.download'))}</button>${canFile ? `<button class="wc-btn gold pri" data-s="send" data-focus>${picto('globe')}${esc(tW('share.send'))}</button>` : ''}</div>`, 'wide', () => setTimeout(() => URL.revokeObjectURL(url), 1000));
  const download = () => { const a = document.createElement('a'); a.href = url; a.download = 'red-horizon-world.png'; document.body.appendChild(a); a.click(); a.remove(); };
  m.el.querySelector<HTMLElement>('[data-s="dl"]')!.onclick = () => { app.opts.play('click'); download(); };
  m.el.querySelector<HTMLElement>('[data-s="link"]')!.onclick = async () => {
    app.opts.play('click');
    const ok = await copyToClipboard(challengeUrl(run));
    app.toast(tW(ok ? 'setup.copied' : 'setup.copyFailed'), ok ? 'good' : 'bad');
  };
  m.el.querySelector<HTMLElement>('[data-s="send"]')?.addEventListener('click', async () => {
    app.opts.play('click');
    try { await navigator.share({ files: [file!], title: tW('title'), text: `${headline(run)}. ${tW('share.text')}`, url: challengeUrl(run) }); }
    catch (e) { if ((e as Error)?.name !== 'AbortError') { download(); app.toast(tW('share.failed'), 'bad'); } }
  });
}
