// Relay load test: protocol-level bots (no simulation) fill many rooms and play lockstep at 20 ticks a second
// with a realistic order rate, while the relay container's CPU and memory are sampled. Bots connect straight to the
// relay container with their own X-Real-IP (as nginx would set it), so the per-address limits see separate players.
//
//   node tools/net-lab/relay-load.mjs [--rooms 30] [--four 10] [--minutes 5] [--apm 120]
//        [--url ws://10.231.0.3:8787/relay/ws] [--container rh-lab-net-relay-1] [--out FILE]
//
// --four N of the rooms are 2v2 with four humans; the others are 1v1. Each bot issues about --apm orders a minute
// (some of them big box selections), reports matching hashes every 100 ticks and answers heartbeats.
import { WebSocket } from '../../server/node_modules/ws/wrapper.mjs';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const ROOMS = Number(arg('rooms', '30')), FOUR = Number(arg('four', '10')), MINUTES = Number(arg('minutes', '5')), APM = Number(arg('apm', '120'));
const URL_ = arg('url', 'ws://10.231.0.3:8787/relay/ws');
const CONTAINER = arg('container', 'rh-lab-net-relay-1');
// reports: --out FILE, else $NETLAB_OUT, else tools/net-lab/out (git-ignored)
const OUT_DIR = process.env.NETLAB_OUT || fileURLToPath(new URL('./out/', import.meta.url));
mkdirSync(OUT_DIR, { recursive: true });
const OUT = arg('out', `${OUT_DIR}/relay-load-${ROOMS}r-${new Date().toISOString().slice(5, 16).replace(/[-:T]/g, '')}.json`);
const host = new URL(URL_).host;
const t0 = Date.now();
const log = (...a) => console.log(`${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const fnv = (s) => { let a = 0x811c9dc5, b = 0x9e3779b9; for (let i = 0; i < s.length; i++) { a = Math.imul(a ^ s.charCodeAt(i), 0x01000193); b = Math.imul(b ^ s.charCodeAt(i), 0x5bd1e995) ^ (b >>> 15); } return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0'); };
const stats = { connects: 0, closes: 0, errors: {}, desyncs: 0, stalls: 0, closeLat: [], ticksClosed: 0, cmdsSent: 0, cmdsSeen: 0, bytesIn: 0, msgsIn: 0, msgsOut: 0 };
const bump = (o, k) => { o[k] = (o[k] ?? 0) + 1; };

class Bot {
  constructor(room, idx, ip) {
    this.room = room; this.idx = idx; this.ip = ip;
    this.seat = -1; this.confirmed = -1; this.tick = 0; this.committed = -1; this.sentCommit = -1; this.delay = 3; this.out = [];
    this.pending = []; // [upTo, sentAt]
    this.started = false; this.closed = false; this.rng = (room.n * 131 + idx * 7 + 1) >>> 0;
  }
  rnd() { this.rng = (this.rng * 1664525 + 1013904223) >>> 0; return this.rng / 4294967296; }
  open(hello) {
    return new Promise((resolve) => {
      const ws = this.ws = new WebSocket(URL_, { headers: { Origin: `http://${host}`, 'X-Real-IP': this.ip }, perMessageDeflate: false });
      ws.on('open', () => { stats.connects++; this.send(hello); });
      ws.on('message', (d) => { stats.msgsIn++; stats.bytesIn += d.length; this.onMsg(JSON.parse(d.toString()), resolve); });
      ws.on('close', (code) => { this.closed = true; stats.closes++; bump(stats.errors, `close-${code}`); resolve(null); });
      ws.on('error', () => {});
    });
  }
  send(m) { if (this.ws.readyState === 1) { this.ws.send(JSON.stringify(m)); stats.msgsOut++; } }
  onMsg(m, resolve) {
    switch (m.t) {
      case 'welcome': this.seat = m.seat; this.code = m.code; resolve(m); break;
      case 'ping': this.send({ t: 'pong', n: m.n }); break;
      case 'start': this.started = true; this.delay = m.delay; this.send({ t: 'loaded' }); break;
      case 'lat': this.delay = m.delay; break;
      case 'tick': {
        stats.cmdsSeen += m.cmds.length;
        if (m.to > this.confirmed) {
          stats.ticksClosed += m.to - this.confirmed;
          this.confirmed = m.to;
          const now = Date.now();
          while (this.pending.length && this.pending[0][0] <= m.to) stats.closeLat.push(now - this.pending.shift()[1]);
        }
        break;
      }
      case 'stall': if (m.seat >= 0) stats.stalls++; break;
      case 'desync': stats.desyncs++; break;
      case 'error': bump(stats.errors, m.code); break;
    }
  }
  /** One 50 ms frame of a lockstep client. */
  frame() {
    if (!this.started || this.closed) return;
    if (this.tick <= this.confirmed) {
      this.tick++;
      if (this.tick % 100 === 0) this.send({ t: 'hash', tick: this.tick, h: fnv(`${this.room.code}:${this.tick}`) });
    }
    // orders: about APM a minute, a few of them big selections
    if (this.rnd() < APM / 60 / 20) {
      const n = this.rnd() < 0.1 ? 120 : 1 + Math.floor(this.rnd() * 8);
      const units = Array.from({ length: n }, (_, i) => 1000 + this.idx * 1000 + i);
      this.out.push([this.tick + this.delay, { c: 'move', player: 0, units, x: Math.round(this.rnd() * 6400) / 100, y: Math.round(this.rnd() * 6400) / 100, attackMove: this.rnd() < 0.5 }]);
    }
    const commit = this.tick + this.delay - 1;
    if (commit > this.sentCommit) {
      const ready = this.out.filter(([t]) => t <= commit && t > this.sentCommit); // (never for a committed tick)
      this.out = this.out.filter(([t]) => t > commit);
      this.send({ t: 'in', upTo: commit, cmds: ready.slice(0, 32) });
      stats.cmdsSent += Math.min(32, ready.length);
      this.pending.push([commit, Date.now()]);
      this.sentCommit = commit;
    }
  }
}

function sampleRelay() {
  try {
    const s = execFileSync('docker', ['stats', '--no-stream', '--format', '{{.CPUPerc}}|{{.MemUsage}}', CONTAINER], { encoding: 'utf8' }).trim();
    const [cpu, mem] = s.split('|');
    return { t: Math.round((Date.now() - t0) / 1000), cpu: parseFloat(cpu), memMiB: parseFloat(mem) * (/GiB/.test(mem.split('/')[0]) ? 1024 : 1) };
  } catch { return null; }
}

const rooms = [];
const bots = [];
const report = { rooms: ROOMS, four: FOUR, minutes: MINUTES, apm: APM, url: URL_, samples: [], started: new Date().toISOString() };
report.samples.push({ ...sampleRelay(), phase: 'idle' });

// ---- fill the rooms (a few at a time, like players arriving)
for (let r = 0; r < ROOMS; r++) {
  const size = r < FOUR ? 4 : 2;
  const room = { n: r, size, code: '' };
  const mk = (i) => { const b = new Bot(room, i, `10.99.${r}.${i + 1}`); bots.push(b); return b; };
  const hostBot = mk(0);
  const w = await hostBot.open({ t: 'hello', proto: 1, build: 'loadtest', mods: '', name: `Host${r}`, create: { settings: { mode: size === 4 ? '2v2' : '1v1', size: 64 } } });
  if (!w) { log('room', r, 'create failed', stats.errors); continue; }
  room.code = w.code;
  for (let i = 1; i < size; i++) {
    const b = mk(i);
    const jw = await b.open({ t: 'hello', proto: 1, build: 'loadtest', mods: '', name: `P${r}-${i}`, join: room.code });
    if (jw) b.send({ t: 'me', ready: true });
  }
  rooms.push({ room, host: hostBot });
}
await sleep(1500);
for (const { host: h } of rooms) h.send({ t: 'start' });
log(`${rooms.length} rooms, ${bots.length} bots; matches starting`);
const timer = setInterval(() => { for (const b of bots) b.frame(); }, 50);
const end = Date.now() + MINUTES * 60_000;
let lastTicks = 0, lastAt = Date.now();
while (Date.now() < end) {
  await sleep(10_000);
  const s = sampleRelay();
  const now = Date.now();
  const pace = (stats.ticksClosed - lastTicks) / bots.length / ((now - lastAt) / 1000);
  lastTicks = stats.ticksClosed; lastAt = now;
  const lat = stats.closeLat.slice(-5000).sort((a, b) => a - b);
  const q = (p) => lat[Math.min(lat.length - 1, Math.floor(p * lat.length))] ?? -1;
  const row = { ...s, pace: Math.round(pace * 10) / 10, closeMed: q(0.5), closeP99: q(0.99), live: bots.filter((b) => !b.closed && b.started).length };
  report.samples.push(row);
  log(JSON.stringify(row));
}
clearInterval(timer);
const lat = [...stats.closeLat].sort((a, b) => a - b);
const q = (p) => lat[Math.min(lat.length - 1, Math.floor(p * lat.length))] ?? -1;
report.result = {
  bots: bots.length, started: bots.filter((b) => b.started).length, closedEarly: bots.filter((b) => b.closed).length,
  closeLatencyMs: { n: lat.length, med: q(0.5), p95: q(0.95), p99: q(0.99), max: lat[lat.length - 1] },
  ticksPerBotPerSec: Math.round((stats.ticksClosed / bots.length / (MINUTES * 60)) * 10) / 10,
  cpuMax: Math.max(...report.samples.map((s) => s.cpu || 0)), memMaxMiB: Math.max(...report.samples.map((s) => s.memMiB || 0)),
  ...stats, closeLat: undefined,
};
for (const b of bots) { try { b.send({ t: 'bye' }); b.ws.close(); } catch { /* */ } }
await sleep(2000);
report.samples.push({ ...sampleRelay(), phase: 'after' });
writeFileSync(OUT, JSON.stringify(report, null, 1));
log('result', JSON.stringify(report.result));
log('report', OUT);
process.exit(0);
