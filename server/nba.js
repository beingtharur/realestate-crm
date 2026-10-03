// "Next best action" for a lead: one clear sentence telling the rep what to do now, and which button does it.
const { all, get } = require('./db');
const { now } = require('./lib');

const mins = (iso) => (Date.now() - Date.parse(iso)) / 60000;
function ago(iso) {
  const m = Math.max(0, mins(iso));
  if (m < 60) return `${Math.max(1, Math.round(m))} min ago`;
  if (m < 1440) return `${Math.round(m / 60)} h ago`;
  const d = Math.round(m / 1440);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}
function inWhen(iso) {
  const m = (Date.parse(iso) - Date.now()) / 60000;
  if (m < 60) return `in ${Math.max(1, Math.round(m))} min`;
  if (m < 1440) return `in ${Math.round(m / 60)} h`;
  return `in ${Math.round(m / 1440)} day(s)`;
}

/** cta: call | whatsapp | task | visit | hold | none.  tone: urgent | warn | info */
function nextAction(oid, l) {
  if (l.stage === 'Booked') return null;
  if (l.stage === 'Lost') return { tone: 'info', cta: 'none', text: 'Marked lost. Reopen the lead if the client comes back.' };
  const t = now();
  const lastTouch = l.last_activity_at || null;
  const openTasks = all("SELECT * FROM tasks WHERE org_id=? AND lead_id=? AND status='open' ORDER BY due_at", oid, l.id);
  const overdue = openTasks.filter((k) => k.due_at < t);
  const visits = all("SELECT v.*, p.name AS project FROM visits v JOIN projects p ON p.id=v.project_id WHERE v.org_id=? AND v.lead_id=? ORDER BY v.scheduled_at DESC", oid, l.id);
  const pendingVisit = visits.find((v) => v.status === 'scheduled');
  const lastDone = visits.find((v) => v.status === 'completed');

  if (l.reenquiry_at && mins(l.reenquiry_at) < 1440 &&
      !get("SELECT 1 x FROM activities WHERE org_id=? AND lead_id=? AND type IN ('call','whatsapp') AND created_at>?", oid, l.id, l.reenquiry_at)) {
    return { tone: 'urgent', cta: 'call', text: `Enquired again ${ago(l.reenquiry_at)}. Call now while they are interested.` };
  }
  if (l.stage === 'New' && !lastTouch) {
    const w = mins(l.assigned_at || l.created_at);
    return { tone: w > 15 ? 'urgent' : 'warn', cta: 'call', text: w > 15 ? `New lead waiting ${Math.round(w)} min with no call. Call now.` : 'New lead. A call in the first 15 minutes wins most plots.' };
  }
  if (overdue.length) {
    const k = overdue[0], late = mins(k.due_at);
    return { tone: 'urgent', cta: 'call', text: `Follow-up "${k.title}" is overdue by ${late < 1440 ? Math.max(1, Math.round(late / 60)) + ' h' : Math.round(late / 1440) + ' day(s)'}.` };
  }
  if (pendingVisit) {
    const past = Date.parse(pendingVisit.scheduled_at) < Date.now();
    if (past && mins(pendingVisit.scheduled_at) > 60) return { tone: 'urgent', cta: 'visit', visit_id: pendingVisit.id, text: `Site visit to ${pendingVisit.project} was ${ago(pendingVisit.scheduled_at)}. Record how it went.` };
    if (!past && Date.parse(pendingVisit.scheduled_at) - Date.now() < 36 * 3600e3) return { tone: 'warn', cta: 'whatsapp', text: `Site visit to ${pendingVisit.project} ${inWhen(pendingVisit.scheduled_at)}. Confirm with the client.` };
  }
  if (!openTasks.length) {
    if (lastDone) {
      const d = Math.floor(mins(lastDone.completed_at || lastDone.scheduled_at) / 1440);
      if (lastDone.interest === 'High' && l.stage !== 'Negotiation') return { tone: 'warn', cta: 'hold', text: `High interest after the site visit${d ? ` ${d} day(s) ago` : ''}. Hold a plot or move to negotiation.` };
      return { tone: d >= 1 ? 'urgent' : 'warn', cta: 'task', text: `Site visit was ${d <= 0 ? 'today' : d + ' day(s) ago'} and no follow-up is set. Schedule one.` };
    }
    if (lastTouch && mins(lastTouch) > 3 * 1440) return { tone: 'urgent', cta: 'call', text: `No contact for ${Math.floor(mins(lastTouch) / 1440)} days and no follow-up set. Call today.` };
    return { tone: 'warn', cta: 'task', text: 'No follow-up is scheduled. Set the next step so this lead does not go cold.' };
  }
  if (lastTouch && mins(lastTouch) > 5 * 1440) return { tone: 'warn', cta: 'call', text: `Quiet for ${Math.floor(mins(lastTouch) / 1440)} days. A quick call keeps it warm.` };
  if (l.stage === 'Negotiation') return { tone: 'info', cta: 'call', text: 'In negotiation. Push for the token amount.' };
  const nx = openTasks[0];
  return { tone: 'info', cta: 'none', text: `Next: ${nx.title} ${inWhen(nx.due_at)}.` };
}
module.exports = { nextAction, get };
