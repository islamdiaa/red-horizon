// Why does a WebGL 2 context fail on a fresh browser? Per launch (a fresh browser process each time) and per Chromium flag
// set: on about:blank, getContext('webgl2') with failIfMajorPerformanceCaveat, then without, each with the browser's
// webglcontextcreationerror statusMessage, the renderer when it works, and every console message. Then the game itself.
//   node tools/xb/vmctxdiag.mjs <browser> [launches=3]     (tools/lab/lab.sh run win11 tools/xb/vmctxdiag.mjs chrome)
import fs from 'node:fs';
import { launch, sleep, GAME_URL, OUT } from './vmlib.mjs';
const [name = 'chrome', nArg = '3'] = process.argv.slice(2);
const VARIANTS = process.env.VARIANTS === 'warp' ? { 'd3d11+ignore-blocklist': '--use-angle=d3d11 --ignore-gpu-blocklist', 'd3d11-warp': '--use-angle=d3d11-warp' } : { 'd3d11+ignore-blocklist': '--use-angle=d3d11 --ignore-gpu-blocklist', 'd3d11-warp': '--use-angle=d3d11-warp', 'default (no flags)': '' };
const rows = [];
for (const [label, flags] of Object.entries(VARIANTS)) {
  for (let i = 0; i < +nArg; i++) {
    process.env.CHROME_ARGS = flags;
    const row = { label, i };
    let b = null;
    try {
      b = await launch(name);
      const page = await b.newPage();
      const msgs = [];
      page.on('console', (m) => msgs.push(`${m.type()}: ${m.text().slice(0, 200)}`));
      row.blank = await page.evaluate(() => {
        const one = (opts) => {
          const c = document.createElement('canvas');
          let msg = '';
          c.addEventListener('webglcontextcreationerror', (e) => { msg = e.statusMessage || msg; });
          const gl = c.getContext('webgl2', opts);
          const d = gl?.getExtension('WEBGL_debug_renderer_info');
          const r = gl ? (d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) : null;
          return { ok: !!gl, msg, renderer: r && r.slice(0, 90) };
        };
        return { caveat: one({ failIfMajorPerformanceCaveat: true }), plain: one({}) };
      });
      // a failed context: when does a fresh canvas work again? (Chrome blocks every page's 3D APIs for a while after a
      // GPU-process loss it cannot blame on one page)
      if (!row.blank.plain.ok) {
        row.retries = [];
        const t0 = Date.now();
        for (const at of [1, 3, 6, 9, 12, 16, 25]) {
          await sleep(Math.max(0, at * 1000 - (Date.now() - t0)));
          const ok = await page.evaluate(() => { const c = document.createElement('canvas'); let msg = ''; c.addEventListener('webglcontextcreationerror', (e) => { msg = e.statusMessage || msg; }); return { ok: !!c.getContext('webgl2'), msg: msg.slice(0, 60) }; });
          row.retries.push([at, ok.ok, ok.msg]);
          if (ok.ok) break;
        }
      }
      await page.goto(GAME_URL, { waitUntil: 'load', timeout: 300000 });
      row.game = await Promise.race([
        page.waitForSelector('.mm-nav-btn', { state: 'visible', timeout: 300000 }).then(() => 'menu'),
        page.waitForFunction(() => [...document.querySelectorAll('[role="alert"]')].some((e) => /WebGL|start/i.test(e.textContent ?? '')), null, { timeout: 300000, polling: 500 }).then(() => 'cant-start'),
      ]).catch((e) => `error ${String(e).slice(0, 80)}`);
      row.msgs = msgs.filter((m) => /webgl|gpu|context|blocked/i.test(m)).slice(0, 6);
    } catch (e) { row.error = String(e).split('\n')[0].slice(0, 200); }
    await b?.close().catch(() => {});
    rows.push(row);
    console.log(JSON.stringify(row));
    await sleep(15000);
  }
}
fs.writeFileSync(`${OUT}/vmctxdiag-${name}.json`, JSON.stringify(rows, null, 1));
