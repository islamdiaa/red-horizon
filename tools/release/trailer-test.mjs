// Record the ?trailer=1 cut headlessly and save the video plus frames decoded from it.
//   node tools/release/trailer-test.mjs <baseUrl> <outPrefix> [extraParams]
// (Under SwiftShader the cut renders far below real time: expect several minutes.)
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { root } from './relative-build.mjs';

const [base = 'http://127.0.0.1:5278/', prefix = '/tmp/rh-trailer', extra = 'q=medium&tod=dusk&climate=winter'] = process.argv.slice(2);
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) process.exitCode = 1; };
const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
  env: { ...process.env, LD_LIBRARY_PATH: path.join(root, 'tools/nsslibs/lib') },
});
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' || /\[trailer|\[director/.test(m.text())) console.log(`[${m.type()}] ${m.text()}`); });
  await page.goto(`${base}?trailer=1&autorecord=1&debug=1&${extra}`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => !!window.__game?.cameraDirector, null, { timeout: 300000 });
  // a few live frames with their title cards
  for (let i = 0; i < 3; i++) {
    await page.waitForTimeout(25000);
    const shot = await page.evaluate(() => `${window.__game.cameraDirector.current?.name} ${window.__game.cameraDirector.elapsed.toFixed(1)}s`);
    await page.screenshot({ path: `${prefix}-live${i}.png`, timeout: 180000 });
    console.log('live', i, shot);
  }
  await page.waitForFunction(() => !!window.__trailer, null, { timeout: 3_600_000, polling: 2000 });
  const info = await page.evaluate(async () => {
    const t = window.__trailer;
    if (!t.blob) return { size: 0 };
    const buf = new Uint8Array(await t.blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    const v = document.createElement('video');
    v.muted = true;
    v.src = URL.createObjectURL(t.blob);
    await new Promise((r) => { v.onloadeddata = r; setTimeout(r, 8000); });
    const frames = [];
    const c = document.createElement('canvas');
    for (const sec of [2, 10, 30, 60, 120, 200]) {
      await new Promise((r) => { v.onseeked = r; v.currentTime = sec; setTimeout(r, 4000); });
      c.width = v.videoWidth || 2; c.height = v.videoHeight || 2;
      c.getContext('2d').drawImage(v, 0, 0);
      frames.push(c.toDataURL('image/jpeg', 0.85));
    }
    return { size: t.blob.size, type: t.blob.type, frames: t.frames, b64: btoa(s), w: v.videoWidth, h: v.videoHeight, shots: frames };
  });
  ok(info.size > 100_000, `trailer recorded: ${info.type}, ${(info.size / 1048576).toFixed(2)} MB, ${info.w}×${info.h}, ${info.frames} frames drawn`);
  if (info.size) {
    writeFileSync(`${prefix}.webm`, Buffer.from(info.b64, 'base64'));
    info.shots.forEach((f, i) => writeFileSync(`${prefix}-frame${i}.jpg`, Buffer.from(f.split(',')[1], 'base64')));
  }
  await page.screenshot({ path: `${prefix}-result.png`, timeout: 180000 });
  ok(errors.length === 0, `no page errors ${JSON.stringify(errors.slice(0, 3))}`);
} finally {
  await browser.close();
}
