// Chrome DevTools on the emulator at http://127.0.0.1:<port> on this machine, for tools that take a CDP URL
// (tools/e2e/run.mjs --cdp). Starts Chrome with its DevTools socket and forwards each connection through the adb
// server (the container publishes it on the loopback :5037), like `adb forward`, without an adb binary here.
//
//   node tools/mobile/cdp-bridge.mjs [port=9222]
import net from 'node:net';
import { shell, sleep } from './lib.mjs';

const PORT = +(process.argv[2] ?? 9222);
const SOCKET = 'chrome_devtools_remote';

/** One adb request on a fresh connection: resolves with the socket once the server says OKAY. */
function adbStream(service) {
  return new Promise((resolve, reject) => {
    const s = net.createConnection({ host: '127.0.0.1', port: 5037 });
    const send = (msg) => s.write(msg.length.toString(16).padStart(4, '0') + msg);
    let step = 0, buf = Buffer.alloc(0);
    s.on('error', reject);
    s.on('connect', () => send('host:transport-any'));
    const onData = (d) => {
      buf = Buffer.concat([buf, d]);
      if (buf.length < 4) return;
      const st = buf.subarray(0, 4).toString();
      buf = buf.subarray(4);
      if (st !== 'OKAY') { s.destroy(); reject(new Error(`adb: ${st} ${buf.toString()}`)); return; }
      if (step++ === 0) { send(service); return; }
      s.off('data', onData);
      if (buf.length) s.unshift(buf);
      resolve(s);
    };
    s.on('data', onData);
  });
}

// Chrome reads its flags from this file on a debuggable device (the emulator's Google APIs image is one)
shell(`echo '_ --disable-fre --no-default-browser-check --no-first-run --remote-debugging-socket-name=${SOCKET}' > /data/local/tmp/chrome-command-line`);
shell('am force-stop com.android.chrome');
shell('am start -a android.intent.action.VIEW -d about:blank com.android.chrome >/dev/null');
await sleep(4000);

net.createServer((client) => {
  client.pause();
  adbStream(`localabstract:${SOCKET}`).then((dev) => {
    client.pipe(dev).pipe(client);
    client.resume();
    const end = () => { client.destroy(); dev.destroy(); };
    client.on('error', end); dev.on('error', end); client.on('close', end); dev.on('close', end);
  }, (e) => { console.error(e.message); client.destroy(); });
}).listen(PORT, '127.0.0.1', () => console.log(`Chrome DevTools on the emulator: http://127.0.0.1:${PORT}`));
