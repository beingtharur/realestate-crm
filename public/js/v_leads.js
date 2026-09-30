// Leads: list (kanban/table), add/edit, import, detail page with timeline and actions.
import { S, $, $$, esc, get, post, patch, del, api, on, modal, modalForm, confirmDialog, askText, toast, fld, inp, sel, repOptions, projectOptions, getForm, inr, inrShort, rel, fmtDT, fmtDate, fmtTime,
  isAdmin, empty, badge, stageBadge, ratingBadge, phoneFmt, waLink, nav, reload, userName, dtLocal, fromDT, copy, fullLink, authUrl, debounce, spinner, STAGE_CLS } from './core.js';
import { bookingWizard } from './v_bookings.js';

const STAGES = () => S.meta.stages;
const view = () => localStorage.getItem('rp_leadview') || 'kanban';
let F = { q: '', assigned: '', rating: '', source: '', stage: '', project_id: '' };

// ================= add / edit =================
export function leadForm(lead, onDone, preset = {}) {
  const edit = !!lead, l = lead || preset, cf = S.meta.custom_fields, cv = l.custom || {};
  const body = `<div class="frm-g">
    ${fld('Name <span class="req">*</span>', inp('name', l.name || '', 'required'))}${fld('Mobile <span class="req">*</span>', inp('phone', l.phone_norm || l.phone || '', 'required inputmode="tel" placeholder="98765 43210"'), 'Indian mobile, +91 optional')}
    ${fld('Email', inp('email', l.email || '', 'type="email"'))}${fld('Source', sel('source', S.meta.sources, l.source || 'Walk-in'))}
    ${!edit && isAdmin() ? fld('Assign to', sel('assigned_to', repOptions('Auto (by rules)'), '')) : ''}
    ${fld('Channel partner / broker', sel('partner_id', [['', 'None (direct)'], ...S.meta.partners.filter((p) => p.active).map((p) => [p.id, p.name])], l.partner_id || ''))}
    ${fld('Budget from (₹)', inp('budget_min', l.budget_min ?? '', 'type="number" min="0"'))}${fld('Budget up to (₹)', inp('budget_max', l.budget_max ?? '', 'type="number" min="0"'))}
    ${fld('Plot size from (sq.yd)', inp('pref_size_min', l.pref_size_min ?? '', 'type="number" min="0"'))}${fld('Plot size up to (sq.yd)', inp('pref_size_max', l.pref_size_max ?? '', 'type="number" min="0"'))}
    ${fld('Preferred facing', sel('pref_facing', [['', 'Any'], 'East', 'West', 'North', 'South', 'North-East', 'North-West', 'South-East', 'South-West'], l.pref_facing || ''))}${fld('Preferred project', sel('pref_project_id', projectOptions(), l.pref_project_id || ''))}
    ${fld('Preferred location / area', inp('pref_location', l.pref_location || ''))}${fld('Buying purpose', sel('purpose', [['', '—'], 'Investment', 'Self-use / build home', 'Both'], l.purpose || ''))}
    ${cf.map((f) => fld(esc(f.label) + (f.required ? ' <span class="req">*</span>' : ''),
      f.type === 'dropdown' ? sel('cf_' + f.id, [['', '—'], ...f.options], cv[f.id] ?? '') : f.type === 'checkbox' ? `<input type="checkbox" name="cf_${f.id}" ${cv[f.id] ? 'checked' : ''}>` : inp('cf_' + f.id, cv[f.id] ?? '', `type="${f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}"`))).join('')}
    ${fld('Notes', `<textarea name="notes">${esc(l.notes || '')}</textarea>`, '', 'full')}</div>`;
  const submit = async (d, m, force = false) => {
    const custom = {};
    cf.forEach((f) => { custom[f.id] = f.type === 'checkbox' ? d['cf_' + f.id] : d['cf_' + f.id]; });
    const payload = { ...d, custom, force };
    Object.keys(payload).filter((k) => k.startsWith('cf_')).forEach((k) => delete payload[k]);
    try {
      if (edit) await patch('/leads/' + lead.id, payload); else await post('/leads', payload);
      toast(edit ? 'Lead updated' : 'Lead added', 'ok'); onDone && onDone();
    } catch (e) {
      if (e.status === 409 && e.data.duplicates) {
        const dups = e.data.duplicates;
        const go = await new Promise((res) => {
          const dm = modal({ title: 'Possible duplicate found', body: `<div class="warn-box">A lead with the same phone or email already exists in your organization.</div>
            ${dups.map((x) => `<div class="list-row"><div><b>${esc(x.name)}</b> <span class="muted small">${phoneFmt(x.phone)}</span><div class="small">${stageBadge(x.stage)} · Rep: ${esc(x.rep_name || 'Unassigned')}</div></div>${x.mine !== false && (isAdmin() || x.assigned_to === S.user.id) ? `<a href="#/leads/${x.id}" data-close>Open</a>` : ''}</div>`).join('')}`,
            footer: `<button class="btn" id="dc">Cancel</button><button class="btn primary" id="da">Create anyway</button>` });
          $('#dc', dm.el).onclick = () => { dm.close(); res(false); }; $('#da', dm.el).onclick = () => { dm.close(); res(true); };
          dm.el.addEventListener('click', (ev) => { if (ev.target.closest('[data-close]') && !ev.target.closest('#dc,#da')) res(false); });
        });
        if (go) return submit(d, m, true);
        return false;
      }
      throw e;
    }
  };
  modalForm({ title: edit ? 'Edit lead' : 'Add lead', wide: true, submit: edit ? 'Save changes' : 'Add lead', body, onSubmit: (d, m) => submit(d, m) });
}

// ================= list =================
export async function list(root, _p, q) {
  const admin = isAdmin();
  let tab = q.tab || 'all', sel_ = new Set(), saved = await get('/filters');
  const draw = async () => {
    const params = new URLSearchParams();
    Object.entries(F).forEach(([k, v]) => v && params.set(k, v));
    if (tab === 'unassigned') params.set('assigned', 'unassigned'); if (tab === 'flagged') params.set('flag', 'pending'); if (tab === 'duplicates') params.set('dup', 'reported');
    const rows = await get('/leads?' + params);
    const v = view();
    const stages = STAGES();
    const chips = saved.map((s) => `<span class="chip ${JSON.stringify(s.filters) === JSON.stringify(F) ? 'on' : ''}" data-sf="${s.id}">${esc(s.name)}<button class="x" data-sfd="${s.id}" title="Delete filter">×</button></span>`).join('');
    const mini = (l) => `<div class="kcard" draggable="true" data-id="${l.id}"><div class="n">${esc(l.name)}</div><div class="m">${phoneFmt(l.phone_norm)}</div>
      <div class="m row gap-s" style="margin-top:4px">${ratingBadge(l.rating)}<span>· ${l.score}</span>${l.budget_max ? `<span>· ${inrShort(l.budget_max)}</span>` : ''}</div>
      ${l.project_name ? `<div class="m">📍 ${esc(l.project_name)}</div>` : ''}<div class="m">${admin ? '👤 ' + esc(l.rep_name || 'Unassigned') : esc(l.source || '')}${l.next_due ? ` · <span style="color:var(--${Date.parse(l.next_due) < Date.now() ? 'red' : 'muted'})">⏰ ${rel(l.next_due)}</span>` : ''}</div>
      ${l.flag_status === 'pending' ? '<div class="m" style="color:var(--red)">⚠ suspicious</div>' : ''}${admin ? `<button class="del" data-del="${l.id}" title="Delete lead">🗑</button>` : ''}</div>`;
    let content;
    if (tab === 'flagged') {
      content = rows.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Lead</th><th>Reason flagged</th><th>Status</th><th>Created</th><th></th></tr></thead><tbody>${rows.map((l) => `<tr><td><a href="#/leads/${l.id}"><b>${esc(l.name)}</b></a><div class="muted small">${phoneFmt(l.phone_norm)} · ${esc(l.source || '')}</div></td><td>${esc(l.flag_reason)}</td><td>${badge(l.flag_status === 'spam' ? 'Spam (blacklisted)' : 'Needs review', l.flag_status === 'spam' ? 'b-red' : 'b-amber')}</td><td class="small">${rel(l.created_at)}</td>
        <td class="right nowrap">${l.flag_status === 'pending' ? `<button class="btn sm" data-flag="genuine" data-id="${l.id}">✓ Genuine</button> <button class="btn sm danger" data-flag="spam" data-id="${l.id}">Spam</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : empty('No suspicious leads', 'Leads with repeated enquiries for the same number are flagged here.');
    } else if (tab === 'duplicates') {
      content = rows.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Lead</th><th>Reported by</th><th>Note</th><th></th></tr></thead><tbody>${rows.map((l) => `<tr><td><a href="#/leads/${l.id}"><b>${esc(l.name)}</b></a><div class="muted small">${phoneFmt(l.phone_norm)} · ${esc(l.rep_name || '')}</div></td><td>${esc(userName(l.dup_reported_by))}</td><td>${esc(l.dup_note || '')}</td>
        <td class="right nowrap"><button class="btn sm" data-dupok="${l.id}">Not a duplicate</button> <button class="btn sm danger" data-del="${l.id}">Delete lead</button></td></tr>`).join('')}</tbody></table></div>` : empty('No duplicate reports', 'When reps report a duplicate it shows up here.');
    } else if (v === 'kanban') {
      content = `<div class="kanban">${stages.map((s) => { const c = rows.filter((l) => l.stage === s); return `<div class="kcol" data-stage="${s}"><h4><span>${stageBadge(s)}</span><span class="muted">${c.length}</span></h4><div class="cards">${c.slice(0, 60).map(mini).join('')}${c.length > 60 ? `<div class="muted small center">+${c.length - 60} more — use search or table view</div>` : ''}</div></div>`; }).join('')}</div>`;
    } else {
      content = rows.length ? `${admin && sel_.size ? `<div class="row mb"><b>${sel_.size} selected</b><button class="btn sm" id="bAssign">Assign to…</button><button class="btn sm danger" id="bDel">Delete</button></div>` : ''}
        <div class="tbl-wrap"><table class="tbl"><thead><tr>${admin ? '<th style="width:30px"><input type="checkbox" id="selall"></th>' : ''}<th>Name</th><th>Stage</th><th>Rating</th><th class="r">Score</th><th>Source</th><th class="r">Budget</th><th>Project</th>${admin ? '<th>Rep</th>' : ''}<th>Next follow-up</th><th>Updated</th></tr></thead><tbody>
        ${rows.map((l) => `<tr class="click" data-id="${l.id}">${admin ? `<td><input type="checkbox" data-sel="${l.id}" ${sel_.has(l.id) ? 'checked' : ''}></td>` : ''}<td><b>${esc(l.name)}</b><div class="muted small">${phoneFmt(l.phone_norm)}</div></td><td>${stageBadge(l.stage)}</td><td>${ratingBadge(l.rating)}</td><td class="r">${l.score}</td><td>${esc(l.source || '')}</td><td class="r">${l.budget_max ? inrShort(l.budget_max) : '—'}</td><td>${esc(l.project_name || '—')}</td>${admin ? `<td>${esc(l.rep_name || 'Unassigned')}</td>` : ''}<td class="small" style="color:var(--${l.next_due && Date.parse(l.next_due) < Date.now() ? 'red' : 'muted'})">${l.next_due ? rel(l.next_due) : '—'}</td><td class="small muted">${rel(l.updated_at)}</td></tr>`).join('')}</tbody></table></div>` : empty('No leads match', 'Try clearing the filters, or add a lead.');
    }
    $('#lbody').innerHTML = content;
    $('#lcount').textContent = `${rows.length} lead${rows.length === 1 ? '' : 's'}`;
    $('#chips').innerHTML = chips;
    wireBody(rows);
  };
  let curRows = [];
  const wireBody = (rows) => {
    curRows = rows;
    const body = $('#lbody');
    $$('.kcard', body).forEach((c) => {
      c.addEventListener('click', (e) => { if (!e.target.closest('.del')) nav('#/leads/' + c.dataset.id); });
      c.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', c.dataset.id); });
    });
    $$('.kcol', body).forEach((col) => {
      col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('over'); });
      col.addEventListener('dragleave', () => col.classList.remove('over'));
      col.addEventListener('drop', async (e) => {
        e.preventDefault(); col.classList.remove('over');
        const id = Number(e.dataTransfer.getData('text/plain')), stage = col.dataset.stage, lead = rows.find((x) => x.id === id);
        if (!lead || lead.stage === stage) return;
        if (stage === 'Booked') return toast('Open the lead and use "Book plot" — that creates the booking and marks it Booked.', 'err');
        if (stage === 'Lost') return lostModal(lead, draw);
        try { await post(`/leads/${id}/stage`, { stage }); toast(`Moved to ${stage}`, 'ok'); draw(); } catch (err) { toast(err.message, 'err'); }
      });
    });
    const all = $('#selall', body); if (all) all.onchange = () => { rows.forEach((l) => (all.checked ? sel_.add(l.id) : sel_.delete(l.id))); draw(); };
    const bd = $('#bDel', body); if (bd) bd.onclick = () => deleteLeads([...sel_], () => { sel_.clear(); draw(); });
    const ba = $('#bAssign', body); if (ba) ba.onclick = () => modalForm({ title: `Assign ${sel_.size} lead(s)`, submit: 'Assign', body: fld('Team member', sel('rep_id', repOptions('Choose…').slice(1))),
      onSubmit: async (d) => { const r = await post('/leads/bulk-assign', { ids: [...sel_], rep_id: Number(d.rep_id) }); toast(`${r.assigned} lead(s) assigned`, 'ok'); sel_.clear(); draw(); } });
  };
  const initBody = () => {
    const body = $('#lbody');
    on(body, 'click', 'tr.click', (tr, e) => { if (!e.target.closest('input')) nav('#/leads/' + tr.dataset.id); });
    on(body, 'click', '[data-del]', async (b, e) => { e.stopPropagation(); await deleteLeads([Number(b.dataset.del)], draw); });
    on(body, 'click', '[data-flag]', async (b) => { try { await post(`/leads/${b.dataset.id}/flag-decision`, { decision: b.dataset.flag }); toast('Updated', 'ok'); draw(); } catch (err) { toast(err.message, 'err'); } });
    on(body, 'click', '[data-dupok]', async (b) => { await post(`/leads/${b.dataset.dupok}/duplicate-review`); toast('Marked as reviewed', 'ok'); draw(); });
    on(body, 'change', '[data-sel]', (cb) => { const id = Number(cb.dataset.sel); cb.checked ? sel_.add(id) : sel_.delete(id); draw(); });
  };
  const tabs = admin ? [['all', 'All leads'], ['unassigned', 'Unassigned'], ['flagged', 'Suspicious'], ['duplicates', 'Duplicate reports']] : [['all', 'My leads']];
  root.innerHTML = `<div class="ph1"><div><h1>Leads</h1><p id="lcount"></p></div><div class="row">
      ${tab !== 'flagged' && tab !== 'duplicates' ? `<div class="seg" id="vw"><button data-v="kanban" class="${view() === 'kanban' ? 'on' : ''}">Kanban</button><button data-v="table" class="${view() === 'table' ? 'on' : ''}">Table</button></div>` : ''}
      ${admin ? '<button class="btn" id="imp">⬆ Import CSV / Excel</button><a class="btn" href="' + authUrl('/export/leads') + '">⬇ Export</a>' : ''}<button class="btn primary" id="add">＋ Add lead</button></div></div>
    ${tabs.length > 1 ? `<div class="tabs" id="tabs">${tabs.map(([k, l]) => `<button data-tab="${k}" class="${k === tab ? 'on' : ''}">${l}</button>`).join('')}</div>` : ''}
    <div class="filters"><input type="search" id="fq" placeholder="Search name, phone, email…" value="${esc(F.q)}">
      ${admin ? sel('assigned', repOptions('All reps'), F.assigned, 'id="fa"') : ''}${sel('rating', [['', 'Any rating'], 'Hot', 'Warm', 'Cold'], F.rating, 'id="fr"')}${sel('source', [['', 'Any source'], ...S.meta.sources], F.source, 'id="fs"')}
      ${sel('stage', [['', 'Any stage'], ...STAGES()], F.stage, 'id="fst"')}${sel('project_id', projectOptions('Any project'), F.project_id, 'id="fp"')}
      <button class="btn sm" id="fsave">💾 Save filter</button><button class="btn sm ghost" id="fclear">Clear</button></div>
    <div class="row mb" id="chips"></div><div id="lbody">${spinner()}</div>`;
  const setF = (k) => (e) => { F[k] = e.target.value; draw(); };
  $('#fq').oninput = debounce((e) => { F.q = e.target.value; draw(); }, 300);
  [['fa', 'assigned'], ['fr', 'rating'], ['fs', 'source'], ['fst', 'stage'], ['fp', 'project_id']].forEach(([id, k]) => { const el = $('#' + id); if (el) el.onchange = setF(k); });
  $('#fclear').onclick = () => { F = { q: '', assigned: '', rating: '', source: '', stage: '', project_id: '' }; reload(); };
  $('#fsave').onclick = () => modalForm({ title: 'Save current filter', submit: 'Save', body: fld('Filter name', inp('name', '', 'placeholder="e.g. Hot leads – Green Valley"')),
    onSubmit: async (d) => { await post('/filters', { name: d.name, filters: F }); saved = await get('/filters'); draw(); toast('Filter saved', 'ok'); } });
  on(root, 'click', '[data-sf]', (chip, e) => { if (e.target.closest('[data-sfd]')) return; F = { q: '', assigned: '', rating: '', source: '', stage: '', project_id: '', ...saved.find((s) => s.id == chip.dataset.sf).filters }; reload(); });
  on(root, 'click', '[data-sfd]', async (b) => { await del('/filters/' + b.dataset.sfd); saved = await get('/filters'); draw(); });
  on(root, 'click', '#vw [data-v]', (b) => { localStorage.setItem('rp_leadview', b.dataset.v); reload(); });
  on(root, 'click', '#tabs [data-tab]', (b) => nav('#/leads?tab=' + b.dataset.tab));
  initBody();
  $('#add').onclick = () => leadForm(null, draw);
  if ($('#imp')) $('#imp').onclick = () => importModal(draw);
  await draw();
}

async function deleteLeads(ids, done) {
  const ok = await confirmDialog(`Permanently delete <b>${ids.length}</b> lead${ids.length > 1 ? 's' : ''}?<br><br>All call logs, WhatsApp history, tasks, site visits and documents of ${ids.length > 1 ? 'these leads' : 'this lead'} will also be removed. This cannot be undone. (Leads that have bookings cannot be deleted.)`, { ok: 'Delete', danger: true });
  if (!ok) return;
  try { const r = await post('/leads/bulk-delete', { ids }); toast(`${r.deleted} deleted${r.blocked.length ? `, ${r.blocked.length} kept (have bookings)` : ''}`, r.blocked.length ? '' : 'ok'); done && done(); } catch (e) { toast(e.message, 'err'); }
}
function lostModal(lead, done) {
  modalForm({ title: `Mark "${lead.name}" as Lost`, submit: 'Mark as lost', danger: true, body: fld('Reason <span class="req">*</span>', sel('lost_reason', [['', 'Choose a reason…'], ...S.meta.lost_reasons])) + fld('Note (optional)', '<textarea name="lost_note"></textarea>'),
    onSubmit: async (d) => { if (!d.lost_reason) throw new Error('Choose a reason'); await post(`/leads/${lead.id}/stage`, { stage: 'Lost', ...d }); toast('Lead marked as lost'); done && done(); } });
}

// ================= import =================
function importModal(done) {
  let parsed = null, file = null, tabSel = 'all';
  const m = modal({ title: 'Import leads', xl: true, body: `<div id="imp1">
      <p class="muted">Upload a <b>.csv</b> or <b>.xlsx</b> file. Needs <code>name</code> and <code>phone</code> columns; optional: email, source, budget, size, facing, location, project, purpose, notes, rep (email or name) and your custom field labels.</p>
      <div class="frm-g">${fld('Default lead source', sel('def', S.meta.sources, 'Other'))}${fld('File', '<input type="file" id="ifile" accept=".csv,.xlsx,text/csv">')}</div>
      <a href="data:text/csv;charset=utf-8,${encodeURIComponent('name,phone,email,source,budget,size,facing,location,project,purpose,notes\nRamesh Kumar,9876543210,ramesh@example.com,Facebook Ads,3500000,200,East,Shadnagar,,Investment,Called from ad\n')}" download="leads_template.csv">⬇ Download template</a><div id="ierr" class="mt"></div></div>
      <div id="imp2" class="hidden"></div>` });
  const readFile = (f) => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result.split(',')[1]); fr.onerror = rej; fr.readAsDataURL(f); });
  $('#ifile', m.el).onchange = async (e) => {
    file = e.target.files[0]; if (!file) return; $('#ierr', m.el).innerHTML = '<div class="muted">Reading file…</div>';
    try { parsed = await post('/leads/import/preview', { file_base64: await readFile(file), filename: file.name, default_source: $('[name=def]', m.el).value }); $('#imp1', m.el).classList.add('hidden'); review(); }
    catch (err) { $('#ierr', m.el).innerHTML = `<div class="err">${esc(err.message)}</div>`; }
  };
  const review = () => {
    const p2 = $('#imp2', m.el); p2.classList.remove('hidden');
    const shown = parsed.rows.filter((r) => tabSel === 'all' || r.status === tabSel);
    p2.innerHTML = `<div class="grid g3 keep mb"><div class="card kpi"><div class="l">Total rows</div><div class="v">${parsed.total}</div></div><div class="card kpi"><div class="l">Ready to import</div><div class="v" style="color:var(--green)">${parsed.rows.filter((r) => r.status === 'valid').length}</div></div><div class="card kpi"><div class="l">Skipped / errors</div><div class="v" style="color:var(--red)">${parsed.rows.filter((r) => r.status === 'error').length}</div></div></div>
      <div class="tabs">${[['all', 'All'], ['valid', 'Valid'], ['error', 'Errors']].map(([k, l]) => `<button data-t="${k}" class="${tabSel === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div class="tbl-wrap" style="max-height:340px"><table class="tbl"><thead><tr><th>Row</th><th>Name</th><th>Phone</th><th>Source</th><th>Status</th></tr></thead><tbody>${shown.slice(0, 300).map((r) => `<tr><td>${r.row}</td><td>${esc(r.data.name)}</td><td>${esc(r.data.phone)}</td><td>${r.status === 'valid' ? sel('src', S.meta.sources, r.data.source, `data-row="${r.row}" style="padding:3px 6px"`) : esc(r.data.source)}</td><td>${r.status === 'valid' ? badge('Ready', 'b-green') : `<span style="color:var(--red)">${esc(r.errors.join('; '))}</span>`}</td></tr>`).join('')}</tbody></table></div>
      ${shown.length > 300 ? `<p class="muted small">Showing first 300 of ${shown.length}.</p>` : ''}
      <div class="row mt" style="justify-content:flex-end"><button class="btn" id="iback">← Choose another file</button><button class="btn primary" id="iok" ${parsed.rows.some((r) => r.status === 'valid') ? '' : 'disabled'}>Import ${parsed.rows.filter((r) => r.status === 'valid').length} lead(s)</button></div>`;
    $$('[data-t]', p2).forEach((b) => (b.onclick = () => { tabSel = b.dataset.t; review(); }));
    $$('[data-row]', p2).forEach((s) => (s.onchange = () => { parsed.rows.find((r) => r.row == s.dataset.row).data.source = s.value; }));
    $('#iback', p2).onclick = () => { p2.classList.add('hidden'); $('#imp1', m.el).classList.remove('hidden'); $('#ierr', m.el).innerHTML = ''; };
    $('#iok', p2).onclick = async (ev) => {
      ev.target.disabled = true;
      try {
        const r = await post('/leads/import/commit', { rows: parsed.rows.filter((x) => x.status === 'valid') });
        const skipped = [...parsed.rows.filter((x) => x.status === 'error').map((x) => ({ row: x.row, name: x.data.name, reason: x.errors.join('; ') })), ...r.skipped];
        p2.innerHTML = `<div class="ok-box"><b>${r.imported} lead(s) imported.</b> ${skipped.length} row(s) skipped.</div>${skipped.length ? `<div class="tbl-wrap" style="max-height:300px"><table class="tbl"><thead><tr><th>Row</th><th>Name</th><th>Reason skipped</th></tr></thead><tbody>${skipped.map((s) => `<tr><td>${s.row}</td><td>${esc(s.name || '')}</td><td>${esc(s.reason)}</td></tr>`).join('')}</tbody></table></div>` : ''}<div class="row mt" style="justify-content:flex-end"><button class="btn primary" data-close>Done</button></div>`;
        done && done();
      } catch (err) { toast(err.message, 'err'); ev.target.disabled = false; }
    };
  };
}

// ================= detail =================
const ICON = { call: '📞', whatsapp: '💬', note: '📝', task: '✅', stage: '🔁', visit: '🚗', booking: '📑', payment: '💰', assign: '👤', system: '⚙️' };
export async function detail(root, { id }) {
  let tlFilter = 'all', cur = null;
  const load = async () => {
    let d; try { d = await get('/leads/' + id); } catch (e) { root.innerHTML = `<a href="#/leads">← Leads</a>${empty('Lead not found', 'It may have been deleted or assigned to someone else.')}`; return; }
    cur = d;
    const l = d.lead, admin = isAdmin(), cf = S.meta.custom_fields;
    const open = !['Lost', 'Booked'].includes(l.stage);
    const kycBadge = { none: ['No documents', ''], pending: ['KYC pending review', 'b-amber'], partial: ['KYC incomplete', 'b-amber'], verified: ['KYC verified', 'b-green'], rejected: ['KYC rejected', 'b-red'] }[l.kyc_status || 'none'];
    const acts = d.timeline.filter((a) => tlFilter === 'all' || (tlFilter === 'call' && a.type === 'call') || (tlFilter === 'whatsapp' && a.type === 'whatsapp') || (tlFilter === 'note' && a.type === 'note') || (tlFilter === 'task' && a.type === 'task'));
    root.innerHTML = `<div class="mb"><a href="#/leads">← Leads</a></div>
    ${l.flag_status === 'pending' ? `<div class="warn-box">⚠ <b>Suspicious lead:</b> ${esc(l.flag_reason)}. ${admin ? `<button class="btn sm" data-a="genuine">Mark genuine</button> <button class="btn sm danger" data-a="spam">Mark spam</button>` : 'Admin will review.'}</div>` : ''}
    ${l.flag_status === 'spam' ? '<div class="err">This number is blacklisted as spam.</div>' : ''}
    ${l.dup_status === 'reported' ? `<div class="warn-box">Reported as duplicate by ${esc(userName(l.dup_reported_by))}${l.dup_note ? ': ' + esc(l.dup_note) : ''}. ${admin ? '<button class="btn sm" data-a="dupok">Not a duplicate</button>' : ''}</div>` : ''}
    ${d.duplicates.length ? `<div class="info-box">Other leads share this phone/email: ${d.duplicates.map((x) => admin ? `<a href="#/leads/${x.id}">${esc(x.name)}</a>` : esc(x.name)).join(', ')}</div>` : ''}
    <div class="ph1"><div><h1>${esc(l.name)} ${ratingBadge(l.rating)}</h1><p><a href="tel:+91${l.phone_norm}">${phoneFmt(l.phone_norm)}</a> ${l.email ? '· ' + esc(l.email) : ''} · Source: ${esc(l.source || '—')} · Score <b>${l.score}</b>/100 · Rep: <b>${esc(l.rep_name || 'Unassigned')}</b></p></div>
      <div class="row">${sel('stage', STAGES().map((s) => [s, s]), l.stage, `id="stg" ${l.stage === 'Booked' ? 'disabled' : ''} style="width:auto"`)}
      <select id="rat" style="width:auto"><option value="auto">Rating: auto</option>${['Hot', 'Warm', 'Cold'].map((r) => `<option ${l.rating_manual && l.rating === r ? 'selected' : ''}>${r}</option>`).join('')}</select></div></div>
    <div class="row mb">
      <a class="btn" href="tel:+91${l.phone_norm}">📞 Call</a><button class="btn" data-a="call">Log call</button><button class="btn" data-a="wa">💬 WhatsApp</button><button class="btn" data-a="note">📝 Note</button><button class="btn" data-a="task">✅ Task</button>
      ${open ? '<button class="btn" data-a="visit">🚗 Site visit</button><button class="btn" data-a="hold">🔒 Hold plot</button><button class="btn" data-a="discount">🏷️ Discount</button>' : ''}
      ${l.stage !== 'Lost' ? '<button class="btn primary" data-a="book">📑 Book plot</button>' : '<button class="btn" data-a="reopen">↩ Reopen</button>'}
      ${open ? '<button class="btn danger" data-a="lost">Mark lost</button>' : ''}
      ${admin ? '<button class="btn" data-a="assign">🔀 Assign</button>' : ''}<button class="btn" data-a="portal">🔗 Client portal link</button><button class="btn" data-a="ai">🤖 Ask RealPilot</button><button class="btn" data-a="edit">✏️ Edit</button>
      ${admin ? '<button class="btn danger" data-a="delete">🗑 Delete</button>' : '<button class="btn" data-a="dup">Report as duplicate</button>'}</div>
    <div class="grid g2 stack" style="grid-template-columns:minmax(0,5fr) minmax(0,6fr)">
      <div class="grid" style="align-content:start">
        <div class="card"><h3>Requirements</h3><dl class="kv"><dt>Budget</dt><dd>${l.budget_min || l.budget_max ? `${l.budget_min ? inr(l.budget_min) : ''}${l.budget_min && l.budget_max ? ' – ' : ''}${l.budget_max ? inr(l.budget_max) : ''}` : '—'}</dd>
          <dt>Plot size</dt><dd>${l.pref_size_min || l.pref_size_max ? `${l.pref_size_min || ''}${l.pref_size_min && l.pref_size_max && l.pref_size_min != l.pref_size_max ? ' – ' + l.pref_size_max : ''} sq.yd` : '—'}</dd><dt>Facing</dt><dd>${esc(l.pref_facing || '—')}</dd>
          <dt>Location</dt><dd>${esc(l.pref_location || '—')}</dd><dt>Project</dt><dd>${esc(l.project_name || '—')}</dd><dt>Purpose</dt><dd>${esc(l.purpose || '—')}</dd><dt>Partner</dt><dd>${esc(l.partner_name || 'Direct')}</dd>
          ${cf.map((f) => `<dt>${esc(f.label)}</dt><dd>${f.type === 'checkbox' ? (l.custom[f.id] ? 'Yes' : 'No') : esc(l.custom[f.id] ?? '—')}</dd>`).join('')}
          <dt>Notes</dt><dd>${esc(l.notes || '—')}</dd><dt>Created</dt><dd>${fmtDT(l.created_at)}</dd></dl>
          ${l.stage === 'Lost' ? `<div class="err mt"><b>Lost:</b> ${esc(l.lost_reason)}${l.lost_note ? ' — ' + esc(l.lost_note) : ''} <span class="small">(${fmtDate(l.lost_at)})</span></div>` : ''}</div>
        ${d.bookings.length ? `<div class="card"><h3>Bookings</h3>${d.bookings.map((b) => `<div class="list-row pcard" onclick="rpGo('#/bookings/${b.id}')"><div><b>${esc(b.booking_no)}</b> ${badge(b.status, b.status === 'cancelled' ? 'b-red' : b.status === 'registered' ? 'b-green' : 'b-blue')}<div class="small muted">${esc(b.project_name)} · Plot ${esc(b.plot_no)} · ${inr(b.total)}</div></div><div class="right small">Paid ${inr(b.paid)}<br><span style="color:var(--${b.overdue_amount ? 'red' : 'muted'})">${b.overdue_amount ? 'Overdue ' + inr(b.overdue_amount) : 'Due ' + inr(b.outstanding)}</span></div></div>`).join('')}</div>` : ''}
        ${d.holds.length ? `<div class="card"><h3>Plots on hold</h3>${d.holds.map((h) => `<div class="list-row"><div><b>Plot ${esc(h.plot_no)}</b> <span class="muted small">${esc(h.project_name)}</span><div class="small">until ${fmtDT(h.hold_until)}</div></div><button class="btn sm" data-rel="${h.id}">Release</button></div>`).join('')}</div>` : ''}
        <div class="card"><div class="card-h"><h3>Site visits</h3></div>${d.visits.length ? d.visits.map((v) => `<div class="list-row"><div><b>${esc(v.project_name)}</b>${v.plot_no ? ' · Plot ' + esc(v.plot_no) : ''}<div class="small muted">${fmtDT(v.scheduled_at)}${v.pickup_required ? ' · pickup' : ''}${v.feedback ? '<br>' + esc(v.feedback) : ''}</div></div><div class="row gap-s">${badge(v.status.replace('_', ' '), v.status === 'completed' ? 'b-green' : v.status === 'scheduled' ? 'b-amber' : '')}${v.status === 'scheduled' ? `<button class="btn sm" data-vdone="${v.id}">Complete</button><button class="btn sm ghost" data-vcancel="${v.id}">Cancel</button>` : ''}</div></div>`).join('') : '<p class="muted">No visits yet.</p>'}</div>
        <div class="card"><h3>Tasks</h3>${d.tasks.length ? d.tasks.map((t) => `<div class="list-row"><div><b style="${t.status === 'done' ? 'text-decoration:line-through' : ''}">${esc(t.title)}</b><div class="small muted">${fmtDT(t.due_at)} · ${esc(t.assignee || '')}${t.postponed_count ? ` · postponed ${t.postponed_count}×` : ''}</div></div>${t.status === 'open' ? `<button class="btn sm" data-tdone="${t.id}">✓ Done</button>` : badge('Done', 'b-green')}</div>`).join('') : '<p class="muted">No tasks.</p>'}</div>
        <div class="card"><div class="card-h"><h3>Client portal & KYC</h3>${badge(d.portal_status, d.portal_status === 'Pending Portal Link' ? 'b-amber' : d.portal_status.includes('Expired') ? 'b-red' : 'b-green')}</div><p class="small">${badge(kycBadge[0], kycBadge[1])}</p>
          ${d.kyc.map((k) => `<div class="list-row"><div><b>${esc(k.doc_type)}</b><div class="small muted">${esc(k.filename)} · ${rel(k.uploaded_at)}${k.remark ? ' · ' + esc(k.remark) : ''}</div></div><div class="row gap-s">${badge(k.status, k.status === 'verified' ? 'b-green' : k.status === 'rejected' ? 'b-red' : 'b-amber')}<a class="btn sm" href="${authUrl('/kyc/' + k.id + '/file')}" target="_blank">View</a>${admin && k.status === 'pending' ? `<button class="btn sm" data-kv="${k.id}">✓</button><button class="btn sm danger" data-kr="${k.id}">✗</button>` : ''}</div></div>`).join('')}
          <button class="btn sm mt" data-a="kyc">⬆ Upload document</button></div>
      </div>
      <div class="card" style="align-self:start"><div class="card-h"><h3>Activity timeline</h3><div class="seg">${[['all', 'All'], ['call', 'Calls'], ['whatsapp', 'WhatsApp'], ['note', 'Notes'], ['task', 'Tasks']].map(([k, n]) => `<button data-tl="${k}" class="${tlFilter === k ? 'on' : ''}">${n}</button>`).join('')}</div></div>
        <div class="row mb no-enter"><input id="qn" placeholder="Quick note…" style="flex:1"><button class="btn primary" id="qnb">Add</button></div>
        ${acts.length ? `<ul class="tl">${acts.map((a) => `<li><div class="ico">${ICON[a.type] || '•'}</div><div style="min-width:0;flex:1"><div>${a.type === 'call' ? `<b>${a.direction === 'incoming' ? 'Incoming' : 'Outgoing'} call — ${esc(a.outcome)}</b>${a.duration ? ` (${Math.floor(a.duration / 60)}m ${a.duration % 60}s)` : ''}${a.content ? '<br>' + esc(a.content) : ''}` : a.type === 'whatsapp' ? `<b>WhatsApp ${a.direction === 'incoming' ? 'received' : 'sent'}</b><br>${esc(a.content)}` : esc(a.content)}</div><div class="t">${esc(a.type)} · ${a.user_name ? esc(a.user_name) : 'System'} · ${fmtDT(a.created_at)}</div></div></li>`).join('')}</ul>` : empty('No activity in this view')}</div>
    </div>`;
    wire(d);
  };
  const wire = (d) => {
    const l = d.lead;
    const act = async (fn) => { try { await fn(); await load(); } catch (e) { toast(e.message, 'err'); } };
    $('#stg').onchange = async (e) => {
      const st = e.target.value;
      if (st === 'Lost') { e.target.value = l.stage; return lostModal(l, load); }
      if (st === 'Booked') { e.target.value = l.stage; return bookingWizard({ lead: l, onDone: load }); }
      act(() => post(`/leads/${id}/stage`, { stage: st }));
    };
    $('#rat').onchange = (e) => act(() => patch('/leads/' + id, { rating: e.target.value === 'auto' ? 'auto' : e.target.value }));
    $('#qnb').onclick = () => { const v = $('#qn').value.trim(); if (v) act(() => post(`/leads/${id}/notes`, { content: v })); };
    $('#qn').onkeydown = (e) => { if (e.key === 'Enter') $('#qnb').click(); };
  };
  const act = async (fn) => { try { await fn(); await load(); } catch (e) { toast(e.message, 'err'); } };
    on(root, 'click', '[data-tl]', (b) => { tlFilter = b.dataset.tl; load(); });
    on(root, 'click', '[data-rel]', (b) => act(() => post(`/plots/${b.dataset.rel}/release`)));
    on(root, 'click', '[data-tdone]', (b) => act(() => post(`/tasks/${b.dataset.tdone}/complete`)));
    on(root, 'click', '[data-vcancel]', (b) => act(() => post(`/visits/${b.dataset.vcancel}/status`, { status: 'cancelled' })));
    on(root, 'click', '[data-vdone]', (b) => modalForm({ title: 'Complete site visit', submit: 'Mark completed', body: fld('How interested was the customer?', sel('interest', [['', '—'], 'High', 'Medium', 'Low'])) + fld('Feedback', '<textarea name="feedback" placeholder="Which plots they liked, concerns, next step…"></textarea>'),
      onSubmit: async (f) => { await post(`/visits/${b.dataset.vdone}/complete`, f); toast('Visit completed', 'ok'); load(); } }));
    on(root, 'click', '[data-kv]', (b) => act(() => post(`/kyc/${b.dataset.kv}/review`, { status: 'verified' })));
    on(root, 'click', '[data-kr]', async (b) => { const r = await askText('Reject document', 'Reason (the client will see this)'); if (r) act(() => post(`/kyc/${b.dataset.kr}/review`, { status: 'rejected', remark: r })); });
    on(root, 'click', '[data-a]', async (b) => {
      const a = b.dataset.a, l = cur.lead;
      if (a === 'genuine' || a === 'spam') return act(() => post(`/leads/${id}/flag-decision`, { decision: a }));
      if (a === 'dupok') return act(() => post(`/leads/${id}/duplicate-review`));
      if (a === 'edit') return leadForm(l, load);
      if (a === 'call') return callModal(l, load);
      if (a === 'wa') return waModal(l, load);
      if (a === 'note') { const t = await askText('Add note', 'Note'); if (t) act(() => post(`/leads/${id}/notes`, { content: t })); return; }
      if (a === 'task') return taskModal(l, load);
      if (a === 'visit') return visitModal(l, load);
      if (a === 'hold') return holdModal(l, load);
      if (a === 'discount') return discountModal(l, load);
      if (a === 'book') return bookingWizard({ lead: l, onDone: load });
      if (a === 'lost') return lostModal(l, load);
      if (a === 'reopen') return act(() => post(`/leads/${id}/stage`, { stage: 'Negotiation' }));
      if (a === 'assign') return assignModal(l, load);
      if (a === 'ai') return nav('#/ai?lead=' + id);
      if (a === 'kyc') return kycUpload(l, load);
      if (a === 'portal') {
        const r = await post(`/leads/${id}/portal-link`); const link = fullLink(r.link);
        const text = `Hi ${l.name.split(' ')[0]}, here is your secure booking portal from ${S.org.name}: ${link}\nYou can view your booking, payment schedule and upload KYC documents there.`;
        const m = modal({ title: 'Client booking portal link', body: `<p>Send this secure link to the client. It shows their booking status and payment schedule and lets them upload KYC documents. It expires in ${S.settings.portal_days || 30} days.</p><p><code>${esc(link)}</code></p>`,
          footer: `<button class="btn" id="cp">Copy link</button><a class="btn primary" target="_blank" href="${waLink(l.phone_norm, text)}">Send on WhatsApp</a>`, onOpen: (el) => ($('#cp', el).onclick = () => copy(link)) });
        return load();
      }
      if (a === 'delete') return deleteLeads([Number(id)], () => nav('#/leads'));
      if (a === 'dup') { const n = await askText('Report as duplicate', 'Note for admin (optional)', { required: false }); if (n !== null) act(() => post(`/leads/${id}/report-duplicate`, { note: n })); }
    });
  await load();
}

// ---------- detail modals ----------
export function callModal(l, done) {
  modalForm({ title: `Log call — ${l.name}`, submit: 'Save call', body: `<div class="frm-g">${fld('Direction', sel('direction', [['outgoing', 'Outgoing'], ['incoming', 'Incoming']]))}${fld('Outcome', sel('outcome', ['Connected', 'Not Answered', 'Busy', 'Switched Off', 'Wrong Number', 'Voicemail', 'Missed']))}
    ${fld('Duration (min)', inp('duration_min', '', 'type="number" min="0" placeholder="0"'))}${fld('Seconds', inp('duration_sec', '', 'type="number" min="0" max="59" placeholder="0"'))}${fld('Notes', '<textarea name="notes" placeholder="What was discussed?"></textarea>', '', 'full')}</div>`,
    onSubmit: async (d) => { await post(`/leads/${l.id}/calls`, d); toast('Call logged', 'ok'); done && done(); } });
}
export async function waModal(l, done) {
  const tpls = S.meta.templates;
  const m = modalForm({ title: `WhatsApp — ${l.name}`, wide: true, submit: 'Open WhatsApp & log', body: `${fld('Template', sel('tpl', [['', 'Choose a template…'], ...tpls.map((t) => [t.id, t.name])]))}${fld('Message', '<textarea name="content" style="min-height:120px" placeholder="Type or pick a template"></textarea>')}${fld('Direction', sel('direction', [['outgoing', 'I am sending this'], ['incoming', 'Customer sent me this (just log)']]))}`,
    onOpen: (el) => { $('[name=tpl]', el).onchange = async (e) => { if (!e.target.value) return; const r = await post('/templates/render', { template_id: Number(e.target.value), lead_id: l.id }); $('[name=content]', el).value = r.text; }; },
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
function discountModal(l, done) {
  const projects = S.meta.projects.filter((p) => p.status === 'active');
  modalForm({ title: 'Request discount approval', submit: 'Send request', body: `${fld('Project', sel('project_id', projects.map((p) => [p.id, p.name]), l.pref_project_id || projects[0]?.id))}${fld('Plot', '<select name="plot_id"></select>')}<div id="dinfo" class="small muted mb"></div>${fld('Discount requested (₹)', inp('amount', '', 'type="number" min="1"'))}${fld('Reason', '<textarea name="reason" placeholder="Why does the customer deserve this discount?"></textarea>')}`,
    onOpen: (el) => { const p = $('[name=project_id]', el), pl = $('[name=plot_id]', el); const info = async () => { if (!pl.value) return; const r = await get('/plots/' + pl.value + '/price'); $('#dinfo', el).innerHTML = `Base price ${inr(r.price.base)} · self-approved limit ${inr(r.price.max_discount)} (${r.project.max_discount_pct}%)`; };
      const fill = async () => { const rows = (await get('/plots?project_id=' + p.value)).filter((x) => ['available', 'hold'].includes(x.status)); pl.innerHTML = rows.map((x) => `<option value="${x.id}">${esc(x.plot_no)} · ${x.area_sqyd} sq.yd · ${inrShort(x.price)}</option>`).join('') || '<option value="">No plots</option>'; info(); }; p.onchange = fill; pl.onchange = info; fill(); },
    onSubmit: async (d) => { const r = await post('/discounts', { lead_id: l.id, plot_id: Number(d.plot_id), amount: Number(d.amount), reason: d.reason }); toast(r.within_limit ? 'Within your limit — request sent for record' : 'Request sent to admin for approval', 'ok'); done && done(); } });
}
async function assignModal(l, done) {
  const rec = await get(`/leads/${l.id}/recommend-rep`).catch(() => null);
  modalForm({ title: `Assign ${l.name}`, submit: 'Assign', body: fld('Team member', sel('rep_id', repOptions('Unassigned'), l.assigned_to || '')) + (rec ? `<div class="info-box"><b>RealPilot suggests ${esc(rec.recommended.name)}</b> — ${rec.recommended.open} open leads, ${rec.recommended.conversion}% recent conversion.</div>${rec.ranking.map((r) => `<div class="list-row small"><span>${esc(r.name)}</span><span class="muted">${r.open} open · ${r.conversion}% conv.</span></div>`).join('')}` : ''),
    onSubmit: async (d) => { await post(`/leads/${l.id}/assign`, { rep_id: d.rep_id ? Number(d.rep_id) : null }); toast('Lead assigned', 'ok'); done && done(); } });
}
function kycUpload(l, done) {
  modalForm({ title: 'Upload KYC document', submit: 'Upload', body: `${fld('Document type', sel('doc_type', ['Aadhaar Card', 'PAN Card', 'Passport Photo', 'Address Proof', 'Bank Statement', 'Other']))}${fld('File (PDF, JPG or PNG, max 6 MB)', '<input type="file" id="kf" accept=".pdf,.jpg,.jpeg,.png,image/*,application/pdf">')}`,
    onSubmit: async (d) => { const f = $('#kf').files[0]; if (!f) throw new Error('Choose a file'); const b64 = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result.split(',')[1]); fr.readAsDataURL(f); }); await post(`/leads/${l.id}/kyc`, { doc_type: d.doc_type, filename: f.name, data_base64: b64 }); toast('Document uploaded', 'ok'); done && done(); } });
}
