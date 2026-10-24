// World Conquest region battlefields on the real-GPU rig (MAPS): what a player sees at the start of a region battle
// (the start camera, HUD and fog as they are) and an overview of the whole battlefield, per climate. Uses the
// testing hook ?autostart=1&conquest=<kind>&region=<id> (src/maps/region-test.ts) on a built game.
//   node tools/world/maps-shots.mjs <url> [preset=high] [outDir=/out] [cases=region:kind:seed,...]
// Writes <out>/maps-<preset>.jpg (contact sheet: start view | overview per case), <out>/tiles/*.png, a JSON line per case.
import fs from 'node:fs';
import { launchGpu, openMatch } from '../gpu-rig/lib.mjs';

const [base = 'http://127.0.0.1:5323/', preset = 'high', out = '/out', caseArg = ''] = process.argv.slice(2);
const CASES = caseArg ? caseArg.split(',') : [
  'cairo:assault:7', 'petra:assault:11', 'samarkand:hold:7', 'arabia:assault:9',
  'paris:assault:7', 'london:assault:11', 'tokyo:assault:7', 'sydney:naval:7',
  'alps:assault:7', 'moscow:assault:11', 'iceland:assault:7', 'stalingrad:defend:9',
  'angkor:assault:7', 'rio:assault:11', 'zambezi:assault:7', 'bangkok:boss:9',
];
const W = 1280, H = 720, TW = 640, TH = 360;
fs.mkdirSync(`${out}/tiles`, { recursive: true });
const browser = await launchGpu();
const tiles = [];
for (const c of CASES) {
  const [region, kind, seed] = c.split(':');
  const url = `${base}?autostart=1&intro=0&conquest=${kind}&region=${region}&seed=${seed}&q=${preset}&hd=1`;
  let s;
  try {
    // (a Conquest battle takes the saved settings' quality, not `q=`: set it before the page loads)
    s = await openMatch(browser, url, { width: W, height: H, init: [`try { localStorage.setItem('rh.settings', JSON.stringify({ ...JSON.parse(localStorage.getItem('rh.settings') || '{}'), quality: '${preset}' })); } catch {}`] });
    // skip the opening cinematic (any key), let its overlay fade
    await s.page.keyboard.press('Shift');
    await s.page.evaluate(() => window.__rig.frame(40));
    const info = await s.page.evaluate(() => {
      const g = window.__game, m = g.world.map, cam = g.gfx.cam;
      g.cameraDirector = null;
      // the start camera, settled (the drop-in skipped)
      const s0 = m.startPositions[0], f = m.startFocus ?? { x: s0.x, y: s0.y + 1 };
      cam.jumpTo(f.x, f.y);
      cam.dist = cam.targetDist = f.dist ?? 20;
      g.hours = 11; // (the same light for every tile)
      window.__rig.frame(24);
      return { climate: m.climate, size: m.w, landmark: m.landmarks[0]?.id ?? null, civilians: g.world.buildings.filter((b) => b.scenery).length, focus: f, label: g.missionDef?.map?.label ?? '' };
    });
    const a = await s.page.screenshot();
    fs.writeFileSync(`${out}/tiles/${region}-${kind}-start.png`, a);
    await s.page.evaluate(() => {
      const g = window.__game, m = g.world.map, cam = g.gfx.cam;
      const st = document.createElement('style');
      st.textContent = 'body *:not(canvas) { visibility: hidden !important; } canvas { visibility: visible !important; }';
      document.head.appendChild(st);
      g.gfx.fog.enabled = false;
      cam.jumpTo(m.w / 2, m.h / 2 + m.h * 0.12);
      cam.dist = cam.targetDist = 64;
      window.__rig.frame(16);
    });
    const b = await s.page.screenshot();
    fs.writeFileSync(`${out}/tiles/${region}-${kind}-overview.png`, b);
    tiles.push({ label: `${region} ${kind} (${info.climate}${info.landmark ? ', ' + info.landmark : ''}) start`, png: a.toString('base64') });
    tiles.push({ label: `${info.label}: overview, ${info.civilians} civilian buildings`, png: b.toString('base64') });
    console.log(JSON.stringify({ case: c, ...info, log: s.log.slice(0, 6) }));
  } catch (e) {
    console.log(JSON.stringify({ case: c, error: String(e).slice(0, 300), log: s?.log?.slice(0, 6) }));
  } finally {
    await s?.ctx.close();
  }
}
// the contact sheet: start view | overview, four tiles a row
const page = await browser.newPage();
const url = await page.evaluate(async ([tiles, TW, TH]) => {
  const cols = 4, rows = Math.ceil(tiles.length / cols);
  const c = document.createElement('canvas');
  c.width = cols * TW; c.height = rows * TH;
  const x = c.getContext('2d');
  x.fillStyle = '#111'; x.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < tiles.length; i++) {
    const img = new Image();
    img.src = 'data:image/png;base64,' + tiles[i].png;
    await img.decode();
    const tx = (i % cols) * TW, ty = Math.floor(i / cols) * TH;
    x.drawImage(img, tx, ty, TW, TH);
    x.fillStyle = 'rgba(0,0,0,0.6)'; x.fillRect(tx, ty, TW, 24);
    x.fillStyle = '#fff'; x.font = 'bold 15px sans-serif';
    x.fillText(tiles[i].label, tx + 8, ty + 17);
    x.strokeStyle = '#000'; x.strokeRect(tx + 0.5, ty + 0.5, TW - 1, TH - 1);
  }
  return c.toDataURL('image/jpeg', 0.85);
}, [tiles, TW, TH]);
fs.writeFileSync(`${out}/maps-${preset}.jpg`, Buffer.from(url.split(',')[1], 'base64'));
console.log('sheet', `${out}/maps-${preset}.jpg`, tiles.length, 'tiles');
await browser.close();
