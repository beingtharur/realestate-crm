// Daily work: follow-up tasks, site visit planner, call/WhatsApp log (+ webhooks & templates), lead router.
import { S, $, $$, esc, get, post, put, del, on, modal, modalForm, confirmDialog, toast, fld, inp, sel, repOptions, projectOptions, inr, inrShort, rel, fmtDT, fmtDate, fmtTime, dtLocal, fromDT,
  isAdmin, empty, badge, stageBadge, phoneFmt, nav, reload, leadPicker, wireLeadPickers, userName, spinner, fullLink, copy, authUrl, callLabel, callCls, mmss, quickActions, ico, avatar } from './core.js';
import { taskModal, visitModal, callModal } from './v_leads.js';
import { projectForm } from './v_inventory.js';

// ================= tasks =================
export async function tasks(root, _p, q) {
  const admin = isAdmin(); let bucket = q.bucket || 'overdue', who = '', data;
  const load = async () => {
    const qs = new URLSearchParams(); if (bucket === 'done') qs.set('status', 'done'); else if (bucket) qs.set('bucket', bucket); if (who) qs.set('assigned', who);
    data = await get('/tasks?' + qs); draw();
  };
  const draw = () => {
    const c = data.counts;
    root.innerHTML = `<div class="ph1"><div><h1>Follow-ups & tasks</h1><p>Never let a lead go cold</p></div><div class="row">${admin ? sel('who', repOptions('All team'), who, 'id="who" style="width:auto"') : ''}<button class="btn primary" id="nt">＋ New task</button></div></div>
    <div class="row mb">${[['overdue', 'Overdue', c.overdue, 'red'], ['today', 'Due today', c.today, 'amber'], ['upcoming', 'Upcoming', c.upcoming, 'green'], ['', 'All open', c.all, ''], ['done', 'Completed', '', '']].map(([k, l, n, col]) => `<button class="chip ${bucket === k ? 'on' : ''}" data-b="${k}">${l}${n !== '' ? ` <b>${n}</b>` : ''}</button>`).join('')}</div>
    ${data.tasks.length ? data.tasks.map((t) => `<div class="task ${t.color}"><div style="flex:1;min-width:0"><b style="${t.status === 'done' ? 'text-decoration:line-through' : ''}">${esc(t.title)}</b> ${t.priority === 'High' ? badge('High', 'b-red') : ''}
        <div class="small muted">${t.lead_name ? `<a href="#/leads/${t.lead_id}">${esc(t.lead_name)}</a> · ${phoneFmt(t.lead_phone)} · ` : ''}${t.status === 'done' ? 'Completed ' + fmtDT(t.completed_at) : `Due ${fmtDT(t.due_at)} (${rel(t.due_at)})`}${admin && t.assignee ? ' · ' + esc(t.assignee) : ''}${t.postponed_count ? ` · <span style="color:var(--amber)">postponed ${t.postponed_count}×</span>` : ''}</div>${t.description ? `<div class="small">${esc(t.description)}</div>` : ''}</div>
        <div class="row gap-s">${!admin && t.lead_id ? quickActions(t.lead_id, t.lead_name, t.lead_phone) : ''}${t.status === 'open' ? `<button class="btn sm primary" data-done="${t.id}">✓ Done</button><button class="btn sm" data-snooze="${t.id}">⏱ Snooze</button>` : `<button class="btn sm" data-reopen="${t.id}">Reopen</button>`}<button class="btn sm ghost" data-del="${t.id}" title="Delete">🗑</button></div></div>`).join('') : empty(bucket === 'done' ? 'No completed tasks yet' : 'All clear ✅', 'No tasks in this view.')}`;
    $('#nt').onclick = () => taskModal(null, load);
    const w = $('#who'); if (w) w.onchange = (e) => { who = e.target.value; load(); };
  };
  on(root, 'click', '[data-b]', (el) => { bucket = el.dataset.b; load(); });
  const act = (fn) => async (el) => { try { await fn(el); load(); } catch (e) { toast(e.message, 'err'); } };
  on(root, 'click', '[data-done]', async (el) => { // optimistic: the card slides away at once; the list refreshes behind it
    const card = el.closest('.task'); card?.classList.add('leaving');
    try { await post(`/tasks/${el.dataset.done}/complete`); toast('Follow-up marked done', 'ok'); setTimeout(load, 220); }
    catch (e) { card?.classList.remove('leaving'); toast(e.message, 'err'); }
  });
  on(root, 'click', '[data-reopen]', act((el) => post(`/tasks/${el.dataset.reopen}/reopen`)));
  on(root, 'click', '[data-del]', act(async (el) => { if (await confirmDialog('Delete this task?', { ok: 'Delete', danger: true })) await del('/tasks/' + el.dataset.del); }));
  on(root, 'click', '[data-snooze]', (el) => {
    const id = el.dataset.snooze;
    const m = modal({ title: 'Reschedule task', body: `<div class="grid g2 keep">${[['1h', 'In 1 hour'], ['tomorrow', 'Tomorrow 10 AM'], ['nextweek', 'Next week'], ['custom', 'Pick date & time…']].map(([k, l]) => `<button class="btn" data-m="${k}" style="justify-content:center">${l}</button>`).join('')}</div><div id="cu" class="hidden mt">${fld('New due date & time', inp('due_at', dtLocal(new Date(Date.now() + 86400e3)), 'type="datetime-local"'))}<button class="btn primary" id="cgo">Reschedule</button></div>` });
    const go = async (body) => { try { const r = await post(`/tasks/${id}/snooze`, body); toast(`Rescheduled (postponed ${r.postponed_count}×)`, 'ok'); m.close(); load(); } catch (e) { toast(e.message, 'err'); } };
    on(m.el, 'click', '[data-m]', (b) => { if (b.dataset.m === 'custom') $('#cu', m.el).classList.remove('hidden'); else go({ mode: b.dataset.m }); });
    $('#cgo', m.el).onclick = () => go({ mode: 'custom', due_at: fromDT($('[name=due_at]', m.el).value) });
  });
  await load();
}

// ================= site visits =================
export async function visits(root) {
  const admin = isAdmin(); let when = 'upcoming';
  const draw = async () => {
    const rows = await get('/visits?when=' + when);
    root.innerHTML = `<div class="ph1"><div><h1>Site visit planner</h1><p>Schedule visits, arrange pickups and capture feedback</p></div><div class="row">${admin ? '<button class="btn" id="np">＋ Add property / project</button>' : ''}<button class="btn primary" id="pv">＋ Schedule visit</button></div></div>
    ${!S.meta.projects.length ? `<div class="warn-box">No projects exist yet. ${admin ? 'Add a property first, then schedule visits.' : 'Ask your admin to add projects.'}</div>` : ''}
    <div class="tabs">${[['today', 'Today'], ['upcoming', 'Upcoming'], ['past', 'Past']].map(([k, l]) => `<button data-w="${k}" class="${when === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    ${rows.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>When</th><th>Customer</th><th>Project / plot</th><th>Rep</th><th>Pickup</th><th>Status</th><th></th></tr></thead><tbody>${rows.map((v) => `<tr><td><b>${fmtDate(v.scheduled_at)}</b><div class="muted small">${fmtTime(v.scheduled_at)}</div></td><td><a href="#/leads/${v.lead_id}">${esc(v.lead_name)}</a><div class="muted small">${phoneFmt(v.lead_phone)}</div>${admin ? '' : quickActions(v.lead_id, v.lead_name, v.lead_phone)}</td><td>${esc(v.project_name)}${v.plot_no ? '<div class="muted small">Plot ' + esc(v.plot_no) + '</div>' : ''}</td><td>${esc(v.rep_name || '—')}</td><td>${v.pickup_required ? '🚐 ' + esc(v.pickup_address || 'Yes') : '—'}</td>
      <td>${badge(v.status.replace('_', ' '), v.status === 'completed' ? 'b-green' : v.status === 'scheduled' ? 'b-amber' : 'b-red')}${v.interest ? `<div class="small muted">${esc(v.interest)} interest</div>` : ''}${v.feedback ? `<div class="small muted">${esc(v.feedback)}</div>` : ''}</td>
      <td class="right nowrap">${v.status === 'scheduled' ? `<button class="btn sm primary" data-c="${v.id}">Complete</button> <button class="btn sm" data-r="${v.id}" data-at="${v.scheduled_at}">Reschedule</button> <button class="btn sm ghost" data-x="${v.id}" data-s="no_show">No-show</button> <button class="btn sm ghost" data-x="${v.id}" data-s="cancelled">Cancel</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : empty('No visits here', when === 'past' ? '' : 'Schedule a visit from a lead or with the button above.')}`;
    $('#pv').onclick = () => modalForm({ title: 'Schedule visit — choose customer', submit: 'Next', body: fld('Customer (lead)', leadPicker('lead_id')), onOpen: (e) => wireLeadPickers(e),
      onSubmit: async (d) => { if (!d.lead_id) throw new Error('Choose a lead'); const l = (await get('/leads/' + d.lead_id)).lead; setTimeout(() => visitModal(l, draw), 50); } });
    const np = $('#np'); if (np) np.onclick = () => projectForm(null, () => { reload(); });
  };
  on(root, 'click', '[data-w]', (el) => { when = el.dataset.w; draw(); });
  on(root, 'click', '[data-c]', (el) => modalForm({ title: 'Complete site visit', submit: 'Mark completed', body: fld('Customer interest', sel('interest', [['', '—'], 'High', 'Medium', 'Low'])) + fld('Feedback', '<textarea name="feedback" placeholder="Plots they liked, objections, next step…"></textarea>'),
    onSubmit: async (d) => { await post(`/visits/${el.dataset.c}/complete`, d); toast('Visit completed', 'ok'); draw(); } }));
  on(root, 'click', '[data-x]', async (el) => { try { await post(`/visits/${el.dataset.x}/status`, { status: el.dataset.s }); draw(); } catch (e) { toast(e.message, 'err'); } });
  on(root, 'click', '[data-r]', (el) => modalForm({ title: 'Reschedule visit', body: fld('New date & time', inp('scheduled_at', dtLocal(el.dataset.at), 'type="datetime-local"')), onSubmit: async (d) => { await post(`/visits/${el.dataset.r}/reschedule`, { scheduled_at: fromDT(d.scheduled_at) }); toast('Rescheduled', 'ok'); draw(); } }));
  await draw();
}

// ================= calls & WhatsApp =================
export async function comms(root, _p, q) {
  const admin = isAdmin(); let tab = q.tab || 'log', f = { type: '', range: 'week', user: '' };
  const draw = async () => {
    root.innerHTML = `<div class="ph1"><div><h1>Calls & WhatsApp</h1><p>Every conversation, logged against the lead</p></div></div>
    <div class="tabs"><button data-t="log" class="${tab === 'log' ? 'on' : ''}">Activity log</button>${admin ? `<button data-t="unmatched" class="${tab === 'unmatched' ? 'on' : ''}">Unmatched queue</button>` : ''}<button data-t="templates" class="${tab === 'templates' ? 'on' : ''}">WhatsApp templates</button>${admin ? `<button data-t="setup" class="${tab === 'setup' ? 'on' : ''}">Integrations</button>` : ''}</div><div id="tb">${spinner()}</div>`;
    const tb = $('#tb');
    if (tab === 'log') {
      const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)); const rows = await get('/comms?' + qs);
      tb.innerHTML = `<div class="filters">${sel('type', [['', 'Calls & WhatsApp'], ['call', 'Calls'], ['whatsapp', 'WhatsApp']], f.type, 'id="ft"')}${sel('range', [['today', 'Today'], ['week', 'This week'], ['month', 'This month'], ['all', 'All time']], f.range, 'id="fr"')}${admin ? sel('user', repOptions('All reps'), f.user, 'id="fu"') : ''}</div>
        ${rows.length ? `<div class="tbl-wrap"><table class="tbl comms"><thead><tr><th>Time</th><th>Type</th><th>Lead</th><th>Details</th>${admin ? '<th>Rep</th>' : ''}</tr></thead><tbody>${rows.map((a) => {
          const call = a.type === 'call', inc = a.direction === 'incoming';
          const day = fmtDate(a.created_at), tm = fmtTime(a.created_at);
          const note = a.content ? `<div class="cm-note">${esc(a.content)}</div>` : '';
          return `<tr><td class="nowrap"><div class="cm-t">${tm}</div><div class="muted small">${day}</div></td>
          <td><span class="cm-type ${call ? (inc ? 'in' : 'out') : 'wa'}">${ico(call ? 'phone' : 'message', 'sm')}${call ? (inc ? '↙ Incoming' : '↗ Outgoing') : 'WhatsApp'}</span></td>
          <td><a href="#/leads/${a.lead_id}" class="cm-lead">${esc(a.lead_name)}</a><div class="muted small nowrap">${phoneFmt(a.lead_phone)}</div></td>
          <td>${call ? `<div class="cm-det">${badge(callLabel(a.outcome), callCls(a.outcome))}${a.outcome === 'Connected' ? `<b class="cm-dur">${mmss(a.duration)}</b>` : ''}</div>${note}` : note || '<span class="muted">Message sent</span>'}</td>${admin ? `<td class="nowrap">${avatar(a.user_name || '?')}<span class="cm-rep">${esc(a.user_name || '—')}</span></td>` : ''}</tr>`;
        }).join('')}</tbody></table></div>` : empty('Nothing logged', 'Log calls and WhatsApp messages from a lead\'s page or connect your telephony provider.')}`;
      [['ft', 'type'], ['fr', 'range'], ['fu', 'user']].forEach(([id, k]) => { const el = $('#' + id); if (el) el.onchange = (e) => { f[k] = e.target.value; draw(); }; });
    } else if (tab === 'unmatched') {
      const rows = await get('/unmatched');
      tb.innerHTML = rows.length ? `<p class="muted">Events from your telephony/WhatsApp provider whose number is not in your leads. Link each to a lead — or create the lead first.</p><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Time</th><th>Number</th><th>Type</th><th>Details</th><th></th></tr></thead><tbody>${rows.map((e) => `<tr><td class="small">${fmtDT(e.created_at)}</td><td>${phoneFmt(e.phone_norm)}</td><td>${e.type === 'call' ? '📞' : '💬'} ${esc(e.direction)}</td><td>${esc(e.outcome || '')} ${e.duration ? e.duration + 's' : ''} ${esc(e.content || '')}</td><td class="right nowrap"><button class="btn sm primary" data-link="${e.id}">Link to lead</button> <button class="btn sm ghost" data-dis="${e.id}">Dismiss</button></td></tr>`).join('')}</tbody></table></div>` : empty('Queue is empty', 'Events that cannot be matched to a lead by phone number appear here.');
    } else if (tab === 'templates') {
      const tpls = await get('/templates');
      tb.innerHTML = `<div class="info-box">Variables: <code>{name}</code> first name · <code>{full_name}</code> · <code>{rep}</code> your name · <code>{company}</code> · <code>{project}</code> · <code>{project_part}</code> (" at Project") · <code>{size}</code> · <code>{phone}</code></div>${admin ? '<button class="btn primary mb" id="nt">＋ New template</button>' : ''}
        ${tpls.map((t) => `<div class="card mb"><div class="card-h"><b>${esc(t.name)}</b>${admin ? `<div class="row gap-s"><button class="btn sm" data-te="${t.id}">Edit</button><button class="btn sm ghost" data-td="${t.id}">🗑</button></div>` : ''}</div>${t.stage ? `<div class="mb">${badge('For: ' + t.stage, 'b-blue')}</div>` : ''}<div class="small" style="white-space:pre-wrap">${esc(t.body)}</div>${t.link ? `<div class="small muted mt" style="white-space:pre-wrap">${ico('link', 'sm')} ${esc(t.link)}</div>` : ''}</div>`).join('') || empty('No templates')}`;
      const nt = $('#nt'); if (nt) nt.onclick = () => tplForm();
      on(tb, 'click', '[data-te]', (el) => tplForm(tpls.find((t) => t.id == el.dataset.te)));
      on(tb, 'click', '[data-td]', async (el) => { if (await confirmDialog('Delete this template?', { ok: 'Delete', danger: true })) { await del('/templates/' + el.dataset.td); await refreshMeta(); draw(); } });
    } else if (tab === 'setup') {
      const base = `${location.origin}/api/webhook/${S.org.code}/${S.settings.webhook_secret}`;
      tb.innerHTML = `<div class="card mb"><h3>Telephony / WhatsApp events</h3><p class="muted">Point your cloud-telephony (Exotel, Knowlarity, MyOperator…) or WhatsApp provider webhook here. Events are matched to leads by phone number.</p><p><code>POST ${esc(base)}/event</code></p>
        <pre class="mono" style="white-space:pre-wrap">{ "type": "call" | "whatsapp", "phone": "9876543210", "direction": "incoming" | "outgoing",
  "duration": 120, "outcome": "Connected", "content": "message text", "agent_email": "rep@company.com" }</pre></div>
        <div class="card mb"><h3>Lead capture webhook</h3><p class="muted">Use with Zapier / Make / Facebook & Google lead-ad forms, 99acres or MagicBricks email parsers, or your website form.</p><p><code>POST ${esc(base)}/lead</code></p>
        <pre class="mono" style="white-space:pre-wrap">{ "name": "Ramesh", "phone": "9876543210", "email": "r@x.com", "source": "Facebook Ads", "project": "Green Valley", "budget": 3500000, "message": "Interested in 200 sq.yd", "partner_code": 3 }</pre>
        <p class="small muted">Repeat enquiries from the same number don't create duplicates — they're added to the existing lead and checked for spam patterns.</p></div>
        <div class="card"><h3>Public enquiry form</h3><p><code>${esc(fullLink('#/enquire/' + S.org.code))}</code> <button class="btn sm" id="cpf">Copy</button></p><p class="small muted">Share on your website, ads or as a QR code.</p></div>`;
      $('#cpf').onclick = () => copy(fullLink('#/enquire/' + S.org.code));
    }
  };
  const refreshMeta = async () => { S.meta.templates = await get('/templates'); };
  const tplForm = (t) => modalForm({ title: t ? 'Edit template' : 'New template', wide: true, body: fld('Name', inp('name', t?.name || '')) + fld('Suggest at stage', sel('stage', [['', 'Any stage'], ...S.meta.stages.map((x) => [x, x])], t?.stage || ''), 'Shown first (and pre-filled) when a rep messages a lead at this stage') + fld('Message', `<textarea name="body" style="min-height:130px">${esc(t?.body || '')}</textarea>`) + fld('Brochure / price sheet / location links', `<textarea name="link" style="min-height:70px" placeholder="One link per line, e.g. https://…/brochure.pdf or a Google Maps pin">${esc(t?.link || '')}</textarea>`, 'Added to the end of the message when it is sent'), onSubmit: async (d) => { if (t) await put('/templates/' + t.id, d); else await post('/templates', d); await refreshMeta(); toast('Saved', 'ok'); draw(); } });
  on(root, 'click', '[data-t]', (el) => { tab = el.dataset.t; draw(); });
  on(root, 'click', '[data-link]', (el) => modalForm({ title: 'Link event to a lead', submit: 'Link', body: fld('Lead', leadPicker('lead_id')), onOpen: (e) => wireLeadPickers(e), onSubmit: async (d) => { if (!d.lead_id) throw new Error('Choose a lead'); await post(`/unmatched/${el.dataset.link}/link`, { lead_id: Number(d.lead_id) }); toast('Linked', 'ok'); draw(); } }));
  on(root, 'click', '[data-dis]', async (el) => { await del('/unmatched/' + el.dataset.dis); draw(); });
  await draw();
}

// ================= lead router (assignment rules) =================
export async function router(root) {
  let d, form;
  const draw = async () => {
    d = await get('/assign-rules'); const proj = S.meta.projects;
    const reps = S.meta.users.filter((u) => u.status === 'active');
    const load = await Promise.all(reps.map(async (u) => ({ u, n: (await get(`/leads?assigned=${u.id}&open=1&limit=3000`)).length })));
    const strat = { round_robin: ['Round-robin', 'Takes turns among the chosen reps'], fair_workload: ['Fair workload', 'Gives the lead to the rep with the fewest open leads'], ai: ['AI-recommended', 'Balances recent conversion rate with current workload'] };
    root.innerHTML = `<div class="ph1"><div><h1>Lead router</h1><p>Automatically assign new and imported leads to the right rep</p></div><div class="row"><button class="btn primary" id="nr">＋ New rule</button></div></div>
    <div class="grid g3 stack mb"><div class="card"><div class="card-h"><h3>Auto-assignment</h3><label class="row gap-s"><input type="checkbox" id="aa" ${d.auto_assign ? 'checked' : ''}> ${d.auto_assign ? 'On' : 'Off'}</label></div><p class="small muted">When on, the first matching active rule assigns every new lead (manual, imported, website or webhook). Deactivated reps never receive leads. Set a per-rep cap in Settings.</p></div>
      <div class="card"><h3>Unassigned leads</h3><div class="kpi"><div class="v">${d.unassigned}</div></div><div class="row"><button class="btn sm primary" id="run" ${d.unassigned ? '' : 'disabled'}>Run rules now</button><a class="btn sm" href="#/leads?tab=unassigned">Assign manually</a></div></div>
      <div class="card"><h3>Rep workload (open leads)</h3>${load.map((x) => `<div class="list-row"><span>${esc(x.u.name)}</span><b>${x.n}</b></div>`).join('') || '<p class="muted">No reps</p>'}</div></div>
    <div class="card"><h3>Rules <span class="muted small">— checked top to bottom; the first match wins</span></h3>${d.rules.length ? `<table class="tbl"><thead><tr><th>#</th><th>Rule</th><th>When</th><th>Strategy</th><th>Reps</th><th>Active</th><th></th></tr></thead><tbody>${d.rules.map((r, i) => `<tr><td>${i + 1}</td><td><b>${esc(r.name)}</b></td><td class="small">${[r.source ? 'Source: ' + esc(r.source) : '', r.min_budget ? 'Budget ≥ ' + inrShort(r.min_budget) : '', r.project_id ? 'Project: ' + esc(proj.find((p) => p.id === r.project_id)?.name || '?') : ''].filter(Boolean).join('<br>') || 'Every lead'}</td><td>${badge(strat[r.strategy][0], 'b-brand')}</td><td class="small">${r.rep_ids.map((id) => esc(userName(id))).join(', ')}</td>
      <td><input type="checkbox" data-act="${r.id}" ${r.active ? 'checked' : ''}></td><td class="nowrap right"><button class="btn sm" data-e="${r.id}">Edit</button> <button class="btn sm ghost" data-d="${r.id}">🗑</button></td></tr>`).join('')}</tbody></table>` : empty('No rules yet', 'Create a rule such as "All leads → round-robin between my reps".')}</div>`;
    form = (r) => modalForm({ title: r ? 'Edit rule' : 'New assignment rule', wide: true, body: `${fld('Rule name', inp('name', r?.name || '', 'placeholder="e.g. Facebook leads → Hyderabad team"'))}<div class="frm-g">${fld('Only for source', sel('source', [['', 'Any source'], ...S.meta.sources], r?.source || ''))}${fld('Minimum budget (₹)', inp('min_budget', r?.min_budget ?? '', 'type="number"'))}${fld('Only for project', sel('project_id', projectOptions('Any project'), r?.project_id || ''))}${fld('Strategy', sel('strategy', Object.entries(strat).map(([k, v]) => [k, `${v[0]} — ${v[1]}`]), r?.strategy || 'round_robin'))}</div>
      <div class="fld"><span>Reps included</span>${reps.map((u) => `<label class="row gap-s"><input type="checkbox" name="rep_${u.id}" ${r?.rep_ids.includes(u.id) ? 'checked' : ''}> ${esc(u.name)} <span class="muted small">${esc(u.role)}</span></label>`).join('')}</div>`,
      onSubmit: async (f) => { const body = { name: f.name, source: f.source, min_budget: f.min_budget, project_id: f.project_id, strategy: f.strategy, rep_ids: reps.filter((u) => f['rep_' + u.id]).map((u) => u.id), active: r ? r.active : true }; if (r) await put('/assign-rules/' + r.id, body); else await post('/assign-rules', body); toast('Rule saved', 'ok'); draw(); } });
    $('#nr').onclick = () => form();
    $('#aa').onchange = async (e) => { await put('/settings', { auto_assign: e.target.checked }); S.settings.auto_assign = e.target.checked; draw(); };
    $('#run').onclick = async () => { const r = await post('/assign-rules/run'); toast(`${r.assigned} assigned, ${r.remaining} still unassigned`, r.assigned ? 'ok' : ''); draw(); };
  };
  on(root, 'click', '[data-e]', (el) => form(d.rules.find((r) => r.id == el.dataset.e)));
  on(root, 'click', '[data-d]', async (el) => { if (await confirmDialog('Delete this rule?', { ok: 'Delete', danger: true })) { await del('/assign-rules/' + el.dataset.d); draw(); } });
  on(root, 'change', '[data-act]', async (el) => { await put('/assign-rules/' + el.dataset.act, { active: el.checked }); toast(el.checked ? 'Rule on' : 'Rule off', 'ok'); });
  await draw();
}
