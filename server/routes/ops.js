// Phone alerts feed, notification preferences, rep availability, team load, visit "on the way", lead aging.
const { r } = require('../router');
const { all, get, run, tx } = require('../db');
const L = require('../lib');
const { bad, forbidden, notFound, now, addMs, str } = L;

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const TIME = /^([01]?\d|2[0-3]):[0-5]\d$/;

// ----- phone alerts: the companion app holds this request open and gets new notifications the moment they exist -----
// GET /api/device/alerts?after=<last id seen>&wait=<seconds>   (omit "after" on first run: returns only the current position)
r.get('/api/device/alerts', async (ctx) => {
  const u = ctx.user, prefs = L.getPrefs(u);
  const top = () => get('SELECT MAX(id) m FROM notifications WHERE org_id=?', u.org_id).m || 0;
  if (ctx.query.after === undefined) return { items: [], last_id: top(), server_time: now() };
  const after = Math.max(0, Number(ctx.query.after) || 0);
  const wait = Math.min(28, Math.max(0, Number(ctx.query.wait) || 0));
  const deadline = Date.now() + wait * 1000;
  for (;;) {
    const rows = L.visibleNotifications(u, { afterId: after, limit: 30 }).reverse().filter((n) => n.created_at > addMs(-6 * 3600e3));
    const hidden = Math.max(after, ...L.visibleNotifications(u, { afterId: after, limit: 30 }).map((n) => n.id));
    const items = rows.filter((n) => prefs.kinds[n.kind || 'other'] !== false).map((n) => ({
      id: n.id, title: n.title, message: n.message, link: n.link, kind: n.kind || 'other', action_url: n.action_url, action_label: n.action_label,
      silent: L.inDnd(prefs), created_at: n.created_at }));
    if (items.length || Date.now() >= deadline) return { items, last_id: Math.max(hidden, after), server_time: now() };
    if (ctx.req.destroyed) return { items: [], last_id: after };
    await sleep(1500);
  }
});

// ----- my notification preferences & availability -----
const mePrefs = (u) => ({ ...L.getPrefs(u), availability: u.availability, unavailable_until: u.unavailable_until, work: L.workHours(u.org_id, u), kinds_available: L.PUSH_KINDS });
r.get('/api/me/notif-prefs', (ctx) => mePrefs(ctx.user));
r.put('/api/me/notif-prefs', (ctx) => {
  const b = ctx.body, cur = L.getPrefs(ctx.user), next = { kinds: { ...cur.kinds }, dnd: { ...cur.dnd }, briefing_time: cur.briefing_time };
  if (b.kinds) for (const k of L.PUSH_KINDS) if (k in b.kinds) next.kinds[k] = !!b.kinds[k];
  if (b.dnd) {
    if (b.dnd.start !== undefined) { if (!TIME.test(b.dnd.start)) throw bad('Enter the do-not-disturb start time as HH:MM'); next.dnd.start = b.dnd.start; }
    if (b.dnd.end !== undefined) { if (!TIME.test(b.dnd.end)) throw bad('Enter the do-not-disturb end time as HH:MM'); next.dnd.end = b.dnd.end; }
    if (b.dnd.enabled !== undefined) next.dnd.enabled = !!b.dnd.enabled;
  }
  if (b.briefing_time !== undefined) { if (b.briefing_time && !TIME.test(b.briefing_time)) throw bad('Enter the briefing time as HH:MM'); next.briefing_time = b.briefing_time || ''; }
  run('UPDATE users SET notif_prefs=? WHERE id=?', JSON.stringify(next), ctx.user.id);
  return mePrefs({ ...ctx.user, notif_prefs: JSON.stringify(next) });
});

function setAvailability(oid, actor, u, b) {
  const a = b.availability;
  if (!['available', 'off_duty', 'on_leave'].includes(a)) throw bad('Choose available, off duty or on leave');
  let until = null;
  if (a === 'on_leave') {
    if (!b.until || isNaN(Date.parse(b.until))) throw bad('Choose the date you are back');
    until = L.dayRange(String(b.until).slice(0, 10)).to;          // back at the start of the day after the chosen date
  }
  run('UPDATE users SET availability=?, unavailable_until=? WHERE id=?', a, until, u.id);
  const w = {};
  for (const k of ['work_start', 'work_end']) if (k in b) { if (b[k] && !TIME.test(b[k])) throw bad('Enter working hours as HH:MM'); w[k] = b[k] || null; }
  if ('work_days' in b) { const d = Array.isArray(b.work_days) ? b.work_days.map(Number).filter((x) => x >= 0 && x <= 6) : []; w.work_days = b.work_days === null || !Array.isArray(b.work_days) ? null : d.join(','); }
  for (const [k, v] of Object.entries(w)) run(`UPDATE users SET ${k}=? WHERE id=?`, v, u.id);
  if (a !== 'available' && actor.id === u.id) L.notifyAdmins(oid, `${u.name} is ${a === 'on_leave' ? 'on leave' : 'off duty'}`, `New leads will not be routed to ${u.name}${until ? ' until ' + b.until : ''}. ${L.openLeadCount(oid, u.id)} open lead(s) stay with them.`, '#/team', { kind: 'other' });
  L.audit(oid, actor.id, 'team.availability', 'user', u.id, a);
}
r.put('/api/me/availability', (ctx) => { setAvailability(ctx.oid, ctx.user, ctx.user, ctx.body); return mePrefs(get('SELECT * FROM users WHERE id=?', ctx.user.id)); });
r.put('/api/team/:id/availability', { admin: true }, (ctx) => {
  const u = get('SELECT * FROM users WHERE id=? AND org_id=?', Number(ctx.params.id), ctx.oid);
  if (!u) throw notFound('Team member not found');
  setAvailability(ctx.oid, ctx.user, u, ctx.body);
  return { ok: true };
});

// ----- current workload per rep (shown when assigning leads) -----
r.get('/api/team/loads', { admin: true }, (ctx) => {
  const today = L.dayRange(L.istDate()), t = now();
  return all("SELECT * FROM users WHERE org_id=? AND status='active' ORDER BY (role='admin'), name", ctx.oid).map((u) => {
    const h = L.repHealth(ctx.oid, u);
    return { id: u.id, name: u.name, role: u.role, availability: u.availability, on_shift: L.isOnShift(ctx.oid, u), routable: L.isRoutable(ctx.oid, u), unavailable_until: u.unavailable_until,
      open_leads: h.open_leads, untouched: h.untouched,
      overdue_tasks: get("SELECT COUNT(*) c FROM tasks WHERE org_id=? AND assigned_to=? AND status='open' AND due_at<?", ctx.oid, u.id, t).c,
      visits_today: get("SELECT COUNT(*) c FROM visits WHERE org_id=? AND assigned_to=? AND status='scheduled' AND scheduled_at>=? AND scheduled_at<?", ctx.oid, u.id, today.from, today.to).c };
  });
});

// ----- visit lifecycle: client is on the way -----
r.post('/api/visits/:id/on-the-way', (ctx) => {
  const v = get('SELECT v.*, l.name AS lead_name, l.assigned_to AS lead_rep FROM visits v JOIN leads l ON l.id=v.lead_id WHERE v.id=? AND v.org_id=?', Number(ctx.params.id), ctx.oid);
  if (!v || (!ctx.isAdmin && v.assigned_to !== ctx.user.id && v.lead_rep !== ctx.user.id)) throw notFound('Visit not found');
  if (v.status !== 'scheduled') throw bad('This visit is already closed');
  run('UPDATE visits SET on_way_at=? WHERE id=?', now(), v.id);
  L.logActivity(ctx.oid, v.lead_id, ctx.user.id, 'visit', { content: 'Client is on the way to the site' });
  if (v.assigned_to && v.assigned_to !== ctx.user.id) L.notify(ctx.oid, { user: v.assigned_to, kind: 'visit', title: 'Client is on the way', message: `${v.lead_name} is heading to the site`, link: `#/leads/${v.lead_id}` });
  return { ok: true };
});

// ----- lead aging: how long open leads have gone untouched, by rep -----
r.get('/api/reports/lead-aging', { admin: true }, (ctx) => {
  const rows = all("SELECT l.id, l.assigned_to, COALESCE(l.last_activity_at, l.assigned_at, l.created_at) AS touched FROM leads l WHERE l.org_id=? AND l.stage NOT IN ('Booked','Lost')", ctx.oid);
  const B = [['Today', 0, 1], ['1–2 days', 1, 3], ['3–7 days', 3, 8], ['8–14 days', 8, 15], ['15+ days', 15, 99999]];
  const day = (iso) => (Date.now() - Date.parse(iso)) / 864e5;
  const bucketOf = (iso) => B.findIndex(([, a, b]) => day(iso) >= a && day(iso) < b);
  const reps = Object.fromEntries(all("SELECT id,name FROM users WHERE org_id=?", ctx.oid).map((u) => [u.id, u.name]));
  const byRep = {};
  const total = B.map(() => 0);
  for (const x of rows) {
    const k = x.assigned_to || 0, i = bucketOf(x.touched);
    (byRep[k] ||= { id: k, name: k ? reps[k] || 'Unknown' : 'Unassigned', counts: B.map(() => 0), open: 0 });
    byRep[k].counts[i]++; byRep[k].open++; total[i]++;
  }
  return { buckets: B.map(([label]) => label), total, reps: Object.values(byRep).sort((a, b) => b.counts[4] + b.counts[3] - (a.counts[4] + a.counts[3]) || b.open - a.open) };
});

// ----- hand over a rep's work (leave / exit) -----
r.post('/api/team/:id/reassign-all', { admin: true }, (ctx) => {
  const u = get('SELECT * FROM users WHERE id=? AND org_id=?', Number(ctx.params.id), ctx.oid);
  if (!u) throw notFound('Team member not found');
  const b = ctx.body, mode = b.mode === 'distribute' ? 'distribute' : 'one';
  const target = Number(b.to);
  if (mode === 'one' && (!target || target === u.id || !L.activeMember(ctx.oid, target))) throw bad('Choose an active team member to take over');
  const scope = b.scope === 'all' ? '' : " AND stage NOT IN ('Booked','Lost')";
  const leads = all(`SELECT id FROM leads WHERE org_id=? AND assigned_to=?${scope} ORDER BY id`, ctx.oid, u.id);
  const pool = all("SELECT * FROM users WHERE org_id=? AND role='rep' AND status='active' AND id<>?", ctx.oid, u.id).filter((x) => L.isRoutable(ctx.oid, x));
  if (mode === 'distribute' && !pool.length) throw bad('No other rep is available to share the leads with');
  const counts = {};
  tx(() => {
    leads.forEach((l, i) => {
      const to = mode === 'one' ? target : pool.map((p) => ({ p, n: L.openLeadCount(ctx.oid, p.id) })).sort((a, c) => a.n - c.n || a.p.id - c.p.id)[0].p.id;
      L.assignLead(ctx.oid, l.id, to, ctx.user, { silent: true, reason: `handed over from ${u.name}` });
      counts[to] = (counts[to] || 0) + 1;
    });
    if (b.include_tasks !== false) {
      const tgt = mode === 'one' ? target : Number(Object.keys(counts)[0] || 0);
      if (tgt) { run("UPDATE tasks SET assigned_to=? WHERE org_id=? AND assigned_to=? AND status='open'", tgt, ctx.oid, u.id); run("UPDATE visits SET assigned_to=? WHERE org_id=? AND assigned_to=? AND status='scheduled'", tgt, ctx.oid, u.id); }
    }
    for (const [to, n] of Object.entries(counts)) L.notify(ctx.oid, { user: Number(to), kind: 'lead', title: `${n} lead${n > 1 ? 's' : ''} assigned to you`, message: `Handed over from ${u.name}`, link: '#/leads' });
    L.audit(ctx.oid, ctx.user.id, 'team.reassign_all', 'user', u.id, `${leads.length} leads`);
  });
  return { ok: true, moved: leads.length };
});
