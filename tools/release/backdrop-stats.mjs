// Draw calls / triangles of the menu backdrop: the directed attract mode vs the old free-running battle
// (?attract=0), sampled once a second (frame times under SwiftShader are meaningless; calls and triangles are not).
//   node tools/release/backdrop-stats.mjs <baseUrl> [q=low] [seconds=40]
import { chromium } from 'playwright';
import path from 'node:path';
import { root } from './relative-build.mjs';

const [base = 'http://127.0.0.1:5278/', q = 'low', secs = '40'] = process.argv.slice(2);
const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  env: { ...process.env, LD_LIBRARY_PATH: path.join(root, 'tools/nsslibs/lib') },
});
try {
  for (const mode of (process.env.MODES ?? 'attract=0,attract=1').split(',')) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    // the menu backdrop renders at the saved graphics preset (?q= only applies to autostart matches)
    await page.addInitScript((q) => {
      try { const s = JSON.parse(localStorage.getItem('rh.settings') ?? '{}'); localStorage.setItem('rh.settings', JSON.stringify({ ...s, quality: q })); } catch { /* ignore */ }
    }, q);
    await page.goto(`${base}?debug=1&${mode}`, { waitUntil: 'load', timeout: 120000 });
    await page.waitForFunction(() => !!window.__game?.gfx, null, { timeout: 300000 });
    await page.waitForTimeout(5000);
    const s = await page.evaluate(async (secs) => {
      const out = [];
      for (let i = 0; i < secs; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        const g = window.__game;
        if (!g) continue;
        out.push({ calls: g.gfx.stats.calls, tris: g.gfx.stats.tris, units: g.world.units.filter((u) => u.alive).length, shot: g.cameraDirector?.current?.name ?? 'drift', dist: g.gfx.cam.dist, q: g.setup.quality });
      }
      return out;
    }, +secs);
    const avg = (k) => s.reduce((a, x) => a + x[k], 0) / Math.max(1, s.length);
    const max = (k) => Math.max(...s.map((x) => x[k]));
    console.log(`${mode} q=${s[0]?.q ?? '?'}: samples=${s.length} calls avg ${avg('calls').toFixed(0)} max ${max('calls')} · tris avg ${(avg('tris') / 1000).toFixed(0)}k max ${(max('tris') / 1000).toFixed(0)}k · units avg ${avg('units').toFixed(0)} · dist avg ${avg('dist').toFixed(1)} · shots ${[...new Set(s.map((x) => x.shot))].join(',')}`);
    await page.close();
  }
} finally {
  await browser.close();
}
