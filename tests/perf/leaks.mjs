// Leak audit: start a battle, quit to the main menu, start again... 5 times, and track GPU
// resources, JS heap, DOM, listeners and whether each disposed Game is actually garbage-collected.
// Every system is on by default: Commander rules (doctrines, events, the economy), High quality (heat haze,
// battle scars, soft particles), HD models; --classic runs plain Classic rules on the default preset instead.
//   node tests/perf/leaks.mjs [iterations=5] [secondsPerGame=8] [--demo] [--classic]   (PORT=5190)
import { startServer, launch, sleep } from './lib.mjs';

const DEMO = process.argv.includes('--demo');
const ALL = process.argv.includes('--classic') ? '' : '&rules=commander&q=high&hd=1';
const nums = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const ITER = +(nums[0] ?? 5), SECS = +(nums[1] ?? 8);

const { server, url } = await startServer(+(process.env.PORT ?? 5190));
const browser = await launch(['--enable-precise-memory-info', '--js-flags=--expose-gc']);
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const cdp = await page.context().newCDPSession(page);
const errors = new Map();
page.on('pageerror', (e) => errors.set(e.message, (errors.get(e.message) ?? 0) + 1));

const gc = async () => {
  for (let k = 0; k < 3; k++) {
    await cdp.send('HeapProfiler.collectGarbage');
    await page.evaluate(() => window.gc?.());
    await sleep(150);
  }
};

async function countInstances(name) {
  const { result } = await cdp.send('Runtime.evaluate', { expression: `window.__protos && window.__protos[${JSON.stringify(name)}]` });
  if (!result.objectId) return null;
  const { objects } = await cdp.send('Runtime.queryObjects', { prototypeObjectId: result.objectId });
  const { result: len } = await cdp.send('Runtime.callFunctionOn', { objectId: objects.objectId, functionDeclaration: 'function(){return this.length}', returnByValue: true });
  await cdp.send('Runtime.releaseObject', { objectId: objects.objectId });
  return len.value;
}

/** NAMES=1: live instances of a class grouped by name (what accumulates between matches). */
async function namesOf(name) {
  const { result } = await cdp.send('Runtime.evaluate', { expression: `window.__protos && window.__protos[${JSON.stringify(name)}]` });
  if (!result.objectId) return null;
  const { objects } = await cdp.send('Runtime.queryObjects', { prototypeObjectId: result.objectId });
  const { result: r } = await cdp.send('Runtime.callFunctionOn', {
    objectId: objects.objectId, returnByValue: true,
    functionDeclaration: 'function(){const m={};for(const o of this){const k=(o.name||o.type||o.constructor?.name||"?").replace(/[0-9a-f]{6,}|[0-9.]+/g,"#");m[k]=(m[k]||0)+1}return m}',
  });
  await cdp.send('Runtime.releaseObject', { objectId: objects.objectId });
  return r.value;
}

async function listeners() {
  const out = {};
  for (const target of ['window', 'document']) {
    const { result } = await cdp.send('Runtime.evaluate', { expression: target });
    const { listeners: ls } = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId });
    out[target] = ls.length;
    out[target + 'Types'] = Object.entries(ls.reduce((m, l) => ((m[l.type] = (m[l.type] ?? 0) + 1), m), {})).filter(([, n]) => n > 1).map(([t, n]) => `${t}x${n}`).join(' ');
  }
  return out;
}

const pageStats = () => page.evaluate(() => ({
  heapMB: +(performance.memory.usedJSHeapSize / 1048576).toFixed(1),
  dom: document.getElementsByTagName('*').length,
  canvases: document.querySelectorAll('canvas').length,
}));

const PROTOS = ['Game', 'World', 'WebGLRenderer', 'Scene', 'Object3D', 'BufferGeometry', 'Material', 'Texture', 'WebGLRenderTarget', 'Unit'];

await page.goto(`${url}?autostart=1&size=64&scenario=battle&charge=1&fog=0${ALL}${DEMO ? '' : '&demo=0'}`, { waitUntil: 'load' });
const rows = [];
for (let i = 1; i <= ITER; i++) {
  await page.waitForFunction(() => window.__game && !window.__game.__audited && !window.__game.setup.demo, null, { timeout: 120000 });
  // games started from the menu play the intro cinematic (game.paused) until any key is pressed
  for (let k = 0; k < 20 && await page.evaluate(() => window.__game.paused); k++) { await page.keyboard.press('Shift'); await sleep(500); }
  await page.evaluate(() => {
    const g = window.__game;
    g.__audited = true;
    if (!window.__protos) {
      // capture class prototypes once (holding prototypes does not retain instances)
      const chain = (o, name) => { for (let p = Object.getPrototypeOf(o); p; p = Object.getPrototypeOf(p)) if (p.constructor?.name === name) return p; return null; };
      let geo = null, mat = null, tex = null, obj = null;
      g.gfx.scene.traverse((o) => {
        obj ??= o;
        if (o.geometry && !geo) geo = o.geometry;
        const m = Array.isArray(o.material) ? o.material[0] : o.material;
        if (m && !mat) mat = m;
        if (m?.map && !tex) tex = m.map;
      });
      const unit = g.world.units[0];
      window.__protos = {
        Game: Object.getPrototypeOf(g), World: Object.getPrototypeOf(g.world), WebGLRenderer: chain(g.gfx.renderer, 'WebGLRenderer'),
        Scene: chain(g.gfx.scene, 'Scene'), Object3D: chain(obj, 'Object3D'), BufferGeometry: chain(geo, 'BufferGeometry'),
        Material: chain(mat, 'Material'), Texture: chain(tex, 'Texture'), Unit: unit ? chain(unit, 'Unit') : null,
        WebGLRenderTarget: g.gfx.composer?.renderTarget1 ? chain(g.gfx.composer.renderTarget1, 'WebGLRenderTarget') : null,
      };
    }
  });
  await sleep(SECS * 1000);
  const inGame = await page.evaluate(() => {
    const g = window.__game, r = g.gfx.renderer;
    return { geometries: r.info.memory.geometries, textures: r.info.memory.textures, programs: r.info.programs?.length ?? 0, calls: r.info.render.calls, entities: g.world.entities.size, simTime: +g.world.time.toFixed(1) };
  });
  const inGameStats = await pageStats();
  // quit to the main menu through the real UI
  await page.evaluate(() => {
    const g = window.__game;
    window.__weak = { game: new WeakRef(g), world: new WeakRef(g.world), renderer: new WeakRef(g.gfx.renderer), scene: new WeakRef(g.gfx.scene) };
    g.pause();
  });
  await page.getByText('Quit to menu').click({ timeout: 180000 }).catch(async (e) => {
    await page.screenshot({ path: '/tmp/rh-leaks-stuck.png' }).catch(() => {});
    console.log('stuck before "Quit to menu" (screenshot /tmp/rh-leaks-stuck.png); page errors:', [...errors.keys()].slice(0, 5));
    throw e;
  }); // quitting starts the menu backdrop battle
  await page.waitForSelector('.mm-layout', { timeout: 180000 });
  await sleep(1500);
  // main.ts keeps window.__game pointing at the quit game (debug hook): drop it so we measure real leaks
  const debugHookRetains = await page.evaluate(() => window.__game === window.__weak.game.deref());
  await page.evaluate(() => { if (window.__game === window.__weak.game.deref()) delete window.__game; });
  await gc();
  const alive = await page.evaluate(() => Object.fromEntries(Object.entries(window.__weak).map(([k, w]) => [k, !!w.deref()])));
  const menuStats = await pageStats();
  const counts = {};
  for (const p of PROTOS) counts[p] = await countInstances(p);
  const ls = await listeners();
  if (process.env.NAMES) for (const p of ['Texture', 'Material']) {
    const now = await namesOf(p);
    const before = (globalThis.__names ??= {})[p] ?? {};
    const grew = Object.entries(now ?? {}).map(([k, n]) => [k, n - (before[k] ?? 0)]).filter(([, d]) => d > 0).sort((a, b) => b[1] - a[1]).slice(0, 12);
    console.log(`   ${p} growth by name: ${grew.map(([k, d]) => `${k}+${d}`).join(' ')}`);
    globalThis.__names[p] = now;
  }
  rows.push({ i, inGame, inGameStats, menuStats, alive, counts, ls, debugHookRetains });
  console.log(`#${i} in-game: geo=${inGame.geometries} tex=${inGame.textures} programs=${inGame.programs} calls=${inGame.calls} ents=${inGame.entities} heap=${inGameStats.heapMB}MB dom=${inGameStats.dom}`);
  console.log(`   menu(after gc): heap=${menuStats.heapMB}MB dom=${menuStats.dom} canvases=${menuStats.canvases} gameAlive=${JSON.stringify(alive)} __game-retained-by-debug-hook=${debugHookRetains}`);
  console.log(`   live instances: ${PROTOS.map((p) => `${p}=${counts[p]}`).join(' ')}`);
  console.log(`   listeners: window=${ls.window} [${ls.windowTypes}] document=${ls.document} [${ls.documentTypes}]`);
  if (i < ITER) {
    // start the next game from the skirmish screen (URL test params re-apply scenario=battle & charge)
    await page.getByRole('button', { name: 'Small' }).first().click().catch(() => {});
    await page.locator('button.deploy').click({ timeout: 180000 });
  }
}
console.log('\npage errors:', errors.size ? [...errors.entries()] : 'none');
const first = rows[0], last = rows[rows.length - 1];
console.log(`heap growth at menu: ${first.menuStats.heapMB} -> ${last.menuStats.heapMB} MB over ${ITER} games; DOM ${first.menuStats.dom} -> ${last.menuStats.dom}`);
await browser.close();
await server.close();
