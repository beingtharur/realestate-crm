// "My notifications & availability", admin availability / hand-over, and the Alerts & escalation settings tab.
import { S, $, $$, esc, get, post, put, on, modalForm, toast, fld, inp, sel, ico, isAdmin, loadOptions, repLoads } from './core.js';

const KIND_LABEL = {
  lead: ['New lead assigned to me', 'The moment a lead is given to you'],
  followup: ['Follow-ups', '30 minutes before one is due, and when it is overdue'],
  visit: ['Site visits', 'Reminders, client running late, and "how did it go"'],
  escalation: ['Leads waiting for a call', 'A new lead nobody has called yet'],
  reenquiry: ['Repeat enquiries', 'A client enquires again on a lead you own'],
  briefing: ['Morning briefing', 'One summary of your day'],
  payment: ['Payments', 'Dues and overdue instalments'],
  other: ['Everything else', 'Plot holds, team and system notices'],
};
const DAYS = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [0, 'Sun']];
const dayChecks = (days) => `<div class="chips">${DAYS.map(([n, l]) => `<label class="chip-btn ${days.includes(n) ? 'on' : ''}"><input type="checkbox" class="hidden" name="day_${n}" ${days.includes(n) ? 'checked' : ''}>${l}</label>`).join('')}</div>`;
const readDays = (el) => DAYS.map(([n]) => n).filter((n) => $(`[name=day_${n}]`, el)?.checked);
const wireDayChips = (el) => on(el, 'change', '[name^=day_]', (c) => c.closest('.chip-btn').classList.toggle('on', c.checked));
const tomorrow = () => new Date(Date.now() + 330 * 60000 + 864e5).toISOString().slice(0, 10);
const AV = [['available', 'Available'], ['off_duty', 'Off duty'], ['on_leave', 'On leave']];
const avSeg = (cur) => `<div class="seg" id="av" style="width:100%">${AV.map(([v, l]) => `<button type="button" data-av="${v}" class="${cur === v ? 'on' : ''}" style="flex:1">${l}</button>`).join('')}</div>`;
const wireAv = (el) => on(el, 'click', '[data-av]', (b) => { $$('[data-av]', el).forEach((x) => x.classList.toggle('on', x === b)); $('#leave', el).classList.toggle('hidden', b.dataset.av !== 'on_leave'); });

/** Each person's own alert types, do-not-disturb, morning briefing, availability and working hours. */
export async function prefsModal() {
  const p = await get('/me/notif-prefs');
  const kinds = p.kinds_available.filter((k) => k !== 'payment' || isAdmin());
  const m = modalForm({ title: 'Notifications & availability', wide: true, submit: 'Save', body: `
    <div class="fsec first">Availability</div>
    ${avSeg(p.availability)}
    <div id="leave" class="${p.availability === 'on_leave' ? '' : 'hidden'}" style="margin-top:var(--s3)">${fld('Back on', inp('until', p.unavailable_until ? p.unavailable_until.slice(0, 10) : tomorrow(), `type="date" min="${tomorrow()}"`), 'New leads will not be routed to you until then')}</div>
    <p class="small muted" style="margin:6px 0 0">Off duty or on leave: you are skipped when leads are shared out. Available: you get leads on your working days and hours.</p>
    <div class="fsec">Working hours</div>
    <div class="frm-g">${fld('Start', inp('work_start', p.work.start, 'type="time"'))}${fld('End', inp('work_end', p.work.end, 'type="time"'))}</div>
    <div style="margin-top:var(--s2)">${dayChecks(p.work.days)}</div>
    <div class="fsec">Alerts on my phone</div>
    ${kinds.map((k) => `<label class="switch-row"><span><b>${KIND_LABEL[k][0]}</b><small>${KIND_LABEL[k][1]}</small></span><input type="checkbox" name="k_${k}" ${p.kinds[k] !== false ? 'checked' : ''}></label>`).join('')}
    <div class="fsec">Do not disturb</div>
    <label class="switch-row"><span><b>Silence alerts at night</b><small>They still arrive, without sound or pop-up</small></span><input type="checkbox" name="dnd_on" ${p.dnd.enabled ? 'checked' : ''}></label>
    <div class="frm-g">${fld('From', inp('dnd_start', p.dnd.start, 'type="time"'))}${fld('Until', inp('dnd_end', p.dnd.end, 'type="time"'))}</div>
    <div class="fsec">Morning briefing</div>
    ${fld('Time', inp('briefing_time', p.briefing_time || '', 'type="time"'), `Leave empty to use the company default (${esc(S.settings.briefing_time || '09:00')})`)}
    <div class="info-box" style="margin-top:var(--s3)">${ico('phone', 'sm')}<span>${S.companion ? `Alerts go to your phone through the <b>RealtyPilot Companion</b> app (${esc(S.companion.device.replace('Phone app · ', ''))}).` : 'Install and sign in to the <b>RealtyPilot Companion</b> app to get these alerts on your phone.'}</span></div>`,
    onOpen: (el) => { wireDayChips(el); wireAv(el); },
    onSubmit: async (d) => {
      const av = $('[data-av].on', m.el)?.dataset.av || 'available';
      const kindsOut = Object.fromEntries(kinds.map((k) => [k, !!$(`[name=k_${k}]`, m.el).checked]));
      await put('/me/notif-prefs', { kinds: kindsOut, dnd: { enabled: !!$('[name=dnd_on]', m.el).checked, start: d.dnd_start, end: d.dnd_end }, briefing_time: d.briefing_time || '' });
      const r = await put('/me/availability', { availability: av, until: av === 'on_leave' ? d.until : undefined, work_start: d.work_start, work_end: d.work_end, work_days: readDays(m.el) });
      S.user.availability = r.availability; S.user.unavailable_until = r.unavailable_until;
      toast('Saved', 'ok');
    } });
  return m;
}

/** Admin: set a team member on leave / off duty. */
export function availabilityModal(member, done) {
  const m = modalForm({ title: `Availability — ${member.name}`, submit: 'Save', body: `${avSeg(member.availability || 'available')}
    <div id="leave" class="${member.availability === 'on_leave' ? '' : 'hidden'}" style="margin-top:var(--s3)">${fld('Back on', inp('until', member.unavailable_until ? member.unavailable_until.slice(0, 10) : tomorrow(), `type="date" min="${tomorrow()}"`))}</div>
    <p class="small muted">While off duty or on leave, ${esc(member.name.split(' ')[0])} is skipped by automatic lead routing. Existing leads stay with them unless you hand them over.</p>`,
    onOpen: wireAv,
    onSubmit: async (d) => {
      const av = $('[data-av].on', m.el)?.dataset.av || 'available';
      await put(`/team/${member.id}/availability`, { availability: av, until: av === 'on_leave' ? d.until : undefined }); toast('Availability updated', 'ok'); done && done();
    } });
}

/** Admin: give a rep's open leads (and follow-ups / visits) to one person or share them out evenly. */
export async function handOverModal(member, done) {
  const loads = await repLoads(true);
  const open = loads.find((x) => x.id === member.id)?.open_leads ?? 0;
  const opts = loadOptions('Choose a team member…', loads).filter(([v]) => String(v) !== String(member.id));
  modalForm({ title: `Hand over leads — ${member.name}`, submit: 'Hand over', body: `<p class="muted" style="margin-top:0">${esc(member.name)} has <b>${open}</b> open lead${open === 1 ? '' : 's'}. Their pending follow-ups and site visits move with them.</p>
    ${fld('How', sel('mode', [['one', 'Give all to one person'], ['distribute', 'Share evenly among available reps']], 'one'))}
    <div id="who">${fld('Team member', sel('to', opts, ''))}</div>`,
    onOpen: (el) => { $('[name=mode]', el).onchange = (e) => $('#who', el).classList.toggle('hidden', e.target.value === 'distribute'); },
    onSubmit: async (d) => {
      if (d.mode === 'one' && !d.to) throw new Error('Choose who takes over');
      const r = await post(`/team/${member.id}/reassign-all`, { mode: d.mode, to: d.to ? Number(d.to) : undefined });
      toast(`${r.moved} lead${r.moved === 1 ? '' : 's'} handed over`, 'ok'); done && done();
    } });
}

/** Settings → "Alerts & routing" tab. */
export function alertsTab(tb, saveS) {
  const s = S.settings, e = s.escalation || { enabled: true, remind_min: 15, escalate_min: 30, reassign: false };
  const spend = s.source_spend || {};
  tb.innerHTML = `<div class="card" style="max-width:720px"><h3>Leads nobody has called</h3>
      <p class="muted small" style="margin-top:0">A new lead is a race. If it is not called, the rep is re-alerted, then you are told. The clock only runs during the rep's working hours.</p>
      <label class="switch-row"><span><b>Escalate uncalled new leads</b></span><input type="checkbox" name="esc_on" ${e.enabled ? 'checked' : ''}></label>
      <div class="frm-g">${fld('Re-alert the rep after (minutes)', inp('remind_min', e.remind_min, 'type="number" min="1" max="240"'))}${fld('Tell the admin after (minutes)', inp('escalate_min', e.escalate_min, 'type="number" min="2" max="480"'))}</div>
      <label class="switch-row"><span><b>Give it to another rep automatically</b><small>At the second step, using your assignment rules. Done at most twice per lead.</small></span><input type="checkbox" name="esc_re" ${e.reassign ? 'checked' : ''}></label>
      <button class="btn primary mt" id="sv-esc">Save</button></div>
    <div class="card mt" style="max-width:720px"><h3>Working hours & morning briefing</h3>
      <p class="muted small" style="margin-top:0">Company defaults. Each person can set their own in <b>Notifications & availability</b>.</p>
      <div class="frm-g">${fld('Day starts', inp('shift_start', s.shift_start || '10:00', 'type="time"'))}${fld('Day ends', inp('shift_end', s.shift_end || '19:00', 'type="time"'))}${fld('Morning briefing at', inp('briefing_time', s.briefing_time || '09:00', 'type="time"'))}</div>
      <div style="margin:var(--s2) 0 var(--s3)">${dayChecks(s.work_days || [1, 2, 3, 4, 5, 6])}</div>
      <button class="btn primary" id="sv-hrs">Save</button></div>
    <div class="card mt" style="max-width:720px"><h3>Marketing spend by source</h3>
      <p class="muted small" style="margin-top:0">Monthly spend in ₹. Reports use it to show cost per lead and cost per booking for each source.</p>
      <div class="frm-g">${S.meta.sources.map((v, i) => fld(esc(v), inp('sp_' + i, spend[v] || '', 'type="number" min="0" placeholder="0"'))).join('')}</div>
      <button class="btn primary mt" id="sv-sp">Save</button></div>`;
  wireDayChips(tb);
  $('#sv-esc', tb).onclick = () => saveS({ escalation: { enabled: $('[name=esc_on]', tb).checked, remind_min: Number($('[name=remind_min]', tb).value), escalate_min: Number($('[name=escalate_min]', tb).value), reassign: $('[name=esc_re]', tb).checked } });
  $('#sv-hrs', tb).onclick = () => saveS({ shift_start: $('[name=shift_start]', tb).value, shift_end: $('[name=shift_end]', tb).value, briefing_time: $('[name=briefing_time]', tb).value, work_days: readDays(tb) });
  $('#sv-sp', tb).onclick = () => saveS({ source_spend: Object.fromEntries(S.meta.sources.map((v, i) => [v, Number($(`[name=sp_${i}]`, tb).value) || 0])) });
}
