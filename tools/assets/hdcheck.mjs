// HD runtime check: damage stages, construction hologram and collapse of a structure type in scene A.
//   node tools/assets/hdcheck.mjs [port=5231] [outDir=/tmp/rh-assets] [hd=1] [type=powr]
// Prints the HD status and console warnings / errors; screenshots chk-*.png in outDir.
import { chromium } from 'playwright';
const port = process.argv[2] ?? '5231';
const outDir = process.argv[3] ?? '/tmp/rh-assets';
const hd = process.argv[4] ?? '1';
const type = process.argv[5] ?? 'powr';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'], env: { ...process.env, LD_LIBRARY_PATH: new URL('../nsslibs/lib', import.meta.url).pathname } });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
await page.goto(`http://localhost:${port}/?autostart=1&scenario=base&faction=soviet&climate=winter&tod=day&hour=10.5&wx=clear&size=64&fog=0&intro=0&hd=${hd}`, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__game && window.__game.hud && window.__game.running, null, { timeout: 600000 });
await page.waitForTimeout(1500);
const ev = (f, a) => page.evaluate(f, a);
const P = await ev((type) => { const b = window.__game.world.buildings.find((b) => b.type.id === type); return [b.x, b.y, b.id]; }, type);
const focus = async (d) => ev(([x, y, d]) => { const c = window.__game.gfx.cam; c.jumpTo(x, y); c.dist = c.targetDist = d; }, [P[0], P[1], d]);
const shot = async (name, w = 5000) => { await page.waitForTimeout(w); await page.screenshot({ path: `${outDir}/${name}.png` }); console.log('shot', name); };
await focus(8);
// damage stages
await ev((id) => { const b = window.__game.world.getEntity(id); b.hp = b.type.strength * 0.4; }, P[2]);
await shot(`chk-damaged-hd${hd}`);
await ev((id) => { const b = window.__game.world.getEntity(id); b.hp = b.type.strength * 0.15; }, P[2]);
await shot(`chk-wrecked-hd${hd}`);
// unpowered: take the power down by killing... just mark lowPower
// construction hologram: a new power plant near the first
const placed = await ev(([x, y, t]) => window.__debug.construct(t, x + 3, y + 1), [P[0], P[1], type]);
console.log('construct', placed);
await shot(`chk-holo-hd${hd}`, 2500);
// destruction: kill the damaged one
await ev((id) => { const g = window.__game; const b = g.world.getEntity(id); g.world.kill(b, 'normal'); }, P[2]);
await shot(`chk-collapse-hd${hd}`, 1200);
await shot(`chk-collapse2-hd${hd}`, 4000);
const info = await ev(async () => { const m = await import('/src/render/models/hd.ts'); return m.hdStatus(); });
console.log(JSON.stringify({ info, errors: errors.slice(0, 10) }));
await browser.close();
