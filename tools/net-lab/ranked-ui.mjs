// A WON ranked run through the real UI, verified by the leaderboard server: start the built-in "Decapitation"
// challenge from Challenges > Scenarios, win it with attack-move orders every 3 s (the orders go through the game's
// own command path, so the run is recorded like a player's), submit it on the card that appears after the end, and
// find it on the Leaderboards screen (and in the server's /relay/lb/top). Runs on the host or in a test VM:
//
//   GAME_URL=http://127.0.0.1:8811/ node tools/net-lab/ranked-ui.mjs [chromium|firefox|webkit|chrome|msedge|moz-firefox]
//   tools/lab/lab.sh run win11 tools/net-lab/ranked-ui.mjs msedge      (GAME_URL from LAB_GAME_URL, OUT_DIR set)
//
// Exit code 0 when the run was won, submitted, verified and listed. A JSON report goes to OUT_DIR/ranked-ui.json.
import { chromium, firefox, webkit } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const which = process.argv[2] ?? 'chromium';
const BASE = (process.env.GAME_URL ?? 'http://127.0.0.1:8811/').replace(/\/?$/, '/');
const OUT = process.env.OUT_DIR ?? './out';
mkdirSync(OUT, { recursive: true });
const BOARD = 'b-decapitation';
const NAME = 'LabRanked';
const t0 = Date.now();
const log = (...a) => console.log(`${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s`, ...a);
const report = { browser: which, url: BASE, checks: {}, failures: [], errors: [] };
const check = (k, ok, d) => { report.checks[k] = { ok: !!ok, d }; if (!ok) report.failures.push(k); log(ok ? 'ok  ' : 'FAIL', k, JSON.stringify(d ?? '').slice(0, 300)); };
const win = process.platform === 'win32';
const launch = () => {
  if (which === 'firefox' || which === 'moz-firefox') return firefox.launch({ headless: process.env.HEADED !== '1', ...(which === 'moz-firefox' ? { channel: 'moz-firefox', executablePath: win ? 'C:/Program Files/Mozilla Firefox/firefox.exe' : '/usr/bin/firefox' } : {}), firefoxUserPrefs: { 'webgl.force-enabled': true } });
  if (which === 'webkit') return webkit.launch({ headless: process.env.HEADED !== '1' });
  const args = win ? ['--use-angle=d3d11', '--ignore-gpu-blocklist'] : ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
  return chromium.launch({ headless: process.env.HEADED !== '1', channel: which === 'chromium' ? undefined : which, args });
};
const browser = await launch();
let exit = 1;
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await ctx.addInitScript(() => {
    if (!localStorage.getItem('rh.settings')) localStorage.setItem('rh.settings', JSON.stringify({ quality: 'low', fullscreen: false }));
    document.addEventListener('securitypolicyviolation', (e) => console.error(`CSP violation: ${e.violatedDirective} ${e.blockedURI}`));
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(120000);
  page.on('console', (m) => { if (m.type() === 'error') report.errors.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => report.errors.push(`pageerror: ${e.message.slice(0, 200)}`));
  const until = (fn, a, ms = 300000) => page.waitForFunction(fn, a, { timeout: ms, polling: 500 });
  await page.goto(BASE + '?q=low&hd=0&demo=0&debug=1', { waitUntil: 'load', timeout: 300000 });
  await page.waitForSelector('.mm-nav-btn', { timeout: 300000 });
  await page.locator('.mm-nav-btn', { hasText: 'Challenges' }).click();
  await page.click('.chl-sbtn[data-act="scenarios"]');
  await page.click(`.chx-card[data-id="${BOARD}"] [data-a="play"]`);
  await until(() => window.__game?.world?.tick > 40 && !!window.__game.setup.challenge);
  log('challenge running', await page.evaluate(() => __game.setup.challenge?.id ?? __game.setup.challenge));
  // play: every 3 s every armed unit attack-moves on the enemy (as a player box-selecting all and right-clicking)
  const tEnd = Date.now() + 15 * 60_000;
  let orders = 0;
  while (Date.now() < tEnd) {
    const st = await page.evaluate(() => {
      const g = __game, w = g.world, me = g.local;
      if (w.gameOver) return { over: true, won: !!w.mission?.won, tick: w.tick, score: Math.round(w.mission?.score ?? 0) };
      const mine = w.units.filter((u) => u.alive && u.owner === me && u.weapons.length && !u.ut.harvester);
      const fu = w.units.filter((u) => u.alive && u.owner.team !== me.team && !u.owner.neutral);
      const fb = w.buildings.filter((b) => b.alive && b.owner.team !== me.team && !b.bt.wall && !b.owner.neutral);
      const t = fu.length ? fu : fb;
      if (mine.length && t.length) g.issue({ c: 'move', player: me.id, units: mine.map((u) => u.id), x: t.reduce((a, u) => a + u.x, 0) / t.length, y: t.reduce((a, u) => a + u.y, 0) / t.length, attackMove: true });
      return { over: false, tick: w.tick, mine: mine.length };
    });
    if (st.over) { report.end = st; break; }
    orders++;
    await new Promise((r) => setTimeout(r, 3000));
  }
  log('end', JSON.stringify(report.end), 'orders', orders);
  check('the challenge was won', report.end?.won, report.end);
  // the submit card (6.5 s after the end)
  await page.waitForSelector('.lbs-card [data-a="go"]', { timeout: 90000 });
  await page.fill('.lbs-card input', NAME);
  await page.click('.lbs-card [data-a="go"]');
  await until(() => /ok|bad/.test(document.querySelector('.lbs-msg')?.className ?? ''), undefined, 120000);
  const msg = await page.evaluate(() => ({ cls: document.querySelector('.lbs-msg').className, text: document.querySelector('.lbs-msg').textContent }));
  check('submitted and verified by the server', /\bok\b/.test(msg.cls), msg);
  await page.screenshot({ path: `${OUT}/ranked-ui-submitted.png` });
  // the server's board
  const top = await page.evaluate(async (b) => {
    const pid = Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)]).find(([k]) => /player/i.test(k))?.[1] ?? '';
    const r = await fetch(`relay/lb/top?kind=challenge&id=${b}`);
    return { status: r.status, body: await r.json(), pid: pid.slice(0, 6) };
  }, BOARD);
  const mine = (top.body.entries ?? []).find((e) => e.name === NAME);
  check('the server stored the verified run', !!mine && mine.won === true && mine.score === report.end.score, { mine, status: top.status });
  // the Leaderboards screen
  await page.goto(BASE + '?q=low&hd=0&demo=0', { waitUntil: 'load' });
  await page.waitForSelector('.mm-nav-btn', { timeout: 300000 });
  await page.locator('.mm-nav-btn', { hasText: 'Challenges' }).click();
  await page.click('.chl-sbtn[data-act="boards"]');
  await page.click(`.lbd-tab[data-b="${BOARD}"]`);
  const row = await until(() => document.querySelector('.lbd-row.you')?.textContent ?? '', undefined, 60000).then((h) => h.jsonValue(), () => '');
  check('the Leaderboards screen lists it as yours, a victory', row.includes(NAME) && /victory/i.test(row), row);
  await page.screenshot({ path: `${OUT}/ranked-ui-board.png` });
  const errs = report.errors.filter((e) => !/Cross-Origin-Opener-Policy header has been ignored|favicon/.test(e));
  check('no console errors / CSP violations', !errs.length, errs.slice(0, 5));
  exit = report.failures.length ? 1 : 0;
} catch (e) {
  report.failures.push(`exception: ${String(e.stack ?? e).slice(0, 600)}`);
  log('EXCEPTION', e.stack ?? e);
} finally {
  writeFileSync(`${OUT}/ranked-ui.json`, JSON.stringify(report, null, 1));
  await browser.close().catch(() => {});
  log(exit ? 'FAILED' : 'PASSED');
  process.exit(exit);
}
