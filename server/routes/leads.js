// Leads: list / create / update / stage / assign / delete, duplicates, spam review, import, saved filters, public intake.
const fs = require('fs');
const { r } = require('../router');
const { all, get, run, tx } = require('../db');
const L = require('../lib');
const { HttpError, bad, forbidden, notFound, now, str, num, newToken, addMs } = L;

function leadFor(ctx, id) {
  const l = get('SELECT * FROM leads WHERE id=? AND org_id=?', Number(id), ctx.oid);
  if (!l || (!ctx.isAdmin && l.assigned_to !== ctx.user.id)) throw notFound('Lead not found');
  return l;
}
const parseLead = (l) => ({ ...l, custom: JSON.parse(l.custom || '{}') });
const LIST_SQL = `SELECT l.*, u.name AS rep_name, pr.name AS project_name, pa.name AS partner_name,
  (SELECT MIN(due_at) FROM tasks t WHERE t.lead_id=l.id AND t.status='open') AS next_due,
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
  if (q.q) {
    const t = `%${String(q.q).trim()}%`, digits = `%${String(q.q).replace(/\D/g, '')}%`;
    sql += ' AND (l.name LIKE ? OR l.email LIKE ? OR l.phone_norm LIKE ?)'; a.push(t, t, digits.length > 2 ? digits : '%__none__%');
  }
  sql += q.stage === 'Lost' ? ' ORDER BY l.lost_at DESC' : ' ORDER BY l.updated_at DESC';
  sql += ' LIMIT ?'; a.push(Math.min(Number(q.limit) || 1000, 3000));
  return all(sql, ...a).map(parseLead);
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
    .map((b) => ({ ...b, ...L.bookingSummary(ctx.oid, b.id) }));
  return {
    lead,
    duplicates: L.findDuplicates(ctx.oid, l.phone_norm, l.email, l.id).map((d) => ({ id: d.id, name: d.name, stage: d.stage, rep_name: d.rep_name })),
    timeline,
    tasks: all('SELECT t.*, u.name AS assignee FROM tasks t LEFT JOIN users u ON u.id=t.assigned_to WHERE t.org_id=? AND t.lead_id=? ORDER BY t.status, t.due_at', ctx.oid, l.id),
    visits: all(`SELECT v.*, pr.name AS project_name, pl.plot_no FROM visits v JOIN projects pr ON pr.id=v.project_id LEFT JOIN plots pl ON pl.id=v.plot_id WHERE v.org_id=? AND v.lead_id=? ORDER BY v.scheduled_at DESC`, ctx.oid, l.id),
    bookings,
    kyc: all('SELECT id,doc_type,filename,status,remark,uploaded_at FROM kyc_docs WHERE org_id=? AND lead_id=? ORDER BY id DESC', ctx.oid, l.id),
    holds: all("SELECT pl.id, pl.plot_no, pl.hold_until, pr.name AS project_name FROM plots pl JOIN projects pr ON pr.id=pl.project_id WHERE pl.org_id=? AND pl.hold_lead_id=? AND pl.status='hold'", ctx.oid, l.id),
    discounts: all('SELECT d.*, pl.plot_no FROM discount_requests d JOIN plots pl ON pl.id=d.plot_id WHERE d.org_id=? AND d.lead_id=? ORDER BY d.id DESC', ctx.oid, l.id),
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

// ----- bulk import (admin) -----
const ALIASES = {
  name: ['name', 'full_name', 'fullname', 'customer', 'customer_name', 'lead_name', 'client', 'client_name'],
  phone: ['phone', 'mobile', 'mobile_no', 'mobile_number', 'phone_number', 'contact', 'contact_no', 'contact_number', 'whatsapp', 'cell'],
  email: ['email', 'email_id', 'e_mail', 'mail'],
  source: ['source', 'lead_source', 'channel'],
  budget_min: ['budget_min', 'min_budget'],
  budget_max: ['budget_max', 'max_budget', 'budget'],
  pref_size: ['size', 'plot_size', 'preferred_size', 'area', 'sq_yd', 'sqyd', 'sq_yards'],
  pref_facing: ['facing', 'preferred_facing'],
  pref_location: ['location', 'preferred_location', 'area_preference'],
  project: ['project', 'preferred_project', 'project_name', 'layout'],
  purpose: ['purpose', 'buying_purpose'],
  notes: ['notes', 'note', 'remarks', 'comment', 'comments', 'requirement'],
  rep: ['rep', 'assigned_to', 'assigned', 'owner', 'sales_rep'],
};
function readRows(body) {
  if (body.file_base64) {
    const buf = Buffer.from(body.file_base64, 'base64');
    return /\.xlsx$/i.test(body.filename || '') ? L.parseXlsx(buf) : L.parseCsv(buf.toString('utf8'));
  }
  return body.rows || [];
}
function importRows(oid, body) {
  const rows = readRows(body);
  if (rows.length < 2) throw bad('The file has no data rows');
  const heads = rows[0].map((h) => String(h).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''));
  const cfs = all('SELECT * FROM custom_fields WHERE org_id=?', oid);
  const col = {};
  for (const [k, names] of Object.entries(ALIASES)) col[k] = heads.findIndex((h) => names.includes(h));
  const cfCol = cfs.map((f) => ({ f, ix: heads.indexOf(f.label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')) })).filter((x) => x.ix >= 0);
  if (col.name < 0 || col.phone < 0) throw bad('The file needs "name" and "phone" columns');
  const projects = all('SELECT id,name FROM projects WHERE org_id=?', oid), users = all("SELECT id,name,email FROM users WHERE org_id=? AND status='active'", oid);
  const seen = new Map(); const out = [];
  rows.slice(1).forEach((row, i) => {
    if (!row.some((c) => String(c ?? '').trim())) return;
    const g = (k) => (col[k] >= 0 ? String(row[col[k]] ?? '').trim() : '');
    const d = { name: g('name'), phone: g('phone'), email: g('email'), source: g('source'), notes: g('notes'), pref_facing: g('pref_facing'), pref_location: g('pref_location'), purpose: g('purpose') };
    d.budget_min = num(g('budget_min').replace(/,/g, '')); d.budget_max = num(g('budget_max').replace(/,/g, ''));
    const sz = num(g('pref_size').replace(/,/g, '')); if (sz) { d.pref_size_min = sz; d.pref_size_max = sz; }
    const pj = projects.find((p) => p.name.toLowerCase() === g('project').toLowerCase()); if (pj) d.pref_project_id = pj.id;
    const rp = g('rep').toLowerCase(); if (rp) { const u = users.find((x) => x.email.toLowerCase() === rp || x.name.toLowerCase() === rp); if (u) d.assigned_to = u.id; }
    if (cfCol.length) { d.custom = {}; cfCol.forEach(({ f, ix }) => { const v = String(row[ix] ?? '').trim(); if (v) d.custom[f.id] = f.type === 'checkbox' ? /^(y|yes|true|1)$/i.test(v) : v; }); }
    const errs = [];
    if (!d.name) errs.push('Name is missing');
    const pn = L.normPhone(d.phone);
    if (!pn) errs.push('Invalid phone number');
    if (d.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email)) errs.push('Invalid email');
    let dup = null;
    if (pn) {
      if (seen.has(pn)) errs.push(`Duplicate of row ${seen.get(pn)} in this file`);
      else {
        seen.set(pn, i + 2);
        const ex = L.findDuplicates(oid, pn, d.email);
        if (ex.length) { errs.push(`Already exists as "${ex[0].name}" (${ex[0].stage})`); dup = ex[0].id; }
      }
    }
    out.push({ row: i + 2, data: d, status: errs.length ? 'error' : 'valid', errors: errs, dup_of: dup });
  });
  return { headers: rows[0], rows: out };
}
r.post('/api/leads/import/preview', { admin: true }, (ctx) => {
  const { headers, rows } = importRows(ctx.oid, ctx.body);
  const def = str(ctx.body.default_source) || 'Other';
  rows.forEach((x) => { if (!x.data.source) x.data.source = def; });
  return { headers, rows, total: rows.length, valid: rows.filter((x) => x.status === 'valid').length, errors: rows.filter((x) => x.status === 'error').length };
});
r.post('/api/leads/import/commit', { admin: true }, (ctx) => {
  const items = Array.isArray(ctx.body.rows) ? ctx.body.rows : [];
  if (!items.length) throw bad('Nothing to import');
  let imported = 0; const skipped = []; const perRep = {};
  tx(() => items.forEach((it) => {
    try {
      const { lead, created } = L.createLead(ctx.oid, ctx.user, it.data, { lenient: true, silent: true });
      if (created) { imported++; if (lead.assigned_to) perRep[lead.assigned_to] = (perRep[lead.assigned_to] || 0) + 1; }
    } catch (e) {
      if (!(e instanceof HttpError)) throw e;
      skipped.push({ row: it.row, name: it.data?.name, reason: e.status === 409 ? `Already exists as "${e.extra.duplicates[0].name}"` : e.message });
    }
  }));
  for (const [uid, n] of Object.entries(perRep)) L.notify(ctx.oid, { user: Number(uid), title: `${n} new leads assigned`, message: `${n} imported lead(s) were assigned to you`, link: '#/leads' });
  L.notifyAdmins(ctx.oid, 'Lead import completed', `${imported} lead(s) imported, ${skipped.length} skipped`, '#/leads');
  L.audit(ctx.oid, ctx.user.id, 'lead.import', 'lead', null, `${imported} imported, ${skipped.length} skipped`);
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
