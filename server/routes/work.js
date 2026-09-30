// Daily work: tasks, site visits, call/WhatsApp logs + webhooks, templates, assignment & automation rules.
const { r } = require('../router');
const { all, get, run, tx } = require('../db');
const L = require('../lib');
const { HttpError, bad, forbidden, notFound, now, addMs, str, num } = L;

function leadFor(ctx, id) {
  const l = get('SELECT * FROM leads WHERE id=? AND org_id=?', Number(id), ctx.oid);
  if (!l || (!ctx.isAdmin && l.assigned_to !== ctx.user.id)) throw notFound('Lead not found');
  return l;
}
const stageIx = (s) => L.STAGES.indexOf(s);

// ================= TASKS =================
const eodIso = () => L.dayRange(L.istDate()).to;
function taskFor(ctx, id) {
  const t = get('SELECT * FROM tasks WHERE id=? AND org_id=?', Number(id), ctx.oid);
  if (!t || (!ctx.isAdmin && t.assigned_to !== ctx.user.id && t.created_by !== ctx.user.id)) throw notFound('Task not found');
  return t;
}
r.get('/api/tasks', (ctx) => {
  const q = ctx.query, n = now(), eod = eodIso();
  let sql = `SELECT t.*, l.name AS lead_name, l.phone_norm AS lead_phone, u.name AS assignee FROM tasks t LEFT JOIN leads l ON l.id=t.lead_id LEFT JOIN users u ON u.id=t.assigned_to WHERE t.org_id=?`;
  const a = [ctx.oid];
  if (!ctx.isAdmin) { sql += ' AND t.assigned_to=?'; a.push(ctx.user.id); }
  else if (q.assigned) { sql += ' AND t.assigned_to=?'; a.push(Number(q.assigned)); }
  if (q.lead_id) { sql += ' AND t.lead_id=?'; a.push(Number(q.lead_id)); }
  const status = q.status === 'done' ? 'done' : 'open';
  sql += ' AND t.status=?'; a.push(status);
  if (status === 'open') {
    if (q.bucket === 'overdue') { sql += ' AND t.due_at < ?'; a.push(n); }
    else if (q.bucket === 'today') { sql += ' AND t.due_at >= ? AND t.due_at < ?'; a.push(n, eod); }
    else if (q.bucket === 'upcoming') { sql += ' AND t.due_at >= ?'; a.push(eod); }
  }
  sql += status === 'done' ? ' ORDER BY t.completed_at DESC LIMIT 200' : ' ORDER BY t.due_at LIMIT 500';
  const soon = Date.now() + 24 * 3600e3;
  const rows = all(sql, ...a).map((t) => ({ ...t, color: t.status === 'done' ? 'done' : Date.parse(t.due_at) < Date.now() ? 'red' : Date.parse(t.due_at) < soon ? 'amber' : 'green' }));
  const base = 'SELECT COUNT(*) c FROM tasks WHERE org_id=? AND status=\'open\'' + (ctx.isAdmin ? '' : ' AND assigned_to=?');
  const ba = ctx.isAdmin ? [ctx.oid] : [ctx.oid, ctx.user.id];
  const counts = {
    overdue: get(base + ' AND due_at < ?', ...ba, n).c, today: get(base + ' AND due_at >= ? AND due_at < ?', ...ba, n, eod).c,
    upcoming: get(base + ' AND due_at >= ?', ...ba, eod).c, all: get(base, ...ba).c,
  };
  return { counts, tasks: rows };
});
r.post('/api/tasks', (ctx) => {
  const b = ctx.body, title = str(b.title);
  if (!title) throw bad('Task title is required');
  if (!b.due_at || isNaN(Date.parse(b.due_at))) throw bad('Choose a due date and time');
  let lead = null;
  if (b.lead_id) lead = leadFor(ctx, b.lead_id);
  let assignee = ctx.user.id;
  if (ctx.isAdmin) assignee = Number(b.assigned_to) || lead?.assigned_to || ctx.user.id;
  if (!L.activeMember(ctx.oid, assignee)) throw bad('Assigned team member not found');
  const x = run('INSERT INTO tasks(org_id,lead_id,title,description,due_at,priority,assigned_to,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
    ctx.oid, lead?.id, title, str(b.description), new Date(b.due_at).toISOString(), ['High', 'Medium', 'Low'].includes(b.priority) ? b.priority : 'Medium', assignee, ctx.user.id, now());
  if (lead) L.logActivity(ctx.oid, lead.id, ctx.user.id, 'task', { content: `Task created: ${title} (due ${new Date(b.due_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })})` });
  if (assignee !== ctx.user.id) L.notify(ctx.oid, { user: assignee, title: 'New task assigned', message: `${title}${lead ? ' — ' + lead.name : ''}`, link: lead ? `#/leads/${lead.id}` : '#/tasks' });
  return { id: Number(x.lastInsertRowid) };
});
r.post('/api/tasks/:id/snooze', (ctx) => {
  const t = taskFor(ctx, ctx.params.id);
  if (t.status !== 'open') throw bad('Only open tasks can be rescheduled');
  const mode = ctx.body.mode; let due;
  if (mode === '1h') due = addMs(3600e3);
  else if (mode === 'tomorrow') { const d = L.dayRange(L.istDate(Date.now() + 864e5)); due = addMs(10 * 3600e3, Date.parse(d.from)); }
  else if (mode === 'nextweek') { const d = L.dayRange(L.istDate(Date.now() + 7 * 864e5)); due = addMs(10 * 3600e3, Date.parse(d.from)); }
  else if (mode === 'custom' && ctx.body.due_at && !isNaN(Date.parse(ctx.body.due_at))) due = new Date(ctx.body.due_at).toISOString();
  else throw bad('Choose when to reschedule');
  const n = t.postponed_count + 1;
  run('UPDATE tasks SET due_at=?, postponed_count=?, last_reminded_at=NULL WHERE id=?', due, n, t.id);
  if (t.lead_id) L.logActivity(ctx.oid, t.lead_id, ctx.user.id, 'task', { content: `Task rescheduled: ${t.title} — postponed ${n} time${n > 1 ? 's' : ''}` });
  return { ok: true, postponed_count: n, due_at: due };
});
r.post('/api/tasks/:id/complete', (ctx) => {
  const t = taskFor(ctx, ctx.params.id);
  if (t.status === 'done') return { ok: true };
  run("UPDATE tasks SET status='done', completed_at=? WHERE id=?", now(), t.id);
  if (t.lead_id) L.logActivity(ctx.oid, t.lead_id, ctx.user.id, 'task', { content: `Task completed: ${t.title}${t.postponed_count ? ` (postponed ${t.postponed_count}×)` : ''}` });
  return { ok: true };
});
r.post('/api/tasks/:id/reopen', (ctx) => { const t = taskFor(ctx, ctx.params.id); run("UPDATE tasks SET status='open', completed_at=NULL WHERE id=?", t.id); return { ok: true }; });
r.del('/api/tasks/:id', (ctx) => { const t = taskFor(ctx, ctx.params.id); run('DELETE FROM tasks WHERE id=?', t.id); return { ok: true }; });

// ================= SITE VISITS =================
function visitFor(ctx, id) {
  const v = get('SELECT * FROM visits WHERE id=? AND org_id=?', Number(id), ctx.oid);
  if (!v) throw notFound('Visit not found');
  leadFor(ctx, v.lead_id);
  return v;
}
r.get('/api/visits', (ctx) => {
  const q = ctx.query;
  let sql = `SELECT v.*, l.name AS lead_name, l.phone_norm AS lead_phone, pr.name AS project_name, pl.plot_no, u.name AS rep_name FROM visits v JOIN leads l ON l.id=v.lead_id
    JOIN projects pr ON pr.id=v.project_id LEFT JOIN plots pl ON pl.id=v.plot_id LEFT JOIN users u ON u.id=v.assigned_to WHERE v.org_id=?`;
  const a = [ctx.oid];
  if (!ctx.isAdmin) { sql += ' AND (v.assigned_to=? OR l.assigned_to=?)'; a.push(ctx.user.id, ctx.user.id); }
  if (q.status) { sql += ' AND v.status=?'; a.push(q.status); }
  if (q.when === 'today') { const d = L.dayRange(L.istDate()); sql += ' AND v.scheduled_at>=? AND v.scheduled_at<?'; a.push(d.from, d.to); }
  else if (q.when === 'upcoming') { sql += " AND v.status='scheduled' AND v.scheduled_at>=?"; a.push(L.dayRange(L.istDate()).from); }
  sql += ' ORDER BY v.scheduled_at' + (q.when === 'past' ? ' DESC' : '') + ' LIMIT 300';
  return all(sql, ...a);
});
r.post('/api/visits', (ctx) => {
  const b = ctx.body, lead = leadFor(ctx, b.lead_id);
  if (['Lost', 'Booked'].includes(lead.stage)) throw bad(`A ${lead.stage.toLowerCase()} lead cannot get a new site visit`);
  const pr = get('SELECT * FROM projects WHERE id=? AND org_id=?', Number(b.project_id), ctx.oid);
  if (!pr) throw bad('Choose a project to visit');
  if (!b.scheduled_at || isNaN(Date.parse(b.scheduled_at))) throw bad('Choose date and time of the visit');
  let plotId = null;
  if (b.plot_id) { const pl = get('SELECT * FROM plots WHERE id=? AND org_id=? AND project_id=?', Number(b.plot_id), ctx.oid, pr.id); if (!pl) throw bad('Plot not found in that project'); plotId = pl.id; }
  const rep = ctx.isAdmin && b.assigned_to ? Number(b.assigned_to) : lead.assigned_to || ctx.user.id;
  const when = new Date(b.scheduled_at).toISOString();
  const x = run('INSERT INTO visits(org_id,lead_id,project_id,plot_id,scheduled_at,pickup_required,pickup_address,assigned_to,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    ctx.oid, lead.id, pr.id, plotId, when, !!b.pickup_required, str(b.pickup_address), rep, ctx.user.id, now());
  L.logActivity(ctx.oid, lead.id, ctx.user.id, 'visit', { content: `Site visit scheduled: ${pr.name} on ${new Date(when).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}${b.pickup_required ? ' (pickup needed)' : ''}` });
  if (stageIx(lead.stage) < stageIx('Site Visit Scheduled')) L.setStage(ctx.oid, lead.id, 'Site Visit Scheduled', ctx.user);
  if (rep !== ctx.user.id) L.notify(ctx.oid, { user: rep, title: 'Site visit scheduled', message: `${lead.name} → ${pr.name}, ${new Date(when).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })}`, link: `#/leads/${lead.id}` });
  else if (!ctx.isAdmin) L.notifyAdmins(ctx.oid, 'Site visit scheduled', `${ctx.user.name}: ${lead.name} → ${pr.name}`, `#/leads/${lead.id}`);
  return { id: Number(x.lastInsertRowid) };
});
r.post('/api/visits/:id/complete', (ctx) => {
  const v = visitFor(ctx, ctx.params.id);
  if (v.status !== 'scheduled') throw bad('This visit is already closed');
  const interest = ['High', 'Medium', 'Low'].includes(ctx.body.interest) ? ctx.body.interest : null;
  run("UPDATE visits SET status='completed', feedback=?, interest=?, completed_at=? WHERE id=?", str(ctx.body.feedback), interest, now(), v.id);
  L.logActivity(ctx.oid, v.lead_id, ctx.user.id, 'visit', { content: `Site visit completed${interest ? ` — interest: ${interest}` : ''}${ctx.body.feedback ? '. ' + ctx.body.feedback : ''}` });
  const lead = get('SELECT * FROM leads WHERE id=?', v.lead_id);
  if (stageIx(lead.stage) < stageIx('Site Visit Completed')) L.setStage(ctx.oid, lead.id, 'Site Visit Completed', ctx.user);
  return { ok: true };
});
r.post('/api/visits/:id/status', (ctx) => {
  const v = visitFor(ctx, ctx.params.id);
  if (!['cancelled', 'no_show'].includes(ctx.body.status)) throw bad('Invalid status');
  run('UPDATE visits SET status=? WHERE id=?', ctx.body.status, v.id);
  L.logActivity(ctx.oid, v.lead_id, ctx.user.id, 'visit', { content: `Site visit ${ctx.body.status === 'no_show' ? 'marked no-show' : 'cancelled'}` });
  return { ok: true };
});
r.post('/api/visits/:id/reschedule', (ctx) => {
  const v = visitFor(ctx, ctx.params.id);
  if (v.status !== 'scheduled') throw bad('Only scheduled visits can be rescheduled');
  if (!ctx.body.scheduled_at || isNaN(Date.parse(ctx.body.scheduled_at))) throw bad('Choose a new date and time');
  run('UPDATE visits SET scheduled_at=? WHERE id=?', new Date(ctx.body.scheduled_at).toISOString(), v.id);
  L.logActivity(ctx.oid, v.lead_id, ctx.user.id, 'visit', { content: `Site visit rescheduled to ${new Date(ctx.body.scheduled_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}` });
  return { ok: true };
});

// ================= CALL & WHATSAPP LOG =================
const CALL_OUTCOMES = ['Connected', 'Not Answered', 'Busy', 'Switched Off', 'Wrong Number', 'Voicemail', 'Missed'];
r.post('/api/leads/:id/calls', (ctx) => {
  const l = leadFor(ctx, ctx.params.id), b = ctx.body;
  const direction = b.direction === 'incoming' ? 'incoming' : 'outgoing';
  if (!CALL_OUTCOMES.includes(b.outcome)) throw bad('Choose the call outcome');
  const dur = Math.max(0, Math.round((num(b.duration_min) ?? 0) * 60 + (num(b.duration_sec) ?? 0)) || Math.round(num(b.duration) || 0));
  if (b.outcome === 'Connected' && dur <= 0) throw bad('Enter the call duration for a connected call');
  L.logActivity(ctx.oid, l.id, ctx.user.id, 'call', { direction, outcome: b.outcome, duration: b.outcome === 'Connected' ? dur : 0, content: str(b.notes) });
  if (l.stage === 'New' && b.outcome === 'Connected') L.setStage(ctx.oid, l.id, 'Contacted', ctx.user);
  if (b.outcome === 'Wrong Number') L.notifyAdmins(ctx.oid, 'Wrong number reported', `${ctx.user.name} reports a wrong number for ${l.name}`, `#/leads/${l.id}`);
  L.rescore(ctx.oid, l.id);
  return { ok: true };
});
r.post('/api/leads/:id/whatsapp', (ctx) => {
  const l = leadFor(ctx, ctx.params.id), b = ctx.body;
  const content = str(b.content); if (!content) throw bad('Message text is required');
  L.logActivity(ctx.oid, l.id, ctx.user.id, 'whatsapp', { direction: b.direction === 'incoming' ? 'incoming' : 'outgoing', content });
  if (l.stage === 'New' && b.direction !== 'incoming') L.setStage(ctx.oid, l.id, 'Contacted', ctx.user);
  L.rescore(ctx.oid, l.id);
  return { ok: true };
});
r.get('/api/comms', (ctx) => {
  const q = ctx.query;
  let sql = `SELECT a.*, l.name AS lead_name, l.phone_norm AS lead_phone, u.name AS user_name FROM activities a JOIN leads l ON l.id=a.lead_id LEFT JOIN users u ON u.id=a.user_id
    WHERE a.org_id=? AND a.type IN ('call','whatsapp')`;
  const a = [ctx.oid];
  if (!ctx.isAdmin) { sql += ' AND a.user_id=?'; a.push(ctx.user.id); } else if (q.user) { sql += ' AND a.user_id=?'; a.push(Number(q.user)); }
  if (q.type === 'call' || q.type === 'whatsapp') { sql += ' AND a.type=?'; a.push(q.type); }
  const p = L.period(q.range || 'all'); sql += ' AND a.created_at>=? AND a.created_at<?'; a.push(p.from, p.to);
  sql += ' ORDER BY a.created_at DESC LIMIT 300';
  return all(sql, ...a);
});
r.get('/api/templates', (ctx) => all('SELECT * FROM templates WHERE org_id=? ORDER BY id', ctx.oid));
r.post('/api/templates', { admin: true }, (ctx) => {
  const name = str(ctx.body.name), body = str(ctx.body.body);
  if (!name || !body) throw bad('Template name and message are required');
  return { id: Number(run('INSERT INTO templates(org_id,name,body) VALUES (?,?,?)', ctx.oid, name, body).lastInsertRowid) };
});
r.put('/api/templates/:id', { admin: true }, (ctx) => { run('UPDATE templates SET name=COALESCE(?,name), body=COALESCE(?,body) WHERE id=? AND org_id=?', str(ctx.body.name), str(ctx.body.body), ctx.params.id, ctx.oid); return { ok: true }; });
r.del('/api/templates/:id', { admin: true }, (ctx) => { run('DELETE FROM templates WHERE id=? AND org_id=?', ctx.params.id, ctx.oid); return { ok: true }; });
/** Fill {name} {rep} {company} {project} {project_part} {size} {phone} in a template for one lead. */
r.post('/api/templates/render', (ctx) => {
  const l = leadFor(ctx, ctx.body.lead_id);
  const tpl = get('SELECT * FROM templates WHERE id=? AND org_id=?', Number(ctx.body.template_id), ctx.oid);
  if (!tpl) throw notFound('Template not found');
  const pr = l.pref_project_id ? get('SELECT name FROM projects WHERE id=?', l.pref_project_id) : null;
  const vars = { name: l.name.split(' ')[0], full_name: l.name, rep: ctx.user.name, company: L.getOrg(ctx.oid).name, project: pr?.name || 'our project', project_part: pr ? ` at ${pr.name}` : '',
    size: l.pref_size_min ? `${l.pref_size_min} sq.yd` : 'your preferred size', phone: L.fmtPhone(l.phone_norm) };
  const text = tpl.body.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
  return { text, wa_link: `https://wa.me/91${l.phone_norm}?text=${encodeURIComponent(text)}` };
});

// ================= TELEPHONY / WHATSAPP WEBHOOK =================
function recordEvent(oid, e, leadId, userId) {
  L.logActivity(oid, leadId, userId, e.type === 'whatsapp' ? 'whatsapp' : 'call', { direction: e.direction, outcome: e.outcome, duration: e.duration, content: e.content });
  const lead = get('SELECT * FROM leads WHERE id=?', leadId);
  if (lead.stage === 'New' && (e.type === 'whatsapp' ? e.direction === 'outgoing' : e.outcome === 'Connected')) L.setStage(oid, leadId, 'Contacted', userId ? get('SELECT * FROM users WHERE id=?', userId) : { id: null });
  L.rescore(oid, leadId);
}
r.post('/api/webhook/:code/:secret/event', { public: true }, (ctx) => {
  const org = get('SELECT * FROM orgs WHERE code=?', ctx.params.code);
  if (!org || L.getSettings(org.id).webhook_secret !== ctx.params.secret) throw new HttpError(401, 'Invalid webhook credentials');
  const b = ctx.body;
  const type = b.type === 'whatsapp' ? 'whatsapp' : 'call';
  const pn = L.normPhone(b.phone || b.from || b.to);
  if (!pn) throw bad('A valid phone number is required');
  const e = { type, direction: b.direction === 'incoming' || b.direction === 'inbound' ? 'incoming' : 'outgoing', duration: Math.round(num(b.duration) || 0),
    outcome: type === 'call' ? (CALL_OUTCOMES.includes(b.outcome) ? b.outcome : num(b.duration) > 0 ? 'Connected' : 'Missed') : null, content: str(b.content || b.message) };
  const agent = b.agent_email ? get('SELECT id FROM users WHERE org_id=? AND lower(email)=lower(?)', org.id, b.agent_email) : null;
  const lead = get('SELECT * FROM leads WHERE org_id=? AND phone_norm=? ORDER BY updated_at DESC', org.id, pn);
  const x = run('INSERT INTO webhook_events(org_id,type,phone_norm,direction,duration,outcome,content,agent_email,payload,lead_id,matched,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
    org.id, type, pn, e.direction, e.duration, e.outcome, e.content, b.agent_email, b, lead?.id, lead ? 1 : 0, now());
  if (lead) recordEvent(org.id, e, lead.id, agent?.id || lead.assigned_to);
  else L.notifyAdmins(org.id, 'Unmatched call/WhatsApp event', `${L.fmtPhone(pn)} is not in your leads — link it in Call & WhatsApp Log`, '#/comms');
  return { ok: true, matched: !!lead, event_id: Number(x.lastInsertRowid) };
});
r.get('/api/unmatched', { admin: true }, (ctx) => all('SELECT * FROM webhook_events WHERE org_id=? AND matched=0 ORDER BY id DESC LIMIT 200', ctx.oid));
r.post('/api/unmatched/:id/link', { admin: true }, (ctx) => {
  const ev = get('SELECT * FROM webhook_events WHERE id=? AND org_id=? AND matched=0', ctx.params.id, ctx.oid);
  if (!ev) throw notFound('Event not found');
  const lead = get('SELECT * FROM leads WHERE id=? AND org_id=?', Number(ctx.body.lead_id), ctx.oid);
  if (!lead) throw bad('Choose the lead this belongs to');
  const agent = ev.agent_email ? get('SELECT id FROM users WHERE org_id=? AND lower(email)=lower(?)', ctx.oid, ev.agent_email) : null;
  recordEvent(ctx.oid, { type: ev.type, direction: ev.direction, duration: ev.duration, outcome: ev.outcome, content: ev.content }, lead.id, agent?.id || lead.assigned_to);
  run('UPDATE webhook_events SET matched=1, lead_id=? WHERE id=?', lead.id, ev.id);
  return { ok: true };
});
r.del('/api/unmatched/:id', { admin: true }, (ctx) => { run('DELETE FROM webhook_events WHERE id=? AND org_id=? AND matched=0', ctx.params.id, ctx.oid); return { ok: true }; });

// ================= ASSIGNMENT RULES (Lead AI Router) =================
const ruleOut = (x) => ({ ...x, rep_ids: JSON.parse(x.rep_ids || '[]') });
r.get('/api/assign-rules', { admin: true }, (ctx) => ({
  rules: all('SELECT * FROM assign_rules WHERE org_id=? ORDER BY position,id', ctx.oid).map(ruleOut),
  unassigned: get("SELECT COUNT(*) c FROM leads WHERE org_id=? AND assigned_to IS NULL AND stage NOT IN ('Booked','Lost')", ctx.oid).c,
  auto_assign: L.getSettings(ctx.oid).auto_assign,
}));
function ruleBody(ctx, cur = {}) {
  const b = ctx.body, pick = (k) => (k in b ? b[k] : cur[k]);
  const name = str(pick('name')); if (!name) throw bad('Rule name is required');
  const strategy = pick('strategy'); if (!['round_robin', 'fair_workload', 'ai'].includes(strategy)) throw bad('Choose an assignment strategy');
  let ids = pick('rep_ids'); if (typeof ids === 'string') ids = JSON.parse(ids);
  ids = (ids || []).map(Number).filter((id) => get('SELECT 1 x FROM users WHERE id=? AND org_id=?', id, ctx.oid));
  if (!ids.length) throw bad('Include at least one team member');
  const pid = pick('project_id') ? Number(pick('project_id')) : null;
  return [name, str(pick('source')), num(pick('min_budget')), pid, strategy, JSON.stringify(ids), pick('active') === undefined ? 1 : pick('active') ? 1 : 0, Number(pick('position')) || 0];
}
r.post('/api/assign-rules', { admin: true }, (ctx) => {
  const v = ruleBody(ctx);
  const pos = v[7] || get('SELECT COALESCE(MAX(position),0)+1 p FROM assign_rules WHERE org_id=?', ctx.oid).p;
  v[7] = pos;
  return { id: Number(run('INSERT INTO assign_rules(org_id,name,source,min_budget,project_id,strategy,rep_ids,active,position) VALUES (?,?,?,?,?,?,?,?,?)', ctx.oid, ...v).lastInsertRowid) };
});
r.put('/api/assign-rules/:id', { admin: true }, (ctx) => {
  const cur = get('SELECT * FROM assign_rules WHERE id=? AND org_id=?', ctx.params.id, ctx.oid); if (!cur) throw notFound();
  run('UPDATE assign_rules SET name=?,source=?,min_budget=?,project_id=?,strategy=?,rep_ids=?,active=?,position=? WHERE id=?', ...ruleBody(ctx, ruleOut(cur)), cur.id);
  return { ok: true };
});
r.del('/api/assign-rules/:id', { admin: true }, (ctx) => { run('DELETE FROM assign_rules WHERE id=? AND org_id=?', ctx.params.id, ctx.oid); return { ok: true }; });
r.post('/api/assign-rules/run', { admin: true }, (ctx) => {
  const ids = all("SELECT id FROM leads WHERE org_id=? AND assigned_to IS NULL AND stage NOT IN ('Booked','Lost') AND flag_status<>'spam' ORDER BY created_at", ctx.oid);
  let n = 0;
  tx(() => ids.forEach((l) => { if (L.autoAssign(ctx.oid, l.id)) n++; }));
  return { assigned: n, remaining: ids.length - n };
});
r.get('/api/leads/:id/recommend-rep', { admin: true }, (ctx) => {
  const reps = all("SELECT * FROM users WHERE org_id=? AND role='rep' AND status='active'", ctx.oid);
  if (!reps.length) throw bad('No active reps');
  const since = addMs(-90 * 864e5);
  const pick = reps.map((u) => {
    const tot = get('SELECT COUNT(*) c FROM leads WHERE org_id=? AND assigned_to=? AND created_at>=?', ctx.oid, u.id, since).c;
    const won = get("SELECT COUNT(*) c FROM leads WHERE org_id=? AND assigned_to=? AND stage='Booked' AND created_at>=?", ctx.oid, u.id, since).c;
    const open = L.openLeadCount(ctx.oid, u.id);
    return { id: u.id, name: u.name, open, conversion: tot ? Math.round((won / tot) * 100) : 0, s: 0.55 * ((won + 1) / (tot + 5)) * 5 + 0.45 / (1 + open) };
  }).sort((a, b) => b.s - a.s);
  return { recommended: pick[0], ranking: pick };
});

// ================= AUTOMATION RULES =================
r.get('/api/automation-rules', { admin: true }, (ctx) => all('SELECT * FROM automation_rules WHERE org_id=? ORDER BY id', ctx.oid));
r.post('/api/automation-rules', { admin: true }, (ctx) => {
  const b = ctx.body;
  if (!L.STAGES.includes(b.trigger_stage)) throw bad('Choose the stage that triggers this rule');
  if (!b.create_task && !b.notify_admin) throw bad('Pick at least one action: create a task or notify admin');
  const hrs = Math.max(0, Math.round(num(b.due_hours) ?? 24));
  return { id: Number(run('INSERT INTO automation_rules(org_id,trigger_stage,create_task,task_title,due_hours,notify_admin) VALUES (?,?,?,?,?,?)', ctx.oid, b.trigger_stage, !!b.create_task, str(b.task_title) || 'Follow up', hrs, !!b.notify_admin).lastInsertRowid) };
});
r.put('/api/automation-rules/:id', { admin: true }, (ctx) => { run('UPDATE automation_rules SET active=? WHERE id=? AND org_id=?', !!ctx.body.active, ctx.params.id, ctx.oid); return { ok: true }; });
r.del('/api/automation-rules/:id', { admin: true }, (ctx) => { run('DELETE FROM automation_rules WHERE id=? AND org_id=?', ctx.params.id, ctx.oid); return { ok: true }; });
