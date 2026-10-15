// QA probe: CPU profile (CDP) of the page for N seconds after starting a game.
// node tools/qa/cpu_profile.mjs menu|auto [seconds]
import { launch, sleep, BASE } from './browser.mjs';
const mode = process.argv[2] ?? 'menu', secs = +(process.argv[3] ?? 10);
const { browser, page, errors } = await launch();
if (mode === 'menu') {
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('.main-screen .deploy', { timeout: 120000 });
  await sleep(1500);
  await page.click('.main-screen .deploy');
} else {
  await page.goto(BASE + (process.argv[4] ?? '?autostart=1&size=96&units=light&fog=1'), { waitUntil: 'load' });
}
await page.waitForFunction(() => window.__game && window.__game.hud && !window.__game.setup.demo, null, { timeout: 180000 });
await sleep(3000);
await page.keyboard.press('Space');
await sleep(4000);
const client = await page.context().newCDPSession(page);
await client.send('Profiler.enable');
await client.send('Profiler.setSamplingInterval', { interval: 1000 });
await client.send('Profiler.start');
await sleep(secs * 1000);
const { profile } = await client.send('Profiler.stop');
const self = new Map();
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const dt = profile.timeDeltas; let total = 0;
const counts = new Map();
profile.samples.forEach((id, i) => { counts.set(id, (counts.get(id) ?? 0) + (dt[i] ?? 0)); total += dt[i] ?? 0; });
for (const [id, t] of counts) {
  const n = byId.get(id); const cf = n.callFrame;
  const key = `${cf.functionName || '(anon)'} ${cf.url.split('/').slice(-2).join('/')}:${cf.lineNumber}`;
  self.set(key, (self.get(key) ?? 0) + t);
}
const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25);
console.log(`${mode}: total sampled ${(total / 1000).toFixed(0)}ms over ${secs}s`);
for (const [k, t] of top) console.log(`  ${(t / 1000).toFixed(0).padStart(6)}ms  ${k}`);
const st = await page.evaluate(() => ({ t: window.__game.world.time, paused: window.__game.paused }));
console.log(JSON.stringify(st), 'errors', errors.length);
await browser.close();
