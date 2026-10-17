#!/usr/bin/env node
// HD infantry checks in headless Chromium (SwiftShader): clip contact sheets, in-game battles with N soldiers, and
// benchmarks (draw calls, triangles, frame / CPU time) HD vs procedural on each quality preset.
//
//   node tools/assets/infantry.mjs sheet  --port 5272 --out /tmp/e1.png --q 'type=e1&fac=soviet&clips=rifle.'
//   node tools/assets/infantry.mjs battle --port 5272 --out /tmp/b.png --n 100 [--hd 0] [--extra 'q=medium'] [--dist 18] [--wait 6000]
//   node tools/assets/infantry.mjs bench  --port 5272 --n 300 [--frames 120]      # prints JSON per preset x HD on/off
// Run tools/assets/memguard.sh 3072 first; one browser at a time. --size WxH (default 1600x900).
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const mode = args[0];
const opt = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const port = opt('--port', '5272');
const out = opt('--out', '/tmp/rh-infantry.png');
const [W, H] = opt('--size', '1600x900').split('x').map(Number);
const wait = Number(opt('--wait', '6000'));

async function browser() {
  return chromium.launch({
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    env: { ...process.env, LD_LIBRARY_PATH: path.join(here, '..', 'nsslibs/lib') },
  });
}

/** In the page: spawn n infantry per side near the map centre, facing each other, and order them to fight. */
function spawnJs(n, mix) {
  return `(() => {
    const g = window.__game;
    const w = g.world;
    const mix = ${JSON.stringify(mix)};
    const mid = { x: w.map.w / 2, y: w.map.h / 2 };
    const players = w.players.filter((p) => p.id >= 0).slice(0, 2);
    let made = 0;
    players.forEach((p, pi) => {
      const list = mix[p.faction];
      const side = pi === 0 ? -1 : 1;
      for (let k = 0; k < ${n}; k++) {
        const t = list[k % list.length];
        const cols = Math.ceil(Math.sqrt(${n} * 1.6));
        const x = mid.x + side * (2.2 + Math.floor(k / cols) * 0.55);
        const y = mid.y - cols * 0.25 + (k % cols) * 0.5;
        const [fx, fy] = w.findFreeSpot(x, y, 3);
        const u = w.addUnit(t, p, fx, fy);
        u.heading = u.prevHeading = side < 0 ? 0 : Math.PI;
        made++;
      }
    });
    w.dirtyLists = true;
    return made;
  })()`;
}

const MIX = {
  soviet: ['e1', 'e1', 'e1', 'e2', 'e3', 'e1', 'e4', 'e1', 'shok', 'e2', 'e3', 'dog', 'e6'],
  allies: ['e1', 'e1', 'e1', 'e3', 'medi', 'e1', 'e3', 'e1', 'e7', 'e6', 'spy', 'thf', 'mech'],
};

async function openGame(page, extra) {
  const url = `http://localhost:${port}/?autostart=1&scenario=base&faction=soviet&climate=temperate&tod=day&hour=10.5&wx=clear&size=${opt('--map', '48')}&fog=0&intro=0&ceasefire=0${extra ? `&${extra}` : ''}`;
  await page.goto(url, { waitUntil: 'load', timeout: 600000 });
  await page.waitForFunction(() => window.__game && window.__game.hud && window.__game.running, null, { timeout: 600000 });
  await page.waitForTimeout(1500);
  return url;
}

async function stats(page) {
  return page.evaluate(async () => {
    const g = window.__game;
    const inf = await import('/src/render/models/infantry-hd.ts').then((m) => m.infantryHdStatus()).catch(() => null);
    const crowd = g.ents?.crowd?.stats ?? null;
    return { calls: g.gfx.stats.calls, tris: g.gfx.stats.tris, infantry: g.world.units.filter((u) => u.alive && u.kind === 'infantry').length, crowd, inf };
  });
}

/** Mean frame interval and the entity renderer's CPU time over `frames` frames. */
async function measure(page, frames) {
  return page.evaluate((frames) => new Promise((res) => {
    const g = window.__game;
    const ents = g.ents;
    const upd = ents.update.bind(ents);
    let cpu = 0;
    ents.update = (...a) => { const t0 = performance.now(); const r = upd(...a); cpu += performance.now() - t0; return r; };
    // the per-frame crowd fill (instance buffers) and the whole pre-render (culling + crowd)
    // the renderer's main-thread time (scene traversal, skeleton updates, uniform uploads, issuing the draws)
    const gfx = g.gfx;
    const rnd = gfx.render.bind(gfx);
    let cpuRender = 0;
    gfx.render = (...a) => { const t0 = performance.now(); const r = rnd(...a); cpuRender += performance.now() - t0; return r; };
    const crowd = ents.crowd;
    const prep = crowd.prepare.bind(crowd);
    let cpuCrowd = 0;
    crowd.prepare = (...a) => { const t0 = performance.now(); prep(...a); cpuCrowd += performance.now() - t0; };
    const pre = ents.scene?.userData;
    let n = 0;
    const t0 = performance.now();
    let calls = 0;
    let tris = 0;
    const step = () => {
      n++;
      calls += g.gfx.stats.calls;
      tris += g.gfx.stats.tris;
      if (n < frames) requestAnimationFrame(step);
      else {
        ents.update = upd;
        crowd.prepare = prep;
        gfx.render = rnd;
        res({ frameMs: +((performance.now() - t0) / n).toFixed(1), entsCpuMs: +(cpu / n).toFixed(2), crowdCpuMs: +(cpuCrowd / n).toFixed(2), renderCpuMs: +(cpuRender / n).toFixed(2), calls: Math.round(calls / n), tris: Math.round(tris / n) });
      }
    };
    void pre;
    requestAnimationFrame(step);
  }), frames);
}

async function main() {
  const b = await browser();
  const page = await b.newPage({ viewport: { width: W, height: H } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); if (args.includes('--log')) console.log(`[page] ${m.type()}: ${m.text()}`); });
  page.on('crash', () => console.log(JSON.stringify({ crashed: true, errors: errors.slice(0, 12) })));
  try {
    if (mode === 'sheet') {
      const q = opt('--q', 'type=e1&fac=soviet');
      await page.goto(`http://localhost:${port}/preview-infantry.html?${q}`, { waitUntil: 'load', timeout: 600000 });
      await page.waitForFunction(() => (window.__infReady ?? 0) > 2, null, { timeout: 600000 });
      await page.waitForTimeout(wait);
      await page.screenshot({ path: out, timeout: 300000 });
      console.log(JSON.stringify({ out, info: await page.textContent('#info'), errors: errors.slice(0, 8) }));
    } else if (mode === 'battle' || mode === 'bench') {
      const n = Number(opt('--n', '100'));
      const extra = [opt('--hd', null) !== null ? `hd=${opt('--hd', '1')}` : '', opt('--extra', '')].filter(Boolean).join('&');
      // bench: HD infantry vs the procedural infantry (?infhd=0; every other HD model as configured) per preset
      const runs = mode === 'bench' ? (opt('--runs', 'q=high,q=high&infhd=0,q=medium,q=medium&infhd=0,q=low')).split(',').map((r) => [r, null]) : [[extra, null]];
      const results = [];
      for (const [q, hd] of runs) {
        const ex = q;
        const url = await openGame(page, ex);
        const made = await page.evaluate(spawnJs(n / 2, MIX));
        const dist = Number(opt('--dist', '22'));
        await page.evaluate(([d, yaw]) => {
          const g = window.__game;
          const m = g.world.map;
          g.gfx.cam.jumpTo(m.w / 2, m.h / 2);
          g.gfx.cam.dist = g.gfx.cam.targetDist = d;
          if (yaw !== null) g.gfx.cam.yaw = g.gfx.cam.targetYaw = Number(yaw);
        }, [dist, opt('--yaw', null)]);
        if (opt('--fight', '1') === '1') await page.evaluate(() => import('/src/debug.ts').then((d) => d.chargeArmies(window.__game.world)));
        if (opt('--prep', null)) console.log('prep:', await page.evaluate(`(() => { const g = window.__game; return ${opt('--prep', 'null')}; })()`));
        await page.waitForTimeout(wait);
        if (mode === 'battle') {
          await page.screenshot({ path: out, timeout: 300000 });
          // --dists 16,9: more shots of the same fight, closer (aimed at the infantry's centre of mass)
          for (const d of (opt('--dists', '') || '').split(',').filter(Boolean)) {
            await page.evaluate((d) => {
              const g = window.__game;
              const us = g.world.units.filter((u) => u.alive && u.kind === 'infantry');
              const cx = us.reduce((a, u) => a + u.x, 0) / Math.max(1, us.length);
              const cy = us.reduce((a, u) => a + u.y, 0) / Math.max(1, us.length);
              g.gfx.cam.jumpTo(cx, cy);
              g.gfx.cam.dist = g.gfx.cam.targetDist = d;
            }, Number(d));
            await page.waitForTimeout(3000);
            await page.screenshot({ path: out.replace('.png', `-d${d}.png`), timeout: 300000 });
          }
          results.push({ out, url, made, ...(await stats(page)), errors: errors.slice(0, 8) });
        } else {
          const m = await measure(page, Number(opt('--frames', '60')));
          results.push({ preset: q, n: made, ...m, ...(await stats(page)) });
          console.log(JSON.stringify(results[results.length - 1]));
        }
      }
      if (mode === 'battle') console.log(JSON.stringify(results[0]));
      else console.log(JSON.stringify({ errors: errors.slice(0, 8) }));
    } else if (mode === 'deaths') {
      // a line of soldiers dying in each way (shot x2, burn, electro, blown = ragdoll, bite, crushed), shot over time
      await openGame(page, opt('--extra', ''));
      const kinds = ['normal', 'normal', 'burn', 'electro', 'blown', 'bite', 'crushed'];
      const type = opt('--type', 'e1');
      await page.evaluate(([kinds, type, dist]) => {
        const g = window.__game;
        const w = g.world;
        const p = w.players.find((q) => q.id === g.local.id);
        const mid = { x: w.map.w / 2, y: w.map.h / 2 };
        window.__deathIds = kinds.map((k, i) => {
          const u = w.addUnit(type, p, mid.x - 1.8 + i * 0.6, mid.y);
          u.heading = u.prevHeading = Math.PI / 2;
          return u.id;
        });
        w.dirtyLists = true;
        g.gfx.cam.jumpTo(mid.x, mid.y);
        g.gfx.cam.dist = g.gfx.cam.targetDist = dist;
      }, [kinds, type, Number(opt('--dist', '9'))]);
      await page.waitForTimeout(4000);
      await page.evaluate((kinds) => {
        const g = window.__game;
        window.__deathIds.forEach((id, i) => {
          const u = g.world.getEntity(id);
          if (!u) return;
          g.ents.handleEvent({ e: 'death', id, x: u.x, y: u.y, how: kinds[i] });
          u.alive = false;
        });
        g.world.dirtyLists = true;
      }, kinds);
      const shots = opt('--times', '300,900,2500').split(',').map(Number);
      let t0 = 0;
      for (const t of shots) {
        await page.waitForTimeout(Math.max(0, t - t0));
        t0 = t;
        await page.screenshot({ path: out.replace('.png', `-${t}.png`), timeout: 300000 });
      }
      console.log(JSON.stringify({ out, ...(await stats(page)), errors: errors.slice(0, 8) }));
    } else {
      console.error('usage: infantry.mjs sheet|battle|bench|deaths ...');
    }
  } finally {
    await b.close();
  }
}

main();
