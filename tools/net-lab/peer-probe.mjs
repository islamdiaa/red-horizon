// What each peer's browser offers the game: WebGL2 or not, and on which renderer. Used before a long vm-party run to
// catch a peer whose browser cannot start the game (e.g. a GPU blocklist):
//   PARTY_SCRIPT=tools/net-lab/peer-probe.mjs tools/net-lab/vm-party.sh "win11:chromium:msedge@8818 win11:chromium:chrome@8819"
import { chromium, firefox, webkit } from 'playwright';
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const TYPES = { chromium, firefox, webkit };
let bad = 0;
for (const s of arg('peers', '').split(',').filter(Boolean)) {
  const [ep, engine = 'chromium', label = ep] = s.split('|');
  try {
    const b = await TYPES[engine].connect(ep, { timeout: 90000 });
    const p = await (await b.newContext()).newPage();
    const r = await p.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      if (!gl) return { webgl2: false };
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return { webgl2: true, renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) };
    });
    console.log(label, b.version(), JSON.stringify(r));
    if (!r.webgl2) bad++;
    await b.close();
  } catch (e) { bad++; console.log(label, 'ERROR', String(e).slice(0, 200)); }
}
process.exit(bad ? 1 : 0);
