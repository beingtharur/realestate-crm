// Team & targets, rep profile + daily activity, attendance & presence, channel partners.
import { S, $, $$, esc, get, post, patch, put, del, on, modal, modalForm, confirmDialog, toast, fld, inp, sel, repOptions, inr, inrShort, rel, fmtDT, fmtDate, fmtTime, today,
  isAdmin, empty, badge, phoneFmt, nav, reload, authUrl, debounce, spinner, fullLink, copy, loadMeta, initials, waLink } from './core.js';

const HEALTH_CLS = { Active: 'b-green', 'Slowing Down': 'b-amber', Inactive: 'b-red' };
const dur = (s) => (s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`);

// ================= team =================
export async function team(root, _p, q) {
  let data, invites = [], F = { q: '', role: '', status: '', health: '' }, tab = 'roster';
  const load = async () => { [data, invites] = await Promise.all([get('/team'), get('/team/invites')]); await loadMeta(); draw(); };
  const draw = () => {
    const pl = data.plan, used = pl.used + pl.pending_invites, pct = Math.min(100, (used / pl.limit) * 100);
    const members = data.members.filter((m) => (!F.q || (m.name + m.email).toLowerCase().includes(F.q.toLowerCase())) && (!F.role || m.role === F.role) && (!F.status || m.status === F.status) && (!F.health || m.health.status === F.health));
    root.innerHTML = `<div class="ph1"><div><h1>Team & targets</h1><p>${data.members.length} member(s) · manage access, targets and performance</p></div><button class="btn primary" id="inv">＋ Invite team member</button></div>
    <div class="card mb"><div class="card-h"><b>${pl.name} plan — ${pl.used} of ${pl.limit} active reps${pl.pending_invites ? ` (+${pl.pending_invites} pending invite${pl.pending_invites > 1 ? 's' : ''})` : ''}</b>${pct >= 80 ? '<span class="badge b-amber">Nearly full — upgrade to add more</span>' : ''}</div><div class="bar ${pct >= 100 ? 'red' : pct >= 80 ? 'amber' : ''}"><i style="width:${pct}%"></i></div></div>
    ${invites.length ? `<details class="acc mb"><summary>Pending invitations (${invites.length})</summary><div class="in">${invites.map((i) => `<div class="list-row"><div><b>${esc(i.name)}</b> <span class="muted small">${esc(i.email)} · ${esc(i.role)}</span><div class="small muted">Expires ${rel(i.expires_at)}</div></div><button class="btn sm ghost" data-rv="${i.id}">Revoke</button></div>`).join('')}<p class="small muted">The link is shown only once when created. Revoke and re-invite to get a new link.</p></div></details>` : ''}
    <div class="tabs"><button data-t="roster" class="${tab === 'roster' ? 'on' : ''}">Roster</button><button data-t="board" class="${tab === 'board' ? 'on' : ''}">Leaderboard</button></div>
    ${tab === 'roster' ? `<div class="filters"><input type="search" id="tq" placeholder="Search name or email…" value="${esc(F.q)}">${sel('role', [['', 'All roles'], ['admin', 'Admin'], ['rep', 'Rep']], F.role, 'id="tr"')}${sel('status', [['', 'Any status'], ['active', 'Active'], ['inactive', 'Deactivated']], F.status, 'id="ts"')}${sel('health', [['', 'Any health'], 'Active', 'Slowing Down', 'Inactive'], F.health, 'id="th"')}</div>
      <div class="grid g3">${members.map((m) => `<div class="card" ${m.status === 'inactive' ? 'style="opacity:.7"' : ''}><div class="row"><span class="avatar">${esc(initials(m.name))}</span><div style="min-width:0"><b>${esc(m.name)}</b><div class="muted small" style="overflow:hidden;text-overflow:ellipsis">${esc(m.email)}</div></div><div class="grow"></div>${badge(m.role, m.role === 'admin' ? 'b-brand' : '')}</div>
        <div class="row mt">${badge(m.status === 'active' ? 'Active' : 'Deactivated', m.status === 'active' ? 'b-green' : 'b-red')}${m.status === 'active' ? badge(m.health.status, HEALTH_CLS[m.health.status]) : ''}<span class="small muted">${m.health.open_leads} open leads</span></div>
        ${m.monthly_target || m.target_bookings ? `<div class="mt"><div class="row between small"><span>Monthly target</span><b>${m.target_progress ?? m.booking_progress}%</b></div><div class="bar ${(m.target_progress ?? m.booking_progress) >= 100 ? '' : (m.target_progress ?? m.booking_progress) < 40 ? 'red' : 'amber'}"><i style="width:${Math.min(100, m.target_progress ?? m.booking_progress)}%"></i></div><div class="small muted">${inrShort(m.perf.sales_value)}${m.monthly_target ? ' / ' + inrShort(m.monthly_target) : ''} · ${m.perf.bookings} booking(s)${m.target_bookings ? ' / ' + m.target_bookings : ''}</div></div>` : `<div class="small muted mt">${m.perf.bookings} booking(s) this month · ${m.perf.conversion}% conversion</div>`}
        <div class="row mt gap-s"><button class="btn sm" data-p="${m.id}">Full profile</button>${m.role === 'rep' ? (m.status === 'active' ? `<button class="btn sm" data-off="${m.id}">Deactivate</button>` : `<button class="btn sm" data-on="${m.id}">Reactivate</button>`) : ''}<button class="btn sm ghost" data-rl="${m.id}" title="Generate a password reset link">🔑</button>${m.role === 'rep' ? `<button class="btn sm danger" data-del="${m.id}">Delete</button>` : ''}</div></div>`).join('') || empty('No members match')}</div>` : leaderboard()}`;
    $('#inv').onclick = inviteForm;
    if (tab === 'roster') {
      $('#tq').oninput = (e) => { F.q = e.target.value; draw(); const i = $('#tq'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); };
      [['tr', 'role'], ['ts', 'status'], ['th', 'health']].forEach(([id, k]) => ($('#' + id).onchange = (e) => { F[k] = e.target.value; draw(); }));
    }
  };
  const leaderboard = () => {
    const rows = [...data.members].filter((m) => m.role === 'rep' && m.status === 'active').sort((a, b) => (b.target_progress ?? 0) - (a.target_progress ?? 0) || b.perf.sales_value - a.perf.sales_value);
    return rows.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>#</th><th>Rep</th><th class="r">Bookings</th><th class="r">Sales value</th><th class="r">Collected</th><th class="r">Leads</th><th class="r">Conversion</th><th>Target</th></tr></thead><tbody>${rows.map((m, i) => `<tr><td>${i + 1}</td><td><b>${esc(m.name)}</b></td><td class="r">${m.perf.bookings}</td><td class="r">${inr(m.perf.sales_value)}</td><td class="r">${inr(m.perf.collected)}</td><td class="r">${m.perf.leads}</td><td class="r">${m.perf.conversion}%</td><td style="min-width:130px">${m.target_progress !== null || m.booking_progress !== null ? `<div class="bar"><i style="width:${Math.min(100, m.target_progress ?? m.booking_progress)}%"></i></div><span class="small muted">${m.target_progress ?? m.booking_progress}%</span>` : '<span class="muted small">No target</span>'}</td></tr>`).join('')}</tbody></table></div><p class="small muted">This month.</p>` : empty('No active reps yet');
  };
  const inviteForm = () => modalForm({ title: 'Invite team member', submit: 'Create invite link', wide: true, body: `<p class="muted">They'll open the link, choose their own password and sign in. You never see their password. The link is valid for 72 hours and works once.</p><div class="frm-g">${fld('Full name <span class="req">*</span>', inp('name', '', 'required'))}${fld('Email <span class="req">*</span>', inp('email', '', 'type="email" required'))}${fld('Role', sel('role', [['rep', 'Representative'], ['admin', 'Admin']]))}${fld('Mobile', inp('phone', '', 'placeholder="98765 43210"'))}${fld('Specialization', inp('specialization', '', 'placeholder="e.g. Investors, NRI clients"'))}${fld('Monthly sales target (₹)', inp('monthly_target', '', 'type="number" min="0"'))}${fld('Monthly bookings target', inp('target_bookings', '', 'type="number" min="0"'))}</div>`,
    onSubmit: async (d) => { const r = await post('/team/invite', d); const link = fullLink(r.link); await load();
      const text = `Hi ${d.name.split(' ')[0]}, you're invited to join ${S.org.name} on RealtyPilot. Set your password here (valid 72 hours): ${link}`;
      modal({ title: 'Invitation ready', body: `<p>Share this link with <b>${esc(d.name)}</b>. <b>It won't be shown again.</b></p><p><code>${esc(link)}</code></p>`, footer: `<button class="btn" id="cp">Copy link</button><a class="btn primary" target="_blank" href="${d.phone ? waLink((d.phone.replace(/\D/g, '')).slice(-10), text) : 'https://wa.me/?text=' + encodeURIComponent(text)}">Share on WhatsApp</a>`, onOpen: (e) => ($('#cp', e).onclick = () => copy(link)) }); } });
  on(root, 'click', '[data-t]', (el) => { tab = el.dataset.t; draw(); });
  on(root, 'click', '[data-rv]', async (el) => { await del('/team/invites/' + el.dataset.rv); toast('Invitation revoked'); load(); });
  on(root, 'click', '[data-p]', (el) => profile(Number(el.dataset.p), load));
  on(root, 'click', '[data-off]', async (el) => { if (await confirmDialog('This rep will no longer be able to sign in or receive new leads. Their data is kept.', { ok: 'Deactivate', danger: true, title: 'Deactivate rep?' })) { try { const r = await post(`/team/${el.dataset.off}/deactivate`); toast(r.open_leads ? `Deactivated. ${r.open_leads} open lead(s) still assigned — reassign them from Leads.` : 'Deactivated', 'ok'); load(); } catch (e) { toast(e.message, 'err'); } } });
  on(root, 'click', '[data-on]', async (el) => { try { await post(`/team/${el.dataset.on}/reactivate`); toast('Reactivated', 'ok'); load(); } catch (e) { toast(e.message, 'err'); } });
  on(root, 'click', '[data-rl]', async (el) => { const r = await post(`/team/${el.dataset.rl}/reset-link`); const link = fullLink(r.link); modal({ title: 'Password reset link', body: `<p>Send this to the team member. It works once and expires in ${r.expires_in_minutes} minutes.</p><p><code>${esc(link)}</code></p>`, footer: '<button class="btn primary" id="cp">Copy link</button>', onOpen: (e) => ($('#cp', e).onclick = () => copy(link)) }); });
  on(root, 'click', '[data-del]', (el) => {
    const m = data.members.find((x) => x.id == el.dataset.del);
    modalForm({ title: `Delete ${m.name}?`, submit: 'Delete permanently', danger: true, body: `<div class="warn-box">This is permanent. ${m.name} will disappear from every list. Their <b>${m.health.open_leads} open lead(s)</b> and pending tasks must go to someone else.</div>${fld('Reassign leads & tasks to', sel('reassign_to', repOptions('Choose…', false).slice(1).filter((o) => o[0] != m.id)))}`,
      onSubmit: async (d) => { await post(`/team/${m.id}/delete`, { reassign_to: Number(d.reassign_to) }); toast('Rep deleted and leads reassigned', 'ok'); load(); } });
  });
  await load();
  if (q.rep) profile(Number(q.rep), load);
}

// ================= profile =================
async function profile(id, done) {
  const admin = isAdmin();
  const p = await get(`/team/${id}/profile`); const u = p.user;
  let range = 'day', date = today();
  const m = modal({ title: u.name, xl: true, body: `<div class="row mb"><span class="avatar">${esc(initials(u.name))}</span><div><b>${esc(u.email)}</b> ${badge(u.role, 'b-brand')}<div class="small muted">${u.phone ? phoneFmt(u.phone) : 'No phone'}${u.specialization ? ' · ' + esc(u.specialization) : ''}</div></div><div class="grow"></div>${badge(p.health.status, HEALTH_CLS[p.health.status])}${admin ? '<button class="btn sm" id="pe">Edit</button>' : ''}</div>
    <div class="grid g4 keep mb">${[['Bookings (month)', p.perf.bookings], ['Sales (month)', inrShort(p.perf.sales_value)], ['Collected (month)', inrShort(p.perf.collected)], ['Conversion (month)', p.perf.conversion + '%']].map(([l, v]) => `<div class="card kpi"><div class="l">${l}</div><div class="v">${v}</div></div>`).join('')}</div>
    <div class="tabs" id="ptabs"><button data-pt="act" class="on">Daily activity summary</button><button data-pt="perf">Performance & targets</button><button data-pt="sess">Login / session audit</button><button data-pt="att">Attendance audit</button></div><div id="pb"></div>` });
  const pb = $('#pb', m.el);
  const show = async (t) => {
    $$('#ptabs button', m.el).forEach((b) => b.classList.toggle('on', b.dataset.pt === t));
    if (t === 'perf') {
      pb.innerHTML = `<div class="grid g2"><div class="card"><h3>Targets</h3><dl class="kv"><dt>Monthly sales</dt><dd>${u.monthly_target ? inr(u.monthly_target) : 'Not set'}</dd><dt>Monthly bookings</dt><dd>${u.target_bookings || 'Not set'}</dd></dl></div>
        <div class="card"><h3>All-time</h3><dl class="kv"><dt>Bookings</dt><dd>${p.perf_all.bookings}</dd><dt>Sales value</dt><dd>${inr(p.perf_all.sales_value)}</dd><dt>Collected</dt><dd>${inr(p.perf_all.collected)}</dd><dt>Leads</dt><dd>${p.perf_all.leads} (${p.perf_all.conversion}% converted)</dd></dl></div>
        <div class="card"><h3>Health</h3><dl class="kv"><dt>Status</dt><dd>${badge(p.health.status, HEALTH_CLS[p.health.status])}</dd><dt>Open leads</dt><dd>${p.health.open_leads}</dd><dt>Untouched 48h+</dt><dd>${p.health.untouched}</dd><dt>Last activity</dt><dd>${p.health.last_activity ? rel(p.health.last_activity) : 'never'}</dd></dl></div></div>`;
    } else if (t === 'sess') {
      pb.innerHTML = p.sessions.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Signed in</th><th>Device</th><th>Last active</th><th>Status</th></tr></thead><tbody>${p.sessions.map((s) => `<tr><td>${fmtDT(s.created_at)}</td><td>${esc(s.device)}<div class="muted small">${esc(s.ip || '')}</div></td><td>${rel(s.last_seen)}</td><td>${s.online ? badge('Online', 'b-green') : s.ended_at ? badge('Signed out') : badge('Offline')}</td></tr>`).join('')}</tbody></table></div>` : empty('No sessions yet');
    } else if (t === 'att') {
      pb.innerHTML = p.attendance.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Date</th><th>In</th><th>Out</th><th>Location</th><th>Geofence</th></tr></thead><tbody>${p.attendance.map((a) => `<tr><td>${fmtDate(a.date)}</td><td>${fmtTime(a.clock_in)}${a.late ? ' <span class="badge b-amber">late</span>' : ''}</td><td>${a.clock_out ? fmtTime(a.clock_out) : '—'}</td><td class="small">${esc(a.place || '—')}</td><td>${a.inside_geofence === null ? '—' : a.inside_geofence ? badge('Inside', 'b-green') : badge((a.distance_m || '?') + ' m away', 'b-red')}</td></tr>`).join('')}</tbody></table></div>` : empty('No attendance records');
    } else {
      pb.innerHTML = spinner();
      const a = await get(`/team/${id}/activity?range=${range}&date=${date}`);
      const list = (items, kind) => (items || []).length ? `<div class="in">${items.map((x) => `<div class="list-row small"><span>${x.lead_id ? `<a href="#/leads/${x.lead_id}" data-close>${esc(x.lead_name || 'Lead')}</a>` : ''}${x.title ? ` ${esc(x.title)}` : ''} ${kind === 'call' ? `<span class="muted">${esc(x.direction || '')} · ${esc(x.outcome || '')}${x.duration ? ' · ' + dur(x.duration) : ''}</span>` : ''}</span><span class="muted">${fmtTime(x.at || x.due_at)}</span></div>`).join('')}</div>` : '';
      const row = (label, val, items, kind) => items && items.length ? `<details class="acc"><summary><span>${label}</span><b>${val}</b></summary>${list(items, kind)}</details>` : `<div class="list-row" style="padding:8px 12px;border:1px solid var(--line);border-radius:8px;margin:6px 0"><span>${label}</span><b>${val}</b></div>`;
      const c = a.calls, t2 = a.tasks, w = a.whatsapp;
      pb.innerHTML = `<div class="row mb"><div class="seg" id="rs">${[['day', 'Day'], ['week', 'Week'], ['month', 'Month']].map(([k, l]) => `<button data-r="${k}" class="${range === k ? 'on' : ''}">${l}</button>`).join('')}</div><input type="date" id="rd" value="${date}" max="${today()}" style="width:auto"><span class="muted">${esc(a.range.label)}</span></div>
      <div class="grid g3 stack"><div><h3 class="mb">📞 Calls</h3>${row('First call', c.first_call ? fmtTime(c.first_call) : '—')}${row('Last call', c.last_call ? fmtTime(c.last_call) : '—')}${row('All calls', c.total, c.items.all, 'call')}${row('Incoming', c.incoming, c.items.incoming, 'call')}${row('Outgoing', c.outgoing, c.items.outgoing, 'call')}${row('Missed', c.missed, c.items.missed, 'call')}${row('Connected', c.connected, c.items.connected, 'call')}${row('Attempted', c.attempted, c.items.outgoing, 'call')}${row('Total duration', dur(c.total_duration))}</div>
        <div><h3 class="mb">✅ Tasks</h3>${row('Late', t2.late, t2.items.late)}${row('Pending', t2.pending, t2.items.pending)}${row('Done', t2.done, t2.items.done)}${row('Created', t2.created, t2.items.created)}</div>
        <div><h3 class="mb">💬 WhatsApp</h3>${row('Incoming', w.incoming, w.items.incoming, 'call')}${row('Outgoing', w.outgoing, w.items.outgoing, 'call')}</div></div>`;
      $$('#rs [data-r]', pb).forEach((b) => (b.onclick = () => { range = b.dataset.r; show('act'); }));
      $('#rd', pb).onchange = (e) => { date = e.target.value || today(); show('act'); };
    }
  };
  on(m.el, 'click', '[data-pt]', (b) => show(b.dataset.pt));
  const pe = $('#pe', m.el); if (pe) pe.onclick = () => modalForm({ title: 'Edit member', body: `<div class="frm-g">${fld('Name', inp('name', u.name))}${fld('Mobile', inp('phone', u.phone || ''))}${fld('Specialization', inp('specialization', u.specialization || ''))}${fld('Monthly sales target (₹)', inp('monthly_target', u.monthly_target || '', 'type="number"'))}${fld('Monthly bookings target', inp('target_bookings', u.target_bookings || '', 'type="number"'))}</div>`, onSubmit: async (d) => { await patch('/team/' + id, d); toast('Saved', 'ok'); m.close(); done && done(); } });
  show('act');
}

// ================= attendance =================
export async function attendance(root) {
  const admin = isAdmin(); let date = today(), timer;
  const draw = async () => {
    const me = await get('/attendance/me');
    const t = me.today;
    let adm = null, pres = null;
    if (admin) [adm, pres] = await Promise.all([get('/attendance?date=' + date), get('/presence')]);
    root.innerHTML = `<div class="ph1"><div><h1>${admin ? 'Attendance & activity' : 'Clock-in'}</h1><p>GPS-verified check-in${me.geofence.configured ? ` within ${me.geofence.radius} m of ${esc(me.geofence.name || 'the office')}` : ''}</p></div></div>
    <div class="card mb"><div class="row between"><div><h3>Today</h3>${t?.clock_in ? `<p>Clocked in at <b>${fmtTime(t.clock_in)}</b> ${t.late ? badge('late', 'b-amber') : badge('on time', 'b-green')} — ${esc(t.place || '')}${t.inside_geofence === 0 ? ' ' + badge('outside geofence', 'b-red') : ''}${t.clock_out ? `<br>Clocked out at <b>${fmtTime(t.clock_out)}</b> (${((Date.parse(t.clock_out) - Date.parse(t.clock_in)) / 3.6e6).toFixed(1)} h)` : ''}</p>` : '<p class="muted">You have not clocked in yet.</p>'}<div id="cerr"></div></div>
      <div>${!t?.clock_in ? '<button class="btn primary" id="cin">📍 Clock in</button>' : !t.clock_out ? '<button class="btn" id="cout">Clock out</button>' : badge('Day complete', 'b-green')}</div></div><p class="small muted">Your browser will ask for location access. Clock-in is not possible without it.</p></div>
    ${admin ? `<div class="grid g4 keep mb"><div class="card kpi"><div class="l">Present</div><div class="v">${adm.summary.present}<span class="muted" style="font-size:14px"> / ${adm.summary.total}</span></div></div><div class="card kpi"><div class="l">On-time</div><div class="v">${adm.summary.on_time_pct}%</div></div><div class="card kpi"><div class="l">Avg shift (30d)</div><div class="v">${adm.summary.avg_shift_hours} h</div></div><div class="card kpi"><div class="l">Geofence compliance</div><div class="v">${adm.summary.geofence_pct === null ? '—' : adm.summary.geofence_pct + '%'}</div></div></div>
      <div class="card mb"><div class="card-h"><h3>Live presence</h3><span class="muted small">based on real sign-ins & heartbeats · refreshes every 30s</span></div><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Name</th><th>Status</th><th>First login today</th><th>Last active</th><th>Device</th><th class="r">Session</th></tr></thead><tbody>${pres.map((p) => `<tr><td><b>${esc(p.name)}</b> <span class="muted small">${esc(p.role)}</span></td><td>${p.online ? badge('● Online', 'b-green') : badge('Offline')}</td><td>${p.first_login_today ? fmtTime(p.first_login_today) : '—'}</td><td>${p.last_active ? rel(p.last_active) : '—'}</td><td class="small">${esc(p.device)}</td><td class="r">${p.session_minutes >= 60 ? Math.floor(p.session_minutes / 60) + 'h ' + (p.session_minutes % 60) + 'm' : p.session_minutes + 'm'}</td></tr>`).join('')}</tbody></table></div></div>
      <div class="card"><div class="card-h"><h3>Attendance log</h3><div class="row"><input type="date" id="ad" value="${date}" max="${today()}" style="width:auto"><a class="btn sm" href="${authUrl('/attendance/export')}">⬇ Export CSV (30 days)</a></div></div>
        ${adm.rows.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Name</th><th>In</th><th>Out</th><th class="r">Hours</th><th>Location</th><th>Geofence</th><th></th></tr></thead><tbody>${adm.rows.map((a) => `<tr><td><b>${esc(a.user_name)}</b>${a.override_by ? '<div class="small muted">admin override</div>' : ''}</td><td>${a.clock_in ? fmtTime(a.clock_in) : '—'} ${a.late ? '<span class="badge b-amber">late</span>' : ''}</td><td>${a.clock_out ? fmtTime(a.clock_out) : '—'}</td><td class="r">${a.clock_in && a.clock_out ? ((Date.parse(a.clock_out) - Date.parse(a.clock_in)) / 3.6e6).toFixed(1) : '—'}</td><td class="small">${esc(a.place || '—')}${a.lat ? `<br><a target="_blank" href="https://maps.google.com/?q=${a.lat},${a.lng}">map</a>` : ''}</td><td>${a.inside_geofence === null ? '—' : a.inside_geofence ? badge('Inside', 'b-green') : badge((a.distance_m ?? '?') + ' m away', 'b-red')}</td><td><button class="btn sm ghost" data-ov="${a.user_id}" data-n="${esc(a.user_name)}">Override</button></td></tr>`).join('')}</tbody></table></div>` : empty('No one has clocked in on this date')}
        ${adm.absent.length ? `<p class="mt small"><b>Not clocked in:</b> ${adm.absent.map((x) => `${esc(x.name)} <a href="#" data-ov="${x.id}" data-n="${esc(x.name)}">(mark)</a>`).join(', ')}</p>` : ''}</div>`
    : `<div class="card"><h3>My history</h3>${me.history.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Date</th><th>In</th><th>Out</th><th>Location</th></tr></thead><tbody>${me.history.map((a) => `<tr><td>${fmtDate(a.date)}</td><td>${fmtTime(a.clock_in)} ${a.late ? '<span class="badge b-amber">late</span>' : ''}</td><td>${a.clock_out ? fmtTime(a.clock_out) : '—'}</td><td class="small">${esc(a.place || '')}</td></tr>`).join('')}</tbody></table></div>` : empty('No history yet')}</div>`}`;
    const ci = $('#cin'); if (ci) ci.onclick = () => {
      ci.disabled = true; const err = (m) => { $('#cerr').innerHTML = `<div class="err mt">${esc(m)}</div>`; ci.disabled = false; };
      if (!navigator.geolocation) return err('This browser does not support location. Use a phone or a modern browser.');
      navigator.geolocation.getCurrentPosition(async (pos) => { try { await post('/attendance/clock-in', { lat: pos.coords.latitude, lng: pos.coords.longitude }); toast('Clocked in', 'ok'); draw(); } catch (e) { err(e.message); } },
        (e) => err(e.code === 1 ? 'Location permission was denied. Allow location access for this site in your browser settings, then try again.' : 'Could not get your location. Check GPS/network and retry.'), { enableHighAccuracy: true, timeout: 15000 });
    };
    const co = $('#cout'); if (co) co.onclick = async () => { try { await post('/attendance/clock-out'); toast('Clocked out', 'ok'); draw(); } catch (e) { toast(e.message, 'err'); } };
    const ad = $('#ad'); if (ad) ad.onchange = (e) => { date = e.target.value; draw(); };
  };
  on(root, 'click', '[data-ov]', (el, e) => { e.preventDefault(); const uid = Number(el.dataset.ov);
    modalForm({ title: `Attendance override — ${el.dataset.n}`, submit: 'Save', body: `<p class="muted">Date: ${fmtDate(date)}</p>${fld('Clock in', inp('clock_in', `${date}T10:00`, 'type="datetime-local"'))}${fld('Clock out', inp('clock_out', `${date}T19:00`, 'type="datetime-local"'))}${fld('Reason', inp('note', '', 'placeholder="e.g. Site visit day, forgot to clock in"'))}`,
      onSubmit: async (d) => { await post('/attendance/override', { user_id: uid, date, clock_in: d.clock_in || null, clock_out: d.clock_out || null, note: d.note }); toast('Saved', 'ok'); draw(); } }); });
  await draw();
  timer = setInterval(() => { if (document.hidden || document.querySelector('.modal-wrap')) return; if (admin) draw(); }, 30000);
  return () => clearInterval(timer);
}

// ================= partners =================
export async function partners(root) {
  let tab = 'partners';
  const form = (p) => modalForm({ title: p ? 'Edit partner' : 'Add channel partner / broker', wide: true, body: `<div class="frm-g">${fld('Name', inp('name', p?.name || '', 'required'))}${fld('Type', sel('type', [['broker', 'Broker / agent'], ['channel_partner', 'Channel partner'], ['referral', 'Referral (customer / staff)']], p?.type || 'broker'))}${fld('Mobile', inp('phone', p?.phone || ''))}${fld('Email', inp('email', p?.email || '', 'type="email"'))}${fld('Commission (% of price)', inp('commission_pct', p?.commission_pct ?? 2, 'type="number" step="0.1" min="0" max="50"'), 'Applied on base price + PLC − discount')}${fld('Notes', inp('notes', p?.notes || ''))}</div>`,
    onSubmit: async (d) => { if (p) await patch('/partners/' + p.id, d); else await post('/partners', d); await loadMeta(); toast('Saved', 'ok'); draw(); } });
  const draw = async () => {
    root.innerHTML = `<div class="ph1"><div><h1>Channel partners</h1><p>Brokers and referrers — track their leads, sales and commission</p></div><button class="btn primary" id="np">＋ Add partner</button></div>
    <div class="tabs"><button data-t="partners" class="${tab === 'partners' ? 'on' : ''}">Partners</button><button data-t="comm" class="${tab === 'comm' ? 'on' : ''}">Commissions</button></div><div id="tb">${spinner()}</div>`;
    $('#np').onclick = () => form();
    if (tab === 'partners') {
      const rows = await get('/partners'); const tb = $('#tb');
      tb.innerHTML = rows.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Partner</th><th>Type</th><th class="r">Commission</th><th class="r">Leads</th><th class="r">Bookings</th><th class="r">Earned</th><th class="r">Paid</th><th>Active</th><th></th></tr></thead><tbody>${rows.map((p) => `<tr><td><b>${esc(p.name)}</b><div class="muted small">${phoneFmt(p.phone)} ${esc(p.email || '')}</div></td><td>${esc(p.type.replace('_', ' '))}</td><td class="r">${p.commission_pct}%</td><td class="r">${p.leads}</td><td class="r">${p.bookings}</td><td class="r">${inr(p.commission_total)}</td><td class="r">${inr(p.commission_paid)}</td><td><input type="checkbox" data-act="${p.id}" ${p.active ? 'checked' : ''}></td><td><button class="btn sm" data-e="${p.id}">Edit</button></td></tr>`).join('')}</tbody></table></div>` : empty('No partners yet', 'Add brokers so you can tag their leads and pay commission on bookings.');
      on(tb, 'click', '[data-e]', (el) => form(rows.find((p) => p.id == el.dataset.e)));
      on(tb, 'change', '[data-act]', async (el) => { await patch('/partners/' + el.dataset.act, { active: el.checked }); await loadMeta(); });
    } else {
      const rows = await get('/commissions'); const tb = $('#tb');
      tb.innerHTML = rows.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Partner</th><th>Booking</th><th>Buyer</th><th class="r">Sale value</th><th class="r">Commission</th><th>Status</th><th></th></tr></thead><tbody>${rows.map((c) => `<tr><td>${esc(c.partner_name)}</td><td><a href="#/bookings/${c.booking_id}">${esc(c.booking_no)}</a></td><td>${esc(c.buyer)}</td><td class="r">${inr(c.total)}</td><td class="r"><b>${inr(c.amount)}</b> <span class="muted small">(${c.pct}%)</span></td><td>${badge(c.status + (c.paid_on ? ' · ' + fmtDate(c.paid_on) : ''), c.status === 'paid' ? 'b-green' : c.status === 'cancelled' ? 'b-red' : c.status === 'approved' ? 'b-blue' : 'b-amber')}</td>
        <td class="nowrap">${c.status === 'pending' ? `<button class="btn sm" data-s="approved" data-id="${c.id}">Approve</button> ` : ''}${['pending', 'approved'].includes(c.status) ? `<button class="btn sm primary" data-s="paid" data-id="${c.id}">Mark paid</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : empty('No commissions yet', 'Created automatically when a booking is tagged with a partner.');
      on(tb, 'click', '[data-s]', async (el) => { try { await post(`/commissions/${el.dataset.id}/status`, { status: el.dataset.s }); toast('Updated', 'ok'); draw(); } catch (e) { toast(e.message, 'err'); } });
    }
  };
  on(root, 'click', '[data-t]', (el) => { tab = el.dataset.t; draw(); });
  await draw();
}
