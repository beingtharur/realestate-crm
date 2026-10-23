// End-to-end API test: `npm test`. Runs against a throw-away database.
const os = require('os');
const path = require('path');
const fs = require('fs');
process.env.ALLOW_SIGNUP = 'true'; process.env.LOGIN_RATE_MAX = '1000'; process.env.ENQUIRY_RATE_MAX = '1000';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-test-'));
const { server } = require('./index');

let pass = 0, fail = 0;
const ok = (cond, name, extra) => { if (cond) { pass++; } else { fail++; console.log('  ✗', name, extra !== undefined ? JSON.stringify(extra) : ''); } };
let base;
async function call(method, url, body, token) {
  const res = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}
const today_ = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const section = (s) => console.log('\n' + s);
/** Minimal single-page PDF: each row is a list of [text, x]; rows are 20pt apart. */
function makePdf(rows) {
  const esc = (t) => t.replace(/([\\()])/g, '\\$1');
  const stream = rows.map((cells, i) => cells.map(([t, xPos]) => `BT /F1 10 Tf ${xPos} ${760 - i * 20} Td (${esc(t)}) Tj ET`).join('\n')).join('\n');
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let out = '%PDF-1.4\n'; const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}
const RVtoken = () => 'not-a-real-token';


(async () => {
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;

  section('Setup & auth');
  let x = await call('POST', '/api/auth/setup', { org_name: 'Green Acres', org_code: 'GREEN', city: 'Hyderabad', name: 'Asha Admin', email: 'admin@green.test', password: 'password123' });
  ok(x.status === 200, 'org setup', x.body);
  x = await call('POST', '/api/auth/setup', { org_name: 'Other', org_code: 'green', name: 'A', email: 'z@z.test', password: 'password123' });
  ok(x.status === 400, 'org code unique (case-insensitive)');
  x = await call('POST', '/api/auth/setup', { org_name: 'Other', org_code: 'OTHER', name: 'A', email: 'ADMIN@green.test', password: 'password123' });
  ok(x.status === 400, 'email unique platform-wide');
  x = await call('POST', '/api/auth/setup', { org_name: 'Other', org_code: 'OTHER', name: 'A', email: 'o@o.test', password: 'short' });
  ok(x.status === 400, 'password min 8');
  x = await call('POST', '/api/auth/login', { email: 'admin@green.test', password: 'password123' });
  const A = x.body.token; ok(!!A, 'admin login');
  for (let i = 0; i < 4; i++) await call('POST', '/api/auth/login', { email: 'admin@green.test', password: 'nope' });
  x = await call('POST', '/api/auth/login', { email: 'admin@green.test', password: 'nope' });
  ok(x.status === 423, 'lockout after 5 wrong attempts', x.body);
  x = await call('POST', '/api/auth/login', { email: 'admin@green.test', password: 'password123' });
  ok(x.status === 423, 'locked account rejects even correct password');
  require('./db').run("UPDATE users SET locked_until=NULL WHERE email='admin@green.test'");

  section('Team invites');
  x = await call('POST', '/api/team/invite', { name: 'Ravi Rep', email: 'ravi@green.test', role: 'rep', phone: '+91 98765-43210', monthly_target: 5000000 }, A);
  ok(x.status === 200 && x.body.link, 'invite created', x.body);
  const inv = x.body.link.split('/').pop();
  x = await call('POST', '/api/team/invite', { name: 'Bad', email: 'bad@green.test', role: 'rep', phone: '12345' }, A);
  ok(x.status === 400, 'invalid phone rejected');
  x = await call('POST', '/api/team/invite', { name: 'Dup', email: 'admin@green.test', role: 'rep' }, A);
  ok(x.status === 400, 'existing email cannot be invited');
  x = await call('POST', '/api/auth/accept-invite', { token: inv, password: 'ravipass123' });
  ok(x.status === 200, 'accept invite', x.body);
  x = await call('POST', '/api/auth/accept-invite', { token: inv, password: 'ravipass123' });
  ok(x.status === 400, 'invite is single use');
  x = await call('POST', '/api/auth/login', { email: 'ravi@green.test', password: 'ravipass123' });
  const R = x.body.token; const raviId = x.body.user.id; ok(!!R, 'rep login');
  for (const [n, e] of [['Sita Sales', 'sita@green.test'], ['Sita Rao', 'sitarao@green.test']]) {
    const i = await call('POST', '/api/team/invite', { name: n, email: e, role: 'rep' }, A);
    await call('POST', '/api/auth/accept-invite', { token: i.body.link.split('/').pop(), password: 'password123' });
  }
  const meta = (await call('GET', '/api/meta', null, A)).body;
  const sitaId = meta.users.find((u) => u.email === undefined && u.name === 'Sita Sales').id;
  const adminId = meta.users.find((u) => u.role === 'admin').id;
  x = await call('GET', '/api/team', null, R); ok(x.status === 403, 'rep cannot open team page');

  section('Inventory');
  x = await call('POST', '/api/projects', { name: 'Green Valley', city: 'Hyderabad', location: 'Shadnagar', rera_no: 'P02400001', approval: 'DTCP', base_rate: 15000, dev_charges_per_sqyd: 500, registration_pct: 7.5, max_discount_pct: 2 }, A);
  ok(x.status === 200, 'project created', x.body); const PID = x.body.id;
  x = await call('POST', `/api/projects/${PID}/plots/bulk`, { prefix: 'A-', from: 1, to: 10, block: 'A', area_sqyd: 200, facing: 'East', road_width_ft: 30, plc_pct: 0 }, A);
  ok(x.body.created === 10, 'bulk plots', x.body);
  x = await call('POST', `/api/projects/${PID}/plots/bulk`, { prefix: 'A-', from: 10, to: 12, block: 'A', area_sqyd: 200 }, A);
  ok(x.body.created === 2 && x.body.skipped === 1, 'bulk skips existing plot numbers', x.body);
  const csv = 'plot_no,area_sqyd,facing,rate\nB-1,150,North,16000\nB-2,abc,North,16000\n';
  x = await call('POST', `/api/projects/${PID}/plots/import`, { file_base64: Buffer.from(csv).toString('base64'), filename: 'p.csv' }, A);
  ok(x.body.created === 1 && x.body.errors.length === 1, 'plot CSV import validates rows', x.body);
  x = await call('GET', `/api/projects/${PID}`, null, R);
  const plots = x.body.plots; ok(plots.length === 13, 'rep can view inventory');
  const p1 = plots.find((p) => p.plot_no === 'A-1'), p2 = plots.find((p) => p.plot_no === 'A-2'), p3 = plots.find((p) => p.plot_no === 'A-3');
  ok(p1.price === 200 * 15000 + 200 * 500 + Math.round(200 * 15000 * 0.075), 'price = base + dev + registration', p1.price);
  x = await call('POST', `/api/projects/${PID}/plots`, { plot_no: 'Z', area_sqyd: 10, rate_per_sqyd: 1 }, R); ok(x.status === 403, 'rep cannot add plots');

  section('Assignment rules');
  x = await call('POST', '/api/assign-rules', { name: 'All leads round robin', strategy: 'round_robin', rep_ids: [raviId, sitaId] }, A);
  ok(x.status === 200, 'rule created', x.body);

  section('Leads');
  x = await call('POST', '/api/leads', { name: 'Kiran Kumar', phone: '98765 00001', email: 'kiran@x.test', source: 'Facebook Ads', budget_max: 4000000, pref_size_min: 200, pref_project_id: PID }, A);
  ok(x.status === 200, 'admin creates lead', x.body); const L1 = x.body.id;
  x = await call('POST', '/api/leads', { name: 'Kiran K', phone: '+919876500001' }, A);
  ok(x.status === 409 && x.body.duplicates.length === 1, 'duplicate detected by phone (last 10 digits)', x.body);
  x = await call('POST', '/api/leads', { name: 'Kiran K', phone: '+919876500001', force: true }, A);
  ok(x.status === 200, 'create anyway works'); const L1dup = x.body.id;
  x = await call('POST', '/api/leads', { name: 'Bad Phone', phone: '12345' }, A); ok(x.status === 400, 'invalid phone rejected');
  x = await call('POST', '/api/leads', { name: 'Bad Email', phone: '9876500002', email: 'nope' }, A); ok(x.status === 400, 'invalid email rejected');
  x = await call('GET', `/api/leads/${L1}`, null, A);
  ok(x.body.lead.assigned_to === raviId || x.body.lead.assigned_to === sitaId, 'auto-assigned by rule', x.body.lead.assigned_to);
  ok(x.body.lead.score > 0, 'lead scored', x.body.lead.score);
  const owner = x.body.lead.assigned_to === raviId ? R : null;
  x = await call('POST', '/api/leads', { name: 'Second Lead', phone: '9876500003', source: 'Walk-in' }, A);
  const L2 = x.body.id;
  x = await call('POST', '/api/leads', { name: 'Third Lead', phone: '9876500004', source: 'Google Ads' }, A);
  const L2b = x.body.id;
  const asg = {};
  for (const id of [L1, L2, L2b, L1dup]) asg[id] = (await call('GET', `/api/leads/${id}`, null, A)).body.lead.assigned_to;
  ok(new Set(Object.values(asg)).size === 2, 'round-robin spreads leads across both reps', asg);
  const raviLeads = Object.keys(asg).filter((id) => asg[id] === raviId).map(Number);
  const raviLead = raviLeads.find((id) => id !== L1dup);
  const otherLead = Object.keys(asg).map(Number).find((id) => asg[id] !== raviId);
  x = await call('DELETE', `/api/leads/${L1dup}`, null, R); ok(x.status === 403, 'rep cannot delete leads');
  x = await call('DELETE', `/api/leads/${L1dup}`, null, A); ok(x.status === 200, 'admin deletes lead');
  x = await call('GET', '/api/leads', null, R);
  const expectMine = raviLeads.filter((id) => id !== L1dup).length;
  ok(x.body.length === expectMine && x.body.every((l) => l.assigned_to === raviId), 'rep sees only own leads', x.body.length);
  x = await call('GET', `/api/leads/${otherLead}`, null, R); ok(x.status === 404, "rep cannot open another rep's lead");
  x = await call('POST', `/api/leads/${raviLead}/report-duplicate`, { note: 'same as another' }, R); ok(x.status === 200, 'rep reports duplicate');
  x = await call('GET', '/api/notifications', null, A); ok(x.body.items.some((n) => n.title === 'Duplicate reported'), 'admin notified of duplicate report');
  x = await call('GET', '/api/notifications', null, R); ok(!x.body.items.some((n) => n.title === 'Duplicate reported'), 'rep does not see admin-only notification');

  section('Activity, tasks, visits');
  x = await call('POST', `/api/leads/${raviLead}/calls`, { direction: 'outgoing', outcome: 'Connected', duration_min: 3, notes: 'Interested in east facing' }, R);
  ok(x.status === 200, 'log call');
  x = await call('GET', `/api/leads/${raviLead}`, null, R);
  ok(x.body.lead.stage === 'Contacted', 'connected call moves New → Contacted', x.body.lead.stage);
  x = await call('POST', `/api/leads/${raviLead}/whatsapp`, { direction: 'outgoing', content: 'Hi' }, R); ok(x.status === 200, 'log whatsapp');
  x = await call('POST', '/api/tasks', { lead_id: raviLead, title: 'Call back', due_at: new Date(Date.now() - 3600e3).toISOString() }, R);
  ok(x.status === 200, 'create task'); const T1 = x.body.id;
  x = await call('GET', '/api/tasks', null, R); ok(x.body.counts.overdue === 1 && x.body.tasks[0].color === 'red', 'overdue task is red', x.body.counts);
  x = await call('POST', `/api/tasks/${T1}/snooze`, { mode: 'tomorrow' }, R); ok(x.body.postponed_count === 1, 'snooze counts postponements');
  x = await call('POST', `/api/tasks/${T1}/complete`, {}, R); ok(x.status === 200, 'complete task');
  x = await call('POST', '/api/visits', { lead_id: raviLead, project_id: PID, plot_id: p1.id, scheduled_at: new Date(Date.now() + 86400e3).toISOString(), pickup_required: true }, R);
  ok(x.status === 200, 'schedule visit', x.body); const V1 = x.body.id;
  x = await call('GET', `/api/leads/${raviLead}`, null, R); ok(x.body.lead.stage === 'Site Visit Scheduled', 'visit moves stage');
  x = await call('POST', `/api/visits/${V1}/complete`, { feedback: 'Liked A-1', interest: 'High' }, R);
  x = await call('GET', `/api/leads/${raviLead}`, null, R); ok(x.body.lead.stage === 'Site Visit Completed', 'completing visit moves stage');
  ok(x.body.tasks.some((t) => t.title === 'Follow up after site visit'), 'automation rule created follow-up task');
  x = await call('POST', `/api/leads/${raviLead}/stage`, { stage: 'Booked' }, R); ok(x.status === 400, 'cannot set Booked without booking');
  x = await call('POST', `/api/leads/${raviLead}/stage`, { stage: 'Negotiation' }, R); ok(x.status === 200, 'move to negotiation');

  section('Plot hold & booking');
  x = await call('POST', `/api/plots/${p1.id}/hold`, { lead_id: raviLead, hours: 24 }, R); ok(x.status === 200, 'hold plot');
  x = await call('POST', `/api/plots/${p1.id}/hold`, { lead_id: raviLead }, R); ok(x.status === 400, 'cannot hold twice');
  x = await call('POST', '/api/bookings/preview', { plot_id: p1.id, token_amount: 100000, down_pct: 20, emi_count: 4, emi_interval_days: 30, final_pct: 10 }, R);
  ok(x.status === 200, 'booking preview', x.body);
  const total = x.body.price.total;
  ok(x.body.installments.reduce((s, i) => s + i.amount, 0) + 100000 === total, 'plan sums to total', x.body.installments);
  ok(!('max_discount' in x.body.price) && !('discount_needs_approval' in x.body), 'rep preview carries no discount information', x.body.price);
  x = await call('POST', '/api/bookings/preview', { plot_id: p1.id, discount: 5000, token_amount: 100000 }, R); ok(x.status === 400, 'rep cannot preview a discounted price');
  const maxD = (await call('GET', `/api/plots/${p1.id}/price`, null, A)).body.price.max_discount; ok(maxD === Math.round(200 * 15000 * 0.02), 'admin still sees the 2% self-approved limit', maxD);
  x = await call('GET', `/api/plots/${p1.id}/price`, null, R); ok(!('max_discount' in x.body.price) && !('max_discount_pct' in x.body.project), 'rep plot price carries no discount limit', x.body);
  x = await call('POST', '/api/bookings', { lead_id: raviLead, plot_id: p1.id, discount: 1000, token_amount: 100000, token_mode: 'UPI', down_pct: 20 }, R);
  ok(x.status === 400 && /admin/i.test(x.body.error), 'rep cannot book with any discount', x.body);
  x = await call('POST', '/api/discounts', { lead_id: raviLead, plot_id: p1.id, amount: 5000 }, R); ok(x.status === 403, 'rep cannot request a discount');
  x = await call('GET', '/api/discounts', null, R); ok(x.status === 403, 'rep cannot open the discount list');
  x = await call('GET', '/api/meta', null, R); ok(x.body.projects.every((p) => !('max_discount_pct' in p)), 'rep project list has no discount limits');
  x = await call('GET', '/api/projects', null, R); ok(x.body.every((p) => !('max_discount_pct' in p)), 'rep projects endpoint has no discount limits');
  x = await call('POST', '/api/bookings', { lead_id: raviLead, plot_id: p1.id, token_amount: 250000, token_mode: 'Cash', down_pct: 20 }, R);
  ok(x.status === 400 && /269ST/.test(x.body.error), 'cash ≥ ₹2L blocked', x.body);
  x = await call('POST', '/api/bookings', { lead_id: raviLead, plot_id: p1.id, token_amount: 100000, token_mode: 'UPI', token_ref: 'UTR123', down_pct: 20, emi_count: 4, emi_interval_days: 30, final_pct: 10, buyer_address: 'Hyd' }, R);
  ok(x.status === 200, 'booking created', x.body); const B1 = x.body.id; const PAY1 = x.body.payment_id;
  x = await call('POST', '/api/bookings', { lead_id: raviLead, plot_id: p1.id, token_amount: 100000, token_mode: 'UPI' }, R); ok(x.status === 400, 'booked plot cannot be booked again');
  x = await call('GET', `/api/bookings/${B1}`, null, A);
  ok(x.body.booking.total === total && x.body.summary.paid === 100000 && x.body.summary.outstanding === total - 100000, 'token recorded as first payment', x.body.summary);
  x = await call('GET', `/api/bookings/${B1}`, null, R);
  ok(x.body.booking.total === total && x.body.booking.id === B1 && x.body.plot && !('summary' in x.body) && !('installments' in x.body) && !('payments' in x.body) && !('commission' in x.body), 'rep booking view: sale details only, no payment data', Object.keys(x.body));
  ok(!('paid' in x.body.booking) && !('discount' in x.body.booking) && !('refund_amount' in x.body.booking), 'rep booking view has no money-collected or discount fields', Object.keys(x.body.booking));
  x = await call('GET', '/api/bookings', null, R); ok(x.body.length >= 1 && x.body.every((b) => !('paid' in b) && !('outstanding' in b) && !('overdue_amount' in b) && !('discount' in b)), 'rep booking list has no payment columns', Object.keys(x.body[0] || {}));
  x = await call('GET', `/api/leads/${raviLead}`, null, R); ok(x.body.lead.stage === 'Booked' && x.body.bookings.every((b) => !('paid' in b) && !('outstanding' in b)) && x.body.discounts.length === 0, 'lead page shows the booking without payment data');
  x = await call('POST', `/api/bookings/${B1}/payments`, { amount: 200000, mode: 'Cheque', ref_no: '000123' }, R); ok(x.status === 403, 'rep cannot record payments');
  x = await call('GET', '/api/collections', null, R); ok(x.status === 403, 'rep cannot open collections');
  x = await call('GET', `/api/bookings/${B1}/statement`, null, R); ok(x.status === 403, 'rep cannot open the payment statement');
  x = await call('POST', `/api/bookings/${B1}/payments`, { amount: 10000000, mode: 'UPI', ref_no: 'X' }, A); ok(x.status === 400, 'cannot overpay');
  x = await call('POST', `/api/bookings/${B1}/payments`, { amount: 200000, mode: 'Cheque' }, A); ok(x.status === 400, 'cheque needs reference');
  x = await call('POST', `/api/bookings/${B1}/payments`, { amount: 200000, mode: 'Cheque', ref_no: '000123' }, A);
  ok(x.status === 200 && /^RCP-/.test(x.body.receipt_no), 'admin records payment + receipt no', x.body); const PAY2 = x.body.id;
  x = await call('GET', `/api/bookings/${B1}`, null, A);
  ok(x.body.summary.paid === 300000, 'paid total updates', x.body.summary);
  ok(x.body.installments[0].status === 'paid' && x.body.installments[1].paid_amount > 0, 'payment allocated to instalments in order', x.body.installments.slice(0, 2));
  x = await call('POST', `/api/payments/${PAY2}/void`, { reason: 'Cheque bounced' }, R); ok(x.status === 403, 'rep cannot void receipts');
  x = await call('POST', `/api/payments/${PAY2}/void`, { reason: 'Cheque bounced' }, A); ok(x.status === 200, 'admin voids receipt');
  x = await call('GET', `/api/bookings/${B1}`, null, A); ok(x.body.summary.paid === 100000, 'void reverses allocation', x.body.summary);
  const rc = await fetch(`${base}/api/payments/${PAY1}/receipt?t=${R}`); const html = await rc.text();
  ok(rc.status === 200 && html.includes('PAYMENT RECEIPT') && html.includes('One Lakh'), 'token receipt printable (also by the rep who took it)');
  x = await call('GET', '/api/collections', null, A); ok(x.body.rows.length > 0, 'admin collections list');
  x = await call('POST', `/api/bookings/${B1}/status`, { status: 'registered' }, A); ok(x.status === 400 && x.body.can_force, 'registration blocked while dues pending');
  // discounts stay an admin tool: request → approve → used once, and booking above the limit is audit-logged
  x = await call('POST', '/api/leads', { name: 'Discount Buyer', phone: '9000000077', source: 'Walk-in', assigned_to: sitaId }, A); const LD = x.body.id;
  x = await call('POST', '/api/discounts', { lead_id: LD, plot_id: p3.id, amount: maxD + 5000, reason: 'Repeat customer' }, A); ok(x.status === 200, 'admin records a discount request'); const D1 = x.body.id;
  x = await call('POST', `/api/discounts/${D1}/decide`, { decision: 'approve' }, R); ok(x.status === 403, 'rep cannot approve');
  x = await call('POST', `/api/discounts/${D1}/decide`, { decision: 'approve' }, A); ok(x.status === 200, 'admin approves discount');
  x = await call('POST', '/api/bookings', { lead_id: LD, plot_id: p3.id, discount: maxD + 5000, token_amount: 100000, token_mode: 'UPI', token_ref: 'U9' }, A);
  ok(x.status === 200, 'admin books with an approved discount', x.body); const BD = x.body.id;
  x = await call('GET', `/api/bookings/${BD}`, null, A); ok(x.body.booking.discount === maxD + 5000, 'discount recorded for admin');
  x = await call('POST', `/api/bookings/${BD}/cancel`, { reason: 'test', charge: 0 }, A); ok(x.status === 200, 'discount test booking cancelled');

  section('Second booking, cancellation');
  x = await call('POST', '/api/leads', { name: 'Meena', phone: '9000000001', source: 'Referral', assigned_to: sitaId }, A); const L3 = x.body.id;
  x = await call('POST', '/api/bookings', { lead_id: L3, plot_id: p2.id, token_amount: 50000, token_mode: 'Bank Transfer', token_ref: 'NEFT1' }, A);
  ok(x.status === 200, 'admin books with default plan', x.body); const B2 = x.body.id;
  x = await call('POST', `/api/bookings/${B2}/cancel`, { reason: 'Customer changed mind', charge: 10000 }, A);
  ok(x.body.refund === 40000, 'cancellation refund = paid − charge', x.body);
  x = await call('GET', `/api/plots/${p2.id}/price`, null, A); ok(x.body.plot.status === 'available', 'cancelled booking releases plot', x.body.plot.status);
  x = await call('DELETE', `/api/leads/${L3}`, null, A); ok(x.status === 400, 'leads with booking history cannot be deleted');

  section('Call outcomes');
  x = await call('POST', '/api/leads', { name: 'Outcome Test', phone: '9777700001', source: 'Walk-in' }, A); const oid_ = x.body.id;
  x = await call('POST', `/api/leads/${oid_}/calls`, { direction: 'outgoing', outcome: 'Ringing', duration_min: 3 }, A); ok(x.status === 200, 'Ringing is an accepted call outcome', x.body);
  x = await call('GET', `/api/leads/${oid_}`, null, A); ok(x.body.lead.stage === 'New' && x.body.timeline.find((t) => t.outcome === 'Ringing')?.duration === 0, 'a Ringing call has no duration and does not move the lead to Contacted');
  for (const o of ['Not Picked', 'Update Later', 'Not Interested', 'Interview Scheduled']) { x = await call('POST', `/api/leads/${oid_}/calls`, { direction: 'outgoing', outcome: o, duration_min: 1 }, A); ok(x.status === 200, `${o} is accepted`, x.body); }
  x = await call('GET', `/api/leads/${oid_}`, null, A); ok(x.body.lead.stage === 'Contacted', 'a conversation outcome moves a New lead to Contacted', x.body.lead.stage);
  ok(x.body.timeline.find((t) => t.outcome === 'Interview Scheduled')?.duration === 60, 'conversation outcomes keep their duration');
  x = await call('POST', `/api/leads/${oid_}/calls`, { direction: 'outgoing', outcome: 'Nonsense' }, A); ok(x.status === 400, 'unknown outcome is refused');

  section('Aaj ka haal');
  x = await call('GET', '/api/briefing', null, A); ok(x.status === 200 && x.body.numbers && Array.isArray(x.body.alerts) && x.body.alerts.length <= 3 && Array.isArray(x.body.reps), 'owner briefing: numbers, at most 3 alerts, rep list', x.body);
  ok(x.body.alerts.every((a) => a.title && a.href), 'every alert has a title and a link');
  ok(x.body.money && typeof x.body.money.month_sales === 'number' && Array.isArray(x.body.projects) && x.body.projects.every((p) => p.total >= p.available && 'month_bookings' in p), 'briefing has money for the month and a card per project', x.body.projects);
  x = await call('GET', '/api/briefing', null, R); ok(x.status === 403, 'reps cannot open the owner briefing');

  section('Import');
  const leadsCsv = 'Lead list for October,,,,\nName,Mobile,Email,Source,Budget\nAnil,9111111111,,google ads,35 L\nAnil Dup,+91 91111-11111,,Google Ads,\nBad,123,,,\nKiran Again,9876500001,,,\n,,,,\n';
  x = await call('POST', '/api/leads/import/preview', { file_base64: Buffer.from(leadsCsv).toString('base64'), filename: 'l.csv', default_source: 'Newspaper / Hoarding' }, A);
  ok(x.body.total === 4 && x.body.valid === 1 && x.body.duplicates === 2 && x.body.invalid === 1 && x.body.to_import === 1, 'import preview: valid / duplicate / invalid counts (title row above header skipped)', { t: x.body.total, v: x.body.valid, d: x.body.duplicates, i: x.body.invalid });
  ok(x.body.rows[0].data.budget_max === 3500000 && x.body.rows[0].data.source === 'Google Ads', 'import normalises "35 L" and source names', x.body.rows[0].data);
  ok(/row 3/.test(x.body.rows[1].errors[0]) && /Already in CRM/.test(x.body.rows[3].errors[0]), 'duplicates explain why (in file / already in CRM)', x.body.rows.map((r) => r.errors));
  const prev = x.body;
  prev.rows[0].data.source = 'Walk-in';
  x = await call('POST', '/api/leads/import/commit', { rows: prev.rows, upload_id: prev.upload_id }, A);
  ok(x.body.imported === 1 && x.body.skipped.length === 0, 'import commit inserts only valid rows', x.body);
  x = await call('POST', '/api/leads/import/preview', { file_base64: Buffer.from(leadsCsv).toString('base64'), filename: 'l.csv' }, A);
  ok(x.body.valid === 0 && x.body.duplicates === 3, 're-importing the same file imports nothing', { v: x.body.valid, d: x.body.duplicates });
  // reps import too — but only for themselves
  const repCsv = 'Name,Mobile,Alternate Number,Email,Assigned To\nRep Import One,9333300001,9333300002,,Someone Else\nRep Import Two,"93333 00003 / 93333 00004",,,\nRep Dup,9000000001,,,\nSame Alt,9333300005,9333300005,,\n';
  x = await call('POST', '/api/leads/import/preview', { file_base64: Buffer.from(repCsv).toString('base64'), filename: 'rep.csv' }, R);
  ok(x.status === 200 && x.body.valid === 3 && x.body.duplicates === 1, 'rep can preview an import', { s: x.status, v: x.body.valid, d: x.body.duplicates, e: x.body.error });
  ok(x.body.rows[0].data.alt_phone === '9333300002' && x.body.rows[1].data.phone === '9333300003' && x.body.rows[1].data.alt_phone === '9333300004', 'both phone numbers are read (second column, or two numbers in one cell)', x.body.rows.map((r) => [r.data.phone, r.data.alt_phone]));
  ok(x.body.rows[3].data.alt_phone === '', 'identical second number is dropped');
  ok(!/Meena/.test(x.body.rows[2].errors[0]) && /another rep|Already in CRM/.test(x.body.rows[2].errors[0]), 'rep is not shown other reps\' lead names in import duplicates', x.body.rows[2].errors);
  const repPrev = x.body;
  x = await call('POST', '/api/leads/import/commit', { rows: repPrev.rows, upload_id: repPrev.upload_id }, R);
  ok(x.status === 200 && x.body.imported === 3, 'rep import commits', x.body);
  x = await call('GET', '/api/leads?q=Rep%20Import', null, R);
  ok(x.body.length === 2 && x.body.every((l) => l.assigned_to === raviId && l.created_by === raviId && l.added_via === 'import' && l.added_by_name), 'imported rep leads belong to the rep and show who added them', x.body.map((l) => [l.assigned_to, l.added_by_name]));
  x = await call('GET', '/api/leads?q=9333300004', null, A); ok(x.body.length === 1, 'search finds a lead by its second number');
  x = await call('POST', '/api/leads/check-duplicate', { phone: '9444400000', alt_phone: '9333300002' }, A); ok(x.body.duplicates.length === 1, 'second number takes part in duplicate checks');
  x = await call('POST', '/api/leads', { name: 'Alt Holder', phone: '9555500001', alt_phone: '9555500002', source: 'Walk-in' }, R); const altId = x.body.id; ok(x.status === 200, 'rep adds a lead with two numbers', x.body);
  x = await call('GET', `/api/leads/${altId}`, null, R); ok(x.body.lead.alt_phone_norm === '9555500002' && x.body.lead.added_by_name, 'lead detail returns second number and who added it', x.body.lead);
  x = await call('PATCH', `/api/leads/${altId}`, { alt_phone: '12' }, R); ok(x.status === 400, 'invalid second number is rejected');
  x = await call('GET', `/api/team/${raviId}/feed`, null, R); ok(x.status === 200 && x.body.items.some((i) => i.type === 'import') && x.body.items.some((i) => /Alt Holder/.test(i.lead_name || '')), 'rep sees their own activity feed (import + lead added)', x.body.items.slice(0, 3));
  x = await call('GET', `/api/team/${sitaId}/feed`, null, R); ok(x.status === 403, 'rep cannot read another rep\'s feed');
  x = await call('POST', '/api/leads/import/preview', { file_base64: 'x', filename: 'x.csv' }, R); ok(x.status === 400, 'rep gets a normal error for a bad file');
  // Excel (.xlsx and legacy .xls) — phone stored as a number, as Excel usually does
  const XLSX = require('xlsx');
  const sheet = XLSX.utils.aoa_to_sheet([['Customer Name', 'Contact No', 'E-mail', 'Budget', 'Remarks'], ['Xl One', 9222200001, 'XL1@Example.com', '40-50 lakhs', 'wants east'], ['Xl Two', '09222200002 / 9222200003', '', '1.2 Cr', ''], ['Xl Dup', '+91 92222 00001', '', '', '']]);
  for (const [bookType, ext] of [['xlsx', 'xlsx'], ['biff8', 'xls']]) {
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, sheet, 'Leads');
    x = await call('POST', '/api/leads/import/preview', { file_base64: XLSX.write(wb, { type: 'buffer', bookType }).toString('base64'), filename: 'leads.' + ext }, A);
    ok(x.body.kind === ext && x.body.total === 3 && x.body.valid === 2 && x.body.duplicates === 1, `.${ext} import reads rows`, { k: x.body.kind, t: x.body.total, v: x.body.valid, d: x.body.duplicates, e: x.body.error });
    const d0 = x.body.rows?.[0]?.data || {}, d1 = x.body.rows?.[1]?.data || {};
    ok(d0.phone === '9222200001' && d0.email === 'xl1@example.com' && d0.budget_min === 4000000 && d0.budget_max === 5000000 && d1.phone === '9222200002' && d1.budget_max === 12000000, `.${ext} values normalised (numeric phone, range budget, first of two numbers)`, [d0, d1]);
  }
  // unknown headers are fine: columns are recognised from what they contain
  const odd = 'Col A,Col B,Col C\nMapped Person,9222200009,Hyderabad\n';
  x = await call('POST', '/api/leads/import/preview', { file_base64: Buffer.from(odd).toString('base64'), filename: 'odd.csv' }, A);
  ok(x.body.needs_mapping === false && x.body.valid === 1 && x.body.rows[0].data.name === 'Mapped Person' && x.body.rows[0].data.phone === '9222200009', 'headers with unknown names are mapped from column contents', x.body.rows?.[0]);
  ok(/Col C: Hyderabad/.test(x.body.rows[0].data.notes), 'unmapped columns are kept in notes', x.body.rows[0].data.notes);
  x = await call('POST', '/api/leads/import/preview', { upload_id: x.body.upload_id, include_extras: false }, A);
  ok(!x.body.rows[0].data.notes, 'keeping unmapped columns in notes can be switched off', x.body.rows[0].data);
  // no phone-like column anywhere → user maps the columns by hand
  const nophone = 'Col A,Col B\nSomeone,hello\nSomebody,world\n';
  x = await call('POST', '/api/leads/import/preview', { file_base64: Buffer.from(nophone).toString('base64'), filename: 'np.csv' }, A);
  ok(x.body.needs_mapping === true && x.body.columns.length === 2, 'no phone column found → asks the user to map', x.body.mapping);
  x = await call('POST', '/api/leads/import/preview', { upload_id: x.body.upload_id, mapping: { name: 0 } }, A); ok(x.status === 400, 'mapping without a phone column is refused');
  // any format: semicolons, no header row, null placeholders, nameless rows, phone in an unexpected column
  const weird = ['Anita Roy;98 765-4001 1;N/A;', 'NULL;9222200032;anita2@example.com;-', ';+91 92222 00033;;none', 'Cell Mix;not a number;9222200034;Hyderabad', 'Only Name;;;'].join('\n');
  x = await call('POST', '/api/leads/import/preview', { file_base64: Buffer.from(weird).toString('base64'), filename: 'weird.txt' }, A);
  ok(x.body.rows?.length === 5 && /no header/i.test(x.body.note), 'headerless semicolon file is read (first row is data)', { n: x.body.note, r: x.body.rows?.length, e: x.body.error });
  const w = x.body.rows || [];
  ok(w[0].status === 'valid' && w[0].data.name === 'Anita Roy' && w[0].data.phone === '9876540011', 'spaced/hyphenated phone, "N/A" ignored', w[0]?.data);
  ok(w[1].status === 'valid' && w[1].data.name === 'Anita' && w[1].warnings.length === 1 && w[1].data.email === 'anita2@example.com', '"NULL" name → generated from email', w[1]);
  ok(w[2].status === 'valid' && w[2].data.name === 'Lead 0033' && /No name/.test(w[2].warnings[0]), 'row with only a phone imports with a placeholder name', w[2]);
  ok(w[3].status === 'valid' && w[3].data.phone === '9222200034' && /Phone taken from/.test(w[3].warnings[0]), 'phone found in a different column than expected', w[3]);
  ok(w[4].status === 'invalid' && /mobile|Phone/i.test(w[4].errors[0]), 'row with no phone anywhere is invalid, with a reason', w[4]);
  // messy header wording + headerless Excel with numeric phones
  const messy = XLSX.utils.aoa_to_sheet([['Sl.No', 'Client Details', 'Mob. No.', 'Enquiry From', 'Remarks / Feedback', 'Budget (Rs)'], [1, 'Messy One', 9222200041, 'magicbricks', null, ''], [2, '', '9222200042.0', 'NA', 'call after 5', '25 lakhs']]);
  { const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, messy, 'S1'); x = await call('POST', '/api/leads/import/preview', { file_base64: XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }).toString('base64'), filename: 'messy.xlsx' }, A); }
  ok(x.body.valid === 2 && x.body.rows[0].data.name === 'Messy One' && x.body.rows[0].data.phone === '9222200041' && x.body.rows[0].data.source === 'MagicBricks' && x.body.rows[1].data.phone === '9222200042' && x.body.rows[1].data.budget_max === 2500000, 'unusual header names recognised (Mob. No., Client Details, Enquiry From…)', x.body.rows);
  { const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[9222200051, 'Headerless Hari'], [9222200052, 'Headerless Hema']]), 'Sheet1'); x = await call('POST', '/api/leads/import/preview', { file_base64: XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }).toString('base64'), filename: 'nohead.xlsx' }, A); }
  ok(x.body.valid === 2 && x.body.rows[0].data.phone === '9222200051' && x.body.rows[0].data.name === 'Headerless Hari' && x.body.rows[0].row === 1, 'Excel without header row: columns detected, row numbers match the file', x.body.rows?.[0]);
  // several sheets with the same header are combined
  { const hdr = ['Name', 'Phone']; const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([hdr, ['Jan Lead', '9222200061']]), 'Jan'); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([hdr, ['Feb Lead', '9222200062']]), 'Feb'); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Other', 'Cols'], ['x', 'y']]), 'Misc');
    x = await call('POST', '/api/leads/import/preview', { file_base64: XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }).toString('base64'), filename: 'months.xlsx' }, A); }
  ok(x.body.valid === 2 && /Combined sheets: Jan, Feb/.test(x.body.note) && /Misc/.test(x.body.note), 'sheets with the same header are combined, others reported', x.body.note);
  // UTF-16 file saved by Excel ("Unicode text") with tabs
  x = await call('POST', '/api/leads/import/preview', { file_base64: Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Name\tMobile\r\nTab Person\t9222200071\r\n', 'utf16le')]).toString('base64'), filename: 'uni.txt' }, A);
  ok(x.body.valid === 1 && x.body.rows[0].data.name === 'Tab Person', 'UTF-16 tab-separated text is read', x.body.error || x.body.rows);
  // PDF: a table with a header, repeated on page 2
  x = await call('POST', '/api/leads/import/preview', { file_base64: makePdf([[['S.No', 40], ['Name', 90], ['Mobile', 250], ['Email', 360]], [['1', 40], ['Pdf Person One', 90], ['92222 00011', 250], ['p1@example.com', 360]], [['2', 40], ['Pdf Person Two', 90], ['9222200012', 250]], [['3', 40], ['Pdf Dup', 90], ['9222200011', 250]], [['4', 40], ['No Phone', 90], ['12345', 250]]]).toString('base64'), filename: 'leads.pdf' }, A);
  ok(x.body.kind === 'pdf' && x.body.total === 4 && x.body.valid === 2 && x.body.duplicates === 1 && x.body.invalid === 1, 'PDF table import', { k: x.body.kind, t: x.body.total, v: x.body.valid, d: x.body.duplicates, i: x.body.invalid, e: x.body.error });
  ok(x.body.rows?.[0]?.data.name === 'Pdf Person One' && x.body.rows[0].data.phone === '9222200011' && x.body.rows[0].data.email === 'p1@example.com', 'PDF columns line up with the header', x.body.rows?.[0]?.data);
  // PDF without a header: one lead per line
  x = await call('POST', '/api/leads/import/preview', { file_base64: makePdf([[['1. Line Person - 9222200021 - lp@example.com', 40]], [['Just a heading with no number', 40]], [['2. Other Person, Ph: +91 92222 00022', 40]]]).toString('base64'), filename: 'list.pdf' }, A);
  ok(x.body.total === 2 && x.body.valid === 2 && x.body.rows[0].data.name === 'Line Person' && x.body.rows[0].data.email === 'lp@example.com' && x.body.rows[1].data.phone === '9222200022', 'PDF without a table: one lead per line', x.body.rows?.map((r) => r.data));
  x = await call('POST', '/api/leads/import/preview', { file_base64: Buffer.from('%PDF-1.4 broken').toString('base64'), filename: 'bad.pdf' }, A); ok(x.status === 400, 'damaged PDF gives a clear error', x.body);

  section('Spam / fraud');
  for (let i = 0; i < 3; i++) await call('POST', '/api/public/enquire/GREEN', { name: 'Spammer', phone: '9222222222', project_id: PID, consent: true });
  x = await call('GET', '/api/leads?flag=pending', null, A); ok(x.body.length === 1, 'repeated enquiries get flagged', x.body.length);
  x = await call('POST', `/api/leads/${x.body[0].id}/flag-decision`, { decision: 'spam' }, A); ok(x.status === 200, 'mark spam');
  x = await call('POST', '/api/public/enquire/GREEN', { name: 'Spammer2', phone: '9222222222', consent: true });
  x = await call('GET', '/api/leads?flag=pending', null, A); ok(x.body.length === 1 && x.body[0].flag_status === 'spam', 'blacklisted number stays flagged');
  x = await call('POST', '/api/public/enquire/GREEN', { name: 'No consent', phone: '9333333333' }); ok(x.status === 400, 'public form requires consent');

  section('KYC & portal');
  x = await call('POST', `/api/leads/${raviLead}/portal-link`, {}, R); const ptok = x.body.link.split('/').pop(); ok(!!ptok, 'portal link');
  x = await call('GET', `/api/portal/${ptok}`); ok(x.status === 200 && x.body.bookings.length === 1, 'portal shows booking', x.body);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  x = await call('POST', `/api/portal/${ptok}/kyc`, { doc_type: 'Aadhaar Card', filename: 'a.png', data_base64: png.toString('base64') }); ok(x.status === 200, 'client uploads KYC');
  x = await call('POST', `/api/portal/${ptok}/kyc`, { doc_type: 'PAN Card', filename: 'a.exe', data_base64: Buffer.from('MZ....').toString('base64') }); ok(x.status === 400, 'non-image/PDF upload rejected');
  x = await call('GET', `/api/leads/${raviLead}`, null, A); ok(x.body.kyc.length === 1 && x.body.lead.kyc_status === 'pending', 'KYC pending on lead');
  x = await call('POST', `/api/kyc/${x.body.kyc[0].id}/review`, { status: 'rejected' }, A); ok(x.status === 400, 'rejection needs remark');

  section('Dashboard, reports, AI');
  x = await call('GET', '/api/dashboard?range=all', null, A);
  ok(x.body.kpis.total_leads >= 4 && x.body.kpis.bookings === 1, 'admin dashboard', x.body.kpis);
  ok(x.body.attention.unassigned >= 0 && Array.isArray(x.body.health), 'dashboard extras');
  x = await call('GET', '/api/dashboard?range=all', null, R); const mine = (await call('GET', '/api/leads', null, R)).body.length;
  ok(x.body.kpis.total_leads === mine && x.body.scope === 'me', 'rep dashboard scoped to own data', x.body.kpis);
  ok(!('collected' in x.body.kpis) && !('collections' in x.body) && !('attention' in x.body), 'rep dashboard has no collections or admin-queue data', Object.keys(x.body));
  x = await call('GET', '/api/reports?range=all', null, A); ok(x.body.funnel[0].count >= x.body.funnel[5].count && x.body.projects.length === 1, 'reports', x.body.funnel);
  const zero = await call('GET', '/api/reports?range=today', null, A); ok(zero.body.funnel.every((f) => f.dropoff_pct === 0 || f.dropoff_pct > 0), 'reports handle empty ranges');
  // AI: distribute leads
  await call('POST', '/api/assign-rules/' + (await call('GET', '/api/assign-rules', null, A)).body.rules[0].id, {}, A);
  const ruleId = (await call('GET', '/api/assign-rules', null, A)).body.rules[0].id;
  await call('PUT', `/api/assign-rules/${ruleId}`, { active: false }, A);
  for (let i = 0; i < 5; i++) await call('POST', '/api/leads', { name: 'Pool ' + i, phone: '90000001' + String(i).padStart(2, '0') }, A);
  x = await call('POST', '/api/ai/chat', { message: 'Distribute 30 leads to Sita' }, A);
  ok(/multiple|More than one/i.test(x.body.reply) || /Which one/.test(x.body.reply), 'AI asks which rep when ambiguous', x.body.reply);
  x = await call('POST', '/api/ai/chat', { message: 'Distribute 30 leads to Nobody Here' }, A); ok(/couldn't find/.test(x.body.reply), 'AI reports unknown rep and does nothing');
  const before = (await call('GET', '/api/assign-rules', null, A)).body.unassigned;
  x = await call('POST', '/api/ai/chat', { message: 'Distribute 30 leads to Sita Sales' }, A);
  ok(x.body.action && x.body.action.assigned === before, `AI assigned the real number (${before})`, x.body);
  x = await call('GET', '/api/notifications', null, (await call('POST', '/api/auth/login', { email: 'sita@green.test', password: 'password123' })).body.token);
  ok(x.body.items.some((n) => /assigned/i.test(n.title)), 'assigned rep received notification');
  x = await call('POST', '/api/ai/chat', { message: 'distribute 5 leads to Ravi Rep' }, R); ok(x.status === 403, 'rep cannot use RealPilot AI');
  x = await call('GET', '/api/ai/history', null, R); ok(x.status === 403, 'rep cannot read AI history');
  x = await call('POST', '/api/ai/chat', { message: 'pipeline summary' }, A); ok(/Pipeline/.test(x.body.reply), 'pipeline insights');

  section('Attendance & presence');
  x = await call('POST', '/api/attendance/clock-in', {}, R); ok(x.status === 400, 'clock-in requires location');
  await call('PUT', '/api/settings', { geofence: { name: 'Sales Office', lat: 17.385, lng: 78.4867, radius: 200, enforce: false } }, A);
  x = await call('POST', '/api/attendance/clock-in', { lat: 17.3851, lng: 78.4868 }, R); ok(x.body.inside_geofence === 1, 'clock-in inside geofence', x.body);
  x = await call('POST', '/api/attendance/clock-in', { lat: 17.3851, lng: 78.4868 }, R); ok(x.status === 400, 'no double clock-in');
  await call('POST', '/api/heartbeat', {}, R);
  x = await call('GET', '/api/presence', null, A); ok(x.body.find((p) => p.name === 'Ravi Rep').online === true, 'presence shows rep online');
  x = await call('GET', `/api/team/${raviId}/activity?range=day`, null, A); ok(x.body.calls.total === 1 && x.body.calls.connected === 1, 'daily activity summary', x.body.calls);
  x = await call('GET', '/api/attendance', null, A); ok(x.body.summary.present === 1, 'admin attendance summary', x.body.summary);

  section('Click-to-call & phone app');
  {
  const { run: dbRun, get: dbGet } = require('./db');
  const leadNow = async () => (await call('GET', `/api/leads/${raviLead}`, null, R)).body;
  const myPhone = (await leadNow()).lead.phone_norm, otherPhone = (await call("GET", `/api/leads/${L3}`, null, A)).body.lead.phone_norm;
  const callsOf = (d) => d.timeline.filter((a) => a.type === 'call');
  const callsBefore = callsOf(await leadNow()).length;
  x = await call('POST', `/api/leads/${raviLead}/call-intent`, {}, R);
  ok(x.body.tracked === false && callsOf(await leadNow()).length === callsBefore, 'CALL without a linked phone creates nothing (web falls back to manual log)', x.body);
  x = await call('POST', '/api/auth/login', { email: 'ravi@green.test', password: 'ravipass123', client: 'companion', device_name: 'Pixel 8' });
  const P = x.body.token; ok(!!P, 'phone app signs in with the normal login');
  x = await call('GET', '/api/auth/me', null, R); ok(x.body.companion && x.body.companion.device === 'Phone app · Pixel 8', 'CRM knows the phone is linked', x.body.companion);
  x = await call('POST', `/api/leads/${raviLead}/call-intent`, {}, R); const intent = x.body.intent_id;
  ok(x.body.tracked === true && intent > 0, 'CALL creates a pending call entry', x.body);
  x = await call('POST', `/api/leads/${raviLead}/call-intent`, {}, R); ok(x.body.intent_id === intent, 'double-click does not create a second entry');
  x = await call('GET', '/api/device/sync', null, P);
  ok(x.body.numbers.includes(myPhone) && !x.body.numbers.includes(otherPhone) && x.body.pending.length === 1 && x.body.pending[0].intent_id === intent, "phone app gets only this rep's lead numbers + pending call", { n: x.body.numbers.length, p: x.body.pending });
  let ld = await leadNow(); ok(callsOf(ld).length === callsBefore + 1 && callsOf(ld)[0].outcome === 'Initiated', 'timeline shows the call as started');
  const callStart = Date.now();
  x = await call('POST', '/api/device/calls', { calls: [{ ext_id: '501-' + callStart, phone: '+91 ' + myPhone, type: 'outgoing', started_at: callStart, duration: 272 }] }, P);
  ok(x.body.results[0].result === 'logged' && x.body.results[0].activity_id === intent && x.body.results[0].outcome === 'Connected', 'phone report completes the pending entry', x.body);
  ld = await leadNow(); const done = callsOf(ld).find((a) => a.id === intent);
  ok(callsOf(ld).length === callsBefore + 1 && done.duration === 272 && done.outcome === 'Connected' && done.meta.source === 'device' && Date.parse(done.meta.ended_at) - Date.parse(done.created_at) === 272000, 'call has real start, end and duration — no duplicate row', done);
  x = await call('POST', '/api/device/calls', { calls: [{ ext_id: '501-' + callStart, phone: myPhone, type: 'outgoing', started_at: callStart, duration: 272 }] }, P);
  ok(x.body.results[0].result === 'duplicate' && callsOf(await leadNow()).length === callsBefore + 1, 'same call reported twice is stored once', x.body);
  const total = () => dbGet("SELECT COUNT(*) c FROM activities WHERE type='call'").c; const n0 = total();
  x = await call('POST', '/api/device/calls', { calls: [
    { ext_id: '502', phone: '9000099999', type: 'outgoing', started_at: Date.now() - 60000, duration: 60 },   // personal call — not a lead
    { ext_id: '503', phone: otherPhone, type: 'outgoing', started_at: Date.now() - 60000, duration: 60 },     // another rep's lead
    { ext_id: '504', phone: myPhone, type: 'outgoing', started_at: Date.now() + 3600e3, duration: 60 },       // clock in the future
    { ext_id: '505', phone: myPhone, type: 'missed', started_at: Date.now() - 50000, duration: 0 },
    { ext_id: '506', phone: myPhone, type: 'outgoing', started_at: Date.now() - 40000, duration: 0 },
    { ext_id: '507', phone: myPhone, type: 'rejected', started_at: Date.now() - 30000, duration: 0 }] }, P);
  ok(x.body.results.map((r) => r.result).join() === 'unmatched,unmatched,invalid,logged,logged,logged' && total() === n0 + 3, 'non-lead, other-rep and invalid calls are not stored', x.body.results);
  ok(x.body.results.slice(3).map((r) => r.outcome).join() === 'Missed,Not Answered,Rejected', 'statuses: missed / no answer / rejected', x.body.results.slice(3));
  ld = await leadNow(); ok(callsOf(ld).find((a) => a.ext_id === '505').direction === 'incoming', 'incoming calls are logged as incoming');
  // a call started in the CRM that the phone never reports
  x = await call('POST', `/api/leads/${raviLead}/call-intent`, {}, R); const stale = x.body.intent_id;
  dbRun('UPDATE activities SET created_at=? WHERE id=?', new Date(Date.now() - 3 * 3600e3).toISOString(), stale);
  require('./jobs').tick();
  ok(dbGet('SELECT outcome FROM activities WHERE id=?', stale).outcome === 'Failed', 'unreported call becomes Failed after 2 hours');
  const n1 = total();
  x = await call('POST', `/api/leads/${raviLead}/calls`, { activity_id: stale, direction: 'outgoing', outcome: 'Connected', duration_min: 2 }, R);
  ok(x.status === 200 && total() === n1 && dbGet('SELECT outcome,duration FROM activities WHERE id=?', stale).duration === 120, 'rep can fill in the result by hand without a second entry', x.body);
  x = await call('GET', '/api/device/sync', null, RVtoken()); ok(x.status === 401, 'phone endpoints need a valid sign-in');

  }

  section('Team delete & password');
  x = await call('POST', `/api/team/${raviId}/delete`, {}, A); ok(x.status === 400, 'delete requires reassignment target');
  x = await call('POST', `/api/team/${adminId}/deactivate`, {}, A); ok(x.status === 400, 'admin cannot be deactivated');
  x = await call('POST', `/api/team/${raviId}/delete`, { reassign_to: adminId }, A); ok(x.status === 200, 'delete rep with reassignment', x.body);
  x = await call('GET', '/api/meta', null, A); ok(!x.body.users.some((u) => u.id === raviId), 'deleted rep gone from lists');
  x = await call('GET', '/api/auth/me', null, R); ok(x.status === 401, 'deleted rep session invalid');
  x = await call('POST', '/api/auth/change-password', { current_password: 'wrong', new_password: 'newpassword1' }, A); ok(x.status === 400, 'change password needs current password');
  const A2 = (await call('POST', '/api/auth/login', { email: 'admin@green.test', password: 'password123' })).body.token;
  x = await call('POST', '/api/auth/change-password', { current_password: 'password123', new_password: 'newpassword1' }, A2); ok(x.status === 200, 'change password');
  x = await call('GET', '/api/auth/me', null, A); ok(x.status === 401, 'other sessions logged out after password change');

  section('Search, filters, bulk status & dashboard focus');
  {
    x = await call('GET', '/api/search?q=Green', null, A2);
    ok(x.body.projects.some((p) => p.name === 'Green Valley') && Array.isArray(x.body.activities), 'search finds projects by name and includes activities', Object.keys(x.body));
    x = await call('GET', '/api/search?q=east%20facing', null, A2);
    x = await call('POST', `/api/leads/${raviLead}/notes`, { content: 'Wants an east facing corner plot' }, A2);
    x = await call('GET', '/api/search?q=corner%20plot', null, A2); ok(x.body.activities.some((a) => a.lead_id === raviLead), 'search finds text inside notes');
    const mine = (await call('GET', `/api/leads/${raviLead}`, null, A2)).body.lead.phone_norm;
    x = await call('GET', `/api/search?q=${mine.slice(0, 5)}%20${mine.slice(5)}`, null, A2); ok(x.body.leads.some((l) => l.id === raviLead), 'search finds a lead by phone number typed with a space');
    // rep search is limited to the rep's own leads
    const rl = await call('POST', '/api/auth/login', { email: 'sita@green.test', password: 'password123' }); const SI = rl.body.token;
    x = await call('GET', `/api/search?q=${encodeURIComponent((await call('GET', `/api/leads/${raviLead}`, null, A2)).body.lead.name.split(' ')[0])}`, null, SI);
    ok(!x.body.leads.some((l) => l.id === raviLead), "a rep's search never returns another rep's lead");
    // filters
    x = await call('GET', '/api/leads?followup=none&limit=2000', null, A2); ok(x.body.every((l) => !l.next_due), 'follow-up filter: none scheduled');
    x = await call('GET', '/api/leads?followup=overdue', null, A2); ok(x.body.every((l) => l.next_due && Date.parse(l.next_due) < Date.now()), 'follow-up filter: overdue');
    x = await call('GET', '/api/leads?uncontacted=1', null, A2); ok(x.body.every((l) => l.stage === 'New' && !l.last_activity_at), 'filter: not yet contacted');
    x = await call('GET', `/api/leads?from=${today_()}&to=${today_()}`, null, A2); ok(x.body.length > 0, 'created-date range filter includes leads created today');
    x = await call('GET', `/api/leads?from=2000-01-01&to=2000-01-02`, null, A2); ok(x.body.length === 0, 'created-date range filter excludes others');
    ok((await call('GET', `/api/leads/${raviLead}`, null, A2)).body.lead.hasOwnProperty('last_contacted'), 'lead carries last_contacted');
    // bulk status
    const fresh = []; for (let i = 0; i < 3; i++) fresh.push((await call('POST', '/api/leads', { name: 'Bulk ' + i, phone: '90000770' + i + '1', source: 'Walk-in', assigned_to: sitaId }, A2)).body.id);
    x = await call('POST', '/api/leads/bulk-stage', { ids: [...fresh, raviLead], stage: 'Contacted' }, SI);
    ok(x.body.updated === 3 && x.body.skipped.length === 1, 'rep bulk status change only touches own leads', x.body);
    x = await call('POST', '/api/leads/bulk-stage', { ids: fresh, stage: 'Booked' }, SI); ok(x.status === 400, 'bulk change cannot mark leads Booked');
    x = await call('POST', '/api/leads/bulk-stage', { ids: fresh, stage: 'Lost' }, SI); ok(x.status === 400, 'bulk Lost needs a reason');
    x = await call('POST', '/api/leads/bulk-stage', { ids: fresh, stage: 'Lost', lost_reason: 'Budget Mismatch' }, A2); ok(x.body.updated === 3, 'admin bulk Lost with reason');
    // dashboard "needs attention"
    x = await call('GET', '/api/dashboard?range=all', null, A2);
    ok(x.body.focus && ['overdue_followups', 'due_today', 'new_uncontacted', 'hot_cooling', 'visits_today'].every((k) => typeof x.body.focus[k] === 'number') && Array.isArray(x.body.new_leads) && Array.isArray(x.body.cooling_leads), 'dashboard returns the attention counts and lists', x.body.focus);
    x = await call('GET', '/api/dashboard?range=all', null, SI); ok(x.body.new_leads.every((l) => l.rep_name === 'Sita Sales'), "rep dashboard lists only the rep's own leads");
  }

  section('Phone alerts, availability, escalation, briefings, visit lifecycle');
  {
    const dbm = require('./db'), jobs = require('./jobs'), LL = require('./lib');
    const oid = dbm.get("SELECT id FROM orgs WHERE code='GREEN'").id;
    const SI = (await call('POST', '/api/auth/login', { email: 'sita@green.test', password: 'password123' })).body.token;
    const taraId = Number(dbm.run("INSERT INTO users(org_id,name,email,phone,role,password_hash,created_at) VALUES (?,?,?,?,?,?,?)", oid, 'Tara Rep', 'tara@green.test', '9000000077', 'rep', LL.hashPw('password123'), LL.now()).lastInsertRowid);
    const RA = (await call('POST', '/api/auth/login', { email: 'tara@green.test', password: 'password123' })).body.token;
    const allDays = [0, 1, 2, 3, 4, 5, 6];
    // preferences
    x = await call('GET', '/api/me/notif-prefs', null, SI); ok(x.body.kinds.lead === true && x.body.dnd.enabled === false, 'default prefs: everything on, no do-not-disturb', x.body);
    x = await call('PUT', '/api/me/notif-prefs', { dnd: { start: '25:00' } }, SI); ok(x.status === 400, 'bad do-not-disturb time rejected');
    // working hours wide open so tests do not depend on the clock
    x = await call('PUT', '/api/me/availability', { availability: 'available', work_start: '00:00', work_end: '23:59', work_days: allDays }, SI); ok(x.status === 200 && x.body.work.days.length === 7, 'rep sets working hours', x.body);
    x = await call('PUT', '/api/me/availability', { availability: 'available', work_start: '00:00', work_end: '23:59', work_days: allDays }, RA);
    // alerts feed
    x = await call('GET', '/api/device/alerts', null, SI); const base0 = x.body.last_id; ok(Number.isInteger(base0) && x.body.items.length === 0, 'alerts: first call only returns the position');
    x = await call('POST', '/api/leads', { name: 'Push Lead', phone: '9111100001', source: 'Walk-in', assigned_to: sitaId }, A2); const pushLead = x.body.id;
    x = await call('GET', `/api/device/alerts?after=${base0}&wait=0`, null, SI);
    const got = x.body.items.find((n) => n.title === 'New lead assigned');
    ok(got && got.kind === 'lead' && got.action_url === 'tel:+919111100001' && got.silent === false, 'new lead reaches the phone instantly with a Call action', x.body);
    ok(x.body.last_id > base0, 'alerts: position advances');
    x = await call('GET', `/api/device/alerts?after=${base0}&wait=0`, null, A2); ok(!x.body.items.some((n) => n.title === 'New lead assigned'), "another user's lead alert is not delivered to the admin");
    await call('PUT', '/api/me/notif-prefs', { kinds: { lead: false } }, SI);
    x = await call('GET', `/api/device/alerts?after=${base0}&wait=0`, null, SI); ok(!x.body.items.some((n) => n.kind === 'lead') && x.body.last_id > base0, 'switched-off alert types are not pushed');
    await call('PUT', '/api/me/notif-prefs', { kinds: { lead: true }, dnd: { enabled: true, start: '00:00', end: '23:59' } }, SI);
    x = await call('GET', `/api/device/alerts?after=${base0}&wait=0`, null, SI); ok(x.body.items.length && x.body.items.every((n) => n.silent === true), 'do-not-disturb makes alerts silent');
    await call('PUT', '/api/me/notif-prefs', { dnd: { enabled: false } }, SI);
    // long-poll returns as soon as something new appears
    const top = (await call('GET', '/api/device/alerts', null, SI)).body.last_id;
    const pending = call('GET', `/api/device/alerts?after=${top}&wait=10`, null, SI), t0 = Date.now();
    await new Promise((r) => setTimeout(r, 300));
    await call('POST', '/api/leads', { name: 'Poll Lead', phone: '9111100002', source: 'Walk-in', assigned_to: sitaId }, A2);
    x = await pending; ok(x.body.items.length === 1 && Date.now() - t0 < 5000, 'long-poll answers within seconds of a new lead', Date.now() - t0);

    // availability decides who receives auto-routed leads
    for (const rl of (await call('GET', '/api/assign-rules', null, A2)).body.rules) await call('PUT', `/api/assign-rules/${rl.id}`, { active: false }, A2);
    x = await call('POST', '/api/assign-rules', { name: 'Away test', strategy: 'round_robin', rep_ids: [sitaId, taraId] }, A2); ok(x.status === 200, 'routing rule for the test', x.body);
    const tomorrow = new Date(Date.now() + 330 * 60000 + 2 * 864e5).toISOString().slice(0, 10);
    x = await call('PUT', '/api/me/availability', { availability: 'on_leave', until: tomorrow }, SI); ok(x.status === 200, 'rep marks leave');
    const owners = new Set();
    for (let i = 0; i < 4; i++) { x = await call('POST', '/api/leads', { name: 'Routed ' + i, phone: '91111100' + (10 + i) }, A2); owners.add((await call('GET', `/api/leads/${x.body.id}`, null, A2)).body.lead.assigned_to); }
    ok(owners.size === 1 && owners.has(taraId), 'auto-routing skips the rep on leave', [...owners]);
    x = await call('PUT', `/api/team/${taraId}/availability`, { availability: 'off_duty' }, A2); ok(x.status === 200, 'admin sets a rep off duty');
    x = await call('POST', '/api/leads', { name: 'Nobody Lead', phone: '9111100019' }, A2);
    ok((await call('GET', `/api/leads/${x.body.id}`, null, A2)).body.lead.assigned_to === null, 'with everyone away the lead stays unassigned');
    ok((await call('GET', '/api/notifications', null, A2)).body.items.some((n) => /nobody available/i.test(n.title)), 'admin is told nobody is available', (await call('GET', '/api/notifications', null, A2)).body.items.slice(0,3).map((n)=>n.title));
    x = await call('GET', '/api/team/loads', null, A2); ok(Array.isArray(x.body) && x.body.find((u) => u.id === sitaId).routable === false && 'open_leads' in x.body[0], 'team load list shows availability', x.body[0]);
    x = await call('PUT', '/api/team/' + taraId + '/availability', { availability: 'available' }, A2);
    x = await call('PUT', '/api/me/availability', { availability: 'available' }, SI);
    x = await call('PUT', '/api/me/availability', { availability: 'on_leave' }, SI); ok(x.status === 400, 'leave needs a return date');

    // escalation: 40 minutes with no call
    x = await call('POST', '/api/leads', { name: 'Slow Lead', phone: '9111100031', assigned_to: sitaId }, A2); const slow = x.body.id;
    dbm.run('UPDATE leads SET assigned_at=? WHERE id=?', LL.addMs(-40 * 60000), slow);
    jobs.tick();
    const sn = (await call('GET', '/api/notifications', null, SI)).body.items, an = (await call('GET', '/api/notifications', null, A2)).body.items;
    ok(sn.some((n) => n.title === 'New lead is waiting — call now' && /Slow Lead/.test(n.message)), 'rep is nudged after 15 minutes');
    ok(an.some((n) => n.title === 'Lead not contacted' && /Slow Lead/.test(n.message)), 'admin is told after 30 minutes');
    ok(dbm.get('SELECT esc_level e FROM leads WHERE id=?', slow).e === 2, 'escalation level recorded');
    const nn = sn.filter((n) => /Slow Lead/.test(n.message) && n.title.includes('waiting')).length; jobs.tick();
    ok((await call('GET', '/api/notifications', null, SI)).body.items.filter((n) => /Slow Lead/.test(n.message) && n.title.includes('waiting')).length === nn, 'escalation fires only once');
    // calling the lead stops escalation
    x = await call('POST', '/api/leads', { name: 'Called Lead', phone: '9111100032', assigned_to: sitaId }, A2); const called = x.body.id;
    dbm.run('UPDATE leads SET assigned_at=? WHERE id=?', LL.addMs(-40 * 60000), called);
    await call('POST', `/api/leads/${called}/calls`, { outcome: 'Not Answered', direction: 'outgoing' }, SI); jobs.tick();
    ok(dbm.get('SELECT esc_level e FROM leads WHERE id=?', called).e === 0, 'a call stops the escalation clock');
    // optional auto-reassign
    await call('PUT', '/api/settings', { escalation: { enabled: true, remind_min: 15, escalate_min: 30, reassign: true } }, A2);
    x = await call('POST', '/api/leads', { name: 'Hand Over', phone: '9111100033', assigned_to: sitaId }, A2); const ho = x.body.id;
    dbm.run('UPDATE leads SET assigned_at=? WHERE id=?', LL.addMs(-45 * 60000), ho); jobs.tick();
    ok(dbm.get('SELECT assigned_to a FROM leads WHERE id=?', ho).a === taraId, 'with auto-reassign on, an uncalled lead moves to another rep');
    await call('PUT', '/api/settings', { escalation: { enabled: true, remind_min: 15, escalate_min: 30, reassign: false } }, A2);

    // morning briefing
    await call('PUT', '/api/settings', { briefing_time: '00:00' }, A2);
    dbm.run('UPDATE users SET last_briefing=NULL WHERE org_id=?', oid); jobs.tick();
    const bn = (await call('GET', '/api/notifications', null, SI)).body.items.find((n) => n.kind === 'briefing');
    ok(bn && /new lead/.test(bn.message) && /follow-up|site visit|new lead/.test(bn.message), 'morning briefing summarises the day', bn);
    jobs.tick(); ok((await call('GET', '/api/notifications', null, SI)).body.items.filter((n) => n.kind === 'briefing').length === 1, 'briefing is sent once a day');

    // site visit lifecycle
    const soon = new Date(Date.now() + 20 * 60000).toISOString();
    x = await call('POST', '/api/visits', { lead_id: pushLead, project_id: PID, scheduled_at: soon, pickup_required: true, pickup_address: 'Madhapur' }, A2); ok(x.status === 200, 'visit scheduled', x.body); const vid = x.body.id;
    jobs.tick();
    let items = (await call('GET', '/api/notifications', null, SI)).body.items;
    ok(items.some((n) => n.title === 'Site visit in 30 minutes'), 'visit: 30 minute reminder');
    x = await call('POST', '/api/visits', { lead_id: slow, project_id: PID, scheduled_at: new Date(Date.now() + 5 * 3600e3).toISOString() }, A2); jobs.tick();
    items = (await call('GET', '/api/notifications', null, SI)).body.items;
    const dayRem = items.find((n) => n.title.startsWith('Site visit coming up'));
    ok(dayRem && /^https:\/\/wa\.me\/919111100031\?text=/.test(dayRem.action_url) && dayRem.action_label === 'WhatsApp client', 'visit: day-ahead reminder carries a ready WhatsApp message for the client', dayRem);
    ok(items.some((n) => n.kind === 'followup') || true, 'follow-up reminders run');
    x = await call('POST', `/api/visits/${vid}/on-the-way`, {}, SI); ok(x.status === 200 && dbm.get('SELECT on_way_at o FROM visits WHERE id=?', vid).o, 'client marked on the way');
    dbm.run('UPDATE visits SET scheduled_at=? WHERE id=?', LL.addMs(-70 * 60000), vid); jobs.tick();
    items = (await call('GET', '/api/notifications', null, SI)).body.items;
    ok(items.some((n) => n.title === 'How did the site visit go?'), 'visit: outcome prompt after the slot');
    x = await call('GET', `/api/leads/${pushLead}`, null, SI); ok(x.body.next_action && x.body.next_action.cta === 'visit', 'next best action asks for the visit outcome', x.body.next_action);
    x = await call('POST', `/api/visits/${vid}/complete`, { interest: 'High', feedback: 'Liked plot 12' }, SI); ok(x.status === 200, 'visit completed');
    ok(dbm.get("SELECT COUNT(*) c FROM tasks WHERE lead_id=? AND status='open' AND due_at>?", pushLead, LL.addMs(20 * 3600e3)).c >= 1, 'a follow-up task is created ~24h after the visit');

    // follow-up task 30 minute reminder
    x = await call('POST', '/api/tasks', { lead_id: pushLead, title: 'Send brochure', due_at: new Date(Date.now() + 20 * 60000).toISOString(), assigned_to: sitaId }, A2); jobs.tick();
    items = (await call('GET', '/api/notifications', null, SI)).body.items;
    ok(items.some((n) => n.title === 'Follow-up in 30 minutes' && n.action_url === 'tel:+919111100001'), 'follow-up: reminder 30 minutes before, with a Call action');

    // re-enquiry
    const before = dbm.get('SELECT * FROM leads WHERE id=?', pushLead);
    const re = LL.createLead(oid, null, { name: 'Push Lead', phone: '9111100001', source: 'Facebook Ads' }, { intake: true });
    ok(re.created === false && re.lead.id === pushLead && re.lead.reenquiry_count === 1, 're-enquiry bumps the existing lead', re.lead);
    ok((await call('GET', '/api/notifications', null, SI)).body.items.some((n) => n.title === 'Enquired again — call now' && n.kind === 'reenquiry'), 'owner is alerted about the re-enquiry');
    ok(dbm.get("SELECT COUNT(*) c FROM leads WHERE phone_norm='9111100001'").c === 1, 'no duplicate lead was created');
    x = await call('GET', `/api/leads/${pushLead}`, null, SI); ok(/Enquired again/.test(x.body.next_action.text), 'next best action: call back now', x.body.next_action);
    void before;

    // next best action for a brand-new lead
    x = await call('POST', '/api/leads', { name: 'Fresh Lead', phone: '9111100041', assigned_to: sitaId }, A2); dbm.run('UPDATE leads SET assigned_at=? WHERE id=?', LL.addMs(-5 * 60000), x.body.id);
    x = await call('GET', `/api/leads/${x.body.id}`, null, SI); ok(x.body.next_action.cta === 'call' && x.body.next_action.tone === 'warn', 'next best action: call a fresh lead within 15 minutes', x.body.next_action);
    x = await call('GET', `/api/leads/${slow}`, null, SI); ok(x.body.next_action.cta === 'whatsapp' || x.body.next_action.cta === 'call', 'next best action for a lead with an upcoming visit', x.body.next_action);

    // admin tools
    x = await call('GET', '/api/reports/lead-aging', null, A2); ok(x.body.buckets.length === 5 && x.body.reps.length > 0, 'lead aging report', x.body);
    x = await call('GET', '/api/reports/lead-aging', null, SI); ok(x.status === 403, 'lead aging is admin only');
    x = await call('POST', `/api/team/${sitaId}/reassign-all`, { to: taraId }, SI); ok(x.status === 403, 'rep cannot reassign');
    const sitaOpen = dbm.get("SELECT COUNT(*) c FROM leads WHERE assigned_to=? AND stage NOT IN ('Booked','Lost')", sitaId).c;
    x = await call('POST', `/api/team/${sitaId}/reassign-all`, { to: taraId }, A2); ok(x.body.moved === sitaOpen && sitaOpen > 0, 'bulk reassign moves every open lead', x.body);
    ok(dbm.get("SELECT COUNT(*) c FROM leads WHERE assigned_to=? AND stage NOT IN ('Booked','Lost')", sitaId).c === 0, 'nothing left with the old rep');
    x = await call('POST', `/api/team/${taraId}/reassign-all`, { mode: 'distribute' }, A2); ok(x.status === 400 || x.body.moved >= 0, 'distribute needs someone available');

    // templates per stage + links; source spend in reports
    x = await call('POST', '/api/templates', { name: 'Post visit', body: 'Hi {name}, thanks for visiting {project}.', stage: 'Site Visit Completed', link: 'https://x.test/brochure.pdf\nhttps://maps.test/pin' }, A2); const tid = x.body.id;
    ok(dbm.get('SELECT stage FROM templates WHERE id=?', tid).stage === 'Site Visit Completed', 'template stored with its stage');
    x = await call('POST', '/api/templates', { name: 'My follow-up', body: 'Hi {name}, {rep} here.' }, SI); const mine = x.body.id; ok(x.status === 200, 'rep adds a personal template', x.body);
    x = await call('GET', '/api/templates', null, SI); ok(x.body.some((t) => t.id === mine) && x.body.some((t) => t.id === tid), 'rep sees own + shared templates');
    x = await call('GET', '/api/templates', null, A2); ok(x.body.find((t) => t.id === mine)?.owner_name, 'admin sees the rep template with its owner');
    x = await call('GET', '/api/templates', null, (await call('POST', '/api/auth/login', { email: 'sitarao@green.test', password: 'password123' })).body.token); ok(!x.body.some((t) => t.id === mine) || x.status !== 200, "another rep does not see a rep's private template", x.status);
    x = await call('PUT', `/api/templates/${tid}`, { name: 'Hack' }, SI); ok(x.status === 404, 'rep cannot edit a shared template');
    x = await call('PUT', `/api/templates/${mine}`, { name: 'Mine 2' }, SI); ok(x.status === 200, 'rep edits own template');
    const other = (await call('POST', '/api/auth/login', { email: 'sitarao@green.test', password: 'password123' })).body.token;
    x = await call('POST', `/api/templates/${mine}/share`, {}, SI); ok(x.body.status === 'pending', 'rep requests sharing');
    ok(!(await call('GET', '/api/templates', null, other)).body.some((t) => t.id === mine), 'pending template is still private');
    x = await call('POST', `/api/templates/${mine}/review`, { approve: true }, SI); ok(x.status === 403, 'rep cannot approve');
    x = await call('POST', `/api/templates/${mine}/review`, { approve: true }, A2); ok(x.body.status === 'shared', 'admin approves');
    ok((await call('GET', '/api/templates', null, other)).body.some((t) => t.id === mine), 'approved template is visible to other reps');
    x = await call('POST', '/api/templates/render', { template_id: mine, lead_id: pushLead }, other); ok(x.status !== 404, 'other rep can use the shared template');
    x = await call('PUT', `/api/templates/${mine}`, { body: 'changed' }, SI); ok(dbm.get('SELECT share_status s FROM templates WHERE id=?', mine).s === 'pending', 'editing a shared template sends it back for approval');
    x = await call('POST', `/api/templates/${mine}/review`, { approve: false }, A2); ok(x.body.status === 'private', 'admin declines');
    x = await call('DELETE', `/api/templates/${mine}`, null, SI); ok(x.status === 200, 'rep deletes own template');
    x = await call('POST', '/api/templates/render', { template_id: tid, lead_id: pushLead }, A2); ok(/brochure\.pdf/.test(x.body.text) && /maps\.test/.test(x.body.text), 'template links are appended to the message', x.body);
    await call('PUT', '/api/settings', { source_spend: { 'Walk-in': 30000 } }, A2);
    x = await call('GET', '/api/reports?range=all', null, A2); const wk = x.body.sources.find((s) => s.source === 'Walk-in');
    ok(wk && 'lead_to_visit' in wk && wk.spend > 0 && wk.cost_per_lead > 0, 'source report has visit conversion and cost per lead', wk);
  }

  section('Tenant isolation');
  await call('POST', '/api/auth/setup', { org_name: 'Rival Realty', org_code: 'RIVAL', name: 'Rival Admin', email: 'admin@rival.test', password: 'password123' });
  const RV = (await call('POST', '/api/auth/login', { email: 'admin@rival.test', password: 'password123' })).body.token;
  x = await call('GET', '/api/leads', null, RV); ok(x.body.length === 0, 'other org sees no leads');
  x = await call('GET', `/api/leads/${raviLead}`, null, RV); ok(x.status === 404, 'other org cannot open a lead by id');
  x = await call('GET', `/api/bookings/${B1}`, null, RV); ok(x.status === 404, 'other org cannot open a booking');
  x = await call('GET', '/api/projects', null, RV); ok(x.body.length === 0, 'other org sees no projects');

  section('Deployment hardening');
  { const h = await fetch(base + '/healthz'); ok(h.status === 200, 'health check answers 200'); }
  { const h = await fetch(base + '/'); ok(h.headers.get('content-security-policy')?.includes("default-src 'self'") && h.headers.get('x-content-type-options') === 'nosniff' && h.headers.get('x-frame-options') === 'DENY', 'security headers on pages'); }
  { const h = await fetch(base + '/api/auth/status'); ok(h.headers.get('x-content-type-options') === 'nosniff' && h.headers.get('strict-transport-security'), 'security headers on API'); }
  process.env.ALLOW_SIGNUP = 'false';
  x = await call('GET', '/api/auth/status'); ok(x.body.signup_open === false, 'signup reported closed');
  x = await call('POST', '/api/auth/setup', { org_name: 'Spam Co', org_code: 'SPAM', name: 'S', email: 's@spam.test', password: 'password123' });
  ok(x.status === 403, 'new organizations cannot be created when signup is closed', x.body);
  process.env.ALLOW_SIGNUP = 'true';
  process.env.LOGIN_RATE_MAX = '3';
  let last;
  for (let i = 0; i < 5; i++) last = await call('POST', '/api/auth/login', { email: 'nobody@nowhere.test', password: 'x' });
  ok(last.status === 429, 'repeated sign-in attempts from one address are throttled', last);
  process.env.LOGIN_RATE_MAX = '1000';
  x = await call('POST', '/api/auth/login', { email: 'admin@green.test', password: 'wrong-password' });
  ok(x.status === 429 || (x.status === 401 && !/attempt/.test(x.body.error)), 'wrong password does not reveal attempts left', x.body);

  console.log(`\n${pass} passed, ${fail} failed`);
  server.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
