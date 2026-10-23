// Challenges: start the Daily Challenge; in the challenge list export a challenge to a file and import it back;
// make a share link (#share=…), open it, check the preview and import it; a broken link is refused politely.
import fs from 'node:fs';
import path from 'node:path';
import { sleep } from '../lib.mjs';

const cards = (bot) => bot.page.locator('.chx [data-a="play"]').count();

async function openList(bot) {
  await bot.nav('Challenges');
  await bot.waitFor('.chl-sbtn[data-act="scenarios"]', undefined, 60000);
  await bot.click('.chl-sbtn[data-act="scenarios"]');
  await bot.waitFor('.chx [data-a="play"]', undefined, 30000);
}

export default async function challenges(bot) {
  await bot.goto();
  await bot.waitMenu();

  // ---- the Daily Challenge
  await bot.nav('Challenges');
  const hub = await bot.waitFor('[data-deploy="daily"]', undefined, 60000);
  bot.check(hub, 'the Challenges screen offers the Daily Challenge');
  await bot.shot('challenges');
  await bot.click('[data-deploy="daily"]');
  await bot.waitMatch();
  const daily = await bot.g((g) => ({ mission: g.setup.mission, obj: (g.world.mission?.objectives ?? []).map((o) => o.text).slice(0, 2) }));
  bot.check(daily.mission === 'daily', 'Deploy starts the Daily Challenge', daily);
  await bot.wait(10);
  await bot.shot('daily');
  await bot.quitToMenu();
  await bot.noErrors('daily challenge');

  // ---- the challenge list: export one to a file
  await openList(bot);
  const n0 = await cards(bot);
  await bot.shot('challenge-list');
  const dl = bot.page.waitForEvent('download', { timeout: 30000 * bot.o.slow });
  await bot.click('.chx [data-a="export"] >> nth=0');
  const file = await dl.then(async (d) => { const f = path.join(bot.dir, d.suggestedFilename()); await d.saveAs(f); return f; }, () => null);
  bot.check(!!file && fs.statSync(file).size > 50, 'a challenge exports to a file', file ? path.basename(file) : 'no download');

  // ---- import that file: the list grows by one
  if (file) {
    const fc = bot.page.waitForEvent('filechooser', { timeout: 15000 * bot.o.slow });
    await bot.click('.chx [data-a="import"]');
    const ch = await fc.catch(() => null);
    if (ch) { await ch.setFiles(file); await sleep(1500); }
    const n1 = await cards(bot);
    const note = (await bot.page.locator('.chx-foot .note').textContent().catch(() => '')).trim();
    // (the first card is a built-in challenge: importing it again keeps one copy)
    bot.check(n1 === n0 && /import|already in your list/i.test(note) && !await bot.sees('.chx-foot .note.bad'), 'the exported challenge file imports back (a built-in one is not duplicated)', `${n0} -> ${n1}; "${note}"`);
  }

  // ---- a share link for the first challenge
  await bot.click('.chx [data-a="link"] >> nth=0');
  await bot.waitFor('.sh-url input');
  const link = await bot.page.locator('.sh-url input').inputValue();
  bot.check(/#share=/.test(link) && link.startsWith(new URL(bot.o.url).origin), 'Share makes a #share= link on this site', link.slice(0, 80));
  await bot.shot('share-dialog');
  await bot.click('[data-a="close"]');
  await bot.click('.chx [data-a="back"]');
  await bot.waitFor('.chl-sbtn[data-act="back"]').then((ok) => ok && bot.click('.chl-sbtn[data-act="back"]'));
  await bot.waitMenu();
  await bot.noErrors('challenge list');

  // ---- open the link (as a friend would): preview, then import
  const u = new URL(link);
  u.searchParams.set('debug', '1');
  await bot.page.goto(u.href, { waitUntil: 'load' });
  await bot.waitMenu();
  const prev = await bot.waitFor('.sh-facts', undefined, 30000);
  const facts = prev ? await bot.page.locator('.sh-facts').textContent() : '';
  bot.check(prev && facts.length > 5, 'opening the link shows a preview of the shared challenge', facts.replace(/\s+/g, ' ').slice(0, 120));
  await bot.shot('share-preview');
  await bot.click('[data-a="save"]');
  await sleep(800);
  const status = await bot.page.locator('.sh-status').textContent().catch(() => '');
  bot.check(/import|saved|added/i.test(status), 'Import saves the shared challenge', status);
  await sleep(2000);
  await openList(bot);
  const n2 = await cards(bot);
  bot.check(n2 === n0 + 1, 'the challenge imported from the link is in the list (as the player\'s own copy)', `${n0} -> ${n2}`);
  await bot.click('.chx [data-a="back"]');
  await bot.waitFor('.chl-sbtn[data-act="back"]').then((ok) => ok && bot.click('.chl-sbtn[data-act="back"]'));
  await bot.waitMenu();

  // ---- a broken link is refused with a message (nothing imported, no crash)
  bot.expect.push(/share|decode|invalid/i);
  await bot.page.goto(bot.url({}, '#share=1.this-is-not-a-real-link'), { waitUntil: 'load' });
  await bot.waitMenu();
  const refused = await bot.waitFor('.mx-panel [data-a="ok"], [data-a="ok"]', undefined, 20000);
  bot.check(refused, 'a broken share link shows a message instead of importing');
  await bot.shot('share-broken');
  if (refused) await bot.click('[data-a="ok"]');
  bot.expect.pop();
}
