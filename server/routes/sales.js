// Bookings, payment plans, payments & receipts, cancellations, collections, KYC + client portal.
const fs = require('fs');
const path = require('path');
const { r, raw } = require('../router');
const { all, get, run, tx, DATA_DIR } = require('../db');
const L = require('../lib');
const { HttpError, bad, forbidden, notFound, now, str, num, round, newToken } = L;

const PAY_MODES = ['UPI', 'Bank Transfer', 'Cheque', 'Cash', 'Demand Draft', 'Card', 'Loan Disbursement'];
const KYC_TYPES = ['Aadhaar Card', 'PAN Card', 'Passport Photo', 'Address Proof', 'Bank Statement', 'Other'];
const KYC_REQUIRED = ['Aadhaar Card', 'PAN Card', 'Passport Photo'];
const CASH_LIMIT = 200000; // Income Tax Act s.269ST — cash receipts of ₹2 lakh or more are not allowed
const money = (n) => '₹' + Math.round(n || 0).toLocaleString('en-IN');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function addDays(d, n) { const t = new Date(`${d}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); }
function validDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !isNaN(Date.parse(s)); }

/** Payment plan: token now, down-payment %, N equal EMIs, and a final % due at registration. */
function buildPlan(total, o = {}) {
  const start = validDate(o.start_date) ? o.start_date : L.istDate();
  const token = Math.min(round(o.token_amount), total);
  const downPct = Math.min(100, Math.max(0, num(o.down_pct) ?? 20));
  const emiCount = Math.max(0, Math.min(120, Math.floor(num(o.emi_count) ?? 0)));
  const interval = Math.max(1, Math.floor(num(o.emi_interval_days) ?? 30));
  const finalPct = emiCount ? Math.min(100 - downPct, Math.max(0, num(o.final_pct) ?? 0)) : 0;
  const rows = [];
  const down = Math.max(0, Math.min(total - token, round((total * downPct) / 100) - token));
  const downDue = addDays(start, 7);
  if (down > 0) rows.push({ label: 'Down payment', due_date: downDue, amount: down });
  let remaining = total - token - down;
  if (emiCount && remaining > 0) {
    const finalAmt = Math.min(remaining, round((total * finalPct) / 100));
    const emiTotal = remaining - finalAmt;
    const each = Math.floor(emiTotal / emiCount);
    let dueDate = downDue;
    for (let k = 1; k <= emiCount; k++) {
      dueDate = addDays(dueDate, interval);
      rows.push({ label: `EMI ${k}/${emiCount}`, due_date: dueDate, amount: k === emiCount ? emiTotal - each * (emiCount - 1) : each });
    }
    if (finalAmt > 0) rows.push({ label: 'Balance at registration', due_date: addDays(dueDate, interval), amount: finalAmt });
  } else if (remaining > 0) rows.push({ label: 'Balance at registration', due_date: addDays(downDue, interval * 2), amount: remaining });
  return rows.filter((x) => x.amount > 0);
}

function bookingFor(ctx, id) {
  const b = get('SELECT * FROM bookings WHERE id=? AND org_id=?', Number(id), ctx.oid);
  if (!b || (!ctx.isAdmin && b.sold_by !== ctx.user.id)) throw notFound('Booking not found');
  return b;
}
const receiptNo = (oid) => L.nextNo(oid, 'RCP', 'payments', 'receipt_no');

r.post('/api/bookings/preview', (ctx) => {
  const b = ctx.body;
  const pl = get('SELECT * FROM plots WHERE id=? AND org_id=?', Number(b.plot_id), ctx.oid);
  if (!pl) throw bad('Choose a plot');
  const pr = get('SELECT * FROM projects WHERE id=?', pl.project_id);
  if (!ctx.isAdmin && num(b.discount)) throw bad('Discounts can only be applied by an admin');
  const price = L.priceFor(pl, pr, num(b.discount) || 0);
  const token = round(b.token_amount);
  const out = { price, plot: pl, project: { id: pr.id, name: pr.name }, token_amount: token, installments: buildPlan(price.total, b), discount_needs_approval: price.discount > price.max_discount };
  if (!ctx.isAdmin) { delete price.max_discount; delete price.discount; delete out.discount_needs_approval; }
  return out;
});

r.post('/api/bookings', (ctx) => {
  const b = ctx.body;
  const lead = get('SELECT * FROM leads WHERE id=? AND org_id=?', Number(b.lead_id), ctx.oid);
  if (!lead || (!ctx.isAdmin && lead.assigned_to !== ctx.user.id)) throw notFound('Lead not found');
  if (lead.stage === 'Lost') throw bad('Re-open this lead (move it out of Lost) before booking a plot');
  const out = tx(() => {
    const pl = get('SELECT * FROM plots WHERE id=? AND org_id=?', Number(b.plot_id), ctx.oid);
    if (!pl) throw bad('Choose a plot');
    if (pl.status === 'hold' && pl.hold_lead_id !== lead.id) throw bad('This plot is on hold for another customer');
    if (!['available', 'hold'].includes(pl.status)) throw bad(`Plot ${pl.plot_no} is ${pl.status} and cannot be booked`);
    const pr = get('SELECT * FROM projects WHERE id=?', pl.project_id);
    const price = L.priceFor(pl, pr, num(b.discount) || 0);
    if (price.discount && !ctx.isAdmin) throw bad('Discounts can only be applied by an admin');
    const approvedReq = ctx.isAdmin && price.discount ? get("SELECT * FROM discount_requests WHERE org_id=? AND lead_id=? AND plot_id=? AND status='approved' AND used=0 AND amount>=? ORDER BY id DESC", ctx.oid, lead.id, pl.id, price.discount) : null;
    const token = round(b.token_amount);
    if (token <= 0) throw bad('Enter the token / booking amount received');
    if (token > price.total) throw bad('Token amount cannot exceed the plot price');
    if (token >= CASH_LIMIT && b.token_mode === 'Cash') throw bad('Cash payments of ₹2,00,000 or more are not permitted (Income Tax Act §269ST). Use UPI, cheque or bank transfer.');
    const modes = b.token_mode || 'UPI'; if (!PAY_MODES.includes(modes)) throw bad('Choose a valid payment mode');
    const bookedOn = validDate(b.booked_on) ? b.booked_on : L.istDate();
    if (bookedOn > L.istDate()) throw bad('Booking date cannot be in the future');
    let plan = Array.isArray(b.installments) && b.installments.length ? b.installments : buildPlan(price.total, { ...b, start_date: bookedOn });
    plan = plan.map((x) => ({ label: str(x.label) || 'Instalment', due_date: x.due_date, amount: round(x.amount) }));
    if (plan.some((x) => !validDate(x.due_date) || x.amount <= 0)) throw bad('Every instalment needs a valid due date and amount');
    const sum = plan.reduce((s, x) => s + x.amount, 0);
    if (Math.abs(sum + token - price.total) > 1) throw bad(`Payment schedule (${money(sum + token)}) must add up to the plot price (${money(price.total)})`);
    const partnerId = b.partner_id ? Number(b.partner_id) : lead.partner_id;
    const partner = partnerId ? get('SELECT * FROM partners WHERE id=? AND org_id=?', partnerId, ctx.oid) : null;
    const soldBy = lead.assigned_to || ctx.user.id;
    const bookingNo = L.nextNo(ctx.oid, 'BK', 'bookings', 'booking_no');
    const x = run(`INSERT INTO bookings(org_id,booking_no,lead_id,plot_id,project_id,partner_id,sold_by,area_sqyd,rate,base_amount,plc_amount,dev_amount,reg_amount,discount,total,token_amount,booked_on,
      buyer_name,buyer_phone,buyer_address,buyer_pan,notes,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ctx.oid, bookingNo, lead.id, pl.id, pl.project_id, partner?.id, soldBy, price.area, price.rate, price.base, price.plc, price.dev, price.reg, price.discount, price.total, token, bookedOn,
      str(b.buyer_name) || lead.name, L.normPhone(b.buyer_phone) || lead.phone_norm, str(b.buyer_address), str(b.buyer_pan)?.toUpperCase(), str(b.notes), ctx.user.id, now());
    const bid = Number(x.lastInsertRowid);
    run('INSERT INTO installments(org_id,booking_id,seq,label,due_date,amount) VALUES (?,?,?,?,?,?)', ctx.oid, bid, 0, 'Token / booking amount', bookedOn, token);
    plan.forEach((p, i) => run('INSERT INTO installments(org_id,booking_id,seq,label,due_date,amount) VALUES (?,?,?,?,?,?)', ctx.oid, bid, i + 1, p.label, p.due_date, p.amount));
    const pay = run('INSERT INTO payments(org_id,booking_id,receipt_no,amount,mode,ref_no,paid_on,received_by,note,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      ctx.oid, bid, receiptNo(ctx.oid), token, modes, str(b.token_ref), bookedOn, ctx.user.id, 'Token / booking amount', now());
    L.allocatePayment(ctx.oid, bid, Number(pay.lastInsertRowid), token);
    run("UPDATE plots SET status='booked', hold_lead_id=NULL, hold_until=NULL, hold_by=NULL WHERE id=?", pl.id);
    if (approvedReq) run('UPDATE discount_requests SET used=1 WHERE id=?', approvedReq.id);
    if (partner && partner.commission_pct > 0) {
      const cbase = price.base + price.plc - price.discount;
      run('INSERT INTO commissions(org_id,booking_id,partner_id,pct,amount,created_at) VALUES (?,?,?,?,?,?)', ctx.oid, bid, partner.id, partner.commission_pct, round((cbase * partner.commission_pct) / 100), now());
    }
    L.logActivity(ctx.oid, lead.id, ctx.user.id, 'booking', { content: `Booked Plot ${pl.plot_no} (${pr.name}) — ${money(price.total)}, token ${money(token)}. ${bookingNo}`, meta: { booking_id: bid } });
    L.setStage(ctx.oid, lead.id, 'Booked', ctx.user, { allowBooked: true });
    if (price.discount > price.max_discount) L.audit(ctx.oid, ctx.user.id, 'booking.discount_override', 'booking', bid, `${money(price.discount)} above limit ${money(price.max_discount)}`);
    L.notifyAdmins(ctx.oid, 'New booking 🎉', `${lead.name} booked Plot ${pl.plot_no} in ${pr.name} — ${money(price.total)} (${bookingNo})`, `#/bookings/${bid}`);
    if (soldBy !== ctx.user.id) L.notify(ctx.oid, { user: soldBy, title: 'Booking created on your lead', message: `${lead.name} — Plot ${pl.plot_no}, ${money(price.total)}`, link: `#/bookings/${bid}` });
    L.audit(ctx.oid, ctx.user.id, 'booking.create', 'booking', bid, bookingNo);
    return { id: bid, booking_no: bookingNo, payment_id: Number(pay.lastInsertRowid) };
  });
  return out;
});

const BOOKING_LIST = `SELECT b.*, l.name AS lead_name, l.phone_norm AS lead_phone, pl.plot_no, pr.name AS project_name, u.name AS rep_name,
  (SELECT COALESCE(SUM(amount),0) FROM payments p WHERE p.booking_id=b.id AND p.kind='receipt' AND p.voided=0) AS paid,
  (SELECT COALESCE(SUM(i.amount-i.paid_amount),0) FROM installments i WHERE i.booking_id=b.id AND i.due_date < ? AND i.paid_amount < i.amount-0.5 AND b.status<>'cancelled') AS overdue_amount
  FROM bookings b JOIN leads l ON l.id=b.lead_id JOIN plots pl ON pl.id=b.plot_id JOIN projects pr ON pr.id=b.project_id LEFT JOIN users u ON u.id=b.sold_by WHERE b.org_id=?`;
/** What a representative may see of a booking: the sale itself, never money collected, dues, discount or commission. */
function salesView(b) {
  const { paid, outstanding, overdue_amount, discount, token_amount, cancellation_charge, refund_amount, ...rest } = b;
  return { ...rest, base_amount: (b.base_amount || 0) - (discount || 0) }; // discount folded into the plot price so the breakup still adds up
}
r.get('/api/bookings', (ctx) => {
  const q = ctx.query; const a = [L.istDate(), ctx.oid]; let sql = BOOKING_LIST;
  if (!ctx.isAdmin) { sql += ' AND b.sold_by=?'; a.push(ctx.user.id); } else if (q.rep) { sql += ' AND b.sold_by=?'; a.push(Number(q.rep)); }
  if (q.status) { sql += ' AND b.status=?'; a.push(q.status); }
  if (q.project_id) { sql += ' AND b.project_id=?'; a.push(Number(q.project_id)); }
  if (q.q) { sql += ' AND (l.name LIKE ? OR b.booking_no LIKE ? OR pl.plot_no LIKE ? OR b.buyer_name LIKE ?)'; const t = `%${q.q}%`; a.push(t, t, t, t); }
  sql += ' ORDER BY b.id DESC LIMIT 500';
  const rows = all(sql, ...a).map((b) => ({ ...b, outstanding: b.status === 'cancelled' ? 0 : Math.max(0, b.total - b.paid) }));
  return ctx.isAdmin ? rows : rows.map(salesView);
});
r.get('/api/bookings/:id', (ctx) => {
  const b = bookingFor(ctx, ctx.params.id);
  const today = L.istDate();
  const installments = all('SELECT * FROM installments WHERE booking_id=? ORDER BY seq', b.id).map((i) => ({ ...i, overdue: b.status !== 'cancelled' && i.due_date < today && i.paid_amount < i.amount - 0.5 }));
  const payments = all('SELECT p.*, u.name AS received_by_name FROM payments p LEFT JOIN users u ON u.id=p.received_by WHERE p.booking_id=? ORDER BY p.id DESC', b.id);
  if (!ctx.isAdmin) { // sales view: what was sold and to whom — no collections, payment schedule, discount or commission data
    return {
      booking: salesView(b), lead: get('SELECT id,name,phone_norm,email,kyc_status FROM leads WHERE id=?', b.lead_id),
      plot: get('SELECT * FROM plots WHERE id=?', b.plot_id), project: get('SELECT id,name,location,city,rera_no,approval,developer FROM projects WHERE id=?', b.project_id),
      partner: b.partner_id ? get('SELECT id,name FROM partners WHERE id=?', b.partner_id) : null, rep_name: b.sold_by ? get('SELECT name FROM users WHERE id=?', b.sold_by)?.name : null,
      kyc: all('SELECT id,doc_type,filename,status,remark,uploaded_at FROM kyc_docs WHERE org_id=? AND lead_id=? ORDER BY id DESC', ctx.oid, b.lead_id),
    };
  }
  return {
    booking: b, summary: L.bookingSummary(ctx.oid, b.id), installments, payments,
    lead: get('SELECT id,name,phone_norm,email,kyc_status,portal_token,portal_expires FROM leads WHERE id=?', b.lead_id),
    plot: get('SELECT * FROM plots WHERE id=?', b.plot_id), project: get('SELECT id,name,location,city,rera_no,approval,developer FROM projects WHERE id=?', b.project_id),
    partner: b.partner_id ? get('SELECT id,name,phone,commission_pct FROM partners WHERE id=?', b.partner_id) : null,
    commission: get('SELECT * FROM commissions WHERE booking_id=?', b.id) || null,
    rep_name: b.sold_by ? get('SELECT name FROM users WHERE id=?', b.sold_by)?.name : null,
    kyc: all('SELECT id,doc_type,filename,status,remark,uploaded_at FROM kyc_docs WHERE org_id=? AND lead_id=? ORDER BY id DESC', ctx.oid, b.lead_id),
  };
});
r.patch('/api/bookings/:id', (ctx) => {
  const b = bookingFor(ctx, ctx.params.id), x = ctx.body;
  let phone = b.buyer_phone; if ('buyer_phone' in x) { phone = x.buyer_phone ? L.normPhone(x.buyer_phone) : null; if (x.buyer_phone && !phone) throw bad('Enter a valid Indian mobile number'); }
  if (x.buyer_pan && !/^[A-Za-z]{5}\d{4}[A-Za-z]$/.test(String(x.buyer_pan).trim())) throw bad('PAN format looks wrong (e.g. ABCDE1234F)');
  run('UPDATE bookings SET buyer_name=?, buyer_phone=?, buyer_address=?, buyer_pan=?, notes=? WHERE id=?', str(x.buyer_name) || b.buyer_name, phone,
    'buyer_address' in x ? str(x.buyer_address) : b.buyer_address, 'buyer_pan' in x ? str(x.buyer_pan)?.toUpperCase() : b.buyer_pan, 'notes' in x ? str(x.notes) : b.notes, b.id);
  return { ok: true };
});
/** Admin: change due dates / amounts of instalments that have not received money. Total must stay the same. */
r.put('/api/bookings/:id/schedule', { admin: true }, (ctx) => {
  const b = bookingFor(ctx, ctx.params.id);
  if (b.status === 'cancelled') throw bad('Cancelled bookings cannot be changed');
  const changes = ctx.body.changes || [];
  tx(() => {
    for (const c of changes) {
      const i = get('SELECT * FROM installments WHERE id=? AND booking_id=?', Number(c.id), b.id);
      if (!i) throw bad('Instalment not found');
      const amount = 'amount' in c ? round(c.amount) : i.amount, due = c.due_date || i.due_date;
      if (!validDate(due)) throw bad('Invalid due date');
      if (i.paid_amount > 0 && amount !== i.amount) throw bad(`"${i.label}" already has payments; only its due date can change`);
      if (amount <= 0) throw bad('Amounts must be positive');
      run('UPDATE installments SET amount=?, due_date=?, reminded_on=NULL WHERE id=?', amount, due, i.id);
    }
    const sum = get('SELECT SUM(amount) s FROM installments WHERE booking_id=?', b.id).s;
    if (Math.abs(sum - b.total) > 1) throw bad(`Schedule total ${money(sum)} must equal the plot price ${money(b.total)}`);
  });
  L.audit(ctx.oid, ctx.user.id, 'booking.schedule', 'booking', b.id, `${changes.length} change(s)`);
  return { ok: true };
});

// ----- payments -----
r.post('/api/bookings/:id/payments', { admin: true }, (ctx) => {
  const b = bookingFor(ctx, ctx.params.id), x = ctx.body;
  if (b.status === 'cancelled') throw bad('This booking is cancelled');
  const amount = round(x.amount);
  if (amount <= 0) throw bad('Enter the amount received');
  const mode = x.mode || 'UPI'; if (!PAY_MODES.includes(mode)) throw bad('Choose a valid payment mode');
  if (mode === 'Cash' && amount >= CASH_LIMIT) throw bad('Cash payments of ₹2,00,000 or more are not permitted (Income Tax Act §269ST). Use UPI, cheque or bank transfer.');
  if (['Cheque', 'Bank Transfer', 'UPI', 'Demand Draft'].includes(mode) && !str(x.ref_no)) throw bad('Enter the cheque / transaction reference number');
  const paidOn = validDate(x.paid_on) ? x.paid_on : L.istDate();
  if (paidOn > L.istDate()) throw bad('Payment date cannot be in the future');
  const out = tx(() => {
    const sm = L.bookingSummary(ctx.oid, b.id);
    if (amount > sm.outstanding + 0.5) throw bad(`Amount exceeds the outstanding balance of ${money(sm.outstanding)}`);
    const p = run('INSERT INTO payments(org_id,booking_id,receipt_no,amount,mode,ref_no,paid_on,received_by,note,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      ctx.oid, b.id, receiptNo(ctx.oid), amount, mode, str(x.ref_no), paidOn, ctx.user.id, str(x.note), now());
    const pid = Number(p.lastInsertRowid);
    L.allocatePayment(ctx.oid, b.id, pid, amount, x.installment_id ? Number(x.installment_id) : null);
    const rc = get('SELECT receipt_no FROM payments WHERE id=?', pid).receipt_no;
    L.logActivity(ctx.oid, b.lead_id, ctx.user.id, 'payment', { content: `Payment received ${money(amount)} via ${mode} — ${rc} (${b.booking_no})`, meta: { booking_id: b.id, payment_id: pid } });
    if (!ctx.isAdmin) L.notifyAdmins(ctx.oid, 'Payment recorded', `${ctx.user.name} recorded ${money(amount)} for ${b.buyer_name} (${b.booking_no})`, `#/bookings/${b.id}`);
    return { id: pid, receipt_no: rc };
  });
  return out;
});
r.post('/api/payments/:id/void', { admin: true }, (ctx) => {
  const p = get('SELECT * FROM payments WHERE id=? AND org_id=?', ctx.params.id, ctx.oid);
  if (!p) throw notFound('Payment not found');
  if (p.voided) throw bad('Already voided');
  if (p.kind !== 'receipt') throw bad('Refund entries cannot be voided');
  const reason = str(ctx.body.reason); if (!reason) throw bad('Give a reason for voiding this receipt');
  tx(() => {
    for (const al of all('SELECT * FROM payment_alloc WHERE payment_id=?', p.id)) {
      const i = get('SELECT * FROM installments WHERE id=?', al.installment_id);
      const paid = Math.max(0, i.paid_amount - al.amount);
      run('UPDATE installments SET paid_amount=?, status=? WHERE id=?', paid, L.instStatus({ ...i, paid_amount: paid }), i.id);
    }
    run('DELETE FROM payment_alloc WHERE payment_id=?', p.id);
    run('UPDATE payments SET voided=1, void_reason=? WHERE id=?', reason, p.id);
    const b = get('SELECT * FROM bookings WHERE id=?', p.booking_id);
    L.logActivity(ctx.oid, b.lead_id, ctx.user.id, 'payment', { content: `Receipt ${p.receipt_no} (${money(p.amount)}) voided: ${reason}` });
    L.audit(ctx.oid, ctx.user.id, 'payment.void', 'payment', p.id, `${p.receipt_no} ${money(p.amount)}: ${reason}`);
  });
  return { ok: true };
});

// ----- lifecycle: agreement → registration, cancellation -----
r.post('/api/bookings/:id/status', { admin: true }, (ctx) => {
  const b = bookingFor(ctx, ctx.params.id), st = ctx.body.status;
  if (b.status === 'cancelled') throw bad('This booking is cancelled');
  if (!['agreement', 'registered'].includes(st)) throw bad('Invalid status');
  const date = validDate(ctx.body.date) ? ctx.body.date : L.istDate();
  if (st === 'registered') {
    const sm = L.bookingSummary(ctx.oid, b.id);
    if (sm.outstanding > 0.5 && !ctx.body.force) throw bad(`${money(sm.outstanding)} is still outstanding. Collect it before registration (or confirm to override).`, { outstanding: sm.outstanding, can_force: true });
    run("UPDATE bookings SET status='registered', registration_date=? WHERE id=?", date, b.id);
    run("UPDATE plots SET status='sold' WHERE id=?", b.plot_id);
  } else {
    if (b.status === 'registered') throw bad('Already registered');
    run("UPDATE bookings SET status='agreement', agreement_date=? WHERE id=?", date, b.id);
  }
  L.logActivity(ctx.oid, b.lead_id, ctx.user.id, 'booking', { content: `${b.booking_no}: ${st === 'registered' ? 'Sale deed registered' : 'Agreement of sale signed'} on ${date}` });
  L.audit(ctx.oid, ctx.user.id, `booking.${st}`, 'booking', b.id, date);
  return { ok: true };
});
r.post('/api/bookings/:id/cancel', { admin: true }, (ctx) => {
  const b = bookingFor(ctx, ctx.params.id);
  if (b.status === 'cancelled') throw bad('Already cancelled');
  if (b.status === 'registered') throw bad('A registered plot cannot be cancelled here');
  const reason = str(ctx.body.reason); if (!reason) throw bad('Give a cancellation reason');
  const paid = L.bookingSummary(ctx.oid, b.id).paid;
  const charge = Math.min(paid, Math.max(0, round(ctx.body.charge)));
  const refund = paid - charge;
  tx(() => {
    run("UPDATE bookings SET status='cancelled', cancel_reason=?, cancelled_at=?, cancellation_charge=?, refund_amount=? WHERE id=?", reason, now(), charge, refund, b.id);
    run("UPDATE plots SET status='available', hold_lead_id=NULL, hold_until=NULL, hold_by=NULL WHERE id=?", b.plot_id);
    if (refund > 0) run("INSERT INTO payments(org_id,booking_id,receipt_no,kind,amount,mode,ref_no,paid_on,received_by,note,created_at) VALUES (?,?,?,'refund',?,?,?,?,?,?,?)",
      ctx.oid, b.id, receiptNo(ctx.oid), refund, PAY_MODES.includes(ctx.body.refund_mode) ? ctx.body.refund_mode : 'Bank Transfer', str(ctx.body.refund_ref), L.istDate(), ctx.user.id, 'Refund on cancellation', now());
    run("UPDATE commissions SET status='cancelled' WHERE booking_id=? AND status<>'paid'", b.id);
    if (!get("SELECT 1 x FROM bookings WHERE lead_id=? AND id<>? AND status<>'cancelled'", b.lead_id, b.id)) L.setStage(ctx.oid, b.lead_id, 'Negotiation', ctx.user, { allowBooked: true });
    L.logActivity(ctx.oid, b.lead_id, ctx.user.id, 'booking', { content: `${b.booking_no} cancelled: ${reason}. Retained ${money(charge)}, refund ${money(refund)}` });
    L.audit(ctx.oid, ctx.user.id, 'booking.cancel', 'booking', b.id, `${reason}; charge ${charge}; refund ${refund}`);
  });
  return { ok: true, charge, refund };
});

// ----- collections -----
r.get('/api/collections', { admin: true }, (ctx) => {
  const today = L.istDate(), week = L.istDate(Date.now() + 7 * 864e5);
  let sql = `SELECT i.*, b.booking_no, b.buyer_name, b.buyer_phone, b.sold_by, b.lead_id, pl.plot_no, pr.name AS project_name, u.name AS rep_name, (i.amount-i.paid_amount) AS due
    FROM installments i JOIN bookings b ON b.id=i.booking_id JOIN plots pl ON pl.id=b.plot_id JOIN projects pr ON pr.id=b.project_id LEFT JOIN users u ON u.id=b.sold_by
    WHERE i.org_id=? AND b.status<>'cancelled' AND i.paid_amount < i.amount-0.5`;
  const a = [ctx.oid];
  if (!ctx.isAdmin) { sql += ' AND b.sold_by=?'; a.push(ctx.user.id); }
  sql += ' ORDER BY i.due_date LIMIT 1000';
  const rows = all(sql, ...a).map((x) => ({ ...x, bucket: x.due_date < today ? 'overdue' : x.due_date <= week ? 'week' : 'later', days: Math.round((Date.parse(x.due_date) - Date.parse(today)) / 864e5) }));
  const sum = (f) => rows.filter(f).reduce((s, x) => s + x.due, 0);
  const p = L.period('month');
  const collected = get(`SELECT COALESCE(SUM(p.amount),0) s FROM payments p JOIN bookings b ON b.id=p.booking_id WHERE p.org_id=? AND p.kind='receipt' AND p.voided=0 AND p.paid_on>=? AND p.paid_on<?${ctx.isAdmin ? '' : ' AND b.sold_by=?'}`,
    ...[ctx.oid, p.fromD, p.toD, ...(ctx.isAdmin ? [] : [ctx.user.id])]).s;
  return { rows, summary: { overdue: sum((x) => x.bucket === 'overdue'), week: sum((x) => x.bucket === 'week'), later: sum((x) => x.bucket === 'later'), collected_month: collected } };
});

// ----- receipts & statements (printable HTML) -----
function inWords(n) {
  n = Math.round(n);
  if (n === 0) return 'Zero';
  const a = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const t = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const two = (x) => (x < 20 ? a[x] : t[Math.floor(x / 10)] + (x % 10 ? ' ' + a[x % 10] : ''));
  const three = (x) => (x >= 100 ? a[Math.floor(x / 100)] + ' Hundred' + (x % 100 ? ' ' + two(x % 100) : '') : two(x));
  const parts = [];
  const cr = Math.floor(n / 1e7); n %= 1e7; const lk = Math.floor(n / 1e5); n %= 1e5; const th = Math.floor(n / 1e3); n %= 1e3;
  if (cr) parts.push(three(cr) + ' Crore'); if (lk) parts.push(two(lk) + ' Lakh'); if (th) parts.push(two(th) + ' Thousand'); if (n) parts.push(three(n));
  return parts.join(' ');
}
const PAGE_CSS = `body{font-family:-apple-system,Segoe UI,Arial,sans-serif;color:#1a1a1a;max-width:760px;margin:24px auto;padding:0 20px}h1{font-size:22px;margin:0}h2{font-size:15px;margin:22px 0 8px}
.top{display:flex;justify-content:space-between;border-bottom:2px solid #111;padding-bottom:12px}.muted{color:#666;font-size:13px}table{width:100%;border-collapse:collapse;font-size:13px}th,td{border:1px solid #ccc;padding:6px 9px;text-align:left}
th{background:#f3f3f3}td.r,th.r{text-align:right}.box{border:1px solid #ccc;border-radius:6px;padding:14px;margin-top:14px}.big{font-size:22px;font-weight:700}.sign{display:flex;justify-content:space-between;margin-top:60px;font-size:13px}
.void{color:#b00;font-weight:700;border:2px solid #b00;display:inline-block;padding:2px 10px;transform:rotate(-6deg)}@media print{.np{display:none}body{margin:0}}`;
r.get('/api/payments/:id/receipt', (ctx) => {
  const p = get('SELECT * FROM payments WHERE id=? AND org_id=?', ctx.params.id, ctx.oid);
  if (!p) throw notFound('Receipt not found');
  const b = bookingFor(ctx, p.booking_id);
  const org = L.getOrg(ctx.oid), s = L.getSettings(ctx.oid);
  const pl = get('SELECT * FROM plots WHERE id=?', b.plot_id), pr = get('SELECT * FROM projects WHERE id=?', b.project_id), sm = L.bookingSummary(ctx.oid, b.id);
  const recvBy = p.received_by ? get('SELECT name FROM users WHERE id=?', p.received_by)?.name : '';
  const isRefund = p.kind === 'refund';
  return raw(`<!doctype html><html><head><meta charset="utf-8"><title>${isRefund ? 'Refund voucher' : 'Receipt'} ${esc(p.receipt_no)}</title><style>${PAGE_CSS}</style></head><body>
  <div class="top"><div><h1>${esc(org.name)}</h1><div class="muted">${esc(org.city || '')} ${esc(s.company_address || '')} ${s.company_phone ? '· ' + esc(s.company_phone) : ''}</div></div>
  <div style="text-align:right"><h1>${isRefund ? 'REFUND VOUCHER' : 'PAYMENT RECEIPT'}</h1><div class="muted">No. <b>${esc(p.receipt_no)}</b><br>Date: ${esc(p.paid_on)}</div>${p.voided ? '<div class="void">VOIDED</div>' : ''}</div></div>
  <div class="box"><div class="muted">${isRefund ? 'Refunded to' : 'Received with thanks from'}</div><div style="font-size:17px;font-weight:600">${esc(b.buyer_name)}</div>
  <div class="muted">${esc(L.fmtPhone(b.buyer_phone))} ${esc(b.buyer_address || '')}</div>
  <div style="margin-top:12px" class="muted">Amount</div><div class="big">${money(p.amount)}</div><div class="muted">Rupees ${esc(inWords(p.amount))} only</div></div>
  <h2>Details</h2><table><tr><th>Booking no.</th><td>${esc(b.booking_no)}</td><th>Payment mode</th><td>${esc(p.mode)}${p.ref_no ? ' · Ref: ' + esc(p.ref_no) : ''}</td></tr>
  <tr><th>Project</th><td>${esc(pr.name)}${pr.rera_no ? '<br><span class="muted">RERA: ' + esc(pr.rera_no) + '</span>' : ''}</td><th>Plot</th><td>No. ${esc(pl.plot_no)}${pl.block ? ' · Block ' + esc(pl.block) : ''} · ${pl.area_sqyd} sq.yd${pl.facing ? ' · ' + esc(pl.facing) + ' facing' : ''}</td></tr>
  <tr><th>Total price</th><td>${money(b.total)}</td><th>Balance after this</th><td>${money(sm.outstanding)}</td></tr>
  <tr><th>Towards</th><td colspan="3">${esc(p.note || 'Plot purchase')}</td></tr></table>
  ${p.voided ? `<p class="muted">Voided: ${esc(p.void_reason)}</p>` : ''}
  <div class="sign"><div>Received by: ${esc(recvBy)}</div><div>Authorised signatory</div></div>
  <p class="muted">Cheques / drafts are subject to realisation. This is a computer generated receipt.</p>
  <button class="np" onclick="print()">Print</button></body></html>`, 'text/html; charset=utf-8');
});
r.get('/api/bookings/:id/statement', { admin: true }, (ctx) => {
  const b = bookingFor(ctx, ctx.params.id), org = L.getOrg(ctx.oid);
  const pl = get('SELECT * FROM plots WHERE id=?', b.plot_id), pr = get('SELECT * FROM projects WHERE id=?', b.project_id), sm = L.bookingSummary(ctx.oid, b.id);
  const inst = all('SELECT * FROM installments WHERE booking_id=? ORDER BY seq', b.id), pays = all("SELECT * FROM payments WHERE booking_id=? AND voided=0 ORDER BY id", b.id);
  return raw(`<!doctype html><html><head><meta charset="utf-8"><title>Statement ${esc(b.booking_no)}</title><style>${PAGE_CSS}</style></head><body>
  <div class="top"><div><h1>${esc(org.name)}</h1><div class="muted">Account statement</div></div><div style="text-align:right"><b>${esc(b.booking_no)}</b><div class="muted">${esc(L.istDate())}</div></div></div>
  <div class="box"><b>${esc(b.buyer_name)}</b> · ${esc(L.fmtPhone(b.buyer_phone))}<br><span class="muted">${esc(pr.name)} · Plot ${esc(pl.plot_no)} · ${pl.area_sqyd} sq.yd @ ${money(b.rate)}/sq.yd</span></div>
  <h2>Price</h2><table><tr><td>Base price</td><td class="r">${money(b.base_amount)}</td></tr>${b.plc_amount ? `<tr><td>Preferential location charges</td><td class="r">${money(b.plc_amount)}</td></tr>` : ''}
  ${b.dev_amount ? `<tr><td>Development charges</td><td class="r">${money(b.dev_amount)}</td></tr>` : ''}${b.reg_amount ? `<tr><td>Registration / stamp charges</td><td class="r">${money(b.reg_amount)}</td></tr>` : ''}
  ${b.discount ? `<tr><td>Discount</td><td class="r">− ${money(b.discount)}</td></tr>` : ''}<tr><th>Total</th><th class="r">${money(b.total)}</th></tr></table>
  <h2>Payment schedule</h2><table><tr><th>#</th><th>Description</th><th>Due date</th><th class="r">Amount</th><th class="r">Paid</th><th>Status</th></tr>
  ${inst.map((i) => `<tr><td>${i.seq}</td><td>${esc(i.label)}</td><td>${esc(i.due_date)}</td><td class="r">${money(i.amount)}</td><td class="r">${money(i.paid_amount)}</td><td>${esc(i.status)}</td></tr>`).join('')}</table>
  <h2>Receipts</h2><table><tr><th>Receipt</th><th>Date</th><th>Mode</th><th class="r">Amount</th></tr>${pays.map((p) => `<tr><td>${esc(p.receipt_no)}${p.kind === 'refund' ? ' (refund)' : ''}</td><td>${esc(p.paid_on)}</td><td>${esc(p.mode)}${p.ref_no ? ' · ' + esc(p.ref_no) : ''}</td><td class="r">${money(p.amount)}</td></tr>`).join('')}</table>
  <div class="box"><b>Paid:</b> ${money(sm.paid)} &nbsp; <b>Outstanding:</b> ${money(sm.outstanding)} ${sm.overdue_amount ? `&nbsp; <b style="color:#b00">Overdue: ${money(sm.overdue_amount)}</b>` : ''}</div>
  <button class="np" onclick="print()">Print</button></body></html>`, 'text/html; charset=utf-8');
});

// ================= KYC + CLIENT PORTAL =================
function refreshKyc(oid, leadId) {
  const docs = all('SELECT doc_type,status FROM kyc_docs WHERE org_id=? AND lead_id=?', oid, leadId);
  let st = 'none';
  if (docs.length) {
    const ok = (t) => docs.some((d) => d.doc_type === t && d.status === 'verified');
    st = docs.some((d) => d.status === 'rejected') && !KYC_REQUIRED.every(ok) ? 'rejected' : KYC_REQUIRED.every(ok) ? 'verified' : docs.some((d) => d.status === 'pending') ? 'pending' : 'partial';
  }
  run('UPDATE leads SET kyc_status=? WHERE id=?', st, leadId);
}
function saveKyc(oid, lead, b, byName) {
  if (!KYC_TYPES.includes(b.doc_type)) throw bad('Choose the document type');
  if (!b.data_base64) throw bad('Choose a file to upload');
  const buf = Buffer.from(String(b.data_base64).replace(/^data:[^,]*,/, ''), 'base64');
  if (!buf.length) throw bad('The file is empty');
  if (buf.length > 6 * 1024 * 1024) throw bad('File is too large (max 6 MB)');
  const sig = buf.subarray(0, 4).toString('hex');
  const mime = sig.startsWith('25504446') ? 'application/pdf' : sig.startsWith('ffd8ff') ? 'image/jpeg' : sig.startsWith('89504e47') ? 'image/png' : null;
  if (!mime) throw bad('Only PDF, JPG or PNG files are accepted');
  const dir = path.join(DATA_DIR, 'uploads', String(oid));
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, newToken(16) + { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png' }[mime]);
  fs.writeFileSync(file, buf);
  const name = String(b.filename || 'document').replace(/[^\w.\- ]/g, '_').slice(0, 80);
  run('INSERT INTO kyc_docs(org_id,lead_id,doc_type,filename,path,mime,uploaded_at) VALUES (?,?,?,?,?,?,?)', oid, lead.id, b.doc_type, name, file, mime, now());
  refreshKyc(oid, lead.id);
  L.logActivity(oid, lead.id, null, 'system', { content: `KYC document uploaded (${b.doc_type}) by ${byName}` });
  L.notifyAdmins(oid, 'KYC document uploaded', `${lead.name}: ${b.doc_type}`, `#/leads/${lead.id}`);
  if (lead.assigned_to) L.notify(oid, { user: lead.assigned_to, title: 'KYC document uploaded', message: `${lead.name}: ${b.doc_type}`, link: `#/leads/${lead.id}` });
}
function portalLead(token) {
  const l = get('SELECT * FROM leads WHERE portal_token=?', String(token || ''));
  if (!l) throw notFound('This link is not valid');
  if (l.portal_expires && l.portal_expires < now()) throw new HttpError(410, 'This link has expired. Please ask your sales contact for a new one.');
  return l;
}
r.get('/api/portal/:token', { public: true }, (ctx) => {
  const l = portalLead(ctx.params.token), org = L.getOrg(l.org_id), s = L.getSettings(l.org_id);
  const rep = l.assigned_to ? get('SELECT name,phone FROM users WHERE id=?', l.assigned_to) : null;
  const bookings = all("SELECT b.*, pl.plot_no, pl.facing, pr.name AS project_name, pr.location, pr.rera_no FROM bookings b JOIN plots pl ON pl.id=b.plot_id JOIN projects pr ON pr.id=b.project_id WHERE b.lead_id=? ORDER BY b.id DESC", l.id).map((b) => {
    const sm = L.bookingSummary(l.org_id, b.id);
    return { booking_no: b.booking_no, status: b.status, project: b.project_name, location: b.location, rera_no: b.rera_no, plot_no: b.plot_no, facing: b.facing, area_sqyd: b.area_sqyd, total: b.total, booked_on: b.booked_on, ...sm,
      installments: all('SELECT label,due_date,amount,paid_amount,status FROM installments WHERE booking_id=? ORDER BY seq', b.id),
      receipts: all("SELECT receipt_no,amount,mode,paid_on FROM payments WHERE booking_id=? AND kind='receipt' AND voided=0 ORDER BY id", b.id) };
  });
  return {
    company: { name: org.name, phone: s.company_phone, address: s.company_address }, client: { name: l.name }, rep, bookings, kyc_status: l.kyc_status,
    documents: all('SELECT doc_type,status,remark,uploaded_at FROM kyc_docs WHERE lead_id=? ORDER BY id DESC', l.id), doc_types: KYC_TYPES, required: KYC_REQUIRED,
  };
});
r.post('/api/portal/:token/kyc', { public: true }, (ctx) => { const l = portalLead(ctx.params.token); saveKyc(l.org_id, l, ctx.body, l.name + ' (client)'); return { ok: true }; });
r.post('/api/leads/:id/kyc', (ctx) => {
  const l = get('SELECT * FROM leads WHERE id=? AND org_id=?', Number(ctx.params.id), ctx.oid);
  if (!l || (!ctx.isAdmin && l.assigned_to !== ctx.user.id)) throw notFound('Lead not found');
  saveKyc(ctx.oid, l, ctx.body, ctx.user.name); return { ok: true };
});
r.get('/api/kyc/:id/file', (ctx) => {
  const d = get('SELECT * FROM kyc_docs WHERE id=? AND org_id=?', ctx.params.id, ctx.oid);
  if (!d) throw notFound('Document not found');
  const l = get('SELECT assigned_to FROM leads WHERE id=?', d.lead_id);
  if (!ctx.isAdmin && l.assigned_to !== ctx.user.id) throw forbidden();
  return raw(fs.readFileSync(d.path), d.mime, d.filename);
});
r.post('/api/kyc/:id/review', { admin: true }, (ctx) => {
  const d = get('SELECT * FROM kyc_docs WHERE id=? AND org_id=?', ctx.params.id, ctx.oid);
  if (!d) throw notFound('Document not found');
  if (!['verified', 'rejected'].includes(ctx.body.status)) throw bad('Choose verified or rejected');
  if (ctx.body.status === 'rejected' && !str(ctx.body.remark)) throw bad('Say why the document is rejected so the client can re-upload');
  run('UPDATE kyc_docs SET status=?, remark=?, reviewed_by=? WHERE id=?', ctx.body.status, str(ctx.body.remark), ctx.user.id, d.id);
  refreshKyc(ctx.oid, d.lead_id);
  L.logActivity(ctx.oid, d.lead_id, ctx.user.id, 'system', { content: `KYC ${d.doc_type} ${ctx.body.status}${ctx.body.remark ? ': ' + ctx.body.remark : ''}` });
  return { ok: true };
});
r.del('/api/kyc/:id', { admin: true }, (ctx) => {
  const d = get('SELECT * FROM kyc_docs WHERE id=? AND org_id=?', ctx.params.id, ctx.oid);
  if (!d) throw notFound();
  try { fs.unlinkSync(d.path); } catch { /* already gone */ }
  run('DELETE FROM kyc_docs WHERE id=?', d.id); refreshKyc(ctx.oid, d.lead_id);
  return { ok: true };
});
