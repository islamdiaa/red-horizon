// Soak: a long rendered session in one page, cycles of a skirmish with a ceasefire build-up (2x) and a big battle (5x),
// then the results screen and "Play again" by a real click. The local side is played by the AI (selfplay), so both
// armies grow. Every minute: JS heap (Chromium), browser RSS, renderer geometries / textures / programs, DOM nodes, net
// event listeners, frame time. At the end, the cycle starts are compared: what keeps growing across Play again leaks.
//   tools/lab/lab.sh run <vm> tools/xb/soak.mjs <browser> [minutes=120] [cycles=3] [q=low] [ceasefire=6]
// A cycle that has not ended near its time budget is finished by removing the enemy (a test shortcut).
import { launch, instrument, watch, sample, frameStats, sleep, GAME_URL, OUT, writeJsonl, browserRssMB } from './vmlib.mjs';

const [name = 'chromium', minArg = '120', cycArg = '3', Q = 'low', cfArg = '6'] = process.argv.slice(2);
const W = +(process.env.W ?? 1280), H = +(process.env.H ?? 720);
const file = `soak-${name}${process.env.TAG ?? ''}.jsonl`;
const budget = (+minArg * 60000) / +cycArg;
const T0 = Date.now();
const browser = await launch(name);
const ctx = await browser.newContext({ viewport: { width: W, height: H } });
const page = await ctx.newPage();
const log = watch(page);
await page.addInitScript(instrument);
const url = `${GAME_URL}?autostart=1&intro=0&size=96&units=mcv&fog=1&selfplay=hard&ai=hard&ceasefire=${cfArg}&q=${Q}&seed=21&debug=1`;
writeJsonl(file, { browser: name, version: browser.version(), url, minutes: +minArg, cycles: +cycArg });
await page.goto(url, { waitUntil: 'load', timeout: 300000 });

const running = () => page.waitForFunction(() => window.__game?.running && window.__game.world.tick > 0 && !window.__game.world.gameOver, null, { timeout: 1200000, polling: 2000 });
const point = async (cycle, phase, extra = {}) => {
  const s = await sample(page).catch((e) => ({ err: String(e).slice(0, 120) }));
  const f = await frameStats(page, 2000).catch(() => null);
  writeJsonl(file, { t: Math.round((Date.now() - T0) / 1000), cycle, phase, ...s, frame: f, rss: browserRssMB(name), errors: log.length, ...extra });
  return s;
};
const starts = [];
for (let cycle = 1; cycle <= +cycArg; cycle++) {
  const c0 = Date.now();
  try { await running(); } catch (e) {
    writeJsonl(file, { cycle, fail: 'match not running: ' + String(e).split('\n')[0].slice(0, 200), state: await page.evaluate(() => ({ game: !!window.__game, running: window.__game?.running, tick: window.__game?.world?.tick, loading: document.getElementById('loading')?.style.opacity })).catch(() => null) });
    await page.screenshot({ path: `${OUT}/soak-${name}-stuck-${cycle}.png`, timeout: 120000 }).catch(() => {});
    break;
  }
  // the local AI (selfplay): the URL adds it to the first match only
  await page.evaluate(() => {
    const g = window.__game, w = g.world;
    const AIC = w.ais[0]?.constructor;
    if (AIC && !w.ais.some((a) => a.player === g.local || a.p === g.local)) w.ais.push(new AIC(w, g.local, 'hard'));
    g.speed = 2;
  });
  await sleep(120000);
  starts.push(await point(cycle, 'start'));
  // build-up through the ceasefire at 2x, then the battle at 5x
  let phase = 'build';
  while (Date.now() - c0 < budget - 240000) {
    const s = await point(cycle, phase);
    if (s.over) break;
    if (phase === 'build' && (s.gameT > +cfArg * 60 + 60 || Date.now() - c0 > budget * 0.4)) { phase = 'battle'; await page.evaluate(() => { window.__game.speed = 5; }); }
    await sleep(60000);
  }
  let forced = false;
  // (destroyed buildings release surviving infantry, as in Red Alert: sweep until the match ends)
  for (let k = 0; k < 20 && !(await page.evaluate(() => window.__game.world.gameOver)); k++) {
    forced = true;
    await page.evaluate(() => {
      const g = window.__game, w = g.world;
      for (const e of [...w.units, ...w.buildings]) if (e.alive && e.owner !== g.local && e.owner.team !== g.local.team) w.kill(e, 'normal');
    });
    await sleep(15000);
  }
  await page.evaluate(() => { window.__game.speed = 1; });
  // the results screen, then Play again by a real click
  let again = false;
  try {
    // no element handles: a Playwright handle to the button would keep the old match alive and fake a leak
    await page.waitForFunction(() => !!document.querySelector('.rr-again')?.getClientRects().length, null, { timeout: 300000, polling: 1000 });
    await point(cycle, 'results', { forced });
    await page.screenshot({ path: `${OUT}/soak-${name}-results-${cycle}.png` });
    if (cycle < +cycArg) {
      const r = await page.evaluate(() => { const b = document.querySelector('.rr-again').getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; });
      await page.mouse.click(r[0], r[1]);
      again = true;
    }
  } catch (e) {
    writeJsonl(file, { cycle, fail: 'results/play again: ' + String(e).split('\n')[0].slice(0, 200) });
    await page.screenshot({ path: `${OUT}/soak-${name}-fail-${cycle}.png` });
    if (cycle < +cycArg) { await page.goto(url, { waitUntil: 'load', timeout: 300000 }); }
  }
  writeJsonl(file, { cycle, ended: true, again, forced, minutes: +((Date.now() - c0) / 60000).toFixed(1) });
}
// growth across cycles at the same point (two minutes into each match)
const keys = ['heapMB', 'listeners', 'dom', 'geo', 'tex', 'prog', 'scene', 'views'];
const growth = Object.fromEntries(keys.map((k) => [k, starts.map((s) => s[k])]));
writeJsonl(file, { summary: true, growth, rssEnd: browserRssMB(name), errors: log.slice(0, 15), errorCount: log.length, minutes: +((Date.now() - T0) / 60000).toFixed(1) });
await page.screenshot({ path: `${OUT}/soak-${name}-end.png` });
await browser.close();
