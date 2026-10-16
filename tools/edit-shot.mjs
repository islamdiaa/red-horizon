// Editor / mods screenshot driver (EDIT agent): node tools/edit-shot.mjs <scenario> [port=5213]
// Scenarios: editor (paint, check, 3D, mission), mods (Mods screen), picker (skirmish map picker with a custom map),
// playtest (start a skirmish on a custom map), campaign (custom mission in Special operations).
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const [scenario = 'editor', port = '5213'] = process.argv.slice(2);
const base = `http://localhost:${port}/?demo=0`;
const out = (n) => path.join(here, '..', 'screenshots', `edit-${n}.png`);
// a persistent profile, so maps saved / mods installed by one scenario are there for the next (rm -rf it to reset)
const browser = await chromium.launchPersistentContext(process.env.EDIT_PROFILE ?? '/tmp/rh-edit-profile', {
  viewport: { width: 1600, height: 900 },
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
  env: { ...process.env, LD_LIBRARY_PATH: path.join(here, 'nsslibs/lib') },
});
const page = browser.pages()[0] ?? await browser.newPage();
page.on('console', (m) => { if (m.type() === 'error' || process.env.ALLLOG) console.log(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}\n${e.stack ?? ''}`));
const t0 = Date.now();
const log = (s) => console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s ${s}`);
const shot = async (n) => { await page.screenshot({ path: out(n), timeout: 180000 }); log(`saved ${out(n)}`); };
const wait = (ms) => page.waitForTimeout(ms);

await page.goto(base, { waitUntil: 'load', timeout: 90000 });
await page.waitForSelector('.mm-nav-btn', { timeout: 90000 });
log('menu up');

async function openEditor() {
  await page.getByText('Map Editor', { exact: false }).first().click();
  await page.waitForSelector('.ed-top', { timeout: 30000 });
  await wait(800);
}

async function drag(pts, button = 'left') {
  await page.mouse.move(pts[0][0], pts[0][1]);
  await page.mouse.down({ button });
  for (const [x, y] of pts.slice(1)) await page.mouse.move(x, y, { steps: 8 });
  await page.mouse.up({ button });
  await wait(250);
}

async function tool(label) {
  await page.locator('.ed-tool', { hasText: label }).first().click();
  await wait(150);
}

if (scenario === 'editor') {
  await openEditor();
  // a fresh 96x96 rot2 map
  await page.getByText('New', { exact: true }).first().click();
  await page.waitForSelector('.ed-dlg');
  await page.locator('.ed-dlg input[type=text]').fill('Crossroads');
  await page.locator('.ed-dlg input[type=text]').dispatchEvent('change');
  await page.locator('.ed-dlg .ed-b.pri').click();
  await wait(600);
  const box = await page.evaluate(() => { const v = document.querySelector('.ed-status'); return v ? v.textContent : ''; });
  log('status: ' + box);
  // map to screen: read the 2D view transform from a test hook (map 96, fitted between the panels)
  const fit = await page.evaluate(() => {
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
    const left = 6.4 * rem, right = 24.8 * rem, top = 4.6 * rem, bottom = 3 * rem;
    const w = innerWidth - left - right, h = innerHeight - top - bottom;
    const z = Math.min(w, h) / 96 * 0.94;
    return { z, ox: left + (w - 96 * z) / 2, oy: top + (h - 96 * z) / 2 };
  });
  const P = (x, y) => [fit.ox + x * fit.z, fit.oy + y * fit.z];
  // river with a ford, lakes, forest, rock ridge, ore
  await tool('Water');
  await page.keyboard.press(']'); await page.keyboard.press(']');
  await drag([P(0, 40), P(16, 44), P(32, 46), P(48, 48)]);
  await tool('Ford');
  await page.keyboard.press('['); await page.keyboard.press('[');
  await drag([P(47, 54), P(49, 42)]);
  await tool('Rock');
  await drag([P(20, 62), P(30, 58)]);
  await tool('Forest');
  await page.keyboard.press(']'); await page.keyboard.press(']');
  await drag([P(4, 56), P(10, 52), P(14, 58)]);
  await drag([P(60, 88), P(70, 90)]);
  await tool('Gems');
  await drag([P(36, 66)]);
  await tool('Raise');
  await page.keyboard.press(']'); await page.keyboard.press(']'); await page.keyboard.press(']');
  await drag([P(26, 76)]);
  await tool('Bridge');
  await page.mouse.move(...P(20, 44));
  await wait(200);
  await page.mouse.click(...P(20, 44));
  await wait(400);
  await tool('Water');
  await page.mouse.move(...P(70, 30));
  await wait(400);
  await shot('2d-paint');
  // check tab
  await page.locator('.ed-tab', { hasText: 'Check' }).click();
  await wait(700);
  await shot('check');
  // save to the library
  await page.keyboard.press('Control+s');
  await wait(800);
  // 3D view
  await page.keyboard.press('Tab');
  log('3D: waiting for the renderer');
  await page.waitForFunction(() => !document.querySelector('.ed-busy.on') && document.querySelector('.ed-3d'), null, { timeout: 180000 });
  await wait(6000);
  await shot('3d');
  // mission mode, back in 2D
  await page.keyboard.press('Tab');
  await wait(500);
  await page.keyboard.press('m');
  await wait(500);
  await tool('Structure');
  await page.locator('.ed-opts select').first().selectOption('fact');
  await page.mouse.click(...P(84, 14));
  await wait(200);
  await page.locator('.ed-opts select').first().selectOption('tsla');
  await page.mouse.click(...P(78, 20));
  await wait(200);
  await page.locator('.ed-opts select').first().selectOption('dome');
  await page.mouse.click(...P(86, 22));
  await wait(200);
  await tool('Unit');
  await page.locator('.ed-opts select').first().selectOption('3tnk');
  for (const [x, y] of [[74, 26], [76, 27], [72, 25]]) { await page.mouse.click(...P(x, y)); await wait(120); }
  await page.locator('.ed-opts select').nth(1).selectOption('0');
  await page.locator('.ed-opts select').first().selectOption('2tnk');
  for (const [x, y] of [[14, 78], [16, 79], [18, 78]]) { await page.mouse.click(...P(x, y)); await wait(120); }
  await tool('Select');
  await page.mouse.click(...P(86, 22));
  await wait(400);
  await page.locator('.ed-card.sel input[type=text]').first().fill('radar');
  await page.locator('.ed-card.sel input[type=text]').first().dispatchEvent('change');
  await wait(300);
  await shot('mission');
  await page.keyboard.press('Control+s');
  await wait(800);
} else if (scenario === 'rebuild3d') {
  // paint in the 3D view: the renderer must rebuild its map layers in place (no new canvas / WebGL context)
  await openEditor();
  await page.getByText('3D', { exact: true }).first().click();
  await page.waitForFunction(() => !document.querySelector('.ed-busy.on') && document.querySelector('.ed-3d'), null, { timeout: 180000 });
  await wait(3000);
  const canvasBefore = await page.evaluate(() => document.querySelectorAll('canvas.ed-3d').length);
  const marker = await page.evaluate(() => { const c = document.querySelector('canvas.ed-3d'); c.dataset.mark = 'first'; return true; });
  await tool('Water');
  await drag([[600, 420], [760, 470], [900, 520]]);
  await page.waitForFunction(() => !document.querySelector('.ed-busy.on'), null, { timeout: 180000 });
  await wait(4000);
  const after = await page.evaluate(() => ({ canvases: document.querySelectorAll('canvas.ed-3d').length, same: document.querySelector('canvas.ed-3d')?.dataset.mark === 'first', status: document.querySelector('.ed-status')?.textContent }));
  log(`canvases before ${canvasBefore}, after ${after.canvases}, same canvas (in-place rebuild): ${after.same && marker}; status: ${after.status}`);
  await shot('rebuild3d');
} else if (scenario === 'mods') {
  await page.getByText('Mods', { exact: false }).last().click();
  await page.waitForSelector('.mods', { timeout: 20000 });
  await wait(1500);
  await page.locator('.mod-card', { hasText: 'Tank Rush' }).locator('[data-act=install]').click();
  await wait(400);
  await page.locator('.mod-card', { hasText: 'Glass Cannon' }).locator('[data-act=install]').click();
  await wait(400);
  await page.locator('.mod-card', { hasText: 'Tank Rush' }).click();
  await wait(400);
  await shot('mods');
  await page.keyboard.press('Escape');
  await wait(1200);
  await shot('menu-modded');
} else if (scenario === 'picker') {
  await page.evaluate(() => document.querySelector('.mr-change').click());
  await wait(2500);
  await shot('picker');
} else if (scenario === 'playtest') {
  // skirmish on the first custom map with mods enabled (run "mods" first): HUD markers
  await page.evaluate(() => document.querySelector('.mr-change').click());
  await wait(4000);
  await page.evaluate(() => [...document.querySelectorAll('.mpk-card')].find((c) => c.textContent.includes('Custom'))?.click());
  await wait(1500);
  await page.evaluate(() => document.querySelector('.deploy').click());
  log('deploying');
  await page.waitForSelector('.bitem', { timeout: 240000 });
  await wait(8000);
  await page.keyboard.press('Escape').catch(() => {});
  await shot('playtest');
  // hover a modded card for the tooltip
  const card = page.locator('.bitem', { has: page.locator('.bi-mod') }).first();
  if (await card.count()) { await card.hover(); await wait(800); await shot('hud-mod-tooltip'); } else log('no modded card visible');
} else if (scenario === 'roundtrip') {
  // editor -> Playtest -> mission -> quit -> back in the editor with the same map
  await openEditor();
  await page.evaluate(() => [...document.querySelectorAll('.ed-top .ed-b')].find((b) => b.textContent.includes('Playtest')).click());
  await page.waitForSelector('.ed-dlg');
  await wait(400);
  await shot('playtest-menu');
  await page.evaluate(() => [...document.querySelectorAll('.ed-dlg .ed-b')].find((b) => b.textContent.includes('Play mission')).click());
  log('launching the mission');
  await page.waitForSelector('#game-canvas', { timeout: 240000 });
  await page.waitForFunction(() => window.__game && window.__game.world, null, { timeout: 240000 }).catch(() => log('no __game'));
  await wait(15000);
  await shot('mission-ingame');
  const info = await page.evaluate(() => { const g = window.__game; return g ? { mission: g.missionDef?.title, objectives: g.world.mission?.objectives.map((o) => o.text), units: g.world.units.length, buildings: g.world.buildings.map((b) => b.bt.id), map: g.world.map.w } : null; });
  log('in game: ' + JSON.stringify(info));
  await page.keyboard.press('Escape');
  await wait(2500);
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Quit to menu'))?.click());
  await page.waitForSelector('.ed-top', { timeout: 120000 });
  await wait(1500);
  log('back in the editor: ' + await page.evaluate(() => document.querySelector('.ed-name').value));
  await shot('back-in-editor');
} else if (scenario === 'remix') {
  // remix a curated map: open it from the library, switch the climate to winter, look at it in 2D and 3D at dusk
  await openEditor();
  await page.evaluate(() => [...document.querySelectorAll('.ed-top .ed-b')].find((b) => b.textContent.includes('Open')).click());
  await page.waitForSelector('.ed-lib-card');
  await wait(2500);
  await shot('library');
  await page.evaluate(() => [...document.querySelectorAll('.ed-lib-card')].find((c) => c.textContent.includes('Bridgewater'))?.click());
  await wait(500);
  // "unsaved changes?" -> discard
  await page.evaluate(() => [...document.querySelectorAll('.ed-dlg .ed-b')].find((b) => b.textContent.includes('Discard'))?.click());
  await wait(1500);
  await page.locator('.ed-side select').nth(2).selectOption('winter');
  await wait(1500);
  await page.locator('.ed-tool', { hasText: 'Bridge' }).click();
  await page.mouse.move(700, 470);
  await wait(800);
  await shot('remix-2d');
  await page.locator('.ed-tab', { hasText: 'View' }).click();
  await wait(300);
  await page.locator('.ed-side input[type=range]').first().evaluate((r) => { r.value = '17.6'; r.dispatchEvent(new Event('input')); });
  await page.keyboard.press('Tab');
  await page.waitForFunction(() => !document.querySelector('.ed-busy.on') && document.querySelector('.ed-3d'), null, { timeout: 180000 });
  await wait(5000);
  await page.mouse.wheel(0, 400);
  await wait(6000);
  await shot('remix-3d');
} else if (scenario === 'interact') {
  // free layout with 4 starts, undo / redo, resize, a reach objective picked on the map, export + import
  await openEditor();
  await page.evaluate(() => [...document.querySelectorAll('.ed-top .ed-b')].find((b) => b.textContent.includes('New')).click());
  await page.waitForSelector('.ed-dlg');
  await page.locator('.ed-dlg select').nth(1).selectOption('none');
  await page.locator('.ed-dlg select').nth(0).selectOption('64');
  await page.evaluate(() => [...document.querySelectorAll('.ed-dlg .ed-b')].find((b) => b.textContent.includes('Create')).click());
  await wait(500);
  await page.evaluate(() => [...document.querySelectorAll('.ed-dlg .ed-b')].find((b) => b.textContent.includes('Discard'))?.click());
  await wait(1200);
  const fit = await page.evaluate(() => {
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
    const left = 6.4 * rem, right = 24.8 * rem, top = 4.6 * rem, bottom = 3 * rem;
    const w = innerWidth - left - right, h = innerHeight - top - bottom;
    const z = Math.min(w, h) / 64 * 0.94;
    return { z, ox: left + (w - 64 * z) / 2, oy: top + (h - 64 * z) / 2 };
  });
  const P = (x, y) => [fit.ox + x * fit.z, fit.oy + y * fit.z];
  await tool('Start');
  await page.mouse.click(...P(12, 12));
  await page.mouse.click(...P(52, 52));
  await wait(300);
  const players = async () => page.evaluate(() => document.querySelector('.ed-status').textContent);
  log('after adding starts: ' + await players());
  await page.mouse.click(...P(52, 52), { button: 'right' });
  await wait(300);
  log('after removing one: ' + await players());
  await page.keyboard.press('Control+z');
  await wait(300);
  log('after undo: ' + await players());
  await page.keyboard.press('Control+y');
  await page.keyboard.press('Control+z');
  await wait(300);
  await tool('Water');
  await drag([P(20, 32), P(44, 32)]);
  await tool('Ford');
  await drag([P(32, 28), P(32, 36)]);
  // mission with a reach objective picked on the map
  await page.keyboard.press('m');
  await wait(600);
  await page.evaluate(() => [...document.querySelectorAll('.ed-h .ed-b')].find((b) => b.closest('.ed-h').textContent.includes('OBJECTIVES'))?.click());
  await wait(500);
  const sels = page.locator('.ed-card select');
  const n = await sels.count();
  for (let i = 0; i < n; i++) { const opts = await sels.nth(i).evaluate((s) => [...s.options].map((o) => o.value)); if (opts.includes('reach')) { await sels.nth(i).selectOption('reach'); break; } }
  await wait(500);
  await page.evaluate(() => [...document.querySelectorAll('.ed-card .ed-b')].find((b) => b.textContent.includes('Pick'))?.click());
  await wait(200);
  await page.mouse.click(...P(32, 50));
  await wait(600);
  await shot('interact');
  // export and import back
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.evaluate(() => [...document.querySelectorAll('.ed-top .ed-b')].find((b) => b.textContent.includes('Export')).click())]);
  const file = '/tmp/edit-export.rhmap.json';
  await download.saveAs(file);
  log('exported ' + download.suggestedFilename());
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.evaluate(() => [...document.querySelectorAll('.ed-top .ed-b')].find((b) => b.textContent.includes('Import')).click())]);
  await chooser.setFiles(file);
  await wait(800);
  await page.evaluate(() => [...document.querySelectorAll('.ed-dlg .ed-b')].find((b) => b.textContent.includes('Discard'))?.click());
  await wait(1200);
  log('imported: ' + await page.evaluate(() => document.querySelector('.ed-name').value) + ' / ' + await players());
  await shot('imported');
} else if (scenario === 'mission3d') {
  // the saved "Crossroads" mission in the 3D view: placements as real models, dusk
  await openEditor();
  await page.evaluate(() => [...document.querySelectorAll('.ed-top .ed-b')].find((b) => b.textContent.includes('Open')).click());
  await page.waitForSelector('.ed-lib-card');
  await page.evaluate(() => [...document.querySelectorAll('.ed-lib-card')].find((c) => c.textContent.includes('Crossroads'))?.click());
  await wait(500);
  await page.evaluate(() => [...document.querySelectorAll('.ed-dlg .ed-b')].find((b) => b.textContent.includes('Discard'))?.click());
  await wait(1000);
  await page.keyboard.press('m');
  await wait(400);
  await page.keyboard.press('Tab');
  await page.waitForFunction(() => !document.querySelector('.ed-busy.on') && document.querySelector('.ed-3d'), null, { timeout: 180000 });
  await page.evaluate(() => { const v = window.__editor.view3d(); v.gfx.cam.jumpTo(79, 22); v.gfx.cam.dist = v.gfx.cam.targetDist = 24; v.opts.hours = 18.2; v.applyLook(); });
  await wait(9000);
  await shot('mission-3d');
} else if (scenario === 'menu') {
  await wait(2500);
  await shot('menu-modded');
} else if (scenario === 'campaign') {
  await page.getByText('Campaign', { exact: false }).first().click();
  await wait(1200);
  await page.locator('.cmp-tab', { hasText: 'Special' }).click();
  await wait(800);
  await page.locator('.cmp-sp', { hasText: 'Custom' }).first().click().catch(() => log('no custom mission'));
  await wait(2500);
  await shot('campaign');
}
log('done');
await browser.close();
