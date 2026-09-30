// End-to-end API test: `npm test`. Runs against a throw-away database.
const os = require('os');
const path = require('path');
const fs = require('fs');
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
const section = (s) => console.log('\n' + s);

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
  x = await call('POST', '/api/bookings/preview', { plot_id: p1.id, discount: 0, token_amount: 100000, down_pct: 20, emi_count: 4, emi_interval_days: 30, final_pct: 10 }, R);
  ok(x.status === 200, 'booking preview', x.body);
  const total = x.body.price.total;
  ok(x.body.installments.reduce((s, i) => s + i.amount, 0) + 100000 === total, 'plan sums to total', x.body.installments);
  const maxD = x.body.price.max_discount; ok(maxD === Math.round(200 * 15000 * 0.02), 'max discount = 2% of base', maxD);
  x = await call('POST', '/api/bookings', { lead_id: raviLead, plot_id: p1.id, discount: maxD + 5000, token_amount: 100000, token_mode: 'UPI', down_pct: 20 }, R);
  ok(x.status === 400 && /approval/i.test(x.body.error), 'rep cannot exceed discount limit', x.body);
  x = await call('POST', '/api/discounts', { lead_id: raviLead, plot_id: p1.id, amount: maxD + 5000, reason: 'Repeat customer' }, R); ok(x.status === 200, 'rep requests discount'); const D1 = x.body.id;
  x = await call('POST', `/api/discounts/${D1}/decide`, { decision: 'approve' }, R); ok(x.status === 403, 'rep cannot approve');
  x = await call('POST', `/api/discounts/${D1}/decide`, { decision: 'approve' }, A); ok(x.status === 200, 'admin approves discount');
  x = await call('POST', '/api/bookings', { lead_id: raviLead, plot_id: p1.id, discount: maxD + 5000, token_amount: 250000, token_mode: 'Cash', down_pct: 20 }, R);
  ok(x.status === 400 && /269ST/.test(x.body.error), 'cash ≥ ₹2L blocked', x.body);
  x = await call('POST', '/api/bookings', { lead_id: raviLead, plot_id: p1.id, discount: maxD + 5000, token_amount: 100000, token_mode: 'UPI', token_ref: 'UTR123', down_pct: 20, emi_count: 4, emi_interval_days: 30, final_pct: 10, buyer_address: 'Hyd' }, R);
  ok(x.status === 200, 'booking created', x.body); const B1 = x.body.id; const PAY1 = x.body.payment_id;
  x = await call('POST', '/api/bookings', { lead_id: raviLead, plot_id: p1.id, token_amount: 100000, token_mode: 'UPI' }, R); ok(x.status === 400, 'booked plot cannot be booked again');
  x = await call('GET', `/api/bookings/${B1}`, null, R);
  ok(x.body.booking.total === total - (maxD + 5000), 'discount applied to total', x.body.booking.total);
  ok(x.body.summary.paid === 100000 && x.body.summary.outstanding === x.body.booking.total - 100000, 'token recorded as first payment', x.body.summary);
  x = await call('GET', `/api/leads/${raviLead}`, null, R); ok(x.body.lead.stage === 'Booked', 'lead marked Booked');
  x = await call('POST', `/api/bookings/${B1}/payments`, { amount: 10000000, mode: 'UPI', ref_no: 'X' }, R); ok(x.status === 400, 'cannot overpay');
  x = await call('POST', `/api/bookings/${B1}/payments`, { amount: 200000, mode: 'Cheque' }, R); ok(x.status === 400, 'cheque needs reference');
  x = await call('POST', `/api/bookings/${B1}/payments`, { amount: 200000, mode: 'Cheque', ref_no: '000123' }, R);
  ok(x.status === 200 && /^RCP-/.test(x.body.receipt_no), 'record payment + receipt no', x.body); const PAY2 = x.body.id;
  x = await call('GET', `/api/bookings/${B1}`, null, R);
  ok(x.body.summary.paid === 300000, 'paid total updates', x.body.summary);
  ok(x.body.installments[0].status === 'paid' && x.body.installments[1].paid_amount > 0, 'payment allocated to instalments in order', x.body.installments.slice(0, 2));
  x = await call('POST', `/api/payments/${PAY2}/void`, { reason: 'Cheque bounced' }, R); ok(x.status === 403, 'rep cannot void receipts');
  x = await call('POST', `/api/payments/${PAY2}/void`, { reason: 'Cheque bounced' }, A); ok(x.status === 200, 'admin voids receipt');
  x = await call('GET', `/api/bookings/${B1}`, null, A); ok(x.body.summary.paid === 100000, 'void reverses allocation', x.body.summary);
  const rc = await fetch(`${base}/api/payments/${PAY1}/receipt?t=${R}`); const html = await rc.text();
  ok(rc.status === 200 && html.includes('PAYMENT RECEIPT') && html.includes('One Lakh'), 'printable receipt with amount in words');
  x = await call('GET', '/api/collections', null, A); ok(x.body.rows.length > 0, 'collections list');
  x = await call('POST', `/api/bookings/${B1}/status`, { status: 'registered' }, A); ok(x.status === 400 && x.body.can_force, 'registration blocked while dues pending');

  section('Second booking, cancellation');
  x = await call('POST', '/api/leads', { name: 'Meena', phone: '9000000001', source: 'Referral', assigned_to: sitaId }, A); const L3 = x.body.id;
  x = await call('POST', '/api/bookings', { lead_id: L3, plot_id: p2.id, token_amount: 50000, token_mode: 'Bank Transfer', token_ref: 'NEFT1' }, A);
  ok(x.status === 200, 'admin books with default plan', x.body); const B2 = x.body.id;
  x = await call('POST', `/api/bookings/${B2}/cancel`, { reason: 'Customer changed mind', charge: 10000 }, A);
  ok(x.body.refund === 40000, 'cancellation refund = paid − charge', x.body);
  x = await call('GET', `/api/plots/${p2.id}/price`, null, A); ok(x.body.plot.status === 'available', 'cancelled booking releases plot', x.body.plot.status);
  x = await call('DELETE', `/api/leads/${L3}`, null, A); ok(x.status === 400, 'leads with booking history cannot be deleted');

  section('Import');
  const leadsCsv = 'Name,Mobile,Email,Source,Budget\nAnil,9111111111,,Google Ads,3000000\nAnil Dup,9111111111,,Google Ads,\nBad,123,,,\nKiran Again,9876500001,,,\n,,,,\n';
  x = await call('POST', '/api/leads/import/preview', { file_base64: Buffer.from(leadsCsv).toString('base64'), filename: 'l.csv', default_source: 'Newspaper / Hoarding' }, A);
  ok(x.body.total === 4 && x.body.valid === 1 && x.body.errors === 3, 'import preview validates rows', { t: x.body.total, v: x.body.valid, e: x.body.errors });
  const prev = x.body;
  prev.rows[0].data.source = 'Walk-in';
  x = await call('POST', '/api/leads/import/commit', { rows: prev.rows }, A);
  ok(x.body.imported === 1 && x.body.skipped.length === 3, 'import commit skips invalid & duplicate rows', x.body);
  x = await call('POST', '/api/leads/import/preview', { file_base64: 'x', filename: 'x.csv' }, R); ok(x.status === 403, 'rep cannot import');

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
  x = await call('POST', '/api/ai/chat', { message: 'distribute 5 leads to Ravi Rep' }, R); ok(/Only admins/.test(x.body.reply), 'rep cannot use AI actions');
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

  section('Tenant isolation');
  await call('POST', '/api/auth/setup', { org_name: 'Rival Realty', org_code: 'RIVAL', name: 'Rival Admin', email: 'admin@rival.test', password: 'password123' });
  const RV = (await call('POST', '/api/auth/login', { email: 'admin@rival.test', password: 'password123' })).body.token;
  x = await call('GET', '/api/leads', null, RV); ok(x.body.length === 0, 'other org sees no leads');
  x = await call('GET', `/api/leads/${raviLead}`, null, RV); ok(x.status === 404, 'other org cannot open a lead by id');
  x = await call('GET', `/api/bookings/${B1}`, null, RV); ok(x.status === 404, 'other org cannot open a booking');
  x = await call('GET', '/api/projects', null, RV); ok(x.body.length === 0, 'other org sees no projects');

  console.log(`\n${pass} passed, ${fail} failed`);
  server.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
