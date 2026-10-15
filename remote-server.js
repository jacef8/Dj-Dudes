// Phone remote: a tiny web server on the local network. A phone on the same
// Wi-Fi opens the page, sees what's playing (pushed live over Server-Sent
// Events) and sends a few commands (fade, play/pause, skip...) back.
// Every request must carry the secret key from the QR code link.
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const qrcode = require('qrcode-generator');

const FIRST_PORT = 4747;
const ACTIONS = new Set(['fadeNow', 'toggle', 'next', 'back', 'automix', 'master']);

class RemoteServer {
  constructor({ settingsFile, onCommand }) {
    this.settingsFile = settingsFile;
    this.onCommand = onCommand;
    this.server = null;
    this.port = null;
    this.clients = new Set();
    this.lastState = null;
    this.settings = { enabled: false, token: newToken() };
    try {
      Object.assign(this.settings, JSON.parse(fs.readFileSync(settingsFile, 'utf8')));
    } catch { /* first run */ }
  }

  saveSettings() {
    fs.mkdirSync(path.dirname(this.settingsFile), { recursive: true });
    fs.writeFileSync(this.settingsFile, JSON.stringify(this.settings, null, 2));
  }

  async setEnabled(on) {
    this.settings.enabled = on;
    this.saveSettings();
    if (on) await this.start();
    else this.stop();
  }

  async resetToken() {
    this.settings.token = newToken();
    this.saveSettings();
    for (const res of this.clients) res.end(); // kick phones using the old link
    this.clients.clear();
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
    const running = !!this.server;
    const urls = running
      ? lanAddresses().map(ip => `http://${ip}:${this.port}/?k=${this.settings.token}`)
      : [];
    let qrSvg = '';
    if (urls[0]) {
      const qr = qrcode(0, 'M');
      qr.addData(urls[0]);
      qr.make();
      qrSvg = qr.createSvgTag({ cellSize: 5, margin: 3 });
    }
    return { enabled: this.settings.enabled, running, urls, qrSvg, phones: this.clients.size };
  }

  handle(req, res) {
    const url = new URL(req.url, 'http://x');
    const key = url.searchParams.get('k') || req.headers['x-dj-key'];
    if (!safeEqual(key, this.settings.token)) {
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
