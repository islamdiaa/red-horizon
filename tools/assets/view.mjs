#!/usr/bin/env node
// In-game check of HD models (headless Chromium + SwiftShader): a benchmark scene, optionally focused on
// one entity type, with HD on or off. Prints draw calls / triangles / HD status / console errors.
//
//   node tools/assets/view.mjs --port 5231 --scene A --out /tmp/a.png                  # scene A, HD per settings
//   node tools/assets/view.mjs --port 5231 --scene A --hd 0 --out /tmp/a-std.png       # Standard (procedural)
//   node tools/assets/view.mjs --port 5231 --scene A --focus powr --dist 9 --out /tmp/powr.png
//   node tools/assets/view.mjs --port 5231 --scene B --focus 3tnk --dist 6 --yaw 0.6 --out /tmp/tank.png
//   options: --extra 'q=medium&hdlazy=1' (more URL params) --nth N (focus the Nth entity of that type, -1 = last) --wait ms (settle time, default 9000) --night (scene E) --size WxH (default 1600x900)
//            --prep "<js on g>" (run before the shot, e.g. damage: "g.world.buildings[0].hp *= 0.3")
// Scenes: A Soviet winter base, B winter battle, C Allied temperate base,
// D desert battle, E night base. Run your own no-HMR vite server (copy tools/vite.test.config.ts, own port).
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const SCENES = {
  A: 'scenario=base&faction=soviet&climate=winter&tod=day&hour=10.5&wx=clear',
  B: 'scenario=battle&faction=soviet&climate=winter&tod=day&hour=10.5&wx=clear',
  C: 'scenario=base&faction=allies&climate=temperate&tod=day&hour=15&wx=clear',
  D: 'scenario=battle&faction=allies&climate=desert&tod=day&hour=9&wx=clear',
  E: 'scenario=base&faction=soviet&climate=temperate&tod=night',
};
const port = opt('--port', '5231');
const scene = opt('--scene', 'A');
const hd = opt('--hd', null);
const out = opt('--out', '/tmp/rh-view.png');
const focus = opt('--focus', null);
const dist = Number(opt('--dist', '0')) || 0;
const yaw = opt('--yaw', null);
const wait = Number(opt('--wait', '9000'));
const prep = opt('--prep', null);
const nth = Number(opt('--nth', '0')) || 0;
const extra = opt('--extra', '');
const [W, H] = opt('--size', '1600x900').split('x').map(Number);
const url = `http://localhost:${port}/?autostart=1&${SCENES[scene] ?? scene}&size=64&fog=0&intro=0${hd !== null ? `&hd=${hd}` : ''}${extra ? `&${extra}` : ''}`;

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  env: { ...process.env, LD_LIBRARY_PATH: path.join(here, '..', 'nsslibs/lib') },
});
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
await page.goto(url, { waitUntil: 'load', timeout: 600000 });
await page.waitForFunction(() => window.__game && window.__game.hud && window.__game.running, null, { timeout: 600000 });
await page.waitForTimeout(1500);
if (prep) console.log('prep:', await page.evaluate(`(() => { const g = window.__game; return ${prep}; })()`));
if (focus) {
  const at = await page.evaluate(([id, n]) => {
    const g = window.__game;
    const all = [...g.world.buildings, ...g.world.units].filter((x) => x.alive && x.type.id === id);
    const e = all[((n % all.length) + all.length) % all.length];
    return e ? [e.x, e.y] : null;
  }, [focus, nth]);
  console.log('focus', focus, at);
  if (at) await page.evaluate(([x, y, d, yw]) => {
    const c = window.__game.gfx.cam;
    c.jumpTo(x, y);
    if (d) c.dist = c.targetDist = d;
    if (yw !== null) c.yaw = c.targetYaw = Number(yw);
  }, [at[0], at[1], dist, yaw]);
}
await page.waitForTimeout(wait);
await page.screenshot({ path: out, timeout: 300000 });
const info = await page.evaluate(async () => {
  const g = window.__game;
  const r = g.gfx.renderer;
  const hd = await import('/src/render/models/hd.ts').then((m) => m.hdStatus()).catch(() => null);
  return { calls: g.gfx.stats.calls, tris: g.gfx.stats.tris, passCalls: g.gfx.passCalls, textures: r.info.memory.textures, geometries: r.info.memory.geometries, hd };
});
console.log(JSON.stringify({ out, url, ...info, errors: errors.slice(0, 8) }));
await browser.close();
