// Does "Play again" release the previous match? Live instances of the match's main classes (Game, World, HUD,
// renderer, ...) after a forced garbage collection, counted through the DevTools protocol (Chromium browsers only):
//   tools/lab/lab.sh run ubuntu tools/xb/leakcheck.mjs [chromium|chrome|msedge] [matches=4]
// Every count must stay at its first-match value (the baseline; a match has two WebGLRenderer instances). The page is
// driven without element handles and the protocol's remote objects are released, since either would keep old
// matches alive by itself. Writes leakcheck.jsonl; exits 3 when a count grows.
import { launch, sleep, GAME_URL, writeJsonl } from './vmlib.mjs';
const [name = 'chromium', matchesArg = '4'] = process.argv.slice(2);
const b = await launch(name);
const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
const cdp = await page.context().newCDPSession(page);
await cdp.send('Runtime.enable');
await page.goto(GAME_URL + '?autostart=1&intro=0&size=64&fog=0&q=low&debug=1&seed=5', { waitUntil: 'load', timeout: 300000 });
const running = () => page.waitForFunction(() => window.__game?.running && window.__game.world.tick > 20 && !window.__game.world.gameOver, null, { timeout: 600000, polling: 1000 });
const count = async () => {
  for (let i = 0; i < 3; i++) { await cdp.send('HeapProfiler.collectGarbage'); await sleep(300); }
  const out = {};
  for (const [label, expr] of Object.entries({ Game: 'window.__game', World: 'window.__game.world', Hud: 'window.__game.hud', Gfx: 'window.__game.gfx', WebGLRenderer: 'window.__game.gfx.renderer', Entities: 'window.__game.ents', Input: 'window.__game.input', Effects: 'window.__game.effects', Minimap: 'window.__game.hud.minimap' })) {
    try {
      const { result } = await cdp.send('Runtime.evaluate', { expression: `Object.getPrototypeOf(${expr})`, objectGroup: 'xb' });
      if (!result.objectId) { out[label] = 'n/a'; continue; }
      const q = await cdp.send('Runtime.queryObjects', { prototypeObjectId: result.objectId, objectGroup: 'xb' });
      const { result: len } = await cdp.send('Runtime.callFunctionOn', { objectId: q.objects.objectId, functionDeclaration: 'function () { return this.length; }', returnByValue: true });
      out[label] = len.value;
    } catch (e) { out[label] = 'err ' + String(e).slice(0, 60); }
  }
  // (the remote objects above would themselves keep every instance alive)
  await cdp.send('Runtime.releaseObjectGroup', { objectGroup: 'xb' });
  out.heapMB = await page.evaluate(() => Math.round(performance.memory.usedJSHeapSize / 1048576));
  out.canvases = await page.evaluate(() => document.querySelectorAll('canvas').length);
  out.dom = await page.evaluate(() => document.getElementsByTagName('*').length);
  return out;
};
const rows = [];
for (let cycle = 1; cycle <= +matchesArg; cycle++) {
  await running();
  await sleep(6000);
  const c = await count();
  rows.push(c);
  writeJsonl('leakcheck.jsonl', { cycle, ...c });
  if (cycle === +matchesArg) break;
  for (let k = 0; k < 20 && !(await page.evaluate(() => window.__game.world.gameOver)); k++) {
    await page.evaluate(() => { const g = window.__game, w = g.world; for (const e of [...w.units, ...w.buildings]) if (e.alive && e.owner !== g.local && e.owner.team !== g.local.team) w.kill(e, 'normal'); });
    await sleep(8000);
  }
  // no element handles (a Playwright handle to the button would itself keep the old match alive)
  await page.waitForFunction(() => !!document.querySelector('.rr-again')?.getClientRects().length, null, { timeout: 300000, polling: 500 });
  const r = await page.evaluate(() => { const b = document.querySelector('.rr-again').getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; });
  await page.mouse.click(r[0], r[1]);
  await sleep(3000);
}
await b.close();
const grew = Object.keys(rows[0]).filter((k) => typeof rows[0][k] === 'number' && !['heapMB', 'dom', 'canvases'].includes(k) && rows.some((r) => r[k] > rows[0][k]));
writeJsonl('leakcheck.jsonl', { verdict: grew.length ? 'LEAK' : 'ok', grew });
process.exitCode = grew.length ? 3 : 0;
