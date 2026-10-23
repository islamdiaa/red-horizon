// soak.mjs in segments, for a machine shared with other heavy jobs: the same long session in one page (cycles of a
// ceasefire build-up at 2x, a battle at 5x, the results screen and Play again by a real click, every minute a sample of
// memory, renderer resources, DOM nodes, listeners and frame time), but it runs only while the host driver holds the
// shared lock. Between segments the page idles: the game's per-frame work is switched off (the animation-frame loop
// keeps ticking with nothing to do, so the simulation stands still and the GPU is idle) until the driver starts the next
// segment. Active time excludes the idle gaps. The cycle starts compare what keeps growing across Play again (leaks).
//
//   node tools/xb/soakseg.mjs <browser> [activeMinutes=60] [cycles=3] [segmentMinutes=12.5] [q=low]
// Control files in OUT_DIR/ctl: the driver (tools/xb/soakseg.sh) creates go-<n> to start segment n; the script
// writes done-<n> when segment n is spent (and the page idles), and end when the soak is over.
import fs from 'node:fs';
import { launch, instrument, watch, sample, frameStats, sleep, GAME_URL, OUT, writeJsonl, browserRssMB } from './vmlib.mjs';

const [name = 'firefox', minArg = '60', cycArg = '3', segArg = '12.5', Q = 'low'] = process.argv.slice(2);
const W = +(process.env.W ?? 1280), H = +(process.env.H ?? 720);
const file = `soakseg-${name}${process.env.TAG ?? ''}.jsonl`;
const CTL = `${OUT}/ctl`;
fs.mkdirSync(CTL, { recursive: true });
const budget = (+minArg * 60000) / +cycArg;
const segMs = +segArg * 60000;

// ---- the active clock and the segment gate
let seg = 0, segStart = 0, idleMs = 0, page = null;
const active = () => Date.now() - T0 - idleMs;
async function waitGo(n) {
  for (;;) { if (fs.existsSync(`${CTL}/go-${n}`)) return; await sleep(3000); }
}
async function gate() {
  if (Date.now() - segStart < segMs) return;
  // segment spent: idle the page, hand the lock back, wait for the next segment
  const t = Date.now();
  await page.evaluate(() => { const g = window.__game; if (g) { g.frame = () => {}; } }).catch(() => {});
  writeJsonl(file, { seg, idleFrom: Math.round(active() / 1000) });
  fs.writeFileSync(`${CTL}/done-${seg}`, String(Date.now()));
  seg++;
  await waitGo(seg);
  await page.evaluate(() => { const g = window.__game; if (g) { delete g.frame; g.last = performance.now(); } }).catch(() => {});
  idleMs += Date.now() - t;
  segStart = Date.now();
  writeJsonl(file, { seg, resumed: true, idleS: Math.round((Date.now() - t) / 1000) });
}
/** Wait `ms` of active time, passing the gate every few seconds. */
async function work(ms) {
  const end = active() + ms;
  while (active() < end) { await gate(); await sleep(Math.min(3000, Math.max(50, end - active()))); }
}

await waitGo(0);
const T0 = Date.now();
segStart = Date.now();
const browser = await launch(name);
const ctx = await browser.newContext({ viewport: { width: W, height: H } });
page = await ctx.newPage();
const log = watch(page);
await page.addInitScript(instrument);
const url = `${GAME_URL}?autostart=1&intro=0&size=96&units=mcv&fog=1&selfplay=hard&ai=hard&ceasefire=6&q=${Q}&seed=21&debug=1`;
writeJsonl(file, { browser: name, version: browser.version(), url, activeMinutes: +minArg, cycles: +cycArg, segmentMinutes: +segArg });
await page.goto(url, { waitUntil: 'load', timeout: 300000 });

const running = async () => {
  for (let k = 0; k < 400; k++) {
    if (await page.evaluate(() => !!(window.__game?.running && window.__game.world.tick > 0 && !window.__game.world.gameOver)).catch(() => false)) return true;
    await work(3000);
  }
  return false;
};
const point = async (cycle, phase, extra = {}) => {
  const s = await sample(page).catch((e) => ({ err: String(e).slice(0, 120) }));
  const f = await frameStats(page, 2000).catch(() => null);
  writeJsonl(file, { t: Math.round(active() / 1000), seg, cycle, phase, ...s, frame: f, rss: browserRssMB(name), errors: log.length, ...extra });
  return s;
};
const starts = [];
for (let cycle = 1; cycle <= +cycArg; cycle++) {
  const c0 = active();
  if (!await running()) {
    writeJsonl(file, { cycle, fail: 'match not running', state: await page.evaluate(() => ({ game: !!window.__game, running: window.__game?.running, tick: window.__game?.world?.tick })).catch(() => null) });
    await page.screenshot({ path: `${OUT}/soakseg-${name}-stuck-${cycle}.png`, timeout: 120000 }).catch(() => {});
    break;
  }
  await page.evaluate(() => {
    const g = window.__game, w = g.world;
    const AIC = w.ais[0]?.constructor;
    if (AIC && !w.ais.some((a) => a.player === g.local || a.p === g.local)) w.ais.push(new AIC(w, g.local, 'hard'));
    g.speed = 2;
  });
  await work(120000);
  starts.push(await point(cycle, 'start'));
  let phase = 'build';
  while (active() - c0 < budget - 240000) {
    const s = await point(cycle, phase);
    if (s.over) break;
    if (phase === 'build' && (s.gameT > 6 * 60 + 60 || active() - c0 > budget * 0.4)) { phase = 'battle'; await page.evaluate(() => { window.__game.speed = 5; }); }
    await work(60000);
  }
  let forced = false;
  for (let k = 0; k < 20 && !(await page.evaluate(() => window.__game.world.gameOver)); k++) {
    forced = true;
    await page.evaluate(() => {
      const g = window.__game, w = g.world;
      for (const e of [...w.units, ...w.buildings]) if (e.alive && e.owner !== g.local && e.owner.team !== g.local.team) w.kill(e, 'normal');
    });
    await work(15000);
  }
  await page.evaluate(() => { window.__game.speed = 1; });
  let again = false;
  try {
    for (let k = 0; k < 100 && !(await page.evaluate(() => !!document.querySelector('.rr-again')?.getClientRects().length)); k++) await work(3000);
    await point(cycle, 'results', { forced });
    await page.screenshot({ path: `${OUT}/soakseg-${name}-results-${cycle}.png`, timeout: 120000 });
    if (cycle < +cycArg) {
      const r = await page.evaluate(() => { const b = document.querySelector('.rr-again').getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; });
      await page.mouse.click(r[0], r[1]);
      again = true;
    }
  } catch (e) {
    writeJsonl(file, { cycle, fail: 'results/play again: ' + String(e).split('\n')[0].slice(0, 200) });
    if (cycle < +cycArg) await page.goto(url, { waitUntil: 'load', timeout: 300000 });
  }
  writeJsonl(file, { cycle, ended: true, again, forced, activeMin: +((active() - c0) / 60000).toFixed(1) });
}
const keys = ['listeners', 'dom', 'geo', 'tex', 'prog', 'scene', 'views', 'heapMB'];
const growth = Object.fromEntries(keys.map((k) => [k, starts.map((s) => s[k])]));
writeJsonl(file, { summary: true, growth, rssEnd: browserRssMB(name), errors: log.slice(0, 15), errorCount: log.length, activeMin: +(active() / 60000).toFixed(1), segments: seg + 1 });
await page.screenshot({ path: `${OUT}/soakseg-${name}-end.png`, timeout: 120000 }).catch(() => {});
await browser.close();
fs.writeFileSync(`${CTL}/end`, String(Date.now()));
process.exit(0);
