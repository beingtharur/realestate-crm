// Reports & analytics, RealPilot AI chat, organization settings.
import { S, $, $$, esc, get, post, put, del, on, modal, modalForm, confirmDialog, toast, fld, inp, sel, repOptions, inr, inrShort, rel, fmtDT, fmtDate, today, isAdmin, empty, badge, nav, reload, authUrl, hbars,
  spinner, fullLink, copy, dtLocal, phoneFmt } from './core.js';

// ================= reports =================
export async function reports(root) {
  let range = 'month', from = '', to = '';
  const draw = async () => {
    root.innerHTML = spinner();
    const qs = from && to ? `from=${from}&to=${to}` : `range=${range}`;
    const r = await get('/reports?' + qs);
    const total = r.funnel[0].count, booked = r.funnel[r.funnel.length - 1].count;
    const salesTotal = r.projects.reduce((s, p) => s + p.sales_value, 0), collected = r.projects.reduce((s, p) => s + p.collected, 0);
    const maxT = Math.max(1, ...r.trend.map((t) => Math.max(t.sales, t.collected)));
    root.innerHTML = `<div class="ph1"><div><h1>Reports & analytics</h1><p>${fmtDate(r.from)} → ${fmtDate(r.to)}</p></div><div class="row"><div class="seg" id="rg">${[['today', 'Today'], ['week', 'Week'], ['month', 'Month'], ['all', 'All']].map(([k, l]) => `<button data-r="${k}" class="${!from && range === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <input type="date" id="rf" value="${from}" style="width:auto" title="From"><input type="date" id="rt" value="${to}" style="width:auto" title="To"><button class="btn sm" id="rgo">Apply</button></div></div>
    <div class="grid g4 keep mb"><div class="card kpi"><div class="l">Leads created</div><div class="v">${total}</div></div><div class="card kpi"><div class="l">Booked</div><div class="v">${booked}</div><div class="s">${total ? Math.round((booked / total) * 1000) / 10 : 0}% conversion</div></div><div class="card kpi"><div class="l">Sales value</div><div class="v">${inrShort(salesTotal)}</div></div><div class="card kpi"><div class="l">Collected</div><div class="v">${inrShort(collected)}</div><div class="s">${inrShort(r.outstanding)} outstanding overall</div></div></div>
    <div class="grid g2 stack mb"><div class="card"><h3>Conversion funnel</h3><p class="small muted">Leads that reached each stage (lost leads counted at entry)</p>${r.funnel.map((f, i) => `<div class="hbar" style="grid-template-columns:150px 1fr 110px"><span class="small">${esc(f.stage)}</span><div class="bar"><i style="width:${total ? Math.max(f.count ? 2 : 0, (f.count / total) * 100) : 0}%"></i></div><b class="small right">${f.count} ${i ? `<span class="muted">(${f.dropoff_pct ? '−' + f.dropoff_pct + '%' : '0%'})</span>` : ''}</b></div>`).join('')}</div>
      <div class="card"><h3>Why leads are lost</h3>${r.lost_reasons.length ? hbars(r.lost_reasons.map((x) => ({ label: x.reason, value: x.c, cls: 'red' }))) : empty('No lost leads in this period')}</div></div>
    <div class="card mb"><h3>Sales trend — last 6 months</h3><div class="row" style="align-items:flex-end;gap:18px;height:170px">${r.trend.map((t) => `<div style="flex:1;text-align:center"><div style="display:flex;gap:4px;align-items:flex-end;height:130px;justify-content:center"><div title="Sales ${inr(t.sales)}" style="width:40%;background:var(--brand);height:${(t.sales / maxT) * 100}%;min-height:${t.sales ? 3 : 0}px;border-radius:4px 4px 0 0"></div><div title="Collected ${inr(t.collected)}" style="width:40%;background:var(--accent);height:${(t.collected / maxT) * 100}%;min-height:${t.collected ? 3 : 0}px;border-radius:4px 4px 0 0"></div></div><div class="small muted">${t.month.slice(2)}</div><div class="small"><b>${t.bookings}</b> bk</div></div>`).join('')}</div><div class="legend mt"><span><i style="background:var(--brand);border-color:var(--brand)"></i>Sales value</span><span><i style="background:var(--accent);border-color:var(--accent)"></i>Collected</span></div></div>
    <div class="card mb"><h3>Rep leaderboard</h3>${r.leaderboard.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>#</th><th>Rep</th><th class="r">Leads</th><th class="r">Conversion</th><th class="r">Bookings</th><th class="r">Sales value</th><th>Monthly target</th></tr></thead><tbody>${r.leaderboard.map((l) => `<tr><td>${l.rank}</td><td><b>${esc(l.name)}</b></td><td class="r">${l.leads}</td><td class="r">${l.conversion}%</td><td class="r">${l.bookings}</td><td class="r">${inr(l.sales_value)}</td><td style="min-width:130px"><div class="bar"><i style="width:${Math.min(100, l.target_achievement)}%"></i></div><span class="small muted">${l.target_achievement}%${l.target ? ' of ' + inrShort(l.target) : ''}</span></td></tr>`).join('')}</tbody></table></div>` : empty('No reps yet')}</div>
    <div class="grid g2 stack mb"><div class="card"><h3>Lead sources</h3>${r.sources.length ? `<table class="tbl"><thead><tr><th>Source</th><th class="r">Leads</th><th class="r">Hot</th><th class="r">Booked</th><th class="r">Conv.</th></tr></thead><tbody>${r.sources.map((s) => `<tr><td>${esc(s.source)}</td><td class="r">${s.leads}</td><td class="r">${s.hot}</td><td class="r">${s.booked}</td><td class="r"><b>${s.conversion}%</b></td></tr>`).join('')}</tbody></table>` : empty('No leads in this period')}</div>
      <div class="card"><h3>Collections aging (overdue)</h3><table class="tbl"><thead><tr><th>Bucket</th><th class="r">Instalments</th><th class="r">Amount</th></tr></thead><tbody>${r.aging.map((a) => `<tr><td>${a.label}</td><td class="r">${a.c}</td><td class="r"><b>${inr(a.s)}</b></td></tr>`).join('')}</tbody></table></div></div>
    <div class="card mb"><h3>Projects</h3>${r.projects.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Project</th><th class="r">Plots</th><th class="r">Available</th><th class="r">Hold</th><th class="r">Sold</th><th style="min-width:120px">Sell-through</th><th class="r">Bookings</th><th class="r">Sales value</th><th class="r">Collected</th><th class="r">Avg discount</th></tr></thead><tbody>${r.projects.map((p) => `<tr><td><b>${esc(p.name)}</b></td><td class="r">${p.total}</td><td class="r">${p.available}</td><td class="r">${p.hold}</td><td class="r">${p.booked + p.sold}</td><td><div class="bar"><i style="width:${p.sell_through}%"></i></div><span class="small muted">${p.sell_through}%</span></td><td class="r">${p.bookings}</td><td class="r">${inr(p.sales_value)}</td><td class="r">${inr(p.collected)}</td><td class="r">${p.avg_discount_pct}%</td></tr>`).join('')}</tbody></table></div>` : empty('No projects')}</div>
    ${r.partners.length ? `<div class="card mb"><h3>Channel partners</h3><table class="tbl"><thead><tr><th>Partner</th><th class="r">Leads</th><th class="r">Bookings</th><th class="r">Commission</th></tr></thead><tbody>${r.partners.map((p) => `<tr><td>${esc(p.name)}</td><td class="r">${p.leads}</td><td class="r">${p.bookings}</td><td class="r">${inr(p.commission)}</td></tr>`).join('')}</tbody></table></div>` : ''}
    <div class="card"><h3>Export data</h3><div class="row">${['leads', 'bookings', 'payments', 'plots', 'collections'].map((k) => `<a class="btn" href="${authUrl('/export/' + k)}">⬇ ${k[0].toUpperCase() + k.slice(1)} (CSV)</a>`).join('')}</div></div>`;
    $('#rgo').onclick = () => { from = $('#rf').value; to = $('#rt').value; if (!(from && to)) return toast('Choose both dates', 'err'); draw(); };
  };
  on(root, 'click', '[data-r]', (el) => { range = el.dataset.r; from = to = ''; draw(); });
  await draw();
}

// ================= AI assistant =================
const md = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>').replace(/\n(?!<blockquote>)/g, '<br>');
export async function ai(root, _p, q) {
  let lead = null;
  if (q.lead) { try { lead = (await get('/leads/' + q.lead)).lead; } catch { /* ignore */ } }
  const hist = await get('/ai/history');
  const chips = lead ? ['Draft a WhatsApp inviting them for a site visit', 'Draft a WhatsApp about price', 'Summarize this lead', 'How do I handle "it\'s too expensive"?'] : isAdmin()
    ? ['Pipeline summary', 'Hot leads', 'Follow-ups today', 'Overdue payments', 'Available plots', 'Inactive reps', 'Distribute 10 leads to '] : ['Pipeline summary', 'Hot leads', 'Follow-ups today', 'Overdue payments', 'Available plots', 'How do I handle "it\'s too expensive"?'];
  root.innerHTML = `<div class="ph1"><div><h1>🤖 RealPilot</h1><p>${lead ? 'Helping with <b>' + esc(lead.name) + '</b> (' + esc(lead.stage) + ')' : 'Your sales assistant — ask questions or give CRM commands'}</p></div><button class="btn sm" id="clr">Clear chat</button></div>
    <div class="card chat"><div class="msgs" id="msgs">${hist.length ? hist.map((m) => `<div class="msg ${m.role}">${md(m.content)}</div>`).join('') : `<div class="msg assistant">Hi ${esc(S.user.name.split(' ')[0])}! I can run CRM commands${isAdmin() ? ' like <b>"distribute 20 leads to Ravi"</b>' : ''}, show your pipeline, hot leads, follow-ups and overdue payments, draft WhatsApp messages and coach you through objections.</div>`}</div>
      <div class="row mt" style="gap:6px">${chips.map((c) => `<button class="chip" data-c="${esc(c)}">${esc(c)}</button>`).join('')}</div>
      <form id="cf" class="row mt no-enter" style="flex-wrap:nowrap"><input id="ci" placeholder="Ask RealPilot…" autocomplete="off" style="flex:1"><button class="btn primary">Send</button></form></div>`;
  const msgs = $('#msgs'); msgs.scrollTop = msgs.scrollHeight;
  const send = async (text) => {
    if (!text.trim()) return;
    msgs.insertAdjacentHTML('beforeend', `<div class="msg user">${esc(text)}</div><div class="msg assistant" id="typing">…</div>`); msgs.scrollTop = msgs.scrollHeight; $('#ci').value = '';
    try { const r = await post('/ai/chat', { message: text, lead_id: lead?.id }); $('#typing').outerHTML = `<div class="msg assistant">${md(r.reply)}</div>`; }
    catch (e) { $('#typing').outerHTML = `<div class="msg assistant" style="color:var(--red)">${esc(e.message)}</div>`; }
    msgs.scrollTop = msgs.scrollHeight;
  };
  $('#cf').onsubmit = (e) => { e.preventDefault(); send($('#ci').value); };
  on(root, 'click', '[data-c]', (el) => { if (el.dataset.c.endsWith(' ')) { $('#ci').value = el.dataset.c; $('#ci').focus(); } else send(el.dataset.c); });
  $('#clr').onclick = async () => { await del('/ai/history'); reload(); };
  if (q.ask) send(q.ask);
}

// ================= settings =================
export async function settings(root, _p, q) {
  let tab = q.tab || 'org';
  const TABS = [['org', 'Organization'], ['leads', 'Leads & assignment'], ['fields', 'Custom fields'], ['auto', 'Automation'], ['widgets', 'Dashboard'], ['att', 'Attendance'], ['ai', 'AI assistant'], ['audit', 'Audit log']];
  const saveS = async (patchBody) => { await put('/settings', patchBody); const me = await get('/auth/me'); S.settings = me.settings; S.org = me.org; toast('Settings saved', 'ok'); };
  const draw = async () => {
    root.innerHTML = `<div class="ph1"><div><h1>Settings</h1><p>${esc(S.org.name)} · code <code>${esc(S.org.code)}</code> · ${esc(S.org.plan)} plan</p></div></div><div class="tabs">${TABS.map(([k, l]) => `<button data-t="${k}" class="${tab === k ? 'on' : ''}">${l}</button>`).join('')}</div><div id="tb">${spinner()}</div>`;
    const tb = $('#tb'), s = S.settings;
    if (tab === 'org') {
      tb.innerHTML = `<div class="card" style="max-width:640px"><div class="frm-g">${fld('Organization name', inp('org_name', S.org.name))}${fld('City', inp('city', S.org.city || ''))}${fld('Company phone (on receipts)', inp('company_phone', s.company_phone || ''))}${fld('Company address (on receipts)', inp('company_address', s.company_address || ''))}</div><button class="btn primary" id="sv">Save</button></div>
        <div class="card mt" style="max-width:640px"><h3>Client portal</h3>${fld('Portal link validity (days)', inp('portal_days', s.portal_days || 30, 'type="number" min="1"'))}<button class="btn primary" id="sv2">Save</button></div>`;
      $('#sv').onclick = () => saveS({ org_name: $('[name=org_name]', tb).value, city: $('[name=city]', tb).value, company_phone: $('[name=company_phone]', tb).value, company_address: $('[name=company_address]', tb).value }).then(() => { $('.brand small')?.replaceChildren(S.org.name); });
      $('#sv2').onclick = () => saveS({ portal_days: Number($('[name=portal_days]', tb).value) });
    } else if (tab === 'leads') {
      tb.innerHTML = `<div class="card" style="max-width:680px">
        <label class="row"><input type="checkbox" id="c1" ${s.auto_assign ? 'checked' : ''}> <div><b>Auto-assign new leads using assignment rules</b><div class="small muted">Configure the rules under Lead Router.</div></div></label><hr style="border:0;border-top:1px solid var(--line)">
        <label class="row"><input type="checkbox" id="c2" ${s.reps_can_create_leads ? 'checked' : ''}> <div><b>Reps can add leads manually</b><div class="small muted">Leads a rep adds are assigned to that rep.</div></div></label><hr style="border:0;border-top:1px solid var(--line)">
        <label class="row"><input type="checkbox" id="c3" ${s.overdue_reminders ? 'checked' : ''}> <div><b>Automatic overdue-task reminders every 10 minutes</b><div class="small muted">Reps are notified; tasks overdue &gt; 24h escalate once to admins.</div></div></label><hr style="border:0;border-top:1px solid var(--line)">
        <div class="frm-g">${fld('Max open leads per rep', inp('max_open_leads_per_rep', s.max_open_leads_per_rep || 0, 'type="number" min="0"'), '0 = no limit. Reps at the cap are skipped by auto-assignment.')}${fld('Default plot hold (hours)', inp('hold_hours_default', s.hold_hours_default || 48, 'type="number" min="1"'))}</div><button class="btn primary" id="sv">Save</button></div>`;
      $('#sv').onclick = () => saveS({ auto_assign: $('#c1').checked, reps_can_create_leads: $('#c2').checked, overdue_reminders: $('#c3').checked, max_open_leads_per_rep: Number($('[name=max_open_leads_per_rep]').value), hold_hours_default: Number($('[name=hold_hours_default]').value) });
    } else if (tab === 'fields') {
      const cf = (await get('/custom-fields'));
      tb.innerHTML = `<div class="card" style="max-width:760px"><div class="card-h"><h3>Custom lead fields</h3><button class="btn primary sm" id="af">＋ Add field</button></div><p class="small muted">Shown on the Add Lead form and lead page. Deleting a field hides it; values already saved stay in the database.</p>${cf.length ? cf.map((f) => `<div class="list-row"><div><b>${esc(f.label)}</b> ${badge(f.type)} ${f.required ? badge('required', 'b-amber') : ''}${f.type === 'dropdown' ? `<div class="small muted">${f.options.map(esc).join(' · ')}</div>` : ''}</div><button class="btn sm ghost" data-df="${f.id}">🗑</button></div>`).join('') : empty('No custom fields yet', 'e.g. "Loan required?", "Family size", "Referred by".')}</div>`;
      $('#af').onclick = () => modalForm({ title: 'Add custom field', body: `${fld('Label', inp('label', '', 'placeholder="e.g. Loan required?"'))}${fld('Type', sel('type', [['text', 'Text'], ['number', 'Number'], ['date', 'Date'], ['dropdown', 'Dropdown'], ['checkbox', 'Checkbox']]))}<div id="opt" class="hidden">${fld('Options (comma separated)', inp('options', '', 'placeholder="Yes, No, Maybe"'))}</div><label class="row"><input type="checkbox" name="required"> Required on the Add Lead form</label>`,
        onOpen: (e) => ($('[name=type]', e).onchange = (ev) => $('#opt', e).classList.toggle('hidden', ev.target.value !== 'dropdown')), onSubmit: async (d) => { await post('/custom-fields', d); const { loadMeta } = await import('./core.js'); await loadMeta(); toast('Field added', 'ok'); draw(); } });
      on(tb, 'click', '[data-df]', async (el) => { if (await confirmDialog('Delete this field?', { ok: 'Delete', danger: true })) { await del('/custom-fields/' + el.dataset.df); const { loadMeta } = await import('./core.js'); await loadMeta(); draw(); } });
    } else if (tab === 'auto') {
      const rules = await get('/automation-rules');
      tb.innerHTML = `<div class="card" style="max-width:820px"><div class="card-h"><h3>Automation rules</h3><button class="btn primary sm" id="ar">＋ New rule</button></div><p class="small muted">Run automatically every time a lead moves to the chosen stage.</p>${rules.length ? rules.map((r) => `<div class="list-row"><div><b>When lead becomes "${esc(r.trigger_stage)}"</b><div class="small muted">${r.create_task ? `Create task "${esc(r.task_title)}" due in ${r.due_hours}h` : ''}${r.create_task && r.notify_admin ? ' · ' : ''}${r.notify_admin ? 'Notify admin' : ''}</div></div><div class="row gap-s"><label class="row gap-s"><input type="checkbox" data-ra="${r.id}" ${r.active ? 'checked' : ''}> on</label><button class="btn sm ghost" data-dr="${r.id}">🗑</button></div></div>`).join('') : empty('No automation rules')}</div>`;
      $('#ar').onclick = () => modalForm({ title: 'New automation rule', body: `${fld('When a lead moves to', sel('trigger_stage', S.meta.stages.filter((x) => x !== 'New')))}<label class="row mb"><input type="checkbox" name="create_task" checked> Create a follow-up task</label><div class="frm-g">${fld('Task title', inp('task_title', 'Follow up'))}${fld('Due in (hours)', inp('due_hours', 24, 'type="number" min="0"'))}</div><label class="row"><input type="checkbox" name="notify_admin"> Notify admin</label>`, onSubmit: async (d) => { await post('/automation-rules', d); toast('Rule created', 'ok'); draw(); } });
      on(tb, 'change', '[data-ra]', async (el) => { await put('/automation-rules/' + el.dataset.ra, { active: el.checked }); toast(el.checked ? 'Rule on' : 'Rule off', 'ok'); });
      on(tb, 'click', '[data-dr]', async (el) => { await del('/automation-rules/' + el.dataset.dr); draw(); });
    } else if (tab === 'widgets') {
      const W = [['kpis', 'KPI cards'], ['sla', 'Task SLA summary'], ['funnel', 'Lead stage funnel'], ['hot', 'Top priority hot prospects'], ['activity', 'Recent activity stream'], ['agenda', "Today's follow-up agenda"], ['health', 'Rep health monitor'], ['visits', 'Scheduled site visits'], ['leaderboard', 'Team achievement leaderboard'], ['collections', 'Inventory overview']];
      tb.innerHTML = `<div class="card" style="max-width:520px"><h3>Dashboard widgets</h3><p class="small muted">Choose what appears on everyone's dashboard.</p>${W.map(([k, l]) => `<label class="row" style="padding:5px 0"><input type="checkbox" data-w="${k}" ${s.widgets?.[k] !== false ? 'checked' : ''}> ${l}</label>`).join('')}<button class="btn primary mt" id="sv">Save</button></div>`;
      $('#sv').onclick = () => saveS({ widgets: Object.fromEntries($$('[data-w]', tb).map((c) => [c.dataset.w, c.checked])) });
    } else if (tab === 'att') {
      const g = s.geofence || {};
      tb.innerHTML = `<div class="card" style="max-width:680px"><h3>Attendance & geofence</h3><div class="frm-g">${fld('Shift start time', inp('shift_start', s.shift_start || '10:00', 'type="time"'), '15-minute grace before "late"')}${fld('Geofence name', inp('gname', g.name || '', 'placeholder="Head office"'))}${fld('Office latitude', inp('glat', g.lat ?? '', 'type="number" step="any"'))}${fld('Office longitude', inp('glng', g.lng ?? '', 'type="number" step="any"'))}${fld('Allowed radius (metres)', inp('grad', g.radius || 200, 'type="number" min="20"'))}</div>
        <button class="btn sm mb" id="loc">📍 Use my current location as the office</button><label class="row mb"><input type="checkbox" id="genf" ${g.enforce ? 'checked' : ''}> <div><b>Block clock-in outside the geofence</b><div class="small muted">Off = outside clock-ins are allowed but flagged (recommended for field teams).</div></div></label><button class="btn primary" id="sv">Save</button></div>`;
      $('#loc').onclick = () => navigator.geolocation ? navigator.geolocation.getCurrentPosition((p) => { $('[name=glat]').value = p.coords.latitude.toFixed(6); $('[name=glng]').value = p.coords.longitude.toFixed(6); toast('Location captured — click Save', 'ok'); }, () => toast('Location permission denied', 'err'), { enableHighAccuracy: true }) : toast('Geolocation not supported', 'err');
      $('#sv').onclick = () => saveS({ shift_start: $('[name=shift_start]').value, geofence: { name: $('[name=gname]').value, lat: $('[name=glat]').value, lng: $('[name=glng]').value, radius: Number($('[name=grad]').value), enforce: $('#genf').checked } });
    } else if (tab === 'ai') {
      tb.innerHTML = `<div class="card" style="max-width:680px"><h3>RealPilot AI</h3><p class="small muted">CRM commands (distribute leads, pipeline summary, hot leads, overdue payments…) always work offline. Add an Anthropic API key to unlock open-ended sales coaching and richer message drafting.</p>
        ${fld('Anthropic API key', inp('key', s.anthropic_key || '', 'type="password" autocomplete="off" placeholder="sk-ant-…"'), 'Stored on your server only. Leave the masked value to keep it; clear it to disable.')}${fld('Custom instructions (tone / focus)', `<textarea name="prompt" placeholder="e.g. Always reply in simple English/Hinglish. We sell DTCP-approved plots near Shadnagar. Never promise appreciation numbers.">${esc(s.ai_prompt || '')}</textarea>`)}<button class="btn primary" id="sv">Save</button></div>`;
      $('#sv').onclick = () => saveS({ anthropic_key: $('[name=key]').value, ai_prompt: $('[name=prompt]').value });
    } else if (tab === 'audit') {
      const rows = await get('/audit');
      tb.innerHTML = rows.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Detail</th></tr></thead><tbody>${rows.map((a) => `<tr><td class="small nowrap">${fmtDT(a.at)}</td><td>${esc(a.user_name || '—')}</td><td><code>${esc(a.action)}</code></td><td class="small">${esc(a.detail || '')}</td></tr>`).join('')}</tbody></table></div>` : empty('No audit entries yet', 'Sensitive actions (deletes, voids, cancellations, overrides) are recorded here.');
    }
  };
  on(root, 'click', '[data-t]', (el) => { tab = el.dataset.t; draw(); });
  await draw();
}
