// Team management, rep profile / daily activity, attendance, presence.
const { r, raw } = require('../router');
const { all, get, run, tx } = require('../db');
const L = require('../lib');
const { bad, forbidden, notFound, now, addMs, sha, newToken, str, num, period } = L;

const FREE_PLAN_REPS = 15;
const activeRepCount = (oid) => get("SELECT COUNT(*) c FROM users WHERE org_id=? AND role='rep' AND status='active'", oid).c;
const pendingRepInvites = (oid) => get("SELECT COUNT(*) c FROM invites WHERE org_id=? AND role='rep' AND used_at IS NULL AND expires_at>?", oid, now()).c;
function member(oid, id) { const u = get('SELECT * FROM users WHERE id=? AND org_id=?', id, oid); if (!u) throw notFound('Team member not found'); return u; }
const slim = ({ password_hash, failed_attempts, locked_until, notif_prefs, last_briefing, ...u }) => u;

function performance(oid, uid, range = 'month') {
  const p = period(range);
  const b = get("SELECT COUNT(*) c, COALESCE(SUM(total),0) v FROM bookings WHERE org_id=? AND sold_by=? AND status<>'cancelled' AND booked_on>=? AND booked_on<?", oid, uid, p.fromD, p.toD);
  const leads = get('SELECT COUNT(*) c FROM leads WHERE org_id=? AND assigned_to=? AND created_at>=? AND created_at<?', oid, uid, p.from, p.to).c;
  const won = get("SELECT COUNT(*) c FROM leads WHERE org_id=? AND assigned_to=? AND stage='Booked' AND created_at>=? AND created_at<?", oid, uid, p.from, p.to).c;
  const collected = get(`SELECT COALESCE(SUM(p.amount),0) s FROM payments p JOIN bookings b ON b.id=p.booking_id WHERE p.org_id=? AND b.sold_by=? AND p.kind='receipt' AND p.voided=0 AND p.paid_on>=? AND p.paid_on<?`, oid, uid, p.fromD, p.toD).s;
  return { bookings: b.c, sales_value: b.v, leads, conversion: leads ? Math.round((won / leads) * 1000) / 10 : 0, collected };
}

r.get('/api/team', { admin: true }, (ctx) => {
  const users = all('SELECT * FROM users WHERE org_id=? ORDER BY role, name', ctx.oid);
  const reps = activeRepCount(ctx.oid);
  return {
    plan: { name: 'Free', limit: FREE_PLAN_REPS, used: reps, pending_invites: pendingRepInvites(ctx.oid) },
    members: users.map((u) => {
      const perf = performance(ctx.oid, u.id);
      return { ...slim(u), health: L.repHealth(ctx.oid, u), perf,
        target_progress: u.monthly_target ? Math.min(999, Math.round((perf.sales_value / u.monthly_target) * 100)) : null,
        booking_progress: u.target_bookings ? Math.min(999, Math.round((perf.bookings / u.target_bookings) * 100)) : null };
    }),
  };
});
r.get('/api/team/health', { admin: true }, (ctx) =>
  all("SELECT * FROM users WHERE org_id=? AND role='rep' AND status='active' ORDER BY name", ctx.oid).map((u) => ({ id: u.id, name: u.name, ...L.repHealth(ctx.oid, u) })));

// ----- invitations -----
r.post('/api/team/invite', { admin: true }, (ctx) => {
  const b = ctx.body;
  const email = str(b.email)?.toLowerCase(), name = str(b.name);
  if (!name || !email) throw bad('Name and email are required');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw bad('Email format is invalid');
  const role = b.role === 'admin' ? 'admin' : 'rep';
  if (get('SELECT 1 x FROM users WHERE email=?', email)) throw bad('This email already has an account on the platform');
  let phone = null;
  if (b.phone) { phone = L.normPhone(b.phone); if (!phone) throw bad('Enter a valid Indian mobile number'); }
  if (role === 'rep' && activeRepCount(ctx.oid) + pendingRepInvites(ctx.oid) >= FREE_PLAN_REPS) throw bad(`Free plan allows up to ${FREE_PLAN_REPS} active reps. Upgrade to add more.`);
  run('DELETE FROM invites WHERE org_id=? AND email=? AND used_at IS NULL', ctx.oid, email);
  const token = newToken(24);
  run('INSERT INTO invites(org_id,token_hash,name,email,role,phone,specialization,monthly_target,target_bookings,expires_at,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
    ctx.oid, sha(token), name, email, role, phone, str(b.specialization), num(b.monthly_target) || 0, num(b.target_bookings) || 0, addMs(72 * 3600e3), ctx.user.id, now());
  L.audit(ctx.oid, ctx.user.id, 'team.invite', 'user', null, email);
  return { link: `#/invite/${token}`, expires_in_hours: 72 };
});
r.get('/api/team/invites', { admin: true }, (ctx) =>
  all('SELECT id,name,email,role,phone,expires_at,created_at FROM invites WHERE org_id=? AND used_at IS NULL AND expires_at>? ORDER BY id DESC', ctx.oid, now()));
r.del('/api/team/invites/:id', { admin: true }, (ctx) => { run('DELETE FROM invites WHERE id=? AND org_id=? AND used_at IS NULL', ctx.params.id, ctx.oid); return { ok: true }; });

// ----- member actions -----
r.patch('/api/team/:id', { admin: true }, (ctx) => {
  const u = member(ctx.oid, ctx.params.id), b = ctx.body;
  let phone = u.phone;
  if ('phone' in b) { phone = b.phone ? L.normPhone(b.phone) : null; if (b.phone && !phone) throw bad('Enter a valid Indian mobile number'); }
  run('UPDATE users SET name=?, phone=?, specialization=?, monthly_target=?, target_bookings=? WHERE id=?',
    str(b.name) || u.name, phone, 'specialization' in b ? str(b.specialization) : u.specialization,
    'monthly_target' in b ? num(b.monthly_target) || 0 : u.monthly_target, 'target_bookings' in b ? num(b.target_bookings) || 0 : u.target_bookings, u.id);
  return { ok: true };
});
r.post('/api/team/:id/deactivate', { admin: true }, (ctx) => {
  const u = member(ctx.oid, ctx.params.id);
  if (u.role !== 'rep') throw bad('Admins cannot be deactivated');
  run("UPDATE users SET status='inactive' WHERE id=?", u.id);
  run('UPDATE sessions SET ended_at=? WHERE user_id=? AND ended_at IS NULL', now(), u.id);
  L.audit(ctx.oid, ctx.user.id, 'team.deactivate', 'user', u.id, u.email);
  return { ok: true, open_leads: L.openLeadCount(ctx.oid, u.id) };
});
r.post('/api/team/:id/reactivate', { admin: true }, (ctx) => {
  const u = member(ctx.oid, ctx.params.id);
  if (u.role === 'rep' && activeRepCount(ctx.oid) >= FREE_PLAN_REPS) throw bad(`Free plan allows up to ${FREE_PLAN_REPS} active reps.`);
  run("UPDATE users SET status='active', failed_attempts=0, locked_until=NULL WHERE id=?", u.id);
  L.audit(ctx.oid, ctx.user.id, 'team.reactivate', 'user', u.id, u.email);
  return { ok: true };
});
r.post('/api/team/:id/reset-link', { admin: true }, (ctx) => {
  const u = member(ctx.oid, ctx.params.id);
  const token = newToken(24);
  run('INSERT INTO resets(user_id,token_hash,expires_at) VALUES (?,?,?)', u.id, sha(token), addMs(3600e3));
  L.audit(ctx.oid, ctx.user.id, 'team.reset_link', 'user', u.id, u.email);
  return { link: `#/reset/${token}`, expires_in_minutes: 60 };
});
r.post('/api/team/:id/delete', { admin: true }, (ctx) => {
  const u = member(ctx.oid, ctx.params.id);
  if (u.role !== 'rep') throw bad('Admins cannot be deleted');
  const target = Number(ctx.body.reassign_to);
  if (!target || target === u.id || !L.activeMember(ctx.oid, target)) throw bad('Choose an active team member (or yourself) to take over this rep\'s leads');
  const open = L.openLeadCount(ctx.oid, u.id);
  tx(() => {
    const ids = all('SELECT id FROM leads WHERE org_id=? AND assigned_to=?', ctx.oid, u.id);
    ids.forEach((l) => L.assignLead(ctx.oid, l.id, target, ctx.user, { silent: true, reason: `reassigned from deleted rep ${u.name}` }));
    run("UPDATE tasks SET assigned_to=? WHERE org_id=? AND assigned_to=? AND status='open'", target, ctx.oid, u.id);
    run("UPDATE visits SET assigned_to=? WHERE org_id=? AND assigned_to=? AND status='scheduled'", target, ctx.oid, u.id);
    run('UPDATE plots SET hold_by=? WHERE org_id=? AND hold_by=? AND status=\'hold\'', target, ctx.oid, u.id);
    for (const rule of all('SELECT * FROM assign_rules WHERE org_id=?', ctx.oid)) {
      const ids2 = JSON.parse(rule.rep_ids || '[]').filter((x) => x !== u.id);
      run('UPDATE assign_rules SET rep_ids=? WHERE id=?', JSON.stringify(ids2), rule.id);
    }
    run('DELETE FROM sessions WHERE user_id=?', u.id);
    run('DELETE FROM attendance WHERE user_id=?', u.id);
    run('DELETE FROM saved_filters WHERE user_id=?', u.id);
    run('DELETE FROM notifications WHERE user_id=? AND org_id=?', u.id, ctx.oid);
    run('DELETE FROM notif_state WHERE user_id=?', u.id);
    run('DELETE FROM resets WHERE user_id=?', u.id);
    run('DELETE FROM users WHERE id=?', u.id);
    if (ids.length) L.notify(ctx.oid, { user: target, title: `${ids.length} leads reassigned to you`, message: `From deleted rep ${u.name}`, link: '#/leads' });
    L.notifyAdmins(ctx.oid, 'Rep profile deleted', `${u.name} was deleted by ${ctx.user.name}. ${ids.length} lead(s) reassigned.`, '#/team');
    L.audit(ctx.oid, ctx.user.id, 'team.delete', 'user', u.id, `${u.email}; ${ids.length} leads → user ${target}`);
  });
  return { ok: true, reassigned: open };
});

// ----- profile & daily activity summary -----
r.get('/api/team/:id/profile', (ctx) => {
  const id = Number(ctx.params.id);
  if (!ctx.isAdmin && id !== ctx.user.id) throw forbidden();
  const u = member(ctx.oid, id);
  const sessions = all('SELECT id,device,ip,created_at,last_seen,ended_at FROM sessions WHERE user_id=? ORDER BY id DESC LIMIT 15', id)
    .map((s) => ({ ...s, online: !s.ended_at && Date.now() - Date.parse(s.last_seen) < 180000 }));
  const strip = (p) => { if (!ctx.isAdmin) delete p.collected; return p; };
  return {
    user: slim(u), health: L.repHealth(ctx.oid, u), perf: strip(performance(ctx.oid, id)), perf_all: strip(performance(ctx.oid, id, 'all')),
    sessions, attendance: all('SELECT * FROM attendance WHERE user_id=? ORDER BY date DESC LIMIT 30', id),
  };
});

function rangeFor(kind, date) {
  const d = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : L.istDate();
  const [y, m, dd] = d.split('-').map(Number);
  const IST = 330 * 60000;
  if (kind === 'month') return { from: new Date(Date.UTC(y, m - 1, 1) - IST).toISOString(), to: new Date(Date.UTC(y, m, 1) - IST).toISOString(), label: d.slice(0, 7) };
  if (kind === 'week') {
    const dow = (new Date(Date.UTC(y, m - 1, dd)).getUTCDay() + 6) % 7;
    const s = Date.UTC(y, m - 1, dd) - dow * 864e5 - IST;
    return { from: new Date(s).toISOString(), to: new Date(s + 7 * 864e5).toISOString(), label: `Week of ${new Date(s + IST).toISOString().slice(0, 10)}` };
  }
  return { ...L.dayRange(d), label: d };
}
r.get('/api/team/:id/activity', (ctx) => {
  const id = Number(ctx.params.id);
  if (!ctx.isAdmin && id !== ctx.user.id) throw forbidden();
  const u = member(ctx.oid, id);
  const rg = rangeFor(ctx.query.range, ctx.query.date);
  const acts = all(`SELECT a.*, l.name AS lead_name FROM activities a LEFT JOIN leads l ON l.id=a.lead_id
    WHERE a.org_id=? AND a.user_id=? AND a.created_at>=? AND a.created_at<? AND a.type IN ('call','whatsapp') ORDER BY a.created_at`, ctx.oid, id, rg.from, rg.to);
  const calls = acts.filter((a) => a.type === 'call'), wa = acts.filter((a) => a.type === 'whatsapp');
  const lim = (x) => x.slice(0, 100);
  const callRow = (a) => ({ id: a.id, lead_id: a.lead_id, lead_name: a.lead_name, at: a.created_at, direction: a.direction, outcome: a.outcome, duration: a.duration });
  const outgoing = calls.filter((c) => c.direction === 'outgoing');
  const nowIso = now();
  const tasksAssigned = all(`SELECT t.*, l.name AS lead_name FROM tasks t LEFT JOIN leads l ON l.id=t.lead_id WHERE t.org_id=? AND t.assigned_to=? AND t.due_at>=? AND t.due_at<?`, ctx.oid, id, rg.from, rg.to);
  const done = all(`SELECT t.*, l.name AS lead_name FROM tasks t LEFT JOIN leads l ON l.id=t.lead_id WHERE t.org_id=? AND t.assigned_to=? AND t.completed_at>=? AND t.completed_at<?`, ctx.oid, id, rg.from, rg.to);
  const created = all(`SELECT t.*, l.name AS lead_name FROM tasks t LEFT JOIN leads l ON l.id=t.lead_id WHERE t.org_id=? AND t.created_by=? AND t.created_at>=? AND t.created_at<?`, ctx.oid, id, rg.from, rg.to);
  const taskRow = (t) => ({ id: t.id, title: t.title, lead_id: t.lead_id, lead_name: t.lead_name, due_at: t.due_at, status: t.status, completed_at: t.completed_at });
  const late = tasksAssigned.filter((t) => t.status === 'open' && t.due_at < nowIso), pending = tasksAssigned.filter((t) => t.status === 'open' && t.due_at >= nowIso);
  return {
    user: { id: u.id, name: u.name }, range: rg,
    calls: {
      first_call: calls[0]?.created_at || null, last_call: calls.length ? calls[calls.length - 1].created_at : null, total: calls.length,
      incoming: calls.filter((c) => c.direction === 'incoming').length, outgoing: outgoing.length,
      missed: calls.filter((c) => c.outcome === 'Missed').length, connected: calls.filter((c) => c.outcome === 'Connected').length,
      attempted: outgoing.length, total_duration: calls.reduce((s, c) => s + (c.duration || 0), 0),
      items: { all: lim(calls.map(callRow)), incoming: lim(calls.filter((c) => c.direction === 'incoming').map(callRow)), outgoing: lim(outgoing.map(callRow)),
        missed: lim(calls.filter((c) => c.outcome === 'Missed').map(callRow)), connected: lim(calls.filter((c) => c.outcome === 'Connected').map(callRow)) },
    },
    tasks: { late: late.length, pending: pending.length, done: done.length, created: created.length,
      items: { late: lim(late.map(taskRow)), pending: lim(pending.map(taskRow)), done: lim(done.map(taskRow)), created: lim(created.map(taskRow)) } },
    whatsapp: { incoming: wa.filter((a) => a.direction === 'incoming').length, outgoing: wa.filter((a) => a.direction === 'outgoing').length,
      items: { incoming: lim(wa.filter((a) => a.direction === 'incoming').map(callRow)), outgoing: lim(wa.filter((a) => a.direction === 'outgoing').map(callRow)) } },
  };
});

// ----- attendance -----
const OFFICE_SHIFT_GRACE_MIN = 15;
r.post('/api/attendance/clock-in', (ctx) => {
  const lat = num(ctx.body.lat), lng = num(ctx.body.lng);
  if (lat === null || lng === null) throw bad('Location permission is required to clock in. Please allow location access and try again.');
  const today = L.istDate();
  const ex = get('SELECT * FROM attendance WHERE user_id=? AND date=?', ctx.user.id, today);
  if (ex && ex.clock_in) throw bad('You have already clocked in today');
  const g = L.getSettings(ctx.oid).geofence;
  let inside = null, dist = null, place = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  if (g.lat !== null && g.lng !== null) {
    dist = Math.round(L.haversine(lat, lng, g.lat, g.lng));
    inside = dist <= g.radius ? 1 : 0;
    if (inside) place = g.name || 'Office';
    else if (g.enforce) throw bad(`You are ${dist} m from the office (allowed ${g.radius} m). Clock-in is only allowed inside the office geofence.`);
    else place = `Outside geofence (${dist} m) — ${place}`;
  }
  const [hh, mm] = (L.getSettings(ctx.oid).shift_start || '10:00').split(':').map(Number);
  const ist = new Date(Date.now() + 330 * 60000);
  const late = ist.getUTCHours() * 60 + ist.getUTCMinutes() > hh * 60 + mm + OFFICE_SHIFT_GRACE_MIN ? 1 : 0;
  if (ex) run('UPDATE attendance SET clock_in=?, lat=?, lng=?, place=?, inside_geofence=?, distance_m=?, late=? WHERE id=?', now(), lat, lng, place, inside, dist, late, ex.id);
  else run('INSERT INTO attendance(org_id,user_id,date,clock_in,lat,lng,place,inside_geofence,distance_m,late) VALUES (?,?,?,?,?,?,?,?,?,?)', ctx.oid, ctx.user.id, today, now(), lat, lng, place, inside, dist, late);
  return get('SELECT * FROM attendance WHERE user_id=? AND date=?', ctx.user.id, today);
});
r.post('/api/attendance/clock-out', (ctx) => {
  const a = get('SELECT * FROM attendance WHERE user_id=? AND date=?', ctx.user.id, L.istDate());
  if (!a || !a.clock_in) throw bad('You have not clocked in today');
  if (a.clock_out) throw bad('You have already clocked out');
  run('UPDATE attendance SET clock_out=? WHERE id=?', now(), a.id);
  return get('SELECT * FROM attendance WHERE id=?', a.id);
});
r.get('/api/attendance/me', (ctx) => ({
  today: get('SELECT * FROM attendance WHERE user_id=? AND date=?', ctx.user.id, L.istDate()) || null,
  history: all('SELECT * FROM attendance WHERE user_id=? ORDER BY date DESC LIMIT 31', ctx.user.id),
  geofence: (({ name, radius, enforce, lat }) => ({ name, radius, enforce, configured: lat !== null }))(L.getSettings(ctx.oid).geofence),
}));
r.get('/api/attendance', { admin: true }, (ctx) => {
  const date = ctx.query.date || L.istDate();
  const rows = all('SELECT a.*, u.name AS user_name FROM attendance a JOIN users u ON u.id=a.user_id WHERE a.org_id=? AND a.date=? ORDER BY a.clock_in', ctx.oid, date);
  const users = all("SELECT id,name FROM users WHERE org_id=? AND status='active'", ctx.oid);
  const present = rows.filter((x) => x.clock_in);
  const m30 = all("SELECT clock_in,clock_out FROM attendance WHERE org_id=? AND clock_out IS NOT NULL AND date>=?", ctx.oid, L.istDate(Date.now() - 30 * 864e5));
  const avgHrs = m30.length ? m30.reduce((s, x) => s + (Date.parse(x.clock_out) - Date.parse(x.clock_in)) / 3.6e6, 0) / m30.length : 0;
  const withGeo = present.filter((x) => x.inside_geofence !== null);
  return {
    date, rows, absent: users.filter((u) => !present.find((p) => p.user_id === u.id)),
    summary: { present: present.length, total: users.length, on_time_pct: present.length ? Math.round((present.filter((x) => !x.late).length / present.length) * 100) : 0,
      avg_shift_hours: Math.round(avgHrs * 10) / 10, geofence_pct: withGeo.length ? Math.round((withGeo.filter((x) => x.inside_geofence).length / withGeo.length) * 100) : null },
  };
});
r.get('/api/attendance/export', { admin: true }, (ctx) => {
  const from = ctx.query.from || L.istDate(Date.now() - 30 * 864e5), to = ctx.query.to || L.istDate();
  const rows = all('SELECT a.*, u.name AS user_name FROM attendance a JOIN users u ON u.id=a.user_id WHERE a.org_id=? AND a.date>=? AND a.date<=? ORDER BY a.date, u.name', ctx.oid, from, to);
  const csv = L.toCsv([['Date', 'Name', 'Clock in', 'Clock out', 'Late', 'Inside geofence', 'Distance (m)', 'Location', 'Note'],
    ...rows.map((x) => [x.date, x.user_name, x.clock_in, x.clock_out, x.late ? 'Yes' : 'No', x.inside_geofence === null ? '' : x.inside_geofence ? 'Yes' : 'No', x.distance_m, x.place, x.note])]);
  return raw(csv, 'text/csv; charset=utf-8', `attendance_${from}_${to}.csv`);
});
r.post('/api/attendance/override', { admin: true }, (ctx) => {
  const b = ctx.body, u = member(ctx.oid, Number(b.user_id));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date || '')) throw bad('Date is required');
  const ci = b.clock_in ? new Date(b.clock_in).toISOString() : null, co = b.clock_out ? new Date(b.clock_out).toISOString() : null;
  const ex = get('SELECT * FROM attendance WHERE user_id=? AND date=?', u.id, b.date);
  if (ex) run('UPDATE attendance SET clock_in=?, clock_out=?, override_by=?, note=? WHERE id=?', ci, co, ctx.user.id, str(b.note) || 'Admin override', ex.id);
  else run('INSERT INTO attendance(org_id,user_id,date,clock_in,clock_out,override_by,note,place) VALUES (?,?,?,?,?,?,?,?)', ctx.oid, u.id, b.date, ci, co, ctx.user.id, str(b.note) || 'Admin override', 'Admin override');
  L.audit(ctx.oid, ctx.user.id, 'attendance.override', 'user', u.id, `${b.date} ${str(b.note) || ''}`);
  return { ok: true };
});

// ----- live presence -----
r.get('/api/presence', { admin: true }, (ctx) => {
  const day = L.dayRange(L.istDate());
  return all("SELECT * FROM users WHERE org_id=? AND status='active' ORDER BY name", ctx.oid).map((u) => {
    const first = get('SELECT MIN(created_at) t FROM sessions WHERE user_id=? AND created_at>=? AND created_at<?', u.id, day.from, day.to).t;
    const last = get('SELECT * FROM sessions WHERE user_id=? ORDER BY last_seen DESC LIMIT 1', u.id);
    const online = !!last && !last.ended_at && Date.now() - Date.parse(last.last_seen) < 180000;
    return { id: u.id, name: u.name, role: u.role, first_login_today: first, last_active: last?.last_seen || u.last_active_at, device: last?.device || '—', online,
      session_minutes: last ? Math.round(((online ? Date.now() : Date.parse(last.ended_at || last.last_seen)) - Date.parse(last.created_at)) / 60000) : 0 };
  });
});
