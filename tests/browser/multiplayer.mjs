// Browser end-to-end test of multiplayer: two headless pages (separate storage) play a short 1v1 through the
// relay, stay in sync, then a deliberate desync is detected; screenshots of the lobby, the match and the dialog.
//   node tests/browser/multiplayer.mjs [baseUrl=http://127.0.0.1:5277/] [outDir=/tmp/rh-mp/multi]
// Needs a dev server with /relay proxied to a running relay (tools/vite.<id>.config.ts) and Playwright Chromium.
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const base = process.argv[2] ?? 'http://127.0.0.1:5277/';
const out = process.argv[3] ?? '/tmp/rh-mp/multi';
mkdirSync(out, { recursive: true });
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const fail = (m) => { console.error('FAIL', m); process.exitCode = 1; };

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
  env: { ...process.env, LD_LIBRARY_PATH: path.join(here, '../../tools/nsslibs/lib') },
});
const pages = [];
for (const name of ['A', 'B']) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await ctx.addInitScript(() => { if (!localStorage.getItem('rh.settings')) localStorage.setItem('rh.settings', JSON.stringify({ quality: 'low', fullscreen: false })); });
  const page = await ctx.newPage();
  page.setDefaultTimeout(120000);
  page.on('console', (m) => { if (m.type() === 'error') console.log(`[${name} ${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => console.log(`[${name} pageerror] ${e.message}`));
  pages.push(page);
}
const [A, B] = pages;
const until = async (page, fn, arg, ms = 600000) => page.waitForFunction(fn, arg, { timeout: ms, polling: 250 });

try {
  // ---- A creates a room
  await A.goto(base + '?q=low&hd=0&demo=0', { waitUntil: 'load', timeout: 600000 });
  await A.waitForSelector('.mm-nav-btn', { timeout: 600000 });
  await A.locator('.mm-nav-btn', { hasText: 'Multiplayer' }).click();
  await A.waitForSelector('.lob [data-a="create"]');
  await until(A, () => document.querySelector('.lob [data-st]')?.classList.contains('ok'));
  await A.fill('.lob [data-k="name"]', 'Commander');
  await A.click('.lob [data-mode="1v1"]');
  await A.click('.lob [data-a="create"]');
  await A.waitForSelector('.lob [data-code]', { timeout: 120000 });
  const code = (await A.textContent('.lob [data-code]')).trim();
  log('room', code);
  // host settings
  await A.selectOption('.lob [data-set="size"]', '64');
  await A.waitForTimeout(400);
  await A.selectOption('.lob [data-set="startUnits"]', 'light');
  await A.waitForTimeout(400);
  await A.locator('.lob [data-mut="golden-ore"]').click();
  await A.waitForTimeout(400);

  // ---- B joins with the invite link
  await B.goto(base + `?q=low&hd=0&demo=0#join=${code}`, { waitUntil: 'load', timeout: 600000 });
  await B.waitForSelector('.lob [data-a="join"]', { timeout: 600000 });
  await until(B, () => document.querySelector('.lob [data-st]')?.classList.contains('ok'));
  await B.fill('.lob [data-k="name"]', 'Rival <b>bold</b>');
  await B.click('.lob [data-a="join"]');
  await B.waitForSelector('.lob [data-code]', { timeout: 120000 });
  await B.selectOption('.lob [data-me="faction"]', 'soviet');
  await B.waitForTimeout(300);
  // chat both ways
  await B.fill('.lob [data-chat] input', 'gl hf <script>alert(1)</script>');
  await B.press('.lob [data-chat] input', 'Enter');
  await A.waitForTimeout(1200);
  await A.fill('.lob [data-chat] input', 'you too, see you on the field');
  await A.press('.lob [data-chat] input', 'Enter');
  await B.click('.lob [data-a="ready"]');
  await until(A, () => !document.querySelector('.lob [data-a="start"]')?.disabled);
  const injected = await A.evaluate(() => !!document.querySelector('.lob-log script, .lob-log b b'));
  if (injected) fail('chat markup was rendered');
  await A.waitForTimeout(600);
  await A.screenshot({ path: `${out}/lobby.png` });
  log('lobby screenshot');

  // ---- start
  log('lobby state:', await A.evaluate(() => document.querySelector('.lob .lob-err')?.textContent ?? 'ok'));
  await A.click('.lob [data-a="start"]');
  for (const p of pages) await until(p, () => window.__game?.net && window.__game.world.tick > 40, undefined, 900000);
  log('match running');
  const info = await A.evaluate(() => ({ players: __game.world.players.map((p) => `${p.name}/${p.faction}/${p.isHuman}`), local: __game.local.id }));
  log('players', JSON.stringify(info));
  // orders on both sides: deploy the MCV, send the squad forward
  for (const p of pages) {
    await p.evaluate(() => {
      const g = __game, me = g.local;
      const mcv = g.world.units.find((u) => u.owner === me && u.ut.deploysInto);
      if (mcv) g.issue({ c: 'deploy', player: me.id, units: [mcv.id] });
      const squad = g.world.units.filter((u) => u.owner === me && u.weapons.length).map((u) => u.id);
      const m = g.world.map;
      g.issue({ c: 'move', player: me.id, units: squad, x: m.w / 2, y: m.h / 2, attackMove: true });
    });
  }
  await A.waitForTimeout(25000);
  for (const p of pages) await until(p, () => __game.world.tick >= 600, undefined, 900000);
  // the camera on the fight
  await A.evaluate(() => {
    const g = __game, army = g.world.units.filter((u) => u.alive && u.owner === g.local && u.weapons.length);
    const x = army.reduce((a, u) => a + u.x, 0) / Math.max(1, army.length), y = army.reduce((a, u) => a + u.y, 0) / Math.max(1, army.length);
    g.gfx.cam.jumpTo(x, y + 2); g.gfx.cam.dist = g.gfx.cam.targetDist = 22;
    for (const u of army) g.selection.add(u.id);
  });
  await A.waitForTimeout(2500);
  await A.screenshot({ path: `${out}/match.png` });
  log('match screenshot');
  const hashes = await Promise.all(pages.map((p) => p.evaluate(() => __game.net.session.ls.hashes)));
  const map = new Map(hashes[0]);
  let compared = 0;
  for (const [t, h] of hashes[1]) if (map.has(t)) { compared++; if (map.get(t) !== h) fail(`hash differs at ${t}`); }
  log('hashes compared', compared, 'ticks', await A.evaluate(() => __game.world.tick), await B.evaluate(() => __game.world.tick));
  if (compared < 3) fail('too few hash reports compared');
  const exec = await Promise.all(pages.map((p) => p.evaluate(() => __game.recorder.commandCount)));
  log('commands recorded', exec);
  if (exec[0] !== exec[1] && Math.abs(exec[0] - exec[1]) > 2) fail('different command streams');

  // ---- a deliberate desync: B's world changes behind the lockstep's back
  await B.evaluate(() => { __game.world.players[0].cash += 7; });
  for (const p of pages) await until(p, () => !!document.querySelector('.net-dialog'), undefined, 60000);
  await B.waitForTimeout(800);
  await B.screenshot({ path: `${out}/desync.png` });
  const d = await A.evaluate(() => __game.net.session.desync);
  log('desync', JSON.stringify(d));
  if (!d || d.hashes.length !== 2 || d.hashes[0][1] === d.hashes[1][1]) fail('desync diagnostic incomplete');
  log(process.exitCode ? 'FAILED' : 'OK');
} catch (e) {
  fail(e.stack ?? e);
  for (const [i, p] of pages.entries()) await p.screenshot({ path: `${out}/error-${i}.png` }).catch(() => {});
} finally {
  await browser.close();
}
