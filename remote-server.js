// Phone remote: a tiny web server on the local network. A phone on the same
// Wi-Fi opens the page, sees what's playing (pushed live over Server-Sent
// Events) and sends a few commands (fade, play/pause, skip...) back.
// Every request must carry the secret key from the QR code link.
//
// Guests at a dance get a separate link (and key) under /guest: they can see
// what's playing and request songs from a list the DJ allows. That's all.
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const qrcode = require('qrcode-generator');

const FIRST_PORT = 4747;
const ACTIONS = new Set(['fadeNow', 'toggle', 'next', 'back', 'automix', 'master']);
const GUEST_WAIT_MS = 10 * 60 * 1000; // one accepted request per phone every 10 minutes

class RemoteServer {
  constructor({ settingsFile, onCommand, onGuestRequest }) {
    this.settingsFile = settingsFile;
    this.onCommand = onCommand;
    this.onGuestRequest = onGuestRequest;
    this.server = null;
    this.port = null;
    this.clients = new Set();
    this.lastState = null;
    this.guestClients = new Set();
    this.guestState = null;
    this.guestLibrary = [];          // [{ key, name }] the songs guests may request
    this.guestLast = new Map();      // phone (IP) → time of its last accepted request
    this.settings = { enabled: false, token: newToken(), guestsEnabled: false, guestToken: newToken() };
    try {
      Object.assign(this.settings, JSON.parse(fs.readFileSync(settingsFile, 'utf8')));
    } catch { /* first run */ }
  }

  saveSettings() {
    fs.mkdirSync(path.dirname(this.settingsFile), { recursive: true });
    fs.writeFileSync(this.settingsFile, JSON.stringify(this.settings, null, 2));
  }

  /** The server runs while the DJ remote or guest requests (or both) are on. */
  async sync() {
    if (this.settings.enabled || this.settings.guestsEnabled) await this.start();
    else this.stop();
    if (!this.settings.enabled) {
      for (const res of this.clients) res.end();
      this.clients.clear();
    }
    if (!this.settings.guestsEnabled) {
      for (const res of this.guestClients) res.end();
      this.guestClients.clear();
    }
  }

  async setEnabled(on) {
    this.settings.enabled = on;
    this.saveSettings();
    await this.sync();
  }

  async setGuestsEnabled(on) {
    this.settings.guestsEnabled = on;
    this.saveSettings();
    await this.sync();
  }

  async resetToken() {
    this.settings.token = newToken();
    this.saveSettings();
    for (const res of this.clients) res.end(); // kick phones using the old link
    this.clients.clear();
  }

  async resetGuestToken() {
    this.settings.guestToken = newToken();
    this.saveSettings();
    for (const res of this.guestClients) res.end();
    this.guestClients.clear();
  }

  pushGuestState(state) {
    this.guestState = state;
    const msg = `data: ${JSON.stringify(state)}\n\n`;
    for (const res of this.guestClients) res.write(msg);
  }

  setGuestLibrary(list) {
    this.guestLibrary = Array.isArray(list) ? list.slice(0, 5000) : [];
    const msg = `event: library\ndata: ${JSON.stringify(this.guestLibrary)}\n\n`;
    for (const res of this.guestClients) res.write(msg);
  }

  guestInfo() {
    const running = !!this.server && this.settings.guestsEnabled;
    const urls = running
      ? lanAddresses().map(ip => `http://${ip}:${this.port}/guest?g=${this.settings.guestToken}`)
      : [];
    return { enabled: this.settings.guestsEnabled, running, urls, qrSvg: qrFor(urls[0]), guests: this.guestClients.size };
  }

  async start() {
    if (this.server) return;
    for (let port = FIRST_PORT; port < FIRST_PORT + 20; port++) {
      try {
        await this.listen(port);
        this.port = port;
        return;
      } catch (err) {
        if (err.code !== 'EADDRINUSE') throw err;
      }
    }
    throw new Error('no free network port found');
  }

  listen(port) {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => this.handle(req, res));
      server.once('error', reject);
      server.listen(port, '0.0.0.0', () => {
        server.off('error', reject);
        this.server = server;
        resolve();
      });
    });
  }

  stop() {
    for (const res of this.clients) res.end();
    this.clients.clear();
    for (const res of this.guestClients) res.end();
    this.guestClients.clear();
    if (this.server) this.server.close();
    this.server = null;
    this.port = null;
  }

  /** Called by the app a couple of times a second with what's going on. */
  pushState(state) {
    this.lastState = state;
    if (!this.clients.size) return;
    const msg = `data: ${JSON.stringify(state)}\n\n`;
    for (const res of this.clients) res.write(msg);
  }

  info() {
    const running = !!this.server && this.settings.enabled;
    const urls = running
      ? lanAddresses().map(ip => `http://${ip}:${this.port}/?k=${this.settings.token}`)
      : [];
    return { enabled: this.settings.enabled, running, urls, qrSvg: qrFor(urls[0]), phones: this.clients.size };
  }

  handle(req, res) {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/guest' || url.pathname.startsWith('/guest/')) {
      this.handleGuest(req, res, url);
      return;
    }
    const key = url.searchParams.get('k') || req.headers['x-dj-key'];
    if (!this.settings.enabled || !safeEqual(key, this.settings.token)) {
      res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<meta name="viewport" content="width=device-width"><body style="font-family:sans-serif;background:#0e0f13;color:#eee;padding:24px">' +
        '<h2>DJ Dudes</h2><p>This link is out of date. Open <b>📱 Phone remote</b> on the PC and scan the code again.</p>');
      return;
    }

    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      fs.createReadStream(path.join(__dirname, 'remote.html')).pipe(res);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
      });
      res.write('retry: 2000\n\n');
      if (this.lastState) res.write(`data: ${JSON.stringify(this.lastState)}\n\n`);
      this.clients.add(res);
      req.on('close', () => this.clients.delete(res));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/cmd') {
      let body = '';
      req.on('data', chunk => {
        body += chunk;
        if (body.length > 2000) req.destroy();
      });
      req.on('end', () => {
        let cmd;
        try { cmd = JSON.parse(body); } catch { cmd = null; }
        if (!cmd || !ACTIONS.has(cmd.action) || (cmd.deck && !['A', 'B'].includes(cmd.deck))) {
          res.writeHead(400).end('bad command');
          return;
        }
        this.onCommand({ action: cmd.action, deck: cmd.deck, value: Number(cmd.value) });
        res.writeHead(204).end();
      });
      return;
    }

    res.writeHead(404).end();
  }

  /** Guest pages: see what's playing, request a song from the allowed list. Nothing else. */
  handleGuest(req, res, url) {
    const key = url.searchParams.get('g');
    if (!this.settings.guestsEnabled || !safeEqual(key, this.settings.guestToken)) {
      res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<meta name="viewport" content="width=device-width"><body style="font-family:sans-serif;background:#0e0f13;color:#eee;padding:24px">' +
        '<h2>Song requests</h2><p>Requests are closed right now, or this link is out of date. Ask the DJ for the new code.</p>');
      return;
    }

    if (req.method === 'GET' && url.pathname === '/guest') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      fs.createReadStream(path.join(__dirname, 'guest.html')).pipe(res);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/guest/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      res.write('retry: 3000\n\n');
      res.write(`event: library\ndata: ${JSON.stringify(this.guestLibrary)}\n\n`);
      if (this.guestState) res.write(`data: ${JSON.stringify(this.guestState)}\n\n`);
      this.guestClients.add(res);
      req.on('close', () => this.guestClients.delete(res));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/guest/request') {
      let body = '';
      req.on('data', chunk => {
        body += chunk;
        if (body.length > 1000) req.destroy();
      });
      req.on('end', async () => {
        const reply = (status, ok, message) => {
          res.writeHead(status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok, message }));
        };
        let r;
        try { r = JSON.parse(body); } catch { r = null; }
        const song = r && this.guestLibrary.find(s => s.key === r.key);
        if (!song) return reply(400, false, "That song isn't on the request list.");
        const phone = req.socket.remoteAddress || '?';
        const last = this.guestLast.get(phone) || 0;
        const wait = last + GUEST_WAIT_MS - Date.now();
        if (wait > 0) {
          const mins = Math.ceil(wait / 60000);
          return reply(429, false, `You can request another song in ${mins} minute${mins === 1 ? '' : 's'}.`);
        }
        const name = String((r && r.name) || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 30);
        let result;
        try {
          result = await this.onGuestRequest({ key: song.key, name });
        } catch {
          result = { ok: false, message: "The DJ's computer didn't answer. Try again in a moment." };
        }
        if (result.ok) this.guestLast.set(phone, Date.now());
        reply(result.ok ? 200 : 409, result.ok, result.message);
      });
      return;
    }

    res.writeHead(404).end();
  }
}

function qrFor(text) {
  if (!text) return '';
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 5, margin: 3 });
}

function newToken() {
  return crypto.randomBytes(6).toString('base64url');
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/** This PC's addresses on the home network, most likely Wi-Fi/Ethernet first. */
function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === 'IPv4' && !a.internal) out.push(a.address);
    }
  }
  const score = ip => (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 2 : 3);
  return out.sort((x, y) => score(x) - score(y));
}

module.exports = { RemoteServer };
