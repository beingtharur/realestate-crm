// Projects (layouts), plots inventory, holds, discount control, channel partners.
const { r } = require('../router');
const { all, get, run, tx } = require('../db');
const L = require('../lib');
const { bad, forbidden, notFound, now, addMs, str, num } = L;

function project(oid, id) { const p = get('SELECT * FROM projects WHERE id=? AND org_id=?', id, oid); if (!p) throw notFound('Project not found'); return p; }
function plot(oid, id) { const p = get('SELECT * FROM plots WHERE id=? AND org_id=?', id, oid); if (!p) throw notFound('Plot not found'); return p; }
const FACINGS = ['East', 'West', 'North', 'South', 'North-East', 'North-West', 'South-East', 'South-West'];

function projectStats(oid, id) {
  const rows = all('SELECT status, COUNT(*) c, COALESCE(SUM(area_sqyd),0) a, COALESCE(SUM(area_sqyd*rate_per_sqyd),0) v FROM plots WHERE org_id=? AND project_id=? GROUP BY status', oid, id);
  const s = { total: 0, available: 0, hold: 0, booked: 0, sold: 0, blocked: 0, total_area: 0, available_area: 0, available_value: 0, sold_value: 0 };
  for (const x of rows) {
    s[x.status] = x.c; s.total += x.c; s.total_area += x.a;
    if (x.status === 'available') { s.available_area = x.a; s.available_value = x.v; }
    if (x.status === 'booked' || x.status === 'sold') s.sold_value += x.v;
  }
  return s;
}
function projectBody(b, cur = {}) {
  const name = str(b.name) ?? cur.name;
  if (!name) throw bad('Project name is required');
  const pick = (k, d = null) => (k in b ? b[k] : cur[k] ?? d);
  const pct = (k) => { const v = num(pick(k, 0)) ?? 0; if (v < 0 || v > 100) throw bad(`${k.replace(/_/g, ' ')} must be between 0 and 100`); return v; };
  return [name, str(pick('location')), str(pick('city')), str(pick('developer')), str(pick('rera_no')), str(pick('approval')), num(pick('total_area_acres')),
    num(pick('base_rate', 0)) || 0, num(pick('dev_charges_per_sqyd', 0)) || 0, pct('registration_pct'), pct('max_discount_pct'), str(pick('amenities')), str(pick('description')), b.status === 'archived' ? 'archived' : b.status === 'active' ? 'active' : cur.status || 'active'];
}

r.get('/api/projects', (ctx) => all('SELECT * FROM projects WHERE org_id=? ORDER BY status, name', ctx.oid).map((p) => ({ ...p, stats: projectStats(ctx.oid, p.id) })));
r.post('/api/projects', { admin: true }, (ctx) => {
  const v = projectBody(ctx.body);
  const x = run('INSERT INTO projects(org_id,name,location,city,developer,rera_no,approval,total_area_acres,base_rate,dev_charges_per_sqyd,registration_pct,max_discount_pct,amenities,description,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    ctx.oid, ...v, now());
  L.audit(ctx.oid, ctx.user.id, 'project.create', 'project', Number(x.lastInsertRowid), v[0]);
  return { id: Number(x.lastInsertRowid) };
});
r.patch('/api/projects/:id', { admin: true }, (ctx) => {
  const p = project(ctx.oid, ctx.params.id);
  const v = projectBody(ctx.body, p);
  run('UPDATE projects SET name=?,location=?,city=?,developer=?,rera_no=?,approval=?,total_area_acres=?,base_rate=?,dev_charges_per_sqyd=?,registration_pct=?,max_discount_pct=?,amenities=?,description=?,status=? WHERE id=?', ...v, p.id);
  return { ok: true };
});
r.del('/api/projects/:id', { admin: true }, (ctx) => {
  const p = project(ctx.oid, ctx.params.id);
  if (get("SELECT 1 x FROM bookings WHERE project_id=? AND org_id=?", p.id, ctx.oid)) throw bad('This project has bookings. Archive it instead of deleting.');
  tx(() => { run('DELETE FROM plots WHERE project_id=?', p.id); run('UPDATE leads SET pref_project_id=NULL WHERE pref_project_id=? AND org_id=?', p.id, ctx.oid); run('DELETE FROM visits WHERE project_id=? AND org_id=?', p.id, ctx.oid); run('DELETE FROM projects WHERE id=?', p.id); });
  L.audit(ctx.oid, ctx.user.id, 'project.delete', 'project', p.id, p.name);
  return { ok: true };
});
r.get('/api/projects/:id', (ctx) => {
  const p = project(ctx.oid, ctx.params.id);
  const plots = all(`SELECT pl.*, l.name AS hold_lead_name, u.name AS hold_by_name FROM plots pl LEFT JOIN leads l ON l.id=pl.hold_lead_id LEFT JOIN users u ON u.id=pl.hold_by
    WHERE pl.org_id=? AND pl.project_id=? ORDER BY pl.block, LENGTH(pl.plot_no), pl.plot_no`, ctx.oid, p.id);
  const bk = all("SELECT plot_id, booking_no, id, buyer_name FROM bookings WHERE org_id=? AND project_id=? AND status<>'cancelled'", ctx.oid, p.id);
  const map = Object.fromEntries(bk.map((b) => [b.plot_id, b]));
  return { project: p, stats: projectStats(ctx.oid, p.id), plots: plots.map((x) => ({ ...x, price: L.priceFor(x, p).total, booking: map[x.id] || null })) };
});

// ----- plots -----
function plotValues(b, cur = {}) {
  const pick = (k) => (k in b ? b[k] : cur[k]);
  const plot_no = str(pick('plot_no')); if (!plot_no) throw bad('Plot number is required');
  const area = num(pick('area_sqyd')); if (!area || area <= 0) throw bad('Plot area (sq. yd) is required');
  const rate = num(pick('rate_per_sqyd')); if (rate === null || rate < 0) throw bad('Rate per sq. yd is required');
  const plc = num(pick('plc_pct')) ?? 0; if (plc < 0 || plc > 100) throw bad('PLC % must be between 0 and 100');
  const facing = str(pick('facing')); if (facing && !FACINGS.includes(facing)) throw bad('Invalid facing');
  return [plot_no, str(pick('block')), area, num(pick('length')), num(pick('width')), facing, num(pick('road_width_ft')), rate, plc, str(pick('notes'))];
}
r.post('/api/projects/:id/plots', { admin: true }, (ctx) => {
  const p = project(ctx.oid, ctx.params.id);
  const v = plotValues({ rate_per_sqyd: p.base_rate, ...ctx.body });
  if (get('SELECT 1 x FROM plots WHERE project_id=? AND plot_no=?', p.id, v[0])) throw bad(`Plot ${v[0]} already exists in this project`);
  const x = run('INSERT INTO plots(org_id,project_id,plot_no,block,area_sqyd,length,width,facing,road_width_ft,rate_per_sqyd,plc_pct,notes,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', ctx.oid, p.id, ...v, now());
  return { id: Number(x.lastInsertRowid) };
});
/** Generate a run of plots (e.g. A-1 … A-40) in one go. */
r.post('/api/projects/:id/plots/bulk', { admin: true }, (ctx) => {
  const p = project(ctx.oid, ctx.params.id), b = ctx.body;
  const from = Math.floor(num(b.from) ?? NaN), to = Math.floor(num(b.to) ?? NaN);
  if (isNaN(from) || isNaN(to) || to < from) throw bad('Enter a valid number range');
  if (to - from > 999) throw bad('Generate at most 1000 plots at a time');
  const prefix = str(b.prefix) || '', block = str(b.block);
  let made = 0, skipped = 0;
  tx(() => {
    for (let n = from; n <= to; n++) {
      const no = `${prefix}${n}`;
      const v = plotValues({ rate_per_sqyd: p.base_rate, ...b, plot_no: no, block });
      if (get('SELECT 1 x FROM plots WHERE project_id=? AND plot_no=?', p.id, no)) { skipped++; continue; }
      run('INSERT INTO plots(org_id,project_id,plot_no,block,area_sqyd,length,width,facing,road_width_ft,rate_per_sqyd,plc_pct,notes,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', ctx.oid, p.id, ...v, now());
      made++;
    }
  });
  return { created: made, skipped };
});
/** Import plots from CSV/XLSX rows: plot_no, block, area_sqyd, length, width, facing, road_width_ft, rate_per_sqyd, plc_pct */
r.post('/api/projects/:id/plots/import', { admin: true }, (ctx) => {
  const p = project(ctx.oid, ctx.params.id);
  let rows;
  if (ctx.body.file_base64) {
    const buf = Buffer.from(ctx.body.file_base64, 'base64');
    rows = /\.xlsx$/i.test(ctx.body.filename || '') ? L.parseXlsx(buf) : L.parseCsv(buf.toString('utf8'));
  } else rows = ctx.body.rows;
  if (!rows || rows.length < 2) throw bad('The file has no data rows');
  const head = rows[0].map((h) => String(h).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_'));
  const idx = (...names) => head.findIndex((h) => names.includes(h));
  const col = { plot_no: idx('plot_no', 'plot', 'plot_number', 'plot_no_'), block: idx('block', 'phase'), area_sqyd: idx('area_sqyd', 'area', 'sq_yd', 'sqyd', 'size', 'area_sq_yd'), length: idx('length'), width: idx('width'),
    facing: idx('facing'), road_width_ft: idx('road_width_ft', 'road_width', 'road'), rate_per_sqyd: idx('rate_per_sqyd', 'rate', 'price_per_sqyd'), plc_pct: idx('plc_pct', 'plc') };
  if (col.plot_no < 0 || col.area_sqyd < 0) throw bad('The file needs at least "plot_no" and "area_sqyd" columns');
  const created = []; const errors = [];
  tx(() => rows.slice(1).forEach((row, i) => {
    if (!row.some((c) => String(c).trim())) return;
    const rec = {}; for (const [k, ix] of Object.entries(col)) if (ix >= 0) rec[k] = row[ix];
    try {
      if (rec.facing) rec.facing = FACINGS.find((f) => f.toLowerCase().replace(/[^a-z]/g, '') === String(rec.facing).toLowerCase().replace(/[^a-z]/g, '')) || rec.facing;
      if (rec.rate_per_sqyd === undefined || rec.rate_per_sqyd === '') rec.rate_per_sqyd = p.base_rate;
      const v = plotValues(rec);
      if (get('SELECT 1 x FROM plots WHERE project_id=? AND plot_no=?', p.id, v[0])) throw bad(`Plot ${v[0]} already exists`);
      run('INSERT INTO plots(org_id,project_id,plot_no,block,area_sqyd,length,width,facing,road_width_ft,rate_per_sqyd,plc_pct,notes,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', ctx.oid, p.id, ...v, now());
      created.push(v[0]);
    } catch (e) { errors.push({ row: i + 2, error: e.message }); }
  }));
  return { created: created.length, errors };
});
r.patch('/api/plots/:id', { admin: true }, (ctx) => {
  const pl = plot(ctx.oid, ctx.params.id);
  if (['booked', 'sold'].includes(pl.status) && ('rate_per_sqyd' in ctx.body || 'area_sqyd' in ctx.body)) throw bad('Price and area cannot change once a plot is booked');
  const v = plotValues(ctx.body, pl);
  if (v[0] !== pl.plot_no && get('SELECT 1 x FROM plots WHERE project_id=? AND plot_no=? AND id<>?', pl.project_id, v[0], pl.id)) throw bad(`Plot ${v[0]} already exists`);
  let status = pl.status;
  if (ctx.body.status && ctx.body.status !== pl.status) {
    if (['booked', 'sold'].includes(pl.status)) throw bad('Change booked plots through the booking (cancel it to release the plot)');
    if (!['available', 'blocked'].includes(ctx.body.status)) throw bad('Plot status can only be set to Available or Blocked here');
    status = ctx.body.status;
  }
  run('UPDATE plots SET plot_no=?,block=?,area_sqyd=?,length=?,width=?,facing=?,road_width_ft=?,rate_per_sqyd=?,plc_pct=?,notes=?,status=?, hold_lead_id=CASE WHEN ?<>\'hold\' THEN NULL ELSE hold_lead_id END, hold_until=CASE WHEN ?<>\'hold\' THEN NULL ELSE hold_until END WHERE id=?', ...v, status, status, status, pl.id);
  return { ok: true };
});
/** Bulk-update rate / PLC / status across many plots (price revision). */
r.post('/api/plots/bulk-update', { admin: true }, (ctx) => {
  const ids = (ctx.body.ids || []).map(Number).filter(Boolean);
  if (!ids.length) throw bad('Select at least one plot');
  let n = 0;
  tx(() => ids.forEach((id) => {
    const pl = get('SELECT * FROM plots WHERE id=? AND org_id=?', id, ctx.oid);
    if (!pl || ['booked', 'sold'].includes(pl.status)) return;
    const rate = 'rate_per_sqyd' in ctx.body && ctx.body.rate_per_sqyd !== '' ? num(ctx.body.rate_per_sqyd) : pl.rate_per_sqyd;
    const plc = 'plc_pct' in ctx.body && ctx.body.plc_pct !== '' ? num(ctx.body.plc_pct) : pl.plc_pct;
    let status = pl.status;
    if (['available', 'blocked'].includes(ctx.body.status)) { status = ctx.body.status; }
    run('UPDATE plots SET rate_per_sqyd=?, plc_pct=?, status=? WHERE id=?', rate, plc, status, id);
    n++;
  }));
  return { updated: n };
});
r.del('/api/plots/:id', { admin: true }, (ctx) => {
  const pl = plot(ctx.oid, ctx.params.id);
  if (get('SELECT 1 x FROM bookings WHERE plot_id=?', pl.id)) throw bad('This plot has booking history and cannot be deleted. Mark it Blocked instead.');
  run('UPDATE visits SET plot_id=NULL WHERE plot_id=?', pl.id);
  run('DELETE FROM plots WHERE id=?', pl.id);
  return { ok: true };
});
r.get('/api/plots/:id/price', (ctx) => {
  const pl = plot(ctx.oid, ctx.params.id), p = project(ctx.oid, pl.project_id);
  return { plot: pl, project: { id: p.id, name: p.name, max_discount_pct: p.max_discount_pct }, price: L.priceFor(pl, p, num(ctx.query.discount) || 0) };
});
r.get('/api/plots', (ctx) => {
  const q = ctx.query;
  let sql = `SELECT pl.*, pr.name AS project_name FROM plots pl JOIN projects pr ON pr.id=pl.project_id WHERE pl.org_id=?`; const a = [ctx.oid];
  if (q.status) { sql += ' AND pl.status=?'; a.push(q.status); }
  if (q.project_id) { sql += ' AND pl.project_id=?'; a.push(Number(q.project_id)); }
  if (q.facing) { sql += ' AND pl.facing=?'; a.push(q.facing); }
  if (q.min_area) { sql += ' AND pl.area_sqyd>=?'; a.push(Number(q.min_area)); }
  if (q.max_area) { sql += ' AND pl.area_sqyd<=?'; a.push(Number(q.max_area)); }
  if (q.max_price) { sql += ' AND pl.area_sqyd*pl.rate_per_sqyd*(1+pl.plc_pct/100)<=?'; a.push(Number(q.max_price)); }
  sql += ' ORDER BY pr.name, pl.block, LENGTH(pl.plot_no), pl.plot_no LIMIT 500';
  return all(sql, ...a).map((x) => ({ ...x, price: L.priceFor(x, get('SELECT * FROM projects WHERE id=?', x.project_id)).total }));
});

// ----- holds -----
r.post('/api/plots/:id/hold', (ctx) => {
  const pl = plot(ctx.oid, ctx.params.id);
  if (pl.status !== 'available') throw bad(`Plot is ${pl.status}, not available`);
  const lead = get('SELECT * FROM leads WHERE id=? AND org_id=?', Number(ctx.body.lead_id), ctx.oid);
  if (!lead) throw bad('Choose a lead to hold this plot for');
  if (!ctx.isAdmin && lead.assigned_to !== ctx.user.id) throw forbidden('You can only hold plots for your own leads');
  const hours = Math.min(720, Math.max(1, num(ctx.body.hours) || L.getSettings(ctx.oid).hold_hours_default || 48));
  run("UPDATE plots SET status='hold', hold_lead_id=?, hold_until=?, hold_by=? WHERE id=?", lead.id, addMs(hours * 3600e3), ctx.user.id, pl.id);
  L.logActivity(ctx.oid, lead.id, ctx.user.id, 'note', { content: `Plot ${pl.plot_no} put on hold for ${hours}h` });
  return { ok: true, hold_until: get('SELECT hold_until FROM plots WHERE id=?', pl.id).hold_until };
});
r.post('/api/plots/:id/release', (ctx) => {
  const pl = plot(ctx.oid, ctx.params.id);
  if (pl.status !== 'hold') throw bad('Plot is not on hold');
  if (!ctx.isAdmin && pl.hold_by !== ctx.user.id) throw forbidden('Only the person who placed the hold (or an admin) can release it');
  run("UPDATE plots SET status='available', hold_lead_id=NULL, hold_until=NULL, hold_by=NULL WHERE id=?", pl.id);
  return { ok: true };
});

// ----- discount control -----
r.get('/api/discounts', (ctx) => {
  const sql = `SELECT d.*, l.name AS lead_name, pl.plot_no, pr.name AS project_name, pr.max_discount_pct, u.name AS requested_by_name, du.name AS decided_by_name,
    ROUND(pl.area_sqyd*pl.rate_per_sqyd) AS base_amount FROM discount_requests d JOIN leads l ON l.id=d.lead_id JOIN plots pl ON pl.id=d.plot_id JOIN projects pr ON pr.id=pl.project_id
    LEFT JOIN users u ON u.id=d.requested_by LEFT JOIN users du ON du.id=d.decided_by WHERE d.org_id=?`;
  return ctx.isAdmin ? all(sql + ' ORDER BY d.id DESC LIMIT 200', ctx.oid) : all(sql + ' AND d.requested_by=? ORDER BY d.id DESC LIMIT 200', ctx.oid, ctx.user.id);
});
r.post('/api/discounts', (ctx) => {
  const lead = get('SELECT * FROM leads WHERE id=? AND org_id=?', Number(ctx.body.lead_id), ctx.oid);
  const pl = plot(ctx.oid, ctx.body.plot_id);
  if (!lead) throw bad('Lead not found');
  if (!ctx.isAdmin && lead.assigned_to !== ctx.user.id) throw forbidden();
  const amount = L.round(num(ctx.body.amount));
  if (amount <= 0) throw bad('Enter the discount amount you are requesting');
  const pr = project(ctx.oid, pl.project_id), pr_ = L.priceFor(pl, pr);
  if (amount > pr_.base) throw bad('Discount cannot exceed the base price');
  const x = run('INSERT INTO discount_requests(org_id,lead_id,plot_id,amount,reason,requested_by,created_at) VALUES (?,?,?,?,?,?,?)', ctx.oid, lead.id, pl.id, amount, str(ctx.body.reason), ctx.user.id, now());
  L.notifyAdmins(ctx.oid, 'Discount approval requested', `${ctx.user.name} requests ₹${amount.toLocaleString('en-IN')} off Plot ${pl.plot_no} (${pr.name}) for ${lead.name}`, '#/discounts');
  return { id: Number(x.lastInsertRowid), within_limit: amount <= pr_.max_discount };
});
r.post('/api/discounts/:id/decide', { admin: true }, (ctx) => {
  const d = get('SELECT * FROM discount_requests WHERE id=? AND org_id=?', ctx.params.id, ctx.oid);
  if (!d) throw notFound();
  if (d.status !== 'pending') throw bad('This request has already been decided');
  const approve = ctx.body.decision === 'approve';
  const amount = approve && ctx.body.amount ? L.round(num(ctx.body.amount)) : d.amount;
  run('UPDATE discount_requests SET status=?, amount=?, decided_by=?, decided_at=?, decision_note=? WHERE id=?', approve ? 'approved' : 'rejected', amount, ctx.user.id, now(), str(ctx.body.note), d.id);
  L.notify(ctx.oid, { user: d.requested_by, title: `Discount ${approve ? 'approved' : 'rejected'}`, message: `₹${amount.toLocaleString('en-IN')} discount request was ${approve ? 'approved' : 'rejected'}${ctx.body.note ? ': ' + ctx.body.note : ''}`, link: `#/leads/${d.lead_id}` });
  L.audit(ctx.oid, ctx.user.id, `discount.${approve ? 'approve' : 'reject'}`, 'discount', d.id, `₹${amount}`);
  return { ok: true };
});

// ----- channel partners / brokers -----
r.get('/api/partners', { admin: true }, (ctx) => all(`SELECT p.*,
  (SELECT COUNT(*) FROM leads l WHERE l.partner_id=p.id) AS leads,
  (SELECT COUNT(*) FROM bookings b WHERE b.partner_id=p.id AND b.status<>'cancelled') AS bookings,
  (SELECT COALESCE(SUM(amount),0) FROM commissions c WHERE c.partner_id=p.id AND c.status<>'cancelled') AS commission_total,
  (SELECT COALESCE(SUM(amount),0) FROM commissions c WHERE c.partner_id=p.id AND c.status='paid') AS commission_paid
  FROM partners p WHERE p.org_id=? ORDER BY p.name`, ctx.oid));
r.post('/api/partners', { admin: true }, (ctx) => {
  const b = ctx.body, name = str(b.name);
  if (!name) throw bad('Partner name is required');
  let phone = null; if (b.phone) { phone = L.normPhone(b.phone); if (!phone) throw bad('Enter a valid Indian mobile number'); }
  const pct = num(b.commission_pct) ?? 0; if (pct < 0 || pct > 50) throw bad('Commission % must be between 0 and 50');
  const x = run('INSERT INTO partners(org_id,name,phone,email,type,commission_pct,notes,created_at) VALUES (?,?,?,?,?,?,?,?)', ctx.oid, name, phone, str(b.email), ['broker', 'channel_partner', 'referral'].includes(b.type) ? b.type : 'broker', pct, str(b.notes), now());
  return { id: Number(x.lastInsertRowid) };
});
r.patch('/api/partners/:id', { admin: true }, (ctx) => {
  const p = get('SELECT * FROM partners WHERE id=? AND org_id=?', ctx.params.id, ctx.oid); if (!p) throw notFound();
  const b = ctx.body;
  let phone = p.phone; if ('phone' in b) { phone = b.phone ? L.normPhone(b.phone) : null; if (b.phone && !phone) throw bad('Enter a valid Indian mobile number'); }
  run('UPDATE partners SET name=?, phone=?, email=?, type=?, commission_pct=?, active=?, notes=? WHERE id=?', str(b.name) || p.name, phone, 'email' in b ? str(b.email) : p.email,
    b.type || p.type, 'commission_pct' in b ? num(b.commission_pct) ?? 0 : p.commission_pct, 'active' in b ? !!b.active : p.active, 'notes' in b ? str(b.notes) : p.notes, p.id);
  return { ok: true };
});
r.get('/api/commissions', { admin: true }, (ctx) => all(`SELECT c.*, p.name AS partner_name, b.booking_no, b.total, l.name AS buyer FROM commissions c JOIN partners p ON p.id=c.partner_id
  JOIN bookings b ON b.id=c.booking_id JOIN leads l ON l.id=b.lead_id WHERE c.org_id=? ORDER BY c.id DESC`, ctx.oid));
r.post('/api/commissions/:id/status', { admin: true }, (ctx) => {
  const c = get('SELECT * FROM commissions WHERE id=? AND org_id=?', ctx.params.id, ctx.oid); if (!c) throw notFound();
  if (c.status === 'cancelled') throw bad('This commission was cancelled with the booking');
  const st = ctx.body.status;
  if (!['pending', 'approved', 'paid'].includes(st)) throw bad('Invalid status');
  run('UPDATE commissions SET status=?, paid_on=?, note=COALESCE(?,note) WHERE id=?', st, st === 'paid' ? L.istDate() : null, str(ctx.body.note), c.id);
  L.audit(ctx.oid, ctx.user.id, 'commission.' + st, 'commission', c.id, `₹${c.amount}`);
  return { ok: true };
});
