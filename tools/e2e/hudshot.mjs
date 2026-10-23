// HUD layout check at given window sizes (mouse or touch): starts a skirmish, then for each size reports HUD
// panels that leave the window (or overlap each other), the layout on show, the share of the window left to the
// battlefield (not under the sidebar / build bar / top panels), and takes a screenshot.
//
//   node tools/e2e/hudshot.mjs <url> <outDir> [390x844,844x390,...] [--touch] [--classic] [--lang de]
//
// --classic  the Classic layout setting (Settings › Interface layout; it shows as Modern where the sidebar can't fit)
// --lang     the interface language (rh.lang)
import fs from 'node:fs';
import path from 'node:path';
import { openBrowser, sleep } from './lib.mjs';

const [url, out, sizesArg = '390x844,600x900,800x600,1280x720', ...rest] = process.argv.slice(2);
const touch = rest.includes('--touch');
const classic = rest.includes('--classic');
const lang = rest.includes('--lang') ? rest[rest.indexOf('--lang') + 1] : null;
const tag = `${touch ? '-touch' : ''}${classic ? '-classic' : ''}${lang ? `-${lang}` : ''}`;
fs.mkdirSync(out, { recursive: true });
const browser = await openBrowser({ browser: 'chromium' });
const sizes = sizesArg.split(',').map((s) => s.split('x').map(Number));
const ctx = await browser.newContext({ viewport: { width: sizes[0][0], height: sizes[0][1] }, hasTouch: touch, isMobile: touch });
await ctx.addInitScript(([classic, lang]) => {
  try {
    if (classic) localStorage.setItem('rh.settings', JSON.stringify({ ...JSON.parse(localStorage.getItem('rh.settings') ?? '{}'), hudLayout: 'classic' }));
    if (lang) localStorage.setItem('rh.lang', lang);
  } catch { /* storage blocked */ }
}, [classic, lang]);
const page = await ctx.newPage();
const u = new URL(url);
for (const [k, v] of Object.entries({ autostart: 1, debug: 1, units: 'mcv', size: 64, intro: 0, rules: 'commander' })) u.searchParams.set(k, String(v));
await page.goto(u.href, { waitUntil: 'load', timeout: 180000 });
await page.waitForFunction(() => window.__game?.hud && !document.body.classList.contains('cine-active'), null, { timeout: 180000, polling: 500 });
await sleep(3000);
const report = [];
for (const [w, h] of sizes) {
  await page.setViewportSize({ width: w, height: h });
  await sleep(2500);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const r = await page.evaluate(() => {
    const vis = (e) => { const b = e.getBoundingClientRect(); const cs = getComputedStyle(e); return b.width > 4 && b.height > 4 && cs.display !== 'none' && cs.visibility !== 'hidden' && +cs.opacity > 0.05 ? b : null; };
    const els = [...document.querySelectorAll('#ui > *, #ui :is(#buildbar, #sidebar, #topbar, #topright, #dock, #minimap-panel, #selpanel, #cmdpanel)')];
    const off = [], boxes = [];
    for (const e of els) {
      const b = vis(e);
      if (!b) continue;
      const name = e.id || String(e.className).split(' ')[0];
      if (b.right > innerWidth + 2 || b.bottom > innerHeight + 2 || b.left < -2 || b.top < -2) off.push(`${name} [${Math.round(b.left)},${Math.round(b.top)},${Math.round(b.right)},${Math.round(b.bottom)}]`);
      if (['topright', 'topbar', 'buildbar', 'minimap-panel', 'dock', 'sidebar', 'cmdpanel'].includes(e.id)) boxes.push({ name, b: { l: b.left, t: b.top, r: b.right, b: b.bottom } });
    }
    const overlaps = [];
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i].b, c = boxes[j].b;
      const ox = Math.min(a.r, c.r) - Math.max(a.l, c.l), oy = Math.min(a.b, c.b) - Math.max(a.t, c.t);
      if (ox > 6 && oy > 6) overlaps.push(`${boxes[i].name}x${boxes[j].name} ${Math.round(ox)}x${Math.round(oy)}`);
    }
    const bb = document.getElementById('buildbar')?.getBoundingClientRect();
    // the battlefield left over: a grid of sample points, the share whose top element is the game canvas
    let free = 0, n = 0;
    for (let y = 4; y < innerHeight; y += 16) for (let x = 4; x < innerWidth; x += 16) { n++; const e = document.elementFromPoint(x, y); if (e && (e.id === 'game-canvas' || e.classList.contains('overlay-canvas'))) free++; }
    const sb = document.getElementById('sidebar')?.getBoundingClientRect();
    // the top bars' items (what an overlap between them is made of)
    const items = (id) => [...(document.getElementById(id)?.children ?? [])].map((e) => { const b = vis(e); return b ? `${String(e.className).split(' ')[0] || e.id}[${Math.round(b.left)}-${Math.round(b.right)}]` : null; }).filter(Boolean).join(' ');
    return {
      layout: document.body.classList.contains('hud-modern') ? 'modern' : 'classic', fallback: document.body.classList.contains('hud-fallback'),
      battlefield: Math.round((100 * free) / Math.max(1, n)), sidebarShare: sb ? Math.round((100 * sb.width) / innerWidth) : 0,
      topbar: items('topbar'), topright: items('topright'),
      off, overlaps, buildbar: bb ? [Math.round(bb.left), Math.round(bb.top), Math.round(bb.width), Math.round(bb.height)] : null, coarse: matchMedia('(pointer: coarse)').matches,
    };
  });
  report.push({ size: `${w}x${h}`, ...r });
  console.log(`${w}x${h}${tag}: ${r.layout}${r.fallback ? ' (Classic chosen: fallback)' : ''}, battlefield ${r.battlefield}%${r.sidebarShare ? `, sidebar ${r.sidebarShare}% wide` : ''}; off ${JSON.stringify(r.off)} overlaps ${JSON.stringify(r.overlaps)} buildbar ${JSON.stringify(r.buildbar)} coarse ${r.coarse}${r.overlaps.length ? `\n  topbar: ${r.topbar}\n  topright: ${r.topright}` : ''}`);
  await page.screenshot({ path: path.join(out, `hud-${w}x${h}${tag}.png`) });
}
fs.writeFileSync(path.join(out, `hud${tag}.json`), JSON.stringify(report, null, 1));
await browser.close();
