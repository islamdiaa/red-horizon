// A long real-time session through the real UI on a slow machine: the E2E bot (tools/e2e) starts a mode from the menu
// and plays it the way a person does (clicks, keys, the build bar), at the browser's own pace (--realtime: no
// fast-forward), while this script samples every minute what a player on that machine would feel: frame rate, how
// fast the game clock runs against the wall clock, input-to-next-frame delay, memory and errors.
//
//   node tools/xb/vmplay.mjs <skirmish|campaign|coop> <minutes> [--level easy] [--profile casual] [--side allies]
//        [--browser chromium|firefox] [--channel chrome|msedge|moz-firefox] [--executable path] [--slow 4] [--size 1280x720]
//
// In a test VM run it from a copy of tools/xb next to a copy of tools/e2e (tools/xb/vme2e.sh does that), so the
// imports below resolve. GAME_URL / OUT_DIR as for every lab script. Writes OUT_DIR/vmplay-<mode>-<browser>.jsonl
// (a line per minute, then a summary line) plus the bot's own log and screenshots.
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const take = (name, def = null) => { const i = argv.indexOf(name); if (i < 0) return def; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const mode = argv.shift() ?? 'skirmish';
const minutes = +(argv.shift() ?? 30);
const level = take('--level', 'easy');
const profileName = take('--profile', mode === 'campaign' ? 'newcomer' : 'casual');
const side = take('--side', 'allies');
argv.push('--realtime');
if (!argv.includes('--slow')) argv.push('--slow', '4');

const { parseArgs, openBrowser, Bot, sleep } = await import('../e2e/lib.mjs');
const { PLAY } = await import('../e2e/profiles.mjs');
const { frameStats, sample, browserRssMB, instrument } = await import('./vmlib.mjs');

const o = parseArgs(argv);
const who = o.channel ?? o.browser;
const OUT = o.out;
fs.mkdirSync(OUT, { recursive: true });
const file = path.join(OUT, `vmplay-${mode}-${who}.jsonl`);
const write = (rec) => { fs.appendFileSync(file, JSON.stringify(rec) + '\n'); console.log(JSON.stringify(rec).slice(0, 400)); };
const T0 = Date.now();
const P = '.main-screen:not(.leaving) .mm-panel';

const browser = await openBrowser(o);
const bot = new Bot(o, browser, `vmplay-${mode}-${who}`);
await bot.open();
await bot.context.addInitScript(instrument);
// the input-to-next-frame probe: the time from a pointer event to the next animation frame (what the cursor and hover
// feedback wait for), recorded in the page
await bot.context.addInitScript(() => {
  window.__inp = [];
  addEventListener('pointermove', (e) => { const t = e.timeStamp; requestAnimationFrame((now) => { window.__inp.push(now - t); if (window.__inp.length > 400) window.__inp.shift(); }); }, { capture: true, passive: true });
});
write({ start: true, mode, minutes, level, profile: profileName, browser: who, version: browser.version(), url: o.url, ua: null });

let phase = 'menu';
let playErr = null;
const lat = { selectMs: [] };
try {
  await bot.goto();
  await bot.waitMenu(240000);
  const tMenu = Date.now() - T0;
  write({ menuMs: tMenu, ua: await bot.page.evaluate(() => navigator.userAgent), gl: await bot.page.evaluate(() => { try { const c = document.createElement('canvas').getContext('webgl2'); const d = c.getExtension('WEBGL_debug_renderer_info'); return d ? c.getParameter(d.UNMASKED_RENDERER_WEBGL) : c.getParameter(c.RENDERER); } catch (e) { return String(e); } }) });
  // ---- start the mode through the menu, as a player does
  if (mode === 'skirmish') {
    await bot.click(`${P} .opponent >> nth=0 >> .op-diff button[data-v="${level}"]`);
    await bot.shot('setup');
    await bot.click(`${P} .deploy`);
  } else if (mode === 'campaign') {
    await bot.nav('Campaign');
    await bot.waitFor('.cmp .cmp-tab');
    await bot.click(`.cmp .cmp-tab[data-tab="${side}"]`);
    await bot.waitFor('.cmp [data-act="deploy"]');
    const sel = `.cmp :is([data-level="${level}"], [data-diff="${level}"])`;
    if (!await bot.sees(sel)) throw new Error(`no campaign difficulty "${level}" on the campaign screen`);
    await bot.click(sel);
    await bot.shot('campaign');
    await bot.click('.cmp [data-act="deploy"]');
  } else if (mode === 'coop') {
    await bot.nav('Challenges');
    if (!await bot.waitFor('[data-coop="1"]', undefined, 60000)) throw new Error('no co-op switch on the Survival panel');
    await bot.click('[data-coop="1"]');
    if (await bot.sees(`[data-coopd="${level}"]`)) await bot.click(`[data-coopd="${level}"]`);
    await bot.shot('coop');
    await bot.click('.chl-sv[data-deploy] >> nth=0');
  } else throw new Error(`unknown mode ${mode}`);
  const tDeploy = Date.now();
  await bot.waitMatch({ timeout: 600000 });
  write({ matchLoadMs: Date.now() - tDeploy, setup: await bot.g((g) => ({ mission: g.setup.mission ?? null, opp: (g.setup.opponents ?? []).map((x) => x.difficulty), allies: (g.setup.allies ?? []).map((x) => x.difficulty), quality: g.gfx.quality ?? null, scale: g.gfx.currentRenderScale ?? null, w: innerWidth, h: innerHeight, dpr: devicePixelRatio })) });
  await bot.shot('match');
  phase = 'play';

  // ---- click-to-select latency (once before the bot plays, once after): click our first unit, wait for the selection
  const selectProbe = async () => {
    const u = (await bot.mine()).units.find((x) => x.t !== 'harv');
    if (!u) return null;
    await bot.lookAt(u.x, u.y);
    await bot.settleCamera();
    const p = await bot.toScreen(u.x, u.y, 0.3);
    await bot.page.keyboard.press('Escape').catch(() => {}); // (clears a selection; a pause menu would open on an empty one)
    await sleep(300);
    if (await bot.page.evaluate(() => !!document.querySelector('.pause-screen'))) { await bot.page.keyboard.press('Escape'); await sleep(500); }
    const t = Date.now();
    await bot.page.mouse.click(p.x, p.y);
    const ok = await bot.page.waitForFunction((id) => window.__game.selection.has(id), u.id, { polling: 'raf', timeout: 30000 }).then(() => true, () => false);
    return ok ? Date.now() - t : -1;
  };
  lat.selectMs.push(await selectProbe().catch(() => null));

  // ---- play, sampling once a minute until the wall-clock budget is spent (or the match ends)
  const end = Date.now() + minutes * 60000;
  let stop = false;
  const playing = PLAY[profileName](bot, { maxSim: 7200 }).then((r) => ({ r }), (e) => { if (!stop) playErr = String(e?.message ?? e).split('\n')[0].slice(0, 300); return { err: true }; });
  let prev = await bot.g((g) => ({ tick: g.world.tick, at: performance.now() }));
  let k = 0;
  while (Date.now() < end) {
    const done = await Promise.race([playing.then(() => true), sleep(60000).then(() => false)]);
    k++;
    // pointer moves over the map (the probe above times each one to the next frame)
    const area = await bot.playArea().catch(() => null);
    if (area) for (let i = 0; i < 4; i++) { await bot.page.mouse.move(area.x0 + (area.x1 - area.x0) * (0.3 + 0.1 * i), (area.y0 + area.y1) / 2); await sleep(150); }
    const s = await sample(bot.page).catch((e) => ({ err: String(e).slice(0, 120) }));
    const f = await frameStats(bot.page, 3000).catch(() => null);
    const now = await bot.g((g) => ({ tick: g.world.tick, at: performance.now(), over: g.world.gameOver, won: g.world.gameOver ? g.world.winnerTeam === g.local.team : null, credits: g.local.credits })).catch(() => null);
    const inp = await bot.page.evaluate(() => { const a = window.__inp.splice(0); const s = a.sort((x, y) => x - y); return s.length ? { n: s.length, med: Math.round(s[s.length >> 1]), max: Math.round(s[s.length - 1]) } : null; }).catch(() => null);
    const pace = now && prev ? +(((now.tick - prev.tick) / 20) / ((now.at - prev.at) / 1000)).toFixed(2) : null;
    write({ min: k, wallS: Math.round((Date.now() - T0) / 1000), gameT: s.gameT, pace, frame: f, inputToFrame: inp, units: s.units, blds: s.blds, heapMB: s.heapMB, geo: s.geo, tex: s.tex, prog: s.prog, dom: s.dom, listeners: s.listeners, long: s.long, csp: s.csp, rss: browserRssMB(who), errors: bot.errors.length + bot.allErrors.length, credits: now?.credits, over: now?.over, won: now?.won });
    if (k % 10 === 0) await bot.shot(`min${k}`);
    if (now) prev = now;
    if (done || now?.over) break;
  }
  stop = true;
  phase = 'end';
  const fin = await bot.g((g) => ({ t: Math.round(g.world.time), over: g.world.gameOver, won: g.world.gameOver ? g.world.winnerTeam === g.local.team : null, units: g.world.units.filter((u) => u.alive && u.owner === g.local).length, blds: g.world.buildings.filter((b) => b.alive && b.owner === g.local).length, foes: g.world.players.filter((p) => g.local.isEnemy(p) && !p.defeated).length }));
  await bot.shot('end');
  if (!fin.over) lat.selectMs.push(await Promise.race([selectProbe().catch(() => null), sleep(60000).then(() => null)]));
  write({ summary: true, wallMin: +((Date.now() - T0) / 60000).toFixed(1), fin, selectMs: lat.selectMs, frictions: bot.frictions.slice(0, 30), errors: [...new Set([...bot.errors, ...bot.allErrors])].slice(0, 12), csp: [...bot.csp, ...(await bot.page.evaluate(() => window.__e2eCsp ?? []).catch(() => []))].slice(0, 6), playErr });
} catch (e) {
  write({ summary: true, fail: phase, error: String(e?.stack ?? e).split('\n').slice(0, 3).join(' | ').slice(0, 500), wallMin: +((Date.now() - T0) / 60000).toFixed(1), errors: [...new Set([...bot.errors, ...bot.allErrors])].slice(0, 12), frictions: bot.frictions.slice(0, 20), playErr });
  await bot.shot('error').catch(() => {});
}
fs.writeFileSync(path.join(bot.dir, 'log.txt'), bot.logLines.join('\n') + '\n');
await browser.close().catch(() => {});
process.exit(0);
