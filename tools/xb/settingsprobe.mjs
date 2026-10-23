// Which Settings control does what in this browser: every row of the Settings screen (label, its buttons and which are
// disabled), then each enabled button of each row clicked in turn (the language row excepted) with the console errors
// that follow it (WebGL validation errors name the control that triggers them).
//   node tools/xb/settingsprobe.mjs --browser <chromium|firefox|webkit> [--url ...]   (the rig: XB_DISPLAY=weston, HEADED=1)
import fs from 'node:fs';
import path from 'node:path';
const { parseArgs, openBrowser, Bot, sleep } = await import('../e2e/lib.mjs');
const o = parseArgs(process.argv.slice(2));
const browser = await openBrowser(o);
const bot = new Bot(o, browser, `settingsprobe-${o.browser}`);
const S = '.screen:not(.leaving) .settings-panel';
const errs = [];
const out = { browser: o.browser, rows: [], clicks: [] };
try {
  await bot.open();
  bot.page.on('console', (m) => { if (m.type() === 'error' || /WebGL/.test(m.text())) errs.push(m.text().slice(0, 200)); });
  await bot.goto();
  await bot.waitMenu();
  await bot.click('.main-screen:not(.leaving) .mm-nav-btn[data-nav="settings"]');
  await bot.waitFor(`${S} .set-row`);
  out.rows = await bot.page.evaluate((S) => [...document.querySelectorAll(`${S} .set-row`)].map((r, i) => ({ i, label: r.querySelector('.set-l b')?.textContent.trim(), sub: r.querySelector('.set-l small')?.textContent.trim().slice(0, 120), setting: r.dataset.setting ?? r.querySelector('[data-setting]')?.dataset.setting ?? null, buttons: [...r.querySelectorAll('button')].map((b) => `${b.textContent.trim().slice(0, 24)}${b.disabled ? ' [disabled]' : ''}${b.title ? ` (${b.title.slice(0, 80)})` : ''}`) })), S);
  const n = out.rows.length;
  for (let i = 0; i < n; i++) {
    const row = bot.page.locator(`${S} .set-row`).nth(i);
    if (/language|sprache|langue|idioma/i.test(out.rows[i].label ?? '') || out.rows[i].setting === 'language') continue;
    const bs = row.locator('button');
    const k = await bs.count();
    for (let j = 0; j < k; j++) {
      const b = bs.nth(j);
      if (await b.isDisabled().catch(() => true) || !await b.isVisible().catch(() => false)) continue;
      const before = errs.length;
      const label = `${out.rows[i].label} / ${(await b.textContent().catch(() => ''))?.trim().slice(0, 24)}`;
      try { await b.click({ timeout: 15000 }); } catch (e) { out.clicks.push({ label, clickError: String(e).split('\n')[0].slice(0, 120) }); continue; }
      await sleep(1500);
      const nw = errs.slice(before);
      out.clicks.push({ label, errors: nw.length, first: nw[0] ?? null });
      if (nw.some((e) => /Target crashed/i.test(e))) break;
    }
  }
} catch (e) { out.error = String(e).split('\n')[0].slice(0, 300); }
out.errorsTotal = errs.length;
fs.mkdirSync(o.out, { recursive: true });
fs.writeFileSync(path.join(o.out, `settingsprobe-${o.browser}.json`), JSON.stringify(out, null, 1));
console.log(JSON.stringify({ rows: out.rows.map((r) => `${r.i}:${r.label}:${r.buttons.filter((b) => /disabled/.test(b)).join('|')}`), withErrors: out.clicks.filter((c) => c.errors || c.clickError), error: out.error }).slice(0, 3000));
await browser.close().catch(() => {});
