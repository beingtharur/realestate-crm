// Leads: list (list / cards / board), filters, bulk actions, lead drawer, lead page, add/edit form, import.
import { repLoads, loadOptions, S, $, $$, esc, get, post, patch, del, api, on, modal, modalForm, confirmDialog, askText, toast, fld, inp, sel, repOptions, projectOptions, getForm, inr, inrShort, rel, fmtDT, fmtDate, fmtTime, friendlyDT, dayLabel, dayHeading, istDay,
  isAdmin, empty, errorState, badge, stageBadge, ratingBadge, statusChip, phoneFmt, waLink, nav, reload, userName, dtLocal, fromDT, copy, fullLink, authUrl, saveTextFile, debounce, skeleton, STAGE_CLS, callLabel, callCls, mmss,
  quickActions, ico, avatar, drawer, openMenu, store, rememberLead, today, enhanceSelects } from './core.js';
import { bookingWizard } from './v_bookings.js';

const STAGES = () => S.meta.stages;
const pref = { get: (k, d) => { try { const v = store.get(k); return v === null ? d : JSON.parse(v); } catch { return d; } }, set: (k, v) => store.set(k, JSON.stringify(v)) };

// ================= add / edit =================
export function leadForm(lead, onDone, preset = {}) {
  const edit = !!lead, l = lead || preset, cf = S.meta.custom_fields, cv = l.custom || {};
  const lastProject = pref.get('rp_last_project', '');
  const sec = (n, t, hint = '') => `<div class="fsec ${n === 1 ? 'first' : ''}"><span class="n">${n}</span>${t}${hint ? `<small>${hint}</small>` : ''}</div>`;
  const body = `<div id="dupwarn"></div>
    ${sec(1, 'Contact')}<div class="frm-g">
    ${fld('Name <span class="req">*</span>', inp('name', l.name || '', 'required placeholder="Full name" autocomplete="off"'))}${fld('Mobile <span class="req">*</span>', inp('phone', l.phone_norm || l.phone || '', 'required data-v="phone" inputmode="tel" placeholder="98765 43210" autocomplete="off"'), '10-digit Indian mobile; +91 is optional')}
    ${fld('Second mobile', inp('alt_phone', l.alt_phone_norm || l.alt_phone || '', 'data-v="phone" inputmode="tel" placeholder="Optional"'), 'Calls from this number are matched to the lead too')}
    ${fld('Email', inp('email', l.email || '', 'type="email" data-v="email" placeholder="name@example.com"'))}${fld('Buying purpose', sel('purpose', [['', 'Not sure'], 'Investment', 'Self-use / build home', 'Both'], l.purpose || ''))}</div>
    ${sec(2, 'What they are looking for', 'optional')}<div class="frm-g">
    ${fld('Budget from (₹)', inp('budget_min', l.budget_min ?? '', 'type="number" min="0" placeholder="e.g. 2500000"'))}${fld('Budget up to (₹)', inp('budget_max', l.budget_max ?? '', 'type="number" min="0" placeholder="e.g. 4000000"'))}
    ${fld('Plot size from (sq.yd)', inp('pref_size_min', l.pref_size_min ?? '', 'type="number" min="0" placeholder="150"'))}${fld('Plot size up to (sq.yd)', inp('pref_size_max', l.pref_size_max ?? '', 'type="number" min="0" placeholder="300"'))}
    ${fld('Preferred project', sel('pref_project_id', projectOptions('No preference'), l.pref_project_id || (edit ? '' : lastProject)))}${fld('Preferred facing', sel('pref_facing', [['', 'Any facing'], 'East', 'West', 'North', 'South', 'North-East', 'North-West', 'South-East', 'South-West'], l.pref_facing || ''))}
    ${fld('Preferred location / area', inp('pref_location', l.pref_location || '', 'placeholder="e.g. Shadnagar"'), '', 'full')}</div>
    ${sec(3, 'Source & ownership')}<div class="frm-g">
    ${fld('Lead source', sel('source', S.meta.sources, l.source || 'Walk-in'))}${fld('Channel partner / broker', sel('partner_id', [['', 'Direct (no partner)'], ...S.meta.partners.filter((p) => p.active).map((p) => [p.id, p.name])], l.partner_id || ''))}
    ${!edit && isAdmin() ? fld('Assign to', sel('assigned_to', repOptions('Auto-assign by rules'), ''), 'Leave on auto to follow your assignment rules', 'full') : ''}</div>
    ${cf.length || true ? sec(4, 'More details', 'optional') : ''}<div class="frm-g">
    ${cf.map((f) => fld(esc(f.label) + (f.required ? ' <span class="req">*</span>' : ''),
      f.type === 'dropdown' ? sel('cf_' + f.id, [['', 'Select…'], ...f.options], cv[f.id] ?? '', f.required ? 'required' : '') : f.type === 'checkbox' ? `<label class="row gap-s" style="min-height:36px"><input type="checkbox" name="cf_${f.id}" ${cv[f.id] ? 'checked' : ''}> Yes</label>` : inp('cf_' + f.id, cv[f.id] ?? '', `type="${f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}" ${f.required ? 'required' : ''}`))).join('')}
    ${fld('Notes', `<textarea name="notes" placeholder="Anything worth remembering about this customer…">${esc(l.notes || '')}</textarea>`, '', 'full')}</div>`;
  const submit = async (d, m, force = false) => {
    const custom = {};
    cf.forEach((f) => { custom[f.id] = d['cf_' + f.id]; });
    const payload = { ...d, custom, force };
    Object.keys(payload).filter((k) => k.startsWith('cf_')).forEach((k) => delete payload[k]);
    try {
      let created;
      if (edit) await patch('/leads/' + lead.id, payload); else created = await post('/leads', payload);
      if (payload.pref_project_id) pref.set('rp_last_project', payload.pref_project_id);
      toast(edit ? 'Changes saved' : `${d.name.split(' ')[0]} was added to your leads`, 'ok'); onDone && onDone(created);
    } catch (e) {
      if (e.status === 409 && e.data.duplicates) {
        const dups = e.data.duplicates;
        const go = await new Promise((res) => {
          const dm = modal({ title: 'This lead may already exist', body: `<div class="warn-box">${ico('alert', 'sm')}<span>A lead with the same phone number or email is already in your organization.</span></div>
            ${dups.map((x) => `<div class="list-row"><div><b>${esc(x.name)}</b> <span class="muted small">${phoneFmt(x.phone)}</span><div class="small" style="margin-top:3px">${stageBadge(x.stage)} <span class="muted">· ${esc(x.rep_name || 'Unassigned')}</span></div></div>${x.mine !== false && (isAdmin() || x.assigned_to === S.user.id) ? `<a class="btn sm" href="#/leads/${x.id}" data-close>Open</a>` : ''}</div>`).join('')}`,
            footer: `<button class="btn" id="dc">Go back</button><button class="btn primary" id="da">Create anyway</button>` });
          $('#dc', dm.el).onclick = () => { dm.close(); res(false); }; $('#da', dm.el).onclick = () => { dm.close(); res(true); };
          dm.el.addEventListener('click', (ev) => { if (ev.target.closest('[data-close]') && !ev.target.closest('#dc,#da')) res(false); });
        });
        if (go) return submit(d, m, true);
        return false;
      }
      throw e;
    }
  };
  modalForm({ title: edit ? 'Edit lead' : 'Add lead', wide: true, submit: edit ? 'Save changes' : 'Add lead', body, onSubmit: (d, m) => submit(d, m),
    onOpen: (el) => { // warn about a duplicate as soon as the number is typed, not after the whole form is filled
      if (edit) return;
      const ph = $('[name=phone]', el), warn = $('#dupwarn', el);
      ph.addEventListener('blur', async () => {
        if (ph.value.replace(/\D/g, '').length < 10) { warn.innerHTML = ''; return; }
        try { const r = await post('/leads/check-duplicate', { phone: ph.value }); warn.innerHTML = r.duplicates.length ? `<div class="warn-box">${ico('alert', 'sm')}<span><b>${esc(r.duplicates[0].name)}</b> already has this number (${esc(r.duplicates[0].stage)}${r.duplicates[0].rep_name ? ', ' + esc(r.duplicates[0].rep_name) : ''}). You can still continue.</span></div>` : ''; } catch { /* ignore */ }
      });
    } });
}

// ================= list =================
const SORTS = {
  updated: ['Recently updated', (l) => -Date.parse(l.updated_at)], newest: ['Newest first', (l) => -Date.parse(l.created_at)], oldest: ['Oldest first', (l) => Date.parse(l.created_at)],
  name: ['Name A–Z', (l) => l.name.toLowerCase()], score: ['Highest priority score', (l) => -l.score], followup: ['Next follow-up (soonest)', (l) => (l.next_due ? Date.parse(l.next_due) : Infinity)],
  contacted: ['Least recently contacted', (l) => (l.last_contacted ? Date.parse(l.last_contacted) : -Infinity)], budget: ['Budget (high to low)', (l) => -(l.budget_max || 0)],
};
const COLS = [
  { k: 'lead', label: 'Lead', sort: 'name', always: true },
  { k: 'stage', label: 'Status' }, { k: 'rating', label: 'Priority', sort: 'score' }, { k: 'next', label: 'Next follow-up', sort: 'followup' }, { k: 'last', label: 'Last contacted', sort: 'contacted' },
  { k: 'rep', label: 'Assigned to', admin: true }, { k: 'actions', label: 'Contact', always: true }, { k: 'budget', label: 'Budget', sort: 'budget', cls: 'r' }, { k: 'source', label: 'Source' }, { k: 'project', label: 'Project' }, { k: 'score', label: 'Score', cls: 'r' }, { k: 'created', label: 'Added', sort: 'newest' },
];
const DEFAULT_COLS = ['lead', 'stage', 'rating', 'next', 'last', 'created', 'rep', 'actions', 'budget', 'source'];
const FILTER_LABELS = { stage: 'Status', rating: 'Priority', source: 'Source', project_id: 'Project', assigned: 'Assigned to', followup: 'Follow-up', from: 'Created from', to: 'Created to', uncontacted: 'Not contacted', cooling: 'Going cold' };
const EMPTY_F = { q: '', assigned: '', rating: '', source: '', stage: '', project_id: '', followup: '', from: '', to: '', uncontacted: '', cooling: '' };
let F = { ...EMPTY_F };
const nextCell = (l) => {
  if (!l.next_due) return '<span class="dim">None</span>';
  const late = Date.parse(l.next_due) < Date.now();
  return `<span class="${late ? 'bad' : ''}" style="white-space:nowrap">${late ? ico('alert', 'sm') + ' ' : ''}${friendlyDT(l.next_due)}</span>`;
};
/** "10:42 AM · by Ravi" — who added the lead and when (day shown separately as a heading in date-sorted views) */
const addedBy = (l) => (l.added_by_name ? esc(l.added_by_name) : l.added_via === 'intake' ? 'Website / webhook' : 'System');
const addedCell = (l) => `<div style="white-space:nowrap"><b style="font-weight:600">${fmtTime(l.created_at)}</b> <span class="small dim">${esc(dayHeading(l.created_at))}</span></div><div class="small dim">${l.added_via === 'import' ? 'Imported' : 'Added'} by ${addedBy(l)}</div>`;
const leadMeta = (l) => `${stageBadge(l.stage)}${ratingBadge(l.rating)}`;

export async function list(root, _p, q) {
  const admin = isAdmin();
  const isNarrow = innerWidth < 760;
  let view = pref.get('rp_leadview2', isNarrow ? 'cards' : 'list'); if (isNarrow && view === 'list') view = 'cards';
  let sort = pref.get('rp_leadsort2', 'newest');
  let cols = pref.get('rp_leadcols3', DEFAULT_COLS).filter((k) => COLS.find((c) => c.k === k && (!c.admin || admin)));
  if (!admin) cols = cols.filter((k) => k !== 'rep');
  let tab = q.tab || 'all', saved = [], rows = [], shown = 50, selected = new Set(), expanded = new Set(), loading = false, failed = false;
  // arriving from the dashboard / sidebar: apply exactly the requested filter
  if (['stage', 'uncontacted', 'cooling', 'followup', 'rating', 'source', 'assigned', 'project_id'].some((k) => q[k])) { F = { ...EMPTY_F }; ['stage', 'uncontacted', 'cooling', 'followup', 'rating', 'source', 'assigned', 'project_id'].forEach((k) => { if (q[k]) F[k] = q[k]; }); }
  else if (!q.keep && !Object.values(F).some(Boolean)) F = { ...EMPTY_F };
  try { saved = await get('/filters'); } catch { /* optional */ }

  const params = () => { const p = new URLSearchParams(); Object.entries(F).forEach(([k, v]) => v && p.set(k, v)); if (tab === 'unassigned') p.set('assigned', 'unassigned'); if (tab === 'flagged') p.set('flag', 'pending'); if (tab === 'duplicates') p.set('dup', 'reported'); return p; };
  const sorted = () => { const [, fn] = SORTS[sort] || SORTS.updated; return [...rows].sort((a, b) => { const x = fn(a), y = fn(b); return x < y ? -1 : x > y ? 1 : 0; }); };
  const activeChips = () => {
    const chips = []; const val = (k, v) => (k === 'assigned' ? (v === 'unassigned' ? 'Unassigned' : userName(Number(v))) : k === 'project_id' ? (S.meta.projects.find((p) => p.id == v)?.name || v) : k === 'followup' ? ({ overdue: 'Overdue', today: 'Due today', upcoming: 'Upcoming', none: 'None set' }[v] || v) : k === 'uncontacted' || k === 'cooling' ? 'Yes' : v);
    Object.entries(F).forEach(([k, v]) => { if (v && k !== 'q') chips.push(`<span class="chip fc"><span>${FILTER_LABELS[k] || k}:</span> <b>${esc(val(k, v))}</b><button class="x" data-rmf="${k}" aria-label="Remove ${FILTER_LABELS[k] || k} filter">${ico('x', 'sm')}</button></span>`); });
    if (tab !== 'all') chips.push(`<span class="chip fc"><span>View:</span> <b>${{ unassigned: 'Unassigned', flagged: 'Suspicious', duplicates: 'Duplicate reports' }[tab]}</b><button class="x" data-rmtab aria-label="Remove view filter">${ico('x', 'sm')}</button></span>`);
    return chips.length ? chips.join('') + `<button class="btn ghost sm" data-clearf>Clear all</button>` : '';
  };
  const nFilters = () => Object.entries(F).filter(([k, v]) => v && k !== 'q').length + (tab !== 'all' ? 1 : 0);

  // ---- row renderers ----
  const cell = {
    lead: (l) => `<div class="namecell"><div style="min-width:0"><a href="#/leads/${l.id}" class="lname" data-open="${l.id}" style="color:var(--text);font-weight:600">${esc(l.name)}</a>${l.flag_status === 'pending' ? ` <span class="badge b-red" title="Suspicious lead">${ico('alert')}Review</span>` : ''}<div class="muted small">${phoneFmt(l.phone_norm)}${l.alt_phone_norm ? ` · ${phoneFmt(l.alt_phone_norm)}` : ''}</div></div></div>`,
    stage: (l) => stageBadge(l.stage), rating: (l) => ratingBadge(l.rating), next: nextCell,
    last: (l) => (l.last_contacted ? `<span title="${esc(fmtDT(l.last_contacted))}">${rel(l.last_contacted)}</span>` : '<span class="dim">Never</span>'),
    rep: (l) => esc(l.rep_name || 'Unassigned'), source: (l) => esc(l.source || '—'), project: (l) => esc(l.project_name || '—'), budget: (l) => (l.budget_max ? inrShort(l.budget_max) : '—'), score: (l) => l.score,
    created: addedCell, actions: (l) => quickActions(l.id, l.name, l.phone_norm),
  };
  const byDate = () => sort === 'newest' || sort === 'oldest';
  const dayCounts = (data) => { const m = new Map(); data.forEach((l) => { const k = istDay(l.created_at); m.set(k, (m.get(k) || 0) + 1); }); return m; };
  /** Inserts a "Thursday · 12 leads" divider whenever the day changes, like WhatsApp. Only in the date-sorted views. */
  const withDays = (page, all_, row, wrap) => {
    if (!byDate()) return page.map(row).join('');
    const counts = dayCounts(all_); let last = '';
    return page.map((l) => { const k = istDay(l.created_at); const head = k === last ? '' : wrap(dayHeading(l.created_at), counts.get(k)); last = k; return head + row(l); }).join('');
  };
  const tableHtml = (data, all_ = data) => `<div class="tbl-wrap"><table class="tbl fit"><thead><tr><th style="width:36px"><input type="checkbox" id="selall" aria-label="Select all shown leads" ${data.length && data.every((l) => selected.has(l.id)) ? 'checked' : ''}></th>${cols.map((k) => { const c = COLS.find((x) => x.k === k); const sorted_ = c.sort && c.sort === sort; return `<th class="${c.cls || ''} ${c.sort ? 'sortable' : ''} ${sorted_ ? 'sorted' : ''}" ${c.sort ? `data-sort="${c.sort}"` : ''} scope="col">${c.label}${c.sort ? `<span class="sort">${ico(sorted_ ? 'arrowDown' : 'chevDown', 'sm')}</span>` : ''}</th>`; }).join('')}</tr></thead>
    <tbody>${withDays(data, all_, (l) => `<tr class="click ${selected.has(l.id) ? 'sel' : ''}" data-id="${l.id}"><td><input type="checkbox" data-sel="${l.id}" ${selected.has(l.id) ? 'checked' : ''} aria-label="Select ${esc(l.name)}"></td>${cols.map((k) => `<td class="${COLS.find((c) => c.k === k).cls || ''}">${cell[k](l)}</td>`).join('')}</tr>`,
      (h, n) => `<tr class="dayrow"><td colspan="${cols.length + 1}"><span class="daychip">${esc(h)}</span><span class="small dim"> ${n} lead${n === 1 ? '' : 's'} added</span></td></tr>`)}</tbody></table></div>`;
  const cardsHtml = (data, all_ = data) => `<div class="lcards">${withDays(data, all_, (l) => `<div class="lcard ${expanded.has(l.id) ? 'open' : ''} ${selected.has(l.id) ? 'sel' : ''}" data-id="${l.id}"><div class="lc-top" data-toggle="${l.id}" role="button" tabindex="0" aria-expanded="${expanded.has(l.id)}">
      <input type="checkbox" data-sel="${l.id}" ${selected.has(l.id) ? 'checked' : ''} aria-label="Select ${esc(l.name)}"><div class="lc-main"><div class="lc-name">${esc(l.name)}${l.flag_status === 'pending' ? ico('alert', 'sm') : ''}</div>
      <div class="lc-meta">${stageBadge(l.stage)}${ratingBadge(l.rating)}<span class="${l.next_due && Date.parse(l.next_due) < Date.now() ? 'bad' : ''}">${ico('clock', 'sm')} ${l.next_due ? friendlyDT(l.next_due) : 'No follow-up'}</span></div></div>
      ${quickActions(l.id, l.name, l.phone_norm)}<span class="lc-chev">${ico('chevDown')}</span></div>
      <div class="lc-more"><dl class="kv"><dt>Phone</dt><dd>${phoneFmt(l.phone_norm)}${l.alt_phone_norm ? '<br>' + phoneFmt(l.alt_phone_norm) : ''}</dd><dt>Added</dt><dd>${esc(dayHeading(l.created_at))}, ${fmtTime(l.created_at)} · ${addedBy(l)}</dd><dt>Last contacted</dt><dd>${l.last_contacted ? rel(l.last_contacted) : 'Never'}</dd>${admin ? `<dt>Assigned to</dt><dd>${esc(l.rep_name || 'Unassigned')}</dd>` : ''}<dt>Source</dt><dd>${esc(l.source || '—')}</dd><dt>Budget</dt><dd>${l.budget_max ? inrShort(l.budget_max) : '—'}</dd><dt>Project</dt><dd>${esc(l.project_name || '—')}</dd></dl>
      <div class="row"><button class="btn primary sm" data-open="${l.id}">${ico('eye', 'sm')}View details</button><a class="btn sm" href="#/leads/${l.id}">${ico('external', 'sm')}Full page</a></div></div></div>`, (h, n) => `<div class="dayhead"><span class="daychip">${esc(h)}</span><span class="small dim"> ${n} added</span></div>`)}</div>`;
  const boardHtml = (data) => `<div class="kanban">${STAGES().map((s) => { const c = data.filter((l) => l.stage === s); return `<div class="kcol" data-stage="${s}"><h4><span>${stageBadge(s)}</span><span class="muted small">${c.length}</span></h4><div class="cards">${c.slice(0, 40).map((l) => `<div class="kcard" draggable="true" data-id="${l.id}"><div class="n">${esc(l.name)}</div><div class="m">${phoneFmt(l.phone_norm)}</div><div class="m">${ratingBadge(l.rating)}${l.budget_max ? `<span>${inrShort(l.budget_max)}</span>` : ''}${l.project_name ? `<span>${esc(l.project_name)}</span>` : ''}</div>
      <div class="m ${l.next_due && Date.parse(l.next_due) < Date.now() ? 'bad' : ''}">${ico('clock', 'sm')} ${l.next_due ? friendlyDT(l.next_due) : 'No follow-up'}${admin && l.rep_name ? ' · ' + esc(l.rep_name) : ''}</div><div style="margin-top:8px">${quickActions(l.id, l.name, l.phone_norm)}</div></div>`).join('')}${c.length > 40 ? `<div class="muted small center">+${c.length - 40} more — use filters or list view</div>` : ''}</div></div>`; }).join('')}</div>`;

  const flaggedHtml = (data) => data.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Lead</th><th>Why it was flagged</th><th>Status</th><th>Created</th><th></th></tr></thead><tbody>${data.map((l) => `<tr><td><a href="#/leads/${l.id}"><b>${esc(l.name)}</b></a><div class="muted small">${phoneFmt(l.phone_norm)} · ${esc(l.source || '')}</div></td><td>${esc(l.flag_reason)}</td><td>${statusChip('commission', l.flag_status === 'spam' ? 'cancelled' : 'pending', l.flag_status === 'spam' ? 'Spam (blocked)' : 'Needs review')}</td><td class="small">${rel(l.created_at)}</td>
      <td class="right nowrap">${l.flag_status === 'pending' ? `<button class="btn sm" data-flag="genuine" data-id="${l.id}">${ico('check', 'sm')}Genuine</button> <button class="btn sm danger" data-flag="spam" data-id="${l.id}">Mark spam</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : empty('Nothing suspicious', 'Leads submitted repeatedly with the same number are flagged here for review.', '', 'checkCircle');
  const dupHtml = (data) => data.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Lead</th><th>Reported by</th><th>Note</th><th></th></tr></thead><tbody>${data.map((l) => `<tr><td><a href="#/leads/${l.id}"><b>${esc(l.name)}</b></a><div class="muted small">${phoneFmt(l.phone_norm)} · ${esc(l.rep_name || '')}</div></td><td>${esc(userName(l.dup_reported_by))}</td><td>${esc(l.dup_note || '—')}</td>
      <td class="right nowrap"><button class="btn sm" data-dupok="${l.id}">Not a duplicate</button> <button class="btn sm danger" data-del="${l.id}">Delete lead</button></td></tr>`).join('')}</tbody></table></div>` : empty('No duplicate reports', 'When a rep reports a duplicate it shows up here for review.', '', 'copy');

  // ---- page frame (drawn once) ----
  root.innerHTML = `<div class="ph1"><div><h1>Leads</h1><p id="lcount">&nbsp;</p></div><div class="row">
      ${admin ? `<button class="btn ghost icon" id="exp" aria-label="Export all leads" data-tip="Export all (CSV)">${ico('download')}</button>` : ''}${admin || S.settings?.reps_can_create_leads ? `<button class="btn" id="imp">${ico('upload', 'sm')}Import</button>` : ''}<button class="btn primary" id="add">${ico('plus', 'sm')}Add lead</button></div></div>
    ${admin ? `<div class="tabs" id="tabs">${[['all', 'All leads'], ['unassigned', 'Unassigned'], ['flagged', 'Suspicious'], ['duplicates', 'Duplicate reports']].map(([k, l]) => `<button data-tab="${k}" class="${k === tab ? 'on' : ''}">${l}</button>`).join('')}</div>` : ''}
    <div class="toolbar"><div class="tsearch">${ico('search')}<input type="search" id="fq" placeholder="Search name, phone, email or notes" value="${esc(F.q)}" aria-label="Search leads" data-native></div>
      <div style="position:relative"><button class="btn" id="fbtn" aria-haspopup="dialog">${ico('filter', 'sm')}Filters<span class="badge b-brand hidden" id="fcount" style="margin-left:2px"></span></button><div class="fpanel hidden" id="fpanel" role="dialog" aria-label="Filters"></div></div>
      <button class="btn" id="sbtn" aria-haspopup="menu">${ico('arrowDown', 'sm')}<span id="slabel"></span></button>
      <div class="grow"></div>
      <button class="btn icon hidden" id="cbtn" aria-label="Choose columns" data-tip="Columns">${ico('columns')}</button>
      <button class="btn icon m-only" id="selmode" aria-label="Select several leads" aria-pressed="false">${ico('checkCircle')}</button>
      <div class="seg" id="vw" role="group" aria-label="Layout">${[['list', 'list', 'List'], ['cards', 'cards', 'Cards'], ['board', 'grid', 'Board']].map(([v, ic, l]) => `<button data-v="${v}" class="${v === view ? 'on' : ''}" aria-pressed="${v === view}" aria-label="${l} layout" data-tip="${l}">${ico(ic, 'sm')}<span class="d-only">${l}</span></button>`).join('')}</div></div>
    <div class="fchips" id="chips" aria-label="Active filters"></div><div id="bulk"></div><div id="lbody"></div>`;
  const body = $('#lbody', root);

  const paint = () => {
    const data = sorted(), total = data.length;
    $('#lcount', root).textContent = loading ? 'Loading…' : `${total} lead${total === 1 ? '' : 's'}${nFilters() || F.q ? ' match your filters' : ''}`;
    $('#slabel', root).textContent = SORTS[sort][0]; $('#chips', root).innerHTML = activeChips();
    const fc = $('#fcount', root), n = nFilters(); fc.textContent = n; fc.classList.toggle('hidden', !n);
    $('#cbtn', root).classList.toggle('hidden', view !== 'list' || tab !== 'all' || innerWidth < 760);
    $$('#vw button', root).forEach((b) => { b.classList.toggle('on', b.dataset.v === view); b.setAttribute('aria-pressed', b.dataset.v === view); });
    $$('#tabs button', root).forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    if (failed) { body.innerHTML = errorState('Something went wrong while loading leads.'); $('#bulk', root).innerHTML = ''; return; }
    if (loading && !rows.length) { body.innerHTML = skeleton('list').replace(/<div class="skel skel-title"><\/div>/, ''); return; }
    if (tab === 'flagged') { body.innerHTML = flaggedHtml(data); return; }
    if (tab === 'duplicates') { body.innerHTML = dupHtml(data); return; }
    if (!total) {
      const filtered = nFilters() || F.q;
      body.innerHTML = filtered ? empty('No leads match these filters', 'Try removing a filter or searching for something else.', '<button class="btn" data-clearf>Clear all filters</button>', 'search')
        : empty('No leads yet', 'Once you add your first lead, it will appear here.', `<div class="row" style="justify-content:center"><button class="btn primary" data-addlead>${ico('plus', 'sm')}Add lead</button>${admin || S.settings?.reps_can_create_leads ? `<button class="btn" data-importleads>${ico('upload', 'sm')}Import from Excel or CSV</button>` : ''}</div>`, 'users');
      $('#bulk', root).innerHTML = ''; return;
    }
    const page = view === 'board' ? data : data.slice(0, shown);
    body.innerHTML = (view === 'board' ? boardHtml(page) : view === 'cards' ? cardsHtml(page, data) : tableHtml(page, data))
      + (view !== 'board' && total > shown ? `<div class="pager"><span>Showing ${shown} of ${total}</span><button class="btn" data-more>Show ${Math.min(50, total - shown)} more</button></div>` : view !== 'board' && total > 50 ? `<div class="pager">All ${total} leads shown</div>` : '');
    paintBulk();
    if (view === 'board') wireBoard(page);
  };
  const paintBulk = () => {
    const n = selected.size, el = $('#bulk', root);
    if (!n) { el.innerHTML = ''; return; }
    const total = rows.length;
    el.innerHTML = `<div class="bulkbar" role="toolbar" aria-label="Bulk actions"><b>${n} selected</b>${n < total ? `<button class="btn sm" data-selall-matching>Select all ${total}</button>` : ''}
      ${admin ? `<button class="btn sm" data-bulk="assign">${ico('userCheck', 'sm')}Assign</button>` : ''}<button class="btn sm" data-bulk="stage">${ico('refresh', 'sm')}Change status</button><button class="btn sm" data-bulk="task">${ico('checkCircle', 'sm')}Follow-up</button>
      <button class="btn sm" data-bulk="export">${ico('download', 'sm')}Export</button>${admin ? `<button class="btn sm danger" data-bulk="delete">${ico('trash', 'sm')}Delete</button>` : ''}<div class="grow"></div><button class="btn sm ghost" data-bulk="clear" style="color:#fff">${ico('x', 'sm')}Clear</button></div>`;
  };
  const load = async () => {
    loading = true; failed = false; paint();
    try { rows = await get('/leads?' + params()); shown = 50; }
    catch (e) { failed = true; rows = []; }
    loading = false; selected = new Set([...selected].filter((id) => rows.some((l) => l.id === id))); paint();
  };

  // ---- interactions (registered once) ----
  const setF = (patch_) => { F = { ...F, ...patch_ }; load(); };
  const openLead = (id) => openLeadDrawer(Number(id), () => load());
  const filterPanel = () => {
    const p = $('#fpanel', root);
    const select = (name, label, opts, val) => fld(label, sel(name, opts, val));
    p.innerHTML = `<div class="row between" style="margin-bottom:var(--s3)"><b>Filters</b><div class="row"><button class="btn ghost sm" data-clearf>Clear all</button><button class="btn sm primary" data-fclose>Done</button></div></div>
      <div class="mh" style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--text-3);margin-bottom:6px">Quick views</div>
      <div class="row gap-s" style="margin-bottom:var(--s4)">${[['New leads', { stage: 'New' }], ['Hot', { rating: 'Hot' }], ['Overdue follow-up', { followup: 'overdue' }], ['Due today', { followup: 'today' }], ['Not contacted', { uncontacted: '1' }], ['Going cold', { cooling: '1' }]].map(([l, f], i) => `<button class="chip" data-qv="${i}">${l}</button>`).join('')}</div>
      <div class="frm-g">${select('stage', 'Status', [['', 'Any status'], ...STAGES()], F.stage)}${select('rating', 'Priority', [['', 'Any priority'], 'Hot', 'Warm', 'Cold'], F.rating)}
      ${select('followup', 'Follow-up', [['', 'Any'], ['overdue', 'Overdue'], ['today', 'Due today'], ['upcoming', 'Upcoming'], ['none', 'None scheduled']], F.followup)}${select('source', 'Source', [['', 'Any source'], ...S.meta.sources], F.source)}
      ${select('project_id', 'Project', projectOptions('Any project'), F.project_id)}${admin ? select('assigned', 'Assigned to', [['', 'Anyone'], ['unassigned', 'Unassigned'], ...repOptions('').slice(1)], F.assigned) : ''}
      ${fld('Created from', inp('from', F.from, 'type="date"'))}${fld('Created to', inp('to', F.to, 'type="date"'))}</div>
      ${saved.length ? `<div class="mh" style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--text-3);margin:4px 0 6px">Saved views</div><div class="row gap-s">${saved.map((s) => `<span class="chip" data-sf="${s.id}">${esc(s.name)}<button class="x" data-sfd="${s.id}" aria-label="Delete saved view ${esc(s.name)}">${ico('x', 'sm')}</button></span>`).join('')}</div>` : ''}
      <div style="margin-top:var(--s4)"><button class="btn sm" data-fsave>${ico('plus', 'sm')}Save current filters as a view</button></div>`;
    enhanceFilterPanel(p);
  };
  const enhanceFilterPanel = (p) => enhanceSelects(p);
  const QV = [{ stage: 'New' }, { rating: 'Hot' }, { followup: 'overdue' }, { followup: 'today' }, { uncontacted: '1' }, { cooling: '1' }];

  $('#fq', root).addEventListener('input', debounce((e) => { F.q = e.target.value.trim(); load(); }, 250));
  $('#fbtn', root).onclick = (e) => { e.stopPropagation(); const p = $('#fpanel', root); if (p.classList.contains('hidden')) { filterPanel(); p.classList.remove('hidden'); } else p.classList.add('hidden'); };
  document.addEventListener('mousedown', function off(e) { if (!root.isConnected) return document.removeEventListener('mousedown', off); const p = $('#fpanel', root); if (p && !p.classList.contains('hidden') && !e.target.closest('#fpanel, #fbtn, .combo-pop, .menu-scrim')) p.classList.add('hidden'); });
  on(root, 'change', '#fpanel select, #fpanel input', (el) => { setF({ [el.name]: el.value }); });
  on(root, 'click', '[data-qv]', (el) => { F = { ...EMPTY_F, q: F.q, ...QV[Number(el.dataset.qv)] }; tab = 'all'; load(); filterPanel(); });
  on(root, 'click', '[data-fclose]', () => $('#fpanel', root).classList.add('hidden'));
  on(root, 'click', '[data-clearf]', () => { F = { ...EMPTY_F }; tab = 'all'; $('#fq', root).value = ''; $('#fpanel', root).classList.add('hidden'); load(); });
  on(root, 'click', '[data-rmf]', (el) => setF({ [el.dataset.rmf]: '' }));
  on(root, 'click', '[data-rmtab]', () => { tab = 'all'; load(); });
  on(root, 'click', '[data-sf]', (el, e) => { if (e.target.closest('[data-sfd]')) return; F = { ...EMPTY_F, ...saved.find((s) => s.id == el.dataset.sf).filters }; $('#fq', root).value = F.q || ''; load(); filterPanel(); });
  on(root, 'click', '[data-sfd]', async (el) => { await del('/filters/' + el.dataset.sfd); saved = await get('/filters'); filterPanel(); toast('Saved view deleted'); });
  on(root, 'click', '[data-fsave]', () => modalForm({ title: 'Save this view', submit: 'Save view', body: fld('Name', inp('name', '', 'required placeholder="e.g. Hot leads — Green Valley"')),
    onSubmit: async (d) => { await post('/filters', { name: d.name, filters: F }); saved = await get('/filters'); filterPanel(); toast('View saved', 'ok'); } }));
  $('#sbtn', root).onclick = (e) => openMenu(e.currentTarget, Object.entries(SORTS).map(([k, [l]]) => ({ label: l, icon: k === sort ? 'check' : '', action: () => { sort = k; pref.set('rp_leadsort2', k); paint(); } })));
  $('#selmode', root).onclick = (e) => { const on_ = document.body.classList.toggle('selecting'); e.currentTarget.setAttribute('aria-pressed', on_); e.currentTarget.classList.toggle('primary', on_); if (!on_) { selected.clear(); paint(); } };
  $('#cbtn', root).onclick = (e) => openMenu(e.currentTarget, [{ header: 'Show columns' }, ...COLS.filter((c) => !c.always && (!c.admin || admin)).map((c) => ({ label: c.label, icon: cols.includes(c.k) ? 'check' : '', action: () => { cols = cols.includes(c.k) ? cols.filter((x) => x !== c.k) : COLS.map((x) => x.k).filter((k) => k === c.k || cols.includes(k)); pref.set('rp_leadcols3', cols); paint(); } }))]);
  on(root, 'click', '#vw [data-v]', (el) => { view = el.dataset.v; pref.set('rp_leadview2', view); paint(); });
  on(root, 'click', '#tabs [data-tab]', (el) => { tab = el.dataset.tab; selected.clear(); load(); });
  $('#add', root).onclick = () => leadForm(null, (r) => { load(); });
  if ($('#imp', root)) $('#imp', root).onclick = () => importModal(load);
  if ($('#exp', root)) $('#exp', root).onclick = () => { location.href = authUrl('/export/leads'); };
  on(root, 'click', '[data-addlead]', () => leadForm(null, load));
  on(root, 'click', '[data-importleads]', () => importModal(load));
  on(root, 'click', '[data-retry]', load);
  on(root, 'click', '[data-more]', () => { shown += 50; paint(); });
  on(root, 'click', '[data-sort]', (el) => { const s = el.dataset.sort; sort = sort === s && s === 'newest' ? 'oldest' : s; pref.set('rp_leadsort2', sort); paint(); });
  // open details in a drawer so the list (and its scroll position) stays where it is
  on(root, 'click', '[data-open]', (el, e) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); openLead(el.dataset.open); });
  on(root, 'click', 'tr.click', (tr, e) => { if (e.target.closest('input, .qa, a, button')) return; openLead(tr.dataset.id); });
  on(root, 'click', '[data-toggle]', (el, e) => {
    if (e.target.closest('input, .qa, a, button')) return;
    const id = Number(el.dataset.toggle); expanded.has(id) ? expanded.delete(id) : expanded.add(id);
    const card = el.closest('.lcard'); card.classList.toggle('open', expanded.has(id)); el.setAttribute('aria-expanded', expanded.has(id));
  });
  on(root, 'keydown', '[data-toggle]', (el, e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === el) { e.preventDefault(); el.click(); } });
  on(root, 'change', '[data-sel]', (cb) => { const id = Number(cb.dataset.sel); cb.checked ? selected.add(id) : selected.delete(id); cb.closest('tr,.lcard')?.classList.toggle('sel', cb.checked); paintBulk(); const all = $('#selall', root); if (all) all.checked = sorted().slice(0, shown).every((l) => selected.has(l.id)); });
  on(root, 'change', '#selall', (cb) => { sorted().slice(0, shown).forEach((l) => (cb.checked ? selected.add(l.id) : selected.delete(l.id))); paint(); });
  on(root, 'click', '[data-selall-matching]', () => { rows.forEach((l) => selected.add(l.id)); paint(); });
  on(root, 'click', '[data-flag]', async (b) => { try { await post(`/leads/${b.dataset.id}/flag-decision`, { decision: b.dataset.flag }); toast(b.dataset.flag === 'spam' ? 'Marked as spam — this number is now blocked' : 'Marked as genuine', 'ok'); load(); } catch (err) { toast(err.message, 'err'); } });
  on(root, 'click', '[data-dupok]', async (b) => { await post(`/leads/${b.dataset.dupok}/duplicate-review`); toast('Marked as reviewed', 'ok'); load(); });
  on(root, 'click', '[data-del]', async (b) => { await deleteLeads([Number(b.dataset.del)], load); });
  // bulk actions
  const picked = () => rows.filter((l) => selected.has(l.id));
  on(root, 'click', '[data-bulk]', (b) => {
    const act = b.dataset.bulk, ids = [...selected];
    if (act === 'clear') { selected.clear(); paint(); return; }
    if (act === 'assign') return repLoads(true).then(() => modalForm({ title: `Assign ${ids.length} lead${ids.length > 1 ? 's' : ''}`, submit: 'Assign', body: fld('Assign to', sel('rep_id', loadOptions(), '', 'required'), 'Shows how many open leads each person already has'),
      onSubmit: async (d) => { const r = await post('/leads/bulk-assign', { ids, rep_id: Number(d.rep_id) }); toast(`${r.assigned} lead${r.assigned > 1 ? 's' : ''} assigned to ${userName(Number(d.rep_id))}`, 'ok'); selected.clear(); load(); } }));
    if (act === 'stage') return modalForm({ title: `Change status of ${ids.length} lead${ids.length > 1 ? 's' : ''}`, submit: 'Update status', body: `${fld('New status', sel('stage', STAGES().filter((s) => s !== 'Booked').map((s) => [s, s]), 'Contacted'))}<div id="lr" class="hidden">${fld('Lost reason <span class="req">*</span>', sel('lost_reason', [['', 'Choose a reason…'], ...S.meta.lost_reasons]))}</div><p class="small muted">Leads become "Booked" only when a booking is created.</p>`,
      onOpen: (el) => { $('[name=stage]', el).onchange = (e) => $('#lr', el).classList.toggle('hidden', e.target.value !== 'Lost'); },
      onSubmit: async (d) => { if (d.stage === 'Lost' && !d.lost_reason) throw new Error('Choose why these leads were lost'); const r = await post('/leads/bulk-stage', { ids, stage: d.stage, lost_reason: d.lost_reason }); toast(`${r.updated} lead${r.updated === 1 ? '' : 's'} moved to ${d.stage}${r.skipped.length ? ` · ${r.skipped.length} skipped` : ''}`, 'ok'); selected.clear(); load(); } });
    if (act === 'task') return modalForm({ title: `Schedule a follow-up for ${ids.length} lead${ids.length > 1 ? 's' : ''}`, submit: 'Create follow-ups', body: `${fld('What needs to happen?', inp('title', 'Follow up', 'required'))}<div class="frm-g">${fld('Due', inp('due_at', dtLocal(new Date(Date.now() + 86400e3)), 'type="datetime-local" required'))}${fld('Priority', sel('priority', ['High', 'Medium', 'Low'], 'Medium'))}</div>`,
      onSubmit: async (d) => { let ok = 0; for (const id of ids.slice(0, 100)) { try { await post('/tasks', { lead_id: id, title: d.title, due_at: fromDT(d.due_at), priority: d.priority }); ok++; } catch { /* skip */ } } toast(`${ok} follow-up${ok === 1 ? '' : 's'} scheduled`, 'ok'); selected.clear(); load(); } });
    if (act === 'export') { const data = picked(); const csv = [['Name', 'Phone', 'Second phone', 'Email', 'Status', 'Priority', 'Source', 'Project', 'Budget', 'Assigned to', 'Next follow-up', 'Added on', 'Added by'], ...data.map((l) => [l.name, l.phone_norm, l.alt_phone_norm, l.email, l.stage, l.rating, l.source, l.project_name, l.budget_max, l.rep_name, l.next_due, l.created_at, l.added_by_name || l.added_via])].map((r) => r.map((v) => { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; }).join(',')).join('\n');
      saveTextFile(`leads_${today()}.csv`, '﻿' + csv); toast(`${data.length} leads exported`, 'ok'); return; }
    if (act === 'delete') deleteLeads(ids, () => { selected.clear(); load(); });
  });
  // board drag & drop
  function wireBoard(page) {
    $$('.kcard', body).forEach((c) => {
      c.addEventListener('click', (e) => { if (!e.target.closest('.qa')) openLead(c.dataset.id); });
      c.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', c.dataset.id); });
    });
    $$('.kcol', body).forEach((col) => {
      col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('over'); });
      col.addEventListener('dragleave', () => col.classList.remove('over'));
      col.addEventListener('drop', async (e) => {
        e.preventDefault(); col.classList.remove('over');
        const id = Number(e.dataTransfer.getData('text/plain')), stage = col.dataset.stage, lead = rows.find((x) => x.id === id);
        if (!lead || lead.stage === stage) return;
        if (stage === 'Booked') return toast('Open the lead and choose "Book plot" — that creates the booking and marks the lead Booked.', 'err');
        if (stage === 'Lost') return lostModal(lead, load);
        const prev = lead.stage; lead.stage = stage; paint(); // optimistic: the card moves at once
        try { await post(`/leads/${id}/stage`, { stage }); toast(`${lead.name.split(' ')[0]} moved to ${stage}`, 'ok'); load(); }
        catch (err) { lead.stage = prev; paint(); toast(err.message, 'err'); }
      });
    });
  }
  await load();
}

async function deleteLeads(ids, done) {
  const n = ids.length;
  const ok = await confirmDialog(`This permanently deletes <b>${n} lead${n > 1 ? 's' : ''}</b> together with ${n > 1 ? 'their' : 'its'} call logs, WhatsApp history, notes, follow-ups, site visits and documents. This cannot be undone.<br><br><span class="muted">Leads that already have a booking are kept.</span>`, { ok: `Delete ${n} lead${n > 1 ? 's' : ''}`, danger: true, title: `Delete ${n} lead${n > 1 ? 's' : ''}?` });
  if (!ok) return;
  try { const r = await post('/leads/bulk-delete', { ids }); toast(`${r.deleted} lead${r.deleted === 1 ? '' : 's'} deleted${r.blocked.length ? ` · ${r.blocked.length} kept because they have bookings` : ''}`, r.blocked.length ? '' : 'ok'); done && done(); } catch (e) { toast(e.message, 'err'); }
}
function lostModal(lead, done) {
  modalForm({ title: `Mark ${lead.name} as lost`, submit: 'Mark as lost', danger: true, body: fld('Why was this lead lost? <span class="req">*</span>', sel('lost_reason', [['', 'Choose a reason…'], ...S.meta.lost_reasons], '', 'required')) + fld('Note', '<textarea name="lost_note" placeholder="Optional — anything useful for later"></textarea>'),
    onSubmit: async (d) => { await post(`/leads/${lead.id}/stage`, { stage: 'Lost', ...d }); toast(`${lead.name.split(' ')[0]} marked as lost`); done && done(); } });
}

// ================= import =================
function importModal(done) {
  let pv = null, tabSel = 'all', extras = true;
  const KIND = { csv: 'CSV', xlsx: 'Excel (.xlsx)', xls: 'Excel (.xls)', pdf: 'PDF' };
  const m = modal({ title: 'Import leads', xl: true, body: `<div id="imp1">
      <p class="muted">Upload an <b>Excel</b> (.xlsx / .xls), <b>CSV / TSV / text</b> or text-based <b>PDF</b> list — any column order, with or without a header row. Only a <b>phone number</b> is needed; empty or "N/A" cells are fine. If a client has <b>two numbers</b>, put them in two columns (e.g. <i>Phone</i> and <i>Alternate number</i>) or in one cell separated by <b>/</b> — both are saved. ${isAdmin() ? '' : '<br>These leads will be added to <b>your</b> list.'} You'll check the column mapping and a preview before anything is added.</p>
      <div class="frm-g">${fld('Default lead source', sel('def', S.meta.sources, 'Other'), 'Used for rows that have no source')}${fld('File', '<input type="file" id="ifile" accept=".csv,.xlsx,.xls,.pdf,text/csv,application/pdf">')}</div>
      <a href="data:text/csv;charset=utf-8,${encodeURIComponent('name,phone,alternate_phone,email,source,budget,size,facing,location,project,purpose,notes\nRamesh Kumar,9876543210,9845012345,ramesh@example.com,Facebook Ads,35 L,200,East,Shadnagar,,Investment,Called from ad\n')}" download="leads_template.csv" id="itpl">⬇ Download template</a><div id="ierr" class="mt"></div></div>
      <div id="imp2" class="hidden"></div>` });
  $('#itpl', m.el).onclick = (e) => { if (window.RPNative) { e.preventDefault(); saveTextFile('leads_template.csv', decodeURIComponent(e.currentTarget.href.split(',').slice(1).join(','))); } };
  const readFile = (f) => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result.split(',')[1]); fr.onerror = rej; fr.readAsDataURL(f); });
  const src = () => $('[name=def]', m.el).value;
  $('#ifile', m.el).onchange = async (e) => {
    const file = e.target.files[0]; if (!file) return; $('#ierr', m.el).innerHTML = '<div class="muted">Reading file…</div>';
    try { pv = await post('/leads/import/preview', { file_base64: await readFile(file), filename: file.name, default_source: src() }); $('#imp1', m.el).classList.add('hidden'); review(); }
    catch (err) { $('#ierr', m.el).innerHTML = `<div class="err">${esc(err.message)}</div>`; e.target.value = ''; }
  };
  const remap = async (mapping) => {
    try { pv = await post('/leads/import/preview', { upload_id: pv.upload_id, mapping, default_source: src(), include_extras: extras }); review(); }
    catch (err) { toast(err.message, 'err'); }
  };
  const review = () => {
    const p2 = $('#imp2', m.el); p2.classList.remove('hidden');
    const colField = {}; Object.entries(pv.mapping).forEach(([k, i]) => (colField[i] = k));
    const opts = [['', '— ignore —'], ...pv.fields.map((f) => [f.key, f.label])];
    const shown = pv.rows.filter((r) => tabSel === 'all' || r.status === tabSel);
    const stat = (l, v, c) => `<div class="card kpi"><div class="l">${l}</div><div class="v" ${c ? `style="color:var(--${c})"` : ''}>${v}</div></div>`;
    p2.innerHTML = `<div class="row between mb"><div><b>${esc(pv.filename)}</b> <span class="badge">${KIND[pv.kind] || esc(pv.kind)}</span></div><button class="btn sm" id="iback">← Choose another file</button></div>
      ${pv.note ? `<div class="warn-box">${esc(pv.note)}</div>` : ''}
      <details class="acc mb" ${pv.needs_mapping ? 'open' : ''}><summary><span>1 · Column mapping <span class="muted small">— which file column goes to which CRM field</span></span><span class="muted small">${Object.keys(pv.mapping).length} of ${pv.columns.length} columns used</span></summary><div class="in" style="padding:10px 12px">
        ${pv.needs_mapping ? '<div class="warn-box">I could not find the phone number column. Choose it below (Name and the rest are optional), then click Apply.</div>' : ''}
        <label class="row mb"><input type="checkbox" id="iextra" ${extras ? 'checked' : ''}> <span class="small">Keep columns I don't map as a note on the lead (nothing in the file is lost)</span></label>
        <div class="mapgrid">${pv.columns.map((c) => `<div class="mc"><b title="${esc(c.header)}">${esc(c.header || 'Column ' + (c.index + 1))}</b><small title="${esc(c.samples.join(' · '))}">${esc(c.samples.filter(Boolean).join(' · ') || '(empty)')}</small>${sel('', opts, colField[c.index] || '', `data-col="${c.index}"`)}</div>`).join('')}</div>
        <button class="btn sm primary mt" id="iapply">Apply mapping</button></div></details>
      ${pv.needs_mapping ? '' : `<div class="grid g6 keep mb">${stat('Total records', pv.total)}${stat('Valid', pv.valid, 'green')}${stat('Duplicates', pv.duplicates, 'amber')}${stat('Invalid', pv.invalid, 'red')}${stat('Will be imported', pv.to_import, 'brand')}</div>
      <div class="tabs">${[['all', 'All', pv.total], ['valid', 'Valid', pv.valid], ['duplicate', 'Duplicates', pv.duplicates], ['invalid', 'Invalid', pv.invalid]].map(([k, l, n]) => `<button data-t="${k}" class="${tabSel === k ? 'on' : ''}">${l} <span class="muted small">(${n})</span></button>`).join('')}</div>
      <div class="tbl-wrap" style="max-height:320px"><table class="tbl"><thead><tr><th>Row</th><th>Name</th><th>Phone(s)</th><th>Email</th><th>Source</th><th>Budget</th><th>Result</th></tr></thead><tbody>${shown.slice(0, 300).map((r) => `<tr><td>${r.row}</td><td>${esc(r.data.name)}</td><td>${r.status === 'invalid' ? esc(r.data.phone) : phoneFmt(r.data.phone)}${r.data.alt_phone ? `<div class="small muted">${phoneFmt(r.data.alt_phone)}</div>` : ''}</td><td class="small">${esc(r.data.email || '')}</td>
        <td>${r.status === 'valid' ? sel('src', [...new Set([r.data.source, ...S.meta.sources])], r.data.source, `data-row="${r.row}" style="padding:3px 6px"`) : esc(r.data.source)}</td><td class="small">${r.data.budget_max ? inrShort(r.data.budget_max) : ''}</td>
        <td>${r.status === 'valid' ? badge('Will import', 'b-green') + (r.warnings || []).map((w) => `<div class="small" style="color:var(--amber)">${esc(w)}</div>`).join('') : `${badge(r.status === 'duplicate' ? 'Duplicate — skipped' : 'Invalid — skipped', r.status === 'duplicate' ? 'b-amber' : 'b-red')}<div class="small muted">${esc(r.errors.join('; '))}</div>`}</td></tr>`).join('') || `<tr><td colspan="7" class="empty">No rows in this view</td></tr>`}</tbody></table></div>
      ${shown.length > 300 ? `<p class="muted small">Showing the first 300 of ${shown.length} rows. All valid rows will be imported.</p>` : ''}
      <div class="row mt" style="justify-content:flex-end"><button class="btn primary" id="iok" ${pv.to_import ? '' : 'disabled'}>Import ${pv.to_import} lead(s)</button></div>`}`;
    $('#iback', p2).onclick = () => { p2.classList.add('hidden'); $('#imp1', m.el).classList.remove('hidden'); $('#ierr', m.el).innerHTML = ''; $('#ifile', m.el).value = ''; tabSel = 'all'; };
    $('#iapply', p2).onclick = () => {
      const mapping = {}, clash = [];
      $$('[data-col]', p2).forEach((s) => { if (!s.value) return; if (s.value in mapping) clash.push(s.selectedOptions[0].textContent); mapping[s.value] = Number(s.dataset.col); });
      if (clash.length) return toast(`"${clash[0]}" is chosen for more than one column`, 'err');
      if (!('phone' in mapping)) return toast('Choose the column that holds the phone number', 'err');
      extras = $('#iextra', p2).checked;
      remap(mapping);
    };
    $$('[data-t]', p2).forEach((b) => (b.onclick = () => { tabSel = b.dataset.t; review(); }));
    $$('[data-row]', p2).forEach((s) => (s.onchange = () => { pv.rows.find((r) => r.row == s.dataset.row).data.source = s.value; }));
    const okBtn = $('#iok', p2); if (okBtn) okBtn.onclick = async (ev) => {
      ev.target.disabled = true;
      try {
        const r = await post('/leads/import/commit', { upload_id: pv.upload_id, rows: pv.rows.filter((x) => x.status === 'valid') });
        const left = [...pv.rows.filter((x) => x.status !== 'valid').map((x) => ({ row: x.row, name: x.data.name, reason: x.errors.join('; ') })), ...r.skipped];
        p2.innerHTML = `<div class="ok-box"><b>${r.imported} lead(s) imported</b> on ${esc(dayHeading(new Date().toISOString()))} at ${fmtTime(new Date().toISOString())}. ${left.length} row(s) were left out (${pv.duplicates} duplicate, ${pv.invalid} invalid${r.skipped.length ? `, ${r.skipped.length} rejected at import` : ''}).</div>${left.length ? `<div class="tbl-wrap" style="max-height:300px"><table class="tbl"><thead><tr><th>Row</th><th>Name</th><th>Why it was left out</th></tr></thead><tbody>${left.map((x) => `<tr><td>${x.row}</td><td>${esc(x.name || '')}</td><td>${esc(x.reason)}</td></tr>`).join('')}</tbody></table></div>` : ''}<div class="row mt" style="justify-content:flex-end"><button class="btn primary" data-close>Done</button></div>`;
        done && done();
      } catch (err) { toast(err.message, 'err'); ev.target.disabled = false; }
    };
  };
}



// ================= shared pieces for the lead drawer and the lead page =================
const TL_ICON = { call: 'phone', whatsapp: 'message', note: 'edit', task: 'checkCircle', stage: 'refresh', visit: 'truck', booking: 'file', payment: 'rupee', assign: 'userCheck', system: 'info' };
function activityHtml(a) {
  if (a.type === 'call') {
    return `<b>${a.direction === 'incoming' ? 'Incoming' : 'Outgoing'} call</b> ${badge(callLabel(a.outcome), callCls(a.outcome))}${a.meta?.source === 'device' ? ` <span class="muted small" data-tip="Reported automatically by the phone app">${ico('phone', 'sm')} auto</span>` : ''}${a.outcome === 'Connected' ? `<div class="small">Duration <b>${mmss(a.duration)}</b></div>` : ''}${a.content ? `<div class="small">${esc(a.content)}</div>` : ''}${['Initiated', 'Failed'].includes(a.outcome) && (isAdmin() || a.user_id === S.user.id) ? ` <button class="btn sm" data-fix="${a.id}">Log result</button>` : ''}`;
  }
  if (a.type === 'whatsapp') return `<b>WhatsApp ${a.direction === 'incoming' ? 'received' : 'sent'}</b><div class="small">${esc(a.content)}</div>`;
  return `<div>${esc(a.content)}</div>`;
}
function timelineHtml(items, limit) {
  const list = limit ? items.slice(0, limit) : items;
  if (!list.length) return empty('No activity here yet', 'Calls, messages, notes and status changes will appear as they happen.', '', 'list');
  let day = '', out = '<ul class="tl">';
  for (const a of list) {
    const d = dayLabel(a.created_at);
    if (d !== day) { day = d; out += `<li class="tl-day" style="display:block;padding:var(--s3) 0 0">${esc(d)}</li>`; }
    out += `<li><div class="ico ${a.type}">${ico(TL_ICON[a.type] || 'info', 'sm')}</div><div style="min-width:0;flex:1">${activityHtml(a)}<div class="t">${fmtTime(a.created_at)} · ${a.user_name ? esc(a.user_name) : 'System'}</div></div></li>`;
  }
  return out + '</ul>';
}
function contextHtml(l, d) {
  const task = d.tasks.find((t) => t.status === 'open');
  return `<div class="ctx"><div><div class="l">Status</div><div class="v">${stageBadge(l.stage)}</div></div><div><div class="l">Priority</div><div class="v">${ratingBadge(l.rating)} <span class="dim small" style="font-weight:400">${l.score}/100</span></div></div>
    <div><div class="l">Last contacted</div><div class="v">${l.last_contacted ? `${rel(l.last_contacted)}` : '<span class="dim" style="font-weight:500">Never</span>'}</div></div>
    <div><div class="l">Next follow-up</div><div class="v">${task ? `<span class="${Date.parse(task.due_at) < Date.now() ? 'bad' : ''}">${friendlyDT(task.due_at)}</span>` : `<button class="btn ghost sm" data-act="task" style="padding:0;height:auto">${ico('plus', 'sm')}Schedule</button>`}</div></div>
    <div><div class="l">Assigned to</div><div class="v">${l.rep_name ? esc(l.rep_name) : '<span class="dim" style="font-weight:500">Unassigned</span>'}</div></div></div>`;
}
function portalModal(l, done) {
  post(`/leads/${l.id}/portal-link`).then((r) => {
    const link = fullLink(r.link);
    const text = `Hi ${l.name.split(' ')[0]}, here is your secure booking portal from ${S.org.name}: ${link}\nYou can view your booking, payment schedule and upload KYC documents there.`;
    modal({ title: 'Client booking portal link', body: `<p>Send this secure link to the client. It shows their booking status and payment schedule and lets them upload KYC documents. It expires in ${S.settings.portal_days || 30} days.</p><p><code>${esc(link)}</code></p>`,
      footer: `<button class="btn" id="cp">${ico('copy', 'sm')}Copy link</button><a class="btn primary" target="_blank" rel="noopener" href="${waLink(l.phone_norm, text)}">${ico('message', 'sm')}Send on WhatsApp</a>`, onOpen: (el) => ($('#cp', el).onclick = () => copy(link)) });
    done && done();
  }).catch((e) => toast(e.message, 'err'));
}
/** Everything that is not the main call-to-action lives in one tidy menu. */
function moreItems(l, done, afterDelete) {
  const admin = isAdmin(), open = !['Lost', 'Booked'].includes(l.stage);
  return [
    ...(open ? [{ icon: 'truck', label: 'Schedule site visit', action: () => visitModal(l, done) }, { icon: 'lock', label: 'Hold a plot', action: () => holdModal(l, done) }] : []),
    ...(l.stage !== 'Lost' ? [{ icon: 'file', label: 'Book a plot', action: () => bookingWizard({ lead: l, onDone: done }) }] : []),
    { hr: true },
    ...(admin ? [{ icon: 'userCheck', label: 'Assign to…', action: () => assignModal(l, done) }] : []),
    { icon: 'link', label: 'Client portal link', action: () => portalModal(l, done) },
    { icon: 'edit', label: 'Edit details', action: () => leadForm(l, done) },
    ...(admin ? [{ icon: 'zap', label: 'Ask RealPilot', action: () => nav('#/ai?lead=' + l.id) }] : []),
    { hr: true },
    ...(open ? [{ icon: 'ban', label: 'Mark as lost', danger: true, action: () => lostModal(l, done) }] : []),
    ...(l.stage === 'Lost' ? [{ icon: 'undo', label: 'Reopen lead', action: async () => { try { await post(`/leads/${l.id}/stage`, { stage: 'Negotiation' }); toast('Lead reopened', 'ok'); done(); } catch (e) { toast(e.message, 'err'); } } }] : []),
    ...(admin ? [{ icon: 'trash', label: 'Delete lead', danger: true, action: () => deleteLeads([l.id], afterDelete || done) }]
      : [{ icon: 'copy', label: 'Report as duplicate', action: async () => { const n = await askText('Report as duplicate', 'Note for admin (optional)', { required: false }); if (n !== null) { try { await post(`/leads/${l.id}/report-duplicate`, { note: n }); toast('Reported to your admin', 'ok'); done(); } catch (e) { toast(e.message, 'err'); } } } }]),
  ];
}
/** Change a lead's status from a select; the new value shows at once and is put back if the server refuses. */
function stageSelect(l, done) {
  return sel('stage', STAGES().map((s) => [s, s]), l.stage, `data-native class="stg" aria-label="Status" ${l.stage === 'Booked' ? 'disabled' : ''}`);
}
function wireStage(root, l, done) {
  const s = $('.stg', root); if (!s) return;
  s.onchange = async (e) => {
    const st = e.target.value;
    if (st === 'Lost') { e.target.value = l.stage; return lostModal(l, done); }
    if (st === 'Booked') { e.target.value = l.stage; return bookingWizard({ lead: l, onDone: done }); }
    try { await post(`/leads/${l.id}/stage`, { stage: st }); toast(`Status changed to ${st}`, 'ok'); done(); } catch (err) { e.target.value = l.stage; toast(err.message, 'err'); }
  };
}
/** One sentence + one button: what to do with this lead right now. */
const nbaHtml = (n, l) => {
  if (!n) return '';
  const btn = { call: `<a class="btn primary sm" href="tel:+91${l.phone_norm}" data-call="${l.id}" data-call-name="${esc(l.name)}">${ico('phone', 'sm')}Call now</a>`,
    whatsapp: `<button class="btn primary sm" data-wa="${l.id}" data-wa-name="${esc(l.name)}" data-wa-phone="${l.phone_norm}">${ico('message', 'sm')}WhatsApp</button>`,
    task: `<button class="btn primary sm" data-act="task">${ico('plus', 'sm')}Set follow-up</button>`,
    visit: n.visit_id ? `<button class="btn primary sm" data-vdone="${n.visit_id}">${ico('check', 'sm')}Record outcome</button>` : '',
    hold: `<button class="btn primary sm" data-act="hold">${ico('lock', 'sm')}Hold a plot</button>` }[n.cta] || '';
  return `<div class="nba ${n.tone}"><span class="nba-i">${ico(n.tone === 'info' ? 'info' : 'zap', 'sm')}</span><div class="grow"><b>Next step</b><div>${esc(n.text)}</div></div>${btn}</div>`;
};
const actionButtons = (l) => `<a class="btn primary" href="tel:+91${l.phone_norm}" data-call="${l.id}" data-call-name="${esc(l.name)}">${ico('phone', 'sm')}Call</a><button class="btn" data-wa="${l.id}" data-wa-name="${esc(l.name)}" data-wa-phone="${l.phone_norm}">${ico('message', 'sm')}WhatsApp</button><button class="btn" data-act="note">${ico('edit', 'sm')}Add note</button><button class="btn" data-act="task">${ico('checkCircle', 'sm')}Follow-up</button>`;

// ================= lead drawer: look at a lead without leaving the list =================
export async function openLeadDrawer(id, onChange) {
  let cur = null, tl = 'all';
  const dr = drawer({ title: 'Lead', header: '<div class="grow" id="dh"></div>', body: skeleton('detail'), footer: '<div class="grow" id="dfoot"></div>' });
  const done = async () => { onChange && onChange(); await load(); };
  const load = async () => {
    let d; try { d = await get('/leads/' + id); } catch (e) { dr.body.innerHTML = errorState(e.status === 404 ? 'This lead is no longer available.' : 'Something went wrong while loading this lead.', e.status !== 404); on(dr.body, 'click', '[data-retry]', load); return; }
    cur = d; const l = d.lead; rememberLead(l);
    $('#dh', dr.el).innerHTML = `<div class="row" style="flex-wrap:nowrap;gap:var(--s3)">${avatar(l.name, 'lg')}<div style="min-width:0"><h3 style="font-size:var(--fs-lg);overflow:hidden;text-overflow:ellipsis">${esc(l.name)}</h3><div class="muted small"><a href="tel:+91${l.phone_norm}" data-call="${l.id}" data-call-name="${esc(l.name)}">${phoneFmt(l.phone_norm)}</a>${l.alt_phone_norm ? ` · <a href="tel:+91${l.alt_phone_norm}">${phoneFmt(l.alt_phone_norm)}</a>` : ''}${l.email ? ' · ' + esc(l.email) : ''}</div></div></div>`;
    dr.body.innerHTML = `<div class="acts">${actionButtons(l)}<button class="btn icon" id="dmore" aria-label="More actions" data-tip="More">${ico('more')}</button></div>
      ${nbaHtml(d.next_action, l)}
      ${contextHtml(l, d)}
      <div class="fsec" style="margin-top:var(--s4)">Change status</div>${stageSelect(l)}
      ${l.stage === 'Lost' ? `<div class="err" style="margin-top:var(--s3)">${ico('ban', 'sm')}<span><b>Lost:</b> ${esc(l.lost_reason)}${l.lost_note ? ' — ' + esc(l.lost_note) : ''}</span></div>` : ''}
      <div class="fsec">Requirements</div><dl class="kv"><dt>Budget</dt><dd>${l.budget_min || l.budget_max ? `${l.budget_min ? inr(l.budget_min) : ''}${l.budget_min && l.budget_max ? ' – ' : ''}${l.budget_max ? inr(l.budget_max) : ''}` : '—'}</dd>
        <dt>Plot size</dt><dd>${l.pref_size_min || l.pref_size_max ? `${l.pref_size_min || ''}${l.pref_size_min && l.pref_size_max && l.pref_size_min != l.pref_size_max ? ' – ' + l.pref_size_max : ''} sq.yd` : '—'}</dd>
        <dt>Project</dt><dd>${esc(l.project_name || '—')}</dd><dt>Facing</dt><dd>${esc(l.pref_facing || '—')}</dd><dt>Source</dt><dd>${esc(l.source || '—')}</dd></dl>
      ${l.notes ? `<div class="fsec">Notes</div><p style="margin:0;white-space:pre-wrap">${esc(l.notes)}</p>` : ''}
      ${d.tasks.some((t) => t.status === 'open') ? `<div class="fsec">Open follow-ups</div>${d.tasks.filter((t) => t.status === 'open').map((t) => `<div class="mini-row"><input type="checkbox" data-tdone="${t.id}" aria-label="Mark done"><div class="grow"><div class="nm">${esc(t.title)}</div><div class="sub ${Date.parse(t.due_at) < Date.now() ? 'bad' : ''}">${friendlyDT(t.due_at)}</div></div></div>`).join('')}` : ''}
      <div class="fsec">Activity <small><a href="#/leads/${l.id}" data-close>See all</a></small></div>${timelineHtml(d.timeline, 6)}`;
    $('#dfoot', dr.el).innerHTML = `<a class="btn primary" style="width:100%" href="#/leads/${l.id}" data-close>${ico('external', 'sm')}Open full details</a>`;
    wireStage(dr.body, l, done);
    $('#dmore', dr.el).onclick = (e) => openMenu(e.currentTarget, moreItems(l, done, () => { dr.close(); onChange && onChange(); }));
  };
  on(dr.el, 'click', '[data-act]', (b) => {
    const l = cur.lead, a = b.dataset.act;
    if (a === 'note') askText('Add a note', 'Note', { submit: 'Save note' }).then((t) => { if (t) post(`/leads/${l.id}/notes`, { content: t }).then(() => { toast('Note saved', 'ok'); done(); }).catch((e) => toast(e.message, 'err')); });
    if (a === 'task') taskModal(l, done);
    if (a === 'hold') holdModal(l, done);
  });
  on(dr.el, 'click', '[data-vdone]', (b) => visitCompleteModal(b.dataset.vdone, done));
  on(dr.el, 'change', '[data-tdone]', async (el) => { try { await post(`/tasks/${el.dataset.tdone}/complete`); toast('Follow-up marked done', 'ok'); done(); } catch (e) { el.checked = false; toast(e.message, 'err'); } });
  on(dr.el, 'click', '[data-fix]', (b) => callModal(cur.lead, done, Number(b.dataset.fix)));
  await load();
}

function visitCompleteModal(id, done) {
  modalForm({ title: 'Complete site visit', submit: 'Mark completed', body: fld('How interested was the customer?', sel('interest', [['', '—'], 'High', 'Medium', 'Low'])) + fld('Feedback', '<textarea name="feedback" placeholder="Which plots they liked, concerns, next step…"></textarea>'),
    onSubmit: async (f) => { await post(`/visits/${id}/complete`, f); toast('Site visit completed', 'ok'); done(); } });
}

// ================= lead page =================
export async function detail(root, { id }) {
  let tlFilter = 'all', cur = null;
  const load = async () => {
    let d; try { d = await get('/leads/' + id); } catch (e) { root.innerHTML = `<a class="btn ghost sm" href="#/leads">${ico('chevLeft', 'sm')}Leads</a>` + (e.status === 404 ? empty('Lead not found', 'It may have been deleted or assigned to someone else.', '<a class="btn primary" href="#/leads">Back to leads</a>', 'search') : errorState('Something went wrong while loading this lead.')); return; }
    cur = d; rememberLead(d.lead);
    const l = d.lead, admin = isAdmin(), cf = S.meta.custom_fields;
    const kycBadge = { none: ['No documents', 'slate'], pending: ['KYC pending review', 'amber'], partial: ['KYC incomplete', 'amber'], verified: ['KYC verified', 'green'], rejected: ['KYC rejected', 'red'] }[l.kyc_status || 'none'];
    const acts = d.timeline.filter((a) => tlFilter === 'all' || a.type === tlFilter);
    const showBook = ['Site Visit Completed', 'Negotiation'].includes(l.stage);
    root.innerHTML = `<div class="mb"><a class="btn ghost sm" href="#/leads" style="margin-left:-8px">${ico('chevLeft', 'sm')}Leads</a></div>
    ${l.flag_status === 'pending' ? `<div class="warn-box">${ico('alert', 'sm')}<span><b>Suspicious lead:</b> ${esc(l.flag_reason)}. ${admin ? `<button class="btn sm" data-act="genuine">Mark genuine</button> <button class="btn sm danger" data-act="spam">Mark spam</button>` : 'Your admin will review it.'}</span></div>` : ''}
    ${l.flag_status === 'spam' ? `<div class="err">${ico('ban', 'sm')}<span>This number is blocked as spam.</span></div>` : ''}
    ${l.dup_status === 'reported' ? `<div class="warn-box">${ico('copy', 'sm')}<span>Reported as duplicate by ${esc(userName(l.dup_reported_by))}${l.dup_note ? ': ' + esc(l.dup_note) : ''}. ${admin ? '<button class="btn sm" data-act="dupok">Not a duplicate</button>' : ''}</span></div>` : ''}
    ${d.duplicates.length ? `<div class="info-box">${ico('info', 'sm')}<span>Other leads share this phone/email: ${d.duplicates.map((x) => admin ? `<a href="#/leads/${x.id}">${esc(x.name)}</a>` : esc(x.name)).join(', ')}</span></div>` : ''}
    <div class="lhead">${avatar(l.name, 'lg')}<div class="grow" style="min-width:0"><h1>${esc(l.name)}</h1>
      <div class="meta"><a href="tel:+91${l.phone_norm}" data-call="${l.id}" data-call-name="${esc(l.name)}">${ico('phone', 'sm')} ${phoneFmt(l.phone_norm)}</a>${l.alt_phone_norm ? `<a href="tel:+91${l.alt_phone_norm}">${ico('phone', 'sm')} ${phoneFmt(l.alt_phone_norm)}</a>` : ''}${l.email ? `<span>${ico('send', 'sm')} ${esc(l.email)}</span>` : ''}<span>${esc(l.source || 'Unknown source')}</span><span title="${esc(fmtDT(l.created_at))}">Added ${esc(dayHeading(l.created_at))}, ${fmtTime(l.created_at)} by ${addedBy(l)}${l.added_via === 'import' ? ' (bulk import)' : ''}</span></div></div></div>
    <div class="acts mt d-only">${actionButtons(l)}${showBook ? `<button class="btn" data-act="book">${ico('file', 'sm')}Book plot</button>` : ''}<button class="btn icon" id="more" aria-label="More actions" data-tip="More actions">${ico('more')}</button></div>
    <div class="actionbar"><a class="ab" href="tel:+91${l.phone_norm}" data-call="${l.id}" data-call-name="${esc(l.name)}">${ico('phone')}Call</a><button class="ab" data-wa="${l.id}" data-wa-name="${esc(l.name)}" data-wa-phone="${l.phone_norm}">${ico('message')}WhatsApp</button><button class="ab" data-act="note">${ico('edit')}Note</button><button class="ab" data-act="task">${ico('checkCircle')}Follow-up</button><button class="ab" id="more3" aria-label="More">${ico('more')}More</button></div>
    ${nbaHtml(d.next_action, l)}
    ${contextHtml(l, d)}
    <div class="row mb"><label class="small muted" for="stgsel">Change status</label><div style="min-width:200px">${stageSelect(l).replace('class="stg"', 'class="stg" id="stgsel"')}</div>
      <select id="rat" data-native aria-label="Priority" style="width:auto"><option value="auto">Priority: automatic</option>${['Hot', 'Warm', 'Cold'].map((r) => `<option ${l.rating_manual && l.rating === r ? 'selected' : ''}>${r}</option>`).join('')}</select></div>
    <div class="grid g2 stack" style="grid-template-columns:minmax(0,5fr) minmax(0,6fr);align-items:start">
      <div class="grid">
        <section class="card"><div class="panel-h"><h3>${ico('target', 'sm')}Requirements</h3><button class="btn ghost sm" data-act="edit">${ico('edit', 'sm')}Edit</button></div>
          <dl class="kv"><dt>Budget</dt><dd>${l.budget_min || l.budget_max ? `${l.budget_min ? inr(l.budget_min) : ''}${l.budget_min && l.budget_max ? ' – ' : ''}${l.budget_max ? inr(l.budget_max) : ''}` : '—'}</dd>
          <dt>Plot size</dt><dd>${l.pref_size_min || l.pref_size_max ? `${l.pref_size_min || ''}${l.pref_size_min && l.pref_size_max && l.pref_size_min != l.pref_size_max ? ' – ' + l.pref_size_max : ''} sq.yd` : '—'}</dd><dt>Facing</dt><dd>${esc(l.pref_facing || '—')}</dd>
          <dt>Location</dt><dd>${esc(l.pref_location || '—')}</dd><dt>Project</dt><dd>${esc(l.project_name || '—')}</dd><dt>Purpose</dt><dd>${esc(l.purpose || '—')}</dd><dt>Partner</dt><dd>${esc(l.partner_name || 'Direct')}</dd>
          ${cf.map((f) => `<dt>${esc(f.label)}</dt><dd>${f.type === 'checkbox' ? (l.custom[f.id] ? 'Yes' : 'No') : esc(l.custom[f.id] ?? '—')}</dd>`).join('')}
          <dt>Notes</dt><dd style="white-space:pre-wrap">${esc(l.notes || '—')}</dd></dl>
          ${l.stage === 'Lost' ? `<div class="err" style="margin-top:var(--s3)">${ico('ban', 'sm')}<span><b>Lost:</b> ${esc(l.lost_reason)}${l.lost_note ? ' — ' + esc(l.lost_note) : ''} <span class="small">(${fmtDate(l.lost_at)})</span></span></div>` : ''}</section>
        ${d.bookings.length ? `<section class="card"><div class="panel-h"><h3>${ico('file', 'sm')}Bookings</h3></div>${d.bookings.map((b) => `<div class="list-row pcard" data-href="#/bookings/${b.id}"><div><b>${esc(b.booking_no)}</b> ${statusChip('booking', b.status)}<div class="small muted">${esc(b.project_name)} · Plot ${esc(b.plot_no)} · ${inr(b.total)}</div></div>${admin ? `<div class="right small">Paid ${inr(b.paid)}<br><span class="${b.overdue_amount ? 'bad' : 'dim'}">${b.overdue_amount ? 'Overdue ' + inr(b.overdue_amount) : 'Due ' + inr(b.outstanding)}</span></div>` : ico('chevRight')}</div>`).join('')}</section>` : ''}
        ${d.holds.length ? `<section class="card"><div class="panel-h"><h3>${ico('lock', 'sm')}Plots on hold</h3></div>${d.holds.map((h) => `<div class="list-row"><div><b>Plot ${esc(h.plot_no)}</b> <span class="muted small">${esc(h.project_name)}</span><div class="small">until ${friendlyDT(h.hold_until)}</div></div><button class="btn sm" data-rel="${h.id}">Release</button></div>`).join('')}</section>` : ''}
        <section class="card"><div class="panel-h"><h3>${ico('checkCircle', 'sm')}Follow-ups & site visits</h3></div>
          ${d.tasks.length ? d.tasks.map((t) => `<div class="mini-row" style="cursor:default">${t.status === 'open' ? `<input type="checkbox" data-tdone="${t.id}" aria-label="Mark done">` : ico('check', 'sm')}<div class="grow"><div class="nm" style="${t.status === 'done' ? 'text-decoration:line-through;color:var(--text-3)' : ''}">${esc(t.title)}</div><div class="sub ${t.status === 'open' && Date.parse(t.due_at) < Date.now() ? 'bad' : ''}">${friendlyDT(t.due_at)} · ${esc(t.assignee || '')}${t.postponed_count ? ` · postponed ${t.postponed_count}×` : ''}</div></div></div>`).join('') : '<p class="muted small" style="margin:0 0 var(--s3)">No follow-ups yet.</p>'}
          ${d.visits.map((v) => `<div class="mini-row" style="cursor:default"><span class="fi violet" style="width:28px;height:28px;border-radius:8px;display:flex;align-items:center;justify-content:center">${ico('truck', 'sm')}</span><div class="grow"><div class="nm">${esc(v.project_name)}${v.plot_no ? ' · Plot ' + esc(v.plot_no) : ''}</div><div class="sub">${friendlyDT(v.scheduled_at)}${v.pickup_required ? ' · pickup' : ''}${v.feedback ? ' · ' + esc(v.feedback) : ''}</div></div>${statusChip('visit', v.status)}${v.status === 'scheduled' && !v.on_way_at ? `<button class="btn sm" data-vway="${v.id}">On the way</button>` : v.status === 'scheduled' ? '<span class="chip sm green">On the way</span>' : ''}${v.status === 'scheduled' ? `<button class="btn sm" data-vdone="${v.id}">Complete</button>` : ''}</div>`).join('')}
          <div class="row mt"><button class="btn sm" data-act="task">${ico('plus', 'sm')}Follow-up</button><button class="btn sm" data-act="visit">${ico('truck', 'sm')}Site visit</button></div></section>
        <details class="card acc" style="padding:0" ${d.kyc.length || l.portal_token ? 'open' : ''}><summary style="padding:var(--s4) var(--s5)"><span class="row gap-s">${ico('lock', 'sm')}<b>Client portal & KYC</b></span>${statusChip('kyc', l.kyc_status || 'none', kycBadge[0])}</summary><div class="in" style="padding:var(--s3) var(--s5) var(--s4)">
          <p class="small">${statusChip('kyc', d.portal_status === 'Pending Portal Link' ? 'pending' : d.portal_status.includes('Expired') ? 'rejected' : 'verified', d.portal_status)}</p>
          ${d.kyc.map((k) => `<div class="list-row"><div><b>${esc(k.doc_type)}</b><div class="small muted">${esc(k.filename)} · ${rel(k.uploaded_at)}${k.remark ? ' · ' + esc(k.remark) : ''}</div></div><div class="row gap-s">${statusChip('kyc', k.status)}<a class="btn sm" href="${authUrl('/kyc/' + k.id + '/file')}" target="_blank" rel="noopener">View</a>${admin && k.status === 'pending' ? `<button class="btn sm" data-kv="${k.id}" aria-label="Verify">${ico('check', 'sm')}</button><button class="btn sm danger" data-kr="${k.id}" aria-label="Reject">${ico('x', 'sm')}</button>` : ''}</div></div>`).join('')}
          <button class="btn sm mt" data-act="kyc">${ico('upload', 'sm')}Upload document</button></div></details>
      </div>
      <section class="card" style="position:sticky;top:calc(var(--topbar) + var(--s3))"><div class="panel-h"><h3>${ico('list', 'sm')}Activity</h3><div class="seg mini" id="tlseg">${[['all', 'All'], ['call', 'Calls'], ['whatsapp', 'WhatsApp'], ['note', 'Notes'], ['task', 'Tasks']].map(([k, n]) => `<button data-tl="${k}" class="${tlFilter === k ? 'on' : ''}">${n}</button>`).join('')}</div></div>
        <div class="row no-enter" style="flex-wrap:nowrap;margin-bottom:var(--s2)"><input id="qn" placeholder="Write a note and press Enter…" aria-label="Quick note" style="flex:1" data-native><button class="btn primary" id="qnb">Add</button></div>
        <div style="max-height:calc(100vh - 260px);overflow:auto;padding-right:4px">${timelineHtml(acts)}</div></section>
    </div>`;
    wire(d);
  };
  const done = () => load();
  const wire = (d) => {
    const l = d.lead;
    wireStage(root, l, done);
    $('#rat').onchange = async (e) => { try { await patch('/leads/' + id, { rating: e.target.value }); toast('Priority updated', 'ok'); done(); } catch (err) { toast(err.message, 'err'); } };
    const addNote = async () => { const v = $('#qn').value.trim(); if (!v) return; try { await post(`/leads/${id}/notes`, { content: v }); toast('Note added', 'ok'); done(); } catch (e) { toast(e.message, 'err'); } };
    $('#qnb').onclick = addNote; $('#qn').onkeydown = (e) => { if (e.key === 'Enter') addNote(); };
    const menu = (e) => openMenu(e.currentTarget, moreItems(l, done, () => nav('#/leads')));
    $('#more')?.addEventListener('click', menu); $('#more3')?.addEventListener('click', menu);
  };
  const act = async (fn) => { try { await fn(); await load(); } catch (e) { toast(e.message, 'err'); } };
  on(root, 'click', '[data-tl]', (b) => { tlFilter = b.dataset.tl; load(); });
  on(root, 'click', '[data-href]', (el) => nav(el.dataset.href));
  on(root, 'click', '[data-rel]', (b) => act(() => post(`/plots/${b.dataset.rel}/release`)));
  on(root, 'change', '[data-tdone]', (b) => act(async () => { await post(`/tasks/${b.dataset.tdone}/complete`); toast('Follow-up marked done', 'ok'); }));
  on(root, 'click', '[data-vway]', (b) => act(async () => { await post(`/visits/${b.dataset.vway}/on-the-way`); toast('Marked: client is on the way', 'ok'); }));
  on(root, 'click', '[data-vdone]', (b) => visitCompleteModal(b.dataset.vdone, load));
  on(root, 'click', '[data-kv]', (b) => act(async () => { await post(`/kyc/${b.dataset.kv}/review`, { status: 'verified' }); toast('Document verified', 'ok'); }));
  on(root, 'click', '[data-kr]', async (b) => { const r = await askText('Reject document', 'Reason (the client will see this)'); if (r) act(() => post(`/kyc/${b.dataset.kr}/review`, { status: 'rejected', remark: r })); });
  on(root, 'click', '[data-fix]', (b) => callModal(cur.lead, load, Number(b.dataset.fix)));
  on(root, 'click', '[data-act]', async (b) => {
    const a = b.dataset.act, l = cur.lead;
    if (a === 'genuine' || a === 'spam') return act(() => post(`/leads/${id}/flag-decision`, { decision: a }));
    if (a === 'dupok') return act(() => post(`/leads/${id}/duplicate-review`));
    if (a === 'edit') return leadForm(l, load);
    if (a === 'note') { const t = await askText('Add a note', 'Note', { submit: 'Save note' }); if (t) act(async () => { await post(`/leads/${id}/notes`, { content: t }); toast('Note added', 'ok'); }); return; }
    if (a === 'task') return taskModal(l, load);
    if (a === 'visit') return visitModal(l, load);
    if (a === 'hold') return holdModal(l, load);
    if (a === 'book') return bookingWizard({ lead: l, onDone: load });
    if (a === 'kyc') return kycUpload(l, load);
  });
  await load();
}

// ---------- detail modals ----------
// One tap for the result of the call, then the next follow-up in the same step.
const CALL_RESULTS = [
  { k: 'interested', label: 'Interested', icon: 'check', outcome: 'Connected', follow: 24, note: 'Interested' },
  { k: 'later', label: 'Call back later', icon: 'clock', outcome: 'Connected', follow: 4, note: 'Asked to call back later' },
  { k: 'noanswer', label: 'No answer', icon: 'phone', outcome: 'Not Answered', follow: 3 },
  { k: 'notint', label: 'Not interested', icon: 'x', outcome: 'Connected', follow: 0, note: 'Not interested', lost: true },
  { k: 'wrong', label: 'Wrong number', icon: 'alert', outcome: 'Wrong Number', follow: 0 },
];
export function callModal(l, done, activityId) {
  let res = null;
  const nextMorning = (days) => { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(10, 0, 0, 0); return d; };
  modalForm({ title: `${activityId ? 'Call result' : 'Log call'} — ${l.name}`, submit: 'Save', body: `${activityId ? '<p class="muted">Your phone did not report this call. Fill in what happened.</p>' : ''}
    <div class="fsec first">How did it go?</div><div class="chips" id="cres">${CALL_RESULTS.map((r) => `<button type="button" class="chip-btn" data-r="${r.k}">${ico(r.icon, 'sm')}${r.label}</button>`).join('')}</div>
    <div id="lostw" class="hidden">${fld('Lost reason <span class="req">*</span>', sel('lost_reason', [['', 'Choose a reason…'], ...S.meta.lost_reasons]), 'The lead will be marked Lost')}</div>
    <div class="frm-g" style="margin-top:var(--s3)">${fld('Direction', sel('direction', [['outgoing', 'Outgoing'], ['incoming', 'Incoming']]))}${fld('Status', sel('outcome', [['Connected', 'Completed'], ['Not Answered', 'No Answer'], 'Busy', 'Rejected', 'Failed', 'Switched Off', 'Wrong Number', 'Voicemail', 'Missed']))}
    ${fld('Duration (min)', inp('duration_min', '', 'type="number" min="0" placeholder="0"'))}${fld('Seconds', inp('duration_sec', '', 'type="number" min="0" max="59" placeholder="0"'))}
    ${fld('Notes', '<textarea name="notes" placeholder="What was discussed?"></textarea>', '', 'full')}
    ${fld('Next follow-up', inp('follow_at', '', 'type="datetime-local"'), 'Leave empty if no follow-up is needed', 'full')}</div>
    <div class="chips" id="cfu"><span class="muted small">Quick:</span><button type="button" class="chip-btn" data-h="2">In 2 hours</button><button type="button" class="chip-btn" data-d="1">Tomorrow 10 am</button><button type="button" class="chip-btn" data-d="3">In 3 days</button><button type="button" class="chip-btn" data-d="7">Next week</button></div>`,
    onOpen: (el) => {
      const set = (d) => { $('[name=follow_at]', el).value = d ? dtLocal(d.toISOString()) : ''; };
      on(el, 'click', '[data-r]', (b) => {
        const r = CALL_RESULTS.find((x) => x.k === b.dataset.r);
        $$('[data-r]', el).forEach((x) => x.classList.toggle('on', x === b));
        $('[name=outcome]', el).value = r.outcome;
        const notes = $('[name=notes]', el); if (r.note && !notes.value) notes.value = r.note;
        set(r.follow ? new Date(Date.now() + r.follow * 3600e3) : null);
        $('#lostw', el).classList.toggle('hidden', !r.lost);
        res = r.k;
      });
      on(el, 'click', '[data-h]', (b) => set(new Date(Date.now() + Number(b.dataset.h) * 3600e3)));
      on(el, 'click', '[data-d]', (b) => set(nextMorning(Number(b.dataset.d))));
    },
    onSubmit: async (d) => {
      const quick = res ? CALL_RESULTS.find((x) => x.k === res) : null;
      if (quick?.lost && !d.lost_reason) throw new Error('Choose why the lead is lost');
      // a quick result says the call connected even without a stopwatch reading: record it as at least a few seconds
      const dur = (Number(d.duration_min) || 0) * 60 + (Number(d.duration_sec) || 0);
      const body = { ...d, activity_id: activityId };
      if (d.outcome === 'Connected' && !dur) { body.duration_min = 0; body.duration_sec = 30; }
      await post(`/leads/${l.id}/calls`, body);
      if (d.follow_at) await post('/tasks', { lead_id: l.id, title: `Follow up: ${l.name}`, due_at: fromDT(d.follow_at), description: d.notes || undefined });
      if (quick?.lost) await post(`/leads/${l.id}/stage`, { stage: 'Lost', lost_reason: d.lost_reason });
      toast(d.follow_at ? 'Call saved and follow-up scheduled' : 'Call saved', 'ok'); done && done();
    } });
}
export async function waModal(l, done) {
  const tpls = S.meta.templates;
  const m = modalForm({ title: `WhatsApp — ${l.name}`, wide: true, submit: 'Open WhatsApp & log', body: `${fld('Template', sel('tpl', [['', 'Choose a template…'], ...[...tpls].sort((a, b) => (b.stage === l.stage) - (a.stage === l.stage)).map((t) => [t.id, t.name + (t.stage === l.stage ? ' · suggested for ' + l.stage : '')])]), '<a href="#/comms?tab=templates" data-close>＋ Add or manage templates</a>')}${fld('Message', '<textarea name="content" style="min-height:120px" placeholder="Type or pick a template"></textarea>')}${fld('Direction', sel('direction', [['outgoing', 'I am sending this'], ['incoming', 'Customer sent me this (just log)']]))}`,
    onOpen: (el) => { const pick = async (v) => { if (!v) return; const r = await post('/templates/render', { template_id: Number(v), lead_id: l.id }); $('[name=content]', el).value = r.text; }; $('[name=tpl]', el).onchange = (e) => pick(e.target.value); const sug = tpls.find((t) => t.stage === l.stage); if (sug) { $('[name=tpl]', el).value = sug.id; pick(sug.id); } },
    onSubmit: async (d) => { if (!d.content.trim()) throw new Error('Write a message first'); await post(`/leads/${l.id}/whatsapp`, { direction: d.direction, content: d.content }); if (d.direction === 'outgoing') window.open(waLink(l.phone_norm, d.content), '_blank'); toast('WhatsApp message logged', 'ok'); done && done(); } });
  return m;
}
export function taskModal(l, done) {
  modalForm({ title: 'New follow-up task', submit: 'Create task', body: `<div class="frm-g">${fld('Title', inp('title', l ? `Follow up: ${l.name}` : '', 'required'), '', 'full')}${fld('Due', inp('due_at', dtLocal(new Date(Date.now() + 3600e3 * 4)), 'type="datetime-local"'))}${fld('Priority', sel('priority', ['High', 'Medium', 'Low'], 'Medium'))}
    ${isAdmin() ? fld('Assign to', sel('assigned_to', repOptions('Lead owner / me').map((x) => x), l?.assigned_to || '')) : ''}${fld('Description', '<textarea name="description"></textarea>', '', 'full')}</div>`,
    onSubmit: async (d) => { await post('/tasks', { ...d, lead_id: l?.id, due_at: fromDT(d.due_at), assigned_to: d.assigned_to ? Number(d.assigned_to) : undefined }); toast('Task created', 'ok'); done && done(); } });
}
export async function visitModal(l, done, presetPlot) {
  const projects = S.meta.projects.filter((p) => p.status === 'active');
  if (!projects.length) return modal({ title: 'No projects yet', body: `<p>Add a project (layout) before scheduling site visits.</p>${isAdmin() ? '<a class="btn primary" href="#/inventory" data-close>Go to Inventory</a>' : '<p class="muted">Ask your admin to add a project.</p>'}` });
  const m = modalForm({ title: `Schedule site visit — ${l.name}`, submit: 'Schedule visit', body: `<div class="frm-g">${fld('Project', sel('project_id', projects.map((p) => [p.id, p.name]), l.pref_project_id || projects[0].id))}${fld('Specific plot (optional)', '<select name="plot_id"><option value="">Show all available</option></select>')}
    ${fld('Date & time', inp('scheduled_at', dtLocal(new Date(Date.now() + 86400e3)), 'type="datetime-local"'))}${isAdmin() ? fld('Rep', sel('assigned_to', repOptions('Lead owner'), l.assigned_to || '')) : ''}
    ${fld('Pickup needed', '<label><input type="checkbox" name="pickup_required"> Arrange vehicle pickup</label>')}${fld('Pickup address', inp('pickup_address'))}</div>`,
    onOpen: (el) => { const p = $('[name=project_id]', el), pl = $('[name=plot_id]', el); const fill = async () => { const rows = await get('/plots?status=available&project_id=' + p.value); pl.innerHTML = '<option value="">Show all available</option>' + rows.map((x) => `<option value="${x.id}">${esc(x.plot_no)} · ${x.area_sqyd} sq.yd${x.facing ? ' · ' + esc(x.facing) : ''}</option>`).join(''); }; p.onchange = fill; fill(); },
    onSubmit: async (d) => { await post('/visits', { ...d, lead_id: l.id, scheduled_at: fromDT(d.scheduled_at), plot_id: d.plot_id || undefined, assigned_to: d.assigned_to ? Number(d.assigned_to) : undefined }); toast('Site visit scheduled', 'ok'); done && done(); } });
}
function holdModal(l, done) {
  const projects = S.meta.projects.filter((p) => p.status === 'active');
  if (!projects.length) return toast('No projects available', 'err');
  modalForm({ title: `Hold a plot for ${l.name}`, submit: 'Hold plot', body: `<p class="muted">A held plot cannot be booked by anyone else until the hold expires.</p>${fld('Project', sel('project_id', projects.map((p) => [p.id, p.name]), l.pref_project_id || projects[0].id))}${fld('Plot', '<select name="plot_id"></select>')}${fld('Hold for (hours)', inp('hours', S.settings.hold_hours_default || 48, 'type="number" min="1"'))}`,
    onOpen: (el) => { const p = $('[name=project_id]', el), pl = $('[name=plot_id]', el); const fill = async () => { const rows = await get('/plots?status=available&project_id=' + p.value); pl.innerHTML = rows.length ? rows.map((x) => `<option value="${x.id}">${esc(x.plot_no)} · ${x.area_sqyd} sq.yd · ${inrShort(x.price)}</option>`).join('') : '<option value="">No available plots</option>'; }; p.onchange = fill; fill(); },
    onSubmit: async (d) => { if (!d.plot_id) throw new Error('Choose a plot'); await post(`/plots/${d.plot_id}/hold`, { lead_id: l.id, hours: Number(d.hours) }); toast('Plot on hold', 'ok'); done && done(); } });
}
async function assignModal(l, done) {
  const rec = await get(`/leads/${l.id}/recommend-rep`).catch(() => null);
  await repLoads(true);
  modalForm({ title: `Assign ${l.name}`, submit: 'Assign', body: fld('Team member', sel('rep_id', loadOptions('Unassigned'), l.assigned_to || '')) + (rec ? `<div class="info-box"><b>RealPilot suggests ${esc(rec.recommended.name)}</b> — ${rec.recommended.open} open leads, ${rec.recommended.conversion}% recent conversion.</div>${rec.ranking.map((r) => `<div class="list-row small"><span>${esc(r.name)}</span><span class="muted">${r.open} open · ${r.conversion}% conv.</span></div>`).join('')}` : ''),
    onSubmit: async (d) => { await post(`/leads/${l.id}/assign`, { rep_id: d.rep_id ? Number(d.rep_id) : null }); toast('Lead assigned', 'ok'); done && done(); } });
}
function kycUpload(l, done) {
  modalForm({ title: 'Upload KYC document', submit: 'Upload', body: `${fld('Document type', sel('doc_type', ['Aadhaar Card', 'PAN Card', 'Passport Photo', 'Address Proof', 'Bank Statement', 'Other']))}${fld('File (PDF, JPG or PNG, max 6 MB)', '<input type="file" id="kf" accept=".pdf,.jpg,.jpeg,.png,image/*,application/pdf">')}`,
    onSubmit: async (d) => { const f = $('#kf').files[0]; if (!f) throw new Error('Choose a file'); const b64 = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result.split(',')[1]); fr.readAsDataURL(f); }); await post(`/leads/${l.id}/kyc`, { doc_type: d.doc_type, filename: f.name, data_base64: b64 }); toast('Document uploaded', 'ok'); done && done(); } });
}
