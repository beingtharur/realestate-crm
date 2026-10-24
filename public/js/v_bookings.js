// Booking wizard, bookings list/detail, payments, collections, discount approvals. Representatives get the sales view only (no payments, collections or discounts).
import { snack, S, $, $$, esc, get, post, put, patch, api, on, modal, modalForm, confirmDialog, askText, toast, fld, inp, sel, repOptions, projectOptions, inr, inrShort, rel, fmtDT, fmtDate, today,
  isAdmin, empty, badge, stageBadge, phoneFmt, waLink, nav, reload, authUrl, debounce, leadPicker, wireLeadPickers, userName, spinner, fullLink, copy } from './core.js';

const MODES = ['UPI', 'Bank Transfer', 'Cheque', 'Cash', 'Demand Draft', 'Card', 'Loan Disbursement'];
const BST = { booked: ['Booked', 'b-blue'], agreement: ['Agreement signed', 'b-amber'], registered: ['Registered', 'b-green'], cancelled: ['Cancelled', 'b-red'] };
const bBadge = (s) => badge(BST[s]?.[0] || s, BST[s]?.[1] || '');

// ================= booking wizard =================
export function bookingWizard({ lead = null, plot = null, onDone } = {}) {
  const projects = S.meta.projects.filter((p) => p.status === 'active');
  if (!projects.length) return modal({ title: 'No projects yet', body: '<p>Add a project and its plots under <b>Inventory</b> first.</p>' });
  let manual = false, pv = null, rows = [];
  const admin = isAdmin();
  const m = modal({ title: 'Book a plot', xl: true, body: `<div class="form-err"></div><div class="grid g2 stack" style="grid-template-columns:minmax(0,5fr) minmax(0,6fr)">
    <div><h3 class="mb">1 · Customer & plot</h3>
      ${lead ? `<input type="hidden" name="lead_id" value="${lead.id}">${fld('Customer', `<div class="card" style="padding:8px 12px"><b>${esc(lead.name)}</b> <span class="muted small">${phoneFmt(lead.phone_norm)}</span></div>`)}` : fld('Customer (lead)', leadPicker('lead_id'))}
      <div class="frm-g">${fld('Project', sel('project_id', projects.map((p) => [p.id, p.name]), plot?.project_id || lead?.pref_project_id || projects[0].id))}${fld('Plot', '<select name="plot_id"></select>')}</div>
      <div id="pbox" class="card mb" style="background:var(--surface2)"></div>
      <div class="frm-g">${admin ? fld('Discount (₹)', inp('discount', '', 'type="number" min="0" placeholder="0"'), '<span id="dnote"></span>') : ''}${fld('Booking date', inp('booked_on', today(), `type="date" max="${today()}"`))}</div>
      <h3 class="mb mt">Buyer details</h3><div class="frm-g">${fld('Buyer name', inp('buyer_name', lead?.name || ''))}${fld('Buyer mobile', inp('buyer_phone', lead?.phone_norm || '', 'data-v="phone" inputmode="tel"'))}${fld('PAN (optional)', inp('buyer_pan', '', 'maxlength="10" style="text-transform:uppercase"'))}
        ${fld('Channel partner', sel('partner_id', [['', lead?.partner_id ? 'From lead' : 'Direct (none)'], ...S.meta.partners.filter((p) => p.active).map((p) => [p.id, `${p.name} (${p.commission_pct}%)`])]))}${fld('Address', inp('buyer_address'), '', 'full')}</div></div>
    <div><h3 class="mb">2 · Token & payment plan</h3>
      <div class="frm-g">${fld('Token / booking amount received (₹) <span class="req">*</span>', inp('token_amount', '', 'type="number" min="1"'))}${fld('Received via', sel('token_mode', MODES, 'UPI'))}${fld('Reference no. (UTR / cheque)', inp('token_ref'))}<div></div></div>
      <div class="frm-g">${fld('Down payment (% of price)', inp('down_pct', '20', 'type="number" min="0" max="100"'))}${fld('Number of EMIs', inp('emi_count', '0', 'type="number" min="0" max="120"'))}${fld('Days between EMIs', inp('emi_interval_days', '30', 'type="number" min="1"'))}${fld('Final payment at registration (%)', inp('final_pct', '0', 'type="number" min="0" max="100"'), 'Used when EMIs > 0; otherwise the balance is due at registration')}</div>
      <div class="row between"><b>Payment schedule</b><button class="btn sm" type="button" id="regen">↻ Reset schedule</button></div>
      <div class="tbl-wrap mt"><table class="tbl"><thead><tr><th>Description</th><th>Due date</th><th class="r">Amount (₹)</th><th></th></tr></thead><tbody id="sched"></tbody><tfoot><tr><td colspan="2"><button class="btn sm" type="button" id="addrow">＋ Add instalment</button></td><td class="r" id="stot"></td><td></td></tr></tfoot></table></div>
      <div id="smsg" class="small mt"></div>${fld('Notes', '<textarea name="notes" placeholder="Special terms, promises made, etc."></textarea>')}</div></div>`,
    footer: '<button class="btn" data-close>Cancel</button><button class="btn primary" id="bk-go">Confirm booking</button>' });
  const f = (n) => $(`[name=${n}]`, m.el);
  const errBox = $('.form-err', m.el);
  const fillPlots = async () => {
    const all = await get('/plots?project_id=' + f('project_id').value);
    const leadId = Number(f('lead_id').value) || 0;
    const opts = all.filter((x) => x.status === 'available' || (x.status === 'hold' && x.hold_lead_id === leadId));
    f('plot_id').innerHTML = opts.length ? opts.map((x) => `<option value="${x.id}" ${plot && plot.id === x.id ? 'selected' : ''}>${esc(x.plot_no)} · ${x.area_sqyd} sq.yd${x.facing ? ' · ' + esc(x.facing) : ''} · ${inrShort(x.price)}${x.status === 'hold' ? ' (your hold)' : ''}</option>`).join('') : '<option value="">No available plots</option>';
    preview(true);
  };
  const params = () => ({ plot_id: Number(f('plot_id').value), discount: admin ? Number(f('discount').value) || 0 : 0, token_amount: Number(f('token_amount').value) || 0, down_pct: f('down_pct').value, emi_count: f('emi_count').value, emi_interval_days: f('emi_interval_days').value, final_pct: f('final_pct').value, start_date: f('booked_on').value });
  const drawRows = () => {
    $('#sched', m.el).innerHTML = rows.map((r, i) => `<tr><td>${inp('', r.label, `data-i="${i}" data-k="label"`)}</td><td>${inp('', r.due_date, `type="date" data-i="${i}" data-k="due_date"`)}</td><td>${inp('', r.amount, `type="number" data-i="${i}" data-k="amount" style="text-align:right"`)}</td><td><button class="btn sm ghost" data-rm="${i}">✕</button></td></tr>`).join('');
    checkSum();
  };
  const checkSum = () => {
    if (!pv) return;
    const tok = Number(f('token_amount').value) || 0, sum = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0) + tok, diff = pv.price.total - sum;
    $('#stot', m.el).innerHTML = `<b>${inr(sum)}</b>`;
    $('#smsg', m.el).innerHTML = Math.abs(diff) <= 1 ? `<span style="color:var(--green)">✓ Token + schedule = plot price ${inr(pv.price.total)}</span>` : `<span style="color:var(--red)">Schedule is ${diff > 0 ? 'short by' : 'over by'} ${inr(Math.abs(diff))} — it must equal ${inr(pv.price.total)}</span>`;
  };
  const preview = debounce(async (regen) => {
    const p = params(); if (!p.plot_id) { $('#pbox', m.el).innerHTML = '<span class="muted">Select a plot</span>'; pv = null; rows = []; drawRows(); return; }
    try {
      pv = await post('/bookings/preview', p); const x = pv.price;
      $('#pbox', m.el).innerHTML = `<table class="price-t"><tr><td>Base (${x.area} sq.yd × ${inr(x.rate)})</td><td class="right">${inr(x.base)}</td></tr>${x.plc ? `<tr><td>Preferential location charges</td><td class="right">${inr(x.plc)}</td></tr>` : ''}${x.dev ? `<tr><td>Development charges</td><td class="right">${inr(x.dev)}</td></tr>` : ''}${x.reg ? `<tr><td>Registration / stamp duty</td><td class="right">${inr(x.reg)}</td></tr>` : ''}${x.discount ? `<tr><td>Discount</td><td class="right" style="color:var(--green)">− ${inr(x.discount)}</td></tr>` : ''}<tr class="tot"><td>Total price</td><td class="right">${inr(x.total)}</td></tr></table>`;
      if (admin) $('#dnote', m.el).innerHTML = x.discount > x.max_discount ? `<span style="color:var(--red)">Above the ${inr(x.max_discount)} limit — ${admin ? 'admin override will be logged' : 'needs admin approval'}</span>` : `Self-approved up to ${inr(x.max_discount)}`;
      if (regen || !manual) { rows = pv.installments.map((r) => ({ ...r })); manual = false; drawRows(); } else checkSum();
    } catch (e) { $('#pbox', m.el).innerHTML = `<span style="color:var(--red)">${esc(e.message)}</span>`; }
  }, 250);
  f('project_id').onchange = fillPlots; f('plot_id').onchange = () => preview(true);
  ['discount', 'token_amount', 'down_pct', 'emi_count', 'emi_interval_days', 'final_pct', 'booked_on'].forEach((n) => { if (f(n)) f(n).oninput = () => preview(false); });
  $('#regen', m.el).onclick = () => { manual = false; preview(true); };
  $('#addrow', m.el).onclick = () => { manual = true; rows.push({ label: 'Instalment', due_date: today(), amount: 0 }); drawRows(); };
  on($('#sched', m.el), 'input', '[data-i]', (el) => { manual = true; rows[el.dataset.i][el.dataset.k] = el.dataset.k === 'amount' ? Number(el.value) : el.value; checkSum(); });
  on($('#sched', m.el), 'click', '[data-rm]', (el) => { manual = true; rows.splice(Number(el.dataset.rm), 1); drawRows(); });
  wireLeadPickers(m.el, (l) => { f('buyer_name').value = l.name; f('buyer_phone').value = l.phone_norm; fillPlots(); });
  $('#bk-go', m.el).onclick = async (e) => {
    errBox.innerHTML = ''; const btn = e.target; btn.disabled = true;
    try {
      const d = {}; ['lead_id', 'plot_id', 'discount', 'token_amount', 'token_mode', 'token_ref', 'booked_on', 'buyer_name', 'buyer_phone', 'buyer_address', 'buyer_pan', 'partner_id', 'notes'].forEach((n) => (d[n] = f(n) ? f(n).value : ''));
      if (!d.lead_id) throw new Error('Choose the customer');
      const r = await post('/bookings', { ...d, lead_id: Number(d.lead_id), plot_id: Number(d.plot_id), discount: Number(d.discount) || 0, token_amount: Number(d.token_amount), partner_id: d.partner_id ? Number(d.partner_id) : undefined, installments: rows });
      $('.modal-b', m.el).innerHTML = `<div class="ok-box"><b>🎉 Booking ${esc(r.booking_no)} created.</b> The plot is now marked Booked and the lead moved to Booked.</div>
        <div class="row mt"><a class="btn primary" target="_blank" href="${authUrl('/payments/' + r.payment_id + '/receipt')}">🖨 Print token receipt</a><a class="btn" href="#/bookings/${r.id}" data-close>Open booking</a></div>`;
      $('.modal-f', m.el).remove(); onDone && onDone(r);
    } catch (err) { errBox.innerHTML = `<div class="err">${esc(err.message)}</div>`; m.el.scrollTo?.(0, 0); }
    finally { btn.disabled = false; }
  };
  fillPlots();
}

// ================= payment modal =================
export function paymentModal(b, summary, installments, onDone, instId) {
  const next = installments.find((i) => i.id === instId) || installments.find((i) => i.paid_amount < i.amount - 0.5);
  modalForm({ title: `Record payment — ${b.booking_no}`, submit: 'Save & generate receipt', body: `<div class="info-box">Outstanding: <b>${inr(summary.outstanding)}</b>${summary.overdue_amount ? ` · <span style="color:var(--red)">Overdue ${inr(summary.overdue_amount)}</span>` : ''}</div>
    <div class="frm-g">${fld('Amount received (₹)', inp('amount', next ? Math.round(next.amount - next.paid_amount) : '', 'type="number" min="1"'))}${fld('Mode', sel('mode', MODES, 'UPI'))}${fld('Reference (UTR / cheque no.)', inp('ref_no'))}${fld('Received on', inp('paid_on', today(), `type="date" max="${today()}"`))}
    ${fld('Apply to', sel('installment_id', [['', 'Oldest dues first (automatic)'], ...installments.filter((i) => i.paid_amount < i.amount - 0.5).map((i) => [i.id, `${i.label} — due ${fmtDate(i.due_date)} (${inr(i.amount - i.paid_amount)})`])], instId || ''), '', 'full')}${fld('Note', inp('note'), '', 'full')}</div>
    <p class="small muted">Cash payments of ₹2,00,000 or more are not permitted (Income Tax Act §269ST).</p>`,
    onSubmit: async (d) => { const r = await post(`/bookings/${b.id}/payments`, { ...d, amount: Number(d.amount), installment_id: d.installment_id ? Number(d.installment_id) : undefined }); toast(`Receipt ${r.receipt_no} created`, 'ok'); window.open(authUrl(`/payments/${r.id}/receipt`), '_blank'); onDone && onDone(); receiptWhatsApp(b, d.amount, r); } });
}

// ================= list =================
export async function list(root) {
  const admin = isAdmin();
  const F = { status: '', project_id: '', rep: '', q: '' };
  root.innerHTML = `<div class="ph1"><div><h1>Bookings</h1><p id="bc"></p></div><div class="row">${admin ? `<a class="btn" href="${authUrl('/export/bookings')}">⬇ Export</a>` : ''}<button class="btn primary" id="nb">＋ New booking</button></div></div>
    <div class="filters"><input type="search" id="q" placeholder="Search buyer, booking no, plot…">${sel('status', [['', 'Any status'], ...Object.entries(BST).map(([k, v]) => [k, v[0]])], '', 'id="fs"')}${sel('project_id', projectOptions('Any project'), '', 'id="fp"')}${admin ? sel('rep', repOptions('All reps'), '', 'id="fr"') : ''}</div><div id="bl">${spinner()}</div>`;
  const draw = async () => {
    const qs = new URLSearchParams(Object.entries(F).filter(([, v]) => v)); const rows = await get('/bookings?' + qs);
    $('#bc').textContent = `${rows.length} booking${rows.length === 1 ? '' : 's'} · ${inrShort(rows.filter((r) => r.status !== 'cancelled').reduce((s, r) => s + r.total, 0))} sales value`;
    $('#bl').innerHTML = rows.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Booking</th><th>Buyer</th><th>Plot</th><th class="r">Total</th>${admin ? '<th class="r">Paid</th><th class="r">Outstanding</th>' : ''}<th>Status</th>${admin ? '<th>Sold by</th>' : ''}</tr></thead><tbody>${rows.map((b) => `<tr class="click" data-id="${b.id}"><td><b>${esc(b.booking_no)}</b><div class="muted small">${fmtDate(b.booked_on)}</div></td><td>${esc(b.buyer_name)}<div class="muted small">${phoneFmt(b.buyer_phone)}</div></td><td>${esc(b.project_name)}<div class="muted small">Plot ${esc(b.plot_no)} · ${b.area_sqyd} sq.yd</div></td><td class="r">${inr(b.total)}</td>${admin ? `<td class="r">${inr(b.paid)}</td>
      <td class="r">${inr(b.outstanding)}${b.overdue_amount ? `<div class="small" style="color:var(--red)">${inr(b.overdue_amount)} overdue</div>` : ''}</td>` : ''}<td>${bBadge(b.status)}</td>${admin ? `<td>${esc(b.rep_name || '—')}</td>` : ''}</tr>`).join('')}</tbody></table></div>` : empty('No bookings yet', 'Book a plot from a lead\'s page or with "New booking".');
  };
  on($('#bl'), 'click', 'tr.click', (tr) => nav('#/bookings/' + tr.dataset.id));
  $('#q').oninput = debounce((e) => { F.q = e.target.value; draw(); });
  [['fs', 'status'], ['fp', 'project_id'], ['fr', 'rep']].forEach(([id, k]) => { const el = $('#' + id); if (el) el.onchange = (e) => { F[k] = e.target.value; draw(); }; });
  $('#nb').onclick = () => bookingWizard({ onDone: draw });
  await draw();
}

// ================= detail =================
export async function detail(root, { id }, q) {
  const admin = isAdmin();
  let cur = null;
  const load = async () => {
    let d; try { d = await get('/bookings/' + id); } catch { root.innerHTML = `<a href="#/bookings">← Bookings</a>${empty('Booking not found')}`; return; }
    cur = d;
    if (!admin) { // sales view: the sale, the plot and the documents — no payments, dues, discount or commission
      const b = d.booking;
      root.innerHTML = `<div class="mb"><a href="#/bookings">← Bookings</a></div>
      <div class="ph1"><div><h1>${esc(b.booking_no)} ${bBadge(b.status)}</h1><p><a href="#/leads/${b.lead_id}">${esc(b.buyer_name)}</a> · ${phoneFmt(b.buyer_phone)} · ${esc(d.project.name)} · Plot ${esc(d.plot.plot_no)} · booked ${fmtDate(b.booked_on)}</p></div>
        <div class="row"><a class="btn" href="tel:+91${b.buyer_phone}" data-call="${b.lead_id}" data-call-name="${esc(b.buyer_name)}">📞 Call</a><button class="btn" data-wa="${b.lead_id}" data-wa-name="${esc(b.buyer_name)}" data-wa-phone="${b.buyer_phone}">💬 WhatsApp</button><button class="btn" data-a="edit">✏️ Buyer details</button></div></div>
      <div class="grid g2 stack"><div class="card"><h3>Price</h3><table class="price-t"><tr><td>Plot price (${b.area_sqyd} sq.yd × ${inr(b.rate)})</td><td class="right">${inr(b.base_amount)}</td></tr>${b.plc_amount ? `<tr><td>Preferential location charges</td><td class="right">${inr(b.plc_amount)}</td></tr>` : ''}${b.dev_amount ? `<tr><td>Development charges</td><td class="right">${inr(b.dev_amount)}</td></tr>` : ''}${b.reg_amount ? `<tr><td>Registration / stamp duty</td><td class="right">${inr(b.reg_amount)}</td></tr>` : ''}<tr class="tot"><td>Total</td><td class="right">${inr(b.total)}</td></tr></table></div>
        <div class="card"><h3>Plot & legal</h3><dl class="kv"><dt>Project</dt><dd>${esc(d.project.name)}${d.project.location ? ', ' + esc(d.project.location) : ''}</dd><dt>RERA / approval</dt><dd>${esc(d.project.rera_no || '—')} · ${esc(d.project.approval || '—')}</dd><dt>Plot</dt><dd>${esc(d.plot.plot_no)} · ${d.plot.area_sqyd} sq.yd${d.plot.facing ? ' · ' + esc(d.plot.facing) + ' facing' : ''}${d.plot.road_width_ft ? ' · ' + d.plot.road_width_ft + ' ft road' : ''}</dd><dt>Agreement</dt><dd>${b.agreement_date ? fmtDate(b.agreement_date) : '—'}</dd><dt>Registration</dt><dd>${b.registration_date ? fmtDate(b.registration_date) : '—'}</dd><dt>Buyer PAN</dt><dd>${esc(b.buyer_pan || '—')}</dd><dt>Address</dt><dd>${esc(b.buyer_address || '—')}</dd><dt>Notes</dt><dd>${esc(b.notes || '—')}</dd></dl></div>
        <div class="card"><div class="card-h"><h3>KYC documents</h3>${badge(d.lead.kyc_status || 'none', d.lead.kyc_status === 'verified' ? 'b-green' : d.lead.kyc_status === 'pending' ? 'b-amber' : '')}</div>${d.kyc.length ? d.kyc.map((k) => `<div class="list-row"><span>${esc(k.doc_type)}</span>${badge(k.status, k.status === 'verified' ? 'b-green' : k.status === 'rejected' ? 'b-red' : 'b-amber')}</div>`).join('') : '<p class="muted">No documents uploaded.</p>'}<a href="#/leads/${b.lead_id}" class="small">Manage on the lead page →</a></div></div>`;
      return;
    }
    const b = d.booking, sm = d.summary, pct = b.total ? Math.min(100, (sm.paid / b.total) * 100) : 0, cancelled = b.status === 'cancelled';
    root.innerHTML = `<div class="mb"><a href="#/bookings">← Bookings</a></div>
    <div class="ph1"><div><h1>${esc(b.booking_no)} ${bBadge(b.status)}</h1><p><a href="#/leads/${b.lead_id}">${esc(b.buyer_name)}</a> · ${phoneFmt(b.buyer_phone)} · ${esc(d.project.name)} · Plot ${esc(d.plot.plot_no)}${d.plot.block ? ' (Block ' + esc(d.plot.block) + ')' : ''} · Sold by ${esc(d.rep_name || '—')} on ${fmtDate(b.booked_on)}</p></div>
      <div class="row">${!cancelled ? '<button class="btn primary" data-a="pay">💰 Record payment</button>' : ''}<a class="btn" target="_blank" href="${authUrl('/bookings/' + b.id + '/statement')}">🖨 Statement</a><button class="btn" data-a="edit">✏️ Buyer details</button>
      ${admin && !cancelled ? `<button class="btn" data-a="sched">📅 Edit schedule</button>${b.status === 'booked' ? '<button class="btn" data-a="agreement">📝 Agreement signed</button>' : ''}${b.status !== 'registered' ? '<button class="btn" data-a="register">🏛 Mark registered</button><button class="btn danger" data-a="cancel">Cancel booking</button>' : ''}` : ''}</div></div>
    ${cancelled ? `<div class="err"><b>Cancelled</b> on ${fmtDate(b.cancelled_at)} — ${esc(b.cancel_reason)}. Retained ${inr(b.cancellation_charge)}, refunded ${inr(b.refund_amount)}.</div>` : ''}
    <div class="grid g4 keep mb"><div class="card kpi"><div class="l">Total price</div><div class="v">${inr(b.total)}</div></div><div class="card kpi"><div class="l">Received</div><div class="v" style="color:var(--green)">${inr(sm.paid)}</div></div><div class="card kpi"><div class="l">Outstanding</div><div class="v">${inr(sm.outstanding)}</div></div>
      <div class="card kpi"><div class="l">Overdue</div><div class="v" style="color:var(--${sm.overdue_amount ? 'red' : 'muted'})">${inr(sm.overdue_amount)}</div><div class="s">${sm.next_due ? 'Next: ' + esc(sm.next_due.label) + ' ' + fmtDate(sm.next_due.due_date) : ''}</div></div></div>
    <div class="bar mb ${pct < 30 ? 'amber' : ''}" style="height:12px"><i style="width:${pct}%"></i></div>
    <div class="grid g2 stack">
      <div class="grid" style="align-content:start">
        <div class="card"><h3>Payment schedule</h3><div class="tbl-wrap"><table class="tbl"><thead><tr><th>#</th><th>Description</th><th>Due</th><th class="r">Amount</th><th class="r">Paid</th><th>Status</th><th></th></tr></thead><tbody>
          ${d.installments.map((i) => `<tr><td>${i.seq}</td><td>${esc(i.label)}</td><td>${fmtDate(i.due_date)}</td><td class="r">${inr(i.amount)}</td><td class="r">${inr(i.paid_amount)}</td><td>${i.status === 'paid' ? badge('Paid', 'b-green') : i.overdue ? badge('Overdue', 'b-red') : i.status === 'partial' ? badge('Partial', 'b-amber') : badge('Pending')}</td><td>${!cancelled && i.status !== 'paid' ? `<button class="btn sm" data-pay="${i.id}">Pay</button>` : ''}</td></tr>`).join('')}</tbody></table></div></div>
        <div class="card"><h3>Receipts & refunds</h3>${d.payments.length ? d.payments.map((p) => `<div class="list-row"><div><b>${esc(p.receipt_no)}</b> ${p.kind === 'refund' ? badge('Refund', 'b-amber') : ''} ${p.voided ? badge('Voided', 'b-red') : ''}<div class="small muted">${fmtDate(p.paid_on)} · ${esc(p.mode || '')}${p.ref_no ? ' · ' + esc(p.ref_no) : ''} · by ${esc(p.received_by_name || '—')}${p.voided ? '<br>Void reason: ' + esc(p.void_reason) : ''}</div></div>
          <div class="row gap-s"><b style="${p.voided ? 'text-decoration:line-through' : ''}">${inr(p.amount)}</b><a class="btn sm" target="_blank" href="${authUrl('/payments/' + p.id + '/receipt')}">Receipt</a>${admin && !p.voided && p.kind === 'receipt' ? `<button class="btn sm danger" data-void="${p.id}">Void</button>` : ''}</div></div>`).join('') : '<p class="muted">No payments yet.</p>'}</div>
      </div>
      <div class="grid" style="align-content:start">
        <div class="card"><h3>Price breakup</h3><table class="price-t"><tr><td>Base price (${b.area_sqyd} sq.yd × ${inr(b.rate)})</td><td class="right">${inr(b.base_amount)}</td></tr>${b.plc_amount ? `<tr><td>Preferential location charges</td><td class="right">${inr(b.plc_amount)}</td></tr>` : ''}${b.dev_amount ? `<tr><td>Development charges</td><td class="right">${inr(b.dev_amount)}</td></tr>` : ''}${b.reg_amount ? `<tr><td>Registration / stamp duty</td><td class="right">${inr(b.reg_amount)}</td></tr>` : ''}${b.discount ? `<tr><td>Discount</td><td class="right" style="color:var(--green)">− ${inr(b.discount)}</td></tr>` : ''}<tr class="tot"><td>Total</td><td class="right">${inr(b.total)}</td></tr></table></div>
        <div class="card"><h3>Plot & legal</h3><dl class="kv"><dt>Project</dt><dd>${esc(d.project.name)}${d.project.location ? ', ' + esc(d.project.location) : ''}</dd><dt>RERA / approval</dt><dd>${esc(d.project.rera_no || '—')} · ${esc(d.project.approval || '—')}</dd><dt>Plot</dt><dd>${esc(d.plot.plot_no)} · ${d.plot.area_sqyd} sq.yd${d.plot.facing ? ' · ' + esc(d.plot.facing) + ' facing' : ''}${d.plot.road_width_ft ? ' · ' + d.plot.road_width_ft + ' ft road' : ''}</dd>
          <dt>Agreement</dt><dd>${b.agreement_date ? fmtDate(b.agreement_date) : '—'}</dd><dt>Registration</dt><dd>${b.registration_date ? fmtDate(b.registration_date) : '—'}</dd><dt>Buyer PAN</dt><dd>${esc(b.buyer_pan || '—')}</dd><dt>Address</dt><dd>${esc(b.buyer_address || '—')}</dd><dt>Notes</dt><dd>${esc(b.notes || '—')}</dd></dl></div>
        ${d.partner ? `<div class="card"><h3>Channel partner commission</h3><div class="list-row"><div><b>${esc(d.partner.name)}</b><div class="small muted">${d.partner.commission_pct}% · ${d.commission ? inr(d.commission.amount) : '—'}</div></div>${d.commission ? `<div class="row gap-s">${badge(d.commission.status, d.commission.status === 'paid' ? 'b-green' : d.commission.status === 'cancelled' ? 'b-red' : 'b-amber')}${admin && d.commission.status !== 'cancelled' && d.commission.status !== 'paid' ? `<button class="btn sm" data-comm="${d.commission.id}">Mark paid</button>` : ''}</div>` : ''}</div></div>` : ''}
        <div class="card"><div class="card-h"><h3>KYC documents</h3>${badge(d.lead.kyc_status || 'none', d.lead.kyc_status === 'verified' ? 'b-green' : d.lead.kyc_status === 'pending' ? 'b-amber' : '')}</div>${d.kyc.length ? d.kyc.map((k) => `<div class="list-row"><span>${esc(k.doc_type)}</span>${badge(k.status, k.status === 'verified' ? 'b-green' : k.status === 'rejected' ? 'b-red' : 'b-amber')}</div>`).join('') : '<p class="muted">No documents uploaded.</p>'}<a href="#/leads/${b.lead_id}" class="small">Manage on the lead page →</a></div>
      </div>
    </div>`;
  };
  on(root, 'click', '[data-a]', async (el) => {
    const a = el.dataset.a, b = cur.booking;
    if (a === 'pay') return paymentModal(b, cur.summary, cur.installments, load);
    if (a === 'edit') return modalForm({ title: 'Buyer details', body: `<div class="frm-g">${fld('Name', inp('buyer_name', b.buyer_name))}${fld('Mobile', inp('buyer_phone', b.buyer_phone, 'data-v="phone" inputmode="tel"'))}${fld('PAN', inp('buyer_pan', b.buyer_pan || '', 'maxlength="10"'))}${fld('Address', inp('buyer_address', b.buyer_address || ''))}${fld('Notes', `<textarea name="notes">${esc(b.notes || '')}</textarea>`, '', 'full')}</div>`, onSubmit: async (d) => { await patch('/bookings/' + id, d); toast('Saved', 'ok'); load(); } });
    if (a === 'agreement' || a === 'register') {
      const st = a === 'agreement' ? 'agreement' : 'registered';
      return modalForm({ title: st === 'agreement' ? 'Agreement of sale signed' : 'Sale deed registered', body: fld('Date', inp('date', today(), `type="date" max="${today()}"`)), onSubmit: async (d) => {
        try { await post(`/bookings/${id}/status`, { status: st, date: d.date }); } catch (e) { if (e.data?.can_force && await confirmDialog(esc(e.message) + '<br><br>Register anyway?', { ok: 'Register anyway', danger: true })) await post(`/bookings/${id}/status`, { status: st, date: d.date, force: true }); else throw e; }
        toast('Updated', 'ok'); load(); } });
    }
    if (a === 'cancel') return modalForm({ title: `Cancel ${b.booking_no}`, submit: 'Cancel booking', danger: true, body: `<div class="warn-box">The plot will be released. Money received: <b>${inr(cur.summary.paid)}</b>. The refund = received − cancellation charge.</div>${fld('Reason', '<textarea name="reason"></textarea>')}<div class="frm-g">${fld('Cancellation charge retained (₹)', inp('charge', '0', 'type="number" min="0"'))}${fld('Refund mode', sel('refund_mode', MODES, 'Bank Transfer'))}${fld('Refund reference', inp('refund_ref'))}</div>`,
      onSubmit: async (d) => { const r = await post(`/bookings/${id}/cancel`, { ...d, charge: Number(d.charge) || 0 }); toast(`Cancelled. Refund of ${inr(r.refund)} recorded.`, 'ok'); load(); } });
    if (a === 'sched') return modalForm({ title: 'Edit payment schedule', wide: true, submit: 'Save schedule', body: `<p class="muted small">You can change due dates, and amounts of instalments that have no payment yet. The total must stay ${inr(b.total)}.</p><table class="tbl"><thead><tr><th>Description</th><th>Due date</th><th class="r">Amount</th></tr></thead><tbody>${cur.installments.map((i) => `<tr><td>${esc(i.label)}</td><td><input type="date" data-id="${i.id}" data-k="due_date" value="${i.due_date}"></td><td><input type="number" data-id="${i.id}" data-k="amount" value="${i.amount}" ${i.paid_amount > 0 ? 'disabled' : ''} style="text-align:right"></td></tr>`).join('')}</tbody></table>`,
      onSubmit: async (d, m) => { const map = {}; $$('[data-id]', m.el).forEach((e) => { (map[e.dataset.id] ||= { id: Number(e.dataset.id) })[e.dataset.k] = e.dataset.k === 'amount' ? Number(e.value) : e.value; }); await put(`/bookings/${id}/schedule`, { changes: Object.values(map) }); toast('Schedule updated', 'ok'); load(); } });
  });
  on(root, 'click', '[data-pay]', (el) => paymentModal(cur.booking, cur.summary, cur.installments, load, Number(el.dataset.pay)));
  on(root, 'click', '[data-void]', async (el) => { const r = await askText('Void receipt', 'Reason for voiding (e.g. cheque bounced)'); if (!r) return; try { await post(`/payments/${el.dataset.void}/void`, { reason: r }); toast('Receipt voided', 'ok'); load(); } catch (e) { toast(e.message, 'err'); } });
  on(root, 'click', '[data-comm]', async (el) => { await post(`/commissions/${el.dataset.comm}/status`, { status: 'paid' }); toast('Commission marked paid', 'ok'); load(); });
  await load();
  if (q.pay && cur && admin) paymentModal(cur.booking, cur.summary, cur.installments, load, Number(q.pay));
}

// ================= collections =================
export async function collections(root) {
  const admin = isAdmin(); let tab = 'overdue', data;
  const draw = () => {
    const rows = data.rows.filter((r) => tab === 'all' || r.bucket === tab), s = data.summary;
    root.innerHTML = `<div class="ph1"><div><h1>Collections</h1><p>Instalments still to be collected${admin ? '' : ' on your bookings'}</p></div>${admin ? `<a class="btn" href="${authUrl('/export/collections')}">⬇ Export dues</a>` : ''}</div>
    <div class="grid g4 keep mb"><div class="card kpi"><div class="l">Overdue</div><div class="v" style="color:var(--red)">${inrShort(s.overdue)}</div></div><div class="card kpi"><div class="l">Due in next 7 days</div><div class="v" style="color:var(--amber)">${inrShort(s.week)}</div></div><div class="card kpi"><div class="l">Later</div><div class="v">${inrShort(s.later)}</div></div><div class="card kpi"><div class="l">Collected this month</div><div class="v" style="color:var(--green)">${inrShort(s.collected_month)}</div></div></div>
    <div class="tabs">${[['overdue', 'Overdue'], ['week', 'Next 7 days'], ['later', 'Later'], ['all', 'All']].map(([k, l]) => `<button data-t="${k}" class="${tab === k ? 'on' : ''}">${l}${k !== 'all' ? ` <span class="muted small">(${data.rows.filter((r) => r.bucket === k).length})</span>` : ''}</button>`).join('')}</div>
    ${rows.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Buyer</th><th>Booking</th><th>Instalment</th><th>Due date</th><th class="r">Pending</th>${admin ? '<th>Rep</th>' : ''}<th></th></tr></thead><tbody>${rows.map((r) => `<tr><td><b>${esc(r.buyer_name)}</b><div class="muted small">${phoneFmt(r.buyer_phone)}</div></td><td><a href="#/bookings/${r.booking_id}">${esc(r.booking_no)}</a><div class="muted small">${esc(r.project_name)} · Plot ${esc(r.plot_no)}</div></td><td>${esc(r.label)}</td>
      <td>${fmtDate(r.due_date)}<div class="small" style="color:var(--${r.bucket === 'overdue' ? 'red' : 'muted'})">${r.days < 0 ? Math.abs(r.days) + ' days overdue' : r.days === 0 ? 'due today' : 'in ' + r.days + ' days'}</div></td><td class="r"><b>${inr(r.due)}</b></td>${admin ? `<td>${esc(r.rep_name || '—')}</td>` : ''}
      <td class="nowrap right"><a class="btn sm" href="tel:+91${r.buyer_phone}" data-call="${r.lead_id}" data-call-name="${esc(r.buyer_name)}">📞</a> <a class="btn sm" target="_blank" href="${waLink(r.buyer_phone, `Dear ${r.buyer_name}, this is a reminder from ${S.org.name} that ${inr(r.due)} towards ${r.label} (${r.booking_no}) ${r.days < 0 ? 'was due on' : 'is due on'} ${fmtDate(r.due_date)}. Kindly pay via UPI/bank transfer and share the reference. Thank you.`)}">💬 Remind</a> <a class="btn sm primary" href="#/bookings/${r.booking_id}?pay=${r.id}">Record</a></td></tr>`).join('')}</tbody></table></div>` : empty('Nothing here 🎉', 'No instalments in this bucket.')}`;
  };
  on(root, 'click', '[data-t]', (el) => { tab = el.dataset.t; draw(); });
  data = await get('/collections'); if (!data.rows.some((r) => r.bucket === 'overdue')) tab = 'week'; draw();
}

// ================= discounts =================
export async function discounts(root) {
  const admin = isAdmin(); let rows = [];
  const draw = () => {
    root.innerHTML = `<div class="ph1"><div><h1>Discount approvals</h1><p>${admin ? 'Approve or reject discounts above each project\'s self-approved limit. All decisions are logged.' : 'Your discount requests and their status'}</p></div></div>
    ${rows.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Lead</th><th>Plot</th><th class="r">Requested</th><th>Limit</th><th>Requested by</th><th>Status</th>${admin ? '<th></th>' : ''}</tr></thead><tbody>${rows.map((r) => {
      const lim = Math.round(r.base_amount * r.max_discount_pct / 100);
      return `<tr><td><a href="#/leads/${r.lead_id}">${esc(r.lead_name)}</a><div class="muted small">${esc(r.reason || '')}</div></td><td>${esc(r.project_name)} · ${esc(r.plot_no)}</td><td class="r"><b>${inr(r.amount)}</b></td><td class="small">${inr(lim)} (${r.max_discount_pct}%)</td><td>${esc(r.requested_by_name || '—')}<div class="small muted">${rel(r.created_at)}</div></td>
      <td>${badge(r.status + (r.status === 'approved' && r.used ? ' · used' : ''), r.status === 'approved' ? 'b-green' : r.status === 'rejected' ? 'b-red' : 'b-amber')}${r.decision_note ? `<div class="small muted">${esc(r.decision_note)}</div>` : ''}${r.decided_by_name ? `<div class="small muted">by ${esc(r.decided_by_name)}</div>` : ''}</td>
      ${admin ? `<td class="nowrap">${r.status === 'pending' ? `<button class="btn sm primary" data-d="approve" data-id="${r.id}" data-amt="${r.amount}">Approve</button> <button class="btn sm danger" data-d="reject" data-id="${r.id}">Reject</button>` : ''}</td>` : ''}</tr>`; }).join('')}</tbody></table></div>` : empty('No discount requests', 'Reps raise a request from a lead when a customer needs a bigger discount.')}`;
  };
  on(root, 'click', '[data-d]', (el) => {
    const approve = el.dataset.d === 'approve';
    modalForm({ title: approve ? 'Approve discount' : 'Reject discount', submit: approve ? 'Approve' : 'Reject', danger: !approve, body: (approve ? fld('Approved amount (₹)', inp('amount', el.dataset.amt, 'type="number"'), 'You can approve a lower amount') : '') + fld('Note to rep', '<textarea name="note"></textarea>'),
      onSubmit: async (d) => { await post(`/discounts/${el.dataset.id}/decide`, { decision: el.dataset.d, amount: d.amount ? Number(d.amount) : undefined, note: d.note }); toast('Decision saved', 'ok'); rows = await get('/discounts'); draw(); } });
  });
  rows = await get('/discounts'); draw();
}

/** After a payment is saved: offer to send the buyer a WhatsApp confirmation. */
function receiptWhatsApp(b, amount, r) {
  const phone = b.buyer_phone || b.lead_phone;
  if (!phone) return;
  const first = String(b.buyer_name || b.lead_name || '').split(' ')[0] || 'there';
  const text = `Hi ${first}, we have received ₹${Number(amount).toLocaleString('en-IN')} towards booking ${b.booking_no}${r.receipt_no ? ' (receipt ' + r.receipt_no + ')' : ''}. Thank you! — ${S.org.name}`;
  snack(`Payment saved. Send ${first} a confirmation?`, 'WhatsApp', () => window.open(waLink(String(phone).slice(-10), text), '_blank'), 12000);
}
