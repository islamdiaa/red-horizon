// Relay robustness tests against the NET LAB's own relay (never the live one). Each case checks that a documented
// defence in docs/MULTIPLAYER.md actually holds, and that a normal room keeps playing throughout.
//
//   node tools/net-lab/relay-robust.mjs [cases...] [--url ws://10.231.0.3:8787/relay/ws]
//        [--http http://127.0.0.1:8811/relay/] [--container rh-lab-net-relay-1] [--out FILE]
// cases: malformed oversize msgflood codeguess impersonate replay cmdflood slowreader origin (default: all)
import { WebSocket } from '../../server/node_modules/ws/wrapper.mjs';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

// the relay refuses any other protocol version ('version' error): read it from the game's source, never hard-code it
const PROTO = Number(/export const NET_PROTOCOL = (\d+)/.exec(readFileSync(new URL('../../src/net/protocol.ts', import.meta.url), 'utf8'))[1]);

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const DIRECT = arg('url', 'ws://10.231.0.3:8787/relay/ws');
const HTTP = arg('http', 'http://127.0.0.1:8811/relay/');
const CONTAINER = arg('container', 'rh-lab-net-relay-1');
// reports: --out FILE, else $NETLAB_OUT, else tools/net-lab/out (git-ignored)
const OUT_DIR = process.env.NETLAB_OUT || fileURLToPath(new URL('./out/', import.meta.url));
mkdirSync(OUT_DIR, { recursive: true });
const OUT = arg('out', `${OUT_DIR}/relay-robust-${new Date().toISOString().slice(5, 16).replace(/[-:T]/g, '')}.json`);
const ALL = ['malformed', 'oversize', 'msgflood', 'codeguess', 'impersonate', 'replay', 'cmdflood', 'slowreader', 'origin'];
const cases = process.argv.slice(2).filter((a, i, all) => ALL.includes(a) && !(all[i - 1] ?? '').startsWith('--'));
const want = cases.length ? cases : ALL;
const t0 = Date.now();
const log = (...a) => console.log(`${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { url: DIRECT, cases: {}, started: new Date().toISOString() };
const u = new URL(DIRECT);

function relayState() {
  try {
    const st = execFileSync('docker', ['inspect', '-f', '{{.RestartCount}}|{{.State.Status}}|{{.State.StartedAt}}', CONTAINER], { encoding: 'utf8' }).trim();
    const stat = execFileSync('docker', ['stats', '--no-stream', '--format', '{{.MemUsage}}|{{.CPUPerc}}', CONTAINER], { encoding: 'utf8' }).trim();
    const [restarts, status, startedAt] = st.split('|');
    return { restarts: Number(restarts), status, startedAt, mem: stat.split('|')[0], cpu: stat.split('|')[1] };
  } catch (e) { return { error: String(e).slice(0, 120) }; }
}
async function healthz() {
  const t = Date.now();
  try { const r = await fetch(HTTP + 'healthz', { method: 'POST', signal: AbortSignal.timeout(5000) }); return { ok: r.ok, ms: Date.now() - t }; } catch (e) { return { ok: false, err: String(e).slice(0, 80) }; }
}

/** One relay connection. `raw` true: no auto JSON. */
function conn(ip, { origin, noOrigin } = {}) {
  const headers = { ...(noOrigin ? {} : { Origin: origin ?? `http://${u.host}` }), ...(ip ? { 'X-Real-IP': ip } : {}) };
  const ws = new WebSocket(DIRECT, { headers, perMessageDeflate: false, maxPayload: 64 << 20 });
  const c = { ws, msgs: [], closeCode: null, seat: -1, code: '', token: '', started: false, confirmed: -1, upgradeFail: null };
  c.ready = new Promise((res) => {
    ws.on('open', () => res(true));
    ws.on('unexpected-response', (_req, r) => { c.upgradeFail = r.statusCode; res(false); });
    ws.on('error', () => res(false));
  });
  ws.on('message', (d) => { try { const m = JSON.parse(d.toString()); c.msgs.push(m); if (m.t === 'welcome') { c.seat = m.seat; c.code = m.code; c.token = m.token; } if (m.t === 'start') { c.started = true; c.delay = m.delay; } if (m.t === 'tick' && m.to > c.confirmed) c.confirmed = m.to; } catch { c.msgs.push({ t: '_raw', n: d.length }); } });
  ws.on('close', (code) => { c.closeCode = code; });
  c.send = (m) => { try { ws.send(typeof m === 'string' ? m : JSON.stringify(m)); } catch { /* */ } };
  return c;
}
const err = (c) => c.msgs.filter((m) => m.t === 'error').map((m) => m.code);
async function room(start = true) { // a 1v1 in the lobby; start=true begins the match
  const a = conn('10.50.0.1'), b = conn('10.50.0.2');
  await Promise.all([a.ready, b.ready]);
  a.send({ t: 'hello', proto: PROTO, build: 'robust', mods: '', name: 'A', create: { settings: { mode: '1v1', size: 64 } } });
  await sleep(300);
  b.send({ t: 'hello', proto: PROTO, build: 'robust', mods: '', name: 'B', join: a.code });
  await sleep(300);
  b.send({ t: 'me', ready: true });
  await sleep(300);
  if (start) { a.send({ t: 'start' }); await sleep(500); }
  return { a, b };
}
function stepRoom(r, ticks) { // advance a live room a little so it is really playing
  for (let i = 0; i < ticks; i++) for (const c of [r.a, r.b]) { c.tick = (c.tick ?? 0) + 1; c.send({ t: 'in', upTo: c.tick + c.delay - 1, cmds: [] }); }
}

const before = relayState();
log('relay before', JSON.stringify(before));

// keep a legitimate room alive across all cases
const live = await room();
const run = async (name, fn) => { if (!want.includes(name)) return; log('case', name); try { report.cases[name] = await fn(); } catch (e) { report.cases[name] = { error: String(e.stack ?? e).slice(0, 300) }; } log(' ->', JSON.stringify(report.cases[name])); };

// 1. malformed frames: counted as violations; enough of them close the connection, not the server
await run('malformed', async () => {
  const c = conn('10.51.0.1');
  await c.ready;
  c.send({ t: 'hello', proto: PROTO, build: 'robust', mods: '', name: 'M', create: {} });
  await sleep(200);
  for (let i = 0; i < 60; i++) { c.send('not json at all {{{'); c.send(JSON.stringify({ t: 'nonsense', x: i })); c.send(JSON.stringify({ t: 'slot', slot: 99 })); }
  await sleep(1500);
  return { closed: c.closeCode, closedByPolicy: c.closeCode === 1008, errors: err(c).slice(0, 5) };
});

// 2. oversize frame: beyond the ws maxPayload the relay accepts (16 KB * 3); the frame is dropped, the socket closes
await run('oversize', async () => {
  const c = conn('10.51.0.2');
  await c.ready;
  c.send({ t: 'hello', proto: PROTO, build: 'robust', mods: '', name: 'O', create: {} });
  await sleep(200);
  const big = JSON.stringify({ t: 'chat', text: 'x'.repeat(20000) }); // > MAX_CLIENT_MSG (16 KB)
  c.send(big);
  const huge = JSON.stringify({ t: 'chat', text: 'y'.repeat(200000) }); // > ws maxPayload (48 KB)
  c.send(huge);
  await sleep(1200);
  return { bigRejected: err(c).includes('bad-message') || c.closeCode !== null, closed: c.closeCode };
});

// 3. a burst of messages well over the rate limit: the one connection is throttled/closed, others unaffected
await run('msgflood', async () => {
  const c = conn('10.51.0.3');
  await c.ready;
  c.send({ t: 'hello', proto: PROTO, build: 'robust', mods: '', name: 'F', create: {} });
  await sleep(200);
  const t = Date.now();
  for (let i = 0; i < 4000; i++) c.send({ t: 'me', faction: i % 2 ? 'allies' : 'soviet' });
  await sleep(2500);
  const h = await healthz();
  return { closed: c.closeCode, durMs: Date.now() - t, healthzOkDuringFlood: h.ok, healthzMs: h.ms };
});

// 4. guessing room codes from one address: the join rate limit kicks in
await run('codeguess', async () => {
  const codes = [];
  let limited = 0, tries = 0;
  for (let i = 0; i < 40; i++) {
    const c = conn('10.52.0.1');
    const ok = await c.ready;
    if (!ok) { limited++; continue; }
    c.send({ t: 'hello', proto: PROTO, build: 'robust', mods: '', name: 'G', join: 'ZZZZZZ' });
    await sleep(80);
    tries++;
    const e = err(c);
    if (e.includes('slow-down')) limited++;
    codes.push(e[0] ?? c.closeCode);
    try { c.ws.close(); } catch { /* */ }
  }
  return { tries, limited, sawSlowDown: codes.includes('slow-down'), sample: codes.slice(0, 12) };
});

// 5. impersonation: a command claims to be another player; the relay stamps the sender's seat (checked on exec),
//    and a 'start' / settings from a non-host is refused
await run('impersonate', async () => {
  const r = await room(false); // still in the lobby: only the host may change settings or start
  // guest (not host) claims host powers: change mode, start, kick the host. The relay silently drops non-host
  // commands (counts a violation, no reply). Effect: the mode never changes and no match starts.
  r.b.send({ t: 'settings', settings: { mode: '2v2' } });
  r.b.send({ t: 'start' });
  r.b.send({ t: 'kick', seat: r.a.seat });
  await sleep(800);
  const modeAfter = [...r.a.msgs].reverse().find((m) => m.t === 'room' || m.t === 'welcome')?.room?.settings?.mode;
  const startedByGuest = r.a.started || r.b.started;
  const hostStillSeated = r.a.closeCode === null;
  // Note: a command field that claims another player's units does not help either - the relay keeps the sender's
  // seat and the player id is re-stamped on execution (src/net/lockstep.ts sanitizeCommand, tests/net.test.ts).
  try { r.a.ws.close(); r.b.ws.close(); } catch { /* */ }
  return { nonHostIgnored: modeAfter === '1v1' && !startedByGuest && hostStillSeated, modeAfterGuestEdit: modeAfter, startedByGuest, hostStillSeated };
});

// 6. replayed / out-of-range commands: a command for an already-closed or far-future tick is refused
await run('replay', async () => {
  const r = await room();
  r.b.send({ t: 'me', ready: true }); await sleep(200); r.a.send({ t: 'start' }); await sleep(400);
  for (let i = 0; i < 20; i++) { for (const c of [r.a, r.b]) c.send({ t: 'in', upTo: i, cmds: [] }); await sleep(25); }
  const closed = r.a.confirmed;
  const beforeB = r.b.msgs.filter((m) => m.t === 'tick').flatMap((m) => m.cmds).length;
  // replay a command for a tick already closed, over and over (each is a 'late-command' violation)
  for (let i = 0; i < 60; i++) r.a.send({ t: 'in', upTo: closed, cmds: [[Math.max(0, closed - 3), { c: 'move', player: 0, units: [1], x: 1, y: 1 }]] });
  // and a far-future tick, well past the commit cap
  for (let i = 0; i < 60; i++) r.a.send({ t: 'in', upTo: closed, cmds: [[closed + 50000, { c: 'move', player: 0, units: [1], x: 1, y: 1 }]] });
  await sleep(1000);
  const fannedToB = r.b.msgs.filter((m) => m.t === 'tick').flatMap((m) => m.cmds).length - beforeB;
  try { r.a.ws.close(); r.b.ws.close(); } catch { /* */ }
  return { closedTick: closed, senderClosedByPolicy: r.a.closeCode === 1008, lateCommandsFannedToPeer: fannedToB, defended: r.a.closeCode === 1008 && fannedToB === 0 };
});

// 7. a single connection sending huge pending command volume: capped (pending > 4000 -> violations)
await run('cmdflood', async () => {
  const r = await room();
  r.b.send({ t: 'me', ready: true }); await sleep(200); r.a.send({ t: 'start' }); await sleep(400);
  for (let i = 0; i < 300; i++) {
    const cmds = Array.from({ length: 32 }, (_, k) => [10 + i * 32 + k, { c: 'move', player: 0, units: [1, 2, 3], x: 1, y: 2 }]);
    r.a.send({ t: 'in', upTo: 5, cmds });
  }
  await sleep(1500);
  const h = await healthz();
  try { r.a.ws.close(); r.b.ws.close(); } catch { /* */ }
  return { aClosed: r.a.closeCode, aErrors: err(r.a).slice(0, 4), healthzOk: h.ok };
});

// 8. a reader that never reads (slow reader): the relay terminates it when its send buffer grows (http.ts: >4MB)
await run('slowreader', async () => {
  const c = conn('10.53.0.1');
  await c.ready;
  c.ws._socket?.pause?.(); // stop reading from the kernel buffer
  c.send({ t: 'hello', proto: PROTO, build: 'robust', mods: '', name: 'S', create: {} });
  await sleep(300);
  // make it chatty so the relay has data to push back (many rooms worth of pings): wait out the ping backlog
  await sleep(8000);
  const h = await healthz();
  return { closed: c.closeCode, note: 'relay terminates a socket whose outbound buffer exceeds 4 MB (server/src/http.ts)', healthzOk: h.ok };
});

// 9. origin checks: a browser Origin that is not the server's host is refused at the upgrade
await run('origin', async () => {
  const bad = conn('10.54.0.1', { origin: 'http://evil.example' });
  const ok1 = await bad.ready;
  const noOrigin = conn('10.54.0.2', { noOrigin: true });
  const ok2 = await noOrigin.ready;
  const good = conn('10.54.0.3');
  const ok3 = await good.ready;
  await sleep(200);
  try { good.ws.close(); } catch { /* */ }
  return { badOriginRefused: !ok1, badStatus: bad.upgradeFail, noOriginRefused: !ok2, sameOriginAccepted: ok3 };
});

stepRoom(live, 10);
await sleep(500);
report.liveRoomKeptPlaying = { started: live.a.started && live.b.started, confirmedA: live.a.confirmed, confirmedB: live.b.confirmed, aClosed: live.a.closeCode, bClosed: live.b.closeCode };
try { live.a.ws.close(); live.b.ws.close(); } catch { /* */ }
await sleep(500);
const after = relayState();
report.relay = { before, after, neverRestarted: before.restarts === after.restarts && after.status === 'running' };
log('relay after', JSON.stringify(after));
log('live room', JSON.stringify(report.liveRoomKeptPlaying));
writeFileSync(OUT, JSON.stringify(report, null, 1));
log('report', OUT);
process.exit(0);
