// Shared helpers + core domain logic (leads, assignment, scoring, pricing, payments).
const crypto = require('crypto');
const zlib = require('zlib');
const { all, get, run, tx } = require('./db');

class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; }
}
const bad = (m, extra) => new HttpError(400, m, extra);
const forbidden = (m = 'You do not have permission to do this') => new HttpError(403, m);
const notFound = (m = 'Not found') => new HttpError(404, m);

const STAGES = ['New', 'Contacted', 'Site Visit Scheduled', 'Site Visit Completed', 'Negotiation', 'Booked', 'Lost'];
const OPEN_STAGES = STAGES.filter((s) => s !== 'Booked' && s !== 'Lost');
const LOST_REASONS = [
  'Budget Mismatch', 'Went with Competitor', 'Not Interested Anymore', 'Unresponsive / Unreachable',
  'Wrong Number / Invalid Lead', 'Bought Elsewhere', 'Project Timeline Too Long', 'Financing / Loan Rejected',
  'Location Not Suitable', 'Plot Size / Facing Not Available', 'Legal / Title Concern', 'Other',
];
const SOURCES = ['Facebook Ads', 'Google Ads', '99acres', 'MagicBricks', 'Housing.com', 'Website', 'Walk-in', 'Referral',
  'Channel Partner', 'Newspaper / Hoarding', 'Cold Call', 'WhatsApp', 'Other'];

// ---------- generic utils ----------
const now = () => new Date().toISOString();
const addMs = (ms, from = Date.now()) => new Date(from + ms).toISOString();
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const newToken = (n = 32) => crypto.randomBytes(n).toString('hex');
const hashPw = (pw) => {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(pw, salt, 64).toString('hex')}`;
};
const checkPw = (pw, stored) => {
  const [salt, h] = String(stored).split(':');
  const c = crypto.scryptSync(pw, salt, 64);
  const hb = Buffer.from(h, 'hex');
  return c.length === hb.length && crypto.timingSafeEqual(c, hb);
};
const round = (n) => Math.round(Number(n) || 0);
const num = (v) => (v === '' || v === null || v === undefined || isNaN(Number(v)) ? null : Number(v));
const str = (v) => (v === undefined || v === null ? null : String(v).trim() || null);

/** Indian mobile: 10 digits starting 6-9; optional +91 / 91 / 0 prefix, spaces & hyphens ignored. */
function normPhone(p) {
  if (p === undefined || p === null) return null;
  let s = String(p).replace(/[\s\-().]/g, '');
  if (/^\+91/.test(s)) s = s.slice(3);
  else if (/^91\d{10}$/.test(s)) s = s.slice(2);
  else if (/^0\d{10}$/.test(s)) s = s.slice(1);
  return /^[6-9]\d{9}$/.test(s) ? s : null;
}
const fmtPhone = (p) => (p ? `+91 ${p.slice(0, 5)} ${p.slice(5)}` : '');

const IST = 330 * 60000;
const iso = (ms) => new Date(ms).toISOString();
const istDate = (d = Date.now()) => new Date((typeof d === 'number' ? d : Date.parse(d)) + IST).toISOString().slice(0, 10);
/** Time range in IST. range: today | week | month | all → {from,to} ISO strings. */
function period(range) {
  const ist = new Date(Date.now() + IST);
  const y = ist.getUTCFullYear(), m = ist.getUTCMonth(), d = ist.getUTCDate();
  const startDay = Date.UTC(y, m, d) - IST;
  let a = null, b = null;
  if (range === 'today') { a = startDay; b = startDay + 864e5; }
  else if (range === 'week') { const dow = (ist.getUTCDay() + 6) % 7; a = startDay - dow * 864e5; b = a + 7 * 864e5; }
  else if (range === 'month') { a = Date.UTC(y, m, 1) - IST; b = Date.UTC(y, m + 1, 1) - IST; }
  if (a === null) return { from: '0000-01-01', to: '9999-12-31', fromD: '0000-01-01', toD: '9999-12-31' };
  return { from: iso(a), to: iso(b), fromD: istDate(a), toD: istDate(b) };
}
function dayRange(dateStr) { // 'YYYY-MM-DD' (IST) → {from,to}
  const [y, m, d] = dateStr.split('-').map(Number);
  const s = Date.UTC(y, m - 1, d) - IST;
  return { from: iso(s), to: iso(s + 864e5) };
}
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000, r = (x) => (x * Math.PI) / 180;
  const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lng2 - lng1) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
function parseUA(ua = '') {
  const b = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const o = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '';
  return `${b}${o ? ' on ' + o : ''}`;
}

// ---------- CSV / XLSX ----------
function parseCsv(text) {
  const rows = []; let row = [], f = '', q = false;
  text = String(text).replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows;
}
const csvCell = (v) => { v = v === null || v === undefined ? '' : String(v); return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
const toCsv = (rows) => rows.map((r) => r.map(csvCell).join(',')).join('\n');

function parseXlsx(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 70000); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw bad('Not a valid .xlsx file');
  const n = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = {};
  for (let i = 0; i < n; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), lho = buf.readUInt32LE(p + 42);
    files[buf.toString('utf8', p + 46, p + 46 + nlen)] = { method, csize, lho };
    p += 46 + nlen + elen + clen;
  }
  const read = (name) => {
    const f = files[name]; if (!f) return null;
    const start = f.lho + 30 + buf.readUInt16LE(f.lho + 26) + buf.readUInt16LE(f.lho + 28);
    const data = buf.subarray(start, start + f.csize);
    return (f.method === 0 ? data : zlib.inflateRawSync(data)).toString('utf8');
  };
  const unesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(d)).replace(/&amp;/g, '&');
  const shared = [];
  const ss = read('xl/sharedStrings.xml');
  if (ss) for (const m of ss.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) shared.push(unesc([...m[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join('')));
  const sheetName = Object.keys(files).filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort()[0];
  if (!sheetName) throw bad('No worksheet found in file');
  const xml = read(sheetName);
  const colIdx = (ref) => { let n = 0; for (const ch of ref.replace(/\d/g, '')) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
  const rows = [];
  for (const rm of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = [];
    for (const cm of rm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = /\br="([A-Z]+\d+)"/.exec(cm[1]); if (!ref) continue;
      const t = (/\bt="(\w+)"/.exec(cm[1]) || [])[1];
      let v = '';
      const inner = cm[2] || '';
      if (t === 'inlineStr') v = unesc([...inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join(''));
      else { const vm = /<v>([\s\S]*?)<\/v>/.exec(inner); v = vm ? unesc(vm[1]) : ''; if (t === 's') v = shared[Number(v)] ?? ''; else if (/^-?\d+(\.\d+)?[eE]\+?\d+$/.test(v)) v = String(Math.round(Number(v))); }
      row[colIdx(ref[1])] = v;
    }
    rows.push(Array.from(row, (x) => x ?? ''));
  }
  return rows;
}

// ---------- settings ----------
const DEFAULT_SETTINGS = () => ({
  auto_assign: true, overdue_reminders: true, reps_can_create_leads: true, max_open_leads_per_rep: 0,
  widgets: { kpis: true, sla: true, funnel: true, hot: true, activity: true, agenda: true, health: true, visits: true, leaderboard: true, collections: true },
  ai_prompt: '', anthropic_key: '', hold_hours_default: 48, sla_hours: 24, shift_start: '10:00',
  geofence: { name: '', lat: null, lng: null, radius: 200, enforce: false },
  webhook_secret: newToken(12), portal_days: 30, company_phone: '', company_address: '',
});
function getOrg(oid) { return get('SELECT * FROM orgs WHERE id=?', oid); }
function getSettings(oid) {
  const o = getOrg(oid);
  const d = DEFAULT_SETTINGS();
  let s = {};
  try { s = JSON.parse(o.settings || '{}'); } catch { /* ignore */ }
  const merged = { ...d, ...s, widgets: { ...d.widgets, ...(s.widgets || {}) }, geofence: { ...d.geofence, ...(s.geofence || {}) } };
  if (!s.webhook_secret) { merged.webhook_secret = d.webhook_secret; run('UPDATE orgs SET settings=? WHERE id=?', JSON.stringify(merged), oid); }
  return merged;
}
function saveSettings(oid, patch) {
  const cur = getSettings(oid);
  const next = { ...cur, ...patch, widgets: { ...cur.widgets, ...(patch.widgets || {}) }, geofence: { ...cur.geofence, ...(patch.geofence || {}) } };
  run('UPDATE orgs SET settings=? WHERE id=?', JSON.stringify(next), oid);
  return next;
}

// ---------- notifications / audit / activity ----------
function notify(oid, { user, role, title, message = '', link = '' }) {
  run('INSERT INTO notifications(org_id,user_id,role,title,message,link,created_at) VALUES (?,?,?,?,?,?,?)',
    oid, user || null, user ? null : role || null, title, message, link, now());
}
const notifyAdmins = (oid, title, message, link) => notify(oid, { role: 'admin', title, message, link });
function audit(oid, uid, action, entity, entityId, detail) {
  run('INSERT INTO audit_log(org_id,user_id,action,entity,entity_id,detail,at) VALUES (?,?,?,?,?,?,?)', oid, uid, action, entity, entityId, detail || '', now());
}
const TOUCH = new Set(['call', 'whatsapp', 'note', 'stage', 'visit', 'task', 'booking', 'payment']);
function logActivity(oid, leadId, userId, type, o = {}) {
  const t = now();
  const r = run('INSERT INTO activities(org_id,lead_id,user_id,type,direction,outcome,duration,content,meta,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    oid, leadId, userId, type, o.direction, o.outcome, o.duration, o.content, o.meta ? JSON.stringify(o.meta) : null, o.at || t);
  if (leadId && TOUCH.has(type)) run('UPDATE leads SET last_activity_at=?, updated_at=? WHERE id=? AND org_id=?', o.at || t, t, leadId, oid);
  return r.lastInsertRowid;
}

// ---------- scoring ----------
function rescore(oid, id) {
  const l = get('SELECT * FROM leads WHERE id=? AND org_id=?', id, oid);
  if (!l) return;
  let s = 0;
  const src = (l.source || '').toLowerCase();
  s += /walk/.test(src) ? 20 : /referral|partner/.test(src) ? 15 : src ? 8 : 0;
  if (l.budget_max || l.budget_min) s += 10;
  if (l.pref_size_min || l.pref_size_max) s += 5;
  if (l.pref_project_id) s += 5;
  if (l.purpose) s += 5;
  s += { New: 0, Contacted: 5, 'Site Visit Scheduled': 15, 'Site Visit Completed': 25, Negotiation: 35, Booked: 50, Lost: 0 }[l.stage] || 0;
  const calls = get("SELECT COUNT(*) c FROM activities WHERE org_id=? AND lead_id=? AND type='call' AND outcome='Connected'", oid, id).c;
  s += Math.min(15, calls * 3);
  if (l.last_activity_at && Date.now() - Date.parse(l.last_activity_at) < 48 * 3600e3) s += 10;
  if (l.stage === 'Lost') s = Math.min(s, 10);
  s = Math.max(0, Math.min(100, s));
  const rating = l.rating_manual ? l.rating : l.stage === 'Booked' || s >= 60 ? 'Hot' : s >= 35 ? 'Warm' : 'Cold';
  run('UPDATE leads SET score=?, rating=? WHERE id=?', s, rating, id);
}

// ---------- team helpers ----------
const activeMember = (oid, id) => get("SELECT * FROM users WHERE id=? AND org_id=? AND status='active'", id, oid);
function repHealth(oid, u) {
  const open = get("SELECT COUNT(*) c FROM leads WHERE org_id=? AND assigned_to=? AND stage NOT IN ('Booked','Lost')", oid, u.id).c;
  const cutoff = addMs(-48 * 3600e3);
  const untouched = get("SELECT COUNT(*) c FROM leads WHERE org_id=? AND assigned_to=? AND stage NOT IN ('Booked','Lost') AND COALESCE(last_activity_at,created_at) < ?", oid, u.id, cutoff).c;
  const last = get("SELECT MAX(created_at) t FROM activities WHERE org_id=? AND user_id=? AND type IN ('call','whatsapp','note','stage','visit','task','booking','payment')", oid, u.id).t;
  const base = last || u.created_at;
  const hours = (Date.now() - Date.parse(base)) / 3.6e6;
  let status = 'Active';
  if (open > 0) {
    if (hours >= 48) status = 'Inactive';
    else if (hours >= 24 || untouched >= Math.max(2, Math.ceil(open / 2))) status = 'Slowing Down';
  }
  return { status, open_leads: open, untouched, last_activity: last, hours_since: Math.round(hours) };
}
const openLeadCount = (oid, uid) => get("SELECT COUNT(*) c FROM leads WHERE org_id=? AND assigned_to=? AND stage NOT IN ('Booked','Lost')", oid, uid).c;

// ---------- custom fields ----------
function cleanCustom(oid, custom, enforceRequired) {
  const fields = all('SELECT * FROM custom_fields WHERE org_id=? ORDER BY position,id', oid);
  const out = {};
  custom = custom || {};
  for (const f of fields) {
    let v = custom[f.id] ?? custom[String(f.id)];
    const empty = v === undefined || v === null || v === '' || (f.type === 'checkbox' && !v);
    if (empty) { if (enforceRequired && f.required) throw bad(`"${f.label}" is required`); if (f.type === 'checkbox') out[f.id] = false; continue; }
    if (f.type === 'number') { v = Number(v); if (isNaN(v)) throw bad(`"${f.label}" must be a number`); }
    else if (f.type === 'checkbox') v = !!v;
    else if (f.type === 'dropdown') { const opts = JSON.parse(f.options || '[]'); if (!opts.includes(v)) throw bad(`"${f.label}" has an invalid option`); }
    else if (f.type === 'date') { if (isNaN(Date.parse(v))) throw bad(`"${f.label}" must be a date`); }
    else v = String(v);
    out[f.id] = v;
  }
  return out;
}

// ---------- duplicates / fraud ----------
function findDuplicates(oid, phoneNorm, email, excludeId = 0) {
  const e = email ? String(email).trim().toLowerCase() : '';
  return all(`SELECT l.id,l.name,l.phone,l.email,l.stage,l.assigned_to,u.name AS rep_name FROM leads l
    LEFT JOIN users u ON u.id=l.assigned_to WHERE l.org_id=? AND l.id<>? AND (l.phone_norm=? OR (?<>'' AND lower(l.email)=?))`, oid, excludeId, phoneNorm || '', e, e);
}
function checkFlags(oid, leadId, phoneNorm) {
  const l = get('SELECT * FROM leads WHERE id=? AND org_id=?', leadId, oid);
  if (!l || l.flag_status === 'genuine' || l.flag_status === 'spam') return;
  let reason = null;
  if (get('SELECT 1 x FROM spam_numbers WHERE org_id=? AND phone_norm=?', oid, phoneNorm)) reason = 'Number was previously marked as spam';
  else {
    const since = addMs(-24 * 3600e3);
    const n = get('SELECT COUNT(*) c FROM enquiry_log WHERE org_id=? AND phone_norm=? AND at>=?', oid, phoneNorm, since).c;
    const dp = get('SELECT COUNT(DISTINCT project_id) c FROM enquiry_log WHERE org_id=? AND phone_norm=? AND at>=? AND project_id IS NOT NULL', oid, phoneNorm, since).c;
    if (dp >= 3) reason = `Same number enquired for ${dp} different projects within 24 hours`;
    else if (n >= 3) reason = `Same number submitted ${n} times within 24 hours`;
  }
  if (reason && l.flag_status !== 'pending') {
    run("UPDATE leads SET flag_status='pending', flag_reason=? WHERE id=?", reason, leadId);
    notifyAdmins(oid, 'Suspicious lead flagged', `${l.name} (${fmtPhone(phoneNorm)}): ${reason}`, `#/leads/${leadId}`);
  }
}
const logEnquiry = (oid, phoneNorm, projectId, source) =>
  run('INSERT INTO enquiry_log(org_id,phone_norm,project_id,source,at) VALUES (?,?,?,?,?)', oid, phoneNorm, projectId || null, source || null, now());

// ---------- assignment ----------
function assignLead(oid, leadId, repId, actor, { silent = false, reason = '' } = {}) {
  const l = get('SELECT * FROM leads WHERE id=? AND org_id=?', leadId, oid);
  if (!l) throw notFound('Lead not found');
  if (repId !== null && !activeMember(oid, repId)) throw bad('That team member is not active');
  run('UPDATE leads SET assigned_to=?, updated_at=? WHERE id=?', repId, now(), leadId);
  const who = repId ? get('SELECT name FROM users WHERE id=?', repId).name : 'Unassigned';
  logActivity(oid, leadId, actor ? actor.id : null, 'assign', { content: `Assigned to ${who}${reason ? ' — ' + reason : ''}` });
  if (repId && !silent && (!actor || actor.id !== repId)) notify(oid, { user: repId, title: 'New lead assigned', message: `${l.name} (${fmtPhone(l.phone_norm)}) was assigned to you`, link: `#/leads/${leadId}` });
}
function pickRep(oid, rule, reps) {
  const cap = getSettings(oid).max_open_leads_per_rep || 0;
  let cands = reps.filter((r) => !cap || openLeadCount(oid, r.id) < cap);
  if (!cands.length) return null;
  cands.sort((a, b) => a.id - b.id);
  if (rule.strategy === 'fair_workload') {
    return cands.map((r) => ({ r, n: openLeadCount(oid, r.id) })).sort((a, b) => a.n - b.n || a.r.id - b.r.id)[0].r;
  }
  if (rule.strategy === 'ai') {
    const since = addMs(-90 * 864e5);
    const scored = cands.map((r) => {
      const tot = get('SELECT COUNT(*) c FROM leads WHERE org_id=? AND assigned_to=? AND created_at>=?', oid, r.id, since).c;
      const won = get("SELECT COUNT(*) c FROM leads WHERE org_id=? AND assigned_to=? AND stage='Booked' AND created_at>=?", oid, r.id, since).c;
      const conv = (won + 1) / (tot + 5);
      return { r, s: 0.55 * conv * 5 + 0.45 / (1 + openLeadCount(oid, r.id)) };
    });
    return scored.sort((a, b) => b.s - a.s || a.r.id - b.r.id)[0].r;
  }
  const idx = rule.rr_pointer % cands.length; // round robin
  run('UPDATE assign_rules SET rr_pointer=? WHERE id=?', rule.rr_pointer + 1, rule.id);
  return cands[idx];
}
function autoAssign(oid, leadId, silent = false) {
  if (!getSettings(oid).auto_assign) return null;
  const l = get('SELECT * FROM leads WHERE id=? AND org_id=?', leadId, oid);
  const rules = all('SELECT * FROM assign_rules WHERE org_id=? AND active=1 ORDER BY position,id', oid);
  for (const rule of rules) {
    if (rule.source && rule.source.toLowerCase() !== (l.source || '').toLowerCase()) continue;
    if (rule.min_budget && (l.budget_max || l.budget_min || 0) < rule.min_budget) continue;
    if (rule.project_id && rule.project_id !== l.pref_project_id) continue;
    const ids = JSON.parse(rule.rep_ids || '[]');
    const reps = ids.map((id) => activeMember(oid, id)).filter(Boolean);
    const rep = pickRep(oid, rule, reps);
    if (rep) { assignLead(oid, leadId, rep.id, null, { silent, reason: `rule "${rule.name}"` }); return rep.id; }
  }
  return null;
}
/** Give `count` unassigned open leads to a rep. Returns the real number assigned. */
function distributeLeads(oid, repId, count, actor) {
  const leads = all("SELECT id FROM leads WHERE org_id=? AND assigned_to IS NULL AND stage NOT IN ('Booked','Lost') AND flag_status<>'spam' ORDER BY created_at LIMIT ?", oid, count);
  tx(() => leads.forEach((l) => assignLead(oid, l.id, repId, actor, { silent: true, reason: 'bulk distribution' })));
  if (leads.length) notify(oid, { user: repId, title: `${leads.length} new leads assigned`, message: `${leads.length} lead(s) were assigned to you`, link: '#/leads' });
  return leads.length;
}

// ---------- stage / automation ----------
function runAutomation(oid, lead, stage, actor) {
  const rules = all('SELECT * FROM automation_rules WHERE org_id=? AND active=1 AND trigger_stage=?', oid, stage);
  for (const r of rules) {
    if (r.create_task) {
      const owner = lead.assigned_to || (actor && actor.id) || null;
      run('INSERT INTO tasks(org_id,lead_id,title,description,due_at,priority,assigned_to,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
        oid, lead.id, r.task_title || `Follow up: ${lead.name}`, `Auto-created: lead moved to "${stage}"`, addMs((r.due_hours || 24) * 3600e3), 'Medium', owner, actor ? actor.id : null, now());
      logActivity(oid, lead.id, actor ? actor.id : null, 'system', { content: `Automation: follow-up task created (${stage})` });
      if (owner) notify(oid, { user: owner, title: 'Follow-up task created', message: `${r.task_title || 'Follow up'} — ${lead.name}`, link: `#/leads/${lead.id}` });
    }
    if (r.notify_admin) notifyAdmins(oid, `Lead moved to ${stage}`, `${lead.name} moved to "${stage}"`, `#/leads/${lead.id}`);
  }
}
function setStage(oid, leadId, stage, actor, { lost_reason, lost_note, allowBooked = false } = {}) {
  if (!STAGES.includes(stage)) throw bad('Invalid stage');
  const l = get('SELECT * FROM leads WHERE id=? AND org_id=?', leadId, oid);
  if (!l) throw notFound('Lead not found');
  if (stage === 'Booked' && !allowBooked) throw bad('Leads become "Booked" by creating a booking (pick the plot and payment plan).');
  if (l.stage === 'Booked' && stage !== 'Booked' && !allowBooked) throw bad('A booked lead cannot be moved. Cancel the booking first.');
  if (stage === 'Lost') {
    if (!LOST_REASONS.includes(lost_reason)) throw bad('Choose a valid lost reason');
    run('UPDATE leads SET stage=?, lost_reason=?, lost_note=?, lost_at=?, updated_at=? WHERE id=?', stage, lost_reason, str(lost_note), now(), now(), leadId);
    run("UPDATE plots SET status='available', hold_lead_id=NULL, hold_until=NULL, hold_by=NULL WHERE org_id=? AND hold_lead_id=? AND status='hold'", oid, leadId);
    run("UPDATE visits SET status='cancelled' WHERE org_id=? AND lead_id=? AND status='scheduled'", oid, leadId);
    logActivity(oid, leadId, actor.id, 'stage', { content: `Marked Lost — ${lost_reason}${lost_note ? ': ' + lost_note : ''}` });
  } else {
    run('UPDATE leads SET stage=?, lost_reason=NULL, lost_note=NULL, lost_at=NULL, updated_at=? WHERE id=?', stage, now(), leadId);
    logActivity(oid, leadId, actor.id, 'stage', { content: `Stage: ${l.stage} → ${stage}` });
  }
  rescore(oid, leadId);
  runAutomation(oid, { ...l, stage }, stage, actor);
}

// ---------- lead creation (manual / import / webhook / public form) ----------
const LEAD_TEXT = ['source', 'pref_facing', 'pref_location', 'purpose', 'notes'];
function createLead(oid, actor, d, opts = {}) {
  const name = str(d.name);
  if (!name) throw bad('Name is required');
  const pn = normPhone(d.phone);
  if (!pn) throw bad('Enter a valid Indian mobile number (10 digits, starting 6–9)');
  const email = d.email ? String(d.email).trim().toLowerCase() : null;
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw bad('Email format is invalid');
  const custom = cleanCustom(oid, d.custom, !opts.lenient);
  const projectId = d.pref_project_id ? Number(d.pref_project_id) : null;
  if (projectId && !get('SELECT 1 x FROM projects WHERE id=? AND org_id=?', projectId, oid)) throw bad('Preferred project not found');
  const dups = findDuplicates(oid, pn, email);
  if (dups.length && opts.intake) {
    const ex = get('SELECT * FROM leads WHERE id=?', dups[0].id);
    logEnquiry(oid, pn, projectId, d.source);
    logActivity(oid, ex.id, null, 'system', { content: `Repeat enquiry via ${d.source || 'intake'}${projectId ? ' for ' + get('SELECT name FROM projects WHERE id=?', projectId).name : ''}` });
    checkFlags(oid, ex.id, pn);
    if (ex.assigned_to) notify(oid, { user: ex.assigned_to, title: 'Repeat enquiry', message: `${ex.name} enquired again via ${d.source || 'intake'}`, link: `#/leads/${ex.id}` });
    return { lead: get('SELECT * FROM leads WHERE id=?', ex.id), created: false };
  }
  if (dups.length && !opts.force) throw new HttpError(409, 'Possible duplicate lead found', { duplicates: dups });
  let assigned = null;
  if (d.assigned_to) { if (!activeMember(oid, Number(d.assigned_to))) throw bad('Assigned rep not found'); assigned = Number(d.assigned_to); }
  else if (actor && actor.role === 'rep') assigned = actor.id;
  const t = now();
  const r = run(`INSERT INTO leads(org_id,name,phone,phone_norm,email,source,partner_id,stage,budget_min,budget_max,pref_size_min,pref_size_max,
    pref_facing,pref_location,pref_project_id,purpose,assigned_to,notes,custom,consent,created_by,created_at,updated_at,last_activity_at)
    VALUES (?,?,?,?,?,?,?,'New',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    oid, name, pn, pn, email, str(d.source) || 'Other', d.partner_id ? Number(d.partner_id) : null, num(d.budget_min), num(d.budget_max),
    num(d.pref_size_min), num(d.pref_size_max), str(d.pref_facing), str(d.pref_location), projectId, str(d.purpose), assigned, str(d.notes),
    JSON.stringify(custom), d.consent === false ? 0 : 1, actor ? actor.id : null, t, t, null);
  const id = Number(r.lastInsertRowid);
  logActivity(oid, id, actor ? actor.id : null, 'system', { content: `Lead created${d.source ? ' via ' + d.source : ''}${actor ? ' by ' + actor.name : ''}` });
  logEnquiry(oid, pn, projectId, d.source);
  if (assigned) {
    if (!opts.silent && (!actor || actor.id !== assigned)) notify(oid, { user: assigned, title: 'New lead assigned', message: `${name} (${fmtPhone(pn)}) was assigned to you`, link: `#/leads/${id}` });
  } else autoAssign(oid, id, opts.silent);
  checkFlags(oid, id, pn);
  rescore(oid, id);
  const lead = get('SELECT * FROM leads WHERE id=?', id);
  runAutomation(oid, lead, 'New', actor);
  return { lead: get('SELECT * FROM leads WHERE id=?', id), created: true };
}

// ---------- pricing & payments ----------
function priceFor(plot, project, discount = 0) {
  const area = Number(plot.area_sqyd), rate = Number(plot.rate_per_sqyd);
  const base = round(area * rate);
  const plc = round((base * (plot.plc_pct || 0)) / 100);
  const dev = round(area * (project.dev_charges_per_sqyd || 0));
  const reg = round((base * (project.registration_pct || 0)) / 100);
  const max_discount = round((base * (project.max_discount_pct || 0)) / 100);
  const d = Math.max(0, round(discount));
  return { area, rate, base, plc, dev, reg, discount: d, max_discount, total: base + plc + dev + reg - d };
}
function instStatus(i) { return i.paid_amount >= i.amount - 0.5 ? 'paid' : i.paid_amount > 0 ? 'partial' : 'pending'; }
function allocatePayment(oid, bookingId, paymentId, amount, installmentId) {
  let left = amount;
  const rows = installmentId
    ? all('SELECT * FROM installments WHERE id=? AND booking_id=? AND org_id=?', installmentId, bookingId, oid)
    : all('SELECT * FROM installments WHERE booking_id=? AND org_id=? AND paid_amount < amount - 0.5 ORDER BY seq', bookingId, oid);
  for (const i of rows) {
    const a = Math.min(i.amount - i.paid_amount, left);
    if (a <= 0) continue;
    const upd = { ...i, paid_amount: i.paid_amount + a };
    run('UPDATE installments SET paid_amount=?, status=? WHERE id=?', upd.paid_amount, instStatus(upd), i.id);
    run('INSERT INTO payment_alloc(payment_id,installment_id,amount) VALUES (?,?,?)', paymentId, i.id, a);
    left -= a;
    if (left <= 0.5) break;
  }
  return left;
}
function bookingSummary(oid, id) {
  const b = get('SELECT * FROM bookings WHERE id=? AND org_id=?', id, oid);
  if (!b) return null;
  const paid = get("SELECT COALESCE(SUM(amount),0) s FROM payments WHERE booking_id=? AND kind='receipt' AND voided=0", id).s;
  const today = istDate();
  const overdue = get("SELECT COALESCE(SUM(amount-paid_amount),0) s, COUNT(*) c FROM installments WHERE booking_id=? AND due_date<? AND paid_amount<amount-0.5", id, today);
  const next = get('SELECT label,due_date,amount-paid_amount AS due FROM installments WHERE booking_id=? AND paid_amount<amount-0.5 ORDER BY seq LIMIT 1', id);
  return { paid, outstanding: b.status === 'cancelled' ? 0 : Math.max(0, b.total - paid), overdue_amount: b.status === 'cancelled' ? 0 : overdue.s, overdue_count: b.status === 'cancelled' ? 0 : overdue.c, next_due: b.status === 'cancelled' ? null : next };
}
function nextNo(oid, prefix, table, col) {
  const y = new Date().getFullYear();
  const n = get(`SELECT COUNT(*) c FROM ${table} WHERE org_id=?`, oid).c + 1;
  let no = `${prefix}-${y}-${String(n).padStart(4, '0')}`, k = n;
  while (get(`SELECT 1 x FROM ${table} WHERE org_id=? AND ${col}=?`, oid, no)) no = `${prefix}-${y}-${String(++k).padStart(4, '0')}`;
  return no;
}

module.exports = {
  HttpError, bad, forbidden, notFound, STAGES, OPEN_STAGES, LOST_REASONS, SOURCES, now, addMs, sha, newToken, hashPw, checkPw,
  round, num, str, normPhone, fmtPhone, period, dayRange, istDate, haversine, parseUA, parseCsv, toCsv, parseXlsx,
  getOrg, getSettings, saveSettings, notify, notifyAdmins, audit, logActivity, rescore, activeMember, repHealth, openLeadCount,
  cleanCustom, findDuplicates, checkFlags, logEnquiry, assignLead, autoAssign, distributeLeads, runAutomation, setStage,
  createLead, priceFor, instStatus, allocatePayment, bookingSummary, nextNo, LEAD_TEXT,
};
