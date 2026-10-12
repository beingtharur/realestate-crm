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
require('./routes/ops');
const { tick } = require('./jobs');
const { get, db, backup } = require('./db');

const PUBLIC = path.join(__dirname, '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

function serveStatic(req, res, pathname) {
  let file = path.normalize(path.join(PUBLIC, pathname === '/' ? 'index.html' : pathname));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end('Forbidden'); }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(PUBLIC, 'index.html');
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

// No external scripts, fonts or images are used, so everything can be locked to our own origin.
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";
function securityHeaders(res, isApi) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self)');
  if (!isApi) res.setHeader('Content-Security-Policy', CSP);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  securityHeaders(res, url.pathname.startsWith('/api/'));
  if (url.pathname === '/healthz') {            // used by the host's health check: proves the process AND the database answer
    try { get('SELECT 1 x'); res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); return res.end('{"ok":true}'); }
    catch { res.writeHead(503, { 'Content-Type': 'application/json' }); return res.end('{"ok":false}'); }
  }
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
  // a database copy on the same disk at start-up and then daily; Render's own disk snapshots cover loss of the disk itself
  const snap = () => { try { backup(); } catch (e) { console.error('backup failed', e); } };
  setTimeout(snap, 60000).unref(); setInterval(snap, 24 * 3600e3).unref();
}
// Deploys send SIGTERM: stop taking requests, flush the write-ahead log into the main database file, then exit.
function shutdown(sig) {
  console.log(`${sig} received — shutting down`);
  const force = setTimeout(() => process.exit(1), 10000); force.unref();
  server.close(() => { try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); db.close(); } catch (e) { console.error(e); } process.exit(0); });
  server.closeIdleConnections?.();
  setTimeout(() => server.closeAllConnections?.(), 3000).unref();   // phone alert long-polls would otherwise hold the shutdown open
}
if (require.main === module) for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => shutdown(sig));
module.exports = { server, raw };
