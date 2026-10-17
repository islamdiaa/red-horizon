// Compose the link-preview images (Open Graph / Twitter / GitHub social preview) from a game frame.
//   node tools/release/og-card.mjs <background.png|jpg> [outDir=public/og]
// Writes red-horizon-1200x630.jpg (og:image, twitter:image) and red-horizon-1280x640.jpg (GitHub's
// Social preview). The background is a HUD-free frame of the game (tools/release/frames.mjs on the
// attract mode); the title, fonts and emblem are the game's own (public/fonts, the loading-screen mark).
import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { root } from './relative-build.mjs';

const [bg, outDir = path.join(root, 'public/og')] = process.argv.slice(2);
if (!bg) { console.error('usage: og-card.mjs <background image> [outDir]'); process.exit(1); }
const b64 = (p) => readFileSync(p).toString('base64');
const font = (f) => `url(data:font/woff2;base64,${b64(path.join(root, 'public/fonts', f))}) format('woff2')`;
const bgType = /\.png$/i.test(bg) ? 'image/png' : 'image/jpeg';
const html = (w, h) => `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: Rajdhani; font-weight: 500; src: ${font('rajdhani-500.woff2')}; }
@font-face { font-family: Rajdhani; font-weight: 600; src: ${font('rajdhani-600.woff2')}; }
@font-face { font-family: Rajdhani; font-weight: 700; src: ${font('rajdhani-700.woff2')}; }
@font-face { font-family: Mono; font-weight: 400; src: ${font('share-tech-mono-400.woff2')}; }
html, body { margin: 0; width: ${w}px; height: ${h}px; overflow: hidden; background: #05070b; }
.card { position: relative; width: ${w}px; height: ${h}px; font-family: Rajdhani, sans-serif; color: #eef3f8; }
.bg { position: absolute; inset: 0; background: url(data:${bgType};base64,${b64(bg)}) center / cover no-repeat; transform: scale(1.04); filter: saturate(1.16) contrast(1.06) brightness(1.1); }
.shade { position: absolute; inset: 0; background:
  linear-gradient(90deg, rgba(4,6,10,.94) 0%, rgba(4,6,10,.82) 30%, rgba(4,6,10,.35) 52%, rgba(4,6,10,0) 68%),
  linear-gradient(0deg, rgba(4,6,10,.75) 0%, rgba(4,6,10,0) 30%),
  radial-gradient(ellipse at 18% 120%, rgba(255,90,58,.28), transparent 55%); }
.edge { position: absolute; left: 0; right: 0; bottom: 0; height: 5px; background: linear-gradient(90deg, #ff5a3a, #ffb08a 40%, transparent 80%); opacity: .9; }
.copy { position: absolute; left: ${Math.round(w * 0.058)}px; top: 0; bottom: 0; display: flex; flex-direction: column; justify-content: center; }
.mark { width: 64px; height: 64px; margin-bottom: 22px; filter: drop-shadow(0 0 18px rgba(255,90,58,.55)); }
.kicker { font-weight: 700; font-size: 19px; letter-spacing: .42em; color: #ffb08a; text-transform: uppercase; display: flex; align-items: center; gap: 14px; }
.kicker::before { content: ''; width: 44px; height: 2px; background: linear-gradient(90deg, transparent, #ff5a3a); }
h1 { margin: 10px 0 0; font-weight: 700; font-size: 124px; line-height: .86; letter-spacing: .08em; text-transform: uppercase; }
h1 span { display: block; }
h1 .r { color: #fff; text-shadow: 0 4px 30px rgba(0,0,0,.6); }
h1 .h { background: linear-gradient(180deg, #ffd2b8 0%, #ff8a5c 45%, #ff4a2a 100%); -webkit-background-clip: text; background-clip: text; color: transparent; filter: drop-shadow(0 6px 26px rgba(255,74,42,.45)); }
.tag { margin-top: 26px; font-weight: 600; font-size: 30px; letter-spacing: .04em; color: #e9eff5; text-shadow: 0 2px 14px rgba(0,0,0,.7); }
.chips { display: flex; gap: 10px; margin-top: 22px; }
.chips span { font-family: Mono, monospace; font-size: 17px; letter-spacing: .06em; padding: 7px 14px; border-radius: 30px; border: 1px solid rgba(255,255,255,.22); background: rgba(10,14,20,.55); color: #dfe8f1; }
.chips span b { color: #8de0a4; font-weight: 400; }
</style></head><body><div class="card"><div class="bg"></div><div class="shade"></div><div class="edge"></div>
<div class="copy">
  <svg class="mark" viewBox="0 0 100 100"><circle cx="50" cy="50" r="44" fill="none" stroke="rgba(255,255,255,0.14)" stroke-width="4"/><circle cx="50" cy="50" r="44" fill="none" stroke="#ff5a3a" stroke-width="4" stroke-linecap="round" stroke-dasharray="70 207"/><circle cx="50" cy="50" r="34" fill="none" stroke="#ffb08a" stroke-width="3" stroke-linecap="round" stroke-dasharray="30 184" stroke-dashoffset="-90" opacity="0.8"/><path d="M50 30l5.9 12.1 13.1 1.9-9.5 9.3 2.2 13.1L50 60.2l-11.7 6.2 2.2-13.1-9.5-9.3 13.1-1.9z" fill="#ff6a46"/></svg>
  <div class="kicker">Cold War real-time strategy</div>
  <h1><span class="r">Red</span><span class="h">Horizon</span></h1>
  <div class="tag">Build a base. Command an army. In your browser.</div>
  <div class="chips"><span><b>●</b> Free</span><span>No install</span><span>Works offline</span></div>
</div></div></body></html>`;

mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ env: { ...process.env, LD_LIBRARY_PATH: path.join(root, 'tools/nsslibs/lib') } });
try {
  for (const [w, h, name] of [[1200, 630, 'red-horizon-1200x630.jpg'], [1280, 640, 'red-horizon-1280x640.jpg']]) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    await page.setContent(html(w, h), { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    const out = path.join(outDir, name);
    await page.screenshot({ path: out, type: 'jpeg', quality: 88 });
    console.log('wrote', path.relative(root, out));
    await page.close();
  }
} finally {
  await browser.close();
}
