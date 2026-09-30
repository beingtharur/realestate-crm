// Public pages (no sign-in): client booking portal and lead enquiry form.
import { $, $$, esc, on, inr, fmtDate, fld, inp, sel, badge, phoneFmt, waLink, toast } from './core.js';

const pub = async (method, path, body) => {
  const res = await fetch('/api' + path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || 'Something went wrong'); e.status = res.status; throw e; }
  return data;
};
const readB64 = (f) => new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result.split(',')[1]); fr.readAsDataURL(f); });

export async function portal(root, { token }) {
  let d;
  try { d = await pub('GET', '/portal/' + token); }
  catch (e) { root.innerHTML = `<div class="auth"><div class="card"><div class="logo">🏡 Client portal</div><div class="err">${esc(e.message)}</div></div></div>`; return; }
  const draw = () => {
    root.innerHTML = `<div class="portal"><div class="card mb" style="background:var(--brand);color:#fff;border:0"><div style="font-size:12px;opacity:.8">${esc(d.company.name)}</div><h1>Hello, ${esc(d.client.name)} 👋</h1><div style="opacity:.9">Your booking status, payment schedule and documents in one place.</div></div>
    ${d.rep ? `<div class="card mb row between"><div><div class="muted small">Your sales contact</div><b>${esc(d.rep.name)}</b></div><div class="row">${d.rep.phone ? `<a class="btn sm" href="tel:+91${d.rep.phone}">📞 Call</a><a class="btn sm" target="_blank" href="${waLink(d.rep.phone)}">💬 WhatsApp</a>` : ''}</div></div>` : ''}
    ${d.bookings.length ? d.bookings.map((b) => { const pct = b.total ? Math.min(100, (b.paid / b.total) * 100) : 0; return `<div class="card mb"><div class="card-h"><h3>${esc(b.project)} — Plot ${esc(b.plot_no)}</h3>${badge(b.status, b.status === 'registered' ? 'b-green' : b.status === 'cancelled' ? 'b-red' : 'b-blue')}</div>
      <div class="muted small">${esc(b.booking_no)} · ${b.area_sqyd} sq.yd${b.facing ? ' · ' + esc(b.facing) + ' facing' : ''}${b.location ? ' · ' + esc(b.location) : ''}${b.rera_no ? ' · RERA ' + esc(b.rera_no) : ''} · booked ${fmtDate(b.booked_on)}</div>
      <div class="stat-row mt"><div><b>${inr(b.total)}</b><span class="small muted">Total price</span></div><div><b style="color:var(--green)">${inr(b.paid)}</b><span class="small muted">Paid</span></div><div><b>${inr(b.outstanding)}</b><span class="small muted">Balance</span></div>${b.overdue_amount ? `<div><b style="color:var(--red)">${inr(b.overdue_amount)}</b><span class="small muted">Overdue</span></div>` : ''}</div>
      <div class="bar mt"><i style="width:${pct}%"></i></div>${b.next_due ? `<p class="small mt">Next payment: <b>${esc(b.next_due.label)}</b> — ${inr(b.next_due.due)} by ${fmtDate(b.next_due.due_date)}</p>` : ''}
      <details class="acc mt"><summary>Payment schedule</summary><div class="in"><table class="tbl"><thead><tr><th>Instalment</th><th>Due</th><th class="r">Amount</th><th>Status</th></tr></thead><tbody>${b.installments.map((i) => `<tr><td>${esc(i.label)}</td><td>${fmtDate(i.due_date)}</td><td class="r">${inr(i.amount)}</td><td>${i.status === 'paid' ? badge('Paid', 'b-green') : i.status === 'partial' ? badge('Partial', 'b-amber') : badge(i.due_date < new Date().toISOString().slice(0, 10) ? 'Overdue' : 'Upcoming', i.due_date < new Date().toISOString().slice(0, 10) ? 'b-red' : '')}</td></tr>`).join('')}</tbody></table></div></details>
      <details class="acc"><summary>Payments received (${b.receipts.length})</summary><div class="in">${b.receipts.map((r) => `<div class="list-row"><span>${esc(r.receipt_no)} · ${fmtDate(r.paid_on)} · ${esc(r.mode || '')}</span><b>${inr(r.amount)}</b></div>`).join('') || '<p class="muted">None yet.</p>'}</div></details></div>`; }).join('') : '<div class="card mb muted">No bookings on your account yet.</div>'}
    <div class="card mb"><div class="card-h"><h3>KYC documents</h3>${badge(d.kyc_status === 'none' ? 'Not started' : d.kyc_status, d.kyc_status === 'verified' ? 'b-green' : d.kyc_status === 'rejected' ? 'b-red' : 'b-amber')}</div>
      <p class="small muted">Please upload: ${d.required.join(', ')}. PDF, JPG or PNG up to 6 MB.</p>
      ${d.documents.map((x) => `<div class="list-row"><div><b>${esc(x.doc_type)}</b><div class="small muted">${fmtDate(x.uploaded_at)}${x.remark ? ' · ' + esc(x.remark) : ''}</div></div>${badge(x.status, x.status === 'verified' ? 'b-green' : x.status === 'rejected' ? 'b-red' : 'b-amber')}</div>`).join('')}
      <div id="kerr"></div><div class="row mt" style="flex-wrap:nowrap">${sel('doc_type', d.doc_types, d.doc_types[0], 'id="kt" style="width:auto"')}<input type="file" id="kf" accept=".pdf,.jpg,.jpeg,.png,image/*"><button class="btn primary" id="ku">Upload</button></div></div>
    <div class="card mb"><h3>EMI calculator</h3><p class="small muted">Planning a home-loan / plot-loan? Estimate your monthly EMI.</p><div class="frm-g">${fld('Loan amount (₹)', inp('amt', Math.round(d.bookings[0]?.outstanding || 2000000), 'type="number" id="ea"'))}${fld('Interest rate (% per year)', inp('rate', 9.5, 'type="number" step="0.1" id="er"'))}${fld('Tenure (years)', inp('yrs', 10, 'type="number" id="ey"'))}<div class="fld"><span>Monthly EMI</span><div style="font-size:24px;font-weight:700" id="emi"></div><small id="emiS"></small></div></div></div>
    <p class="center muted small">${esc(d.company.name)}${d.company.phone ? ' · ' + esc(d.company.phone) : ''}${d.company.address ? ' · ' + esc(d.company.address) : ''}</p></div>`;
    const calc = () => { const P = +$('#ea').value, r = +$('#er').value / 1200, n = +$('#ey').value * 12; const e = r ? (P * r * (1 + r) ** n) / ((1 + r) ** n - 1) : P / (n || 1); $('#emi').textContent = isFinite(e) ? inr(e) : '—'; $('#emiS').textContent = isFinite(e) ? `Total interest ${inr(e * n - P)} · total payable ${inr(e * n)}` : ''; };
    ['ea', 'er', 'ey'].forEach((i) => ($('#' + i).oninput = calc)); calc();
    $('#ku').onclick = async () => {
      const f = $('#kf').files[0]; const err = $('#kerr'); err.innerHTML = '';
      if (!f) { err.innerHTML = '<div class="err">Choose a file first</div>'; return; }
      $('#ku').disabled = true;
      try { await pub('POST', `/portal/${token}/kyc`, { doc_type: $('#kt').value, filename: f.name, data_base64: await readB64(f) }); d = await pub('GET', '/portal/' + token); toast('Uploaded — thank you!', 'ok'); draw(); }
      catch (e) { err.innerHTML = `<div class="err">${esc(e.message)}</div>`; $('#ku').disabled = false; }
    };
  };
  draw();
}

export async function enquire(root, { code }) {
  let org;
  try { org = await pub('GET', '/public/org/' + code); } catch (e) { root.innerHTML = `<div class="auth"><div class="card"><div class="err">${esc(e.message)}</div></div></div>`; return; }
  root.innerHTML = `<div class="auth"><div class="card"><div class="logo">🏡 ${esc(org.name)}</div><h1>Plot enquiry</h1><p class="muted">Tell us what you're looking for and our team will call you shortly.</p><div id="e"></div><form id="f">
    ${fld('Your name *', inp('name', '', 'required'))}${fld('Mobile number *', inp('phone', '', 'required inputmode="tel" placeholder="98765 43210"'))}${fld('Email', inp('email', '', 'type="email"'))}
    ${org.projects.length ? fld('Interested project', sel('project_id', [['', 'Not sure yet'], ...org.projects.map((p) => [p.id, p.name + (p.location ? ' — ' + p.location : '')])])) : ''}${fld('Preferred plot size (sq.yd)', inp('size', '', 'type="number"'))}${fld('Message', '<textarea name="message"></textarea>')}
    <input name="website" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px" aria-hidden="true">
    <label class="row mb"><input type="checkbox" name="consent"> <span class="small">I agree to be contacted by ${esc(org.name)} by phone, SMS and WhatsApp about my enquiry.</span></label>
    <button class="btn primary" style="width:100%;justify-content:center">Request a call back</button></form></div></div>`;
  $('#f').onsubmit = async (e) => {
    e.preventDefault(); const f = Object.fromEntries([...new FormData(e.target)]); f.consent = e.target.consent.checked;
    try { const r = await pub('POST', '/public/enquire/' + code, f); $('.card', root).innerHTML = `<div class="logo">🏡 ${esc(org.name)}</div><h1>Thank you! 🙏</h1><p>${esc(r.message)}</p>`; }
    catch (err) { $('#e').innerHTML = `<div class="err">${esc(err.message)}</div>`; }
  };
}
