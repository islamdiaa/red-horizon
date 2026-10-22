// Net lab match runner: two real browsers (Playwright servers in the peer containers, or any two Playwright
// endpoints) play a multiplayer match through the real lobby UI, the game's nginx and the relay, while pktem
// routers shape each player's link. Scripted orders from both sides; the runner checks the hashes, chat, stalls,
// reconnects and the results, and measures input-to-action latency.
//
//   node tools/net-lab/match.mjs --profile rtt200 [--mode 1v1|2v2] [--churn 150] [--out DIR] [--tag NAME]
//        [--a ws://10.231.1.10:3000/pw] [--b ws://10.231.2.10:3000/pw] [--url http://10.231.200.10:8080/]
//        [--shape-a http://10.231.1.2:9000/] [--shape-b http://10.231.2.2:9000/]   ('-' = no shaper: VM runs)
//
// Exit code 0 when every check passed. A JSON report goes to OUT/<tag>.json (screenshots on failure).
import { chromium, firefox, webkit } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PROFILES, outageOf } from './profiles.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const profileName = arg('profile', 'lan');
const mode = arg('mode', '1v1');
const churnS = Number(arg('churn', '150'));
const FAST = process.argv.includes('--fast'); // churn only, no 1v1 hunt-down (determinism is proven by the hash agreement)
// reports: --out, else $NETLAB_OUT, else tools/net-lab/out (git-ignored)
const out = arg('out', process.env.NETLAB_OUT || fileURLToPath(new URL('./out/', import.meta.url)));
const tag = arg('tag', `${profileName}-${mode}-${new Date().toISOString().slice(5, 16).replace(/[-:T]/g, '')}`);
const base = arg('url', 'http://10.231.200.10:8080/');
const endpoints = [arg('a', 'ws://10.231.1.10:3000/pw'), arg('b', 'ws://10.231.2.10:3000/pw')];
// the browser engine behind each endpoint (peer-server.mjs PEER_ENGINE): chromium | firefox | webkit
const engines = [arg('engine-a', 'chromium'), arg('engine-b', 'chromium')];
const TYPES = { chromium, firefox, webkit };
const shapers = [arg('shape-a', 'http://10.231.1.2:9000/'), arg('shape-b', 'http://10.231.2.2:9000/')];
const profile = PROFILES[profileName];
if (!profile) { console.error('unknown profile', profileName, Object.keys(PROFILES)); process.exit(2); }
mkdirSync(out, { recursive: true });

const t0 = Date.now();
const log = (...a) => console.log(`${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s`, ...a);
const report = { tag, profile: profileName, mode, churnS, engines, started: new Date().toISOString(), checks: {}, failures: [], notes: [], peers: {} };
const check = (name, ok, detail) => { report.checks[name] = { ok: !!ok, detail }; if (!ok) { report.failures.push(`${name}: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`); log('FAIL', name, detail ?? ''); } else log('ok  ', name, detail === undefined ? '' : typeof detail === 'string' ? detail : JSON.stringify(detail)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shape(i, body) {
  if (shapers[i] === '-') return null;
  const r = await fetch(shapers[i], { method: 'POST', body: JSON.stringify(body) });
  return r.json();
}
const LAN = { delay_ms: 0, jitter_ms: 0, loss: 0, rate_kbit: 0, down: false };

// ---------------------------------------------------------------------------------------------------------
// in-page instrumentation (installed once the match runs)
// ---------------------------------------------------------------------------------------------------------
function instrument() {
  const g = window.__game, link = g.net, s = link.session, ls = s.ls, c = link.client;
  const nl = window.__nl = { lat: [], pending: [], samples: [], states: [], banners: [], chats: [], rejectedAt0: ls.rejected, t0: performance.now(), tick0: g.world.tick, stallFrames: 0 };
  const origIssue = ls.issue.bind(ls);
  ls.issue = (cmd) => { if (!ls.watching && ls.status === 'live') nl.pending.push(performance.now()); origIssue(cmd); };
  const o = ls.o, exec = o.onExecute;
  o.onExecute = (cmd, tick) => {
    if (cmd.player === g.local.id) { const at = nl.pending.shift(); if (at !== undefined) nl.lat.push(Math.round(performance.now() - at)); }
    exec?.(cmd, tick);
  };
  c.onState((st) => nl.states.push([Math.round(performance.now() - nl.t0), st]));
  // what both players must agree on, taken at the tick the match ends (afterwards each client runs the finale
  // locally, outside the lockstep)
  const oa = ls.afterStep.bind(ls);
  ls.afterStep = () => { const h = oa(); if (ls.status === 'over' && !nl.over) nl.over = window.__nlSummary(); return h; };
  window.__nlSummary = () => {
    const w = g.world, r = (v) => Math.round(v * 1000) / 1000;
    return {
      tick: w.tick, over: w.gameOver, winner: w.winnerTeam,
      players: w.players.map((p) => ({ id: p.id, cash: p.cash, defeated: !!p.defeated, human: p.isHuman })),
      units: w.units.filter((u) => u.alive).length, buildings: w.buildings.filter((b) => b.alive).length,
      hp: r(w.units.reduce((a, u) => a + (u.alive ? u.hp : 0), 0)), pos: r(w.units.reduce((a, u) => a + (u.alive ? u.x * 3 + u.y : 0), 0)),
    };
  };
  let lastBanner = '';
  setInterval(() => {
    const b = document.querySelector('.net-banner')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    if (b !== lastBanner) { nl.banners.push([Math.round(performance.now() - nl.t0), b]); lastBanner = b; }
  }, 200);
  setInterval(() => {
    nl.samples.push({ t: Math.round(performance.now() - nl.t0), tick: g.world.tick, confirmed: ls.confirmed, delay: ls.delay, rtt: s.rtt.get(c.seat) ?? 0, st: c.state, cu: s.catchingUp });
    if (nl.samples.length > 4000) nl.samples.shift();
  }, 1000);
  new MutationObserver(() => {
    for (const ln of document.querySelectorAll('.net-chat .ln:not([data-seen])')) { ln.dataset.seen = '1'; nl.chats.push([Math.round(performance.now() - nl.t0), ln.textContent]); }
  }).observe(document.body, { childList: true, subtree: true });
  return { local: g.local.id, seat: c.seat, players: g.world.players.map((p) => ({ id: p.id, name: p.name, team: p.team, human: p.isHuman, faction: p.faction })) };
}

/** Scripted orders for one peer. phase: churn | hunt (A) / flee (B). */
function orders({ phase, seed }) {
  const g = window.__game, w = g.world, me = g.local;
  let r = seed >>> 0;
  const rnd = () => { r = (r * 1664525 + 1013904223) >>> 0; return r / 4294967296; };
  const mine = w.units.filter((u) => u.alive && u.owner === me);
  const armed = mine.filter((u) => u.weapons.length);
  const m = w.map;
  const home = mine.length ? { x: mine.reduce((a, u) => a + u.x, 0) / mine.length, y: mine.reduce((a, u) => a + u.y, 0) / mine.length } : { x: m.w / 2, y: m.h / 2 };
  const issued = [];
  const issue = (cmd) => { g.issue(cmd); issued.push(cmd.c); };
  if (phase === 'deploy') {
    const mcv = mine.find((u) => u.ut.deploysInto);
    if (mcv) issue({ c: 'deploy', player: me.id, units: [mcv.id] });
  } else if (phase === 'churn') {
    // a few small groups wander near home: lots of orders, little fighting
    for (let k = 0; k < 2 && armed.length; k++) {
      const grp = armed.filter(() => rnd() < 0.5).map((u) => u.id);
      if (!grp.length) continue;
      const x = Math.max(2, Math.min(m.w - 3, home.x + (rnd() - 0.5) * 14)), y = Math.max(2, Math.min(m.h - 3, home.y + (rnd() - 0.5) * 14));
      issue({ c: 'move', player: me.id, units: grp, x, y, attackMove: rnd() < 0.5 });
    }
    if (rnd() < 0.3 && armed.length) issue({ c: 'stance', player: me.id, units: armed.slice(0, 3).map((u) => u.id), stance: rnd() < 0.5 ? 'guard' : 'aggressive' });
  } else if (phase === 'flee') {
    // B gives up: everything passive, to the middle of the map
    if (mine.length) {
      issue({ c: 'stance', player: me.id, units: mine.map((u) => u.id), stance: 'passive' });
      issue({ c: 'move', player: me.id, units: mine.map((u) => u.id), x: m.w / 2, y: m.h / 2 });
    }
    for (const b of w.buildings) if (b.alive && b.owner === me && !b.selling) issue({ c: 'sell', player: me.id, building: b.id });
  } else if (phase === 'hunt') {
    const foes = w.units.filter((u) => u.alive && u.owner !== me && u.owner.team !== me.team && u.owner.isHuman);
    const fb = w.buildings.filter((b) => b.alive && b.owner !== me && b.owner.team !== me.team && b.owner.isHuman && !b.bt.wall);
    const tgt = foes.length ? foes : fb;
    if (tgt.length && armed.length) {
      const x = tgt.reduce((a, u) => a + u.x, 0) / tgt.length, y = tgt.reduce((a, u) => a + u.y, 0) / tgt.length;
      issue({ c: 'move', player: me.id, units: armed.map((u) => u.id), x, y, attackMove: true });
    }
  }
  return issued.length;
}

// ---------------------------------------------------------------------------------------------------------
// run
// ---------------------------------------------------------------------------------------------------------
const browsers = [], pages = [];
const errors = [[], []];
let exit = 1;
try {
  for (const [i, ep] of endpoints.entries()) {
    const b = await TYPES[engines[i]].connect(ep, { timeout: 60000 });
    browsers.push(b);
    const ctx = await b.newContext({ viewport: { width: 960, height: 540 } });
    await ctx.addInitScript(() => {
      if (!localStorage.getItem('rh.settings')) localStorage.setItem('rh.settings', JSON.stringify({ quality: 'low', fullscreen: false }));
      document.addEventListener('securitypolicyviolation', (e) => console.error(`CSP violation: ${e.violatedDirective} ${e.blockedURI}`));
    });
    const page = await ctx.newPage();
    page.setDefaultTimeout(180000);
    page.on('console', (m) => { if (m.type() === 'error') errors[i].push(m.text().slice(0, 300)); });
    page.on('pageerror', (e) => errors[i].push(`pageerror: ${e.message.slice(0, 300)}`));
    pages.push(page);
  }
  const [A, B] = pages;
  const until = (p, fn, a, ms = 300000) => p.waitForFunction(fn, a, { timeout: ms, polling: 250 });
  for (const i of [0, 1]) await shape(i, { both: LAN, reset: 1, label: 'load' });

  // ---- load both pages at LAN speed (the asset download is not under test), then shape the links
  const url = base + '?q=low&hd=0&demo=0&debug=1';
  await Promise.all(pages.map((p) => p.goto(url, { waitUntil: 'load', timeout: 300000 })));
  await Promise.all(pages.map((p) => p.waitForSelector('.mm-nav-btn', { timeout: 300000 })));
  log('pages loaded');
  const steady = profile.link ?? LAN;
  for (const i of [0, 1]) if (!profile.only || profile.only === 'ab'[i]) await shape(i, { both: { ...LAN, ...steady }, reset: 1, label: profileName });

  // ---- lobby: A creates, B joins by code, chat both ways, settings, ready, start
  const tLobby = Date.now();
  for (const [i, p] of pages.entries()) {
    await p.locator('.mm-nav-btn', { hasText: 'Multiplayer' }).click();
    await p.waitForSelector('.lob [data-a="create"]');
    await until(p, () => document.querySelector('.lob [data-st]')?.classList.contains('ok'), undefined, 60000);
    await p.fill('.lob [data-k="name"]', i ? 'Bravo' : 'Alpha');
  }
  await A.click(`.lob [data-mode="${mode}"]`);
  await A.click('.lob [data-a="create"]');
  await A.waitForSelector('.lob [data-code]', { timeout: 60000 });
  const code = (await A.textContent('.lob [data-code]')).trim();
  report.room = code;
  log('room', code);
  await A.selectOption('.lob [data-set="size"]', '64');
  await until(A, () => document.querySelector('.lob [data-set="size"]')?.value === '64', undefined, 30000);
  await A.selectOption('.lob [data-set="startUnits"]', 'light');
  await until(A, () => document.querySelector('.lob [data-set="startUnits"]')?.value === 'light', undefined, 30000);
  if (mode === '2v2') {
    // A + AI against B + AI: slots 0,1 are team A, 2,3 team B (src/net/settings.ts slotTeam); B sits in slot 2
    await A.selectOption('.lob [data-slot="1"]', 'ai:normal');
    await until(A, () => document.querySelector('.lob [data-slot="1"]')?.value === 'ai:normal', undefined, 30000);
    await A.selectOption('.lob [data-slot="3"]', 'ai:normal');
    await until(A, () => document.querySelector('.lob [data-slot="3"]')?.value === 'ai:normal', undefined, 30000);
  }
  await B.fill('.lob [data-k="code"]', code);
  await B.click('.lob [data-a="join"]');
  await B.waitForSelector('.lob [data-code]', { timeout: 60000 });
  if (mode === '2v2') { const mv = B.locator('.lob [data-move="2"]'); if (await mv.count()) { await mv.click(); await sleep(1500); } }
  await B.selectOption('.lob [data-me="faction"]', 'soviet');
  await A.selectOption('.lob [data-me="faction"]', 'allies');
  const lobbyChat = async (from, to, text) => {
    const t = Date.now();
    await from.fill('.lob [data-chat] input', text);
    await from.press('.lob [data-chat] input', 'Enter');
    try { await until(to, (x) => [...document.querySelectorAll('.lob-log .ln')].some((l) => l.textContent.includes(x)), text, 30000); return Date.now() - t; } catch { return -1; }
  };
  const lc1 = await lobbyChat(B, A, `gl hf ${profileName}`);
  await sleep(1200);
  const lc2 = await lobbyChat(A, B, 'you too');
  check('lobby chat both ways', lc1 >= 0 && lc2 >= 0, { msBA: lc1, msAB: lc2 });
  await B.click('.lob [data-a="ready"]');
  await until(A, () => { const b = document.querySelector('.lob [data-a="start"]'); return b && !b.disabled; }, undefined, 60000);
  report.lobbyMs = Date.now() - tLobby;
  await A.click('.lob [data-a="start"]');
  const tStart = Date.now();
  await Promise.all(pages.map((p) => until(p, () => window.__game?.net && window.__game.world.tick > 20, undefined, 600000)));
  report.startMs = Date.now() - tStart;
  log('match running', report.startMs, 'ms after start');
  const info = await Promise.all(pages.map((p) => p.evaluate(instrument)));
  report.peers = { A: info[0], B: info[1] };

  // ---- deploy, then churn orders on both sides (with the profile's outage, if any, on its peer)
  await Promise.all(pages.map((p, i) => p.evaluate(orders, { phase: 'deploy', seed: 1 + i })));
  const outage = outageOf(profile);
  let k = 0;
  const churnEnd = Date.now() + churnS * 1000;
  const chatProbe = { sent: [], got: [] };
  let outageDone = !outage;
  const outageLog = {};
  while (Date.now() < churnEnd || !outageDone) {
    k++;
    await Promise.all(pages.map((p, i) => p.evaluate(orders, { phase: 'churn', seed: k * 7919 + i * 104729 }).catch(() => 0)));
    if (k === 6) {
      // in-match chat through the UI: A -> B
      const t = Date.now();
      await A.click('.net-chip [data-a="chat"]');
      await A.fill('.net-chat input', `ping ${profileName}`);
      await A.press('.net-chat input', 'Enter');
      chatProbe.sent.push(t);
      try { await until(B, (x) => [...document.querySelectorAll('.net-chat .ln')].some((l) => l.textContent.includes(x)), `ping ${profileName}`, 30000); chatProbe.got.push(Date.now() - t); } catch { chatProbe.got.push(-1); }
    }
    if (outage && !outageLog.start && Date.now() > churnEnd - churnS * 1000 + outage.after * 1000) {
      const who = outage.peer === 'a' ? 0 : 1;
      outageLog.start = Date.now();
      outageLog.tickA = await A.evaluate(() => __game.world.tick);
      await shape(who, { both: { down: true }, label: `outage ${outage.secs}s` });
      log(`outage on ${outage.peer} for ${outage.secs}s`);
      // meanwhile watch the other side
      const other = pages[1 - who], victim = pages[who];
      const tEnd = outageLog.start + outage.secs * 1000;
      while (Date.now() < tEnd) {
        await sleep(1000);
        const st = await other.evaluate(() => ({ tick: __game.world.tick, banner: document.querySelector('.net-banner')?.textContent?.replace(/\s+/g, ' ').trim() ?? '', drop: !!document.querySelector('.net-banner button') }));
        if (st.banner && !outageLog.otherBannerAt) outageLog.otherBannerAt = Date.now() - outageLog.start;
        if (st.drop && !outageLog.dropOfferedAt) outageLog.dropOfferedAt = Date.now() - outageLog.start;
        outageLog.otherLast = st;
        const vs = await victim.evaluate(() => ({ st: __game.net.client.state, banner: document.querySelector('.net-banner')?.textContent?.replace(/\s+/g, ' ').trim() ?? '' })).catch(() => null);
        if (vs && vs.banner && !outageLog.victimBannerAt) { outageLog.victimBannerAt = Date.now() - outageLog.start; outageLog.victimBanner = vs.banner; }
        if (vs && vs.st !== 'open' && !outageLog.victimNoticedAt) { outageLog.victimNoticedAt = Date.now() - outageLog.start; outageLog.victimState = vs.st; }
      }
      await shape(who, { both: { ...LAN, ...steady }, label: 'restored' });
      outageLog.restored = Date.now();
      log('link restored');
      // recovery: both tick again and the victim catches up with the other (or is replaced by the AI)
      const tickOther0 = await other.evaluate(() => __game.world.tick);
      try {
        await until(victim, (t) => __game.world.tick >= t && !__game.net.session.catchingUp && __game.net.client.state === 'open', tickOther0, 240000);
        outageLog.victimCaughtUpMs = Date.now() - outageLog.restored;
      } catch { outageLog.victimCaughtUpMs = -1; }
      const st2 = await Promise.all(pages.map((p) => p.evaluate(() => ({ tick: __game.world.tick, watching: __game.net.session.ls.watching, state: __game.net.client.state, dropped: __game.setup.net?.drops ?? [] }))));
      outageLog.after = st2;
      outageDone = true;
      report.outage = { ...outage, ...outageLog, start: undefined, restored: undefined };
    }
    await sleep(3000);
  }
  check('in-match chat A->B', chatProbe.got.length && chatProbe.got.every((x) => x >= 0), { ms: chatProbe.got });
  if (outage) {
    const o = report.outage;
    const beyond = outage.secs * 1000 > outage.graceMs;
    check('outage: the other player is told who they wait for', o.otherBannerAt > 0 && o.otherBannerAt < 8000, { bannerAtMs: o.otherBannerAt, last: o.otherLast?.banner });
    if (!beyond) {
      check('outage: the victim recovers and catches up', o.victimCaughtUpMs >= 0 && o.victimCaughtUpMs < 60000, { caughtUpMs: o.victimCaughtUpMs, victimNoticedAt: o.victimNoticedAt, victimState: o.victimState });
      check('outage: still a player (not replaced by the AI)', o.after.every((s) => !s.dropped.length) && !o.after[outage.peer === 'a' ? 0 : 1].watching, o.after);
    } else {
      check('long outage: the victim is replaced by the AI and watches', o.after.every((s) => s.dropped.length === 1) && o.after[outage.peer === 'a' ? 0 : 1].watching, o.after);
    }
    check('outage: the victim is told about the lost connection', !!o.victimBannerAt || !!o.victimNoticedAt, { victimBannerAt: o.victimBannerAt, banner: o.victimBanner, noticedAt: o.victimNoticedAt });
  }

  // ---- the end: B gives up, A hunts B down (1v1); 2v2 just stops after the churn
  const bReplaced = report.outage?.after?.[1]?.watching;
  if (mode === '1v1' && !bReplaced && !FAST) {
    log('end phase');
    const tEnd = Date.now() + 420000;
    let j = 0;
    while (Date.now() < tEnd) {
      const over = await Promise.all(pages.map((p) => p.evaluate(() => __game.world.gameOver)));
      if (over.every(Boolean)) break;
      if (j % 3 === 0) await B.evaluate(orders, { phase: 'flee', seed: j }).catch(() => 0);
      await A.evaluate(orders, { phase: 'hunt', seed: j }).catch(() => 0);
      j++;
      await sleep(4000);
    }
    const ends = await Promise.all(pages.map((p) => p.evaluate(() => window.__nl.over ?? null)));
    report.end = ends;
    check('match ended on both', ends.every((e) => e?.over), ends.map((e) => e && [e.tick, e.over]));
    check('results agree at the final tick (tick, winner, world summary)', !!ends[0] && JSON.stringify(ends[0]) === JSON.stringify(ends[1]), ends);
    try {
      await Promise.all(pages.map((p) => until(p, () => !!document.querySelector('.end-screen'), undefined, 60000)));
      const scr = await Promise.all(pages.map((p) => p.evaluate(() => document.querySelector('.end-screen')?.className ?? '')));
      check('results screens: A won, B lost', /\bwin\b/.test(scr[0]) && /\blose\b/.test(scr[1]), scr);
    } catch (e) { check('results screens shown', false, String(e).slice(0, 200)); }
  } else {
    report.end = await Promise.all(pages.map((p) => p.evaluate(() => window.__nlSummary())));
  }

  // ---- the numbers
  const hashes = await Promise.all(pages.map((p) => p.evaluate(() => __game.net.session.ls.hashes)));
  const hm = new Map(hashes[0]);
  let compared = 0, differ = 0;
  for (const [t, h] of hashes[1]) if (hm.has(t)) { compared++; if (hm.get(t) !== h) differ++; }
  const desync = await Promise.all(pages.map((p) => p.evaluate(() => __game.net.session.desync)));
  check('no desync (hashes)', differ === 0 && desync.every((d) => !d) && compared >= 3, { compared, differ, desync });
  const nls = await Promise.all(pages.map((p) => p.evaluate(() => { const n = window.__nl; return { lat: n.lat, samples: n.samples, states: n.states, banners: n.banners, chats: n.chats, rejected: __game.net.session.ls.rejected - n.rejectedAt0 }; })));
  const stat = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))]; return { n: s.length, min: s[0], med: q(0.5), p95: q(0.95), max: s[s.length - 1] }; };
  for (const [i, n] of nls.entries()) {
    const who = 'AB'[i];
    // pace: ticks advanced per wall second while both were live (20 = real time); stall seconds = seconds with < 10 ticks
    const sm = n.samples;
    let stallS = 0;
    for (let x = 1; x < sm.length; x++) if (sm[x].tick - sm[x - 1].tick < 10 && !sm[x].cu) stallS++;
    const span = sm.length > 1 ? (sm[sm.length - 1].t - sm[0].t) / 1000 : 0;
    report.peers[who] = {
      ...report.peers[who], latency: stat(n.lat), delayTicks: stat(sm.map((s) => s.delay)), rttMs: stat(sm.filter((s) => s.rtt).map((s) => s.rtt)),
      pace: span ? Math.round(((sm[sm.length - 1].tick - sm[0].tick) / span) * 10) / 10 : 0, stallSeconds: stallS, sampledSeconds: Math.round(span),
      states: n.states, banners: n.banners.slice(0, 40), chats: n.chats.slice(0, 20), rejected: n.rejected, errors: errors[i].slice(0, 30),
    };
  }
  check('commands not rejected', nls.every((n) => n.rejected === 0), nls.map((n) => n.rejected));
  const latMed = nls.map((n) => stat(n.lat)?.med ?? -1);
  check('input-to-action latency measured', latMed.every((x) => x > 0), latMed);
  // (plain HTTP on a LAN address: Chromium logs that it ignores COOP, as on any http:// deployment; not a page error)
  const errs = errors.flat().filter((e) => !/favicon|Cross-Origin-Opener-Policy header has been ignored/.test(e));
  check('no console errors / CSP violations', errs.length === 0, errs.slice(0, 6));
  // shaper counters (how much the link actually lost / queued)
  report.links = [];
  for (const i of [0, 1]) if (shapers[i] !== '-') { const s = await (await fetch(shapers[i])).json(); report.links.push({ up: s.up, down: s.down }); }
  await A.screenshot({ path: `${out}/${tag}-A.png` }).catch(() => {});
  exit = report.failures.length ? 1 : 0;
} catch (e) {
  report.failures.push(`exception: ${String(e.stack ?? e).slice(0, 800)}`);
  log('EXCEPTION', e.stack ?? e);
  for (const [i, p] of pages.entries()) await p.screenshot({ path: `${out}/${tag}-error-${'AB'[i]}.png` }).catch(() => {});
  report.errors = errors;
} finally {
  report.durationS = Math.round((Date.now() - t0) / 1000);
  writeFileSync(`${out}/${tag}.json`, JSON.stringify(report, null, 1));
  for (const i of [0, 1]) await shape(i, { both: LAN, label: 'end' }).catch(() => {});
  for (const b of browsers) await b.close().catch(() => {});
  log(exit ? `FAILED (${report.failures.length})` : 'PASSED', `${out}/${tag}.json`);
  process.exit(exit);
}
