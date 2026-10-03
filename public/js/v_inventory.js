// Inventory: projects (layouts), plot map, plot finder, holds.
import { S, $, $$, esc, get, post, patch, del, on, modal, modalForm, confirmDialog, toast, fld, inp, sel, inr, inrShort, fmtDT, fmtDate, isAdmin, empty, badge, PLOT_CLS, nav, reload, authUrl,
  leadPicker, wireLeadPickers, loadMeta, spinner, rel } from './core.js';
import { bookingWizard } from './v_bookings.js';

const FACINGS = ['East', 'West', 'North', 'South', 'North-East', 'North-West', 'South-East', 'South-West'];
const APPROVALS = ['DTCP', 'HMDA', 'CRDA', 'BDA / BMRDA', 'Panchayat', 'Municipal', 'RERA registered', 'Other'];
const readB64 = (f) => new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result.split(',')[1]); fr.readAsDataURL(f); });

export function projectForm(p, done) {
  p = p || {};
  modalForm({ title: p.id ? 'Edit project' : 'Add project / layout', wide: true, submit: 'Save', body: `<div class="frm-g">
    ${fld('Project name <span class="req">*</span>', inp('name', p.name || '', 'required'))}${fld('Developer / company', inp('developer', p.developer || ''))}
    ${fld('Location / village', inp('location', p.location || ''))}${fld('City / district', inp('city', p.city || ''))}
    ${fld('RERA registration no.', inp('rera_no', p.rera_no || ''))}${fld('Layout approval', sel('approval', [['', '—'], ...APPROVALS], p.approval || ''))}
    ${fld('Total area (acres)', inp('total_area_acres', p.total_area_acres ?? '', 'type="number" step="0.01"'))}${fld('Default rate (₹ per sq.yd)', inp('base_rate', p.base_rate ?? '', 'type="number" min="0"'))}
    ${fld('Development charges (₹ per sq.yd)', inp('dev_charges_per_sqyd', p.dev_charges_per_sqyd ?? 0, 'type="number" min="0"'), 'Added to plot price, optional')}${fld('Registration + stamp duty (% of base price)', inp('registration_pct', p.registration_pct ?? 0, 'type="number" min="0" max="100" step="0.1"'), 'e.g. 7.5 for Telangana; 0 to exclude')}
    ${fld('Self-approved discount limit on admin bookings (%)', inp('max_discount_pct', p.max_discount_pct ?? 0, 'type="number" min="0" max="100" step="0.1"'), 'Reps cannot give discounts; above this limit an admin needs an approved request')}${fld('Status', sel('status', [['active', 'Active'], ['archived', 'Archived']], p.status || 'active'))}
    ${fld('Amenities', inp('amenities', p.amenities || ''), 'e.g. 30ft roads, drainage, water, avenue plantation, park', 'full')}${fld('Description', `<textarea name="description">${esc(p.description || '')}</textarea>`, '', 'full')}</div>`,
    onSubmit: async (d) => { if (p.id) await patch('/projects/' + p.id, d); else await post('/projects', d); await loadMeta(); toast('Project saved', 'ok'); done && done(); } });
}
const plotFields = (p = {}, projectRate = '') => `<div class="frm-g">${fld('Plot no. <span class="req">*</span>', inp('plot_no', p.plot_no || '', 'required'))}${fld('Block / phase', inp('block', p.block || ''))}
  ${fld('Area (sq.yd) <span class="req">*</span>', inp('area_sqyd', p.area_sqyd ?? '', 'type="number" min="1" step="0.01"'))}${fld('Facing', sel('facing', [['', '—'], ...FACINGS], p.facing || ''))}
  ${fld('Length (ft)', inp('length', p.length ?? '', 'type="number"'))}${fld('Width (ft)', inp('width', p.width ?? '', 'type="number"'))}${fld('Road width (ft)', inp('road_width_ft', p.road_width_ft ?? '', 'type="number"'))}
  ${fld('Rate (₹ / sq.yd) <span class="req">*</span>', inp('rate_per_sqyd', p.rate_per_sqyd ?? projectRate, 'type="number" min="0"'))}${fld('PLC % (corner / park facing etc.)', inp('plc_pct', p.plc_pct ?? 0, 'type="number" min="0" max="100" step="0.1"'))}${fld('Notes', inp('notes', p.notes || ''))}</div>`;

// ================= projects list + plot finder =================
export async function projects(root) {
  const admin = isAdmin(); let tab = 'projects';
  const draw = async () => {
    const list = await get('/projects');
    root.innerHTML = `<div class="ph1"><div><h1>Inventory</h1><p>Projects, plots and live availability</p></div>${admin ? '<div class="row"><a class="btn" href="' + authUrl('/export/plots') + '">⬇ Export plots</a><button class="btn primary" id="np">＋ Add project</button></div>' : ''}</div>
    <div class="tabs"><button data-t="projects" class="${tab === 'projects' ? 'on' : ''}">Projects</button><button data-t="finder" class="${tab === 'finder' ? 'on' : ''}">Plot finder</button></div><div id="tb"></div>`;
    if (admin) $('#np').onclick = () => projectForm(null, draw);
    if (tab === 'projects') {
      $('#tb').innerHTML = list.length ? `<div class="grid g3">${list.map((p) => { const s = p.stats; return `<div class="card pcard" data-id="${p.id}"><div class="card-h"><h3>${esc(p.name)}</h3>${p.status === 'archived' ? badge('Archived') : ''}</div>
        <div class="muted small">${esc([p.location, p.city].filter(Boolean).join(', ') || '—')}${p.rera_no ? ' · RERA ' + esc(p.rera_no) : ''}</div>
        ${s.total ? `<div class="stack-bar mt">${[['available', 'var(--green)'], ['hold', 'var(--amber)'], ['booked', 'var(--blue)'], ['sold', 'var(--muted)'], ['blocked', 'var(--red)']].map(([k, c]) => `<i style="width:${(s[k] / s.total) * 100}%;background:${c}"></i>`).join('')}</div>
        <div class="stat-row mt"><div><b>${s.available}</b><span class="small muted">available</span></div><div><b>${s.hold}</b><span class="small muted">hold</span></div><div><b>${s.booked + s.sold}</b><span class="small muted">sold</span></div><div><b>${s.total}</b><span class="small muted">total</span></div></div>
        <div class="small muted mt">Available inventory worth ${inrShort(s.available_value)} · from ${inr(p.base_rate)}/sq.yd</div>` : `<p class="muted mt">No plots added yet.</p>`}</div>`; }).join('')}</div>` : empty('No projects yet', admin ? 'Click "Add project" to create your first layout, then add its plots.' : 'Ask your admin to add projects.');
      on($('#tb'), 'click', '.pcard', (c) => nav('#/inventory/' + c.dataset.id));
    } else {
      $('#tb').innerHTML = `<div class="filters">${sel('project_id', [['', 'All projects'], ...list.map((p) => [p.id, p.name])], '', 'id="ff-p"')}${sel('facing', [['', 'Any facing'], ...FACINGS], '', 'id="ff-f"')}${sel('status', [['available', 'Available'], ['hold', 'On hold'], ['', 'Any status']], 'available', 'id="ff-s"')}
        <input type="number" id="ff-a" placeholder="Min sq.yd" style="width:110px"><input type="number" id="ff-b" placeholder="Max sq.yd" style="width:110px"><input type="number" id="ff-c" placeholder="Max price ₹" style="width:130px"><button class="btn primary" id="ff-go">Find</button></div><div id="fres"></div>`;
      const find = async () => {
        const q = new URLSearchParams(); [['project_id', 'ff-p'], ['facing', 'ff-f'], ['status', 'ff-s'], ['min_area', 'ff-a'], ['max_area', 'ff-b'], ['max_price', 'ff-c']].forEach(([k, id]) => { const v = $('#' + id).value; if (v) q.set(k, v); });
        const rows = await get('/plots?' + q);
        $('#fres').innerHTML = rows.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Project</th><th>Plot</th><th class="r">Area</th><th>Facing</th><th>Road</th><th class="r">Price</th><th>Status</th></tr></thead><tbody>${rows.map((x) => `<tr class="click" data-p="${x.project_id}" data-pl="${x.id}"><td>${esc(x.project_name)}</td><td><b>${esc(x.plot_no)}</b>${x.block ? ' <span class="muted small">Blk ' + esc(x.block) + '</span>' : ''}</td><td class="r">${x.area_sqyd} sq.yd</td><td>${esc(x.facing || '—')}</td><td>${x.road_width_ft ? x.road_width_ft + ' ft' : '—'}</td><td class="r"><b>${inrShort(x.price)}</b></td><td>${badge(x.status, PLOT_CLS[x.status])}</td></tr>`).join('')}</tbody></table></div>` : empty('No plots match', 'Loosen the filters.');
      };
      on($('#fres'), 'click', 'tr.click', (tr) => nav(`#/inventory/${tr.dataset.p}?plot=${tr.dataset.pl}`));
      $('#ff-go').onclick = find; find();
    }
  };
  on(root, 'click', '[data-t]', (el) => { tab = el.dataset.t; draw(); });
  await draw();
}

// ================= project detail =================
export async function project(root, { id }, q) {
  const admin = isAdmin(); let d, mode = localStorage.getItem('rp_plotview') || 'grid', filter = { status: '', facing: '', q: '' }, selected = new Set(), selectMode = false;
  const load = async () => { d = await get('/projects/' + id); draw(); };
  const visible = () => d.plots.filter((p) => (!filter.status || p.status === filter.status) && (!filter.facing || p.facing === filter.facing) && (!filter.q || (p.plot_no + ' ' + (p.block || '')).toLowerCase().includes(filter.q.toLowerCase())));
  const draw = () => {
    const p = d.project, s = d.stats, plots = visible();
    const blocks = [...new Set(plots.map((x) => x.block || ''))];
    root.innerHTML = `<div class="mb"><a href="#/inventory">← Inventory</a></div>
    <div class="ph1"><div><h1>${esc(p.name)} ${p.status === 'archived' ? badge('Archived') : ''}</h1><p>${esc([p.location, p.city].filter(Boolean).join(', '))}${p.rera_no ? ' · RERA ' + esc(p.rera_no) : ''}${p.approval ? ' · ' + esc(p.approval) : ''}${p.developer ? ' · ' + esc(p.developer) : ''}</p></div>
      ${admin ? `<div class="row"><button class="btn" id="ed">✏️ Edit project</button><button class="btn" id="imp">⬆ Import plots</button><button class="btn" id="bulk">▦ Generate plots</button><button class="btn primary" id="add">＋ Add plot</button></div>` : ''}</div>
    <div class="grid g6 keep mb">${[['Total plots', s.total, ''], ['Available', s.available, 'green'], ['On hold', s.hold, 'amber'], ['Booked', s.booked, 'blue'], ['Sold', s.sold, ''], ['Available value', inrShort(s.available_value), '']].map(([l, v, c]) => `<div class="card kpi"><div class="l">${l}</div><div class="v" ${c ? `style="color:var(--${c})"` : ''}>${v}</div></div>`).join('')}</div>
    <div class="filters"><input type="search" id="pq" placeholder="Find plot no…" value="${esc(filter.q)}" style="min-width:140px">${sel('status', [['', 'All statuses'], 'available', 'hold', 'booked', 'sold', 'blocked'], filter.status, 'id="fst"')}${sel('facing', [['', 'Any facing'], ...FACINGS], filter.facing, 'id="ffc"')}
      <div class="seg" id="vm"><button data-m="grid" class="${mode === 'grid' ? 'on' : ''}">Map</button><button data-m="table" class="${mode === 'table' ? 'on' : ''}">Table</button></div>
      ${admin ? `<button class="btn sm ${selectMode ? 'primary' : ''}" id="sm">☑ ${selectMode ? 'Selecting…' : 'Select for price update'}</button>` : ''}
      ${selectMode && selected.size ? `<button class="btn sm primary" id="bu">Update ${selected.size} plot(s)</button>` : ''}</div>
    <div class="legend mb">${[['available', 'green'], ['hold', 'amber'], ['booked', 'blue'], ['sold', 'muted'], ['blocked', 'red']].map(([k, c]) => `<span><i style="background:var(--${c === 'muted' ? 'gray' : c}-l);border-color:var(--${c})"></i>${k}</span>`).join('')}</div>
    ${!d.plots.length ? empty('No plots yet', admin ? 'Use "Generate plots" to create a run (e.g. A-1 to A-40) or "Import plots" from a CSV/Excel.' : '') : !plots.length ? empty('No plots match the filters') : mode === 'grid'
      ? blocks.map((b) => `<div class="card mb">${blocks.length > 1 || b ? `<h3 class="mb">Block ${esc(b || '—')} <span class="muted small">${plots.filter((x) => (x.block || '') === b).length} plots</span></h3>` : ''}<div class="plotgrid">${plots.filter((x) => (x.block || '') === b).map((x) => `<div class="plot ${x.status} ${selected.has(x.id) ? 'sel' : ''}" data-pl="${x.id}" title="${esc(x.status)}"><b>${esc(x.plot_no)}</b><small>${x.area_sqyd} sq.yd${x.facing ? ' · ' + esc(x.facing.replace('North', 'N').replace('South', 'S').replace('East', 'E').replace('West', 'W').replace('-', '')) : ''}</small><small>${inrShort(x.price)}</small></div>`).join('')}</div></div>`).join('')
      : `<div class="tbl-wrap"><table class="tbl"><thead><tr>${selectMode ? '<th></th>' : ''}<th>Plot</th><th>Block</th><th class="r">Area</th><th>Size (ft)</th><th>Facing</th><th>Road</th><th class="r">Rate</th><th class="r">PLC</th><th class="r">Price</th><th>Status</th></tr></thead><tbody>${plots.map((x) => `<tr class="click" data-pl="${x.id}">${selectMode ? `<td><input type="checkbox" data-sel="${x.id}" ${selected.has(x.id) ? 'checked' : ''}></td>` : ''}<td><b>${esc(x.plot_no)}</b></td><td>${esc(x.block || '—')}</td><td class="r">${x.area_sqyd}</td><td>${x.length && x.width ? x.length + '×' + x.width : '—'}</td><td>${esc(x.facing || '—')}</td><td>${x.road_width_ft ? x.road_width_ft + ' ft' : '—'}</td><td class="r">${inr(x.rate_per_sqyd)}</td><td class="r">${x.plc_pct || 0}%</td><td class="r"><b>${inr(x.price)}</b></td><td>${badge(x.status, PLOT_CLS[x.status])}${x.booking ? ` <a href="#/bookings/${x.booking.id}" class="small">${esc(x.booking.booking_no)}</a>` : ''}</td></tr>`).join('')}</tbody></table></div>`}`;
    if (admin) {
      $('#ed').onclick = () => projectForm(p, load);
      $('#add').onclick = () => modalForm({ title: 'Add plot', wide: true, body: plotFields({}, p.base_rate || ''), onSubmit: async (f) => { await post(`/projects/${id}/plots`, f); toast('Plot added', 'ok'); load(); } });
      $('#bulk').onclick = () => modalForm({ title: 'Generate plots in bulk', wide: true, submit: 'Generate', body: `<p class="muted">Creates plots numbered <code>prefix + number</code> with the same size and rate. Existing numbers are skipped. You can edit individual plots later.</p><div class="frm-g">${fld('Prefix', inp('prefix', '', 'placeholder="e.g. A-"'))}${fld('Block / phase', inp('block'))}${fld('From number', inp('from', 1, 'type="number"'))}${fld('To number', inp('to', 20, 'type="number"'))}${fld('Area (sq.yd)', inp('area_sqyd', 200, 'type="number" step="0.01"'))}${fld('Facing', sel('facing', [['', '—'], ...FACINGS]))}${fld('Length (ft)', inp('length', '', 'type="number"'))}${fld('Width (ft)', inp('width', '', 'type="number"'))}${fld('Road width (ft)', inp('road_width_ft', '', 'type="number"'))}${fld('Rate (₹/sq.yd)', inp('rate_per_sqyd', p.base_rate || '', 'type="number"'))}${fld('PLC %', inp('plc_pct', 0, 'type="number" step="0.1"'))}</div>`,
        onSubmit: async (f) => { const r = await post(`/projects/${id}/plots/bulk`, f); toast(`${r.created} plots created${r.skipped ? `, ${r.skipped} skipped (already exist)` : ''}`, 'ok'); load(); } });
      $('#imp').onclick = () => modalForm({ title: 'Import plots from CSV / Excel', submit: 'Import', body: `<p class="muted">Columns: <code>plot_no</code>, <code>area_sqyd</code> (required); optional <code>block, length, width, facing, road_width_ft, rate_per_sqyd, plc_pct</code>.</p><a href="data:text/csv;charset=utf-8,${encodeURIComponent('plot_no,block,area_sqyd,length,width,facing,road_width_ft,rate_per_sqyd,plc_pct\nA-1,A,200,30,60,East,30,15000,0\nA-2,A,220,33,60,North,40,15500,5\n')}" download="plots_template.csv">⬇ Template</a><br><br>${fld('File', '<input type="file" id="pf" accept=".csv,.xlsx">')}`,
        onSubmit: async () => { const f = $('#pf').files[0]; if (!f) throw new Error('Choose a file'); const r = await post(`/projects/${id}/plots/import`, { file_base64: await readB64(f), filename: f.name }); toast(`${r.created} plots imported${r.errors.length ? `, ${r.errors.length} row(s) had errors` : ''}`, r.errors.length ? '' : 'ok'); if (r.errors.length) modal({ title: 'Rows not imported', body: `<table class="tbl">${r.errors.map((e) => `<tr><td>Row ${e.row}</td><td>${esc(e.error)}</td></tr>`).join('')}</table>` }); load(); } });
      $('#sm').onclick = () => { selectMode = !selectMode; selected.clear(); draw(); };
      const bu = $('#bu'); if (bu) bu.onclick = () => modalForm({ title: `Update ${selected.size} plot(s)`, body: `<p class="muted">Leave blank to keep the current value. Booked/sold plots are never changed.</p>${fld('New rate (₹ / sq.yd)', inp('rate_per_sqyd', '', 'type="number"'))}${fld('New PLC %', inp('plc_pct', '', 'type="number" step="0.1"'))}${fld('Set status', sel('status', [['', 'Keep'], ['available', 'Available'], ['blocked', 'Blocked (not for sale)']]))}`,
        onSubmit: async (f) => { const r = await post('/plots/bulk-update', { ids: [...selected], ...f }); toast(`${r.updated} plot(s) updated`, 'ok'); selected.clear(); selectMode = false; load(); } });
    }
    $('#pq').oninput = (e) => { filter.q = e.target.value; draw(); const i = $('#pq'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); };
    $('#fst').onchange = (e) => { filter.status = e.target.value; draw(); }; $('#ffc').onchange = (e) => { filter.facing = e.target.value; draw(); };
    $('#vm').onclick = (e) => { const b = e.target.closest('[data-m]'); if (b) { mode = b.dataset.m; localStorage.setItem('rp_plotview', mode); draw(); } };
  };
  on(root, 'click', '[data-pl]', (el, e) => {
    if (e.target.closest('input,a')) return;
    const pid = Number(el.dataset.pl);
    if (selectMode) { selected.has(pid) ? selected.delete(pid) : selected.add(pid); return draw(); }
    plotModal(d.plots.find((x) => x.id === pid), d.project, load);
  });
  on(root, 'change', '[data-sel]', (cb) => { const i = Number(cb.dataset.sel); cb.checked ? selected.add(i) : selected.delete(i); draw(); });
  await load();
  if (q.plot) { const pl = d.plots.find((x) => x.id === Number(q.plot)); if (pl) plotModal(pl, d.project, load); }
}

async function plotModal(pl, proj, done) {
  const admin = isAdmin();
  const r = await get(`/plots/${pl.id}/price`); const x = r.price;
  const m = modal({ title: `Plot ${pl.plot_no} — ${proj.name}`, wide: true, body: `<div class="grid g2 stack"><div><div class="row mb">${badge(pl.status, PLOT_CLS[pl.status])}${pl.block ? `<span class="muted">Block ${esc(pl.block)}</span>` : ''}</div>
      <dl class="kv"><dt>Area</dt><dd>${pl.area_sqyd} sq.yd (${Math.round(pl.area_sqyd * 9)} sq.ft)</dd><dt>Dimensions</dt><dd>${pl.length && pl.width ? `${pl.length} × ${pl.width} ft` : '—'}</dd><dt>Facing</dt><dd>${esc(pl.facing || '—')}</dd><dt>Road width</dt><dd>${pl.road_width_ft ? pl.road_width_ft + ' ft' : '—'}</dd><dt>Rate</dt><dd>${inr(pl.rate_per_sqyd)} / sq.yd</dd><dt>PLC</dt><dd>${pl.plc_pct || 0}%</dd>${pl.notes ? `<dt>Notes</dt><dd>${esc(pl.notes)}</dd>` : ''}</dl>
      ${pl.status === 'hold' ? `<div class="warn-box mt">On hold for <b>${esc(pl.hold_lead_name || '—')}</b> by ${esc(pl.hold_by_name || '—')} until ${fmtDT(pl.hold_until)}</div>` : ''}
      ${pl.booking ? `<div class="info-box mt">Booked — <a href="#/bookings/${pl.booking.id}" data-close>${esc(pl.booking.booking_no)}</a> · ${esc(pl.booking.buyer_name)}</div>` : ''}</div>
      <div><h3 class="mb">Price</h3><table class="price-t"><tr><td>Base</td><td class="right">${inr(x.base)}</td></tr>${x.plc ? `<tr><td>PLC (${pl.plc_pct}%)</td><td class="right">${inr(x.plc)}</td></tr>` : ''}${x.dev ? `<tr><td>Development charges</td><td class="right">${inr(x.dev)}</td></tr>` : ''}${x.reg ? `<tr><td>Registration & stamp duty</td><td class="right">${inr(x.reg)}</td></tr>` : ''}<tr class="tot"><td>Total</td><td class="right">${inr(x.total)}</td></tr></table>
      ${admin ? `<p class="small muted mt">Reps cannot give discounts. Self-approved limit for admin bookings: ${inr(x.max_discount)} (${r.project.max_discount_pct}%).</p>` : ''}</div></div>`,
    footer: `${pl.status === 'available' ? '<button class="btn" data-a="hold">🔒 Hold for a lead</button><button class="btn primary" data-a="book">📑 Book this plot</button>' : ''}${pl.status === 'hold' ? '<button class="btn" data-a="release">Release hold</button><button class="btn primary" data-a="book">📑 Book</button>' : ''}
      ${admin && !['booked', 'sold'].includes(pl.status) ? `<button class="btn" data-a="edit">✏️ Edit</button><button class="btn" data-a="block">${pl.status === 'blocked' ? 'Unblock' : 'Block'}</button><button class="btn danger" data-a="delete">Delete</button>` : ''}` });
  on(m.el, 'click', '[data-a]', async (el) => {
    const a = el.dataset.a;
    try {
      if (a === 'release') { await post(`/plots/${pl.id}/release`); toast('Hold released', 'ok'); m.close(); done(); }
      if (a === 'block') { await patch(`/plots/${pl.id}`, { status: pl.status === 'blocked' ? 'available' : 'blocked' }); m.close(); done(); }
      if (a === 'delete') { if (await confirmDialog(`Delete plot ${esc(pl.plot_no)}?`, { ok: 'Delete', danger: true })) { await del(`/plots/${pl.id}`); toast('Plot deleted'); m.close(); done(); } }
      if (a === 'edit') { m.close(); modalForm({ title: `Edit plot ${pl.plot_no}`, wide: true, body: plotFields(pl), onSubmit: async (f) => { await patch(`/plots/${pl.id}`, f); toast('Saved', 'ok'); done(); } }); }
      if (a === 'hold') { m.close(); modalForm({ title: `Hold plot ${pl.plot_no}`, submit: 'Hold plot', body: fld('For which lead?', leadPicker('lead_id')) + fld('Hold for (hours)', inp('hours', S.settings.hold_hours_default || 48, 'type="number" min="1"')), onOpen: (e) => wireLeadPickers(e),
        onSubmit: async (f) => { if (!f.lead_id) throw new Error('Choose a lead'); await post(`/plots/${pl.id}/hold`, { lead_id: Number(f.lead_id), hours: Number(f.hours) }); toast('Plot on hold', 'ok'); done(); } }); }
      if (a === 'book') { m.close(); bookingWizard({ plot: pl, lead: pl.hold_lead_id ? { id: pl.hold_lead_id, name: pl.hold_lead_name, phone_norm: '' } : null, onDone: done }); }
    } catch (e) { toast(e.message, 'err'); }
  });
}
