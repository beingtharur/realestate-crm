// Background jobs, run every minute: plot-hold expiry, overdue task reminders, instalment reminders.
const { all, get, run } = require('./db');
const L = require('./lib');
const { now, addMs, getSettings, notify, notifyAdmins, istDate, fmtPhone } = L;

const waLink = (phone, text) => `https://wa.me/91${phone}?text=${encodeURIComponent(text)}`;
const whenIST = (iso) => new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** Follow-ups 30 min before they are due; site-visit reminders; the post-visit "how did it go" prompt. */
function reminders(t) {
  const in30 = addMs(30 * 60000);
  for (const k of all("SELECT t.*, l.name AS lead_name, l.phone_norm FROM tasks t LEFT JOIN leads l ON l.id=t.lead_id WHERE t.status='open' AND t.assigned_to IS NOT NULL AND t.pre_reminded IS NULL AND t.due_at > ? AND t.due_at <= ?", t, in30)) {
    run('UPDATE tasks SET pre_reminded=? WHERE id=?', t, k.id);
    notify(k.org_id, { user: k.assigned_to, kind: 'followup', title: 'Follow-up in 30 minutes', message: `${k.title}${k.lead_name ? ' — ' + k.lead_name : ''}`, link: k.lead_id ? `#/leads/${k.lead_id}` : '#/tasks',
      ...(k.phone_norm ? { action_url: `tel:+91${k.phone_norm}`, action_label: 'Call' } : {}) });
  }
  const V = 'SELECT v.*, l.name AS lead_name, l.phone_norm, pr.name AS project, u.name AS rep_name, o.name AS org_name FROM visits v JOIN leads l ON l.id=v.lead_id JOIN projects pr ON pr.id=v.project_id LEFT JOIN users u ON u.id=v.assigned_to JOIN orgs o ON o.id=v.org_id WHERE v.status=\'scheduled\' AND v.assigned_to IS NOT NULL';
  // about a day ahead: the rep should WhatsApp the client to confirm
  for (const v of all(V + ' AND v.rem_day IS NULL AND v.scheduled_at > ? AND v.scheduled_at <= ?', addMs(2 * 3600e3), addMs(24 * 3600e3))) {
    run('UPDATE visits SET rem_day=? WHERE id=?', t, v.id);
    const msg = `Hi ${v.lead_name}, this is ${v.rep_name || 'your advisor'} from ${v.org_name}. A reminder about your site visit to ${v.project} on ${whenIST(v.scheduled_at)}.${v.pickup_required ? ' Our car will pick you up' + (v.pickup_address ? ' from ' + v.pickup_address : '') + '.' : ''} Please reply to confirm.`;
    notify(v.org_id, { user: v.assigned_to, kind: 'visit', title: 'Site visit coming up — confirm with client', message: `${v.lead_name} → ${v.project}, ${whenIST(v.scheduled_at)}`, link: `#/leads/${v.lead_id}`, action_url: waLink(v.phone_norm, msg), action_label: 'WhatsApp client' });
  }
  for (const v of all(V + ' AND v.rem_30 IS NULL AND v.scheduled_at > ? AND v.scheduled_at <= ?', t, in30)) {
    run('UPDATE visits SET rem_30=? WHERE id=?', t, v.id);
    notify(v.org_id, { user: v.assigned_to, kind: 'visit', title: 'Site visit in 30 minutes', message: `${v.lead_name} → ${v.project}${v.pickup_required ? ' · pickup needed' : ''}`, link: `#/leads/${v.lead_id}`, action_url: `tel:+91${v.phone_norm}`, action_label: 'Call client' });
  }
  // 15 minutes past the slot and the client has not said they are coming
  for (const v of all(V + ' AND v.rem_late IS NULL AND v.on_way_at IS NULL AND v.scheduled_at < ? AND v.scheduled_at > ?', addMs(-15 * 60000), addMs(-3 * 3600e3))) {
    run('UPDATE visits SET rem_late=? WHERE id=?', t, v.id);
    notify(v.org_id, { user: v.assigned_to, kind: 'visit', title: 'Client has not arrived yet', message: `${v.lead_name} was due for ${v.project} at ${whenIST(v.scheduled_at)}`, link: `#/leads/${v.lead_id}`, action_url: `tel:+91${v.phone_norm}`, action_label: 'Call client' });
  }
  // 45 minutes after the slot: capture the outcome while it is fresh
  for (const v of all(V + ' AND v.rem_out IS NULL AND v.scheduled_at < ? AND v.scheduled_at > ?', addMs(-45 * 60000), addMs(-24 * 3600e3))) {
    run('UPDATE visits SET rem_out=? WHERE id=?', t, v.id);
    notify(v.org_id, { user: v.assigned_to, kind: 'visit', title: 'How did the site visit go?', message: `Record the outcome for ${v.lead_name} (${v.project})`, link: `#/leads/${v.lead_id}` });
  }
}

/** A new lead nobody has called: nudge the rep, then tell the admin (and optionally hand it to someone else). */
function escalations(t) {
  for (const o of all('SELECT id FROM orgs')) {
    const cfg = getSettings(o.id).escalation || {};
    if (!cfg.enabled) continue;
    const remind = Number(cfg.remind_min) || 15, esc = Math.max(remind + 1, Number(cfg.escalate_min) || 30);
    for (const l of all("SELECT * FROM leads WHERE org_id=? AND stage='New' AND assigned_to IS NOT NULL AND esc_level<2 AND flag_status<>'spam' AND (last_activity_at IS NULL OR last_activity_at < COALESCE(assigned_at,created_at))", o.id)) {
      const rep = get('SELECT * FROM users WHERE id=?', l.assigned_to);
      if (!rep || rep.status !== 'active' || !L.isOnShift(o.id, rep)) continue;               // the clock only runs while the rep is at work
      const startMs = Math.max(Date.parse(l.assigned_at || l.created_at), L.shiftStartToday(o.id, rep) || 0);
      const mins = (Date.now() - startMs) / 60000;
      if (l.esc_level < 1 && mins >= remind) {
        run('UPDATE leads SET esc_level=1 WHERE id=?', l.id);
        notify(o.id, { user: rep.id, kind: 'escalation', title: 'New lead is waiting — call now', message: `${l.name} (${fmtPhone(l.phone_norm)}) has not been called for ${Math.round(mins)} minutes`, link: `#/leads/${l.id}`, action_url: `tel:+91${l.phone_norm}`, action_label: 'Call' });
      }
      if (mins >= esc) {
        run('UPDATE leads SET esc_level=2 WHERE id=?', l.id);
        notifyAdmins(o.id, 'Lead not contacted', `${l.name} has waited ${Math.round(mins)} minutes with ${rep.name} and no call`, `#/leads/${l.id}`, { kind: 'escalation' });
        const tries = get("SELECT COUNT(*) c FROM activities WHERE lead_id=? AND type='assign' AND content LIKE '%no response%'", l.id).c;
        if (cfg.reassign && tries < 2) {
          const before = l.assigned_to;
          L.autoAssign(o.id, l.id, false, before);
          const after = get('SELECT assigned_to FROM leads WHERE id=?', l.id).assigned_to;
          if (after && after !== before) {
            run("UPDATE activities SET content=content||' (no response from previous rep)' WHERE id=(SELECT MAX(id) FROM activities WHERE lead_id=? AND type='assign')", l.id);
            notify(o.id, { user: before, kind: 'escalation', title: 'Lead reassigned', message: `${l.name} was moved to another rep because it was not called in time`, link: '#/leads' });
          }
        }
      }
    }
  }
}

/** 9am (or the user's own time): one notification with the day ahead. */
function briefings() {
  const c = L.istClock(), today = c.date, dayR = L.dayRange(today), end = dayR.to;
  for (const o of all('SELECT id FROM orgs')) {
    const def = getSettings(o.id).briefing_time || '09:00';
    for (const u of all("SELECT * FROM users WHERE org_id=? AND status='active'", o.id)) {
      if (u.last_briefing === today || u.availability === 'on_leave') continue;
      const at = L.hm(L.getPrefs(u).briefing_time || def);
      if (c.min < at || c.min > at + 240 || !L.workHours(o.id, u).days.includes(c.dow)) continue;
      run('UPDATE users SET last_briefing=? WHERE id=?', today, u.id);
      let parts, link = '#/dashboard';
      if (u.role === 'admin') {
        const unassigned = get("SELECT COUNT(*) c FROM leads WHERE org_id=? AND assigned_to IS NULL AND stage NOT IN ('Booked','Lost')", o.id).c;
        const visits = get("SELECT COUNT(*) c FROM visits WHERE org_id=? AND status='scheduled' AND scheduled_at>=? AND scheduled_at<?", o.id, dayR.from, end).c;
        const overdue = get("SELECT COUNT(*) c FROM tasks WHERE org_id=? AND status='open' AND due_at<?", o.id, now()).c;
        const fresh = get('SELECT COUNT(*) c FROM leads WHERE org_id=? AND created_at>=?', o.id, addMs(-24 * 3600e3)).c;
        parts = [[fresh, 'new lead'], [visits, 'site visit'], [overdue, 'overdue follow-up'], [unassigned, 'unassigned lead']];
      } else {
        const fu = get("SELECT COUNT(*) c FROM tasks WHERE org_id=? AND assigned_to=? AND status='open' AND due_at<?", o.id, u.id, end).c;
        const vs = get("SELECT COUNT(*) c FROM visits WHERE org_id=? AND assigned_to=? AND status='scheduled' AND scheduled_at>=? AND scheduled_at<?", o.id, u.id, dayR.from, end).c;
        const nl = get("SELECT COUNT(*) c FROM leads WHERE org_id=? AND assigned_to=? AND stage='New' AND last_activity_at IS NULL", o.id, u.id).c;
        parts = [[fu, 'follow-up'], [vs, 'site visit'], [nl, 'new lead']];
        link = '#/tasks';
      }
      const shown = parts.filter(([n]) => n > 0);
      if (!shown.length) continue;
      notify(o.id, { user: u.id, kind: 'briefing', title: u.role === 'admin' ? "Today's overview" : 'Good morning — your day', message: shown.map(([n, w]) => plural(n, w)).join(', '), link });
    }
  }
}


let lastDaily = '';
function tick() {
  const t = now();
  // release expired plot holds
  for (const p of all("SELECT p.*, pr.name AS project FROM plots p JOIN projects pr ON pr.id=p.project_id WHERE p.status='hold' AND p.hold_until IS NOT NULL AND p.hold_until < ?", t)) {
    run("UPDATE plots SET status='available', hold_lead_id=NULL, hold_until=NULL, hold_by=NULL WHERE id=?", p.id);
    if (p.hold_by) notify(p.org_id, { user: p.hold_by, title: 'Plot hold expired', message: `${p.project} — Plot ${p.plot_no} is available again`, link: '#/inventory' });
  }
  // overdue task reminders (every 10 minutes) + one-time escalation after 24h
  const orgs = all('SELECT id FROM orgs');
  for (const o of orgs) {
    if (!getSettings(o.id).overdue_reminders) continue;
    const cutoff = addMs(-10 * 60000);
    for (const k of all("SELECT t.*, l.name AS lead_name FROM tasks t LEFT JOIN leads l ON l.id=t.lead_id WHERE t.org_id=? AND t.status='open' AND t.due_at < ? AND (t.last_reminded_at IS NULL OR t.last_reminded_at < ?)", o.id, t, cutoff)) {
      run('UPDATE tasks SET last_reminded_at=? WHERE id=?', t, k.id);
      if (k.assigned_to) notify(o.id, { user: k.assigned_to, title: 'Task overdue', message: `${k.title}${k.lead_name ? ' — ' + k.lead_name : ''}`, link: k.lead_id ? `#/leads/${k.lead_id}` : '#/tasks' });
      if (Date.parse(k.due_at) < Date.now() - 24 * 3600e3) {
        const link = `#/tasks?id=${k.id}`;
        if (!get("SELECT 1 x FROM notifications WHERE org_id=? AND title='Overdue task escalation' AND link=?", o.id, link)) {
          const who = k.assigned_to ? get('SELECT name FROM users WHERE id=?', k.assigned_to)?.name : 'Unassigned';
          notifyAdmins(o.id, 'Overdue task escalation', `"${k.title}" (${who}) is overdue by more than 24 hours`, link);
        }
      }
    }
  }
  // calls started from the CRM that the phone never reported back (dialer closed, app not syncing)
  run("UPDATE activities SET outcome='Failed', content=COALESCE(content,'No call record was received from the phone') WHERE type='call' AND outcome='Initiated' AND created_at < ?", addMs(-2 * 3600e3));
  run("UPDATE users SET availability='available', unavailable_until=NULL WHERE availability='on_leave' AND unavailable_until IS NOT NULL AND unavailable_until <= ?", t); // back from leave
  reminders(t);
  escalations(t);
  briefings();
  // instalment reminders (once per instalment per day)
  const today = istDate();
  const in3 = istDate(Date.now() + 3 * 864e5);
  for (const i of all(`SELECT i.*, b.booking_no, b.sold_by, b.status AS bstatus, l.name AS buyer, l.phone_norm AS buyer_phone FROM installments i JOIN bookings b ON b.id=i.booking_id
      JOIN leads l ON l.id=b.lead_id WHERE b.status<>'cancelled' AND i.paid_amount < i.amount - 0.5 AND (i.due_date < ? OR i.due_date = ?) AND (i.reminded_on IS NULL OR i.reminded_on <> ?)`, today, in3, today)) {
    run('UPDATE installments SET reminded_on=? WHERE id=?', today, i.id);
    const overdue = i.due_date < today;
    const msg = `${i.buyer} — ${i.booking_no} · ${i.label} ₹${Math.round(i.amount - i.paid_amount).toLocaleString('en-IN')} ${overdue ? 'was due ' : 'due '}${i.due_date}`;
    const due = Math.round(i.amount - i.paid_amount).toLocaleString('en-IN');
    notifyAdmins(i.org_id, overdue ? 'Payment overdue' : 'Payment due in 3 days', msg, `#/bookings/${i.booking_id}`, i.buyer_phone ? { kind: 'payment', action_url: waLink(i.buyer_phone, `Hi ${i.buyer}, a gentle reminder that ${i.label} of ₹${due} for booking ${i.booking_no} ${overdue ? 'was due on' : 'is due on'} ${i.due_date}. Please let us know once paid. Thank you!`), action_label: 'WhatsApp buyer' } : { kind: 'payment' }); // collections are handled by admins
  }
  lastDaily = today;
}
module.exports = { tick };
