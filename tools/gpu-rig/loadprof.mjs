// Where the loading time goes: the time to the menu, then a Quick Battle started by a click, with the loading screen's
// stages timestamped, the long tasks, and the main-thread time spent inside WebGL calls by kind (shader compile and
// link, the first draw of each program (drivers that compile lazily, SwiftShader among them, do the real work there),
// texture uploads with their bytes, buffer uploads). Run it with RIG_BACKEND=swiftshader and a CPU cap on the
// container to stand in for a slow machine without a GPU.
//   node tools/gpu-rig/loadprof.mjs <base-url> [q=low] [runs=1] [outDir=/out]
import fs from 'node:fs';
import { launchGpu } from './lib.mjs';

const [base = 'http://127.0.0.1:5314/base/', q = 'low', runsArg = '1', out = '/out'] = process.argv.slice(2);
const W = +(process.env.W ?? 1280), H = +(process.env.H ?? 720);
const browser = await launchGpu(undefined, []);
const label = base.replace(/\/+$/, '').split('/').pop();
const res = { base, q, backend: process.env.RIG_BACKEND ?? 'gl', runs: [] };

/** In-page: stage watcher, long tasks, and timing wrappers around the WebGL calls that cost main-thread time. */
function instrument(Q) {
  localStorage.setItem('rh.settings', JSON.stringify({ quality: Q, skipIntro: true, fullscreen: false, hints: false }));
  const t0 = performance.now();
  const ld = window.__ld = { stages: [], long: [], gl: {}, slow: [], firstDraw: 0, firstDrawN: 0 };
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) ld.long.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ type: 'longtask', buffered: true }); } catch { /* not supported */ }
  let last = '';
  const poll = () => {
    const l = document.getElementById('loading');
    const s = l ? `${getComputedStyle(l).display === 'none' ? 'hidden' : 'shown'} | ${l.querySelector('.label')?.textContent ?? ''}` : 'none';
    if (s !== last) { ld.stages.push([Math.round(performance.now() - t0), s]); last = s; }
  };
  new MutationObserver(poll).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  setInterval(poll, 250);
  const add = (k, ms, bytes = 0) => { const e = ld.gl[k] ??= { n: 0, ms: 0, mb: 0 }; e.n++; e.ms += ms; e.mb += bytes / 1048576; if (ms > 50) ld.slow.push([k, Math.round(performance.now() - t0), Math.round(ms)]); };
  const bytesOf = (a) => { for (const x of a) if (x && typeof x === 'object' && 'byteLength' in x) return x.byteLength; for (const x of a) if (x && typeof x === 'object' && 'width' in x && 'height' in x) return x.width * x.height * 4; return 0; };
  const seenProg = new WeakSet();
  let curProg = null;
  for (const C of [WebGL2RenderingContext.prototype]) {
    const wrap = (name, kind, bytes) => {
      const f = C[name];
      if (!f) return;
      C[name] = function (...a) { const s = performance.now(); try { return f.apply(this, a); } finally { add(kind ?? name, performance.now() - s, bytes ? bytesOf(a) : 0); } };
    };
    wrap('compileShader'); wrap('linkProgram'); wrap('getProgramParameter', 'linkStatus'); wrap('getShaderParameter', 'compileStatus');
    wrap('texImage2D', null, true); wrap('texSubImage2D', null, true); wrap('texImage3D', null, true); wrap('texSubImage3D', null, true);
    wrap('texStorage2D'); wrap('generateMipmap'); wrap('bufferData', null, true); wrap('bufferSubData', null, true); wrap('readPixels');
    const use = C.useProgram;
    C.useProgram = function (p) { curProg = p; return use.call(this, p); };
    for (const d of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
      const f = C[d];
      C[d] = function (...a) {
        const first = curProg && !seenProg.has(curProg);
        const s = performance.now();
        try { return f.apply(this, a); } finally {
          const ms = performance.now() - s;
          if (first) { seenProg.add(curProg); ld.firstDraw += ms; ld.firstDrawN++; if (ms > 50) ld.slow.push(['firstDraw', Math.round(performance.now() - t0), Math.round(ms)]); } else add('draw', ms);
        }
      };
    }
  }
}

for (let k = 0; k < +runsArg; k++) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  await ctx.addInitScript(instrument, q);
  const page = await ctx.newPage();
  page.setDefaultTimeout(900000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 300)));
  const t0 = Date.now();
  await page.goto(base, { waitUntil: 'load', timeout: 900000 });
  await page.waitForSelector('.mm-nav-btn', { state: 'visible', timeout: 900000 });
  const menuMs = Date.now() - t0;
  const atMenu = await page.evaluate(() => JSON.parse(JSON.stringify(window.__ld.gl)));
  await page.waitForTimeout(3000);
  const t1 = Date.now();
  await page.locator('.mm-nav-btn[data-nav="quick"]').click();
  await page.waitForFunction(() => window.__game && window.__game.hud && !window.__game.setup.demo && getComputedStyle(document.getElementById('loading')).display === 'none', null, { timeout: 900000, polling: 500 });
  const matchMs = Date.now() - t1;
  // the first seconds of the battle (programs first drawn now still cost)
  await page.waitForTimeout(5000);
  const ld = await page.evaluate(() => window.__ld);
  const r2 = (o) => Object.fromEntries(Object.entries(o).map(([key, v]) => [key, { n: v.n, ms: Math.round(v.ms), mb: +v.mb.toFixed(1) }]));
  const run = {
    menuMs, matchMs, glAtMenu: r2(atMenu), gl: r2(ld.gl), firstDraw: { n: ld.firstDrawN, ms: Math.round(ld.firstDraw) },
    stages: ld.stages.slice(-30), longest: [...ld.long].sort((a, b) => b[1] - a[1]).slice(0, 8), longTotalMs: ld.long.reduce((a, l) => a + l[1], 0),
    slow: ld.slow.sort((a, b) => b[2] - a[2]).slice(0, 25), errors,
  };
  res.runs.push(run);
  console.log(JSON.stringify({ menuMs, matchMs, firstDraw: run.firstDraw, gl: run.gl, longest: run.longest.slice(0, 5) }));
  await ctx.close();
}
fs.writeFileSync(`${out}/loadprof-${label}-${q}-${res.backend}.json`, JSON.stringify(res, null, 1));
await browser.close();
