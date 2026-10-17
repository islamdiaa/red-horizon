// Render a HUD-free key-art frame from the attract mode: enter a director shot (tesla, soviet-base, clash…),
// then hold a still camera that puts the subject on the right third (the title sits on the left), with a
// shallow depth of field. Several frames are saved; pick the best for tools/release/og-card.mjs.
//   node tools/release/keyart.mjs <url> <outPrefix> [shot=tesla] [dist=16] [frames=4] [w=1600] [h=840]
import { chromium } from 'playwright';
import path from 'node:path';
import { root } from './relative-build.mjs';

const [url, prefix, shot = 'tesla', dist = '16', frames = '4', w = '1600', h = '840'] = process.argv.slice(2);
const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  env: { ...process.env, LD_LIBRARY_PATH: path.join(root, 'tools/nsslibs/lib') },
});
try {
  const page = await browser.newPage({ viewport: { width: +w, height: +h } });
  page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
  await page.goto(url, { waitUntil: 'load', timeout: 120000 });
  await page.addStyleTag({ content: '.sub-screen, .mm, .mm-layout, #ui, .dir-card, .dir-bar, .dir-fade, body > .screen { visibility: hidden !important; }' });
  await page.waitForFunction(() => !!window.__game?.cameraDirector, null, { timeout: 180000 });
  // walk the program up to the shot (each shot stages the next), letting the battle run 3× faster
  const reached = await page.evaluate(async (want) => {
    const d = window.__game.cameraDirector;
    d.baseSpeed = 3;
    for (let guard = 0; guard < 12 && d.current?.name !== want; guard++) {
      d.shotTime = 1e9;
      d.update(0.016);
      await new Promise((r) => setTimeout(r, 6000));
    }
    return d.current?.name;
  }, shot);
  console.log('reached', reached);
  await page.waitForTimeout(8000);
  await page.evaluate(([dist]) => {
    const g = window.__game, d = g.cameraDirector, cam = g.gfx.cam;
    const st = d.state;
    let subj = { x: d.follow.x, y: d.follow.y }, yaw = cam.yaw;
    const coil = st.coilId != null ? g.world.getEntity(st.coilId) : null;
    if (coil && st.foe) { subj = { x: coil.x + (st.foe.x - coil.x) * 0.22, y: coil.y + (st.foe.y - coil.y) * 0.22 }; yaw = st.teslaYaw - 0.3; }
    const right = [Math.cos(yaw), Math.sin(yaw)];
    const off = dist * 0.21;
    d.dispose();
    g.speed = 1;
    g.cameraDirector = { update() {
      cam.x = subj.x - right[0] * off; cam.y = subj.y - right[1] * off;
      cam.dist = cam.targetDist = dist; cam.yaw = cam.targetYaw = yaw;
      g.gfx.cinematicDof = 0.22; g.gfx.cinematicBlur = 0;
    } };
  }, [+dist]);
  for (let i = 0; i < +frames; i++) {
    await page.waitForTimeout(5000);
    const out = `${prefix}-${i}.png`;
    await page.screenshot({ path: out, timeout: 180000 });
    console.log('saved', out);
  }
} finally {
  await browser.close();
}
