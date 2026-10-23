// The menus in other languages, in any browser (a test VM or the rig): for each locale the browser announces, every
// main-menu screen is opened by a click, screenshotted and checked for what a player would notice: raw translation keys
// or unfilled {placeholders}, text clipped by its box, controls pushed off the screen, sideways scrolling, strings
// still identical to the English run (a candidate list, reviewed by hand: names and numbers stay the same), and which
// font faces actually loaded (CJK and Cyrillic subsets).
//
//   node tools/xb/vmmenus.mjs [locales=en-US,de-DE,zh-CN] [--browser ..] [--channel ..] [--executable ..] [--slow 4]
// Run it like vmplay.mjs (tools/xb/vme2e.sh in a VM). Writes OUT_DIR/vmmenus-<browser>.json and screenshots.
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const locales = (argv[0] && !argv[0].startsWith('--') ? argv.shift() : 'en-US,de-DE,zh-CN').split(',');
if (!argv.includes('--slow')) argv.push('--slow', '3');
const { parseArgs, openBrowser, Bot, sleep } = await import('../e2e/lib.mjs');
const o = parseArgs(argv);
const who = o.channel ?? o.browser;
fs.mkdirSync(o.out, { recursive: true });
const SCREENS = ['skirmish', 'rules', 'campaign', 'conquest', 'multiplayer', 'challenges', 'replays', 'commander', 'settings', 'controls', 'mods'];

/** What is on screen now (page function). */
function audit() {
  const vis = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0.05; };
  const texts = [], raw = [], clipped = [], offscreen = [];
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n; (n = w.nextNode());) {
    const t = n.textContent.replace(/\s+/g, ' ').trim();
    const el = n.parentElement;
    if (!t || !el || el.closest('script,style,canvas,svg') || !vis(el)) continue;
    texts.push(t);
    if (/^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9_-]+)+$/.test(t) || /\{[a-zA-Z_]+\}/.test(t) || /\bundefined\b|\bNaN\b|\[object /.test(t)) raw.push(t.slice(0, 100));
  }
  const desc = (el) => `${el.tagName.toLowerCase()}.${[...el.classList].slice(0, 2).join('.')} "${el.textContent.replace(/\s+/g, ' ').trim().slice(0, 50)}"`;
  for (const el of document.querySelectorAll('button, label, h1, h2, h3, h4, .nb-label, .set-l b, .set-l small, .seg button, [class*="title"], [class*="tab"], th, .btn, .chip, .pill, kbd')) {
    if (!vis(el) || !el.textContent.trim()) continue;
    const cs = getComputedStyle(el);
    const clips = cs.overflowX !== 'visible' || cs.textOverflow === 'ellipsis' || cs.whiteSpace === 'nowrap';
    if (clips && el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0) clipped.push(`${desc(el)} ${el.scrollWidth}>${el.clientWidth}`);
    else if (clips && el.scrollHeight > el.clientHeight + 3 && cs.overflowY === 'hidden' && el.clientHeight > 0) clipped.push(`${desc(el)} h ${el.scrollHeight}>${el.clientHeight}`);
    const r = el.getBoundingClientRect();
    if (r.right > innerWidth + 1 || r.left < -1) offscreen.push(`${desc(el)} x ${Math.round(r.left)}..${Math.round(r.right)}`);
  }
  const fonts = [...document.fonts].filter((f) => f.status === 'loaded').map((f) => `${f.family.replace(/"/g, '')} ${f.weight}${f.unicodeRange && f.unicodeRange !== 'U+0-10FFFF' ? ' (subset)' : ''}`);
  const bodyFont = getComputedStyle(document.querySelector('.mm-nav-btn, .screen, body')).fontFamily;
  return { lang: document.documentElement.lang, texts: [...new Set(texts)], raw: [...new Set(raw)], clipped: [...new Set(clipped)].slice(0, 25), offscreen: [...new Set(offscreen)].slice(0, 25), sideways: document.documentElement.scrollWidth > innerWidth + 1, fonts: [...new Set(fonts)], bodyFont };
}

const report = { browser: who, url: o.url, locales: {} };
const browser = await openBrowser(o);
report.version = browser.version();
let english = null;
for (const loc of locales) {
  o.locale = loc;
  const bot = new Bot(o, browser, `menus-${who}-${loc}`);
  const L = report.locales[loc] = { screens: {}, errors: [] };
  try {
    await bot.open();
    await bot.goto();
    await bot.waitMenu(240000);
    for (const s of SCREENS) {
      try {
        if (s === 'rules') {
          const tab = bot.page.locator('.main-screen:not(.leaving) .mm-panel .vr-tab').nth(1);
          if (!await tab.count()) { L.screens[s] = { skipped: 'no rules tab' }; continue; }
          await tab.click();
        } else if (s !== 'skirmish') {
          const b = bot.page.locator(`.main-screen:not(.leaving) .mm-nav-btn[data-nav="${s}"]`);
          if (!await b.count()) { L.screens[s] = { skipped: 'not in the menu' }; continue; }
          await b.click();
        }
        await sleep(1800 * Math.min(2, o.slow));
        const a = await bot.page.evaluate(audit);
        await bot.shot(s);
        L.screens[s] = { raw: a.raw, clipped: a.clipped, offscreen: a.offscreen, sideways: a.sideways, n: a.texts.length, lang: a.lang };
        L.fonts = [...new Set([...(L.fonts ?? []), ...a.fonts])];
        L.bodyFont = a.bodyFont;
        (L.texts ??= new Set()); a.texts.forEach((t) => L.texts.add(t));
      } catch (e) { L.screens[s] = { error: String(e.message ?? e).split('\n')[0].slice(0, 200) }; }
      // back to the main menu: Esc, else reload
      if (s === 'rules') { await bot.page.locator('.main-screen:not(.leaving) .mm-panel .vr-tab').nth(0).click().catch(() => {}); continue; }
      if (s === 'skirmish') continue;
      await bot.page.keyboard.press('Escape');
      const back = await bot.page.waitForSelector('.main-screen:not(.leaving) .mm-nav-btn', { state: 'visible', timeout: 8000 * o.slow }).then(() => true, () => false);
      if (!back) { L.screens[s].escFailed = true; await bot.goto(); await bot.waitMenu(240000); }
      await sleep(600);
    }
    await bot.noErrors(`menus ${loc}`);
  } catch (e) { L.error = String(e.message ?? e).split('\n')[0].slice(0, 300); await bot.shot('error').catch(() => {}); }
  L.errors = [...new Set([...bot.errors, ...bot.allErrors])].slice(0, 10);
  L.csp = bot.csp.slice(0, 5);
  L.checks = bot.checks.filter((c) => !c.ok).map((c) => `${c.what}: ${c.detail}`.slice(0, 300));
  const texts = [...(L.texts ?? [])];
  delete L.texts;
  if (loc.startsWith('en')) english = new Set(texts);
  else if (english) {
    // strings still identical to English: at least two words or a long word, with letters (names / numbers / keys excepted by eye)
    L.sameAsEnglish = texts.filter((t) => english.has(t) && /[a-z]{3}/i.test(t) && (/\s/.test(t) || t.length >= 9)).slice(0, 60);
  }
  fs.writeFileSync(path.join(bot.dir, 'log.txt'), bot.logLines.join('\n') + '\n');
  await bot.context.close().catch(() => {});
}
fs.writeFileSync(path.join(o.out, `vmmenus-${who}.json`), JSON.stringify(report, null, 1));
for (const [loc, L] of Object.entries(report.locales)) {
  const sc = Object.entries(L.screens);
  console.log(loc, JSON.stringify({ raw: sc.flatMap(([, s]) => s.raw ?? []).length, clipped: sc.reduce((a, [, s]) => a + (s.clipped?.length ?? 0), 0), offscreen: sc.reduce((a, [, s]) => a + (s.offscreen?.length ?? 0), 0), sideways: sc.filter(([, s]) => s.sideways).map(([k]) => k), same: L.sameAsEnglish?.length ?? null, errors: L.errors.length, fonts: L.fonts?.length, err: L.error ?? null }));
}
await browser.close();
process.exit(0);
