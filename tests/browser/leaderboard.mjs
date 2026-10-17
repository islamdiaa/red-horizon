// Browser end-to-end test of the verified leaderboards: a built-in challenge played in the browser is
// submitted and verified by the server (browser and server engines agree), the Daily Challenge and Survival
// worlds hash the same in the browser and in Node, and the Leaderboards screen lists the verified runs.
//   node tests/browser/leaderboard.mjs [baseUrl=http://127.0.0.1:5277/] [outDir=/tmp/rh-mp/multi]
// Needs the dev server with /relay proxied to a running relay, and Playwright Chromium.
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '../..');
const base = process.argv[2] ?? 'http://127.0.0.1:5277/';
const out = process.argv[3] ?? '/tmp/rh-mp/multi';
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const fail = (m) => { console.error('FAIL', m); process.exitCode = 1; };

// headless reference hashes (Node, the same engine the server bundles)
const ref = JSON.parse(execFileSync(process.execPath, ['--import', 'tsx', path.join(here, 'lb-reference.ts')], { cwd: root, encoding: 'utf8' }).trim().split('\n').pop());
log('reference', JSON.stringify(ref));

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
  env: { ...process.env, LD_LIBRARY_PATH: path.join(root, 'tools/nsslibs/lib') },
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
await ctx.addInitScript(() => { if (!localStorage.getItem('rh.settings')) localStorage.setItem('rh.settings', JSON.stringify({ quality: 'low', fullscreen: false })); });
const page = await ctx.newPage();
page.setDefaultTimeout(180000);
page.on('console', (m) => { if (m.type() === 'error') console.log(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
const hashNow = () => page.evaluate(async () => (await import('/src/replay/hash.ts')).worldHash(window.__game.world));

try {
  // ---- the Daily Challenge and Survival: the same world in the browser as in Node
  for (const [mission, key] of [['daily', 'daily'], ['survival', 'survival']]) {
    await page.goto(base + `?autostart=1&mission=${mission}&q=low&hd=0&intro=0`, { waitUntil: 'load', timeout: 600000 });
    await page.waitForFunction(() => window.__game && window.__game.world.mission, undefined, { timeout: 600000 });
    await page.evaluate(() => { const g = window.__game; g.paused = true; });
    const t0 = await page.evaluate(() => window.__game.world.tick);
    await page.evaluate((n) => { const w = window.__game.world; while (w.tick < n) { w.step(); w.events.length = 0; w.mission.events.length = 0; } }, ref.ticks);
    const h = await hashNow();
    log(mission, 'browser', h, 'node', ref[key], `(from tick ${t0})`);
    if (t0 !== 0) log('note: the browser had already stepped', t0, 'ticks');
    if (h !== ref[key]) fail(`${mission}: browser and Node worlds differ`);
  }

  // ---- portable math: bit-identical in this browser and in Node
  const digest = `async (url) => {
    const d = await import(url);
    let s = 12345; const rnd = () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s / 4294967296; };
    const f64 = new Float64Array(1), u32 = new Uint32Array(f64.buffer); let h = 0x811c9dc5;
    for (let i = 0; i < 30000; i++) {
      const a = (rnd() - 0.5) * (i % 3 ? 400 : 4), b = (rnd() - 0.5) * 50;
      for (const v of [d.dsin(a), d.dcos(a), d.datan2(a, b), d.dhypot(a, b), d.dpow(Math.abs(a), b / 10), d.dlog2(Math.abs(a) + 1e-9), d.dexp(b)]) { f64[0] = v; h = (Math.imul(h ^ u32[0], 16777619) ^ u32[1]) >>> 0; }
    }
    return h;
  }`;
  const inBrowser = await page.evaluate(`(${digest})('/src/net/dmath.ts')`);
  const inNode = await (0, eval)(`(${digest})`)(new URL('../../src/net/dmath.ts', import.meta.url).href).catch(() => null);
  log('portable math digest: browser', inBrowser, 'node', inNode);
  if (inNode !== null && inBrowser !== inNode) fail('portable math differs between the browser and Node');

  // ---- a built-in challenge played in the browser, submitted and verified by the server
  await page.goto(base + '?autostart=1&challenge=b-armoured-clash&q=low&hd=0', { waitUntil: 'load', timeout: 600000 });
  await page.waitForFunction(() => window.__game && window.__game.world.mission, undefined, { timeout: 600000 });
  await page.evaluate(() => { window.__game.paused = true; });
  const end = await page.evaluate(() => {
    const g = window.__game, w = g.world, me = g.local;
    let first = true; // (attack at once, then every 5 s: wins from any starting tick)
    while (!w.gameOver && w.tick < 20 * 60 * 8) {
      if (first || w.tick % 100 === 1) {
        first = false;
        const army = w.units.filter((u) => u.alive && u.owner === me && u.weapons.length && !u.ut.harvester);
        const foe = w.units.find((u) => u.alive && me.isEnemy(u.owner)) ?? w.buildings.find((b) => b.alive && me.isEnemy(b.owner));
        if (army.length && foe) g.issue({ c: 'move', player: me.id, units: army.map((u) => u.id), x: foe.x, y: foe.y, attackMove: true });
      }
      w.step();
      if (w.gameOver) break;
      w.events.length = 0; w.mission.events.length = 0;
    }
    g.paused = false;
    return { over: w.gameOver, tick: w.tick, score: w.mission.score, won: w.mission.won };
  });
  log('challenge run', JSON.stringify(end));
  await page.waitForSelector('.lbs-card', { timeout: 60000 });
  await page.fill('.lbs-card input', 'Commander');
  await page.click('.lbs-card [data-a="go"]');
  await page.waitForFunction(() => /Verified|differ|could not|not available|match/.test(document.querySelector('.lbs-msg')?.textContent ?? ''), undefined, { timeout: 600000, polling: 250 });
  const msg = await page.textContent('.lbs-msg');
  log('submit:', msg);
  if (!/Verified/.test(msg)) fail('the browser run was not verified');
  await page.screenshot({ path: `${out}/leaderboard-submit.png` });

  // ---- the Leaderboards screen (Challenges > Leaderboards)
  await page.goto(base + '?q=low&hd=0&demo=0', { waitUntil: 'load', timeout: 600000 });
  await page.waitForSelector('.mm-nav-btn', { timeout: 600000 });
  await page.locator('.mm-nav-btn', { hasText: 'Challenges' }).click();
  await page.waitForSelector('.chl [data-act="boards"]', { timeout: 30000 });
  await page.click('.chl [data-act="boards"]');
  await page.waitForSelector('.lbd-tab', { timeout: 30000 });
  await page.locator('.lbd-tab', { hasText: 'Armoured Clash' }).click();
  await page.waitForSelector('.lbd-row.you', { timeout: 30000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${out}/leaderboard.png` });
  const rows = await page.locator('.lbd-row:not(.h)').count();
  log('leaderboard rows', rows);
  if (rows < 1) fail('no rows');
  log(process.exitCode ? 'FAILED' : 'OK');
} catch (e) {
  fail(e.stack ?? e);
  await page.screenshot({ path: `${out}/error-lb.png` }).catch(() => {});
} finally {
  await browser.close();
}
