// Runs where a net-lab peer lives (a peer container, a test VM, or the host): a Playwright browser server the
// host-side runner (match.mjs) connects to. The browser's game traffic takes that machine's own network path; the
// Playwright control channel is separate.
//   PEER_ENGINE  chromium (default) | firefox | webkit   (match.mjs --engine-a/-b must name the same engine)
//   PEER_BIND    address to listen on (default 0.0.0.0; use 127.0.0.1 on the host so nothing listens on the LAN)
//   PEER_PORT    port to listen on (default 3000 inside a peer container; vm-match.sh passes a free one: on the host
//                another service may own 3000, and a client connecting there would talk to it, not to us)
//   PEER_HEADFUL 1 = headed (run under xvfb-run; headless Firefox has no WebGL on some setups)
//   PEER_CHANNEL an installed browser instead of Playwright's build (chrome, msedge; Chromium engine only)
//   PEER_STOP_FILE  when this file appears, close the browser and exit (a graceful stop on Windows)
// Chromium backends: PEER_WIN=1 Direct3D11 WARP via ANGLE (Windows, no GPU); PEER_GPU=1 (default) the host's Mesa
// GPU through ANGLE (as tools/gpu-rig); PEER_GPU=0 SwiftShader (a GPU-less machine).
import { chromium, firefox, webkit } from 'playwright';

const engine = process.env.PEER_ENGINE ?? 'chromium';
const host = process.env.PEER_BIND ?? '0.0.0.0';
const headless = process.env.PEER_HEADFUL !== '1';
const port = Number(process.env.PEER_PORT ?? 3000);
const common = { headless, host, port, wsPath: '/pw' };
let server, backend;
if (engine === 'firefox') {
  server = await firefox.launchServer({ ...common, firefoxUserPrefs: { 'webgl.force-enabled': true, 'media.autoplay.default': 0 } });
  backend = 'firefox';
} else if (engine === 'webkit') {
  server = await webkit.launchServer(common);
  backend = 'webkit';
} else {
  const win = process.env.PEER_WIN === '1';
  const gpu = process.env.PEER_GPU !== '0';
  const args = win
    ? ['--use-angle=d3d11', '--ignore-gpu-blocklist']
    : gpu
      ? ['--headless=new', '--enable-gpu', '--use-gl=angle', '--use-angle=gl-egl', '--ignore-gpu-blocklist']
      : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
  server = await chromium.launchServer({ ...common, channel: process.env.PEER_CHANNEL || undefined, args: [...args, '--autoplay-policy=no-user-gesture-required'] });
  backend = `${process.env.PEER_CHANNEL || 'chromium'} ${win ? 'd3d11-warp' : gpu ? 'gpu' : 'swiftshader'}`;
}
console.log('peer', process.env.PEER, backend, 'browser pid', server.process()?.pid ?? '?', 'ready', server.wsEndpoint());
let stopping = false;
const stop = () => { if (stopping) return; stopping = true; server.close().catch(() => {}).then(() => process.exit(0)); setTimeout(() => process.exit(0), 10000).unref(); };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
// PEER_STOP_FILE: a graceful stop where signals are not available (Windows: Stop-Process only kills, and a killed server
// leaves its browser's helper processes behind - crash handler, on-device model service - which then load the machine).
// The runner creates the file; the server closes the browser and exits.
if (process.env.PEER_STOP_FILE) {
  const { existsSync, unlinkSync } = await import('node:fs');
  setInterval(() => { if (existsSync(process.env.PEER_STOP_FILE)) { try { unlinkSync(process.env.PEER_STOP_FILE); } catch { /* */ } stop(); } }, 500).unref();
}
