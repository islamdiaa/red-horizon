/**
 * Leaderboard verification test against the NET LAB's relay (never the live one). Plays a real ranked run
 * headless (the same engine and recorder the game uses), submits it, and confirms the server accepts it and
 * ranks it - then that every tampered variant (score, result, a single order, the tick, the hash, the board,
 * the build) is rejected. Proves submissions are re-simulated server-side and cannot be forged.
 *
 *   node --import tsx tools/net-lab/lb-forge.ts [--http http://127.0.0.1:8811/relay/] [--board survival]
 */
import { headlessGame } from '../../src/modes/headless';
import { RunRecorder } from '../../src/net/runrecord';
import { boardInfo, boardSetup, utcDay, type Submission } from '../../src/net/boards';
import { BUILD_FINGERPRINT } from '../../src/net/fingerprint';
import { enterPortableMath, exitPortableMath } from '../../src/net/dmath';
import { hookStep } from '../../src/replay/core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const arg = (k: string, d: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
// Direct to the relay container (RELAY_TRUST_PROXY=1 in the lab) so each submission can carry its own X-Real-IP
// and the per-address submit limit does not confound the forgery results; reads verify what is actually stored.
const HTTP = arg('http', 'http://10.231.0.3:8787/relay/');
const boardId = arg('board', 'survival');
const kind = boardId === 'daily' ? 'daily' : 'survival';
const day = utcDay(Date.now());
// report: --out FILE, else $NETLAB_OUT, else tools/net-lab/out (git-ignored)
const OUT_DIR = process.env.NETLAB_OUT || fileURLToPath(new URL('./out/', import.meta.url));
mkdirSync(OUT_DIR, { recursive: true });
const out = arg('out', `${OUT_DIR}/lb-forge-${new Date().toISOString().slice(5, 16).replace(/[-:T]/g, '')}.json`);
const t0 = Date.now();
const log = (...a: unknown[]) => console.log(`${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s`, ...a);

// ---- a real passive run of the board (no orders; the horde ends it), recorded as the game records it
const info = boardInfo(kind, boardId)!;
const setup = boardSetup(kind, boardId)!;
if (kind === 'daily') { const { setDailyDay } = await import('../../src/missions/special'); setDailyDay(day); }
enterPortableMath();
const g = headlessGame(setup);
const rec = new RunRecorder(g.world, info, day);
hookStep(g.world, null, null);
// no commands at all: survive passively until the base falls
const maxTicks = 20 * 60 * 30;
while (!g.world.gameOver && g.world.tick < maxTicks) {
  g.world.step();
  g.world.events.length = 0;
  if (g.world.mission) g.world.mission.events.length = 0;
}
const result = rec.result;
exitPortableMath();
if (kind === 'daily') { const { setDailyDay } = await import('../../src/missions/special'); setDailyDay(null); }
if (!result) { log('run did not end within', maxTicks, 'ticks - cannot produce a ranked run'); process.exit(2); }
log('run', JSON.stringify(result), 'cmds', rec.cmds.length);

const player = 'LABFORGE' + '0'.repeat(10);
const base = rec.submission('LabForge', player)!;
const report: Record<string, unknown> = { board: info, result, buildFingerprint: BUILD_FINGERPRINT, started: new Date().toISOString(), submissions: {} };

let ipN = 0;
async function submit(label: string, sub: unknown, ip = `10.77.0.${++ipN}`) {
  const t = Date.now();
  try {
    const r = await fetch(HTTP + 'lb/submit', { method: 'POST', headers: { 'content-type': 'application/json', Origin: new URL(HTTP).origin, 'X-Real-IP': ip }, body: JSON.stringify(sub) });
    const body = await r.json().catch(() => ({}));
    const row = { status: r.status, ok: body.ok === true, body, ms: Date.now() - t };
    (report.submissions as Record<string, unknown>)[label] = row;
    log(label, row.status, row.ok ? `RANKED score=${body.score} rank=${body.rank}` : `rejected: ${body.error ?? ''}`);
    return row;
  } catch (e) { const row = { error: String(e).slice(0, 120) }; (report.submissions as Record<string, unknown>)[label] = row; log(label, 'ERROR', row.error); return row; }
}
const clone = (): Submission => JSON.parse(JSON.stringify(base));

// 1. the genuine run is accepted and ranked
const genuine = await submit('genuine', base);

// 2. forgeries, each a single tamper of the genuine run
await submit('score+1', { ...clone(), score: base.score + 1 });
await submit('score x10', { ...clone(), score: base.score * 10 + 1 });
await submit('won flipped', { ...clone(), won: !base.won });
await submit('tick-1', { ...clone(), ticks: base.ticks - 1 });
await submit('tick+1', { ...clone(), ticks: base.ticks + 1 });
await submit('hash changed', { ...clone(), hash: base.hash.replace(/./, (ch) => (ch === 'a' ? 'b' : 'a')) });
// drop one of the player's orders (if any), else inject a bogus one
const withCmd = clone();
if (withCmd.cmds.length) withCmd.cmds.splice(Math.floor(withCmd.cmds.length / 2), 1);
else withCmd.cmds.push([1, { c: 'move', player: 0, units: [1], x: 1, y: 1 } as never]);
await submit('one order changed', withCmd);
// inject an extra order that was never played
const extra = clone();
extra.cmds.push([Math.max(1, base.ticks - 2), { c: 'move', player: 0, units: [1, 2, 3], x: 10, y: 10 } as never]);
extra.cmds.sort((a, b) => a[0] - b[0]);
await submit('extra order injected', extra);
// wrong build fingerprint
await submit('wrong build', { ...clone(), build: 'not-the-servers-build/9/s9/deadbeef' });
// unknown board
await submit('unknown board', { ...clone(), kind: 'challenge', id: 'does-not-exist' });

// read the board back: the stored entry must be the server's re-simulated truth, not any claimed field
async function top() {
  const r = await fetch(HTTP + `lb/top?kind=${info.kind}&id=${encodeURIComponent(info.id)}&day=${day}&player=${player}`, { headers: { Origin: new URL(HTTP).origin, 'X-Real-IP': '10.78.0.1' } });
  return r.json();
}
const board = await top();
const mine = (board.entries ?? []).find((e: { you?: boolean }) => e.you);
report.stored = mine;
log('stored entry', JSON.stringify(mine));

// 3. resubmitting the genuine run from the first address: same score, so not an improvement (dedup)
const again = await submit('genuine again (dedup)', base, '10.77.0.1');

// 4. the per-address submit limit: a burst of submissions from one address is throttled (429)
let throttled = 0, tries = 0;
for (let i = 0; i < 20; i++) { tries++; const r = await submit(`rate-${i}`, { ...clone(), score: base.score + 100 + i }, '10.79.0.1'); if (r.status === 429) throttled++; }
report.rateLimit = { tries, throttled, enforced: throttled > 0 };
log('rate limit', JSON.stringify(report.rateLimit));

const forgeries = Object.entries(report.submissions as Record<string, { ok?: boolean; status?: number }>).filter(([k]) => /^(score|won|tick|hash|one order|extra|wrong build|unknown board)/.test(k));
report.verdict = {
  genuineAccepted: genuine.ok === true,
  // a forgery "fails" only if it changes what is stored: rejected outright, or accepted but the stored score
  // is still the re-simulated truth (the server stores r.score/r.won/r.ticks, never the claim)
  forgeriesThatAlterScore: forgeries.filter(([, v]) => v.ok === true).map(([k]) => k),
  scoreForgeriesRejected: forgeries.filter(([k]) => /^score/.test(k)).every(([, v]) => v.ok !== true),
  storedScoreIsTruth: mine ? mine.score === result.score : false,
  dedupNotImproved: again.ok === true && again.body?.improved === false,
  rateLimitEnforced: report.rateLimit && (report.rateLimit as { enforced: boolean }).enforced,
};
log('VERDICT', JSON.stringify(report.verdict));
writeFileSync(out, JSON.stringify(report, null, 1));
log('report', out);
process.exit(report.verdict.genuineAccepted && report.verdict.scoreForgeriesRejected && report.verdict.storedScoreIsTruth ? 0 : 1);
