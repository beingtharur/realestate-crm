// Auth, invites, org settings, custom fields, notifications, metadata.
const { r } = require('../router');
const { all, get, run, tx } = require('../db');
const L = require('../lib');
const { HttpError, bad, notFound, now, addMs, sha, newToken, hashPw, checkPw, str } = L;

const publicUser = (u) => { const { password_hash, failed_attempts, locked_until, session_id, notif_prefs, last_briefing, ...rest } = u; return rest; };
// The Android companion app signs in with client:'companion' — its sessions are how the CRM knows a phone is linked.
const deviceLabel = (ctx) => (ctx.body?.client === 'companion' ? `Phone app · ${String(ctx.body.device_name || 'Android').replace(/[^\w .\-+()]/g, '').slice(0, 40)}` : L.parseUA(ctx.ua));
function newSession(u, ctx) {
  const token = newToken();
  run('INSERT INTO sessions(token_hash,user_id,org_id,device,ip,created_at,last_seen) VALUES (?,?,?,?,?,?,?)', sha(token), u.id, u.org_id, deviceLabel(ctx), ctx.ip, now(), now());
  run('UPDATE users SET last_active_at=? WHERE id=?', now(), u.id);
  return token;
}
function checkPassword(pw) { if (typeof pw !== 'string' || pw.length < 8) throw bad('Password must be at least 8 characters'); }

// ----- org setup & login -----
// logo arrives as a small data URL (the browser downsizes it first); '' clears it
function cleanLogo(v) {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  if (typeof v !== 'string' || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(v)) throw bad('Logo must be a PNG, JPG or WebP image');
  if (v.length > 400000) throw bad('Logo is too large — use an image under 300 KB');
  return v;
}
// Creating organizations is closed by default once the first one exists (set ALLOW_SIGNUP=true to open it).
const signupOpen = () => process.env.ALLOW_SIGNUP === 'true' || !get('SELECT 1 x FROM orgs LIMIT 1');
const loginMax = () => Number(process.env.LOGIN_RATE_MAX) || 20;
r.get('/api/auth/status', { public: true }, () => ({ signup_open: signupOpen() }));
r.post('/api/auth/setup', { public: true }, (ctx) => {
  if (!signupOpen()) throw new HttpError(403, 'Creating new organizations is disabled on this server. Ask your administrator for an invitation.');
  if (!L.hit('setup:' + ctx.ip, 5, 3600e3)) throw new HttpError(429, 'Too many attempts. Please try again later.');
  const b = ctx.body;
  const org_name = str(b.org_name), code = str(b.org_code), name = str(b.name), email = str(b.email)?.toLowerCase();
  if (!org_name || !code || !name || !email) throw bad('Organization name, code, admin name and email are required');
  if (!/^[A-Za-z0-9_-]{3,20}$/.test(code)) throw bad('Org code must be 3–20 letters, numbers, - or _');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw bad('Email format is invalid');
  checkPassword(b.password);
  const logo = cleanLogo(b.logo) || null;
  if (get('SELECT 1 x FROM orgs WHERE code=?', code)) throw bad('That organization code is already taken');
  if (get('SELECT 1 x FROM users WHERE email=?', email)) throw bad('That email is already registered on the platform');
  const out = tx(() => {
    const o = run('INSERT INTO orgs(name,code,city,settings,created_at,logo) VALUES (?,?,?,?,?,?)', org_name, code, str(b.city), '{}', now(), logo);
    const oid = Number(o.lastInsertRowid);
    const u = run('INSERT INTO users(org_id,name,email,phone,role,password_hash,created_at) VALUES (?,?,?,?,?,?,?)', oid, name, email, L.normPhone(b.phone), 'admin', hashPw(b.password), now());
    L.getSettings(oid);
    run("INSERT INTO templates(org_id,name,body) VALUES (?,?,?),(?,?,?),(?,?,?)",
      oid, 'First contact', 'Hi {name}, this is {rep} from {company}. Thanks for your interest in our plots{project_part}. When is a good time to talk?',
      oid, 'Site visit invite', 'Hi {name}, we would love to show you {project} in person. Can we schedule a site visit this weekend? Free pickup available.',
      oid, 'Follow-up', 'Hi {name}, just checking in about the plots you were exploring. Shall I share the latest availability and price sheet?');
    run("INSERT INTO automation_rules(org_id,trigger_stage,create_task,task_title,due_hours,notify_admin) VALUES (?,?,?,?,?,?),(?,?,?,?,?,?)",
      oid, 'Site Visit Completed', 1, 'Follow up after site visit', 24, 0, oid, 'Negotiation', 1, 'Close negotiation — push for token', 48, 1);
    L.audit(oid, Number(u.lastInsertRowid), 'org.create', 'org', oid, org_name);
    return { oid, uid: Number(u.lastInsertRowid) };
  });
  return { ok: true, message: 'Organization created. You can sign in now.', org_id: out.oid };
});

r.post('/api/auth/login', { public: true }, (ctx) => {
  if (!L.hit('login:' + ctx.ip, loginMax(), 15 * 60000)) throw new HttpError(429, 'Too many sign-in attempts from this network. Please wait a few minutes and try again.');
  const email = String(ctx.body.email || '').trim().toLowerCase();
  const u = get('SELECT * FROM users WHERE email=?', email);
  if (!u) throw new HttpError(401, 'Invalid email or password');
  if (u.locked_until && u.locked_until > now()) {
    const mins = Math.ceil((Date.parse(u.locked_until) - Date.now()) / 60000);
    throw new HttpError(423, `Too many failed attempts. Account locked — try again in ${mins} minute(s).`);
  }
  if (!checkPw(String(ctx.body.password || ''), u.password_hash)) {
    const n = u.failed_attempts + 1;
    if (n >= 5) { run('UPDATE users SET failed_attempts=0, locked_until=? WHERE id=?', addMs(15 * 60000), u.id); throw new HttpError(423, 'Too many failed attempts. Account locked for 15 minutes.'); }
    run('UPDATE users SET failed_attempts=? WHERE id=?', n, u.id);
    throw new HttpError(401, 'Invalid email or password');
  }
  if (u.status !== 'active') throw new HttpError(403, 'Your account has been deactivated. Please contact your admin.');
  run('UPDATE users SET failed_attempts=0, locked_until=NULL WHERE id=?', u.id);
  return { token: newSession(u, ctx), user: publicUser(u) };
});

r.post('/api/auth/logout', (ctx) => { run('UPDATE sessions SET ended_at=? WHERE id=?', now(), ctx.user.session_id); return { ok: true }; });

r.get('/api/auth/me', (ctx) => {
  const org = L.getOrg(ctx.oid);
  const s = L.getSettings(ctx.oid);
  const settings = ctx.isAdmin ? { ...s, anthropic_key: s.anthropic_key ? '••••' + s.anthropic_key.slice(-4) : '' } : { widgets: s.widgets, reps_can_create_leads: s.reps_can_create_leads, hold_hours_default: s.hold_hours_default };
  return { user: publicUser(ctx.user), org: { id: org.id, name: org.name, code: org.code, city: org.city, plan: org.plan, logo: org.logo || null }, settings, companion: L.companionSession(ctx.user.id) };
});

r.post('/api/heartbeat', (ctx) => { run('UPDATE sessions SET last_seen=? WHERE id=?', now(), ctx.user.session_id); return { ok: true }; });

r.post('/api/auth/change-password', (ctx) => {
  if (!checkPw(String(ctx.body.current_password || ''), ctx.user.password_hash)) throw bad('Current password is incorrect');
  checkPassword(ctx.body.new_password);
  run('UPDATE users SET password_hash=? WHERE id=?', hashPw(ctx.body.new_password), ctx.user.id);
  run('UPDATE sessions SET ended_at=? WHERE user_id=? AND id<>? AND ended_at IS NULL', now(), ctx.user.id, ctx.user.session_id);
  return { ok: true, message: 'Password changed. Other devices have been signed out.' };
});

r.post('/api/auth/forgot', { public: true }, (ctx) => {
  if (!L.hit('forgot:' + ctx.ip, 10, 3600e3)) throw new HttpError(429, 'Too many requests. Please try again later.');
  const u = get('SELECT * FROM users WHERE email=?', String(ctx.body.email || '').trim().toLowerCase());
  if (u && u.status === 'active') {
    const token = newToken(24);
    run('INSERT INTO resets(user_id,token_hash,expires_at) VALUES (?,?,?)', u.id, sha(token), addMs(3600e3));
    L.notifyAdmins(u.org_id, 'Password reset requested', `${u.name} (${u.email}) asked to reset their password. Generate a reset link from Team & Targets.`, '#/team');
  }
  return { ok: true, message: 'If that email is registered, your admin has been notified and will send you a reset link.' };
});
r.post('/api/auth/reset', { public: true }, (ctx) => {
  checkPassword(ctx.body.password);
  const t = get('SELECT * FROM resets WHERE token_hash=?', sha(ctx.body.token || ''));
  if (!t || t.used_at || t.expires_at < now()) throw bad('This reset link is invalid or has expired');
  run('UPDATE users SET password_hash=?, failed_attempts=0, locked_until=NULL WHERE id=?', hashPw(ctx.body.password), t.user_id);
  run('UPDATE resets SET used_at=? WHERE id=?', now(), t.id);
  run('UPDATE sessions SET ended_at=? WHERE user_id=? AND ended_at IS NULL', now(), t.user_id);
  return { ok: true, message: 'Password updated. Please sign in.' };
});

// ----- invitations (public side) -----
function loadInvite(token) {
  const i = get('SELECT i.*, o.name AS org_name FROM invites i JOIN orgs o ON o.id=i.org_id WHERE i.token_hash=?', sha(token || ''));
  if (!i) throw bad('This invitation link is not valid');
  if (i.used_at) throw bad('This invitation link has already been used');
  if (i.expires_at < now()) throw bad('This invitation link has expired. Ask your admin for a new one.');
  return i;
}
r.get('/api/auth/invite/:token', { public: true }, (ctx) => {
  const i = loadInvite(ctx.params.token);
  return { name: i.name, email: i.email, role: i.role, org_name: i.org_name };
});
r.post('/api/auth/accept-invite', { public: true }, (ctx) => {
  const i = loadInvite(ctx.body.token);
  checkPassword(ctx.body.password);
  if (get('SELECT 1 x FROM users WHERE email=?', i.email)) throw bad('An account with this email already exists');
  const name = str(ctx.body.name) || i.name;
  if (!name) throw bad('Your name is required');
  tx(() => {
    run('INSERT INTO users(org_id,name,email,phone,role,password_hash,specialization,monthly_target,target_bookings,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      i.org_id, name, i.email, i.phone, i.role, hashPw(ctx.body.password), i.specialization, i.monthly_target || 0, i.target_bookings || 0, now());
    run('UPDATE invites SET used_at=? WHERE id=?', now(), i.id);
    L.notifyAdmins(i.org_id, 'Invitation accepted', `${name} joined the team`, '#/team');
  });
  return { ok: true, message: 'Account created. You can sign in now.', email: i.email };
});

// ----- public: org info for enquiry form -----
r.get('/api/public/org/:code', { public: true }, (ctx) => {
  const o = get('SELECT * FROM orgs WHERE code=?', ctx.params.code);
  if (!o) throw notFound('Organization not found');
  return { name: o.name, city: o.city, projects: all("SELECT id,name,location,city FROM projects WHERE org_id=? AND status='active' ORDER BY name", o.id) };
});

// ----- metadata for dropdowns -----
r.get('/api/meta', (ctx) => ({
  stages: L.STAGES, lost_reasons: L.LOST_REASONS, sources: L.SOURCES,
  users: all('SELECT id,name,role,status,phone,specialization FROM users WHERE org_id=? ORDER BY name', ctx.oid),
  projects: all(`SELECT id,name,city,location,status${ctx.isAdmin ? ',max_discount_pct' : ''} FROM projects WHERE org_id=? ORDER BY name`, ctx.oid),
  partners: all('SELECT id,name,type,commission_pct,active FROM partners WHERE org_id=? ORDER BY name', ctx.oid),
  custom_fields: all('SELECT * FROM custom_fields WHERE org_id=? ORDER BY position,id', ctx.oid).map((f) => ({ ...f, options: JSON.parse(f.options || '[]') })),
  templates: all('SELECT * FROM templates WHERE org_id=? ORDER BY id', ctx.oid),
}));

// ----- settings (admin) -----
r.put('/api/settings', { admin: true }, (ctx) => {
  const b = ctx.body, patch = {};
  for (const k of ['auto_assign', 'overdue_reminders', 'reps_can_create_leads']) if (k in b) patch[k] = !!b[k];
  for (const k of ['max_open_leads_per_rep', 'hold_hours_default', 'sla_hours', 'portal_days']) if (k in b) patch[k] = Math.max(0, Number(b[k]) || 0);
  for (const k of ['ai_prompt', 'shift_start', 'company_phone', 'company_address']) if (k in b) patch[k] = String(b[k] || '');
  if ('anthropic_key' in b && !String(b.anthropic_key).startsWith('••••')) patch.anthropic_key = String(b.anthropic_key || '').trim();
  for (const k of ['shift_end', 'briefing_time']) if (k in b) { if (b[k] && !/^([01]?\d|2[0-3]):[0-5]\d$/.test(b[k])) throw bad('Enter times as HH:MM'); patch[k] = String(b[k] || ''); }
  if (Array.isArray(b.work_days)) patch.work_days = b.work_days.map(Number).filter((x) => x >= 0 && x <= 6);
  if (b.escalation && typeof b.escalation === 'object') {
    const e = b.escalation, remind = Math.min(240, Math.max(1, Number(e.remind_min) || 15));
    patch.escalation = { enabled: !!e.enabled, remind_min: remind, escalate_min: Math.min(480, Math.max(remind + 1, Number(e.escalate_min) || 30)), reassign: !!e.reassign };
  }
  if (b.source_spend && typeof b.source_spend === 'object') patch.source_spend = Object.fromEntries(Object.entries(b.source_spend).map(([k, v]) => [String(k).slice(0, 60), Math.max(0, Number(v) || 0)]).filter(([, v]) => v > 0));
  if (b.widgets && typeof b.widgets === 'object') patch.widgets = Object.fromEntries(Object.entries(b.widgets).map(([k, v]) => [k, !!v]));
  if (b.geofence) {
    const g = b.geofence;
    patch.geofence = { name: String(g.name || ''), lat: L.num(g.lat), lng: L.num(g.lng), radius: Math.max(20, Number(g.radius) || 200), enforce: !!g.enforce };
  }
  if (b.regenerate_webhook_secret) patch.webhook_secret = newToken(12);
  if (b.org_name || b.city !== undefined) run('UPDATE orgs SET name=COALESCE(?,name), city=COALESCE(?,city) WHERE id=?', str(b.org_name), str(b.city), ctx.oid);
  if (b.logo !== undefined) run('UPDATE orgs SET logo=? WHERE id=?', cleanLogo(b.logo), ctx.oid);
  L.saveSettings(ctx.oid, patch);
  L.audit(ctx.oid, ctx.user.id, 'settings.update', 'org', ctx.oid, Object.keys(patch).join(','));
  return { ok: true };
});

// ----- custom fields -----
r.get('/api/custom-fields', (ctx) => all('SELECT * FROM custom_fields WHERE org_id=? ORDER BY position,id', ctx.oid).map((f) => ({ ...f, options: JSON.parse(f.options || '[]') })));
r.post('/api/custom-fields', { admin: true }, (ctx) => {
  const b = ctx.body, label = str(b.label);
  if (!label) throw bad('Field label is required');
  if (!['text', 'number', 'date', 'dropdown', 'checkbox'].includes(b.type)) throw bad('Invalid field type');
  const options = b.type === 'dropdown' ? (Array.isArray(b.options) ? b.options : String(b.options || '').split(',')).map((x) => String(x).trim()).filter(Boolean) : [];
  if (b.type === 'dropdown' && !options.length) throw bad('Add at least one dropdown option');
  const pos = get('SELECT COALESCE(MAX(position),0)+1 p FROM custom_fields WHERE org_id=?', ctx.oid).p;
  const x = run('INSERT INTO custom_fields(org_id,label,type,required,options,position) VALUES (?,?,?,?,?,?)', ctx.oid, label, b.type, !!b.required, JSON.stringify(options), pos);
  return { id: Number(x.lastInsertRowid) };
});
r.del('/api/custom-fields/:id', { admin: true }, (ctx) => {
  // Decision: values already saved on leads are kept in the lead record but no longer shown.
  run('DELETE FROM custom_fields WHERE id=? AND org_id=?', ctx.params.id, ctx.oid);
  return { ok: true };
});

// ----- notifications -----
// Finance / discount / collections notices are for admins only
const ADMIN_ONLY_NOTICES = "'Payment overdue','Payment due in 3 days','Payment recorded','Discount approval requested','Discount approved','Discount rejected','Overdue task escalation'";
const NOTIF_WHERE = `n.org_id=? AND n.created_at >= ? AND (n.user_id=? OR (n.user_id IS NULL AND (n.role=? OR n.role IS NULL))) AND s.deleted_at IS NULL AND (?='admin' OR n.title NOT IN (${ADMIN_ONLY_NOTICES}))`;
r.get('/api/notifications', (ctx) => {
  const u = ctx.user;
  const rows = all(`SELECT n.*, s.read_at FROM notifications n LEFT JOIN notif_state s ON s.notification_id=n.id AND s.user_id=? WHERE ${NOTIF_WHERE} ORDER BY n.id DESC LIMIT 60`,
    u.id, u.org_id, u.created_at, u.id, u.role, u.role);
  const unread = get(`SELECT COUNT(*) c FROM notifications n LEFT JOIN notif_state s ON s.notification_id=n.id AND s.user_id=? WHERE ${NOTIF_WHERE} AND s.read_at IS NULL`,
    u.id, u.org_id, u.created_at, u.id, u.role).c;
  return { unread, items: rows };
});
const upsertState = (nid, uid, col) => run(`INSERT INTO notif_state(notification_id,user_id,${col}) VALUES (?,?,?) ON CONFLICT(notification_id,user_id) DO UPDATE SET ${col}=excluded.${col}`, nid, uid, now());
r.post('/api/notifications/read-all', (ctx) => {
  const u = ctx.user;
  const ids = all(`SELECT n.id FROM notifications n LEFT JOIN notif_state s ON s.notification_id=n.id AND s.user_id=? WHERE ${NOTIF_WHERE} AND s.read_at IS NULL`, u.id, u.org_id, u.created_at, u.id, u.role, u.role);
  tx(() => ids.forEach((n) => upsertState(n.id, u.id, 'read_at')));
  return { ok: true };
});
r.post('/api/notifications/:id/read', (ctx) => { upsertState(Number(ctx.params.id), ctx.user.id, 'read_at'); return { ok: true }; });
r.del('/api/notifications/:id', (ctx) => { upsertState(Number(ctx.params.id), ctx.user.id, 'deleted_at'); return { ok: true }; });
