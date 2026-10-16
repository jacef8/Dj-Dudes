// Electron entry point: opens DJ Dudes in its own desktop window.
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const http = require('http');
const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const { fileURLToPath } = require('url');
const { RemoteServer } = require('./remote-server');

let mainWindow = null;
let remote = null;

/*
 * The app's own pages are served from a private address on this PC
 * (127.0.0.1, not reachable from the network). YouTube's player refuses to
 * play inside pages opened straight from files, so this is what makes
 * YouTube songs work.
 */
const APP_FILES = {
  '/': ['index.html', 'text/html'],
  '/index.html': ['index.html', 'text/html'],
  '/style.css': ['style.css', 'text/css'],
  '/app.js': ['app.js', 'text/javascript'],
  '/youtube.js': ['youtube.js', 'text/javascript'],
};

function startAppServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const entry = APP_FILES[new URL(req.url, 'http://x').pathname];
      if (!entry) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { 'Content-Type': `${entry[1]}; charset=utf-8`, 'Cache-Control': 'no-store' });
      fsSync.createReadStream(path.join(__dirname, entry[0])).pipe(res);
    });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

let appPort = null;

function createWindow() {
  const win = mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 640,
    title: 'DJ Dudes',
    backgroundColor: '#0e0f13',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      // Keep timers running at full speed when minimised so automix never misses a cue.
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  win.loadURL(`http://127.0.0.1:${appPort}/index.html`);
}

/* ---------- playlists: .m3u8 files in Documents/DJ Dudes/Playlists ---------- */

const playlistDir = () => path.join(app.getPath('documents'), 'DJ Dudes', 'Playlists');

const safeName = name =>
  String(name).replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/[. ]+$/, '').trim().slice(0, 100) || 'Untitled';

async function playlistFile(name) {
  const base = path.join(playlistDir(), safeName(name));
  for (const ext of ['.m3u8', '.m3u']) {
    try {
      await fs.access(base + ext);
      return base + ext;
    } catch { /* try the next extension */ }
  }
  return base + '.m3u8';
}

/** Parse an M3U/M3U8 playlist (ours, or one exported from other DJ software). */
function parseM3U(text, dir) {
  const items = [];
  let info = null;
  for (const raw of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#EXTINF:')) {
      const m = /^#EXTINF:(-?[\d.]+)[^,]*,(.*)$/.exec(line);
      if (m) info = { duration: parseFloat(m[1]), title: m[2].trim() };
      continue;
    }
    if (line.startsWith('#')) continue;
    let p = line;
    if (/^https?:/i.test(p)) { /* a web link (e.g. a YouTube song): keep as is */ }
    else if (/^file:/i.test(p)) p = fileURLToPath(p);
    else if (!path.isAbsolute(p)) p = path.resolve(dir, p);
    const duration = info && info.duration > 0 ? info.duration : NaN;
    items.push({ path: p, title: (info && info.title) || '', duration });
    info = null;
  }
  return items;
}

ipcMain.handle('read-file', (_e, p) => fs.readFile(p));

ipcMain.handle('playlist-dir', () => playlistDir());

ipcMain.handle('list-playlists', async () => {
  const dir = playlistDir();
  await fs.mkdir(dir, { recursive: true });
  const files = (await fs.readdir(dir)).filter(f => /\.m3u8?$/i.test(f));
  return Promise.all(files.map(async f => {
    const full = path.join(dir, f);
    const [text, stat] = await Promise.all([fs.readFile(full, 'utf8'), fs.stat(full)]);
    return { name: f.replace(/\.m3u8?$/i, ''), count: parseM3U(text, dir).length, savedAt: stat.mtimeMs };
  }));
});

ipcMain.handle('read-playlist', async (_e, name) => {
  const file = await playlistFile(name);
  const items = parseM3U(await fs.readFile(file, 'utf8'), path.dirname(file));
  return Promise.all(items.map(async item => {
    if (/^https?:/i.test(item.path)) return { ...item, exists: true };
    try {
      await fs.access(item.path);
      return { ...item, exists: true };
    } catch {
      return { ...item, exists: false };
    }
  }));
});

ipcMain.handle('save-playlist', async (_e, name, items) => {
  await fs.mkdir(playlistDir(), { recursive: true });
  const old = await playlistFile(name);
  await fs.rm(old, { force: true }); // replace an older .m3u of the same name too
  const lines = ['#EXTM3U'];
  for (const item of items) {
    const secs = Number.isFinite(item.duration) ? Math.round(item.duration) : -1;
    lines.push(`#EXTINF:${secs},${String(item.title).replace(/[\r\n]/g, ' ')}`, item.path);
  }
  await fs.writeFile(path.join(playlistDir(), safeName(name) + '.m3u8'), lines.join('\r\n') + '\r\n', 'utf8');
});

ipcMain.handle('delete-playlist', async (_e, name) => fs.rm(await playlistFile(name), { force: true }));

ipcMain.handle('open-playlist-folder', async () => {
  await fs.mkdir(playlistDir(), { recursive: true });
  return shell.openPath(playlistDir());
});

/* ---------- phone remote ---------- */

ipcMain.on('remote-state', (_e, state) => remote && remote.pushState(state));
ipcMain.handle('remote-info', () => remote.info());
ipcMain.handle('remote-set-enabled', async (_e, on) => {
  await remote.setEnabled(on);
  return remote.info();
});
ipcMain.handle('remote-reset', async () => {
  await remote.resetToken();
  return remote.info();
});

// Look like plain Chrome to websites (YouTube is pickier with unknown browsers).
app.userAgentFallback = app.userAgentFallback.replace(/ (Electron|dj-dudes|DJ Dudes)\/\S+/gi, '');

app.whenReady().then(async () => {
  appPort = await startAppServer();
  remote = new RemoteServer({
    settingsFile: path.join(app.getPath('userData'), 'remote.json'),
    onCommand: cmd => mainWindow && mainWindow.webContents.send('remote-cmd', cmd),
  });
  if (remote.settings.enabled) {
    try { await remote.start(); } catch (err) { console.error('Phone remote failed to start:', err); }
  }
  createWindow();
});
app.on('window-all-closed', () => app.quit());
