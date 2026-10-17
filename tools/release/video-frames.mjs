// Decode frames from a recorded clip / trailer (WebM from MediaRecorder has no index, so frames are taken while
// the video plays rather than by seeking).
//   node tools/release/video-frames.mjs <video.webm> <outPrefix> [count=6]
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { root } from './relative-build.mjs';

const [file, prefix, count = '6'] = process.argv.slice(2);
const b64 = readFileSync(file).toString('base64');
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'], env: { ...process.env, LD_LIBRARY_PATH: path.join(root, 'tools/nsslibs/lib') } });
try {
  const page = await browser.newPage();
  const out = await page.evaluate(async ([b64, n]) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const v = document.createElement('video');
    v.muted = true;
    v.src = URL.createObjectURL(new Blob([bytes], { type: 'video/webm' }));
    document.body.appendChild(v);
    await v.play();
    // the real length: play through once (no duration in the header)
    const frames = [];
    const c = document.createElement('canvas');
    const t0 = performance.now();
    let last = -1;
    await new Promise((resolve) => {
      const grab = () => {
        const t = v.currentTime;
        if (t - last >= 1.6 && v.videoWidth) {
          last = t;
          c.width = v.videoWidth; c.height = v.videoHeight;
          c.getContext('2d').drawImage(v, 0, 0);
          frames.push({ t, url: c.toDataURL('image/jpeg', 0.85) });
        }
        if (v.ended || performance.now() - t0 > 240000) resolve(); else setTimeout(grab, 100);
      };
      grab();
    });
    // spread `n` frames over the clip
    const pick = [];
    for (let i = 0; i < n && frames.length; i++) pick.push(frames[Math.min(frames.length - 1, Math.round((i * (frames.length - 1)) / Math.max(1, n - 1)))]);
    return { length: v.currentTime, w: v.videoWidth, h: v.videoHeight, frames: pick };
  }, [b64, +count]);
  out.frames.forEach((f, i) => writeFileSync(`${prefix}-frame${i}.jpg`, Buffer.from(f.url.split(',')[1], 'base64')));
  console.log(`${file}: ${out.w}×${out.h}, ${out.length.toFixed(1)} s; frames at ${out.frames.map((f) => f.t.toFixed(1)).join(', ')} s`);
} finally {
  await browser.close();
}
