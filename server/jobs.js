// Background jobs, run every minute: plot-hold expiry, overdue task reminders, instalment reminders.
const { all, get, run } = require('./db');
const { now, addMs, getSettings, notify, notifyAdmins, istDate, fmtPhone } = require('./lib');

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
  // instalment reminders (once per instalment per day)
  const today = istDate();
  const in3 = istDate(Date.now() + 3 * 864e5);
  for (const i of all(`SELECT i.*, b.booking_no, b.sold_by, b.status AS bstatus, l.name AS buyer FROM installments i JOIN bookings b ON b.id=i.booking_id
      JOIN leads l ON l.id=b.lead_id WHERE b.status<>'cancelled' AND i.paid_amount < i.amount - 0.5 AND (i.due_date < ? OR i.due_date = ?) AND (i.reminded_on IS NULL OR i.reminded_on <> ?)`, today, in3, today)) {
    run('UPDATE installments SET reminded_on=? WHERE id=?', today, i.id);
    const overdue = i.due_date < today;
    const msg = `${i.buyer} — ${i.booking_no} · ${i.label} ₹${Math.round(i.amount - i.paid_amount).toLocaleString('en-IN')} ${overdue ? 'was due ' : 'due '}${i.due_date}`;
    if (i.sold_by) notify(i.org_id, { user: i.sold_by, title: overdue ? 'Payment overdue' : 'Payment due in 3 days', message: msg, link: `#/bookings/${i.booking_id}` });
    if (overdue) notifyAdmins(i.org_id, 'Payment overdue', msg, `#/bookings/${i.booking_id}`);
  }
  lastDaily = today;
}
module.exports = { tick };
