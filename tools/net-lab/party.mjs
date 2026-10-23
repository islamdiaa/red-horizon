// Net lab party runner: two to four real browsers (Playwright servers on the host, in the test VMs, or in the peer
// containers) play one multiplayer match through the real lobby UI, the game's nginx and the relay: 1v1, 2v2, free
// for all or co-op, any seat an AI. Scripted orders from every human; timed events during the match (surrender
// through the menu, a pulled cable, a relay restart, a forced desync); then every client's hashes, end state and
// results screen are checked. vm-party.sh starts the peers and runs this.
//
//   node tools/net-lab/party.mjs --peers "<ws endpoint>|<engine>|<label>,..." --url http://192.168.122.1:8812/
//        [--mode 1v1|2v2|ffa|coop] [--layout 0,2,1,3] [--ai 3:normal,...] [--size 64] [--units light] [--churn 120]
//        [--events "40:surrender:2;60:cut:1:20;90:relay-restart;120:desync:0"] [--end hunt|surrender|none]
//        [--losers 1,3] [--cut-1 "<host shell cmd>"] [--restore-1 "<host shell cmd>"] [--relay-container NAME]
//        [--out DIR] [--tag NAME]
//
// peers: peer 0 hosts. --layout gives the slot each peer sits in (2v2: slots 0+1 are team A, 2+3 team B; co-op: every
// human on one team against the AI slots). --ai fills slots with AI commanders. Events run at seconds after the
// deploy: surrender:<peer> (Esc, Surrender, confirm), cut:<peer>:<secs> (runs --cut-<peer>, waits, runs
// --restore-<peer>), relay-restart (docker restart of --relay-container), desync:<peer> (changes that client's world).
// --end: hunt (1v1: peer 0 hunts the other down), surrender (the --losers peers surrender one by one), none (stop after
// the churn). Exit code 0 when every check passed. A JSON report goes to OUT/<tag>.json (screenshots too).
import { chromium, firefox, webkit } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const argv = process.argv;
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i > 0 ? argv[i + 1] : d; };
const peerSpecs = (arg('peers', '') || '').split(',').filter(Boolean).map((s, i) => { const [ep, engine = 'chromium', label = `p${i}`] = s.split('|'); return { ep, engine, label }; });
if (peerSpecs.length < 2) { console.error('need --peers with at least two endpoints'); process.exit(2); }
const N = peerSpecs.length;
const mode = arg('mode', N === 2 ? '1v1' : '2v2');
const layout = arg('layout', '') ? arg('layout').split(',').map(Number) : peerSpecs.map((_, i) => i);
const aiSlots = (arg('ai', '') || '').split(',').filter(Boolean).map((s) => { const [slot, lvl = 'normal'] = s.split(':'); return { slot: Number(slot), lvl }; });
const size = arg('size', '64');
const units = arg('units', 'light');
const churnS = Number(arg('churn', '120'));
const END = arg('end', mode === '1v1' ? 'hunt' : 'none');
const losers = (arg('losers', '') || '').split(',').filter(Boolean).map(Number);
const events = (arg('events', '') || '').split(';').filter(Boolean).map((s) => { const [at, kind, ...rest] = s.split(':'); return { at: Number(at), kind, args: rest }; }).sort((a, b) => a.at - b.at);
const relayContainer = arg('relay-container', 'rh-lab-net-relay-1');
const out = arg('out', process.env.NETLAB_OUT || fileURLToPath(new URL('./out/', import.meta.url)));
const tag = arg('tag', `party-${mode}-${new Date().toISOString().slice(5, 16).replace(/[-:T]/g, '')}`);
const base = arg('url', 'http://192.168.122.1:8812/');
const NAMES = ['Alpha', 'Bravo', 'Charlie', 'Delta'];
const TYPES = { chromium, firefox, webkit };
mkdirSync(out, { recursive: true });

const t0 = Date.now();
const log = (...a) => console.log(`${((Date.now() - t0) / 1000).toFixed(1).padStart(7)}s`, ...a);
const report = { tag, mode, layout, ai: aiSlots, churnS, end: END, events, peers: peerSpecs.map((p) => ({ engine: p.engine, label: p.label })), started: new Date().toISOString(), checks: {}, failures: [], notes: [], timeline: [] };
const check = (name, ok, detail) => { report.checks[name] = { ok: !!ok, detail }; if (!ok) { report.failures.push(`${name}: ${typeof detail === 'string' ? detail : JSON.stringify(detail)?.slice(0, 600)}`); log('FAIL', name, JSON.stringify(detail ?? '')?.slice(0, 400)); } else log('ok  ', name, detail === undefined ? '' : JSON.stringify(detail).slice(0, 300)); };
const note = (k, v) => { report.timeline.push({ t: Math.round((Date.now() - t0) / 1000), k, v }); log('·', k, JSON.stringify(v).slice(0, 300)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------------------------------------
// in-page helpers
// ---------------------------------------------------------------------------------------------------------
function instrument() {
  const g = window.__game, link = g.net, s = link.session, ls = s.ls, c = link.client;
  const nl = window.__nl = { lat: [], pending: [], samples: [], states: [], banners: [], chats: [], rejectedAt0: ls.rejected, t0: performance.now() };
  const origIssue = ls.issue.bind(ls);
  ls.issue = (cmd) => { if (!ls.watching && ls.status === 'live') nl.pending.push(performance.now()); origIssue(cmd); };
  const o = ls.o, exec = o.onExecute;
  o.onExecute = (cmd, tick) => {
    if (cmd.player === g.local.id) { const at = nl.pending.shift(); if (at !== undefined) nl.lat.push(Math.round(performance.now() - at)); }
    exec?.(cmd, tick);
  };
  c.onState((st) => nl.states.push([Math.round(performance.now() - nl.t0), st]));
  nl.frames = 0; const raf = () => { nl.frames++; requestAnimationFrame(raf); }; requestAnimationFrame(raf); // (the page's frame rate: a slow page answers heartbeats late)
  const oa = ls.afterStep.bind(ls);
  ls.afterStep = () => { const h = oa(); if (ls.status === 'over' && !nl.over) nl.over = window.__nlSummary(); return h; };
  window.__nlSummary = () => {
    const w = g.world, r = (v) => Math.round(v * 1000) / 1000;
    return {
      tick: w.tick, over: w.gameOver, winner: w.winnerTeam,
      players: w.players.map((p) => ({ id: p.id, team: p.team, cash: p.cash, defeated: !!p.defeated, resigned: !!p.resigned, human: p.isHuman, ai: w.ais.some((a) => a.player === p) })),
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
    nl.samples.push({ t: Math.round(performance.now() - nl.t0), tick: g.world.tick, confirmed: ls.confirmed, delay: ls.delay, rtt: s.rtt.get(c.seat) ?? 0, st: c.state, cu: s.catchingUp, fps: nl.frames });
    nl.frames = 0;
    if (nl.samples.length > 6000) nl.samples.shift();
  }, 1000);
  new MutationObserver(() => {
    for (const ln of document.querySelectorAll('.net-chat .ln:not([data-seen])')) { ln.dataset.seen = '1'; nl.chats.push([Math.round(performance.now() - nl.t0), ln.textContent]); }
  }).observe(document.body, { childList: true, subtree: true });
  return { local: g.local.id, seat: c.seat, team: g.local.team, players: g.world.players.map((p) => ({ id: p.id, name: p.name, team: p.team, human: p.isHuman, faction: p.faction })) };
}

/** Scripted orders for one peer. phase: deploy | churn | hunt | flee */
function orders({ phase, seed }) {
  const g = window.__game, w = g.world, me = g.local;
  if (g.net?.session?.ls?.watching || me.resigned || me.defeated) return 0;
  let r = seed >>> 0;
  const rnd = () => { r = (r * 1664525 + 1013904223) >>> 0; return r / 4294967296; };
  const mine = w.units.filter((u) => u.alive && u.owner === me);
  const armed = mine.filter((u) => u.weapons.length);
  const m = w.map;
  const home = mine.length ? { x: mine.reduce((a, u) => a + u.x, 0) / mine.length, y: mine.reduce((a, u) => a + u.y, 0) / mine.length } : { x: m.w / 2, y: m.h / 2 };
  let n = 0;
  const issue = (cmd) => { g.issue(cmd); n++; };
  if (phase === 'deploy') {
    const mcv = mine.find((u) => u.ut.deploysInto);
    if (mcv) issue({ c: 'deploy', player: me.id, units: [mcv.id] });
  } else if (phase === 'churn') {
    for (let k = 0; k < 2 && armed.length; k++) {
      const grp = armed.filter(() => rnd() < 0.5).map((u) => u.id);
      if (!grp.length) continue;
      const x = Math.max(2, Math.min(m.w - 3, home.x + (rnd() - 0.5) * 14)), y = Math.max(2, Math.min(m.h - 3, home.y + (rnd() - 0.5) * 14));
      issue({ c: 'move', player: me.id, units: grp, x, y, attackMove: rnd() < 0.5 });
    }
    if (rnd() < 0.3 && armed.length) issue({ c: 'stance', player: me.id, units: armed.slice(0, 3).map((u) => u.id), stance: rnd() < 0.5 ? 'guard' : 'aggressive' });
  } else if (phase === 'flee') {
    if (mine.length) {
      issue({ c: 'stance', player: me.id, units: mine.map((u) => u.id), stance: 'passive' });
      issue({ c: 'move', player: me.id, units: mine.map((u) => u.id), x: m.w / 2, y: m.h / 2 });
    }
    for (const b of w.buildings) if (b.alive && b.owner === me && !b.selling) issue({ c: 'sell', player: me.id, building: b.id });
  } else if (phase === 'hunt') {
    const foes = w.units.filter((u) => u.alive && u.owner.team !== me.team);
    const fb = w.buildings.filter((b) => b.alive && b.owner.team !== me.team && !b.bt.wall);
    const tgt = foes.length ? foes : fb;
    if (tgt.length && armed.length) {
      const x = tgt.reduce((a, u) => a + u.x, 0) / tgt.length, y = tgt.reduce((a, u) => a + u.y, 0) / tgt.length;
      issue({ c: 'move', player: me.id, units: armed.map((u) => u.id), x, y, attackMove: true });
    }
  }
  return n;
}

const peerState = () => {
  const g = window.__game;
  const c = g?.net?.client, ls = g?.net?.session?.ls;
  return {
    tick: g?.world?.tick ?? -1, st: c?.state ?? 'none', ls: ls?.status ?? 'none', watching: !!ls?.watching, delay: ls?.delay,
    end: c?.endReason ?? '', banner: document.querySelector('.net-banner')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    buttons: [...document.querySelectorAll('.net-banner button, .net-dialog button')].map((b) => b.textContent.trim()),
    dialog: document.querySelector('.net-dialog')?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 400) ?? '',
    over: !!g?.world?.gameOver, spectator: !!g?.input?.spectator,
  };
};

// ---------------------------------------------------------------------------------------------------------
// run
// ---------------------------------------------------------------------------------------------------------
const browsers = [], pages = [];
const errors = peerSpecs.map(() => []);
let exit = 1;
const all = (fn) => Promise.all(pages.map(fn));
try {
  for (const [i, p] of peerSpecs.entries()) {
    const b = await TYPES[p.engine].connect(p.ep, { timeout: 90000 });
    browsers.push(b);
    const ctx = await b.newContext({ viewport: { width: 960, height: 540 }, acceptDownloads: true });
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
  const H = pages[0];
  const until = (p, fn, a, ms = 300000) => p.waitForFunction(fn, a, { timeout: ms, polling: 250 });
  const url = base + '?q=low&hd=0&demo=0&debug=1';
  await all((p) => p.goto(url, { waitUntil: 'load', timeout: 300000 }));
  await all((p) => p.waitForSelector('.mm-nav-btn', { timeout: 300000 }));
  log('pages loaded', peerSpecs.map((p) => `${p.label}:${p.engine}`).join(' '));

  // ---- lobby
  const tLobby = Date.now();
  for (const [i, p] of pages.entries()) {
    await p.locator('.mm-nav-btn', { hasText: 'Multiplayer' }).click();
    await p.waitForSelector('.lob [data-a="create"]');
    await until(p, () => document.querySelector('.lob [data-st]')?.classList.contains('ok'), undefined, 60000);
    await p.fill('.lob [data-k="name"]', NAMES[i]);
  }
  await H.click(`.lob [data-mode="${mode}"]`);
  await H.click('.lob [data-a="create"]');
  await H.waitForSelector('.lob [data-code]', { timeout: 60000 });
  const code = (await H.textContent('.lob [data-code]')).trim();
  report.room = code;
  log('room', code, 'mode', mode);
  const setSel = async (sel, v) => { await H.selectOption(sel, v); await until(H, ([s, x]) => document.querySelector(s)?.value === x, [sel, v], 30000); };
  await setSel('.lob [data-set="size"]', size);
  await setSel('.lob [data-set="startUnits"]', units);
  if (mode === 'coop') {
    // co-op starts with one AI opponent in the last slot; free it for the layout if a human sits there
    for (const k of [1, 2, 3]) if (layout.includes(k) && k !== layout[0]) await setSel(`.lob [data-slot="${k}"]`, 'open').catch(() => {});
  }
  if (layout[0] !== 0) { const mv = H.locator(`.lob [data-move="${layout[0]}"]`); if (await mv.count()) { await mv.click(); await sleep(1500); } }
  for (let i = 1; i < N; i++) {
    const P = pages[i];
    await P.fill('.lob [data-k="code"]', code);
    await P.click('.lob [data-a="join"]');
    await P.waitForSelector('.lob [data-code]', { timeout: 60000 });
    await sleep(1200);
    const mv = P.locator(`.lob [data-move="${layout[i]}"]`);
    if (await mv.count()) { await mv.click(); await sleep(1500); }
  }
  if (argv.includes('--lobby-churn')) {
    // a busy lobby: every guest leaves and comes back by code, the host changes settings, everyone sees the same room
    const tChurn0 = Date.now();
    for (let i = 1; i < N; i++) {
      const P = pages[i];
      await P.click('.lob [data-a="leave"]');
      await P.waitForSelector('.mm-nav-btn', { timeout: 60000 });
      await sleep(800);
      await P.locator('.mm-nav-btn', { hasText: 'Multiplayer' }).click();
      await P.waitForSelector('.lob [data-a="join"]', { timeout: 60000 });
      await P.fill('.lob [data-k="code"]', code);
      await P.click('.lob [data-a="join"]');
      await P.waitForSelector('.lob [data-code]', { timeout: 60000 });
      await sleep(1200);
      const mv = P.locator(`.lob [data-move="${layout[i]}"]`);
      if (await mv.count()) { await mv.click(); await sleep(1500); }
    }
    await setSel('.lob [data-set="credits"]', '5000');
    await setSel('.lob [data-set="climate"]', 'winter');
    const views = await all((p) => until(p, () => document.querySelector('.lob [data-set="climate"]')?.value === 'winter' && document.querySelector('.lob [data-set="credits"]')?.value === '5000', undefined, 30000)
      .then(() => p.evaluate(() => [...document.querySelectorAll('.lob-slots > *')].map((x) => x.textContent.replace(/\s+/g, ' ').trim().slice(0, 40)).join(' | ')), () => 'stale'));
    report.lobbyChurn = { ms: Date.now() - tChurn0, views };
    check('lobby churn: every guest left and rejoined; everyone sees the same settings', views.every((v) => v !== 'stale'), views);
    const humansSeen = await all((p) => p.evaluate(() => document.querySelectorAll('.lob-slots [data-me="faction"], .lob-slots .lob-slot.human, .lob-slots select[disabled]').length));
    report.lobbyChurn.humansSeen = humansSeen;
  }
  for (const a of aiSlots) await setSel(`.lob [data-slot="${a.slot}"]`, `ai:${a.lvl}`);
  for (const [i, p] of pages.entries()) await p.selectOption('.lob [data-me="faction"]', i % 2 ? 'soviet' : 'allies');
  // chat: the last peer to everyone, the host back
  const lobbyChat = async (from, text) => {
    const t = Date.now();
    await from.fill('.lob [data-chat] input', text);
    await from.press('.lob [data-chat] input', 'Enter');
    const got = await Promise.all(pages.filter((p) => p !== from).map((to) => until(to, (x) => [...document.querySelectorAll('.lob-log .ln')].some((l) => l.textContent.includes(x)), text, 30000).then(() => Date.now() - t, () => -1)));
    return got;
  };
  const lc1 = await lobbyChat(pages[N - 1], `gl hf from ${NAMES[N - 1]}`);
  const lc2 = await lobbyChat(H, 'good luck all');
  check('lobby chat reaches every player', [...lc1, ...lc2].every((x) => x >= 0), { lc1, lc2 });
  // Ready: each guest's own slot must show it (a click lost by the page is a finding, so it is counted, then retried)
  report.readyClicks = [];
  for (let i = 1; i < N; i++) {
    let tries = 0, ok = false;
    while (!ok && tries < 3) {
      tries++;
      await pages[i].click('.lob [data-a="ready"]');
      ok = await until(pages[i], () => { const b = document.querySelector('.lob [data-a="ready"]'); return !!b && /not ready/i.test(b.textContent); }, undefined, 15000).then(() => true, () => false);
    }
    report.readyClicks.push(tries);
    if (tries > 1) report.notes.push(`${NAMES[i]}: Ready needed ${tries} clicks`);
  }
  try { await until(H, () => { const b = document.querySelector('.lob [data-a="start"]'); return b && !b.disabled; }, undefined, 60000); }
  catch { report.notes.push('start never enabled: ' + (await H.textContent('.lob-foot .why').catch(() => '?'))); throw new Error('start not enabled'); }
  report.lobbyMs = Date.now() - tLobby;
  await H.click('.lob [data-a="start"]');
  const tStart = Date.now();
  await all((p) => until(p, () => window.__game?.net && window.__game.world.tick > 20, undefined, 600000));
  report.startMs = Date.now() - tStart;
  log('match running', report.startMs, 'ms after start');
  const info = await all((p) => p.evaluate(instrument));
  report.seats = info;
  // every player looks at their own base, team-mates share a side
  const home = await all((p) => p.evaluate(() => {
    const g = __game, w = g.world, me = g.local;
    const at = (pl) => { const u = w.units.filter((x) => x.alive && x.owner === pl); return u.length ? { x: u.reduce((a, x) => a + x.x, 0) / u.length, y: u.reduce((a, x) => a + x.y, 0) / u.length } : null; };
    const mine = at(me), d = (a, b) => (a && b ? Math.hypot(a.x - b.x, a.y - b.y) : -1);
    const mates = w.players.filter((o) => o !== me && o.team === me.team).map((o) => d(mine, at(o)));
    const foes = w.players.filter((o) => o.team !== me.team).map((o) => d(mine, at(o)));
    return { cam: Math.round(d(mine, { x: g.gfx.cam.x, y: g.gfx.cam.y }) * 10) / 10, mates: mates.map(Math.round), foes: foes.map(Math.round), map: w.map.w };
  }));
  report.home = home;
  check('start: each player looks at their own base', home.every((h) => h.cam >= 0 && h.cam < 12), home.map((h) => h.cam));
  if (mode === '2v2' || mode === 'coop') check('start: team-mates share a side', home.every((h) => h.mates.every((m) => m >= 0 && m < Math.max(...h.foes, 0) - 5)), home);
  const sameRoster = info.every((x) => JSON.stringify(x.players) === JSON.stringify(info[0].players));
  check('every client built the same roster', sameRoster, info.map((x) => x.players.map((p) => `${p.name}/${p.team}/${p.human ? 'h' : 'ai'}`).join(',')));
  check('every peer commands its own seat', new Set(info.map((x) => x.local)).size === N, info.map((x) => x.local));

  // ---- deploy, churn, events
  await all((p, i) => p.evaluate(orders, { phase: 'deploy', seed: 1 + i }));
  const tChurn = Date.now();
  const at = () => (Date.now() - tChurn) / 1000;
  let k = 0, ev = 0, stopped = false;
  const chatProbe = [];
  const lastEventEnd = events.length ? events[events.length - 1].at : 0;
  while ((at() < churnS || ev < events.length) && !stopped) {
    k++;
    await all((p, i) => p.evaluate(orders, { phase: 'churn', seed: k * 7919 + i * 104729 }).catch(() => 0));
    if (k === 6) {
      const t = Date.now();
      await H.click('.net-chip [data-a="chat"]');
      await H.fill('.net-chat input', `ping ${tag}`);
      await H.press('.net-chat input', 'Enter');
      chatProbe.push(...await Promise.all(pages.slice(1).map((P) => until(P, (x) => [...document.querySelectorAll('.net-chat .ln')].some((l) => l.textContent.includes(x)), `ping ${tag}`, 30000).then(() => Date.now() - t, () => -1))));
    }
    while (ev < events.length && at() >= events[ev].at) {
      const e = events[ev++];
      const res = await runEvent(e);
      if (res === 'stop') { stopped = true; break; }
    }
    await sleep(3000);
  }
  if (chatProbe.length) check('in-match chat reaches every player', chatProbe.every((x) => x >= 0), chatProbe);

  async function surrenderUi(i) {
    const P = pages[i];
    await P.keyboard.press('Escape');
    await P.waitForSelector('.pause-screen [data-act="surrender"]', { timeout: 60000 });
    await P.click('.pause-screen [data-act="surrender"]');
    await P.waitForSelector('[data-act="confirm surrender"]', { timeout: 60000 });
    const body = await P.textContent('.surrender-panel p').catch(() => '');
    await P.click('[data-act="confirm surrender"]');
    return body;
  }

  async function runEvent(e) {
    note('event', e);
    if (e.kind === 'surrender') {
      const i = Number(e.args[0]);
      const me = info[i].local;
      const body = await surrenderUi(i);
      await all((p) => until(p, (id) => !!__game.world.players[id].resigned, me, 120000));
      await sleep(2500);
      const st = await all((p) => p.evaluate((id) => { const w = __game.world, pl = w.players[id]; return { tick: w.tick, resigned: !!pl.resigned, defeated: !!pl.defeated, human: pl.isHuman, ai: w.ais.some((a) => a.player === pl), over: w.gameOver }; }, me));
      const mate = info.findIndex((x, j) => j !== i && x.team === info[i].team && !st[0].over && true);
      const mateHumanPlays = await H.evaluate(({ id }) => { const w = __game.world, p = w.players[id]; return w.players.some((q) => q !== p && q.team === p.team && q.isHuman && !q.defeated && !q.resigned); }, { id: me });
      const ps = await pages[i].evaluate(peerState);
      report[`surrender${i}`] = { body, st, ps, mateHumanPlays, mate };
      check(`surrender ${NAMES[i]}: every client applied it the same way`, st.every((s) => JSON.stringify({ ...s, tick: 0 }) === JSON.stringify({ ...st[0], tick: 0 })), st);
      if (mateHumanPlays) {
        check(`surrender ${NAMES[i]}: a team-mate plays on, so the AI takes the side over`, st[0].ai && !st[0].defeated && !st[0].human, st[0]);
        check(`surrender ${NAMES[i]}: the surrendering player watches`, ps.watching || ps.spectator, ps);
      } else check(`surrender ${NAMES[i]}: the side concedes`, st[0].defeated, st[0]);
      const told = await all((p, j) => j === i ? true : until(p, () => [...document.querySelectorAll('.net-chat .ln')].some((l) => /surrender/i.test(l.textContent)), undefined, 30000).then(() => true, () => false));
      check(`surrender ${NAMES[i]}: everyone is told`, told.every(Boolean), told);
    } else if (e.kind === 'cut') {
      const i = Number(e.args[0]), secs = Number(e.args[1] ?? 20);
      const cut = arg(`cut-${i}`), restore = arg(`restore-${i}`);
      if (!cut || !restore) { report.notes.push(`cut ${i}: no --cut-${i}/--restore-${i}`); return; }
      const o = { peer: i, secs };
      const start = Date.now();
      o.tickOther0 = await H.evaluate(() => __game.world.tick);
      execSync(cut, { stdio: 'inherit', timeout: 120000 });
      o.cutCmdMs = Date.now() - start;
      const others = pages.filter((_, j) => j !== i);
      while (Date.now() - start < secs * 1000) {
        await sleep(1000);
        const so = await others[0].evaluate(peerState);
        if (so.banner && !o.otherBannerAt) { o.otherBannerAt = Date.now() - start; o.otherBanner = so.banner; }
        if (so.buttons.length && !o.dropOfferedAt) o.dropOfferedAt = Date.now() - start;
        const sv = await pages[i].evaluate(peerState).catch(() => null);
        if (sv && sv.st !== 'open' && !o.victimNoticedAt) { o.victimNoticedAt = Date.now() - start; o.victimState = sv.st; o.victimBanner = sv.banner; }
        o.otherLast = so; o.victimLast = sv;
      }
      execSync(restore, { stdio: 'inherit', timeout: 120000 });
      const tr = Date.now();
      note('link restored', { peer: i });
      const tickOther = await others[0].evaluate(() => __game.world.tick);
      o.caughtUpMs = await until(pages[i], (t) => __game.world.tick >= t && !__game.net.session.catchingUp && __game.net.client.state === 'open', tickOther, 240000).then(() => Date.now() - tr, () => -1);
      o.after = await all((p) => p.evaluate(() => ({ tick: __game.world.tick, watching: __game.net.session.ls.watching, st: __game.net.client.state, drops: __game.setup.net?.drops ?? [] })));
      report[`cut${i}`] = o;
      const beyond = secs > 90;
      check(`cut ${NAMES[i]} ${secs}s: the others are told who they wait for`, o.otherBannerAt > 0 && o.otherBannerAt < 9000, { at: o.otherBannerAt, banner: o.otherBanner });
      check(`cut ${NAMES[i]} ${secs}s: the victim notices`, o.victimNoticedAt > 0 && o.victimNoticedAt < 12000, { at: o.victimNoticedAt, st: o.victimState, banner: o.victimBanner });
      if (!beyond) {
        check(`cut ${NAMES[i]} ${secs}s: the victim reconnects and catches up`, o.caughtUpMs >= 0 && o.caughtUpMs < 60000, { ms: o.caughtUpMs });
        check(`cut ${NAMES[i]} ${secs}s: still a player`, o.after.every((s) => !s.drops.length) && !o.after[i].watching, o.after);
      } else check(`cut ${NAMES[i]} ${secs}s: replaced by the AI, watches`, o.after.every((s) => s.drops.length === 1) && o.after[i].watching, o.after);
    } else if (e.kind === 'relay-restart') {
      const r = { before: await all((p) => p.evaluate(peerState)) };
      const ts = Date.now();
      execSync(`docker restart -t 2 ${relayContainer}`, { stdio: 'inherit', timeout: 120000 });
      r.restartMs = Date.now() - ts;
      r.samples = [];
      for (let s = 0; s < 12; s++) { await sleep(5000); r.samples.push({ t: Math.round((Date.now() - ts) / 1000), st: await all((p) => p.evaluate(peerState).catch((x) => String(x).slice(0, 80))) }); }
      r.after = r.samples[r.samples.length - 1].st;
      report.relayRestart = r;
      for (const [i, p] of pages.entries()) await p.screenshot({ path: `${out}/${tag}-relay-restart-${NAMES[i]}.png`, timeout: 120000 }).catch(() => {});
      check('relay restart: every player is told the match cannot go on', r.after.every((s) => typeof s === 'object' && (s.banner || s.dialog)), r.after.map((s) => s.banner || s.dialog || s));
      // what can they do: the buttons offered
      report.notes.push(`relay restart: offered ${JSON.stringify(r.after.map((s) => s.buttons))}`);
      const cont = arg('relay-continue', '');
      if (cont !== '') {
        // "continue offline against the AI": every player can finish the match on their own machine
        const i = Number(cont);
        const P = pages[i];
        const b = P.locator('.net-banner button, .net-dialog button', { hasText: /AI/i });
        if (await b.count()) {
          const tick0 = await P.evaluate(() => __game.world.tick);
          await b.first().click();
          await sleep(15000);
          const st = await P.evaluate(() => ({ tick: __game.world.tick, net: !!__game.net, ais: __game.world.ais.map((a) => a.player.id), spectator: !!__game.input?.spectator }));
          r.continued = { tick0, ...st };
          check('relay restart: the player continues offline against the AI', st.tick > tick0 + 40 && !st.spectator && info.every((x, j) => j === i || st.ais.includes(x.local)), r.continued);
          // orders still work offline
          const n = await P.evaluate(orders, { phase: 'churn', seed: 99 });
          r.continued.ordersIssued = n;
        } else check('relay restart: a continue-against-the-AI choice is offered', false, r.after[i]);
      }
      return 'stop';
    } else if (e.kind === 'desync') {
      const i = Number(e.args[0]);
      const tick = await pages[i].evaluate(() => { const w = __game.world; w.players[__game.local.id].cash += 1; return w.tick; });
      note('desync injected', { peer: i, tick });
      const shown = await all((p) => until(p, () => !!document.querySelector('.net-dialog'), undefined, 60000).then(() => true, () => false));
      const st = await all((p) => p.evaluate(peerState));
      const d = await all((p) => p.evaluate(() => { const d = __game.net.session.desync; return d ? { tick: d.tick, hashes: d.hashes, mine: d.mine } : null; }));
      report.desync = { injectedAt: tick, shown, st, d };
      check('desync: the relay stops the match for everyone (dialog on every client)', shown.every(Boolean), st.map((s) => s.ls));
      check('desync: the dialog names the tick and every player\'s hash', d.every((x) => x && x.tick >= tick && x.hashes.length === N), d);
      const tA = await all((p) => p.evaluate(() => __game.world.tick));
      await sleep(3000);
      const tB = await all((p) => p.evaluate(() => __game.world.tick));
      check('desync: nobody plays on', tA.every((t, j) => tB[j] - t <= 1), { tA, tB });
      // save and download the replay on the host
      await H.click('.net-dialog [data-a="save"]');
      const saved = await until(H, () => /saved/i.test(document.querySelector('.net-dialog [data-a="save"]')?.textContent ?? ''), undefined, 30000).then(() => true, () => false);
      const dl = await Promise.all([H.waitForEvent('download', { timeout: 30000 }).catch(() => null), H.click('.net-dialog [data-a="dl"]')]);
      let dlOk = false, dlName = '';
      if (dl[0]) { dlName = dl[0].suggestedFilename(); const pth = `${out}/${tag}-${dlName}`; await dl[0].saveAs(pth).catch(() => {}); try { const j = JSON.parse((await import('node:fs')).readFileSync(pth, 'utf8')); dlOk = Array.isArray(j.commands ?? j.cmds ?? j.orders) || !!j.setup; } catch { dlOk = false; } }
      check('desync: Save replay works', saved, {});
      check('desync: Download replay gives a replay file', dlOk, { dlName });
      for (const [j, p] of pages.entries()) await p.screenshot({ path: `${out}/${tag}-desync-${NAMES[j]}.png`, timeout: 120000 }).catch(() => {});
      return 'stop';
    }
  }

  // ---- the end
  const stoppedEarly = !!report.relayRestart || !!report.desync;
  if (!stoppedEarly && END === 'surrender' && losers.length) {
    for (const i of losers) {
      if (await pages[i].evaluate(() => __game.world.gameOver)) break;
      await runEvent({ at: at(), kind: 'surrender', args: [String(i)] });
      await sleep(2000);
    }
  } else if (!stoppedEarly && END === 'hunt') {
    log('end phase: hunt');
    const tEnd = Date.now() + 480000;
    let j = 0;
    while (Date.now() < tEnd) {
      const over = await all((p) => p.evaluate(() => __game.world.gameOver));
      if (over.every(Boolean)) break;
      if (j % 15 === 0) note('hunt', await H.evaluate(() => __game.world.players.map((p) => ({ id: p.id, units: __game.world.units.filter((u) => u.alive && u.owner === p).length, armed: __game.world.units.filter((u) => u.alive && u.owner === p && u.weapons.length).length, blds: __game.world.buildings.filter((b) => b.alive && b.owner === p).length }))));
      for (const [i, p] of pages.entries()) {
        const mine = info[i].team === info[0].team;
        if (mine) await p.evaluate(orders, { phase: 'hunt', seed: j }).catch(() => 0);
        else if (j % 3 === 0) await p.evaluate(orders, { phase: 'flee', seed: j }).catch(() => 0);
      }
      j++;
      await sleep(4000);
    }
    // slow machines: a hunt that has not finished in 8 minutes ends with the hunted side surrendering through the menu
    if (!(await H.evaluate(() => __game.world.gameOver))) {
      report.notes.push('hunt did not finish within 8 minutes: the other side surrenders');
      for (const [i] of pages.entries()) if (info[i].team !== info[0].team && !(await H.evaluate(() => __game.world.gameOver))) await runEvent({ at: at(), kind: 'surrender', args: [String(i)] });
    }
  }
  if (!stoppedEarly && END !== 'none') {
    await all((p) => until(p, () => __game.world.gameOver, undefined, 300000)).catch(() => {});
    const ends = await all((p) => p.evaluate(() => window.__nl.over ?? null));
    report.endState = ends;
    check('match ended on every client', ends.every((e) => e?.over), ends.map((e) => e && [e.tick, e.over]));
    check('every client agrees on the final tick, winner and world', ends.every((e) => JSON.stringify(e) === JSON.stringify(ends[0])), ends.map((e) => e && { tick: e.tick, winner: e.winner, units: e.units, hp: e.hp }));
    try {
      await all((p) => until(p, () => !!document.querySelector('.end-screen'), undefined, 120000));
      const scr = await all((p) => p.evaluate(() => ({ cls: document.querySelector('.end-screen')?.className ?? '', board: document.querySelector('.stats-table')?.textContent?.replace(/\s+/g, ' ') ?? '' })));
      const winner = ends[0]?.winner;
      const expect = info.map((x, i) => (x.team === winner && !ends[0].players[x.local].resigned ? 'win' : 'lose'));
      check('results screen right for every player', scr.every((s, i) => new RegExp(`\\b${expect[i]}\\b`).test(s.cls)), { expect, got: scr.map((s) => s.cls) });
      report.scoreboard = scr.map((s) => s.board.slice(0, 400));
      if (report.scoreboard.length) report.notes.push(`scoreboard[0]: ${report.scoreboard[0]}`);
      for (const [i, p] of pages.entries()) await p.screenshot({ path: `${out}/${tag}-end-${NAMES[i]}.png`, timeout: 120000 }).catch(() => {});
    } catch (e) { check('results screens shown', false, String(e).slice(0, 200)); }
  } else if (!stoppedEarly) report.endState = await all((p) => p.evaluate(() => window.__nlSummary()));

  // ---- the numbers
  const hashes = await all((p) => p.evaluate(() => __game.net.session.ls.hashes));
  const maps = hashes.map((h) => new Map(h));
  let compared = 0, differ = 0;
  for (let i = 1; i < N; i++) for (const [t, h] of maps[i]) if (maps[0].has(t)) { compared++; if (maps[0].get(t) !== h) differ++; }
  if (!report.desync) {
    const desync = await all((p) => p.evaluate(() => __game.net.session.desync));
    check('no desync (hashes of every client agree)', differ === 0 && desync.every((d) => !d) && compared >= 3, { compared, differ, desync });
  } else report.hashCompare = { compared, differ };
  const nls = await all((p) => p.evaluate(() => { const n = window.__nl; return { lat: n.lat, samples: n.samples, states: n.states, banners: n.banners, chats: n.chats, rejected: __game.net.session.ls.rejected - n.rejectedAt0 }; }));
  const stat = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))]; return { n: s.length, min: s[0], med: q(0.5), p95: q(0.95), max: s[s.length - 1] }; };
  report.stats = nls.map((n, i) => {
    const sm = n.samples.filter((s) => s.st === 'open');
    let stallS = 0;
    for (let x = 1; x < sm.length; x++) if (sm[x].tick - sm[x - 1].tick < 10 && !sm[x].cu) stallS++;
    const span = sm.length > 1 ? (sm[sm.length - 1].t - sm[0].t) / 1000 : 0;
    return {
      peer: `${NAMES[i]} ${peerSpecs[i].label}/${peerSpecs[i].engine}`, latency: stat(n.lat), delay: stat(sm.map((s) => s.delay)), rtt: stat(sm.filter((s) => s.rtt).map((s) => s.rtt)),
      pace: span ? Math.round(((sm[sm.length - 1].tick - sm[0].tick) / span) * 10) / 10 : 0, stallS, sampledS: Math.round(span), rejected: n.rejected,
      fps: stat(sm.map((x) => x.fps ?? 0)), timeline: sm.filter((_, j) => j % 5 === 0).map((x) => [Math.round(x.t / 1000), x.tick, x.delay, x.rtt, x.fps]),
      states: n.states, banners: n.banners.slice(0, 40), chats: n.chats.slice(0, 20), errors: errors[i].slice(0, 30),
    };
  });
  for (const s of report.stats) log('peer', s.peer, 'fps', s.fps?.med, 'pace', s.pace, 'stall', s.stallS, 'delay', JSON.stringify(s.delay), 'lat', JSON.stringify(s.latency), 'rtt', JSON.stringify(s.rtt));
  check('commands not rejected', nls.every((n) => n.rejected === 0), nls.map((n) => n.rejected));
  // (a cut link or a relay restart makes the browser log the dropped WebSocket: Chromium 'WebSocket connection to ... failed', Firefox
  // 'can’t establish a connection' / 'was interrupted while the page was loading')
  const errs = errors.flat().filter((e) => !/favicon|Cross-Origin-Opener-Policy header has been ignored|WebSocket connection to .* failed|ERR_CONNECTION_REFUSED|status of 50[234]|establish a connection to the server at ws|connection to ws:\/\/.* was interrupted/.test(e));
  check('no console errors / CSP violations', errs.length === 0, errs.slice(0, 8));
  exit = report.failures.length ? 1 : 0;
} catch (e) {
  report.failures.push(`exception: ${String(e.stack ?? e).slice(0, 800)}`);
  log('EXCEPTION', e.stack ?? e);
  for (const [i, p] of pages.entries()) { report[`state${i}`] = await p.evaluate(peerState).catch(() => null); await p.screenshot({ path: `${out}/${tag}-error-${NAMES[i]}.png`, timeout: 60000 }).catch(() => {}); }
  report.errors = errors;
} finally {
  report.durationS = Math.round((Date.now() - t0) / 1000);
  writeFileSync(`${out}/${tag}.json`, JSON.stringify(report, null, 1));
  for (const b of browsers) await b.close().catch(() => {});
  log(exit ? `FAILED (${report.failures.length})` : 'PASSED', `${out}/${tag}.json`);
  process.exit(exit);
}
