// Desktop shell: the same web client in a Chromium window (gamepad, mic, pointer lock and WebGL behave
// the same on Windows, macOS and Linux / Steam Deck). The game server stays online; nothing runs locally.
const { app, BrowserWindow, net, protocol, session, shell, systemPreferences } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// `npm run dev` loads the Vite dev server; packaged builds load the client build through app://.
const DEV_URL = process.env.PSST_DEV_URL || '';
const WEB_DIR = app.isPackaged ? path.join(process.resourcesPath, 'web') : path.join(__dirname, '../client/dist');
const ORIGIN = 'app://psst';
const ALLOWED_PERMISSIONS = new Set(['media', 'pointerLock', 'fullscreen', 'speaker-selection']);

// A standard + secure scheme gives the page a real origin (localStorage) and a secure context (microphone).
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

function serveClient() {
  protocol.handle('app', (req) => {
    const { pathname } = new URL(req.url);
    let file = path.normalize(path.join(WEB_DIR, decodeURIComponent(pathname)));
    if (!file.startsWith(WEB_DIR + path.sep)) return new Response('Forbidden', { status: 403 });
    if (pathname === '/' || !path.extname(file)) file = path.join(WEB_DIR, 'index.html');
    return net.fetch(pathToFileURL(file).toString());
  });
}

function isOwnOrigin(url) {
  try {
    const u = new URL(url);
    return DEV_URL ? u.origin === new URL(DEV_URL).origin : u.origin === ORIGIN;
  } catch {
    return false;
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#14142b',
    autoHideMenuBar: true,
    title: 'Psst!',
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false },
  });
  // Only the game page lives in the window; links (if any) open in the system browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!isOwnOrigin(url)) e.preventDefault();
  });
  // F11 toggles fullscreen (Steam Deck / TV setups start windowed).
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') {
      win.setFullScreen(!win.isFullScreen());
      e.preventDefault();
    }
  });
  void win.loadURL(DEV_URL || `${ORIGIN}/index.html`);
}

app.whenReady().then(async () => {
  if (!DEV_URL) serveClient();
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => {
    cb(ALLOWED_PERMISSIONS.has(permission) && isOwnOrigin(wc.getURL()));
  });
  session.defaultSession.setPermissionCheckHandler((wc, permission) => ALLOWED_PERMISSIONS.has(permission) && !!wc && isOwnOrigin(wc.getURL()));
  // Packaged macOS app asks for the microphone once; voice chat simply stays off if refused.
  if (process.platform === 'darwin' && app.isPackaged) await systemPreferences.askForMediaAccess('microphone').catch(() => false);
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
