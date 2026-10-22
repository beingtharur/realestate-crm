// Dashboard, reports, exports, global search, audit log and the RealPilot AI assistant.
const { r, raw } = require('../router');
const { all, get, run } = require('../db');
const L = require('../lib');
const { bad, notFound, now, addMs, str, num } = L;

const money = (n) => '₹' + Math.round(n || 0).toLocaleString('en-IN');
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0); // zero base → 0%

/** Scope helper: admin sees the whole org, a rep only their own records. */
const scope = (ctx, col) => (ctx.isAdmin ? { sql: '', args: [] } : { sql: ` AND ${col}=?`, args: [ctx.user.id] });

function leaderboard(oid, range) {
  const p = L.period(range);
  return all("SELECT * FROM users WHERE org_id=? AND role='rep' AND status='active'", oid).map((u) => {
    const leads = get('SELECT COUNT(*) c FROM leads WHERE org_id=? AND assigned_to=? AND created_at>=? AND created_at<?', oid, u.id, p.from, p.to).c;
    const won = get("SELECT COUNT(*) c FROM leads WHERE org_id=? AND assigned_to=? AND stage='Booked' AND created_at>=? AND created_at<?", oid, u.id, p.from, p.to).c;
    const bk = get("SELECT COUNT(*) c, COALESCE(SUM(total),0) v FROM bookings WHERE org_id=? AND sold_by=? AND status<>'cancelled' AND booked_on>=? AND booked_on<?", oid, u.id, p.fromD, p.toD);
    const month = L.period('month');
    const mv = get("SELECT COALESCE(SUM(total),0) v, COUNT(*) c FROM bookings WHERE org_id=? AND sold_by=? AND status<>'cancelled' AND booked_on>=? AND booked_on<?", oid, u.id, month.fromD, month.toD);
    return { id: u.id, name: u.name, leads, won, conversion: pct(won, leads), bookings: bk.c, sales_value: bk.v, target: u.monthly_target, target_bookings: u.target_bookings,
      target_achievement: u.monthly_target ? pct(mv.v, u.monthly_target) : u.target_bookings ? pct(mv.c, u.target_bookings) : 0, month_value: mv.v, month_bookings: mv.c };
  }).sort((a, b) => b.target_achievement - a.target_achievement || b.conversion - a.conversion || b.sales_value - a.sales_value).map((x, i) => ({ ...x, rank: i + 1 }));
}

r.get('/api/dashboard', (ctx) => {
  const range = ['today', 'week', 'month', 'all'].includes(ctx.query.range) ? ctx.query.range : 'month';
  const p = L.period(range), oid = ctx.oid;
  const sl = scope(ctx, 'l.assigned_to'), st = scope(ctx, 't.assigned_to'), sb = scope(ctx, 'b.sold_by');
  const nowIso = now(), eod = L.dayRange(L.istDate()).to;
  const leadRow = get(`SELECT COUNT(*) total, SUM(CASE WHEN l.rating='Hot' AND l.stage NOT IN ('Lost') THEN 1 ELSE 0 END) hot,
      SUM(CASE WHEN l.stage='Booked' THEN 1 ELSE 0 END) won,
      COALESCE(SUM(CASE WHEN l.stage IN ('Site Visit Scheduled','Site Visit Completed','Negotiation') THEN COALESCE(l.budget_max,l.budget_min,0) ELSE 0 END),0) pipeline
    FROM leads l WHERE l.org_id=? AND l.created_at>=? AND l.created_at<?${sl.sql}`, oid, p.from, p.to, ...sl.args);
  const followups = get(`SELECT COUNT(*) c FROM tasks t WHERE t.org_id=? AND t.status='open' AND t.due_at>=? AND t.due_at<?${st.sql}`, oid, p.from, p.to, ...st.args).c;
  const vScope = ctx.isAdmin ? '' : ' AND (v.assigned_to=? OR l.assigned_to=?)', vArgs = ctx.isAdmin ? [] : [ctx.user.id, ctx.user.id];
  const visitsN = get(`SELECT COUNT(*) c FROM visits v JOIN leads l ON l.id=v.lead_id WHERE v.org_id=? AND v.status IN ('scheduled','completed') AND v.scheduled_at>=? AND v.scheduled_at<?${vScope}`, oid, p.from, p.to, ...vArgs).c;
  const sales = get(`SELECT COUNT(*) c, COALESCE(SUM(b.total),0) v FROM bookings b WHERE b.org_id=? AND b.status<>'cancelled' AND b.booked_on>=? AND b.booked_on<?${sb.sql}`, oid, p.fromD, p.toD, ...sb.args);
  const collected = get(`SELECT COALESCE(SUM(pm.amount),0) s FROM payments pm JOIN bookings b ON b.id=pm.booking_id WHERE pm.org_id=? AND pm.kind='receipt' AND pm.voided=0 AND pm.paid_on>=? AND pm.paid_on<?${sb.sql}`, oid, p.fromD, p.toD, ...sb.args).s;
  const today = L.istDate();
  const dues = get(`SELECT COALESCE(SUM(i.amount-i.paid_amount),0) outstanding, COALESCE(SUM(CASE WHEN i.due_date<? THEN i.amount-i.paid_amount ELSE 0 END),0) overdue,
      COUNT(DISTINCT CASE WHEN i.due_date<? THEN i.booking_id END) overdue_bookings
    FROM installments i JOIN bookings b ON b.id=i.booking_id WHERE i.org_id=? AND b.status<>'cancelled' AND i.paid_amount<i.amount-0.5${sb.sql}`, today, today, oid, ...sb.args);
  const taskBase = `SELECT COUNT(*) c FROM tasks t WHERE t.org_id=? AND t.status='open'${st.sql}`;
  const doneRows = get(`SELECT COUNT(*) n, SUM(CASE WHEN t.completed_at<=t.due_at THEN 1 ELSE 0 END) ontime FROM tasks t WHERE t.org_id=? AND t.status='done' AND t.completed_at>=? AND t.completed_at<?${st.sql}`, oid, p.from, p.to, ...st.args);
  const funnel = L.STAGES.map((s) => ({ stage: s, count: get(`SELECT COUNT(*) c FROM leads l WHERE l.org_id=? AND l.stage=? AND l.created_at>=? AND l.created_at<?${sl.sql}`, oid, s, p.from, p.to, ...sl.args).c }));
  const plots = Object.fromEntries(all('SELECT status, COUNT(*) c FROM plots WHERE org_id=? GROUP BY status', oid).map((x) => [x.status, x.c]));
  const out = {
    range, scope: ctx.isAdmin ? 'org' : 'me',
    kpis: {
      total_leads: leadRow.total, hot_leads: leadRow.hot || 0, followups, site_visits: visitsN, conversion_rate: pct(leadRow.won || 0, leadRow.total), pipeline_value: leadRow.pipeline,
      bookings: sales.c, sales_value: sales.v, ...(ctx.isAdmin ? { collected } : {}),
    },
    sla: { overdue: get(taskBase + ' AND t.due_at<?', oid, ...st.args, nowIso).c, due_today: get(taskBase + ' AND t.due_at>=? AND t.due_at<?', oid, ...st.args, nowIso, eod).c,
      upcoming: get(taskBase + ' AND t.due_at>=?', oid, ...st.args, eod).c, all: get(taskBase, oid, ...st.args).c, on_time_pct: pct(doneRows.ontime || 0, doneRows.n) },
    funnel,
    hot_prospects: all(`SELECT l.id,l.name,l.phone_norm,l.score,l.stage,l.budget_max,u.name AS rep_name FROM leads l LEFT JOIN users u ON u.id=l.assigned_to
      WHERE l.org_id=? AND l.rating='Hot' AND l.stage NOT IN ('Booked','Lost')${sl.sql} ORDER BY l.score DESC, l.updated_at DESC LIMIT 6`, oid, ...sl.args),
    activity: all(`SELECT a.id,a.type,a.content,a.created_at,a.lead_id,l.name AS lead_name,u.name AS user_name FROM activities a JOIN leads l ON l.id=a.lead_id LEFT JOIN users u ON u.id=a.user_id
      WHERE a.org_id=? AND a.type<>'assign'${sl.sql} ORDER BY a.id DESC LIMIT 15`, oid, ...sl.args),
    agenda: all(`SELECT t.id,t.title,t.due_at,t.priority,t.lead_id,l.name AS lead_name,l.phone_norm AS lead_phone,u.name AS assignee FROM tasks t LEFT JOIN leads l ON l.id=t.lead_id LEFT JOIN users u ON u.id=t.assigned_to
      WHERE t.org_id=? AND t.status='open' AND t.due_at<?${st.sql} ORDER BY t.due_at LIMIT 15`, oid, eod, ...st.args),
    visits: all(`SELECT v.id,v.scheduled_at,v.lead_id,l.name AS lead_name,pr.name AS project_name,pl.plot_no,u.name AS rep_name FROM visits v JOIN leads l ON l.id=v.lead_id JOIN projects pr ON pr.id=v.project_id
      LEFT JOIN plots pl ON pl.id=v.plot_id LEFT JOIN users u ON u.id=v.assigned_to WHERE v.org_id=? AND v.status='scheduled' AND v.scheduled_at>=?${vScope} ORDER BY v.scheduled_at LIMIT 8`, oid, L.dayRange(today).from, ...vArgs),
    ...(ctx.isAdmin ? { collections: { outstanding: dues.outstanding, overdue: dues.overdue, overdue_bookings: dues.overdue_bookings } } : {}),
    inventory: { available: plots.available || 0, hold: plots.hold || 0, booked: plots.booked || 0, sold: plots.sold || 0, total: Object.values(plots).reduce((a, b) => a + b, 0) },
  };
  // "What needs me right now": counts + the first few records behind them
  const t0 = L.dayRange(today).from;
  out.focus = {
    overdue_followups: out.sla.overdue, due_today: out.sla.due_today,
    new_uncontacted: get(`SELECT COUNT(*) c FROM leads l WHERE l.org_id=? AND l.stage='New' AND l.last_activity_at IS NULL AND l.flag_status<>'spam'${sl.sql}`, oid, ...sl.args).c,
    hot_cooling: get(`SELECT COUNT(*) c FROM leads l WHERE l.org_id=? AND l.rating='Hot' AND l.stage NOT IN ('Booked','Lost') AND COALESCE(l.last_activity_at,l.created_at)<?${sl.sql}`, oid, addMs(-48 * 3600e3), ...sl.args).c,
    visits_today: get(`SELECT COUNT(*) c FROM visits v JOIN leads l ON l.id=v.lead_id WHERE v.org_id=? AND v.status='scheduled' AND v.scheduled_at>=? AND v.scheduled_at<?${vScope}`, oid, t0, eod, ...vArgs).c,
  };
  const leadCols = 'l.id,l.name,l.phone_norm,l.source,l.rating,l.stage,l.created_at,l.last_activity_at,pr.name AS project_name,u.name AS rep_name';
  const leadJoin = 'FROM leads l LEFT JOIN projects pr ON pr.id=l.pref_project_id LEFT JOIN users u ON u.id=l.assigned_to';
  out.new_leads = all(`SELECT ${leadCols} ${leadJoin} WHERE l.org_id=? AND l.stage='New' AND l.last_activity_at IS NULL AND l.flag_status<>'spam'${sl.sql} ORDER BY l.created_at DESC LIMIT 6`, oid, ...sl.args);
  out.cooling_leads = all(`SELECT ${leadCols} ${leadJoin} WHERE l.org_id=? AND l.rating='Hot' AND l.stage NOT IN ('Booked','Lost') AND COALESCE(l.last_activity_at,l.created_at)<?${sl.sql} ORDER BY COALESCE(l.last_activity_at,l.created_at) LIMIT 6`, oid, addMs(-48 * 3600e3), ...sl.args);
  if (ctx.isAdmin) {
    out.health = all("SELECT * FROM users WHERE org_id=? AND role='rep' AND status='active' ORDER BY name", oid).map((u) => ({ id: u.id, name: u.name, ...L.repHealth(oid, u) }));
    out.leaderboard = leaderboard(oid, range).slice(0, 8);
    out.attention = {
      unassigned: get("SELECT COUNT(*) c FROM leads WHERE org_id=? AND assigned_to IS NULL AND stage NOT IN ('Booked','Lost')", oid).c,
      flagged: get("SELECT COUNT(*) c FROM leads WHERE org_id=? AND flag_status='pending'", oid).c,
      duplicates: get("SELECT COUNT(*) c FROM leads WHERE org_id=? AND dup_status='reported'", oid).c,
      discounts: get("SELECT COUNT(*) c FROM discount_requests WHERE org_id=? AND status='pending'", oid).c,
      unmatched: get('SELECT COUNT(*) c FROM webhook_events WHERE org_id=? AND matched=0', oid).c,
      kyc: get("SELECT COUNT(*) c FROM kyc_docs WHERE org_id=? AND status='pending'", oid).c,
    };
  } else {
    const me = ctx.user, month = L.period('month');
    const mv = get("SELECT COALESCE(SUM(total),0) v, COUNT(*) c FROM bookings WHERE org_id=? AND sold_by=? AND status<>'cancelled' AND booked_on>=? AND booked_on<?", oid, me.id, month.fromD, month.toD);
    out.my_target = { monthly_target: me.monthly_target, target_bookings: me.target_bookings, month_value: mv.v, month_bookings: mv.c,
      progress: me.monthly_target ? pct(mv.v, me.monthly_target) : me.target_bookings ? pct(mv.c, me.target_bookings) : 0 };
    out.health = [{ id: me.id, name: me.name, ...L.repHealth(oid, me) }];
    out.leaderboard = leaderboard(oid, range).map((x) => ({ rank: x.rank, name: x.id === me.id ? x.name : x.name, bookings: x.bookings, conversion: x.conversion, me: x.id === me.id })).slice(0, 8);
  }
  return out;
});

// ================= REPORTS =================
r.get('/api/reports', { admin: true }, (ctx) => {
  const range = ['today', 'week', 'month', 'all'].includes(ctx.query.range) ? ctx.query.range : 'month';
  let p = L.period(range);
  if (ctx.query.from && ctx.query.to) {
    const f = L.dayRange(ctx.query.from), t = L.dayRange(ctx.query.to);
    p = { from: f.from, to: t.to, fromD: ctx.query.from, toD: L.istDate(Date.parse(t.to)) };
  }
  const oid = ctx.oid;
  const reached = L.STAGES.filter((s) => s !== 'Lost').map((s, k) => ({
    stage: s, count: get(`SELECT COUNT(*) c FROM leads WHERE org_id=? AND stage<>'Lost' AND created_at>=? AND created_at<? AND CASE stage WHEN 'New' THEN 0 WHEN 'Contacted' THEN 1 WHEN 'Site Visit Scheduled' THEN 2 WHEN 'Site Visit Completed' THEN 3 WHEN 'Negotiation' THEN 4 WHEN 'Booked' THEN 5 END >= ?`, oid, p.from, p.to, k).c }));
  const lostN = get("SELECT COUNT(*) c FROM leads WHERE org_id=? AND stage='Lost' AND created_at>=? AND created_at<?", oid, p.from, p.to).c;
  reached[0].count += lostN; // leads that were created and later lost still entered the funnel
  const funnel = reached.map((x, i) => ({ ...x, dropoff_pct: i === 0 ? 0 : pct(reached[i - 1].count - x.count, reached[i - 1].count), of_total_pct: pct(x.count, reached[0].count) }));
  const spendMap = L.getSettings(oid).source_spend || {};
  const sources = all(`SELECT COALESCE(l.source,'Unknown') AS source, COUNT(*) leads, SUM(CASE WHEN l.rating='Hot' THEN 1 ELSE 0 END) hot, SUM(CASE WHEN l.stage='Booked' THEN 1 ELSE 0 END) booked,
      SUM(CASE WHEN l.stage='Lost' THEN 1 ELSE 0 END) lost FROM leads l WHERE l.org_id=? AND l.created_at>=? AND l.created_at<? GROUP BY 1 ORDER BY leads DESC`, oid, p.from, p.to)
    .map((s) => {
      const visited = get("SELECT COUNT(DISTINCT v.lead_id) c FROM visits v JOIN leads l ON l.id=v.lead_id WHERE l.org_id=? AND COALESCE(l.source,'Unknown')=? AND v.status='completed' AND l.created_at>=? AND l.created_at<?", oid, s.source, p.from, p.to).c;
      const days = range === 'all' ? Math.max(1, (Date.now() - Date.parse(get('SELECT MIN(created_at) m FROM leads WHERE org_id=?', oid).m || now())) / 864e5) : Math.max(1, (Date.parse(p.to) - Date.parse(p.from)) / 864e5);
      const monthly = (spendMap[s.source] || 0), spend = Math.round(monthly * Math.min(days, 3650) / 30);
      return { ...s, visited, lead_to_visit: pct(visited, s.leads), visit_to_booking: pct(s.booked, visited), conversion: pct(s.booked, s.leads), spend, cost_per_lead: spend && s.leads ? Math.round(spend / s.leads) : null, cost_per_booking: spend && s.booked ? Math.round(spend / s.booked) : null };
    });
  const projects = all('SELECT * FROM projects WHERE org_id=? ORDER BY name', oid).map((pr) => {
    const st = Object.fromEntries(all('SELECT status, COUNT(*) c FROM plots WHERE project_id=? GROUP BY status', pr.id).map((x) => [x.status, x.c]));
    const bk = get("SELECT COUNT(*) c, COALESCE(SUM(total),0) v, COALESCE(SUM(discount),0) d, COALESCE(SUM(base_amount),0) bs FROM bookings WHERE project_id=? AND status<>'cancelled' AND booked_on>=? AND booked_on<?", pr.id, p.fromD, p.toD);
    const col = get("SELECT COALESCE(SUM(pm.amount),0) s FROM payments pm JOIN bookings b ON b.id=pm.booking_id WHERE b.project_id=? AND pm.kind='receipt' AND pm.voided=0 AND pm.paid_on>=? AND pm.paid_on<?", pr.id, p.fromD, p.toD).s;
    const total = Object.values(st).reduce((a, b) => a + b, 0), sold = (st.booked || 0) + (st.sold || 0);
    return { id: pr.id, name: pr.name, total, available: st.available || 0, hold: st.hold || 0, booked: st.booked || 0, sold: st.sold || 0, sell_through: pct(sold, total), bookings: bk.c, sales_value: bk.v, collected: col, avg_discount_pct: pct(bk.d, bk.bs) };
  });
  const lost = all("SELECT COALESCE(lost_reason,'Other') AS reason, COUNT(*) c FROM leads WHERE org_id=? AND stage='Lost' AND lost_at>=? AND lost_at<? GROUP BY 1 ORDER BY c DESC", oid, p.from, p.to);
  const months = [];
  for (let k = 5; k >= 0; k--) {
    const d = new Date(Date.now() + 330 * 60000); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - k);
    const from = d.toISOString().slice(0, 7) + '-01', e = new Date(d); e.setUTCMonth(e.getUTCMonth() + 1); const to = e.toISOString().slice(0, 7) + '-01';
    months.push({ month: d.toISOString().slice(0, 7),
      bookings: get("SELECT COUNT(*) c FROM bookings WHERE org_id=? AND status<>'cancelled' AND booked_on>=? AND booked_on<?", oid, from, to).c,
      sales: get("SELECT COALESCE(SUM(total),0) s FROM bookings WHERE org_id=? AND status<>'cancelled' AND booked_on>=? AND booked_on<?", oid, from, to).s,
      collected: get("SELECT COALESCE(SUM(amount),0) s FROM payments WHERE org_id=? AND kind='receipt' AND voided=0 AND paid_on>=? AND paid_on<?", oid, from, to).s });
  }
  const today = L.istDate();
  const age = (a, b) => get(`SELECT COALESCE(SUM(i.amount-i.paid_amount),0) s, COUNT(*) c FROM installments i JOIN bookings bk ON bk.id=i.booking_id WHERE i.org_id=? AND bk.status<>'cancelled' AND i.paid_amount<i.amount-0.5 AND i.due_date<? AND i.due_date>=?`, oid, L.istDate(Date.now() - a * 864e5), L.istDate(Date.now() - b * 864e5));
  const aging = [['1–30 days', 0, 30], ['31–60 days', 30, 60], ['61–90 days', 60, 90], ['90+ days', 90, 3650]].map(([label, a, b]) => ({ label, ...age(a, b) }));
  const outstanding = get("SELECT COALESCE(SUM(i.amount-i.paid_amount),0) s FROM installments i JOIN bookings b ON b.id=i.booking_id WHERE i.org_id=? AND b.status<>'cancelled' AND i.paid_amount<i.amount-0.5", oid).s;
  void today;
  return { range, from: p.fromD, to: p.toD, funnel, leaderboard: leaderboard(oid, range), sources, projects, lost_reasons: lost, trend: months, aging, outstanding,
    partners: all(`SELECT pa.name, COUNT(DISTINCT l.id) leads, COUNT(DISTINCT b.id) bookings, COALESCE(SUM(DISTINCT c.amount),0) commission FROM partners pa LEFT JOIN leads l ON l.partner_id=pa.id
      LEFT JOIN bookings b ON b.partner_id=pa.id AND b.status<>'cancelled' LEFT JOIN commissions c ON c.partner_id=pa.id AND c.status<>'cancelled' WHERE pa.org_id=? GROUP BY pa.id ORDER BY bookings DESC`, oid) };
});

// ================= EXPORTS (CSV) =================
r.get('/api/export/:kind', { admin: true }, (ctx) => {
  const oid = ctx.oid, k = ctx.params.kind;
  let head, rows;
  if (k === 'leads') {
    head = ['ID', 'Name', 'Phone', 'Email', 'Source', 'Stage', 'Rating', 'Score', 'Budget min', 'Budget max', 'Size min (sq.yd)', 'Size max (sq.yd)', 'Facing', 'Location', 'Project', 'Assigned to', 'Created', 'Lost reason'];
    rows = all(`SELECT l.*, u.name rep, pr.name project FROM leads l LEFT JOIN users u ON u.id=l.assigned_to LEFT JOIN projects pr ON pr.id=l.pref_project_id WHERE l.org_id=? ORDER BY l.id`, oid)
      .map((l) => [l.id, l.name, l.phone_norm, l.email, l.source, l.stage, l.rating, l.score, l.budget_min, l.budget_max, l.pref_size_min, l.pref_size_max, l.pref_facing, l.pref_location, l.project, l.rep, l.created_at, l.lost_reason]);
  } else if (k === 'bookings') {
    head = ['Booking no', 'Date', 'Buyer', 'Phone', 'Project', 'Plot', 'Area (sq.yd)', 'Rate', 'Discount', 'Total', 'Paid', 'Outstanding', 'Status', 'Sold by'];
    rows = all(`SELECT b.*, pl.plot_no, pr.name project, u.name rep FROM bookings b JOIN plots pl ON pl.id=b.plot_id JOIN projects pr ON pr.id=b.project_id LEFT JOIN users u ON u.id=b.sold_by WHERE b.org_id=? ORDER BY b.id`, oid)
      .map((b) => { const s = L.bookingSummary(oid, b.id); return [b.booking_no, b.booked_on, b.buyer_name, b.buyer_phone, b.project, b.plot_no, b.area_sqyd, b.rate, b.discount, b.total, s.paid, s.outstanding, b.status, b.rep]; });
  } else if (k === 'payments') {
    head = ['Receipt no', 'Date', 'Booking', 'Buyer', 'Type', 'Amount', 'Mode', 'Reference', 'Voided', 'Received by'];
    rows = all(`SELECT p.*, b.booking_no, b.buyer_name, u.name rep FROM payments p JOIN bookings b ON b.id=p.booking_id LEFT JOIN users u ON u.id=p.received_by WHERE p.org_id=? ORDER BY p.id`, oid)
      .map((p) => [p.receipt_no, p.paid_on, p.booking_no, p.buyer_name, p.kind, p.amount, p.mode, p.ref_no, p.voided ? 'Yes' : '', p.rep]);
  } else if (k === 'plots') {
    head = ['Project', 'Plot no', 'Block', 'Area (sq.yd)', 'Facing', 'Road (ft)', 'Rate', 'PLC %', 'Status', 'Price'];
    rows = all('SELECT pl.*, pr.name project FROM plots pl JOIN projects pr ON pr.id=pl.project_id WHERE pl.org_id=? ORDER BY pr.name, pl.block, pl.plot_no', oid)
      .map((x) => [x.project, x.plot_no, x.block, x.area_sqyd, x.facing, x.road_width_ft, x.rate_per_sqyd, x.plc_pct, x.status, L.priceFor(x, get('SELECT * FROM projects WHERE id=?', x.project_id)).total]);
  } else if (k === 'collections') {
    head = ['Booking', 'Buyer', 'Phone', 'Instalment', 'Due date', 'Amount', 'Paid', 'Pending', 'Sold by'];
    rows = all(`SELECT i.*, b.booking_no, b.buyer_name, b.buyer_phone, u.name rep FROM installments i JOIN bookings b ON b.id=i.booking_id LEFT JOIN users u ON u.id=b.sold_by WHERE i.org_id=? AND b.status<>'cancelled' AND i.paid_amount<i.amount-0.5 ORDER BY i.due_date`, oid)
      .map((i) => [i.booking_no, i.buyer_name, i.buyer_phone, i.label, i.due_date, i.amount, i.paid_amount, i.amount - i.paid_amount, i.rep]);
  } else throw notFound('Unknown export');
  return raw('﻿' + L.toCsv([head, ...rows]), 'text/csv; charset=utf-8', `${k}_${L.istDate()}.csv`);
});

// ================= SEARCH & AUDIT =================
r.get('/api/search', (ctx) => {
  const q = String(ctx.query.q || '').trim(); if (q.length < 2) return { leads: [], bookings: [], plots: [], projects: [], activities: [] };
  const t = `%${q}%`, digits = q.replace(/\D/g, '');
  const sl = scope(ctx, 'l.assigned_to'), sb = scope(ctx, 'b.sold_by');
  return {
    leads: all(`SELECT l.id,l.name,l.phone_norm,l.stage,u.name AS rep_name FROM leads l LEFT JOIN users u ON u.id=l.assigned_to WHERE l.org_id=? AND (l.name LIKE ? OR l.email LIKE ? OR l.notes LIKE ? OR (?<>'' AND l.phone_norm LIKE ?))${sl.sql} ORDER BY (l.name LIKE ?) DESC, l.updated_at DESC LIMIT 8`,
      ctx.oid, t, t, t, digits.length > 2 ? digits : '', `%${digits}%`, `${q}%`, ...sl.args),
    bookings: all(`SELECT b.id,b.booking_no,b.buyer_name FROM bookings b WHERE b.org_id=? AND (b.booking_no LIKE ? OR b.buyer_name LIKE ? OR (?<>'' AND b.buyer_phone LIKE ?))${sb.sql} LIMIT 5`, ctx.oid, t, t, digits.length > 2 ? digits : '', `%${digits}%`, ...sb.args),
    projects: all("SELECT id,name,location,city FROM projects WHERE org_id=? AND (name LIKE ? OR location LIKE ? OR city LIKE ? OR rera_no LIKE ?) ORDER BY (name LIKE ?) DESC LIMIT 5", ctx.oid, t, t, t, t, `${q}%`),
    plots: all('SELECT pl.id,pl.plot_no,pl.status,pr.name AS project_name,pr.id AS project_id FROM plots pl JOIN projects pr ON pr.id=pl.project_id WHERE pl.org_id=? AND pl.plot_no LIKE ? LIMIT 5', ctx.oid, t),
    activities: all(`SELECT a.id,a.type,a.content,a.lead_id,l.name AS lead_name FROM activities a JOIN leads l ON l.id=a.lead_id WHERE a.org_id=? AND a.type IN ('note','call','whatsapp','visit') AND a.content LIKE ?${sl.sql} ORDER BY a.id DESC LIMIT 5`, ctx.oid, t, ...sl.args),
  };
});
r.get('/api/audit', { admin: true }, (ctx) => all('SELECT a.*, u.name AS user_name FROM audit_log a LEFT JOIN users u ON u.id=a.user_id WHERE a.org_id=? ORDER BY a.id DESC LIMIT 300', ctx.oid));

// ================= REALPILOT AI ASSISTANT =================
function pipelineInsights(ctx) {
  const oid = ctx.oid, sl = scope(ctx, 'l.assigned_to'), lines = [];
  const stages = all(`SELECT l.stage, COUNT(*) c FROM leads l WHERE l.org_id=?${sl.sql} GROUP BY 1`, oid, ...sl.args);
  const by = Object.fromEntries(stages.map((s) => [s.stage, s.c])); const total = stages.reduce((a, b) => a + b.c, 0);
  lines.push(`**Pipeline${ctx.isAdmin ? '' : ' (your leads)'}:** ${total} leads — ` + L.STAGES.map((s) => `${s} ${by[s] || 0}`).join(' · '));
  const cold48 = get(`SELECT COUNT(*) c FROM leads l WHERE l.org_id=? AND l.rating='Hot' AND l.stage NOT IN ('Booked','Lost') AND COALESCE(l.last_activity_at,l.created_at)<?${sl.sql}`, oid, addMs(-48 * 3600e3), ...sl.args).c;
  if (cold48) lines.push(`⚠️ **${cold48} hot lead(s)** have had no activity for 48+ hours — call them first.`);
  const stuck = get(`SELECT COUNT(*) c FROM leads l WHERE l.org_id=? AND l.stage='Site Visit Completed' AND l.updated_at<?${sl.sql}`, oid, addMs(-3 * 864e5), ...sl.args).c;
  if (stuck) lines.push(`📍 **${stuck} lead(s)** completed a site visit 3+ days ago but haven't moved to negotiation — follow up on the visit feedback.`);
  const st = scope(ctx, 't.assigned_to');
  const overdue = get(`SELECT COUNT(*) c FROM tasks t WHERE t.org_id=? AND t.status='open' AND t.due_at<?${st.sql}`, oid, now(), ...st.args).c;
  if (overdue) lines.push(`⏰ **${overdue} overdue task(s)** need attention.`);
  if (ctx.isAdmin) {
    const un = get("SELECT COUNT(*) c FROM leads WHERE org_id=? AND assigned_to IS NULL AND stage NOT IN ('Booked','Lost')", oid).c;
    if (un) lines.push(`📥 **${un} unassigned lead(s)** are waiting. Say "distribute ${Math.min(un, 20)} leads to <rep name>" or run the assignment rules.`);
    const risky = all("SELECT * FROM users WHERE org_id=? AND role='rep' AND status='active'", oid).map((u) => ({ u, h: L.repHealth(oid, u) })).filter((x) => x.h.status === 'Inactive');
    if (risky.length) lines.push(`🧑‍💼 **Inactive reps:** ${risky.map((x) => `${x.u.name} (${x.h.untouched} untouched leads)`).join(', ')}.`);
    const src = all("SELECT source, COUNT(*) leads, SUM(CASE WHEN stage='Booked' THEN 1 ELSE 0 END) won FROM leads WHERE org_id=? GROUP BY 1 HAVING leads>=3 ORDER BY (won*1.0/leads) DESC LIMIT 1", oid)[0];
    if (src && src.won) lines.push(`🏆 **Best source:** ${src.source} — ${src.won} booked from ${src.leads} leads (${pct(src.won, src.leads)}%).`);
    const od = get("SELECT COALESCE(SUM(i.amount-i.paid_amount),0) s, COUNT(DISTINCT i.booking_id) c FROM installments i JOIN bookings b ON b.id=i.booking_id WHERE i.org_id=? AND b.status<>'cancelled' AND i.paid_amount<i.amount-0.5 AND i.due_date<?", oid, L.istDate());
    if (od.s) lines.push(`💰 **${money(od.s)} overdue** across ${od.c} booking(s) — see Collections.`);
    const av = get("SELECT COUNT(*) c FROM plots WHERE org_id=? AND status='available'", oid).c;
    lines.push(`🗺️ **Inventory:** ${av} plot(s) available.`);
  }
  if (lines.length === 1) lines.push('Everything looks on track. Keep following up!');
  return lines.join('\n\n');
}
function findRep(oid, name) {
  const n = name.trim().toLowerCase().replace(/[^a-z0-9 ]/g, '');
  const reps = all("SELECT id,name FROM users WHERE org_id=? AND status='active'", oid);
  const exact = reps.filter((u) => u.name.toLowerCase().replace(/[^a-z0-9 ]/g, '') === n);
  if (exact.length) return exact;
  const tokens = n.split(/\s+/).filter(Boolean);
  return reps.filter((u) => { const un = u.name.toLowerCase().replace(/[^a-z0-9 ]/g, ''); return tokens.length && tokens.every((t) => un.split(/\s+/).some((w) => w.startsWith(t))); });
}
function localAnswer(ctx, msg, lead) {
  const m = msg.toLowerCase();
  // --- real CRM action: distribute N leads to <rep> ---
  const act = /\b(?:distribute|assign|allocate|give|hand over|send)\s+(\d+)\s+(?:new\s+|fresh\s+|unassigned\s+)?leads?\s+(?:to|for)\s+(.+?)[\s.!?]*$/i.exec(msg);
  if (act) {
    if (!ctx.isAdmin) return { reply: 'Only admins can assign leads. Ask your admin, or use "Report as duplicate" if a lead is not yours.' };
    const want = Number(act[1]);
    if (want < 1 || want > 500) return { reply: 'Please ask for between 1 and 500 leads at a time.' };
    const matches = findRep(ctx.oid, act[2]);
    if (!matches.length) return { reply: `I couldn't find an active team member named **"${act[2]}"**, so nothing was assigned.` };
    if (matches.length > 1) return { reply: `More than one team member matches "${act[2]}": ${matches.map((x) => `**${x.name}**`).join(', ')}. Which one do you mean? (Nothing was assigned.)` };
    const rep = matches[0];
    const avail = get("SELECT COUNT(*) c FROM leads WHERE org_id=? AND assigned_to IS NULL AND stage NOT IN ('Booked','Lost') AND flag_status<>'spam'", ctx.oid).c;
    if (!avail) return { reply: `There are no unassigned leads right now, so nothing was assigned to **${rep.name}**.` };
    const done = L.distributeLeads(ctx.oid, rep.id, Math.min(want, avail), ctx.user);
    L.audit(ctx.oid, ctx.user.id, 'ai.distribute', 'user', rep.id, `${done} leads`);
    return { reply: done === want ? `✅ Done — assigned **${done} leads** to **${rep.name}** and notified them.` : `✅ Assigned **${done} of the ${want}** leads you asked for to **${rep.name}** — only ${avail} unassigned lead(s) were available. They've been notified.`, action: { type: 'distribute', rep_id: rep.id, assigned: done } };
  }
  if (/\b(pipeline|insight|summary|how (are|is) (we|things|business)|status)\b/.test(m)) return { reply: pipelineInsights(ctx) };
  if (/\b(overdue|pending payment|collection|dues?|outstanding)\b/.test(m)) {
    const sb = scope(ctx, 'b.sold_by');
    const rows = all(`SELECT b.booking_no,b.buyer_name,i.label,i.due_date,(i.amount-i.paid_amount) due FROM installments i JOIN bookings b ON b.id=i.booking_id WHERE i.org_id=? AND b.status<>'cancelled' AND i.paid_amount<i.amount-0.5 AND i.due_date<?${sb.sql} ORDER BY i.due_date LIMIT 8`, ctx.oid, L.istDate(), ...sb.args);
    return { reply: rows.length ? `**Overdue payments:**\n` + rows.map((x) => `• ${x.buyer_name} (${x.booking_no}) — ${x.label} ${money(x.due)}, due ${x.due_date}`).join('\n') : 'No overdue payments right now. 🎉' };
  }
  if (/\bhot leads?\b/.test(m)) {
    const sl = scope(ctx, 'l.assigned_to');
    const rows = all(`SELECT l.name,l.stage,l.score,u.name rep FROM leads l LEFT JOIN users u ON u.id=l.assigned_to WHERE l.org_id=? AND l.rating='Hot' AND l.stage NOT IN ('Booked','Lost')${sl.sql} ORDER BY l.score DESC LIMIT 8`, ctx.oid, ...sl.args);
    return { reply: rows.length ? '**Top hot leads:**\n' + rows.map((x) => `• ${x.name} — ${x.stage}, score ${x.score}${x.rep ? ' (' + x.rep + ')' : ''}`).join('\n') : 'No hot leads at the moment.' };
  }
  if (/\b(follow.?ups?|tasks?|agenda|to.?do)\b/.test(m)) {
    const st = scope(ctx, 't.assigned_to');
    const rows = all(`SELECT t.title,t.due_at,l.name lead FROM tasks t LEFT JOIN leads l ON l.id=t.lead_id WHERE t.org_id=? AND t.status='open' AND t.due_at<?${st.sql} ORDER BY t.due_at LIMIT 10`, ctx.oid, L.dayRange(L.istDate()).to, ...st.args);
    return { reply: rows.length ? '**Follow-ups due today or overdue:**\n' + rows.map((x) => `• ${x.title}${x.lead ? ' — ' + x.lead : ''} (${new Date(x.due_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })})`).join('\n') : 'Nothing due today. You are all caught up ✅' };
  }
  if (/\bunassigned\b/.test(m)) { const c = get("SELECT COUNT(*) c FROM leads WHERE org_id=? AND assigned_to IS NULL AND stage NOT IN ('Booked','Lost')", ctx.oid).c; return { reply: `There are **${c}** unassigned open lead(s).${c ? ' Say e.g. "distribute 10 leads to <rep name>".' : ''}` }; }
  if (/\b(available )?plots?\b.*\b(available|left|free|inventory|stock)\b|\b(available|inventory|stock)\b.*\bplots?\b/.test(m)) {
    const rows = all("SELECT pr.name, COUNT(*) c, MIN(pl.area_sqyd) mn, MAX(pl.area_sqyd) mx FROM plots pl JOIN projects pr ON pr.id=pl.project_id WHERE pl.org_id=? AND pl.status='available' GROUP BY pr.id", ctx.oid);
    return { reply: rows.length ? '**Available plots:**\n' + rows.map((x) => `• ${x.name}: ${x.c} plot(s), ${x.mn}–${x.mx} sq.yd`).join('\n') : 'No plots are available right now.' };
  }
  if (ctx.isAdmin && /\b(inactive|at.?risk|health|slow)\b/.test(m)) {
    const rows = all("SELECT * FROM users WHERE org_id=? AND role='rep' AND status='active'", ctx.oid).map((u) => ({ u, h: L.repHealth(ctx.oid, u) }));
    return { reply: '**Rep health:**\n' + (rows.map((x) => `• ${x.u.name}: ${x.h.status} — ${x.h.open_leads} open, ${x.h.untouched} untouched 48h+`).join('\n') || 'No active reps.') };
  }
  if (/\b(whatsapp|message|msg|draft|write)\b/.test(m) && lead) {
    const pr = lead.pref_project_id ? get('SELECT name FROM projects WHERE id=?', lead.pref_project_id) : null;
    const first = lead.name.split(' ')[0];
    const draft = /visit/.test(m)
      ? `Hi ${first}, this is ${ctx.user.name} from ${L.getOrg(ctx.oid).name}. Would you like to visit ${pr ? pr.name : 'our layout'} this weekend? We'll arrange free pickup and show you the best available plots. What time suits you?`
      : /price|cost|rate|budget/.test(m)
        ? `Hi ${first}, thanks for your interest${pr ? ' in ' + pr.name : ''}. I'm sharing the latest price sheet and available plots${lead.pref_size_min ? ' around ' + lead.pref_size_min + ' sq.yd' : ''}. Prices are revised soon, so booking early helps. Shall I hold a plot for you for 48 hours?`
        : `Hi ${first}, this is ${ctx.user.name} from ${L.getOrg(ctx.oid).name}. Following up on your plot enquiry${pr ? ' for ' + pr.name : ''}. Do you have 5 minutes today to discuss the options that match your budget?`;
    return { reply: `Here's a WhatsApp draft for **${lead.name}**:\n\n> ${draft}` };
  }
  if (/\bobjection|too expensive|costly|think about it|not sure|expensive\b/.test(m))
    return { reply: '**Handling "it\'s expensive / I need to think":**\n• Acknowledge, then ask what they are comparing with ("Which other layout are you considering?").\n• Reframe to value: approvals (DTCP/RERA), clear title, road width, development progress, appreciation in the area.\n• Offer a flexible plan (lower down payment + monthly EMIs) instead of a discount.\n• Create honest urgency: "This corner plot is on hold for another buyer until Friday."\n• End with a next step: site visit slot or a 48-hour hold with a small token.' };
  if (/\bsummar/.test(m) && lead) {
    const acts = all("SELECT type,content,created_at FROM activities WHERE lead_id=? AND org_id=? AND type IN ('call','whatsapp','note','visit','stage') ORDER BY id DESC LIMIT 6", lead.id, ctx.oid);
    return { reply: `**${lead.name}** — ${lead.stage}, ${lead.rating} (score ${lead.score}). Budget ${lead.budget_max ? money(lead.budget_max) : 'n/a'}.\n` + (acts.length ? acts.map((a) => `• ${a.type}: ${a.content || ''}`).join('\n') : 'No activity logged yet.') };
  }
  return null;
}
async function callClaude(ctx, msg, lead, history) {
  const key = L.getSettings(ctx.oid).anthropic_key || process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const org = L.getOrg(ctx.oid), s = L.getSettings(ctx.oid);
  const sys = [`You are RealPilot, a sales assistant inside a CRM used by ${org.name}, a company that sells residential plots (layouts) in India. Prices are in INR (₹) and plot sizes in square yards. Be concise, practical and warm. When drafting WhatsApp messages keep them short and human.`,
    `You are talking to ${ctx.user.name} (${ctx.user.role}).`, s.ai_prompt ? `Company instructions: ${s.ai_prompt}` : '',
    lead ? `Current lead: ${lead.name}, stage ${lead.stage}, rating ${lead.rating}, budget ${lead.budget_min || ''}-${lead.budget_max || ''}, preferred size ${lead.pref_size_min || '?'} sq.yd, notes: ${lead.notes || 'none'}.` : '',
    'You cannot perform CRM actions yourself; tell the user to use the CRM screens for that.'].filter(Boolean).join('\n');
  const messages = [...history.slice(-8).map((h) => ({ role: h.role, content: h.content })), { role: 'user', content: msg }];
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5', max_tokens: 700, system: sys, messages }),
    });
    const j = await res.json();
    if (!res.ok) return { reply: `The AI service returned an error (${j.error?.message || res.status}). Check the API key in Settings.` };
    return { reply: (j.content || []).map((c) => c.text || '').join('').trim() || 'I could not produce an answer.' };
  } catch (e) { return { reply: 'I could not reach the AI service right now. Local CRM commands still work (e.g. "distribute 10 leads to <name>", "hot leads", "pipeline summary").' }; }
}
r.post('/api/ai/chat', { admin: true }, async (ctx) => {
  const msg = str(ctx.body.message); if (!msg) throw bad('Type a message');
  if (msg.length > 2000) throw bad('Message is too long');
  let lead = null;
  if (ctx.body.lead_id) {
    lead = get('SELECT * FROM leads WHERE id=? AND org_id=?', Number(ctx.body.lead_id), ctx.oid);
    if (!lead || (!ctx.isAdmin && lead.assigned_to !== ctx.user.id)) lead = null;
  }
  const history = all('SELECT role,content FROM ai_messages WHERE org_id=? AND user_id=? ORDER BY id DESC LIMIT 10', ctx.oid, ctx.user.id).reverse();
  run('INSERT INTO ai_messages(org_id,user_id,role,content,at) VALUES (?,?,?,?,?)', ctx.oid, ctx.user.id, 'user', msg, now());
  let out = localAnswer(ctx, msg, lead) || (await callClaude(ctx, msg, lead, history));
  if (!out) out = { reply: `I can run CRM commands right away — try:\n• "distribute 20 leads to <rep name>"\n• "pipeline summary" · "hot leads" · "follow-ups today"\n• "overdue payments" · "available plots" · "inactive reps"\n• open a lead and ask me to "draft a WhatsApp for a site visit"\n\nFor open-ended sales coaching, add your Anthropic API key in **Settings → AI assistant**.` };
  run('INSERT INTO ai_messages(org_id,user_id,role,content,at) VALUES (?,?,?,?,?)', ctx.oid, ctx.user.id, 'assistant', out.reply, now());
  return out;
});
r.get('/api/ai/history', { admin: true }, (ctx) => all('SELECT role,content,at FROM ai_messages WHERE org_id=? AND user_id=? ORDER BY id DESC LIMIT 40', ctx.oid, ctx.user.id).reverse());
r.del('/api/ai/history', { admin: true }, (ctx) => { run('DELETE FROM ai_messages WHERE org_id=? AND user_id=?', ctx.oid, ctx.user.id); return { ok: true }; });

// ----- "Aaj ka haal": the owner's one-screen morning view — a few numbers and the 3 things that most need attention -----
r.get('/api/briefing', { admin: true }, (ctx) => {
  const oid = ctx.oid, today = L.istDate(), td = L.dayRange(today), yd = L.dayRange(L.istDate(Date.now() - 864e5));
  const count = (sql, ...a) => get(sql, ...a).c;
  const calls = (rg) => get("SELECT COUNT(*) c, SUM(CASE WHEN outcome='Connected' THEN 1 ELSE 0 END) ok FROM activities WHERE org_id=? AND type='call' AND COALESCE(outcome,'')<>'Initiated' AND created_at>=? AND created_at<?", oid, rg.from, rg.to);
  const leadsIn = (rg) => count('SELECT COUNT(*) c FROM leads WHERE org_id=? AND created_at>=? AND created_at<?', oid, rg.from, rg.to);
  const c1 = calls(td), c0 = calls(yd);
  const sales = get("SELECT COUNT(*) c, COALESCE(SUM(total),0) v FROM bookings WHERE org_id=? AND status<>'cancelled' AND booked_on=?", oid, today);
  const collected = get("SELECT COALESCE(SUM(amount),0) s FROM payments WHERE org_id=? AND kind='receipt' AND voided=0 AND paid_on=?", oid, today).s;
  const nowIso = now();
  const numbers = {
    new_leads: leadsIn(td), new_leads_yesterday: leadsIn(yd),
    calls: c1.c, calls_yesterday: c0.c, connected: c1.ok || 0,
    overdue_followups: count("SELECT COUNT(*) c FROM tasks WHERE org_id=? AND status='open' AND due_at<?", oid, nowIso),
    visits_today: count("SELECT COUNT(*) c FROM visits WHERE org_id=? AND status='scheduled' AND scheduled_at>=? AND scheduled_at<?", oid, td.from, td.to),
    bookings_today: sales.c, sales_today: sales.v, collected_today: collected,
  };

  // per rep: calls today, untouched open leads, clocked in?
  const reps = all("SELECT * FROM users WHERE org_id=? AND role='rep' AND status='active' ORDER BY name", oid).map((u) => {
    const h = L.repHealth(oid, u);
    const c = get("SELECT COUNT(*) c FROM activities WHERE org_id=? AND user_id=? AND type='call' AND COALESCE(outcome,'')<>'Initiated' AND created_at>=? AND created_at<?", oid, u.id, td.from, td.to).c;
    const att = get('SELECT clock_in FROM attendance WHERE user_id=? AND date=?', u.id, today);
    return { id: u.id, name: u.name, calls: c, open_leads: h.open_leads, untouched: h.untouched, clocked_in: !!att?.clock_in, status: h.status };
  }).sort((a, b) => b.calls - a.calls);

  // candidate alerts, each with a severity; the three highest are shown
  const A = [];
  const add = (sev, key, title, detail, href) => A.push({ sev, key, title, detail, href });
  const waiting = all("SELECT l.id,l.name,l.created_at FROM leads l WHERE l.org_id=? AND l.stage='New' AND l.last_activity_at IS NULL AND l.flag_status<>'spam' AND l.created_at<? ORDER BY l.created_at LIMIT 50", oid, addMs(-3600e3));
  if (waiting.length) add(95, 'uncontacted', `${waiting.length} new lead${waiting.length > 1 ? 's' : ''} not called yet`, `Oldest has been waiting ${Math.max(1, Math.round((Date.now() - Date.parse(waiting[0].created_at)) / 3.6e6))}h — ${waiting[0].name}`, '#/leads?uncontacted=1');
  const unassigned = count("SELECT COUNT(*) c FROM leads WHERE org_id=? AND assigned_to IS NULL AND stage NOT IN ('Booked','Lost') AND flag_status<>'spam'", oid);
  if (unassigned) add(90, 'unassigned', `${unassigned} lead${unassigned > 1 ? 's have' : ' has'} no rep`, 'Nobody is working these — assign them from the Leads page', '#/leads?tab=unassigned');
  const cold = count("SELECT COUNT(*) c FROM leads WHERE org_id=? AND rating='Hot' AND stage NOT IN ('Booked','Lost') AND COALESCE(last_activity_at,created_at)<?", oid, addMs(-48 * 3600e3));
  if (cold) add(85, 'cooling', `${cold} hot lead${cold > 1 ? 's are' : ' is'} going cold`, 'No call or note for 48+ hours', '#/leads?cooling=1');
  const overdue = get("SELECT COALESCE(SUM(i.amount-i.paid_amount),0) s, COUNT(DISTINCT i.booking_id) n FROM installments i JOIN bookings b ON b.id=i.booking_id WHERE i.org_id=? AND b.status<>'cancelled' AND i.paid_amount<i.amount-0.5 AND i.due_date<?", oid, today);
  if (overdue.n) add(80, 'payments', `${money(overdue.s)} overdue from ${overdue.n} booking${overdue.n > 1 ? 's' : ''}`, 'Installments past their due date', '#/collections');
  if (numbers.overdue_followups) add(70, 'followups', `${numbers.overdue_followups} follow-up${numbers.overdue_followups > 1 ? 's are' : ' is'} overdue`, 'Open tasks past their due time', '#/tasks?bucket=overdue');
  const hr = new Date(Date.now() + 330 * 60000).getUTCHours();
  const idle = reps.filter((x) => x.open_leads > 0 && x.calls === 0);
  if (idle.length && hr >= 11) add(75, 'idle', `${idle.length} rep${idle.length > 1 ? 's have' : ' has'} made no calls today`, idle.slice(0, 3).map((x) => x.name).join(', ') + (idle.length > 3 ? '…' : ''), '#/team');
  const disc = count("SELECT COUNT(*) c FROM discount_requests WHERE org_id=? AND status='pending'", oid);
  if (disc) add(60, 'discounts', `${disc} discount request${disc > 1 ? 's' : ''} waiting for you`, 'Reps cannot book at the discount until you decide', '#/discounts');
  const tpl = count("SELECT COUNT(*) c FROM templates WHERE org_id=? AND share_status='pending'", oid);
  if (tpl) add(40, 'templates', `${tpl} message template${tpl > 1 ? 's' : ''} to approve`, 'Reps asked to share them with the team', '#/comms?tab=templates');
  if (numbers.visits_today) add(50, 'visits', `${numbers.visits_today} site visit${numbers.visits_today > 1 ? 's' : ''} today`, 'Make sure a rep is assigned to each', '#/visits?when=today');
  const alerts = A.sort((a, b) => b.sev - a.sev).slice(0, 3).map(({ sev, ...x }) => x);
  return { date: today, name: ctx.user.name, numbers, alerts, reps };
});
