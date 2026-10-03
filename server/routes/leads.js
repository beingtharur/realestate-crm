// Leads: list / create / update / stage / assign / delete, duplicates, spam review, import, saved filters, public intake.
const fs = require('fs');
const { r } = require('../router');
const { all, get, run, tx } = require('../db');
const L = require('../lib');
const { readTable } = require('../files');
const { HttpError, bad, forbidden, notFound, now, str, num, newToken, addMs } = L;

function leadFor(ctx, id) {
  const l = get('SELECT * FROM leads WHERE id=? AND org_id=?', Number(id), ctx.oid);
  if (!l || (!ctx.isAdmin && l.assigned_to !== ctx.user.id)) throw notFound('Lead not found');
  return l;
}
const parseLead = (l) => ({ ...l, custom: JSON.parse(l.custom || '{}') });
const LIST_SQL = `SELECT l.*, u.name AS rep_name, pr.name AS project_name, pa.name AS partner_name,
  (SELECT MIN(due_at) FROM tasks t WHERE t.lead_id=l.id AND t.status='open') AS next_due,
  (SELECT MAX(a.created_at) FROM activities a WHERE a.lead_id=l.id AND a.type IN ('call','whatsapp') AND COALESCE(a.outcome,'')<>'Initiated') AS last_contacted,
  (SELECT COUNT(*) FROM bookings b WHERE b.lead_id=l.id AND b.status<>'cancelled') AS booking_count
  FROM leads l LEFT JOIN users u ON u.id=l.assigned_to LEFT JOIN projects pr ON pr.id=l.pref_project_id LEFT JOIN partners pa ON pa.id=l.partner_id WHERE l.org_id=?`;

r.get('/api/leads', (ctx) => {
  const q = ctx.query; const a = [ctx.oid]; let sql = LIST_SQL;
  if (!ctx.isAdmin) { sql += ' AND l.assigned_to=?'; a.push(ctx.user.id); }
  else if (q.assigned === 'unassigned') sql += ' AND l.assigned_to IS NULL';
  else if (q.assigned) { sql += ' AND l.assigned_to=?'; a.push(Number(q.assigned)); }
  if (q.stage) { sql += ' AND l.stage=?'; a.push(q.stage); }
  if (q.rating) { sql += ' AND l.rating=?'; a.push(q.rating); }
  if (q.source) { sql += ' AND l.source=?'; a.push(q.source); }
  if (q.project_id) { sql += ' AND l.pref_project_id=?'; a.push(Number(q.project_id)); }
  if (q.partner_id) { sql += ' AND l.partner_id=?'; a.push(Number(q.partner_id)); }
  if (q.flag === 'pending') sql += " AND l.flag_status IN ('pending','spam')";
  if (q.dup === 'reported') sql += " AND l.dup_status='reported'";
  if (q.open === '1') sql += " AND l.stage NOT IN ('Booked','Lost')";
  if (q.uncontacted === '1') sql += " AND l.stage='New' AND l.last_activity_at IS NULL AND l.flag_status<>'spam'";
  if (q.cooling === '1') { sql += " AND l.rating='Hot' AND l.stage NOT IN ('Booked','Lost') AND COALESCE(l.last_activity_at,l.created_at)<?"; a.push(L.addMs(-48 * 3600e3)); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(q.from || '')) { sql += ' AND l.created_at>=?'; a.push(L.dayRange(q.from).from); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(q.to || '')) { sql += ' AND l.created_at<?'; a.push(L.dayRange(q.to).to); }
  if (q.q) {
    const t = `%${String(q.q).trim()}%`, digits = `%${String(q.q).replace(/\D/g, '')}%`;
    sql += ' AND (l.name LIKE ? OR l.email LIKE ? OR l.phone_norm LIKE ?)'; a.push(t, t, digits.length > 2 ? digits : '%__none__%');
  }
  sql += q.stage === 'Lost' ? ' ORDER BY l.lost_at DESC' : ' ORDER BY l.updated_at DESC';
  sql += ' LIMIT ?'; a.push(Math.min(Number(q.limit) || 1000, 3000));
  let rows = all(sql, ...a).map(parseLead);
  if (q.followup) { // overdue | today | upcoming | none — based on the lead's earliest open follow-up
    const now = Date.now(), eod = Date.parse(L.dayRange(L.istDate()).to);
    rows = rows.filter((l) => (q.followup === 'none' ? !l.next_due : l.next_due && (q.followup === 'overdue' ? Date.parse(l.next_due) < now : q.followup === 'today' ? Date.parse(l.next_due) >= now && Date.parse(l.next_due) < eod : Date.parse(l.next_due) >= eod)));
  }
  return rows;
});
/** Change the stage of many leads at once. Reps can only touch their own leads. "Booked" still needs a booking. */
r.post('/api/leads/bulk-stage', (ctx) => {
  const ids = (ctx.body.ids || []).map(Number).filter(Boolean).slice(0, 500), stage = ctx.body.stage;
  if (!ids.length) throw bad('Select at least one lead');
  if (!L.STAGES.includes(stage)) throw bad('Choose a stage');
  if (stage === 'Booked') throw bad('Leads become "Booked" by creating a booking.');
  if (stage === 'Lost' && !L.LOST_REASONS.includes(ctx.body.lost_reason)) throw bad('Choose a lost reason');
  let updated = 0; const skipped = [];
  tx(() => ids.forEach((id) => {
    const l = get('SELECT * FROM leads WHERE id=? AND org_id=?', id, ctx.oid);
    if (!l || (!ctx.isAdmin && l.assigned_to !== ctx.user.id)) return skipped.push({ id, reason: 'Not your lead' });
    if (l.stage === 'Booked') return skipped.push({ id, name: l.name, reason: 'Already booked' });
    if (l.stage === stage) return;
    L.setStage(ctx.oid, id, stage, ctx.user, { lost_reason: ctx.body.lost_reason, lost_note: ctx.body.lost_note }); updated++;
  }));
  return { updated, skipped };
});

r.post('/api/leads/check-duplicate', (ctx) => {
  const pn = L.normPhone(ctx.body.phone);
  const dups = L.findDuplicates(ctx.oid, pn, ctx.body.email, Number(ctx.body.exclude_id) || 0);
  // Reps see that a duplicate exists (to avoid double work) but only names of leads that are theirs are linkable
  return { duplicates: dups.map((d) => ({ id: d.id, name: d.name, stage: d.stage, rep_name: d.rep_name, mine: ctx.isAdmin || d.assigned_to === ctx.user.id })) };
});

r.post('/api/leads', (ctx) => {
  if (!ctx.isAdmin && !L.getSettings(ctx.oid).reps_can_create_leads) throw forbidden('Your admin has not enabled lead creation for reps');
  const d = { ...ctx.body };
  if (!ctx.isAdmin) delete d.assigned_to;
  const { lead, created } = L.createLead(ctx.oid, ctx.user, d, { force: !!ctx.body.force });
  return { id: lead.id, created };
});

r.get('/api/leads/:id', (ctx) => {
  const l = leadFor(ctx, ctx.params.id);
  const lead = parseLead(get(LIST_SQL + ' AND l.id=?', ctx.oid, l.id));
  const timeline = all(`SELECT a.*, u.name AS user_name FROM activities a LEFT JOIN users u ON u.id=a.user_id WHERE a.org_id=? AND a.lead_id=? ORDER BY a.created_at DESC, a.id DESC LIMIT 300`, ctx.oid, l.id)
    .map((x) => ({ ...x, meta: x.meta ? JSON.parse(x.meta) : null }));
  const bookings = all(`SELECT b.*, pl.plot_no, pr.name AS project_name FROM bookings b JOIN plots pl ON pl.id=b.plot_id JOIN projects pr ON pr.id=b.project_id WHERE b.org_id=? AND b.lead_id=? ORDER BY b.id DESC`, ctx.oid, l.id)
    .map((b) => (ctx.isAdmin ? { ...b, ...L.bookingSummary(ctx.oid, b.id) } : { id: b.id, booking_no: b.booking_no, status: b.status, total: b.total - 0, plot_no: b.plot_no, project_name: b.project_name, booked_on: b.booked_on }));
  return {
    lead,
    duplicates: L.findDuplicates(ctx.oid, l.phone_norm, l.email, l.id).map((d) => ({ id: d.id, name: d.name, stage: d.stage, rep_name: d.rep_name })),
    timeline,
    tasks: all('SELECT t.*, u.name AS assignee FROM tasks t LEFT JOIN users u ON u.id=t.assigned_to WHERE t.org_id=? AND t.lead_id=? ORDER BY t.status, t.due_at', ctx.oid, l.id),
    visits: all(`SELECT v.*, pr.name AS project_name, pl.plot_no FROM visits v JOIN projects pr ON pr.id=v.project_id LEFT JOIN plots pl ON pl.id=v.plot_id WHERE v.org_id=? AND v.lead_id=? ORDER BY v.scheduled_at DESC`, ctx.oid, l.id),
    bookings,
    kyc: all('SELECT id,doc_type,filename,status,remark,uploaded_at FROM kyc_docs WHERE org_id=? AND lead_id=? ORDER BY id DESC', ctx.oid, l.id),
    holds: all("SELECT pl.id, pl.plot_no, pl.hold_until, pr.name AS project_name FROM plots pl JOIN projects pr ON pr.id=pl.project_id WHERE pl.org_id=? AND pl.hold_lead_id=? AND pl.status='hold'", ctx.oid, l.id),
    discounts: ctx.isAdmin ? all('SELECT d.*, pl.plot_no FROM discount_requests d JOIN plots pl ON pl.id=d.plot_id WHERE d.org_id=? AND d.lead_id=? ORDER BY d.id DESC', ctx.oid, l.id) : [],
    next_action: require('../nba').nextAction(ctx.oid, l),
    portal_status: !l.portal_token ? 'Pending Portal Link' : l.portal_expires < now() ? 'Portal Link Expired' : 'Portal Link Sent',
  };
});

r.patch('/api/leads/:id', (ctx) => {
  const l = leadFor(ctx, ctx.params.id), b = ctx.body;
  let pn = l.phone_norm;
  if ('phone' in b) { pn = L.normPhone(b.phone); if (!pn) throw bad('Enter a valid Indian mobile number'); }
  const email = 'email' in b ? (b.email ? String(b.email).trim().toLowerCase() : null) : l.email;
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw bad('Email format is invalid');
  if ((pn !== l.phone_norm || email !== l.email) && !b.force) {
    const dups = L.findDuplicates(ctx.oid, pn, email, l.id);
    if (dups.length) throw new HttpError(409, 'Another lead already has this phone/email', { duplicates: dups });
  }
  const custom = 'custom' in b ? L.cleanCustom(ctx.oid, { ...JSON.parse(l.custom || '{}'), ...b.custom }, true) : JSON.parse(l.custom || '{}');
  const pick = (k) => (k in b ? b[k] : l[k]);
  const name = str(pick('name')); if (!name) throw bad('Name is required');
  const pid = pick('pref_project_id') ? Number(pick('pref_project_id')) : null;
  let rating = l.rating, manual = l.rating_manual;
  if ('rating' in b) { if (b.rating === 'auto') manual = 0; else if (['Hot', 'Warm', 'Cold'].includes(b.rating)) { rating = b.rating; manual = 1; } }
  run(`UPDATE leads SET name=?,phone=?,phone_norm=?,email=?,source=?,partner_id=?,budget_min=?,budget_max=?,pref_size_min=?,pref_size_max=?,pref_facing=?,pref_location=?,pref_project_id=?,
    purpose=?,notes=?,custom=?,rating=?,rating_manual=?,updated_at=? WHERE id=?`,
    name, pn, pn, email, str(pick('source')), pick('partner_id') ? Number(pick('partner_id')) : null, num(pick('budget_min')), num(pick('budget_max')), num(pick('pref_size_min')), num(pick('pref_size_max')),
    str(pick('pref_facing')), str(pick('pref_location')), pid, str(pick('purpose')), str(pick('notes')), JSON.stringify(custom), rating, manual, now(), l.id);
  L.logActivity(ctx.oid, l.id, ctx.user.id, 'system', { content: 'Lead details updated' });
  L.rescore(ctx.oid, l.id);
  return { ok: true };
});

r.post('/api/leads/:id/stage', (ctx) => {
  const l = leadFor(ctx, ctx.params.id);
  L.setStage(ctx.oid, l.id, ctx.body.stage, ctx.user, { lost_reason: ctx.body.lost_reason, lost_note: ctx.body.lost_note });
  return { ok: true };
});
r.post('/api/leads/:id/assign', { admin: true }, (ctx) => {
  leadFor(ctx, ctx.params.id);
  L.assignLead(ctx.oid, Number(ctx.params.id), ctx.body.rep_id ? Number(ctx.body.rep_id) : null, ctx.user);
  return { ok: true };
});
r.post('/api/leads/bulk-assign', { admin: true }, (ctx) => {
  const ids = (ctx.body.ids || []).map(Number), rep = Number(ctx.body.rep_id);
  if (!ids.length) throw bad('Select at least one lead');
  if (!L.activeMember(ctx.oid, rep)) throw bad('Choose an active team member');
  let n = 0;
  tx(() => ids.forEach((id) => { if (get('SELECT 1 x FROM leads WHERE id=? AND org_id=?', id, ctx.oid)) { L.assignLead(ctx.oid, id, rep, ctx.user, { silent: true }); n++; } }));
  L.notify(ctx.oid, { user: rep, title: `${n} leads assigned to you`, message: `${ctx.user.name} assigned ${n} lead(s) to you`, link: '#/leads' });
  return { assigned: n };
});
r.post('/api/leads/:id/notes', (ctx) => {
  const l = leadFor(ctx, ctx.params.id);
  const c = str(ctx.body.content); if (!c) throw bad('Write a note first');
  L.logActivity(ctx.oid, l.id, ctx.user.id, 'note', { content: c });
  L.rescore(ctx.oid, l.id);
  return { ok: true };
});

// ----- delete (admin) / report duplicate (rep) -----
function deleteLeads(ctx, ids) {
  const done = []; const blocked = [];
  tx(() => ids.forEach((id) => {
    const l = get('SELECT * FROM leads WHERE id=? AND org_id=?', id, ctx.oid);
    if (!l) return;
    if (get('SELECT 1 x FROM bookings WHERE lead_id=?', id)) { blocked.push(l.name); return; }
    for (const d of all('SELECT path FROM kyc_docs WHERE lead_id=? AND org_id=?', id, ctx.oid)) { try { fs.unlinkSync(d.path); } catch { /* already gone */ } }
    run("UPDATE plots SET status='available', hold_lead_id=NULL, hold_until=NULL, hold_by=NULL WHERE org_id=? AND hold_lead_id=? AND status='hold'", ctx.oid, id);
    for (const t of ['activities', 'tasks', 'visits', 'kyc_docs', 'discount_requests']) run(`DELETE FROM ${t} WHERE lead_id=? AND org_id=?`, id, ctx.oid);
    run('UPDATE webhook_events SET lead_id=NULL, matched=0 WHERE lead_id=? AND org_id=?', id, ctx.oid);
    run('DELETE FROM leads WHERE id=?', id);
    done.push(id);
  }));
  L.audit(ctx.oid, ctx.user.id, 'lead.delete', 'lead', null, `${done.length} lead(s)`);
  return { deleted: done.length, blocked };
}
r.del('/api/leads/:id', { admin: true }, (ctx) => {
  const out = deleteLeads(ctx, [Number(ctx.params.id)]);
  if (out.blocked.length) throw bad('This lead has booking records and cannot be deleted.');
  return out;
});
r.post('/api/leads/bulk-delete', { admin: true }, (ctx) => {
  const ids = (ctx.body.ids || []).map(Number);
  if (!ids.length) throw bad('Select at least one lead');
  return deleteLeads(ctx, ids);
});
r.post('/api/leads/:id/report-duplicate', (ctx) => {
  const l = leadFor(ctx, ctx.params.id);
  run("UPDATE leads SET dup_reported=1, dup_status='reported', dup_note=?, dup_reported_by=? WHERE id=?", str(ctx.body.note), ctx.user.id, l.id);
  L.logActivity(ctx.oid, l.id, ctx.user.id, 'system', { content: `Reported as duplicate by ${ctx.user.name}${ctx.body.note ? ': ' + ctx.body.note : ''}` });
  L.notifyAdmins(ctx.oid, 'Duplicate reported', `${ctx.user.name} reported "${l.name}" as a duplicate${ctx.body.note ? ': ' + ctx.body.note : ''}`, `#/leads/${l.id}`);
  return { ok: true };
});
r.post('/api/leads/:id/duplicate-review', { admin: true }, (ctx) => {
  const l = leadFor(ctx, ctx.params.id);
  run("UPDATE leads SET dup_status='reviewed' WHERE id=?", l.id);
  L.logActivity(ctx.oid, l.id, ctx.user.id, 'system', { content: 'Duplicate report reviewed — not a duplicate' });
  return { ok: true };
});

// ----- spam / fraud review -----
r.post('/api/leads/:id/flag-decision', { admin: true }, (ctx) => {
  const l = leadFor(ctx, ctx.params.id);
  if (ctx.body.decision === 'genuine') {
    run("UPDATE leads SET flag_status='genuine' WHERE id=?", l.id);
    L.logActivity(ctx.oid, l.id, ctx.user.id, 'system', { content: 'Reviewed and marked genuine' });
  } else if (ctx.body.decision === 'spam') {
    run("UPDATE leads SET flag_status='spam' WHERE id=?", l.id);
    run('INSERT OR IGNORE INTO spam_numbers(org_id,phone_norm) VALUES (?,?)', ctx.oid, l.phone_norm);
    if (l.stage !== 'Lost' && l.stage !== 'Booked') L.setStage(ctx.oid, l.id, 'Lost', ctx.user, { lost_reason: 'Wrong Number / Invalid Lead', lost_note: 'Marked as spam' });
    L.logActivity(ctx.oid, l.id, ctx.user.id, 'system', { content: 'Marked as spam — number blacklisted' });
  } else throw bad('Decision must be genuine or spam');
  return { ok: true };
});

// ----- portal link -----
r.post('/api/leads/:id/portal-link', (ctx) => {
  const l = leadFor(ctx, ctx.params.id);
  const token = newToken(20);
  run('UPDATE leads SET portal_token=?, portal_expires=? WHERE id=?', token, addMs(L.getSettings(ctx.oid).portal_days * 864e5), l.id);
  L.logActivity(ctx.oid, l.id, ctx.user.id, 'system', { content: 'Client booking portal link generated' });
  return { link: `#/portal/${token}` };
});

// ----- saved filters -----
r.get('/api/filters', (ctx) => all('SELECT id,name,filters FROM saved_filters WHERE org_id=? AND user_id=? ORDER BY id', ctx.oid, ctx.user.id).map((f) => ({ ...f, filters: JSON.parse(f.filters) })));
r.post('/api/filters', (ctx) => {
  const name = str(ctx.body.name); if (!name) throw bad('Give the filter a name');
  const x = run('INSERT INTO saved_filters(org_id,user_id,name,filters) VALUES (?,?,?,?)', ctx.oid, ctx.user.id, name, ctx.body.filters || {});
  return { id: Number(x.lastInsertRowid) };
});
r.del('/api/filters/:id', (ctx) => { run('DELETE FROM saved_filters WHERE id=? AND user_id=?', ctx.params.id, ctx.user.id); return { ok: true }; });

// ----- bulk import (admin): CSV / .xlsx / .xls / PDF → map columns → preview → commit -----
const ALIASES = {
  name: ['name', 'full_name', 'fullname', 'customer', 'customer_name', 'lead_name', 'client', 'client_name', 'contact_name', 'contact_person'],
  phone: ['phone', 'mobile', 'mobile_no', 'mobile_number', 'phone_number', 'phone_no', 'contact', 'contact_no', 'contact_number', 'whatsapp', 'whatsapp_no', 'cell', 'number', 'mob', 'mob_no'],
  email: ['email', 'email_id', 'e_mail', 'mail', 'email_address'],
  source: ['source', 'lead_source', 'channel'],
  budget_min: ['budget_min', 'min_budget'],
  budget_max: ['budget_max', 'max_budget', 'budget'],
  pref_size: ['size', 'plot_size', 'preferred_size', 'area', 'sq_yd', 'sqyd', 'sq_yards'],
  pref_facing: ['facing', 'preferred_facing'],
  pref_location: ['location', 'preferred_location', 'area_preference', 'city', 'locality'],
  project: ['project', 'preferred_project', 'project_name', 'layout'],
  purpose: ['purpose', 'buying_purpose'],
  notes: ['notes', 'note', 'remarks', 'remark', 'comment', 'comments', 'requirement', 'message'],
  rep: ['rep', 'assigned_to', 'assigned', 'owner', 'sales_rep', 'executive'],
};
const FIELD_LABELS = { name: 'Name', phone: 'Phone', email: 'Email', source: 'Source', budget_min: 'Budget (min)', budget_max: 'Budget (max)', pref_size: 'Plot size (sq.yd)',
  pref_facing: 'Facing', pref_location: 'Location', project: 'Project', purpose: 'Purpose', notes: 'Notes', rep: 'Assigned rep' };
const FACINGS = ['East', 'West', 'North', 'South', 'North-East', 'North-West', 'South-East', 'South-West'];
const slug = (h) => String(h).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const squash = (v) => String(v).toLowerCase().replace(/[^a-z0-9]/g, '');

// --- value normalisers ---
/** First valid Indian mobile in a cell — cells often hold "98765 43210 / 98450 12345", "Ph: +91-98765-43210" or "9876543210.0". */
function pickPhone(v) {
  const whole = L.normPhone(v);
  if (whole) return whole;
  for (const m of String(v).replace(/(\d)\.0+(?!\d)/g, '$1').match(/(?:\+?91[\s-]?|0)?[6-9](?:[\s-]?\d){9}(?!\d)/g) || []) { const p = L.normPhone(m); if (p) return p; }
  return null;
}
/** Spreadsheet exports are full of placeholders for "nothing here" — treat them all as blank. */
const NULLISH = /^(null|nil|none|n\/?a|na|nan|undefined|not available|not provided|unknown|tbd|\?+|-+|—+|–+|\.+|\/+|0)$/i;
const blank = (v) => { const t = String(v ?? '').replace(/\s+/g, ' ').trim(); return NULLISH.test(t) ? '' : t; };
/** "35 L", "1.2 cr", "₹35,00,000", "30-40 lakhs" → [min, max] in rupees (either may be null). */
function moneyRange(v) {
  const text = String(v).toLowerCase().replace(/[₹,]|rs\.?|inr/g, ' ');
  const unit = /cr/.test(text) ? 1e7 : /(^|[\d\s])(l|lac|lacs|lakh|lakhs)\b/.test(text) ? 1e5 : /(^|[\d\s])k\b|thousand/.test(text) ? 1e3 : 1;
  const nums = (text.match(/\d+(?:\.\d+)?/g) || []).map((n) => Math.round(Number(n) * unit)).filter((n) => n > 0);
  return nums.length >= 2 ? [Math.min(nums[0], nums[1]), Math.max(nums[0], nums[1])] : nums.length ? [null, nums[0]] : [null, null];
}
function sizeRange(v) {
  const nums = (String(v).replace(/,/g, '').match(/\d+(?:\.\d+)?/g) || []).map(Number).filter((n) => n > 0);
  return nums.length >= 2 ? [Math.min(nums[0], nums[1]), Math.max(nums[0], nums[1])] : nums.length ? [nums[0], nums[0]] : [null, null];
}
const canon = (list, v) => list.find((x) => squash(x) === squash(v)) || null;

// Parsed uploads are kept briefly so the user can change the column mapping without uploading again.
const uploads = new Map();
function remember(entry) {
  for (const [k, u] of uploads) if (Date.now() - u.at > 30 * 60000) uploads.delete(k);
  if (uploads.size >= 30) uploads.delete(uploads.keys().next().value);
  const id = newToken(8); uploads.set(id, { ...entry, at: Date.now() }); return id;
}
// Looser header matching for headers that are not in ALIASES ("Mob. No.", "Client Details", "Enquiry From"…).
// Tried in this order; a column is only claimed once.
const FUZZY = [
  ['phone', /(phone|mobile|\bmob\b|whats?app|contact ?(no|num)|\bcell\b|\btel\b|telephone|\bcontact\b|number|\bno\b\.?$)/, /(plot|s\.? ?no|sr\.? ?no|serial|row|\bid\b|alt|alternate|secondary|landline|office)/],
  ['email', /(e-?mail|mail ?id)/],
  ['source', /(source|channel|medium|campaign|enquiry (from|via)|inquiry (from|via)|referr|how did)/],
  ['project', /(project|layout|venture|scheme)/],
  ['rep', /(\brep\b|assigned|owner|executive|sales ?person|\bagent\b|handled by)/],
  ['pref_facing', /(facing|direction)/],
  ['pref_size', /(size|sq\.? ?y|yards?|\bgaj\b|plot area)/],
  ['budget_max', /(budget|price|affordab|ticket)/],
  ['purpose', /(purpose|buying for|intent)/],
  ['pref_location', /(location|locality|town|city|place|\barea\b|address|region)/],
  ['notes', /(note|remark|comment|requirement|message|query|additional (info|detail)|feedback|status)/],
  ['name', /(name|customer|client|lead|person|party)/, /(project|rep\b|owner|source|assigned|company|father|spouse|alt)/],
];
const looksPhone = (v) => !!pickPhone(blank(v));
const looksEmail = (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(blank(v));
const looksName = (v) => { const t = blank(v); return t.length >= 2 && t.length <= 50 && !/\d{4,}/.test(t) && !t.includes('@') && (t.match(/[A-Za-zऀ-෿]/g) || []).length / t.length > 0.6; };
function autoMap(heads, cfs, table = []) {
  const keys = heads.map(slug), map = {}, used = new Set();
  const claim = (k, i) => { if (i >= 0 && !used.has(i) && !(k in map)) { map[k] = i; used.add(i); } };
  for (const [k, names] of Object.entries(ALIASES)) claim(k, keys.findIndex((h, i) => names.includes(h) && !used.has(i)));
  for (const f of cfs) claim('cf_' + f.id, keys.findIndex((h, i) => h === slug(f.label) && !used.has(i)));
  for (const [k, re, not] of FUZZY) {
    if (k in map) continue;
    claim(k, heads.findIndex((h, i) => !used.has(i) && re.test(String(h).toLowerCase()) && !(not && not.test(String(h).toLowerCase()))));
  }
  // Still nothing? Look at what the columns actually contain.
  const sample = table.slice(1, 120).filter((r) => r.some(Boolean));
  const share = (i, test) => { const vals = sample.map((r) => blank(r[i])).filter(Boolean); return vals.length ? vals.filter(test).length / vals.length : 0; };
  const cols = heads.map((_, i) => i).filter((i) => !used.has(i));
  if (!('phone' in map)) claim('phone', cols.map((i) => [i, share(i, looksPhone)]).filter(([, p]) => p >= 0.5).sort((a, b) => b[1] - a[1])[0]?.[0] ?? -1);
  if (!('email' in map)) claim('email', cols.map((i) => [i, share(i, looksEmail)]).filter(([, p]) => p >= 0.5).sort((a, b) => b[1] - a[1])[0]?.[0] ?? -1);
  if (!('source' in map)) claim('source', cols.map((i) => [i, share(i, (v) => !!canon(L.SOURCES, v) && v.toLowerCase() !== 'other')]).filter(([, p]) => p >= 0.5).sort((x, y) => y[1] - x[1])[0]?.[0] ?? -1);
  if (!('name' in map)) claim('name', cols.find((i) => !used.has(i) && share(i, looksName) >= 0.7) ?? -1);
  return map;
}
/** Turn the raw table into normalised lead rows, each marked valid / duplicate / invalid. Missing optional values are fine. */
function analyse(oid, table, mapping, defSource, offset = 0, extras = true) {
  const cfs = all('SELECT * FROM custom_fields WHERE org_id=?', oid);
  const projects = all('SELECT id,name FROM projects WHERE org_id=?', oid), users = all("SELECT id,name,email FROM users WHERE org_id=? AND status='active'", oid);
  const heads = table[0], mapped = new Set(Object.values(mapping));
  const seenPhone = new Map(), seenEmail = new Map(), out = [];
  table.slice(1).forEach((row, i) => {
    if (!row.some((c) => blank(c))) return; // empty or placeholder-only row
    const g = (k) => (mapping[k] !== undefined ? blank(row[mapping[k]]) : '');
    const warnings = [];
    const d = { name: g('name'), phone: g('phone'), email: g('email').toLowerCase(), notes: g('notes'), pref_location: g('pref_location'), purpose: g('purpose') };
    d.source = canon(L.SOURCES, g('source')) || g('source') || defSource;
    d.pref_facing = canon(FACINGS, g('pref_facing')) || '';
    const [bMin, bMax] = moneyRange(g('budget_max')); d.budget_max = bMax; d.budget_min = moneyRange(g('budget_min'))[1] ?? bMin;
    const [sMin, sMax] = sizeRange(g('pref_size')); if (sMin) { d.pref_size_min = sMin; d.pref_size_max = sMax; }
    const pj = g('project') && projects.find((p) => squash(p.name) === squash(g('project'))); if (pj) d.pref_project_id = pj.id;
    const rp = g('rep').toLowerCase(); if (rp) { const u = users.find((x) => x.email.toLowerCase() === rp || x.name.toLowerCase() === rp); if (u) d.assigned_to = u.id; }
    const custom = {}; cfs.forEach((f) => { const v = g('cf_' + f.id); if (v) custom[f.id] = f.type === 'checkbox' ? /^(y|yes|true|1)$/i.test(v) : v; });
    if (Object.keys(custom).length) d.custom = custom;
    // phone: the mapped cell first, then any other cell in the row that holds a mobile number
    let pn = pickPhone(d.phone);
    if (!pn) {
      const typed = new Set(['budget_min', 'budget_max', 'pref_size', 'project', 'rep'].map((k) => mapping[k]).concat(Object.entries(mapping).filter(([k]) => k.startsWith('cf_')).map(([, v]) => v)));
      const alt = row.findIndex((c, k) => k !== mapping.phone && !typed.has(k) && looksPhone(c));
      if (alt >= 0) { pn = pickPhone(blank(row[alt])); warnings.push(`Phone taken from "${heads[alt] || 'column ' + (alt + 1)}"`); }
    }
    if (!d.email) { const alt = row.findIndex((c, k) => !mapped.has(k) && looksEmail(c)); if (alt >= 0) d.email = blank(row[alt]).toLowerCase(); }
    if (extras) { // columns we could not map are kept as notes instead of being thrown away
      const more = row.map((c, k) => (mapped.has(k) || !blank(c) ? '' : `${heads[k] && !/^Column \d+$/.test(heads[k]) ? heads[k] : 'Info'}: ${blank(c)}`)).filter(Boolean);
      if (more.length) d.notes = [d.notes, ...more].filter(Boolean).join(' · ').slice(0, 1000);
    }
    const invalid = [];
    if (!pn) invalid.push(blank(row[mapping.phone]) ? 'No valid mobile number' : d.phone ? 'Invalid phone number' : 'Phone is missing');
    if (d.email && pickPhone(d.email) === pn) d.email = ''; // a phone number that landed in the email column
    if (d.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email)) { warnings.push(`Email "${d.email}" is not valid and was left out`); d.email = ''; }
    if (!d.name && pn) { d.name = d.email ? d.email.split('@')[0].replace(/[._\-\d]+/g, ' ').trim().replace(/\b\w/g, (c) => c.toUpperCase()) || `Lead ${pn.slice(-4)}` : `Lead ${pn.slice(-4)}`; warnings.push(`No name — saved as "${d.name}"`); }
    let status = 'valid', reasons = invalid, dup_of = null;
    if (invalid.length) status = 'invalid';
    else {
      const inFile = seenPhone.get(pn) || (d.email && seenEmail.get(d.email));
      if (inFile) { status = 'duplicate'; reasons = [`Same ${seenPhone.has(pn) ? 'phone' : 'email'} as row ${inFile} in this file`]; }
      else {
        const ex = L.findDuplicates(oid, pn, d.email);
        if (ex.length) { status = 'duplicate'; dup_of = ex[0].id; reasons = [`Already in CRM as "${ex[0].name}" (${ex[0].stage}${ex[0].rep_name ? ', ' + ex[0].rep_name : ''})`]; }
      }
      if (!seenPhone.has(pn)) seenPhone.set(pn, i + 2 + offset);
      if (d.email && !seenEmail.has(d.email)) seenEmail.set(d.email, i + 2 + offset);
      d.phone = pn;
    }
    out.push({ row: i + 2 + offset, data: d, status, errors: reasons, warnings: status === 'valid' ? warnings : [], dup_of });
  });
  return out;
}
r.post('/api/leads/import/preview', { admin: true }, async (ctx) => {
  const b = ctx.body;
  let up = b.upload_id ? uploads.get(b.upload_id) : null;
  if (b.upload_id && (!up || up.oid !== ctx.oid)) throw bad('This upload has expired. Please choose the file again.');
  let id = b.upload_id;
  if (!up) {
    // file_base64 is the normal path; `rows` (already-parsed table) is kept for API clients
    const parsed = b.file_base64 ? await readTable(Buffer.from(b.file_base64, 'base64'), b.filename) : { kind: 'rows', rows: b.rows || [], note: '' };
    if (parsed.rows.length < 2) throw bad('The file has no data rows');
    up = { oid: ctx.oid, table: parsed.rows, offset: parsed.offset || 0, kind: parsed.kind, note: parsed.note, filename: str(b.filename) || 'upload' };
    id = remember(up);
  }
  const cfs = all('SELECT * FROM custom_fields WHERE org_id=? ORDER BY position,id', ctx.oid);
  const heads = up.table[0];
  const mapping = b.mapping && typeof b.mapping === 'object'
    ? Object.fromEntries(Object.entries(b.mapping).filter(([k, v]) => (k in FIELD_LABELS || /^cf_\d+$/.test(k)) && Number.isInteger(v) && v >= 0 && v < heads.length))
    : autoMap(heads, cfs, up.table);
  if (mapping.phone === undefined) {
    if (!b.mapping) { // could not recognise the headers — let the user map them
      return { upload_id: id, filename: up.filename, kind: up.kind, note: up.note, needs_mapping: true, mapping, rows: [], total: 0, valid: 0, duplicates: 0, invalid: 0, to_import: 0,
        columns: heads.map((h, i) => ({ index: i, header: h, samples: up.table.slice(1).filter((r) => r.some(Boolean)).slice(0, 3).map((r) => r[i] || '') })),
        fields: [...Object.entries(FIELD_LABELS).map(([key, label]) => ({ key, label })), ...cfs.map((f) => ({ key: 'cf_' + f.id, label: f.label }))] };
    }
    throw bad('Choose which column holds the phone number');
  }
  const extras = b.include_extras !== false;
  const rows = analyse(ctx.oid, up.table, mapping, str(b.default_source) || 'Other', up.offset, extras);
  const n = (st) => rows.filter((x) => x.status === st).length;
  return {
    upload_id: id, filename: up.filename, kind: up.kind, note: up.note, needs_mapping: false, include_extras: extras, mapping, headers: heads, rows,
    columns: heads.map((h, i) => ({ index: i, header: h, samples: up.table.slice(1).filter((r) => r.some(Boolean)).slice(0, 3).map((r) => r[i] || '') })),
    fields: [...Object.entries(FIELD_LABELS).map(([key, label]) => ({ key, label })), ...cfs.map((f) => ({ key: 'cf_' + f.id, label: f.label }))],
    total: rows.length, valid: n('valid'), duplicates: n('duplicate'), invalid: n('invalid'), to_import: n('valid'),
  };
});
r.post('/api/leads/import/commit', { admin: true }, (ctx) => {
  // Only rows the preview marked valid are sent; each is still re-checked here, so a duplicate can never slip in.
  const items = (Array.isArray(ctx.body.rows) ? ctx.body.rows : []).filter((it) => !it.status || it.status === 'valid');
  if (!items.length) throw bad('Nothing to import');
  let imported = 0; const skipped = []; const perRep = {};
  tx(() => items.forEach((it) => {
    try {
      const { lead, created } = L.createLead(ctx.oid, ctx.user, it.data, { lenient: true, silent: true });
      if (created) { imported++; if (lead.assigned_to) perRep[lead.assigned_to] = (perRep[lead.assigned_to] || 0) + 1; }
    } catch (e) {
      if (!(e instanceof HttpError)) throw e;
      skipped.push({ row: it.row, name: it.data?.name, reason: e.status === 409 ? `Already in CRM as "${e.extra.duplicates[0].name}"` : e.message });
    }
  }));
  for (const [uid, n] of Object.entries(perRep)) L.notify(ctx.oid, { user: Number(uid), title: `${n} new leads assigned`, message: `${n} imported lead(s) were assigned to you`, link: '#/leads' });
  L.notifyAdmins(ctx.oid, 'Lead import completed', `${imported} lead(s) imported, ${skipped.length} skipped`, '#/leads');
  L.audit(ctx.oid, ctx.user.id, 'lead.import', 'lead', null, `${imported} imported, ${skipped.length} skipped`);
  if (ctx.body.upload_id) uploads.delete(ctx.body.upload_id);
  return { imported, skipped };
});

// ----- public intake: enquiry form + webhook -----
const hits = new Map();
function rateLimit(ip, max = 10) {
  const h = (hits.get(ip) || []).filter((t) => Date.now() - t < 3600e3);
  if (h.length >= max) throw new HttpError(429, 'Too many submissions. Please try again later.');
  h.push(Date.now()); hits.set(ip, h);
}
r.post('/api/public/enquire/:code', { public: true }, (ctx) => {
  const org = get('SELECT * FROM orgs WHERE code=?', ctx.params.code);
  if (!org) throw notFound('Organization not found');
  const b = ctx.body;
  if (b.website) return { ok: true }; // honeypot
  rateLimit(ctx.ip);
  if (!b.consent) throw bad('Please tick the consent box so we can contact you');
  const { created } = L.createLead(org.id, null, { name: b.name, phone: b.phone, email: b.email, source: 'Website', pref_project_id: b.project_id, notes: b.message ? `Enquiry message: ${b.message}` : null, pref_size_min: b.size, pref_size_max: b.size, consent: true },
    { intake: true, lenient: true });
  return { ok: true, message: 'Thank you! Our team will call you shortly.', created };
});
r.post('/api/webhook/:code/:secret/lead', { public: true }, (ctx) => {
  const org = get('SELECT * FROM orgs WHERE code=?', ctx.params.code);
  if (!org || L.getSettings(org.id).webhook_secret !== ctx.params.secret) throw new HttpError(401, 'Invalid webhook credentials');
  const b = ctx.body;
  const pj = b.project ? get('SELECT id FROM projects WHERE org_id=? AND lower(name)=lower(?)', org.id, String(b.project)) : null;
  const d = { name: b.name || b.full_name, phone: b.phone || b.mobile, email: b.email, source: b.source || 'Website', notes: b.notes || b.message, pref_project_id: pj?.id || b.project_id,
    budget_max: b.budget, pref_location: b.location };
  if (b.partner_code) { const pa = get('SELECT id FROM partners WHERE org_id=? AND id=?', org.id, Number(b.partner_code)); if (pa) d.partner_id = pa.id; }
  const { lead, created } = L.createLead(org.id, null, d, { intake: true, lenient: true });
  return { ok: true, lead_id: lead.id, duplicate: !created };
});
