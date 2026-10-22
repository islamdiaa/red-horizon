// The PWA update flow: serve build A, play with it (settings, key bindings, a saved game), deploy build B on the same
// address, and check that a returning player gets B through the service worker without losing saves, settings or
// key bindings. Then the cases where an update lands while the player is busy: the map editor (no reload under
// unsaved work; build C) and a match (the match goes on, Quit to menu still works and then picks up the update).
// Needs: --serve <buildA> --serve-b <buildB>,<buildC> (node tools/e2e/builds.mjs <A> <B> <C> makes them).
import fs from 'node:fs';
import path from 'node:path';
import { sleep } from '../lib.mjs';

export function skip(ctx) {
  if (!ctx.server || !ctx.o.serveB) return 'needs --serve <build A> --serve-b <build B>[,<build C>] (node tools/e2e/builds.mjs makes them)';
  if (ctx.o.browser !== 'chromium' && ctx.o.browser !== 'firefox') return 'service workers need Chromium or Firefox here';
  return null;
}

/** The build id the page runs (its entry chunk). */
const buildOf = (page) => page.evaluate(() => document.querySelector('script[type="module"][src]')?.src.split('/').pop() ?? null).catch(() => null);

/** The entry chunk named by a build's index.html. */
const entryOf = (dir) => /src="[^"]*\/(index-[^"]+\.js)"/.exec(fs.readFileSync(path.join(dir, 'index.html'), 'utf8'))?.[1];

/** Wait until a page (which may reload on its own) runs the given build and shows the menu (`seconds` at most). */
async function waitBuild(bot, page, id, seconds = 90) {
  const end = Date.now() + seconds * 1000 * bot.o.slow;
  while (Date.now() < end) {
    if (await buildOf(page) === id && await page.locator('.main-screen .mm-nav-btn').first().isVisible().catch(() => false)) return true;
    await sleep(1000);
  }
  return false;
}

/** Is the service worker's cached index.html already the given build? */
const cachedIndexIs = (page, id) => page.evaluate(async (id) => {
  for (const k of await caches.keys()) {
    const r = await (await caches.open(k)).match(new URL('index.html', location.href).href, { ignoreVary: true });
    if (r && (await r.text()).includes(id)) return true;
  }
  return false;
}, id).catch(() => false);

export default async function pwaUpdate(bot, ctx) {
  const [B, C] = String(ctx.o.serveB).split(','), A = ctx.o.serve;
  const idA = entryOf(A), idB = entryOf(B), idC = C ? entryOf(C) : null;
  bot.check(idA && idB && idA !== idB, 'builds A and B have different build ids', `${idA} / ${idB}`);
  ctx.server.setRoot(A);
  const page = bot.page;

  // ---- build A: first visit installs the service worker; a second load is served by it
  await bot.goto();
  await bot.waitMenu();
  const sw = await page.evaluate(() => navigator.serviceWorker.ready.then((r) => !!r.active)).catch(() => false);
  bot.check(sw, 'build A installs its service worker');
  await page.waitForFunction(() => navigator.serviceWorker.controller || true, null, { timeout: 30000 }).catch(() => {});
  await bot.reload();
  await bot.waitMenu();
  bot.check(await page.evaluate(() => !!navigator.serviceWorker.controller), 'the second load is served by the service worker');
  // state to keep: a setting (team colours), a key binding (Attack-move on K) and a saved game
  await bot.nav('Settings');
  await bot.waitFor('.settings-panel .set-row');
  const palRow = page.locator('.settings-panel .set-row').filter({ has: page.locator('.seg button[data-v="cvd"]') }).first();
  await palRow.locator('.seg button[data-v="cvd"]').click();
  await page.locator('.settings-panel .set-row').filter({ hasText: /key/i }).locator('button').first().click();
  await bot.waitFor('.kb-row');
  const amRow = page.locator('.kb-row').filter({ has: page.locator('.kb-name', { hasText: /^Attack.move/i }) }).first();
  await amRow.locator('.kb-key').first().click();
  await bot.key('k');
  await bot.key('Escape', 500);
  if (await bot.sees('.settings-panel')) await bot.key('Escape', 500);
  await bot.waitMenu();
  await bot.click('.main-screen .mm-panel .seg button[data-v="64"]');
  await bot.click('.main-screen .mm-panel .deploy');
  await bot.waitMatch();
  await bot.wait(5);
  await bot.pauseAct('save game');
  const savedTick = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('rh.save.manual')).savedAt; } catch { return null; } });
  await bot.click('.pause-screen .pp-btn[data-act="quit to menu"]');
  await bot.waitMenu();
  const before = await page.evaluate(() => ({ settings: localStorage.getItem('rh.settings'), save: !!localStorage.getItem('rh.save.manual') }));
  bot.check(before.save && /cvd/.test(before.settings ?? '') && /attackMove/.test(before.settings ?? ''), 'build A holds a setting, a key binding and a save', before.settings?.slice(0, 120));
  await bot.noErrors('build A');

  // ---- deploy build B; the player comes back
  ctx.server.setRoot(B);
  await bot.reload();
  await bot.waitMenu();
  const first = await buildOf(page);
  bot.log(`first load after the deploy runs ${first} (the cached page starts at once)`);
  // the service worker refreshes the page in the background; the next start registers B's worker, which installs and
  // is applied on the menu (a reload)
  const fresh = await (async () => { for (let i = 0; i < 60; i++) { if (await cachedIndexIs(page, idB)) return true; await sleep(1000); } return false; })();
  bot.check(fresh || first === idB, 'the new index.html reaches the cache in the background');
  await bot.reload().catch(() => {});
  const updated = await waitBuild(bot, page, idB, 120);
  bot.check(updated, 'the next start runs build B (the update applies on the menu)', await buildOf(page));
  await bot.waitMenu();
  const after = await page.evaluate(() => ({ settings: localStorage.getItem('rh.settings'), savedAt: (() => { try { return JSON.parse(localStorage.getItem('rh.save.manual')).savedAt; } catch { return null; } })() }));
  bot.check(after.settings === before.settings, 'settings and key bindings survive the update');
  bot.check(after.savedAt === savedTick && await bot.sees('.mm-nav-btn:has(.nb-idx:text-is("▶"))'), 'the saved game survives the update and Continue is offered');
  const keys = await page.evaluate(() => caches.keys());
  bot.check(!keys.some((k) => k.includes(idA.replace(/\.js$/, ''))), 'the old build\'s cache is gone', keys);
  await bot.shot('updated');
  await bot.noErrors('update to B');

  // The cases where the update lands while this tab is busy. Another tab of the game is where the new build shows up
  // first (the same thing happens to one tab whose worker finishes installing after the player left the menu).
  const otherTabUpdates = async (id) => {
    const other = await bot.context.newPage();
    bot.attach(other);
    await other.goto(bot.url(), { waitUntil: 'load' });
    let cached = false;
    for (let i = 0; i < 90 && !(cached = await cachedIndexIs(other, id)); i++) await sleep(1000);
    await other.reload({ waitUntil: 'load' }).catch(() => {});
    const ok = await waitBuild(bot, other, id, 150);
    bot.log(`other tab: new index cached ${cached}, runs ${await buildOf(other)}`);
    return { other, ok };
  };

  // ---- C lands while the map editor is open here: no reload under unsaved work; leaving the editor picks it up
  if (C) {
    ctx.server.setRoot(C);
    await bot.nav('Map Editor');
    const inEditor = await bot.waitFor('.ed-top .ed-b', undefined, 60000);
    await page.locator('.ed-top input').first().fill('Unsaved E2E map');
    await page.locator('.ed-top input').first().press('Enter');
    const { other, ok } = await otherTabUpdates(idC);
    bot.check(ok, 'another tab picks up build C on its menu');
    await sleep(5000);
    const still = await page.evaluate(() => document.querySelector('.ed-top input')?.value ?? null).catch(() => null);
    bot.check(inEditor && still === 'Unsaved E2E map', 'the update does not reload the page under the map editor', `editor name field: ${still}; this tab runs ${await buildOf(page)}`);
    await bot.shot('editor-during-update');
    await other.close();
    // leave the editor (it asks about the unsaved map: the bot accepts), then the main menu applies the update
    await bot.key('Escape', 800);
    if (await bot.sees('.ed-modal .ed-b', 'Discard')) await bot.click('.ed-modal .ed-b', 'Discard');
    const back = await waitBuild(bot, page, idC, 90);
    bot.check(back, 'back on the main menu, this tab switches to build C', await buildOf(page));
    await bot.noErrors('update during the editor');
  }

  // ---- A again (another deploy) while a match runs here: the match goes on, and Quit to menu still works
  const D = A, idD = entryOf(D); // (A again: new to a tab running B or C)
  ctx.server.setRoot(D);
  await bot.waitMenu();
  await bot.click('.main-screen .mm-panel .deploy');
  await bot.waitMatch();
  const { other: o2, ok: ok2 } = await otherTabUpdates(idD);
  bot.check(ok2, 'another tab picks up the new build on its menu');
  await sleep(2000);
  const midMatch = await page.evaluate(() => ({ inMatch: !!window.__game && !window.__game.setup.demo, build: document.querySelector('script[type="module"][src]')?.src.split('/').pop() }));
  bot.check(midMatch.inMatch, 'the match in progress is not interrupted by the update', midMatch);
  await o2.close();
  await bot.wait(5);
  await bot.pause();
  await bot.click('.pause-screen .pp-btn[data-act="quit to menu"]');
  const left = await waitBuild(bot, page, idD, 60);
  bot.check(left, '"Quit to menu" leaves the match, and the menu switches to the new build', `${await buildOf(page)}; screen: ${await page.evaluate(() => document.querySelector('.screen:not(.leaving)')?.className ?? (window.__game && !window.__game.setup.demo ? 'still in the match' : 'none')).catch(() => '?')}`);
  await bot.shot('after-quit');
  const kept = await page.evaluate(() => ({ settings: localStorage.getItem('rh.settings'), save: !!localStorage.getItem('rh.save.manual') }));
  bot.check(kept.settings === before.settings && kept.save, 'settings and the save survive all the updates');
}
