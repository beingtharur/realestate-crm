// Dashboard: answers "what needs me right now?" first, then how the pipeline is doing.
import { S, $, $$, esc, get, post, on, inr, inrShort, rel, friendlyDT, fmtTime, fmtDate, isAdmin, empty, badge, stageBadge, ratingBadge, nav, reload, phoneFmt, hbars, quickActions, ico, toast, statusChip, avatar } from './core.js';
import { leadForm, openLeadDrawer } from './v_leads.js';

const RANGES = [['today', 'Today'], ['week', 'Week'], ['month', 'Month'], ['all', 'All time']];
let range = 'month';

export async function render(root, _p, q) {
  if (q.range) range = q.range;
  const d = await get('/dashboard?range=' + range);
  // Be forgiving if the server is older than this screen (e.g. it was not restarted after an update): missing pieces count as zero / empty.
  d.new_leads ||= []; d.cooling_leads ||= []; d.agenda ||= []; d.visits ||= []; d.activity ||= []; d.hot_prospects ||= []; d.health ||= []; d.leaderboard ||= []; d.funnel ||= []; d.inventory ||= { total: 0 }; d.sla ||= {};
  const admin = isAdmin(), w = (k) => S.settings.widgets?.[k] !== false, k = d.kpis, at = d.attention || {};
  const f = { overdue_followups: d.sla.overdue || 0, due_today: d.sla.due_today || 0, new_uncontacted: 0, hot_cooling: 0, visits_today: 0, ...(d.focus || {}) };
  const label = RANGES.find((r) => r[0] === range)[1].toLowerCase();
  const hr = new Date().getHours(), first = S.user.name.split(' ')[0];
  const dateStr = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' });

  // ---- what needs attention (each tile opens the exact list behind it) ----
  const tiles = [
    ['alert', 'red', f.overdue_followups, 'Overdue follow-ups', '#/tasks?bucket=overdue'],
    ['clock', 'amber', f.due_today, 'Follow-ups due today', '#/tasks?bucket=today'],
    ['inbox', 'blue', f.new_uncontacted, 'New leads to contact', '#/leads?uncontacted=1'],
    ['flame', 'red', f.hot_cooling, 'Hot leads going cold', '#/leads?cooling=1'],
    ['truck', 'violet', f.visits_today, 'Site visits today', '#/visits?when=today'],
    ...(admin ? [
      ['userPlus', 'slate', at.unassigned, 'Unassigned leads', '#/leads?tab=unassigned'],
      ['rupee', 'red', Math.round(d.collections?.overdue_bookings || 0), 'Bookings with overdue payments', '#/collections'],
      ['tag', 'amber', at.discounts, 'Discount approvals', '#/discounts'],
    ] : []),
  ];
  const tile = ([ic, col, n, lab, href]) => `<button class="ftile ${n ? '' : 'zero'}" data-href="${href}" aria-label="${n} ${esc(lab)}"><span class="fi ${n ? col : 'slate'}">${ico(ic)}</span><span><b>${n || 0}</b><span class="l">${esc(lab)}</span></span></button>`;

  // ---- panels ----
  const leadRow = (l, sub) => `<div class="mini-row" data-lead="${l.id}" tabindex="0" role="button">${avatar(l.name, 'soft')}<div class="grow"><div class="nm">${esc(l.name)}</div><div class="sub">${esc(sub)}</div></div>${ratingBadge(l.rating)}${quickActions(l.id, l.name, l.phone_norm)}</div>`;
  const panel = (icon, title, body, link) => `<section class="card"><div class="panel-h"><h3>${ico(icon, 'sm')}${title}</h3>${link ? `<a class="small" href="${link[1]}">${link[0]}</a>` : ''}</div>${body}</section>`;
  const agenda = d.agenda.length ? d.agenda.map((t) => {
    const late = Date.parse(t.due_at) < Date.now();
    return `<div class="mini-row" data-task="${t.id}" data-lead="${t.lead_id || ''}"><input type="checkbox" data-done="${t.id}" aria-label="Mark ${esc(t.title)} done" title="Mark done"><div class="grow"><div class="nm">${esc(t.title)}</div><div class="sub">${esc(t.lead_name || 'No lead')}${admin && t.assignee ? ' · ' + esc(t.assignee) : ''}</div></div><span class="small ${late ? 'bad' : 'dim'}" style="white-space:nowrap">${late ? ico('alert', 'sm') : ''} ${late && Date.parse(t.due_at) < Date.now() - 864e5 ? fmtDate(t.due_at) : fmtTime(t.due_at)}</span>${t.lead_id ? quickActions(t.lead_id, t.lead_name, t.lead_phone) : ''}</div>`;
  }).join('') : empty('Nothing due today', 'Your follow-ups for today are done. Nice work.', '', 'checkCircle');
  const newLeads = d.new_leads.length ? d.new_leads.map((l) => leadRow(l, `${l.source || 'Lead'}${l.project_name ? ' · ' + l.project_name : ''} · ${rel(l.created_at)}${admin && l.rep_name ? ' · ' + l.rep_name : ''}`)).join('') : empty('Every new lead has been contacted', '', '', 'checkCircle');
  const cooling = d.cooling_leads.length ? d.cooling_leads.map((l) => leadRow(l, `${l.stage} · last activity ${l.last_activity_at ? rel(l.last_activity_at) : 'never'}${admin && l.rep_name ? ' · ' + l.rep_name : ''}`)).join('') : empty('No hot leads are going cold', '', '', 'flame');
  const funnel = hbars(d.funnel.map((x) => ({ label: x.stage, value: x.count, cls: x.stage === 'Lost' ? 'red' : '' })));
  const activity = d.activity.length ? d.activity.slice(0, 8).map((a) => `<div class="mini-row" data-lead="${a.lead_id}"><span class="avatar soft" style="width:28px;height:28px">${ico(a.type === 'call' ? 'phone' : a.type === 'whatsapp' ? 'message' : a.type === 'note' ? 'edit' : a.type === 'visit' ? 'truck' : a.type === 'stage' ? 'refresh' : a.type === 'booking' ? 'file' : 'info', 'sm')}</span><div class="grow"><div class="nm">${esc(a.lead_name)}</div><div class="sub">${esc((a.content || a.type).slice(0, 80))}</div></div><span class="small dim" style="white-space:nowrap">${rel(a.created_at)}</span></div>`).join('') : empty('No activity yet', 'Calls, notes and stage changes will show up here.', '', 'list');
  const visits = d.visits.length ? d.visits.map((v) => `<div class="mini-row" data-lead="${v.lead_id}"><span class="fi violet" style="width:30px;height:30px;border-radius:8px;display:flex;align-items:center;justify-content:center">${ico('truck', 'sm')}</span><div class="grow"><div class="nm">${esc(v.lead_name)}</div><div class="sub">${esc(v.project_name)}${v.plot_no ? ' · Plot ' + esc(v.plot_no) : ''}${admin && v.rep_name ? ' · ' + esc(v.rep_name) : ''}</div></div><span class="small right" style="white-space:nowrap">${friendlyDT(v.scheduled_at)}</span></div>`).join('') : empty('No upcoming visits', '', '', 'truck');
  const hot = d.hot_prospects.length ? d.hot_prospects.map((l) => `<div class="mini-row" data-lead="${l.id}"><div class="grow"><div class="nm">${esc(l.name)}</div><div class="sub">${esc(l.stage)}${l.budget_max ? ' · ' + inrShort(l.budget_max) : ''}${admin && l.rep_name ? ' · ' + esc(l.rep_name) : ''}</div></div><b>${l.score}</b>${quickActions(l.id, l.name, l.phone_norm)}</div>`).join('') : empty('No hot prospects yet', 'Hot leads appear as reps engage with them.', '', 'flame');
  const health = d.health.length ? d.health.map((h) => `<div class="mini-row" ${admin ? `data-href="#/team?rep=${h.id}"` : ''}><div class="grow"><div class="nm">${esc(h.name)}</div><div class="sub">${h.open_leads} open · ${h.untouched} untouched 48h+ · last active ${h.last_activity ? rel(h.last_activity) : 'never'}</div></div>${statusChip('health', h.status)}</div>`).join('') : empty('No active reps yet', 'Invite your team from Team & targets.', '', 'users');
  const board = d.leaderboard.length ? d.leaderboard.map((l) => `<div class="mini-row"><b style="width:22px;color:var(--text-3)">${l.rank}</b><div class="grow"><div class="nm">${esc(l.name)} ${l.me ? badge('you', 'b-brand') : ''}</div><div class="sub">${l.bookings} bookings · ${l.conversion}% conversion${l.sales_value !== undefined ? ' · ' + inrShort(l.sales_value) : ''}</div></div>${l.target_achievement !== undefined ? `<div style="width:90px"><div class="bar"><i style="width:${Math.min(100, l.target_achievement)}%"></i></div><div class="small dim right">${l.target_achievement}%</div></div>` : ''}</div>`).join('') : empty('No reps yet', '', '', 'users');
  const inv = d.inventory.total ? `<div class="stack-bar" style="margin-bottom:10px">${[['available', 'var(--green)'], ['hold', 'var(--amber)'], ['booked', 'var(--blue)'], ['sold', 'var(--slate)']].map(([s, c]) => `<i style="width:${(d.inventory[s] / d.inventory.total) * 100}%;background:${c}"></i>`).join('')}</div>
    <div class="legend">${[['available', 'green'], ['hold', 'amber'], ['booked', 'blue'], ['sold', 'slate']].map(([s, c]) => `<span><i style="background:var(--${c}-bg);border-color:var(--${c})"></i>${s[0].toUpperCase() + s.slice(1)} ${d.inventory[s]}</span>`).join('')}</div>` : empty('No plots yet', admin ? 'Add a project and its plots under Projects & plots.' : '', admin ? '<a class="btn primary sm" href="#/inventory">Add a project</a>' : '', 'map');

  root.innerHTML = `
  <div class="ph1"><div><h1>${hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening'}, ${esc(first)}</h1><p>${dateStr} · ${admin ? 'whole organization' : 'your leads and follow-ups'}</p></div>
    <div class="row"><div class="seg" id="rg" role="group" aria-label="Date range">${RANGES.map(([v, l]) => `<button data-r="${v}" class="${v === range ? 'on' : ''}" aria-pressed="${v === range}">${l}</button>`).join('')}</div>
      <button class="btn primary" id="addlead">${ico('plus', 'sm')}Add lead</button></div></div>

  <div class="focus" style="--cols:${tiles.length > 5 ? 4 : tiles.length}" aria-label="Needs your attention">${tiles.map(tile).join('')}</div>

  ${w('kpis') ? `<div class="kstrip">
    <div class="pcard" data-href="#/leads"><div class="l">${admin ? 'Leads' : 'My leads'} · ${label}</div><div class="v">${k.total_leads}</div></div>
    <div class="pcard" data-href="#/leads"><div class="l">Hot leads</div><div class="v">${k.hot_leads}</div></div>
    <div><div class="l">Conversion</div><div class="v">${k.conversion_rate}%</div><div class="s">leads → booked</div></div>
    <div><div class="l">Pipeline value</div><div class="v">${inrShort(k.pipeline_value)}</div><div class="s">visit → negotiation</div></div>
    <div class="pcard" data-href="#/bookings"><div class="l">Bookings</div><div class="v">${k.bookings}</div></div>
    <div class="pcard" data-href="#/bookings"><div class="l">Sales value</div><div class="v">${inrShort(k.sales_value)}</div></div>
    ${admin ? `<div class="pcard" data-href="#/collections"><div class="l">Collected</div><div class="v">${inrShort(k.collected)}</div></div><div class="pcard" data-href="#/collections"><div class="l">Overdue</div><div class="v ${d.collections.overdue ? 'bad' : ''}">${inrShort(d.collections.overdue)}</div><div class="s">${inrShort(d.collections.outstanding)} outstanding</div></div>`
      : (d.my_target && (d.my_target.monthly_target || d.my_target.target_bookings) ? `<div><div class="l">Monthly target</div><div class="v">${d.my_target.progress}%</div><div class="bar ${d.my_target.progress >= 100 ? '' : d.my_target.progress < 40 ? 'red' : 'amber'}" style="margin-top:4px"><i style="width:${Math.min(100, d.my_target.progress)}%"></i></div><div class="s">${inrShort(d.my_target.month_value)}${d.my_target.monthly_target ? ' of ' + inrShort(d.my_target.monthly_target) : ''}</div></div>` : '')}
  </div>` : ''}

  <div class="grid g2 stack" style="grid-template-columns:minmax(0,3fr) minmax(0,2fr);align-items:start">
    <div class="grid">
      ${w('agenda') ? panel('checkCircle', "Today's follow-ups", agenda, ['All follow-ups', '#/tasks']) : ''}
      ${panel('inbox', 'New leads to contact', newLeads, ['All new leads', '#/leads?uncontacted=1'])}
      ${panel('flame', 'Hot leads going cold', cooling, ['View all', '#/leads?cooling=1'])}
      ${w('hot') ? panel('target', 'Top hot prospects', hot) : ''}
    </div>
    <div class="grid">
      ${w('visits') ? panel('truck', 'Site visits', visits, ['All visits', '#/visits']) : ''}
      ${w('funnel') ? panel('chart', 'Pipeline', funnel) : ''}
      ${w('activity') ? panel('list', 'Recent activity', activity) : ''}
      ${w('health') ? panel('userCheck', admin ? 'Team activity' : 'My activity', health, admin ? ['Team', '#/team'] : null) : ''}
      ${w('leaderboard') ? panel('users', 'Leaderboard', board) : ''}
      ${w('inventory') ? panel('map', 'Plot inventory', inv, ['Open', '#/inventory']) : ''}
    </div>
  </div>`;

  on(root, 'click', '[data-r]', (el) => { range = el.dataset.r; reload(); });
  on(root, 'click', '[data-href]', (el) => nav(el.dataset.href));
  on(root, 'click', '[data-lead]', (el, e) => { if (e.target.closest('.qa, input, a')) return; if (el.dataset.lead) openLeadDrawer(Number(el.dataset.lead), () => reload()); });
  on(root, 'keydown', '[data-lead]', (el, e) => { if (e.key === 'Enter' && el.dataset.lead) openLeadDrawer(Number(el.dataset.lead), () => reload()); });
  on(root, 'change', '[data-done]', async (el) => { // optimistic: the row leaves immediately, restored if the server says no
    const row = el.closest('.mini-row'); row.style.opacity = '.4';
    try { await post(`/tasks/${el.dataset.done}/complete`); row.style.transition = 'all .25s'; row.style.maxHeight = row.offsetHeight + 'px'; requestAnimationFrame(() => { row.style.maxHeight = '0'; row.style.padding = '0'; row.style.opacity = '0'; }); setTimeout(() => row.remove(), 260); toast('Follow-up marked done', 'ok'); }
    catch (e) { row.style.opacity = ''; el.checked = false; toast(e.message, 'err'); }
  });
  $('#addlead').onclick = () => leadForm(null, () => reload());
}
