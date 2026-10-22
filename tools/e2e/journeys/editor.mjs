// The map editor: paint a map with the mouse (water and ore strokes), run the fairness check, playtest it (and come
// back to the editor), export it as a file, change it, and import the exported file again.
import fs from 'node:fs';
import path from 'node:path';
import { sleep } from '../lib.mjs';

const ED = '.ed-top';

/** The content line of the Map tab ("N strokes · N bridges · N ore cells"). */
const contentNote = (bot) => bot.page.evaluate(() => [...document.querySelectorAll('.ed-side .ed-note')].map((e) => e.textContent).find((t) => /\d+ strokes? ·/.test(t)) ?? '');

async function sideTab(bot, label) {
  await bot.click('.ed-side .ed-tab', label);
}

/** Drag a stroke across the editing view, in fractions of the free area between the panels. */
async function stroke(bot, from, to) {
  const area = await bot.page.evaluate(() => {
    const r = (s) => document.querySelector(s)?.getBoundingClientRect();
    const tools = r('.ed-tools'), side = r('.ed-side'), top = r('.ed-top'), status = r('.ed-status');
    return { x0: (tools?.right ?? 0) + 20, x1: (side?.left ?? innerWidth) - 20, y0: (top?.bottom ?? 0) + 60, y1: (status?.top ?? innerHeight) - 30 };
  });
  const pt = ([fx, fy]) => ({ x: area.x0 + (area.x1 - area.x0) * fx, y: area.y0 + (area.y1 - area.y0) * fy });
  await bot.drag(pt(from), pt(to), { steps: 16 });
}

export default async function editor(bot) {
  await bot.goto();
  await bot.waitMenu();
  await bot.nav('Map Editor');
  const up = await bot.waitFor(`${ED} .ed-b`, undefined, 60000);
  bot.check(up, 'the map editor opens from the main menu');
  await sleep(1000);
  await bot.shot('editor');
  await sideTab(bot, 'Map');
  const before = await contentNote(bot);

  // ---- paint: a water stroke, then ore, with the tools picked by click and by key
  await bot.click('.ed-tools .ed-tool', 'Water');
  await stroke(bot, [0.3, 0.45], [0.7, 0.55]);
  await bot.key('8'); // Ore
  await stroke(bot, [0.25, 0.25], [0.35, 0.3]);
  await sideTab(bot, 'Map');
  const after = await contentNote(bot);
  bot.log(`content: "${before}" -> "${after}"`);
  const strokes = (t) => +(/(\d+) stroke/.exec(t)?.[1] ?? 0);
  bot.check(strokes(after) >= strokes(before) + 2, 'two painted strokes are in the map', `${before} -> ${after}`);
  // undo / redo
  await bot.key('Control+z');
  await sideTab(bot, 'Map');
  const undone = strokes(await contentNote(bot));
  await bot.key('Control+y');
  await sideTab(bot, 'Map');
  const redone = strokes(await contentNote(bot));
  bot.check(undone === strokes(after) - 1 && redone === strokes(after), 'undo and redo the last stroke', `${undone} / ${redone}`);
  await bot.shot('painted');

  // ---- the fairness check
  await sideTab(bot, 'Check');
  const verdict = await bot.page.evaluate(() => ({ cls: document.querySelector('.ed-side .ed-verdict')?.className, text: document.querySelector('.ed-side .ed-verdict')?.textContent.replace(/\s+/g, ' '), checks: document.querySelectorAll('.ed-side .ed-check').length, ore: document.querySelectorAll('.ed-side .ed-ore').length }));
  bot.check(verdict.checks > 3 && verdict.ore >= 2, 'the Check tab runs the map checks and compares ore per player', verdict);
  await bot.shot('check');

  // ---- name it, save it, export it
  const name = `E2E map ${Date.now() % 100000}`;
  const nameInput = bot.page.locator(`${ED} input`).first();
  await nameInput.fill(name);
  await nameInput.press('Enter');
  await bot.click(`${ED} .ed-b`, 'Save');
  await sleep(500);
  const dl = bot.page.waitForEvent('download', { timeout: 30000 * bot.o.slow });
  await bot.click(`${ED} .ed-b`, 'Export');
  const file = await dl.then(async (d) => { const f = path.join(bot.dir, d.suggestedFilename()); await d.saveAs(f); return f; }, () => null);
  const exported = file && JSON.parse(fs.readFileSync(file, 'utf8'));
  bot.check(!!exported && JSON.stringify(exported).includes(name), 'Export downloads the map as a file', file ? path.basename(file) : 'no download');

  // ---- playtest: a skirmish on this map, then back to the editor
  await bot.click(`${ED} .ed-b.pri`);
  await bot.waitFor('.ed-modal .ed-b.pri');
  await bot.click('.ed-modal .ed-b.pri', 'Start skirmish');
  await bot.waitMatch();
  const pt = await bot.g((g) => ({ custom: !!g.setup.customMap, name: g.setup.customMap?.name, size: g.world.map.w }));
  bot.check(pt.custom && pt.name === name, 'Playtest starts a skirmish on the edited map', pt);
  await bot.shot('playtest');
  await bot.wait(10);
  await bot.pauseAct('quit to menu');
  const back = await bot.waitFor(`${ED} .ed-b`, undefined, 60000);
  bot.check(back && (await nameInput.inputValue()) === name, 'leaving the playtest returns to the editor with the map', await nameInput.inputValue().catch(() => ''));
  await bot.noErrors('editor and playtest');

  // ---- change the map, then import the exported file: the import replaces it
  await bot.click('.ed-tools .ed-tool', 'Forest');
  await stroke(bot, [0.6, 0.2], [0.75, 0.3]);
  if (file) {
    const fc = bot.page.waitForEvent('filechooser', { timeout: 15000 * bot.o.slow });
    await bot.click(`${ED} .ed-b`, 'Import');
    const chooser = await fc.catch(() => null);
    bot.check(!!chooser, 'Import opens a file picker');
    if (chooser) {
      await chooser.setFiles(file);
      await sleep(800);
      // the forest stroke is unsaved: the editor asks first (Cancel / Discard / Save)
      const asked = await bot.waitFor('.ed-modal .ed-b', 'Discard', 5000);
      bot.check(asked, 'importing over unsaved changes asks first');
      if (asked) await bot.click('.ed-modal .ed-b', 'Discard');
      await sleep(1500);
      await sideTab(bot, 'Map');
      const reimported = await contentNote(bot);
      bot.check((await nameInput.inputValue()) === name && strokes(reimported) === strokes(after), 'the exported file imports back as the same map', `${await nameInput.inputValue()} · ${reimported}`);
    }
  }
  // ---- a broken file is refused with a message, nothing changes
  const bad = path.join(bot.dir, 'broken.rhmap.json');
  fs.writeFileSync(bad, '{"format":"rh-map","map":{"size":1e9,"features":"<img src=x onerror=alert(1)>"}}');
  const fc2 = bot.page.waitForEvent('filechooser', { timeout: 15000 * bot.o.slow });
  await bot.click(`${ED} .ed-b`, 'Import');
  const ch2 = await fc2.catch(() => null);
  if (ch2) {
    bot.expect.push(/import|invalid|map/i);
    await ch2.setFiles(bad);
    await sleep(1200);
    const toast = await bot.page.evaluate(() => [...document.querySelectorAll('.ed-toast')].map((t) => t.textContent).join(' | '));
    bot.check(/.+/.test(toast) && (await nameInput.inputValue()) === name, 'a broken map file is refused with a message', toast);
    bot.expect.pop();
  }
  await bot.shot('reimported');
  // ---- leave the editor
  await bot.key('Escape', 800);
  if (await bot.waitFor('.ed-modal .ed-b', 'Discard', 3000)) await bot.click('.ed-modal .ed-b', 'Discard'); // (the imported map is not in the library)
  await bot.waitMenu();
}
