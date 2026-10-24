/**
 * World Conquest screens (lazy chunk; main.ts opens it through src/ui/world/entry.ts's hook): setup (homeland
 * picker), the turn screen with Risk phases, battle results, endings and the share card. The rules live in
 * src/conquest/world (api.ts is the seam), the geography in data.ts.
 */
import { WorldApp, type WorldUiOptions } from './app';
import { demoAllowed } from './entry';
import { W, ensureApi } from './api';
import { SetupView } from './setup';
import { showTurn } from './turn';
import { showEnd } from './end';
import { esc, tW } from './view';

export type { WorldUiOptions };
export { showWorldAfterBattle } from './end';

let current: WorldApp | null = null;

/** Open World Conquest: the run in progress, a challenge link's setup, or the homeland picker. */
export function showWorld(opts: WorldUiOptions): () => void {
  current?.close();
  // (test states only in debug builds or with ?debug=1; a shared ?world=… link opens the normal screens)
  const app = new WorldApp({ ...opts, demo: opts.demo && demoAllowed() ? opts.demo : undefined });
  app.nav = { setup: (init) => app.setView(new SetupView(app, init)), turn: (o) => showTurn(app, o), end: () => showEnd(app) };
  current = app;
  void start(app);
  return () => app.close();
}

async function start(app: WorldApp) {
  const ok = await ensureApi();
  if (!ok) {
    app.root.insertAdjacentHTML('beforeend', `<div class="wc-panel wc-side"><div class="wc-side-h"><div class="wc-kick">${esc(tW('kick'))}</div><h1 class="wc-h1">${esc(tW('title'))}</h1></div><div class="wc-side-b"><p class="wc-p">${esc(tW('loading'))}</p></div></div>`);
    return;
  }
  if (!app.globe.ok) app.toast(tW('noWebgl'), 'bad');
  let run = null;
  try { run = W.loadWorldRun(); } catch (e) { console.warn('world run unreadable', e); }
  app.run = run;
  app.store.badge(run);
  const link = /[#&]world=/.test(location.hash) ? safeDecode(location.hash) : null;
  const demo = app.opts.demo;
  if (demo && demo !== 'ui') { await runDemo(app, demo); return; }
  if (link) { app.setView(new SetupView(app, { link, step: 2 })); return; }
  if (run && run.status === 'active') showTurn(app);
  else if (run && run.status !== 'active' && app.store.get('rh.world.recorded') !== run.id) showEnd(app);
  else app.setView(new SetupView(app));
}

function safeDecode(hash: string) {
  try { return W.decodeWorldLink(hash); } catch { return null; }
}

/**
 * Test and screenshot states (?world=<demo>): new (the picker), options, fresh (a new run, turn 1), attack (odds
 * panel open), fortify, cards, rivals, log, dice, playback, won, lost, share, list, help.
 */
async function runDemo(app: WorldApp, demo: string) {
  const p = new URLSearchParams(location.search);
  const seed = (parseInt(p.get('seed') ?? '1953', 10) >>> 0) || 1953;
  const home = p.get('home') ?? app.geo.homelands[0].id;
  const size = p.get('size') === 'world' ? 'world' : 'blitz';
  if (demo === 'new') { app.setView(new SetupView(app)); return; }
  if (demo === 'options') { app.setView(new SetupView(app, { step: 2 })); return; }
  app.run = W.newWorldRun({ seed, home, size, difficulty: (p.get('diff') as 'easy') ?? 'normal', fog: p.get('fog') === '1', ironman: p.get('iron') === '1' });
  const run = app.run;
  if (demo === 'won' || demo === 'lost') {
    run.status = demo;
    if (demo === 'won') for (const t of run.territories) t.owner = run.player;
    showEnd(app);
    return;
  }
  showTurn(app, { fresh: demo === 'fresh' });
  const turn = app.view as import('./turn').TurnView;
  const toAttack = () => { if (run.phase === 'reinforce') { const mine = run.territories.find((t) => t.owner === run.player)!; W.placeTroops(run, mine.id, run.toPlace); W.endPhase(run); turn.refresh(); } };
  if (demo === 'attack' || demo === 'dice' || demo === 'fortify') {
    toAttack();
    const s = turn.suggestions(1)[0];
    if (s) { turn.sel = { src: s.from, dst: s.to }; turn.coachTarget = null; }
    if (demo === 'fortify') { turn.sel = { src: null, dst: null }; W.endPhase(run); turn.refresh(); }
    turn.refresh();
    if (demo === 'dice' && s) void turn.roll(false);
  } else if (demo === 'cards') { run.powers[run.player].cards.push('infantry', 'armour', 'air', 'air'); turn.refresh(); turn.tool('cards'); }
  else if (demo === 'rivals' || demo === 'log' || demo === 'help' || demo === 'list') { if (demo === 'log') { toAttack(); await turn.endTurn(); } turn.tool(demo); }
  else if (demo === 'playback') { toAttack(); void turn.endTurn(); }
  else if (demo === 'share') void import('./share').then((s) => s.openShare(app));
}
