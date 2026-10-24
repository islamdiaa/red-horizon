// The play matrix: the skill profiles (tools/e2e/profiles.mjs) play every mode at every level through the real UI,
// one game at a time, and each run records what a player would feel: win or loss, match length, time to first
// contact, money left idle in the bank, the Field Manual hints shown, the toasts, and friction (clicks that did
// nothing, placements that failed, softlocks).
//
//   node tools/e2e/matrix.mjs [cell-pattern,...] [--serve <dist> | --url <url>] [--out <dir>] [--lock <file>]
//                             [--profiles newcomer,casual] [--label before] [--list]
//
// Cells are named <mode>:<level>:<profile>, e.g. qb:recruit:newcomer, classic:hard:casual, camp-allies:easy:casual,
// conquest:normal:casual, koth:normal:casual, coop:normal:casual, challenge::casual, replays, editor. A pattern is
// a prefix or a regular expression (e.g. "qb:", "classic:(recruit|easy)", ":newcomer$").
//
// --serve    serves a production build on the --url port (default http://127.0.0.1:5315/) for the whole matrix
// --lock     runs each cell in its own process under `flock <file>` after tools/assets/memguard.sh 6000, so other
//            heavy jobs can take turns between cells (any lock file the other jobs share, e.g. /tmp/rh-lab/heavy.lock)
// --label    names the run in the table (e.g. "before", "after")
//
// Output in --out: one folder per cell (log, screenshots, result.json), results.jsonl (one line per cell, appended
// as cells finish, so a crashed run keeps what it had) and table.md (rebuilt after every cell).
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs, openBrowser, Bot, JourneyAbort, loadJourney, ROOT, sleep } from './lib.mjs';
import { serve } from './serve.mjs';
import { PLAY, PROFILES, over } from './profiles.mjs';

const LEVELS = ['recruit', 'easy', 'normal', 'hard', 'brutal'];
/** The campaigns' missions in order (src/missions: campaignMissions), and the special operations a player plays. */
const MISSION_IDS = {
  allies: ['allied-01', 'allied-02', 'allied-03', 'allied-04', 'allied-05', 'allied-06', 'allied-07'],
  soviet: ['soviet-01', 'soviet-02', 'soviet-03', 'soviet-04', 'soviet-05', 'soviet-06', 'soviet-07'],
  special: ['wolfpack', 'ironcoast'],
};
const P = '.main-screen:not(.leaving) .mm-panel';

// ------------------------------------------------------------------------------------------------ cells

/** Every cell of the matrix, in run order: the newcomer and casual battles first, then the other modes, then the experienced player. */
export function allCells() {
  const cells = [];
  const battles = (profile, levels = LEVELS) => {
    for (const level of levels) cells.push({ id: `qb:${level}:${profile}`, mode: 'qb', rules: 'commander', level, profile, seed: 1000 + LEVELS.indexOf(level) });
    for (const level of levels) cells.push({ id: `classic:${level}:${profile}`, mode: 'classic', rules: 'classic', level, profile, seed: 2000 + LEVELS.indexOf(level) });
  };
  battles('newcomer');
  battles('casual');
  // 2 vs 2 with an AI ally (the skirmish panel's ally switch: missing before this round)
  cells.push({ id: 'ally:recruit:newcomer', mode: 'ally', rules: 'commander', level: 'recruit', profile: 'newcomer', seed: 3001 });
  cells.push({ id: 'ally:normal:casual', mode: 'ally', rules: 'commander', level: 'normal', profile: 'casual', seed: 3001 });
  // campaign mission 1 of each side: as it was (no level picker before this round), then at each level with the
  // player who would pick it (the newcomer on Recruit and Easy, the casual player above)
  for (const side of ['allies', 'soviet']) {
    for (const profile of ['newcomer', 'casual']) cells.push({ id: `camp-${side}:default:${profile}`, mode: 'camp', side, level: 'default', profile, seed: 4000 });
    for (const [level, profile] of [['recruit', 'newcomer'], ['easy', 'newcomer'], ['normal', 'casual'], ['hard', 'casual'], ['brutal', 'casual']]) {
      cells.push({ id: `camp-${side}:${level}:${profile}`, mode: 'camp', side, level, profile, seed: 4000 });
    }
  }
  cells.push({ id: 'coop:normal:casual', mode: 'coop', level: 'normal', profile: 'casual', seed: 5000 });
  cells.push({ id: 'coop:normal:newcomer', mode: 'coop', level: 'normal', profile: 'newcomer', seed: 5000 }); // (a newcomer's first co-op: +1 ally at the lowest ally level)
  cells.push({ id: 'conquest:normal:casual', mode: 'conquest', level: 'normal', profile: 'casual', seed: 5100 });
  cells.push({ id: 'koth:normal:casual', mode: 'koth', rules: 'commander', level: 'normal', profile: 'casual', seed: 5200 });
  cells.push({ id: 'challenge::casual', mode: 'challenge', level: '', profile: 'casual', seed: 5300 });
  cells.push({ id: 'replays', mode: 'journey', journey: 'replays', seed: 6000 });
  cells.push({ id: 'editor', mode: 'journey', journey: 'editor', seed: 6100 });
  cells.push({ id: 'abuse', mode: 'journey', journey: 'abuse', seed: 6200 }); // (resizes the window mid-match: the portrait HUD check)
  battles('experienced', ['hard', 'brutal']); // (the top of the curve: lower levels are the newcomer's and the casual player's)
  // more seeds where it matters most (the newcomer on Recruit and Easy): cell ids end in #2, #3
  for (const r of [2, 3]) for (const level of ['recruit', 'easy']) {
    cells.push({ id: `qb:${level}:newcomer#${r}`, mode: 'qb', rules: 'commander', level, profile: 'newcomer', seed: 1000 + LEVELS.indexOf(level) + 100 * r });
    cells.push({ id: `classic:${level}:newcomer#${r}`, mode: 'classic', rules: 'classic', level, profile: 'newcomer', seed: 2000 + LEVELS.indexOf(level) + 100 * r });
  }
  // round 4: three games a cell for the newcomer and the casual player at Recruit, Easy and Normal (both rulesets)
  for (const r of [2, 3]) for (const profile of ['newcomer', 'casual']) for (const level of ['recruit', 'easy', 'normal']) {
    if (profile === 'newcomer' && level !== 'normal') continue; // (above)
    cells.push({ id: `qb:${level}:${profile}#${r}`, mode: 'qb', rules: 'commander', level, profile, seed: 1000 + LEVELS.indexOf(level) + 100 * r });
    cells.push({ id: `classic:${level}:${profile}#${r}`, mode: 'classic', rules: 'classic', level, profile, seed: 2000 + LEVELS.indexOf(level) + 100 * r });
  }
  for (const level of ['recruit', 'easy', 'normal']) { // (the casual player had no Recruit cells before round 4's list)
    if (!cells.some((c) => c.id === `qb:${level}:casual`)) cells.push({ id: `qb:${level}:casual`, mode: 'qb', rules: 'commander', level, profile: 'casual', seed: 1000 + LEVELS.indexOf(level) });
    if (!cells.some((c) => c.id === `classic:${level}:casual`)) cells.push({ id: `classic:${level}:casual`, mode: 'classic', rules: 'classic', level, profile: 'casual', seed: 2000 + LEVELS.indexOf(level) });
  }
  // every campaign mission and special operation once, the newcomer at its default level (Easy: a new player's),
  // reached as a player who won the missions before it
  for (const [side, ids] of Object.entries(MISSION_IDS)) for (const id of ids) {
    cells.push({ id: `mission:${id}:newcomer`, mode: 'mission', side, mission: id, level: 'easy', profile: 'newcomer', seed: 4100 });
  }
  return cells;
}

function pick(cells, patterns) {
  if (!patterns.length) return cells;
  return cells.filter((c) => patterns.some((p) => c.id.startsWith(p) || new RegExp(p).test(c.id)));
}

// ------------------------------------------------------------------------------------------------ in-page metrics

/**
 * Start sampling the running match in the page (between fast-forward chunks, every 400 ms of real time): the
 * bank, first contact, the enemy at 7:00, Field Manual hints and toasts. Read back with readMetrics.
 */
async function startMetrics(bot) {
  await bot.page.evaluate(() => {
    clearInterval(window.__e2eMTimer);
    const M = window.__e2eM = {
      lastT: null, start: null, bankInt: 0, bankMax: 0, idleMoney: 0, lowPower: 0, firstContact: null, firstLoss: null,
      at7: null, peakArmy: 0, peakFoe: 0, hints: [], toasts: [], end: null,
    };
    const DEF = new Set(['ftur', 'tsla', 'gun', 'pbox', 'hbox', 'agun', 'sam', 'bnkr']);
    const seenHint = new Set(), seenToast = new Map();
    const sample = () => {
      const g = window.__game;
      if (!g || !g.world || g.setup.demo) return;
      const w = g.world, me = g.local, t = w.time;
      if (M.start === null) M.start = t;
      if (M.lastT !== null && t > M.lastT) {
        const dt = t - M.lastT;
        M.bankInt += me.credits * dt;
        if (me.credits >= 1000) M.idleMoney += dt;
        if (me.powerUse > 0 && me.lowPower) M.lowPower += dt;
      }
      M.lastT = t;
      M.bankMax = Math.max(M.bankMax, me.credits);
      let army = 0, foe = 0, foeDef = 0;
      const mine = [];
      for (const u of w.units) {
        if (!u.alive) continue;
        if (u.owner === me) { if (u.weapons.length && !u.ut.harvester) army++; mine.push(u); } else if (me.isEnemy(u.owner)) foe++;
      }
      for (const b of w.buildings) if (b.alive && b.owner === me) mine.push(b); else if (b.alive && me.isEnemy(b.owner) && DEF.has(b.bt.id)) foeDef++;
      M.peakArmy = Math.max(M.peakArmy, army);
      M.peakFoe = Math.max(M.peakFoe, foe);
      if (M.firstContact === null) {
        outer: for (const u of w.units) {
          if (!u.alive || !me.isEnemy(u.owner) || !u.weapons.length || u.ut.harvester) continue;
          for (const m of mine) if (Math.abs(m.x - u.x) < 7 && Math.abs(m.y - u.y) < 7) { M.firstContact = t; break outer; }
        }
        const s = me.stats;
        if (M.firstContact === null && (s.unitsLost + s.buildingsLost + s.unitsKilled + s.buildingsKilled) > 0) M.firstContact = t;
      }
      if (M.firstLoss === null && (me.stats.unitsLost + me.stats.buildingsLost) > 0) M.firstLoss = t;
      if (M.at7 === null && t >= 420) M.at7 = { army, foeUnits: foe, foeDefences: foeDef, credits: me.credits, harvested: me.stats.harvested };
      const h = document.querySelector('.hint.on .hint-t')?.textContent?.trim();
      if (h && !seenHint.has(h)) { seenHint.add(h); M.hints.push({ t: Math.round(t), text: h.slice(0, 200) }); }
      for (const e of document.querySelectorAll('.toast .t-text')) {
        const x = e.textContent.trim().slice(0, 120);
        if (!x) continue;
        if (!seenToast.has(x)) { seenToast.set(x, M.toasts.length); M.toasts.push({ t: Math.round(t), text: x, n: 1 }); }
      }
      if (w.gameOver && !M.end) M.end = { t, won: w.winnerTeam === me.team };
    };
    window.__e2eMSample = sample;
    window.__e2eMTimer = setInterval(sample, 400);
  });
}

async function readMetrics(bot) {
  return bot.page.evaluate(() => {
    window.__e2eMSample?.();
    const M = window.__e2eM, g = window.__game;
    if (!M || !g) return null;
    const w = g.world, me = g.local;
    const span = Math.max(1, (M.lastT ?? 0) - (M.start ?? 0));
    const foes = w.players.filter((p) => p !== me && me.isEnemy(p));
    return {
      simEnd: Math.round(w.time), firstContact: M.firstContact === null ? null : Math.round(M.firstContact), firstLoss: M.firstLoss === null ? null : Math.round(M.firstLoss),
      bankAvg: Math.round(M.bankInt / span), bankMax: M.bankMax, idleMoneyPct: Math.round((100 * M.idleMoney) / span), lowPowerSecs: Math.round(M.lowPower),
      peakArmy: M.peakArmy, peakFoe: M.peakFoe, at7: M.at7,
      harvested: { me: me.stats.harvested, foe: Math.max(0, ...foes.map((p) => p.stats.harvested)) },
      stats: me.stats, hints: M.hints, toasts: M.toasts.slice(0, 40),
      setup: { opp: (g.setup.opponents ?? []).map((o) => o.difficulty), rules: g.setup.rules ?? w.rules, mission: g.setup.mission ?? null, quick: !!g.setup.quick, map: g.setup.mapId ?? g.world.map.w, faction: me.faction, mut: g.setup.mutators ?? [] },
    };
  });
}

// ------------------------------------------------------------------------------------------------ setting up a mode

/** A deterministic Math.random for the page (the menu rolls Quick Battles and skirmish seeds with it). */
async function seedPage(bot, seed, profile = null, storage = null) {
  await bot.context.addInitScript(([seed, profile, storage]) => {
    let a = seed >>> 0;
    Math.random = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    try { if (profile && !localStorage.getItem('rh.profile')) localStorage.setItem('rh.profile', JSON.stringify(profile)); } catch { /* storage blocked */ }
    // (other stored state, once: campaign progress for a mission cell)
    try { if (storage && !localStorage.getItem('rh.e2e.seeded')) { for (const [k, v] of Object.entries(storage)) localStorage.setItem(k, v); localStorage.setItem('rh.e2e.seeded', '1'); } } catch { /* storage blocked */ }
  }, [seed, profile, storage]);
}

/** Stored campaign progress of a newcomer who won every mission before `id` in its campaign at Easy (and plays at Easy). */
function missionStorage(cell) {
  const ids = MISSION_IDS[cell.side];
  const rec = {};
  for (const m of ids.slice(0, ids.indexOf(cell.mission))) rec[m] = { completed: true, stars: 1, bestTime: 1200, level: cell.level };
  return { 'rh.campaign': JSON.stringify(rec), 'rh.campaign.level': cell.level, 'rh.campaign.tab': cell.side };
}

/** A profile record that makes Quick Battle pick `level` (modes/quickbattle.ts quickSkill: 3 wins at each level below). */
function profileFor(level) {
  const i = LEVELS.indexOf(level);
  if (i <= 0) return null;
  const games = {}, wins = {};
  for (const l of LEVELS.slice(0, i)) { games[l] = 3; wins[l] = 3; }
  return { v: 2, stats: { skirmishes: 3 * i, gamesByDifficulty: games, winsByDifficulty: wins } };
}

async function rulesTab(bot, on) { await bot.click(`${P} .vr-tab >> nth=${on ? 1 : 0}`, undefined, { after: 400 }); }

/** The skirmish panel: rules, the first opponent's level (and more opponents), then Deploy. */
async function skirmish(bot, cell, { opponents = 1, koth = false } = {}) {
  await bot.click(`${P} .opponent >> nth=0 >> .op-diff button[data-v="${cell.level}"]`);
  for (let i = 1; i < opponents; i++) {
    await bot.click(`${P} .op-add`);
    await bot.click(`${P} .opponent >> nth=${i} >> .op-diff button[data-v="${cell.level}"]`);
  }
  await rulesTab(bot, true);
  await bot.click(`${P} .seg button[data-v="${cell.rules}"]`);
  if (koth) {
    const f = bot.page.locator(`${P} .vr-rules .field:not(.f-buildup):has(.stepper)`).first();
    for (let i = 0; i < 6; i++) {
      const label = (await f.locator('.st-val b').first().textContent().catch(() => '')) ?? '';
      if (/\d/.test(label)) break;
      await f.locator('.st-arrow').nth(1).click();
      await sleep(250);
    }
  }
  await rulesTab(bot, false);
  await bot.shot('setup');
  await bot.click(`${P} .deploy`);
  await bot.waitMatch();
}

/** Open a mode the way a player does, up to the first frame of the match. Returns false when the mode isn't there. */
async function startMode(bot, cell) {
  if (cell.mode === 'qb') {
    await bot.nav('Quick Battle');
    await bot.waitMatch();
    const opp = await bot.g((g) => g.setup.opponents.map((o) => o.difficulty));
    if (!opp.every((d) => d === cell.level)) bot.friction('setup', `Quick Battle rolled ${opp.join(',')} instead of ${cell.level}`);
    return true;
  }
  if (cell.mode === 'classic') { await skirmish(bot, cell); return true; }
  if (cell.mode === 'koth') { await skirmish(bot, cell, { koth: true }); return true; }
  if (cell.mode === 'ally') {
    // a 2v2 with an AI ally: an ally switch on an opponent row (if the panel has one)
    await bot.click(`${P} .op-add`);
    await bot.click(`${P} .op-add`);
    const ally = bot.page.locator(`${P} .opponent >> nth=0 >> .op-ally`);
    if (!await ally.count()) { bot.friction('missing', 'the skirmish panel has no way to make an AI an ally (2v2 needs the multiplayer lobby and a relay)'); return false; }
    await bot.clickEl(ally.first());
    for (let i = 0; i < 3; i++) await bot.click(`${P} .opponent >> nth=${i} >> .op-diff button[data-v="${cell.level}"]`);
    await rulesTab(bot, true);
    await bot.click(`${P} .seg button[data-v="${cell.rules}"]`);
    await rulesTab(bot, false);
    await bot.shot('setup');
    await bot.click(`${P} .deploy`);
    await bot.waitMatch();
    const teams = await bot.g((g) => ({ me: g.local.team, allies: g.world.players.filter((p) => p !== g.local && !g.local.isEnemy(p)).length, foes: g.world.players.filter((p) => g.local.isEnemy(p)).length }));
    if (teams.allies !== 1 || teams.foes !== 2) bot.friction('setup', `expected 1 ally and 2 opponents, got ${JSON.stringify(teams)}`);
    return true;
  }
  if (cell.mode === 'camp') {
    await bot.nav('Campaign');
    await bot.waitFor('.cmp .cmp-tab');
    await bot.click(`.cmp .cmp-tab[data-tab="${cell.side}"]`);
    await bot.waitFor('.cmp [data-act="deploy"]');
    // the campaign's difficulty (CAMP's picker, when there is one): a control with data-v / data-diff = the level
    if (cell.level !== 'default') {
      const sel = `.cmp :is([data-level="${cell.level}"], [data-diff="${cell.level}"])`;
      if (!await bot.sees(sel)) { bot.friction('missing', `no campaign difficulty "${cell.level}" on the campaign screen`); return false; }
      await bot.click(sel);
    }
    await bot.shot('campaign');
    await bot.click('.cmp [data-act="deploy"]');
    await bot.waitMatch();
    return true;
  }
  if (cell.mode === 'mission') {
    // one mission from the campaign screen: its tab, its node on the map (a special operation: its card), Deploy
    await bot.nav('Campaign');
    await bot.waitFor('.cmp .cmp-tab');
    await bot.click(`.cmp .cmp-tab[data-tab="${cell.side}"]`);
    const node = `.cmp :is(.node, .cmp-sp)[data-id="${cell.mission}"]`;
    if (!await bot.waitFor(node, undefined, 15000)) { bot.friction('missing', `mission ${cell.mission} is not on the campaign screen`); return false; }
    await bot.page.locator(node).first().dispatchEvent('click'); // (an SVG node: a dispatched click, as the Conquest map's)
    await sleep(500);
    const lvl = await bot.page.evaluate(() => document.querySelector('.cmp .cmp-lvl [data-level].on, .cmp .cmp-lvl [data-level][aria-pressed="true"], .cmp .cmp-lvl [data-level].sel')?.getAttribute('data-level') ?? '');
    if (lvl && lvl !== cell.level) bot.friction('setup', `the campaign screen offers ${lvl}, not ${cell.level}`);
    await bot.shot('campaign');
    await bot.click('.cmp [data-act="deploy"]');
    await bot.waitMatch();
    const m = await bot.g((g) => ({ id: g.world.mission?.def.id, level: g.world.mission?.level }));
    if (m.id !== cell.mission) bot.friction('setup', `deployed ${m.id}, not ${cell.mission}`);
    bot.log(`mission ${m.id} at ${m.level}`);
    return true;
  }
  if (cell.mode === 'conquest') {
    await bot.nav('Conquest');
    await bot.waitFor('[data-act="begin"]', undefined, 30000);
    if (await bot.sees(`[data-diff="${cell.level}"], .cq-diff [data-v="${cell.level}"]`)) await bot.click(`:is([data-diff="${cell.level}"], .cq-diff [data-v="${cell.level}"])`);
    await bot.click('[data-act="begin"]');
    for (let i = 0; i < 6; i++) {
      await sleep(800);
      if (await bot.sees('.ter.target')) break;
      for (const act of ['ok', 'go', 'continue', 'close']) if (await bot.sees(`[data-act="${act}"]`)) { await bot.click(`[data-act="${act}"]`); break; }
    }
    const target = bot.page.locator('.ter.target').first();
    if (!await target.count()) { bot.friction('missing', 'the Conquest map offers no territory to attack'); return false; }
    await target.dispatchEvent('click');
    await sleep(600);
    await bot.click('[data-act="attack"]');
    await bot.waitFor('[data-act="deploy"]');
    await bot.click('[data-act="deploy"]');
    await bot.waitMatch();
    return true;
  }
  if (cell.mode === 'coop') {
    // Challenges › Survival: "+1 ally" (an AI at the cell's level fights beside you), then the first survival card
    await bot.nav('Challenges');
    if (!await bot.waitFor('[data-coop="1"]', undefined, 60000)) { bot.friction('missing', 'no co-op switch on the Survival panel'); return false; }
    await bot.click('[data-coop="1"]');
    if (await bot.sees(`[data-coopd="${cell.level}"]`)) await bot.click(`[data-coopd="${cell.level}"]`);
    else bot.friction('missing', `no ally level "${cell.level}" for co-op survival`);
    await bot.shot('coop');
    await bot.click('.chl-sv[data-deploy] >> nth=0');
    await bot.waitMatch();
    return true;
  }
  if (cell.mode === 'challenge') {
    // Challenges › Scenarios: the first challenge card
    await bot.nav('Challenges');
    if (!await bot.waitFor('.chl-sbtn[data-act="scenarios"]', undefined, 60000)) { bot.friction('missing', 'no Scenarios button in Challenges'); return false; }
    await bot.click('.chl-sbtn[data-act="scenarios"]');
    await bot.waitFor('.chx [data-a="play"]', undefined, 30000);
    await bot.shot('challenges');
    await bot.click('.chx [data-a="play"] >> nth=0');
    await bot.waitMatch();
    return true;
  }
  return false;
}

// ------------------------------------------------------------------------------------------------ one cell

async function runCell(o, cell) {
  const browser = await openBrowser(o);
  const bot = new Bot(o, browser, cell.id.replace(/[:]/g, '_') || 'cell');
  const t0 = Date.now();
  const rec = { id: cell.id, mode: cell.mode, level: cell.level ?? '', rules: cell.rules ?? '', profile: cell.profile ?? '', label: o.label, result: 'error', wall: 0, ffBatch: Number(process.env.E2E_FF_BATCH) || 1 };
  try {
    await bot.open();
    await seedPage(bot, cell.seed, cell.mode === 'qb' ? profileFor(cell.level) : null, cell.mode === 'mission' ? missionStorage(cell) : null);
    if (cell.mode === 'journey') {
      const mod = await loadJourney(cell.journey);
      await mod.default(bot, { o, browser });
      rec.result = bot.checks.every((c) => c.ok) ? 'pass' : 'fail';
      for (const c of bot.checks.filter((c) => !c.ok)) bot.friction('check', `${c.what}: ${c.detail.slice(0, 200)}`);
    } else {
      await bot.goto();
      await bot.waitMenu();
      if (!await startMode(bot, cell)) rec.result = 'n/a';
      else {
        await startMetrics(bot);
        const r = await PLAY[cell.profile](bot, { maxSim: cell.profile === 'newcomer' ? 1800 : 2400 });
        // (the game decides: a profile that stops early on a match still running "gave up")
        const fin = await over(bot);
        rec.result = fin ? (fin.won ? 'win' : 'loss') : r.result === 'timeout' ? 'timeout' : 'gave up';
        rec.notes = r.notes;
        const m = await readMetrics(bot);
        Object.assign(rec, m ?? {});
        await bot.shot('end');
        // the end screen: what it says, and whether it comes
        const o2 = await over(bot);
        if (o2) {
          // (the 4.5 s finale counts frame time capped at 0.1 s a frame: on a software GPU at 1 fps it takes minutes)
          const te = Date.now();
          const ok = await bot.page.waitForSelector(':is(.end-screen, .dbf, .mx-overlay .chr, .cq-modal .cq-dlg):not(.leaving)', { state: 'visible', timeout: 420000 * bot.o.slow }).then(() => true, () => false);
          rec.endScreenSecs = Math.round((Date.now() - te) / 1000);
          if (!ok) bot.friction('softlock', 'the match ended but no results screen or debrief appeared within 7 minutes');
          else { await sleep(1500); rec.endText = await bot.page.evaluate(() => document.querySelector(':is(.end-screen, .dbf, .mx-overlay .chr, .cq-modal .cq-dlg):not(.leaving)')?.innerText.replace(/\s+/g, ' ').slice(0, 400)); await bot.shot('results'); }
        } else {
          // still running at the time limit: is anything happening, or is it stuck?
          const st = await bot.g((g) => { const us = g.world.units.filter((u) => u.alive && u.owner === g.local); return { my: us.length, types: [...new Set(us.map((u) => u.ut.id))].join(','), where: us.slice(0, 3).map((u) => `${Math.round(u.x)},${Math.round(u.y)}`).join(' '), blds: g.world.buildings.filter((b) => b.alive && b.owner === g.local).length, credits: g.local.credits }; });
          if (!st.blds && st.my) bot.friction('softlock', `time limit with no structures and ${st.my} units left (${st.types} at ${st.where}): can't build, can't lose`);
          rec.left = st;
        }
      }
    }
  } catch (e) {
    rec.result = 'error';
    rec.error = e instanceof JourneyAbort ? e.message : String(e.stack ?? e).split('\n').slice(0, 4).join(' | ');
    bot.log(`error: ${rec.error}`);
    await bot.shot('error').catch(() => {});
  }
  rec.errors = [...new Set([...bot.errors, ...bot.allErrors])].slice(0, 10);
  rec.frictions = bot.frictions;
  rec.wall = Math.round((Date.now() - t0) / 1000);
  fs.writeFileSync(path.join(bot.dir, 'log.txt'), bot.logLines.join('\n') + '\n');
  fs.writeFileSync(path.join(bot.dir, 'result.json'), JSON.stringify(rec, null, 1));
  await bot.context?.close().catch(() => {});
  await browser.close().catch(() => {});
  return rec;
}

// ------------------------------------------------------------------------------------------------ the table

const mmss = (s) => (s === null || s === undefined ? '-' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`);

export function table(recs) {
  const rows = [
    '| cell | result | length | 1st contact | bank avg | idle $ % | low power s | army peak | foe peak | foe @7:00 (units/def) | hints | friction |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const r of recs) {
    const fr = (r.frictions ?? []).map((f) => f.kind);
    const frs = [...new Set(fr)].map((k) => `${k}×${fr.filter((x) => x === k).length}`).join(' ');
    rows.push(`| ${r.id} | ${r.result} | ${mmss(r.simEnd)} | ${mmss(r.firstContact)} | ${r.bankAvg ?? '-'} | ${r.idleMoneyPct ?? '-'} | ${r.lowPowerSecs ?? '-'} | ${r.peakArmy ?? '-'} | ${r.peakFoe ?? '-'} | ${r.at7 ? `${r.at7.foeUnits}/${r.at7.foeDefences}` : '-'} | ${(r.hints ?? []).length} | ${frs || '-'} |`);
  }
  return rows.join('\n') + '\n';
}

// ------------------------------------------------------------------------------------------------ main

const SELF = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === SELF) {
  const argv = process.argv.slice(2);
  // matrix-only options, taken out before lib's parser sees the rest
  const take = (name, def = null) => { const i = argv.indexOf(name); if (i < 0) return def; const v = argv[i + 1]; argv.splice(i, 2); return v; };
  const flag = (name) => { const i = argv.indexOf(name); if (i < 0) return false; argv.splice(i, 1); return true; };
  const lock = take('--lock');
  const label = take('--label', 'run');
  const profiles = take('--profiles');
  const child = take('--child');
  const list = flag('--list');
  if (!argv.includes('--url')) argv.push('--url', 'http://127.0.0.1:5315/');
  const o = parseArgs(argv);
  o.label = label;
  let cells = pick(allCells(), o.journeys);
  if (profiles) cells = cells.filter((c) => !c.profile || profiles.split(',').includes(c.profile));
  if (list) { for (const c of cells) console.log(c.id); process.exit(0); }
  fs.mkdirSync(o.out, { recursive: true });
  process.env.E2E_FF_BATCH ??= '4'; // four fast-forward chunks per round trip (lib.mjs Bot.wait)
  if (child) {
    const cell = allCells().find((c) => c.id === child);
    if (!cell) { console.error(`no cell ${child}`); process.exit(2); }
    // a watchdog: a wedged software GPU must not stall the whole matrix (E2E_CELL_MINUTES, default 100)
    const limit = (Number(process.env.E2E_CELL_MINUTES) || 100) * 60000;
    setTimeout(() => {
      const dir = path.join(o.out, cell.id.replace(/[:]/g, '_'));
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify({ id: cell.id, mode: cell.mode, level: cell.level ?? '', rules: cell.rules ?? '', profile: cell.profile ?? '', label: o.label, result: 'error', error: `watchdog: over ${limit / 60000} min`, frictions: [{ kind: 'softlock', text: 'the run did not finish in time (watchdog)', t: 0 }] }, null, 1));
      console.log(`RESULT ${JSON.stringify({ id: cell.id, result: 'error' })}`);
      process.exit(1);
    }, limit).unref();
    const rec = await runCell(o, cell);
    console.log(`RESULT ${JSON.stringify({ id: rec.id, result: rec.result })}`);
    process.exit(0);
  }
  let server = null;
  if (o.serve) {
    const u = new URL(o.url);
    server = await serve(o.serve, { port: +(u.port || 80), host: u.hostname });
    console.log(`serving ${o.serve} at ${server.url}`);
  }
  const jsonl = path.join(o.out, 'results.jsonl');
  const done = fs.existsSync(jsonl) ? fs.readFileSync(jsonl, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  const skip = new Set(done.map((r) => r.id));
  for (const cell of cells) {
    if (skip.has(cell.id)) { console.log(`skip ${cell.id} (already in results.jsonl)`); continue; }
    const t = Date.now();
    let rec;
    if (lock) {
      // a child process per cell, under the heavy lock (released between cells). flock is not first-in-first-out:
      // after a cell, pause a little so jobs already waiting for the lock get it before the next cell does
      if (done.length) await sleep(90000); // (the shared machine's rule: 90 s between acquisitions)
      const args = [SELF, '--child', cell.id, '--url', o.url, '--out', o.out, '--label', label, ...(o.slow !== 1 ? ['--slow', String(o.slow)] : [])];
      const guard = path.join(ROOT, 'tools/assets/memguard.sh');
      await new Promise((res) => {
        const p = spawn('bash', ['-c', `"${guard}" 6000 && exec flock "${lock}" "${process.execPath}" ${args.map((a) => `'${a}'`).join(' ')}`], { stdio: ['ignore', 'inherit', 'inherit'] });
        p.on('exit', res);
      });
      const f = path.join(o.out, cell.id.replace(/[:]/g, '_'), 'result.json');
      rec = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : { id: cell.id, result: 'error', error: 'no result.json' };
    } else rec = await runCell(o, cell);
    fs.appendFileSync(jsonl, JSON.stringify(rec) + '\n');
    done.push(rec);
    fs.writeFileSync(path.join(o.out, 'table.md'), `# Play matrix: ${label}\n\n${table(done)}`);
    console.log(`== ${cell.id}: ${rec.result} in ${mmss(rec.simEnd)} sim, ${Math.round((Date.now() - t) / 1000)} s wall`);
  }
  await server?.close();
  console.log(table(done));
}
