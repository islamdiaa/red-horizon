// Cold starts: a fresh browser process per launch (so a fresh GPU process), the game's first page, and what the player
// gets: the main menu, or the "can't start" page. Counts the launches that needed the WebGL 2 retry
// (src/platform/webgl.ts checkSupportRetrying logs "[webgl] WebGL 2 started on attempt N").
//   node tools/xb/vmcold.mjs <browser> [launches=6] [pauseSeconds=20]     (tools/lab/lab.sh run win11 tools/xb/vmcold.mjs chrome 8)
import fs from 'node:fs';
import { launch, sleep, GAME_URL, OUT } from './vmlib.mjs';

const [name = 'chromium', nArg = '6', pauseArg = '20'] = process.argv.slice(2);
const rows = [];
for (let i = 0; i < +nArg; i++) {
  const t0 = Date.now();
  const row = { i, result: 'error', retried: null, ms: 0 };
  let b = null;
  try {
    b = await launch(name);
    const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
    const warns = [];
    page.on('console', (m) => { if (/\[webgl\]/.test(m.text())) warns.push(m.text().slice(0, 300)); });
    await page.goto(GAME_URL, { waitUntil: 'load', timeout: 300000 });
    const got = await Promise.race([
      page.waitForSelector('.mm-nav-btn', { state: 'visible', timeout: 300000 }).then(() => 'menu'),
      page.waitForFunction(() => [...document.querySelectorAll('[role="alert"]')].some((e) => /WebGL|start/i.test(e.textContent ?? '')), null, { timeout: 300000, polling: 500 }).then(() => 'cant-start'),
    ]);
    row.result = got;
    row.retried = warns[0] ?? null;
    if (got === 'cant-start') { row.detail = await page.evaluate(() => document.querySelector('[role="alert"] details pre, [role="alert"] pre')?.textContent?.slice(0, 600) ?? null); await page.screenshot({ path: `${OUT}/vmcold-${name}-${i}.png` }); }
  } catch (e) { row.error = String(e).split('\n')[0].slice(0, 200); }
  row.ms = Date.now() - t0;
  await b?.close().catch(() => {});
  rows.push(row);
  console.log(JSON.stringify(row));
  if (i + 1 < +nArg) await sleep(+pauseArg * 1000);
}
const sum = { browser: name, launches: rows.length, menu: rows.filter((r) => r.result === 'menu').length, cantStart: rows.filter((r) => r.result === 'cant-start').length, retried: rows.filter((r) => r.retried).length, rows };
fs.writeFileSync(`${OUT}/vmcold-${name}.json`, JSON.stringify(sum, null, 1));
console.log(JSON.stringify({ ...sum, rows: undefined }));
