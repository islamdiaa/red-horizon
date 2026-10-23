// The E2E bot: plays Red Horizon through the real UI (mouse, keyboard, what is on screen) and checks every journey
// for console errors and CSP violations. See tools/README.md (End-to-end bot).
//
//   node tools/e2e/run.mjs [journey,...] [--url http://host:port/] [--browser chromium|firefox|webkit]
//                          [--channel name] [--cdp http://127.0.0.1:9222] [--out dir] [--size 1280x720] [--slow 2] [--realtime]
//                          [--serve distDir] [--serve-b distDirB,distDirC] [--locale en-US] [--no-shots] [--list]
//
// --url      the game to test (default http://127.0.0.1:5302/, or $E2E_URL); --serve starts tools/e2e/serve.mjs on
//            that URL's port with a build directory instead (production headers, so the CSP is the real one)
// --cdp      drive an already running Chromium (Android Chrome through `adb forward tcp:9222 localabstract:chrome_devtools_remote`)
// --slow     multiplies every timeout (software GPUs, small VMs)
// --realtime waits for the game clock instead of fast-forwarding the simulation between actions
//
// --channel  chrome, msedge (with --browser chromium) or moz-firefox (with --browser firefox and --executable <path>)
//
// Environment: E2E_URL (or GAME_URL) and E2E_OUT (or OUT_DIR) are the defaults for --url and --out; E2E_CHROME_ARGS
// replaces the Chromium GPU flags (default SwiftShader; "--use-angle=d3d11 --ignore-gpu-blocklist" for Direct3D 11
// WARP on Windows); E2E_FIREFOX_PREFS is JSON (e.g. {"webgl.force-enabled":true}); HEADED=1 shows the browser.
// In a test VM: copy the whole tools/e2e folder under the Playwright folder (so `playwright` resolves) and run
// run.mjs there. A journey that runs past E2E_JOURNEY_MINUTES (default 40, times --slow) fails. Exit code 1 when
// any check failed.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, openBrowser, Bot, JourneyAbort, loadJourney, ROOT } from './lib.mjs';
import { serve } from './serve.mjs';

export const JOURNEYS = ['first-launch', 'skirmish-setup', 'skirmish-ally', 'campaign', 'saves', 'replays', 'editor', 'challenges', 'settings', 'pwa-update', 'abuse', 'menus', 'keyboard', 'touch-mission', 'motion'];

const o = parseArgs();
if (o.help) {
  console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n'));
  process.exit(0);
}
if (o.list) { console.log(JOURNEYS.join('\n')); process.exit(0); }
const names = o.journeys.length ? o.journeys : JOURNEYS;
for (const n of names) if (!fs.existsSync(path.join(ROOT, 'tools/e2e/journeys', `${n}.mjs`))) { console.error(`unknown journey ${n} (have: ${JOURNEYS.join(', ')})`); process.exit(2); }

let server = null;
if (o.serve) {
  const u = new URL(o.url);
  server = await serve(o.serve, { port: +(u.port || 80), host: u.hostname });
  console.log(`serving ${o.serve} at ${server.url}`);
}
fs.mkdirSync(o.out, { recursive: true });
const browser = await openBrowser(o);
const results = [];
const t0 = Date.now();
for (const name of names) {
  const mod = await loadJourney(name);
  const bot = new Bot(o, browser, name);
  const r = { name, ok: false, seconds: 0, checks: [], errors: [], aborted: null, skipped: null };
  const ts = Date.now();
  try {
    await bot.open();
    const ctx = { o, server, browser };
    const skip = mod.skip?.(ctx);
    if (skip) { r.skipped = skip; bot.log(`skipped: ${skip}`); }
    else {
      // a watchdog: a page that stops answering (a wedged software GPU) fails the journey instead of hanging the run
      let timer;
      const limit = (Number(process.env.E2E_JOURNEY_MINUTES) || 40) * 60000 * o.slow;
      await Promise.race([mod.default(bot, ctx), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`timed out after ${Math.round(limit / 60000)} min (E2E_JOURNEY_MINUTES)`)), limit); })])
        .finally(() => clearTimeout(timer));
      await bot.noErrors('end of journey');
    }
  } catch (e) {
    r.aborted = e instanceof JourneyAbort ? e.message : `${e.message?.split('\n')[0]}`;
    if (!(e instanceof JourneyAbort)) { bot.check(false, 'journey ran to the end', `${String(e.stack ?? e).replace(/\x1b\[\d+m/g, '').split('\n').slice(0, 8).join(' | ')}`); }
    await bot.shot('aborted').catch(() => {});
    await bot.noErrors('at abort').catch(() => {});
  }
  await bot.context?.close().catch(() => {});
  r.seconds = Math.round((Date.now() - ts) / 1000);
  r.checks = bot.checks;
  r.errors = [...new Set(bot.allErrors)];
  r.badResponses = [...new Set(bot.badResponses)].slice(0, 20);
  r.ok = !r.aborted && bot.checks.every((c) => c.ok);
  if (r.skipped) r.ok = true;
  results.push(r);
  fs.writeFileSync(path.join(bot.dir, 'log.txt'), bot.logLines.join('\n') + '\n');
  console.log(`== ${name}: ${r.skipped ? 'SKIPPED' : r.ok ? 'PASS' : 'FAIL'} (${bot.checks.filter((c) => c.ok).length}/${bot.checks.length} checks, ${r.seconds}s)${r.aborted ? ` aborted: ${r.aborted}` : ''}`);
}
await browser.close().catch(() => {});
await server?.close();

const summary = [
  `E2E ${new Date().toISOString()}  ${o.url}  ${o.browser}${o.cdp ? ' (cdp)' : ''}  ${o.width}x${o.height}  ${Math.round((Date.now() - t0) / 1000)}s`,
  ...results.map((r) => `${r.skipped ? 'SKIP' : r.ok ? 'PASS' : 'FAIL'}  ${r.name.padEnd(15)} ${String(r.checks.filter((c) => c.ok).length).padStart(3)}/${String(r.checks.length).padEnd(3)} ${String(r.seconds).padStart(5)}s${r.skipped ? `  ${r.skipped}` : ''}${r.aborted ? `  aborted: ${r.aborted}` : ''}`),
  ...results.flatMap((r) => r.checks.filter((c) => !c.ok).map((c) => `  [${r.name}] FAIL ${c.what}${c.detail ? `: ${c.detail.slice(0, 300)}` : ''}`)),
];
fs.writeFileSync(path.join(o.out, 'report.json'), JSON.stringify({ url: o.url, browser: o.browser, size: [o.width, o.height], results }, null, 1));
fs.writeFileSync(path.join(o.out, 'summary.txt'), summary.join('\n') + '\n');
console.log('\n' + summary.join('\n'));
process.exit(results.every((r) => r.ok) ? 0 : 1);
