// End-to-end test of highlight clips: play a short skirmish, store its replay, open it in the replay viewer,
// press "Record clip", wait for the result dialog and save the video plus a few frames decoded from it.
//   node tools/release/clip-test.mjs <baseUrl> <outPrefix> [ffSeconds=150]
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { root } from './relative-build.mjs';

const [base = 'http://127.0.0.1:5278/', prefix = '/tmp/rh-clip', ff = '150', q = 'low'] = process.argv.slice(2);
// a screenshot needs a fresh frame: under a loaded SwiftShader one can take minutes, so never fail on it
const snap = async (page, path) => { try { await page.screenshot({ path, timeout: 240000 }); } catch (e) { console.log(`note: screenshot ${path} skipped (${e.message.split('\n')[0]})`); } };
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) process.exitCode = 1; };
const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
  env: { ...process.env, LD_LIBRARY_PATH: path.join(root, 'tools/nsslibs/lib') },
});
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' || /\[clip|\[director|\[share/.test(m.text())) console.log(`[${m.type()}] ${m.text()}`); });
  // 1. a recorded skirmish with armies from the start, fast-forwarded into the fighting
  await page.goto(`${base}?autostart=1&size=64&units=heavy&ai=brutal&fog=0&intro=0&q=${q}&ff=${ff}&seed=4242`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => !!window.__game?.recorder, null, { timeout: 300000 });
  const id = await page.evaluate(async () => {
    const g = window.__game;
    const data = g.recorder.toData();
    const { saveReplay } = await import('/src/replay/store.ts');
    await saveReplay(data);
    return data.id;
  });
  ok(!!id, `replay stored (${id})`);
  // 2. the replay viewer, a little before the end of the recording
  await page.goto(`${base}?autostart=1&replay=${id}&seek=${Math.max(0, +ff - 25)}&q=${q}`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForSelector('.rp-clip', { timeout: 300000 });
  await page.waitForFunction(() => !document.querySelector('.rp-seek'), null, { timeout: 300000 });
  await page.evaluate(() => { const b = document.querySelector('.rp-play'); if (document.querySelector('#replay-bar.paused')) b?.click(); });
  await page.waitForTimeout(1500);
  await snap(page, `${prefix}-viewer.png`);
  await page.click('.rp-clip');
  await page.waitForSelector('.clip-hud', { timeout: 60000 });
  await page.waitForTimeout(6000);
  await snap(page, `${prefix}-recording.png`);
  await page.waitForSelector('.clip-video', { timeout: 900000 });
  await page.waitForTimeout(1500);
  await snap(page, `${prefix}-result.png`);
  // 3. the video itself, and frames decoded from it
  const info = await page.evaluate(async () => {
    const v = document.querySelector('.clip-video');
    const blob = await (await fetch(v.src)).blob();
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    v.pause();
    v.muted = true;
    const frames = [];
    const c = document.createElement('canvas');
    for (const t of [1, 4, 8, 12, 16]) {
      await new Promise((r) => { v.onseeked = r; v.currentTime = t; setTimeout(r, 4000); });
      c.width = v.videoWidth; c.height = v.videoHeight;
      c.getContext('2d').drawImage(v, 0, 0);
      frames.push(c.toDataURL('image/jpeg', 0.85));
    }
    return { type: blob.type, size: blob.size, b64: btoa(s), w: v.videoWidth, h: v.videoHeight, frames, hasAudio: !!(v.mozHasAudio || v.webkitAudioDecodedByteCount || v.audioTracks?.length) };
  });
  ok(info.size > 50_000, `video recorded: ${info.type}, ${(info.size / 1048576).toFixed(2)} MB, ${info.w}×${info.h}`);
  writeFileSync(`${prefix}.webm`, Buffer.from(info.b64, 'base64'));
  info.frames.forEach((f, i) => writeFileSync(`${prefix}-frame${i}.jpg`, Buffer.from(f.split(',')[1], 'base64')));
  ok(errors.length === 0, `no page errors ${JSON.stringify(errors.slice(0, 3))}`);
} finally {
  await browser.close();
}
