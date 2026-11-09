// Red Horizon desktop: one Electron window that runs the relative-base web build from desktop/app.
//
// Security: the page is the same sandboxed web app as in a browser (no Node.js, context isolation, sandbox,
// the CSP <meta> the build injects). Files are served from a private `app://` scheme rooted at desktop/app
// (no path can leave it); navigation away and new windows are refused, except https links, which open in
// the system browser. Only fullscreen, pointer lock and clipboard writes ("Copy link") are permitted.
const { app, BrowserWindow, protocol, session, shell, Menu } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

const ROOT = path.join(__dirname, 'app');
const SCHEME = 'app';
const HOST = 'red-horizon';

/** Content types of the files the web build contains (anything else is served as bytes). */
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.glb': 'model/gltf-binary',
};

protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true } },
]);

// one window, one instance
if (!app.requestSingleInstanceLock()) app.quit();

// The file is read here rather than handed to net.fetch(file://), which fails part of the page's parallel
// module loads with net::ERR_FAILED (seen with Electron 44 on Linux), so the game never got past its loading screen.
async function serveFile(request) {
  const url = new URL(request.url);
  if (url.host !== HOST) return new Response('Not found', { status: 404 });
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(ROOT, rel));
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) return new Response('Forbidden', { status: 403 });
  try {
    const body = await fs.readFile(file);
    return new Response(body, { headers: { 'Content-Type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream' } });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 960,
    minHeight: 540,
    backgroundColor: '#05070b',
    title: 'Red Horizon',
    icon: path.join(__dirname, 'build', 'icon.png'),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      backgroundThrottling: false, // a match keeps running when the window is behind another one
    },
  });
  win.once('ready-to-show', () => win.show());
  // stay inside the game: anything else (a link in the credits) opens in the system browser
  win.webContents.on('will-navigate', (e, url) => {
    if (new URL(url).protocol !== `${SCHEME}:`) { e.preventDefault(); if (/^https:\/\//.test(url)) void shell.openExternal(url); }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') win.setFullScreen(!win.isFullScreen());
  });
  void win.loadURL(`${SCHEME}://${HOST}/index.html`);
  return win;
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  protocol.handle(SCHEME, serveFile);
  const allowed = new Set(['fullscreen', 'pointerLock', 'clipboard-sanitized-write']);
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(allowed.has(permission)));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('second-instance', () => {
  const [win] = BrowserWindow.getAllWindows();
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
