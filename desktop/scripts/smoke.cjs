// Smoke test for the desktop wrapper without a display: runs main.cjs, waits for the main menu, saves a
// screenshot, checks the page for errors and quits.
//   npx electron scripts/smoke.cjs --ozone-platform=headless [out.png]
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const out = process.argv.find((a) => a.endsWith('.png')) ?? path.join(require('node:os').tmpdir(), 'rh-desktop-smoke.png');
const errors = [];
app.on('browser-window-created', (_e, win) => {
  win.webContents.on('console-message', (e) => { if (e.level === 'error') errors.push(e.message); });
  win.webContents.on('render-process-gone', (_e2, d) => { errors.push(`renderer gone: ${d.reason}`); });
  win.webContents.on('did-finish-load', async () => {
    const t0 = Date.now();
    let menu = false;
    while (Date.now() - t0 < 120000) {
      menu = await win.webContents.executeJavaScript("!!document.querySelector('.mm-layout')").catch(() => false);
      if (menu) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    await new Promise((r) => setTimeout(r, 4000));
    const info = await win.webContents.executeJavaScript('({ url: location.href, fonts: document.fonts.check("600 16px Rajdhani"), csp: !!document.querySelector(\'meta[http-equiv="Content-Security-Policy"]\') })').catch((e) => ({ error: String(e) }));
    try { fs.writeFileSync(out, (await win.webContents.capturePage()).toPNG()); } catch (e) { errors.push(`capture: ${e}`); }
    console.log(JSON.stringify({ menu, info, errors: errors.slice(0, 5), out }));
    app.exit(menu && errors.length === 0 ? 0 : 1);
  });
});
require('../main.cjs');
