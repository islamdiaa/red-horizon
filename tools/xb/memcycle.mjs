// What a browser keeps after each match: quick Play again cycles (a short Hard-vs-Hard match at speed, forced to its
// end, then Play again by a click), with the browser's memory sampled after every cycle and broken down by kind from
// /proc/<pid>/smaps: GPU buffers (render-node / DRM mappings: textures, render targets, vertex buffers on an
// integrated GPU), anonymous memory (the JavaScript heap and malloc), file-backed and shared memory. A kind that grows
// every cycle is what leaks; renderer resource counts (three.js) and DOM nodes are logged next to it.
//   node tools/xb/memcycle.mjs <chromium|firefox|webkit> [cycles=6] [q=low] [secs=60]
// Runs in the cross-browser rig (tools/xb/rig.sh, XB_DISPLAY=weston for Firefox and WebKit). GAME_URL picks the build.
// EXTRA_INIT_FILE=<file.js> is added as an init script (A/B experiments, e.g. a candidate fix applied from outside).
import fs from 'node:fs';
import { launch, instrument, watch, sample, sleep, GAME_URL, OUT, writeJsonl } from './vmlib.mjs';

const [name = 'webkit', cycArg = '6', Q = 'low', secsArg = '60'] = process.argv.slice(2);
const W = +(process.env.W ?? 1280), H = +(process.env.H ?? 720);
const file = `memcycle-${name}${process.env.TAG ?? ''}.jsonl`;
const pat = /firefox/.test(name) ? /firefox|Web Content|WebExtensions|Isolated|RDD|Socket|Utility|GPU Process|Privileged/i
  : name === 'webkit' ? /WebKit|MiniBrowser|pw_run/i : /chrome|chromium|headless_shell/i;

/** RSS per process and per mapping kind (kB -> MB), for the browser's processes. */
function memory() {
  const procs = [];
  for (const pid of fs.readdirSync('/proc').filter((x) => /^\d+$/.test(x))) {
    try {
      const comm = fs.readFileSync(`/proc/${pid}/comm`, 'utf8').trim();
      const cmd = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ').slice(0, 200);
      if ((!pat.test(comm) && !pat.test(cmd)) || /node/.test(comm)) continue;
      const kinds = { gpu: 0, anon: 0, heap: 0, file: 0, shmem: 0, other: 0 };
      let cur = 'other';
      for (const line of fs.readFileSync(`/proc/${pid}/smaps`, 'utf8').split('\n')) {
        const head = /^[0-9a-f]+-[0-9a-f]+ \S+ \S+ \S+ \S+\s*(.*)$/.exec(line);
        if (head) {
          const p = head[1];
          cur = /renderD|\/dev\/dri|i915|drm|gem/i.test(p) ? 'gpu' : p === '' ? 'anon' : p === '[heap]' ? 'heap' : /^\/(memfd|dev\/shm|SYSV)|memfd:/.test(p) ? 'shmem' : p.startsWith('/') ? 'file' : 'other';
          continue;
        }
        const m = /^Rss:\s+(\d+) kB/.exec(line);
        if (m) kinds[cur] += +m[1];
      }
      const total = Object.values(kinds).reduce((a, b) => a + b, 0);
      procs.push({ pid: +pid, comm, mb: Math.round(total / 1024), kinds: Object.fromEntries(Object.entries(kinds).map(([k, v]) => [k, Math.round(v / 1024)])) });
    } catch { /* exited */ }
  }
  procs.sort((a, b) => b.mb - a.mb);
  const sum = { mb: 0, gpu: 0, anon: 0, heap: 0, file: 0, shmem: 0, other: 0 };
  for (const p of procs) { sum.mb += p.mb; for (const k of Object.keys(p.kinds)) sum[k] += p.kinds[k]; }
  return { sum, top: procs.slice(0, 3).map((p) => ({ comm: p.comm, mb: p.mb, ...p.kinds })) };
}

const browser = await launch(name);
const ctx = await browser.newContext({ viewport: { width: W, height: H } });
const page = await ctx.newPage();
const log = watch(page);
await page.addInitScript(instrument);
const extra = process.env.EXTRA_INIT_FILE ? fs.readFileSync(process.env.EXTRA_INIT_FILE, 'utf8') : null;
if (extra) await page.addInitScript(extra);
const url = `${GAME_URL}?autostart=1&intro=0&size=96&units=mcv&fog=1&selfplay=hard&ai=hard&q=${Q}&seed=21&debug=1`;
writeJsonl(file, { browser: name, version: browser.version(), url, cycles: +cycArg, secs: +secsArg, extra: process.env.EXTRA_INIT_FILE ?? null });
await page.goto(url, { waitUntil: 'load', timeout: 300000 });
writeJsonl(file, { cycle: 0, phase: 'loaded', mem: memory() });

for (let cycle = 1; cycle <= +cycArg; cycle++) {
  for (let k = 0; k < 200; k++) {
    if (await page.evaluate(() => !!(window.__game?.running && window.__game.world.tick > 0 && !window.__game.world.gameOver)).catch(() => false)) break;
    await sleep(1500);
  }
  await page.evaluate(() => {
    const g = window.__game, w = g.world;
    const AIC = w.ais[0]?.constructor;
    if (AIC && !w.ais.some((a) => a.player === g.local || a.p === g.local)) w.ais.push(new AIC(w, g.local, 'hard'));
    g.speed = 4;
  }).catch(() => {});
  await sleep(+secsArg * 1000);
  const s = await sample(page).catch((e) => ({ err: String(e).slice(0, 120) }));
  writeJsonl(file, { cycle, phase: 'play', mem: memory(), ...s });
  for (let k = 0; k < 20 && !(await page.evaluate(() => window.__game.world.gameOver).catch(() => true)); k++) {
    await page.evaluate(() => {
      const g = window.__game, w = g.world;
      for (const e of [...w.units, ...w.buildings]) if (e.alive && e.owner !== g.local && e.owner.team !== g.local.team) w.kill(e, 'normal');
      g.speed = 1;
    }).catch(() => {});
    await sleep(4000);
  }
  for (let k = 0; k < 60 && !(await page.evaluate(() => !!document.querySelector('.rr-again')?.getClientRects().length).catch(() => false)); k++) await sleep(2000);
  if (cycle < +cycArg) {
    const r = await page.evaluate(() => { const b = document.querySelector('.rr-again')?.getBoundingClientRect(); return b ? [b.x + b.width / 2, b.y + b.height / 2] : null; });
    if (!r) { writeJsonl(file, { cycle, fail: 'no Play again button' }); break; }
    await page.mouse.click(r[0], r[1]);
    // the new match is up and the old one is gone: idle a little so collectors can run, then sample
    await sleep(20000);
    writeJsonl(file, { cycle, phase: 'after-again', mem: memory() });
    console.log(`cycle ${cycle}:`, JSON.stringify(memory().sum));
  }
}
writeJsonl(file, { summary: true, errors: log.slice(0, 10), errorCount: log.length });
await browser.close();
