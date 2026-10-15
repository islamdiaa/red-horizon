// Generates the PWA icons in public/icons/ from an SVG emblem (red star in a ring on a dark
// background, matching the favicon / loading-screen mark) by rendering it with headless Chromium,
// plus two 1280x720 store screenshots for the install dialog.
//   npm run icons
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'public/icons');
mkdirSync(out, { recursive: true });

/** Five-pointed star path centred on (cx, cy). */
function star(cx, cy, R, r) {
  const pts = [];
  for (let k = 0; k < 10; k++) {
    const a = -Math.PI / 2 + (k * Math.PI) / 5;
    const rad = k % 2 ? r : R;
    pts.push(`${(cx + Math.cos(a) * rad).toFixed(2)} ${(cy + Math.sin(a) * rad).toFixed(2)}`);
  }
  return `M${pts.join('L')}Z`;
}

/**
 * @param {'any'|'maskable'} purpose  'any' = rounded tile with transparent corners;
 *   'maskable' = full-bleed square, emblem inside the 80 % safe circle.
 */
function emblemSvg(purpose) {
  const S = 512, c = S / 2;
  const k = purpose === 'maskable' ? 0.78 : 1; // keep the emblem in the maskable safe zone
  const ringR = 178 * k, ringW = 20 * k;
  const bg = purpose === 'maskable'
    ? `<rect width="${S}" height="${S}" fill="url(#bg)"/>`
    : `<rect x="8" y="8" width="${S - 16}" height="${S - 16}" rx="108" fill="url(#bg)"/><rect x="8.5" y="8.5" width="${S - 17}" height="${S - 17}" rx="108" fill="none" stroke="rgba(90,180,255,0.18)" stroke-width="3"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" width="${S}" height="${S}">
  <defs>
    <radialGradient id="bg" cx="50%" cy="40%" r="75%">
      <stop offset="0" stop-color="#1a2738"/><stop offset="0.55" stop-color="#0b111a"/><stop offset="1" stop-color="#05070b"/>
    </radialGradient>
    <radialGradient id="halo" cx="50%" cy="50%" r="50%">
      <stop offset="0.45" stop-color="#ff5a3a" stop-opacity="0.28"/><stop offset="1" stop-color="#ff5a3a" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="star" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ff9466"/><stop offset="0.55" stop-color="#ff5a3a"/><stop offset="1" stop-color="#c8301f"/>
    </linearGradient>
    <linearGradient id="ring" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ff7a52"/><stop offset="1" stop-color="#b8281a"/>
    </linearGradient>
  </defs>
  ${bg}
  <circle cx="${c}" cy="${c}" r="${ringR * 1.18}" fill="url(#halo)"/>
  <circle cx="${c}" cy="${c}" r="${ringR}" fill="none" stroke="rgba(255,255,255,0.07)" stroke-width="${ringW * 2.2}"/>
  <circle cx="${c}" cy="${c}" r="${ringR}" fill="none" stroke="url(#ring)" stroke-width="${ringW}"/>
  <circle cx="${c}" cy="${c}" r="${ringR - ringW * 1.6}" fill="none" stroke="rgba(255,176,138,0.35)" stroke-width="${ringW * 0.25}" stroke-dasharray="${ringR * 0.5} ${ringR * 0.32}"/>
  <path d="${star(c, c + 6 * k, 124 * k, 50 * k)}" fill="url(#star)" stroke="#ffb08a" stroke-opacity="0.55" stroke-width="${3 * k}" stroke-linejoin="round"/>
</svg>`;
}

const anySvg = emblemSvg('any');
const maskSvg = emblemSvg('maskable');
writeFileSync(path.join(out, 'icon.svg'), anySvg);
writeFileSync(path.join(out, 'maskable.svg'), maskSvg);

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  env: { ...process.env, LD_LIBRARY_PATH: path.join(root, 'tools/nsslibs/lib') },
});
const page = await browser.newPage({ deviceScaleFactor: 1 });

async function render(svg, size, file, transparent) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<!doctype html><html><body style="margin:0;background:${transparent ? 'transparent' : '#05070b'}">
    <img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}" width="${size}" height="${size}" style="display:block"></body></html>`);
  await page.waitForFunction(() => document.images[0]?.complete);
  await page.screenshot({ path: path.join(out, file), omitBackground: transparent, clip: { x: 0, y: 0, width: size, height: size } });
  console.log('wrote', file);
}

await render(anySvg, 192, 'icon-192.png', true);
await render(anySvg, 512, 'icon-512.png', true);
await render(maskSvg, 192, 'maskable-192.png', false);
await render(maskSvg, 512, 'maskable-512.png', false);
await render(maskSvg, 180, 'apple-touch-icon.png', false);
await render(anySvg, 32, 'favicon-32.png', true);

// store screenshots (install dialog "richer UI"): downscale the README shots
const shots = path.join(root, 'public/screenshots');
mkdirSync(shots, { recursive: true });
for (const name of ['menu', 'battle']) {
  const src = path.join(root, 'docs', `${name}.jpg`);
  if (!existsSync(src)) continue;
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.setContent(`<!doctype html><body style="margin:0"><img src="data:image/jpeg;base64,${readFileSync(src).toString('base64')}" style="width:1280px;height:720px;display:block;object-fit:cover"></body>`);
  await page.waitForFunction(() => document.images[0]?.complete);
  await page.screenshot({ path: path.join(shots, `${name}.jpg`), type: 'jpeg', quality: 78 });
  console.log('wrote screenshots/' + name + '.jpg');
}
await browser.close();
