// CPU profile of a running battle via the Chrome DevTools Protocol (Profiler domain).
// Prints the top self-time functions resolved to original file:line through Vite's source maps,
// plus inclusive time of the main subsystems.
//   node tests/perf/profile.mjs [seconds=30] [top=15]
import { writeFileSync } from 'node:fs';
import { startServer, launch, sleep, loadSourceMap, originalPosition } from './lib.mjs';

const SECS = +(process.argv[2] ?? 30);
const TOP = +(process.argv[3] ?? 15);
// SwiftShader rasterises on the CPU: shrink the render resolution so the profile shows the
// game's own main-thread costs instead of waiting on the GPU process (relative costs only).
const VIEW = { width: +(process.env.W ?? 640), height: +(process.env.H ?? 360) };
const PIXEL_RATIO = +(process.env.PR ?? 0.5);
const QUALITY = process.env.Q ?? 'low';
const { server, url } = await startServer(5190);
const browser = await launch();
const page = await browser.newPage({ viewport: VIEW });
const cdp = await page.context().newCDPSession(page);
await page.goto(`${url}?autostart=1&size=64&scenario=battle&charge=1&fog=0&demo=0&q=${QUALITY}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game, null, { timeout: 120000 });
await page.evaluate((pr) => {
  const gfx = window.__game.gfx;
  gfx.renderer.setPixelRatio(pr);
  gfx.composer.setPixelRatio(pr);
  gfx.resize();
}, PIXEL_RATIO);
await sleep(5000); // warm-up: shader compiles, first spawns

const programsBefore = await page.evaluate(() => window.__game.gfx.renderer.info.programs.map((p) => p.id));
await page.evaluate(() => {
  window.__frames = 0;
  window.__tick0 = window.__game.world.tick;
  const loop = () => { window.__frames++; window.__frameRaf = requestAnimationFrame(loop); };
  loop();
});
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 250 });
await cdp.send('Profiler.start');
const t0 = Date.now();
await sleep(SECS * 1000);
const { profile } = await cdp.send('Profiler.stop');
const wall = (Date.now() - t0) / 1000;
const run = await page.evaluate(() => ({
  frames: window.__frames, ticks: window.__game.world.tick - window.__tick0, units: window.__game.world.units.length,
  projectiles: window.__game.world.projectiles.length, calls: window.__game.gfx.stats.calls, tris: window.__game.gfx.stats.tris,
  views: window.__game.ents.views?.size, fx: window.__game.effects.stats?.(),
}));
writeFileSync('/tmp/rh-battle.cpuprofile', JSON.stringify(profile));
const compiled = await page.evaluate((before) => window.__game.gfx.renderer.info.programs
  .filter((p) => !before.includes(p.id)).map((p) => `${p.name}#${p.id} (used ${p.usedTimes}x)`), programsBefore);

// ---- aggregate
const total = profile.endTime - profile.startTime; // µs
const samples = profile.samples.length;
const usPerSample = total / samples;
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const parent = new Map();
for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
const self = new Map(); // node id -> µs
profile.samples.forEach((id, k) => self.set(id, (self.get(id) ?? 0) + (profile.timeDeltas[k + 1] ?? usPerSample)));

const label = async (cf) => {
  const name = cf.functionName || '(anonymous)';
  if (!cf.url) return { key: name, name, where: '' };
  const sm = /\/src\/|\/deps\//.test(cf.url) ? await loadSourceMap(cf.url) : null;
  const pos = sm ? originalPosition(sm, cf.lineNumber, cf.columnNumber) : null;
  const file = pos ? pos.file.replace(/^.*?\/(src\/|node_modules\/)/, '$1') : new URL(cf.url).pathname;
  const where = pos ? `${file}:${pos.line}` : `${file}:${cf.lineNumber + 1}`;
  return { key: `${name} @ ${where}`, name, where };
};

const fnSelf = new Map();
let busy = 0, idle = 0, gcT = 0, program = 0;
for (const [id, us] of self) {
  const n = byId.get(id);
  const name = n.callFrame.functionName;
  if (name === '(idle)') { idle += us; continue; }
  busy += us;
  if (name === '(garbage collector)') gcT += us;
  if (name === '(program)') program += us;
  const l = await label(n.callFrame);
  const cur = fnSelf.get(l.key) ?? { ...l, us: 0 };
  cur.us += us;
  fnSelf.set(l.key, cur);
}

// inclusive time per labelled function (count each sample once per distinct label on its stack)
const inclusive = new Map();
const labelCache = new Map();
for (const [id, us] of self) {
  const seen = new Set();
  for (let cur = id; cur !== undefined; cur = parent.get(cur)) {
    const n = byId.get(cur);
    if (!labelCache.has(cur)) labelCache.set(cur, (await label(n.callFrame)).key);
    const k = labelCache.get(cur);
    if (seen.has(k)) continue;
    seen.add(k);
    inclusive.set(k, (inclusive.get(k) ?? 0) + us);
  }
}

const ms = (us) => (us / 1000).toFixed(0).padStart(6) + ' ms';
const pct = (us) => ((100 * us) / busy).toFixed(1).padStart(5) + '%';
console.log(`\nview ${VIEW.width}x${VIEW.height} @${PIXEL_RATIO}x, quality ${QUALITY}`);
console.log(`Profiled ${wall.toFixed(1)} s: ${run.frames} frames (${(run.frames / wall).toFixed(1)} fps), ${run.ticks} sim ticks (${(run.ticks / wall).toFixed(1)}/s), ` +
  `units=${run.units} projectiles=${run.projectiles} drawCalls=${run.calls} tris=${run.tris} views=${run.views} fx=${JSON.stringify(run.fx ?? {})}`);
console.log(`main thread busy ${ms(busy)} (${((100 * busy) / total).toFixed(0)}% of wall), idle ${ms(idle)}, GC ${ms(gcT)} (${pct(gcT)}), (program) ${ms(program)} (${pct(program)})`);
console.log(`\nTop ${TOP} self time (excluding idle):`);
const top = [...fnSelf.values()].sort((a, b) => b.us - a.us).slice(0, TOP);
top.forEach((f, i) => console.log(`${String(i + 1).padStart(2)}. ${pct(f.us)} ${ms(f.us)}  ${f.name.padEnd(28)} ${f.where}`));

const SUBSYSTEMS = [
  ['Game.frame', /src\/game\.ts/, /^frame$/], ['World.step (sim)', /src\/sim\/world\.ts/, /^step$/], ['Game.processEvents', /src\/game\.ts/, /^processEvents$/],
  ['GameRenderer.render', /src\/render\/renderer\.ts/, /^render$/], ['EntityRenderer.update', /src\/render\/entities\.ts/, /^update$/],
  ['Effects.update', /src\/render\/effects\/index\.ts/, /^update$/], ['Overlay.draw', /src\/render\/overlay\.ts/, /^draw$/],
  ['HUD.update', /src\/ui\/hud\.ts/, /^update$/], ['Minimap.draw', /src\/ui\/minimap\.ts/, /^draw$/], ['WebGLRenderer.render (three)', /three/, /^render$/],
  ['FogOfWar.update', /src\/render\/fog\.ts/, /^update$/], ['Input.update', /src\/ui\/input\.ts/, /^update$/],
];
console.log('\nInclusive time of main subsystems:');
for (const [title, file, fn] of SUBSYSTEMS) {
  let us = 0, where = '';
  for (const [k, v] of inclusive) {
    const [name, loc] = k.split(' @ ');
    if (fn.test(name) && file.test(loc ?? '') && v > us) { us = v; where = loc; }
  }
  if (us) console.log(`  ${title.padEnd(30)} ${pct(us)} ${ms(us)}  ${where}`);
}
console.log(`\nshader programs: ${programsBefore.length} before the profile window, ${compiled.length} compiled during it`);
for (const c of compiled.slice(0, 25)) console.log('  + ' + c);
console.log('\nraw profile: /tmp/rh-battle.cpuprofile (open in Chrome DevTools > Performance)');
await browser.close();
await server.close();
