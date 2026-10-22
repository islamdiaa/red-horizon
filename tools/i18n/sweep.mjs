// Translation sweep: walks the real interface in one language (headless Chromium, the e2e bot's browser setup),
// collects every text it shows (text nodes and title / aria-label / placeholder / alt / data-tip attributes, as the
// screens open), lists the English that is still there, and takes a screenshot of each screen (text fit).
//
//   node --import tsx tools/i18n/sweep.mjs [--url http://127.0.0.1:5316/] [--lang de] [--out dir] [--size 1280x720]
//                                         [--only menu,game,editor] [--slow 2]
//
// Needs a running game (a dev server: `npx vite --config tools/vite.<you>.config.ts`, or `node tools/e2e/serve.mjs`
// on a build). Writes <out>/<lang>/texts.json (everything seen, per screen), english.txt (the suspects) and
// screenshots. A suspect is text that is exactly an English catalogue string the language translates differently,
// or that reads as English (two or more common English words). Run it on de / ru: English words stand out there.
import fs from 'node:fs';
import path from 'node:path';
import { openBrowser, ROOT, sleep } from '../e2e/lib.mjs';
import { loadEnglish, loadLocale } from './lib.ts';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const url = opt('url', 'http://127.0.0.1:5316/');
const lang = opt('lang', 'de');
const out = path.join(opt('out', path.join(ROOT, 'screenshots/l10n')), lang);
const [W, H] = opt('size', '1280x720').split('x').map(Number);
const only = (opt('only', 'menu,game,editor') ?? '').split(',');
const slow = Number(opt('slow', '1'));
fs.mkdirSync(out, { recursive: true });

// ---------------------------------------------------------------------------------------------------------------
// in the page: collect what is shown
const HARVEST = () => {
  const seen = (window.__l10n = window.__l10n || new Map());
  const ATTRS = ['title', 'aria-label', 'placeholder', 'alt', 'data-tip', 'data-tooltip', 'data-full'];
  let screen = 'start';
  window.__l10nScreen = (s) => { screen = s; };
  const add = (s, how) => {
    if (!s) return;
    const t = String(s).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/\s+/g, ' ').trim();
    if (!t || !/\p{L}{2,}/u.test(t)) return;
    const k = `${t}`;
    if (!seen.has(k)) seen.set(k, { how, screen });
  };
  const visit = (root) => {
    if (!root) return;
    if (root.nodeType === 3) { if (!/^(SCRIPT|STYLE|NOSCRIPT)$/.test(root.parentElement?.tagName ?? '')) add(root.nodeValue, 'text'); return; }
    if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    for (let n = w.currentNode; n; n = w.nextNode()) {
      if (n.nodeType === 3) { if (!/^(SCRIPT|STYLE|NOSCRIPT)$/.test(n.parentElement?.tagName ?? '')) add(n.nodeValue, 'text'); }
      else if (n.nodeType === 1) {
        for (const a of ATTRS) if (n.hasAttribute?.(a)) add(n.getAttribute(a), a);
        if ((n.tagName === 'INPUT' && (n.type === 'button' || n.type === 'submit')) || n.tagName === 'OPTION') add(n.value && n.tagName === 'INPUT' ? n.value : n.textContent, 'value');
        if (n.tagName === 'OPTGROUP') add(n.label, 'label');
      }
    }
  };
  const start = () => {
    visit(document.documentElement);
    new MutationObserver((ms) => {
      for (const m of ms) {
        if (m.type === 'childList') m.addedNodes.forEach(visit);
        else if (m.type === 'characterData') add(m.target.nodeValue, 'text');
        else if (m.type === 'attributes') add(m.target.getAttribute(m.attributeName), m.attributeName);
      }
    }).observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  };
  if (document.documentElement) start(); else document.addEventListener('DOMContentLoaded', start);
  // canvas text (floating labels, the editor's map labels): record what fillText draws
  const ft = CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText = function (text, ...rest) { add(text, 'canvas'); return ft.call(this, text, ...rest); };
  // native dialogs
  for (const f of ['alert', 'confirm', 'prompt']) { const orig = window[f]; window[f] = (msg, ...r) => { add(msg, f); return f === 'confirm' ? false : f === 'prompt' ? null : orig?.call(window, msg, ...r); }; }
};

const browser = await openBrowser({ browser: 'chromium', headed: false });
const context = await browser.newContext({ viewport: { width: W, height: H }, locale: lang === 'zh-CN' ? 'zh-CN' : `${lang}-${lang.toUpperCase()}`, acceptDownloads: false });
await context.addInitScript(HARVEST);
await context.addInitScript(([l]) => { try { localStorage.setItem('rh.lang', l); } catch { /* ignore */ } }, [lang]);
const page = await context.newPage();
page.setDefaultTimeout(30000 * slow);
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
page.on('dialog', (d) => d.dismiss().catch(() => {}));

const texts = new Map(); // text -> { how, screen }
const clipped = new Map(); // text -> { screen, sel, over }
let shotN = 0;
/** Text that doesn't fit its box on screen now: clipped (overflow hidden / ellipsis) or spilling out of a fixed box. */
const FIT = () => {
  const out = [];
  const sel = (e) => { const p = []; for (let n = e; n && n !== document.body && p.length < 4; n = n.parentElement) p.unshift(n.tagName.toLowerCase() + (n.id ? `#${n.id}` : '') + (n.classList.length ? '.' + [...n.classList].slice(0, 2).join('.') : '')); return p.join(' > '); };
  for (const e of document.querySelectorAll('body *')) {
    if (!e.childNodes.length || ![...e.childNodes].some((c) => c.nodeType === 3 && c.nodeValue.trim())) continue;
    const r = e.getBoundingClientRect();
    if (!r.width || !r.height || r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) continue;
    const cs = getComputedStyle(e);
    if (cs.visibility === 'hidden' || +cs.opacity === 0) continue;
    const overX = e.scrollWidth - e.clientWidth, overY = e.scrollHeight - e.clientHeight;
    const clips = cs.overflowX !== 'visible' || cs.textOverflow === 'ellipsis';
    if ((clips && overX > 2 && cs.overflowX !== 'auto' && cs.overflowX !== 'scroll') || (cs.overflowY === 'hidden' && overY > 3 && cs.webkitLineClamp === 'none')) out.push({ t: e.textContent.trim().slice(0, 120), sel: sel(e), over: Math.max(overX, overY) });
    else if (r.right > innerWidth + 2 || r.left < -2) out.push({ t: e.textContent.trim().slice(0, 120), sel: sel(e), over: Math.round(Math.max(r.right - innerWidth, -r.left)), off: 1 });
  }
  return out;
};
const harvest = async (screen) => {
  const got = await page.evaluate(() => [...(window.__l10n ?? new Map()).entries()]).catch(() => []);
  for (const [t, v] of got) if (!texts.has(t)) texts.set(t, v.screen === 'start' ? { ...v, screen } : v);
  const fit = await page.evaluate(FIT).catch(() => []);
  for (const f of fit) if (!clipped.has(f.t)) clipped.set(f.t, { screen, ...f });
  await page.evaluate((s) => window.__l10nScreen?.(s), screen).catch(() => {});
};
const shot = async (label) => {
  const file = path.join(out, `${String(++shotN).padStart(2, '0')}-${label}.png`);
  await page.screenshot({ path: file }).catch(() => {});
};
const setScreen = (s) => page.evaluate((x) => window.__l10nScreen?.(x), s).catch(() => {});
const goto = async (q = '') => {
  await page.goto(url + q, { waitUntil: 'load', timeout: 120000 * slow });
};
const waitMenu = async () => {
  await page.waitForSelector('.main-screen:not(.leaving) .mm-nav-btn', { state: 'visible', timeout: 120000 * slow });
  await sleep(1500 * slow);
};
const clickAll = async (selector, label, { max = 12, after = 900 } = {}) => {
  const n = Math.min(max, await page.locator(selector).count().catch(() => 0));
  for (let i = 0; i < n; i++) {
    const l = page.locator(selector).nth(i);
    if (!(await l.isVisible().catch(() => false))) continue;
    await l.click({ timeout: 5000 }).catch(() => {});
    await sleep(after * slow);
    await harvest(`${label}#${i}`);
  }
};
const TABS = '[role="tab"]:visible, .vr-tab:visible, .tab:visible, .tabs button:visible, .seg-tabs button:visible, .ed-tab:visible';

// ---------------------------------------------------------------------------------------------------------------
if (only.includes('menu')) {
  await goto();
  await waitMenu();
  await setScreen('main');
  await shot('main');
  await harvest('main');
  // every main-menu entry except the ones that start a battle (▶ continue, » quick battle, 00 boot camp) and the
  // skirmish panel already on show (02); the editor gets its own pass
  const entries = await page.locator('.main-screen .mm-nav-btn').evaluateAll((bs) => bs.map((b, i) => ({ i, idx: b.querySelector('.nb-idx')?.textContent ?? '', label: b.querySelector('.nb-label')?.textContent ?? '' })));
  for (const e of entries) {
    if (['▶', '»', '00', '02'].includes(e.idx)) continue;
    await goto();
    await waitMenu();
    const name = `menu-${e.idx}`;
    await setScreen(name);
    await page.locator('.main-screen .mm-nav-btn').nth(e.i).click().catch(() => {});
    await sleep(2500 * slow);
    if (await page.locator('.ed').isVisible().catch(() => false)) continue; // the editor (own pass)
    await shot(name);
    await harvest(name);
    await clickAll(TABS, name, { max: 10 });
    await shot(`${name}-tabs`);
    // a first card or row on the screen (a campaign mission, a challenge...): its details
    for (const sel of ['.cmp-card:visible', '.cmp-node:visible', '.ch-card:visible', '.mission-card:visible', '.cq-new:visible button']) {
      const l = page.locator(sel).first();
      if (await l.isVisible().catch(() => false)) { await l.click({ timeout: 4000 }).catch(() => {}); await sleep(1500 * slow); await harvest(`${name}-detail`); await shot(`${name}-detail`); break; }
    }
  }
  // the skirmish panel's pickers (map picker, mutators...)
  await goto();
  await waitMenu();
  await setScreen('skirmish');
  await clickAll('.main-screen .mm-panel .vr-tab', 'skirmish-rules', { max: 2 });
  await shot('skirmish-panel');
}

if (only.includes('game')) {
  // a match: HUD, sidebar tabs, tooltips (data-tip), the pause menu, the results screen
  await goto('?autostart=1&debug=1&units=light&ai=easy&intro=0');
  await page.waitForFunction(() => window.__game?.world, null, { timeout: 180000 * slow, polling: 500 });
  await setScreen('hud');
  await sleep(6000 * slow);
  await harvest('hud');
  await shot('hud');
  await clickAll('#sidebar .tab:visible, .bb-tab:visible, .bt-tab:visible, [data-tab]:visible', 'hud-tabs', { max: 8, after: 500 });
  // select the army (selection panel, orders)
  await page.evaluate(() => { const g = window.__game; const mine = g.world.entities?.filter?.((e) => e.owner === g.local.id && e.kind !== 'building').slice(0, 6) ?? []; g.selectEntities?.(mine); }).catch(() => {});
  await sleep(1500 * slow);
  await harvest('hud-selection');
  await shot('hud-selection');
  await page.keyboard.press('Escape');
  await sleep(2000 * slow);
  await harvest('pause');
  await shot('pause');
  await clickAll('.pause-menu button:visible, .pm-tabs button:visible', 'pause-items', { max: 3, after: 1200 });
  await page.keyboard.press('Escape');
  // end the match: the results screen
  await page.evaluate(() => { const g = window.__game; g.world.gameOver = true; g.world.winner = g.local.team ?? 0; if ('endTimer' in g) g.endTimer = 0.01; }).catch(() => {});
  await sleep(8000 * slow);
  await harvest('results');
  await shot('results');
}

if (only.includes('editor')) {
  await goto();
  await waitMenu();
  await setScreen('editor');
  // open the editor: the main-menu entry that shows the .ed root (tried from the last entry up)
  const n = await page.locator('.main-screen .mm-nav-btn').count();
  for (let i = n - 1; i >= 0; i--) {
    await page.locator('.main-screen .mm-nav-btn').nth(i).click().catch(() => {});
    await sleep(3000 * slow);
    if (await page.locator('.ed').isVisible().catch(() => false)) break;
    await goto(); await waitMenu();
  }
  if (await page.locator('.ed').isVisible().catch(() => false)) {
    await harvest('editor');
    await shot('editor');
    await clickAll('.ed-tab', 'editor-tab', { max: 4, after: 700 });
    await shot('editor-tabs');
    // every tool (its options and hints), mission mode, the dialogs
    await clickAll('.ed-tool', 'editor-tool', { max: 20, after: 300 });
    await page.keyboard.press('KeyM'); await sleep(1000 * slow);
    await harvest('editor-mission');
    await clickAll('.ed-tool', 'editor-mtool', { max: 6, after: 300 });
    await page.locator('.ed-tab').nth(2).click().catch(() => {}); await sleep(800 * slow);
    // add an objective, a trigger and an action of every kind (the forms)
    for (const sel of ['.ed-h .ed-b']) await clickAll(sel, 'editor-add', { max: 4, after: 600 });
    await shot('editor-mission');
    const kinds = page.locator('.ed-card-h select');
    const kc = await kinds.count();
    for (let i = 0; i < kc; i++) {
      const opts = await kinds.nth(i).locator('option').evaluateAll((os) => os.map((o) => o.value));
      for (const v of opts) { await kinds.nth(i).selectOption(v).catch(() => {}); await sleep(250 * slow); }
    }
    await harvest('editor-forms');
    for (const b of ['.ed-top .ed-b']) await clickAll(b, 'editor-top', { max: 14, after: 900 });
    await shot('editor-end');
  }
}

// ---------------------------------------------------------------------------------------------------------------
// analysis: which of the texts are English
const en = await loadEnglish();
const loc = loadLocale(lang);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const strip = (s) => s.replace(/\[\/?(?:b|i|em|strong|kbd|small)\]|\[br\]/g, '').replace(/\s+/g, ' ').trim();
// English templates the language translates differently (a param matches anything; plural/select: skip the branches)
const templates = [];
for (const [k, v] of Object.entries(en)) {
  if (!loc[k] || loc[k] === v) continue;
  const s = strip(v);
  if (/^[\p{Lu}\d\s\W]{0,3}$/u.test(s) || s.replace(/\{[^}]*\}/g, '').replace(/[^A-Za-z]/g, '').length < 4) continue;
  if (/\{\w+, (plural|select)/.test(s)) continue;
  templates.push({ k, re: new RegExp(`^${s.split(/(\{\w+(?::\w+)?\})/).map((p) => (/^\{.*\}$/.test(p) ? '.+?' : esc(p))).join('')}$`, 'i') });
}
const WORDS = /\b(the|and|your|you|with|for|this|that|from|are|is|of|to|has|have|will|can't|cannot|not|every|all|enemy|units?|build|click|press|select|until|when|before|after|here|there|more|less)\b/gi;
const englishish = (t) => {
  if (/[Ѐ-ӿ一-鿿]/.test(t) && !/[A-Za-z]{3,}\s+[A-Za-z]{3,}/.test(t)) return false;
  const m = t.match(WORDS) ?? [];
  return new Set(m.map((x) => x.toLowerCase())).size >= 2;
};
const suspects = [];
for (const [t, v] of texts) {
  const hit = templates.find((x) => x.re.test(t));
  if (hit) suspects.push({ t, why: `catalogue ${hit.k}`, ...v });
  else if (englishish(t)) suspects.push({ t, why: 'reads as English', ...v });
}
fs.writeFileSync(path.join(out, 'texts.json'), JSON.stringify(Object.fromEntries(texts), null, 1));
fs.writeFileSync(path.join(out, 'english.txt'), suspects.map((s) => `[${s.screen}] (${s.how}; ${s.why}) ${s.t}`).join('\n') + '\n');
fs.writeFileSync(path.join(out, 'clipped.txt'), [...clipped.values()].sort((a, b) => b.over - a.over).map((c) => `[${c.screen}] ${c.off ? 'off-screen' : 'clipped'} ${c.over}px  ${c.sel}  "${c.t}"`).join('\n') + '\n');
console.log(`${lang}: ${texts.size} texts seen, ${suspects.length} English suspects (english.txt), ${clipped.size} clipped texts (clipped.txt) in ${out}`);
if (pageErrors.length) console.log(`page errors: ${[...new Set(pageErrors)].slice(0, 5).join(' | ')}`);
await browser.close();
