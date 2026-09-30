// Minimal router + auth middleware (zero dependencies).
const { get, run } = require('./db');
const { HttpError, sha, now, forbidden } = require('./lib');

const routes = [];
function add(method, pattern, opts, fn) {
  if (typeof opts === 'function') { fn = opts; opts = {}; }
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  routes.push({ method, re, keys, opts, fn });
}
const r = {
  get: (p, o, f) => add('GET', p, o, f), post: (p, o, f) => add('POST', p, o, f), put: (p, o, f) => add('PUT', p, o, f),
  patch: (p, o, f) => add('PATCH', p, o, f), del: (p, o, f) => add('DELETE', p, o, f),
};
/** Return this from a handler to send a non-JSON body (csv, html, file). */
const raw = (body, type = 'text/plain; charset=utf-8', filename) => ({ __raw: true, body, type, filename });

function readBody(req, limit = 25 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new HttpError(413, 'Payload too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new HttpError(400, 'Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

function authenticate(req, query) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : query.t;
  if (!token) return null;
  const s = get('SELECT * FROM sessions WHERE token_hash=? AND ended_at IS NULL', sha(token));
  if (!s) return null;
  const u = get('SELECT * FROM users WHERE id=?', s.user_id);
  if (!u || u.status !== 'active') return null;
  if (Date.now() - Date.parse(s.last_seen) > 30 * 864e5) return null;
  if (Date.now() - Date.parse(s.last_seen) > 20000) {
    run('UPDATE sessions SET last_seen=? WHERE id=?', now(), s.id);
    run('UPDATE users SET last_active_at=? WHERE id=?', now(), u.id);
  }
  u.session_id = s.id;
  return u;
}

async function handle(req, res, url) {
  const query = Object.fromEntries(url.searchParams);
  for (const rt of routes) {
    if (rt.method !== req.method) continue;
    const m = rt.re.exec(url.pathname);
    if (!m) continue;
    const params = {};
    rt.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
    const user = authenticate(req, query);
    if (!rt.opts.public && !user) throw new HttpError(401, 'Please sign in');
    if (rt.opts.admin && (!user || user.role !== 'admin')) throw forbidden('Admin access required');
    const body = req.method === 'GET' || req.method === 'DELETE' ? {} : await readBody(req);
    const ctx = {
      req, res, user, oid: user ? user.org_id : null, params, query, body,
      ip: req.socket.remoteAddress, ua: req.headers['user-agent'] || '', isAdmin: !!user && user.role === 'admin',
    };
    return rt.fn(ctx);
  }
  throw new HttpError(404, 'Endpoint not found');
}
module.exports = { r, raw, handle };
