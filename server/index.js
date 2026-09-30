// RealtyPilot server — `node server/index.js`
const http = require('http');
const fs = require('fs');
const path = require('path');
const { handle, raw } = require('./router');
const { HttpError } = require('./lib');
require('./routes/auth');
require('./routes/team');
require('./routes/inventory');
require('./routes/leads');
require('./routes/work');
require('./routes/sales');
require('./routes/insights');
const { tick } = require('./jobs');

const PUBLIC = path.join(__dirname, '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

function serveStatic(req, res, pathname) {
  let file = path.normalize(path.join(PUBLIC, pathname === '/' ? 'index.html' : pathname));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end('Forbidden'); }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(PUBLIC, 'index.html');
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (!url.pathname.startsWith('/api/')) return serveStatic(req, res, decodeURIComponent(url.pathname));
    const out = await handle(req, res, url);
    if (res.writableEnded) return;
    if (out && out.__raw) {
      const h = { 'Content-Type': out.type, 'Cache-Control': 'no-store' };
      if (out.filename) h['Content-Disposition'] = `inline; filename="${out.filename}"`;
      res.writeHead(200, h);
      return res.end(out.body);
    }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(out === undefined ? { ok: true } : out));
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(e);
    if (!res.headersSent) res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: status === 500 ? 'Something went wrong on the server' : e.message, ...(e.extra || {}) }));
  }
});

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
if (require.main === module) {
  server.listen(PORT, HOST, () => console.log(`RealtyPilot running → http://localhost:${PORT}`));
  setInterval(() => { try { tick(); } catch (e) { console.error('tick failed', e); } }, 60000);
  setTimeout(() => { try { tick(); } catch (e) { console.error(e); } }, 3000);
}
module.exports = { server, raw };
