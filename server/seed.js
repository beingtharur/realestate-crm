// `npm run seed` — fills the database with a realistic demo company so you can explore every screen.
// Sign in afterwards with  admin@demo.test / demo12345  (reps: ravi@demo.test, sita@demo.test, imran@demo.test — same password).
const { server } = require('./index');
const { get: dbGet } = require('./db');

let base;
async function call(method, url, body, token) {
  const res = await fetch(base + '/api' + url, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status} ${json.error || ''}`);
  return json;
}
const daysAgo = (n) => new Date(Date.now() - n * 864e5 + 330 * 60000).toISOString().slice(0, 10);
const pick = (a, i) => a[i % a.length];

(async () => {
  if (dbGet('SELECT 1 x FROM orgs WHERE code=?', 'DEMO')) { console.log('Demo organization already exists — nothing to do.'); process.exit(0); }
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
  const PW = 'demo12345';
  await call('POST', '/auth/setup', { org_name: 'Green Acres Realty', org_code: 'DEMO', city: 'Hyderabad', name: 'Asha Rao', email: 'admin@demo.test', password: PW, phone: '9000000000' });
  const A = (await call('POST', '/auth/login', { email: 'admin@demo.test', password: PW })).token;
  const tokens = {};
  const reps = [['Ravi Kumar', 'ravi@demo.test', 'Investors & NRIs', 6000000], ['Sita Devi', 'sita@demo.test', 'Families', 5000000], ['Imran Khan', 'imran@demo.test', 'Walk-ins', 4000000]];
  for (const [name, email, spec, target] of reps) {
    const inv = await call('POST', '/team/invite', { name, email, role: 'rep', specialization: spec, monthly_target: target, target_bookings: 3 }, A);
    await call('POST', '/auth/accept-invite', { token: inv.link.split('/').pop(), password: PW });
    tokens[email] = (await call('POST', '/auth/login', { email, password: PW })).token;
  }
  const meta = await call('GET', '/meta', null, A);
  const id = (email) => meta.users.find((u) => u.name === reps.find((r) => r[1] === email)[0]).id;
  await call('PUT', '/settings', { company_phone: '040 4000 1234', company_address: 'Plot 12, Madhapur, Hyderabad', geofence: { name: 'Madhapur office', lat: 17.4486, lng: 78.3908, radius: 250, enforce: false } }, A);

  // projects & plots
  const p1 = (await call('POST', '/projects', { name: 'Green Valley', location: 'Shadnagar', city: 'Hyderabad', developer: 'Green Acres Realty', rera_no: 'P02400004567', approval: 'DTCP', total_area_acres: 12, base_rate: 14500, dev_charges_per_sqyd: 400, registration_pct: 7.5, max_discount_pct: 2, amenities: '40ft & 30ft roads, drainage, water, avenue plantation, park' }, A)).id;
  const p2 = (await call('POST', '/projects', { name: 'Sunrise Enclave', location: 'Kandukur', city: 'Hyderabad', developer: 'Green Acres Realty', rera_no: 'P02400007890', approval: 'HMDA', total_area_acres: 8, base_rate: 18500, dev_charges_per_sqyd: 500, registration_pct: 7.5, max_discount_pct: 1.5 }, A)).id;
  await call('POST', `/projects/${p1}/plots/bulk`, { prefix: 'A-', from: 1, to: 20, block: 'A', area_sqyd: 200, length: 30, width: 60, facing: 'East', road_width_ft: 30, rate_per_sqyd: 14500, plc_pct: 0 }, A);
  await call('POST', `/projects/${p1}/plots/bulk`, { prefix: 'B-', from: 1, to: 12, block: 'B', area_sqyd: 267, length: 33, width: 72, facing: 'North', road_width_ft: 40, rate_per_sqyd: 15500, plc_pct: 5 }, A);
  await call('POST', `/projects/${p2}/plots/bulk`, { prefix: 'S-', from: 101, to: 124, block: 'S', area_sqyd: 150, length: 27, width: 50, facing: 'West', road_width_ft: 30, rate_per_sqyd: 18500, plc_pct: 0 }, A);
  await call('POST', `/projects/${p2}/plots/bulk`, { prefix: 'C-', from: 1, to: 8, block: 'Corner', area_sqyd: 240, facing: 'North-East', road_width_ft: 40, rate_per_sqyd: 19500, plc_pct: 10 }, A);
  const plots1 = (await call('GET', `/projects/${p1}`, null, A)).plots, plots2 = (await call('GET', `/projects/${p2}`, null, A)).plots;

  // partners
  const pa = (await call('POST', '/partners', { name: 'Prime Property Consultants', type: 'channel_partner', phone: '9848012345', commission_pct: 2 }, A)).id;
  await call('POST', '/partners', { name: 'Suresh (Broker)', type: 'broker', phone: '9848098765', commission_pct: 1.5 }, A);

  // assignment rule + custom field
  await call('POST', '/assign-rules', { name: 'All leads — fair workload', strategy: 'fair_workload', rep_ids: reps.map((r) => id(r[1])) }, A);
  await call('POST', '/custom-fields', { label: 'Loan required?', type: 'dropdown', options: 'Yes, No, Maybe' }, A);
  await call('POST', '/custom-fields', { label: 'Family size', type: 'number' }, A);

  // leads
  const names = ['Anil Reddy', 'Bhavana Rao', 'Chandra Sekhar', 'Deepa Nair', 'Eshwar Prasad', 'Farah Sheikh', 'Gopal Verma', 'Harini Iyer', 'Irfan Ali', 'Jyothi Lakshmi', 'Kiran Kumar', 'Lavanya Devi', 'Mahesh Babu', 'Nandini Gupta', 'Om Prakash', 'Padma Rani', 'Qadir Basha', 'Rajesh Naidu', 'Sneha Reddy', 'Tarun Joshi', 'Uma Maheswari', 'Vijay Kumar', 'Wasim Akram', 'Yamini Sri', 'Zakir Hussain', 'Aditya Rao', 'Bindu Madhavi', 'Charan Teja', 'Divya Bharathi', 'Eswari Devi', 'Faisal Khan', 'Gayatri Menon', 'Hari Krishna', 'Indira Reddy', 'Jagadish Babu', 'Kavitha Rao', 'Lokesh Yadav', 'Meena Kumari', 'Naveen Chowdary', 'Padmaja Rao'];
  const sources = ['Facebook Ads', 'Google Ads', '99acres', 'MagicBricks', 'Website', 'Walk-in', 'Referral', 'Channel Partner', 'Housing.com'];
  const leadIds = [];
  for (let i = 0; i < names.length; i++) {
    const r = await call('POST', '/leads', { name: names[i], phone: `98${String(48000000 + i * 137).padStart(8, '0')}`, email: i % 3 ? `${names[i].split(' ')[0].toLowerCase()}@example.com` : '', source: pick(sources, i * 3 + 1), budget_max: pick([2500000, 3200000, 4000000, 5500000, 7500000], i), budget_min: pick([2000000, 2500000, 3000000], i),
      pref_size_min: pick([150, 200, 240, 267], i), pref_facing: pick(['East', 'North', 'West', ''], i), pref_project_id: i % 2 ? p1 : p2, purpose: pick(['Investment', 'Self-use / build home', 'Both'], i), partner_id: i % 9 === 7 ? pa : undefined,
      notes: i % 4 === 0 ? 'Prefers weekend site visits' : '', custom: {} }, A);
    leadIds.push(r.id);
  }
  // leave the last 4 unassigned (fresh enquiries) so the router / AI distribution has something to do
  const { run } = require('./db');
  for (const lid of leadIds.slice(-4)) run("UPDATE leads SET assigned_to=NULL WHERE id=? AND stage='New'", lid);

  // work the leads as reps
  const repToken = (lid) => { const l = dbGet('SELECT assigned_to FROM leads WHERE id=?', lid); const u = dbGet('SELECT email FROM users WHERE id=?', l.assigned_to); return u ? tokens[u.email] : null; };
  const soon = (h) => new Date(Date.now() + h * 3600e3).toISOString();
  for (let i = 0; i < leadIds.length - 4; i++) {
    const lid = leadIds[i], T = repToken(lid); if (!T) continue;
    if (i % 5 !== 4) await call('POST', `/leads/${lid}/calls`, { direction: 'outgoing', outcome: i % 4 === 3 ? 'Not Answered' : 'Connected', duration_min: 2 + (i % 6), notes: 'Discussed budget and location' }, T);
    if (i % 3 === 0) await call('POST', `/leads/${lid}/whatsapp`, { direction: 'outgoing', content: 'Sharing brochure and price list' }, T);
    if (i % 2 === 0) await call('POST', '/tasks', { lead_id: lid, title: pick(['Call back with price sheet', 'Confirm site visit', 'Share payment plan', 'Follow up on loan eligibility'], i), due_at: soon(pick([-30, -5, 3, 20, 50], i)) }, T);
    if (i % 4 === 0 && i > 0) {
      await call('POST', '/visits', { lead_id: lid, project_id: i % 8 === 0 ? p2 : p1, scheduled_at: soon(pick([-26, 20, 44], i / 4)) }, T);
      if (i % 8 === 0) { const v = (await call('GET', `/leads/${lid}`, null, T)).visits[0]; await call('POST', `/visits/${v.id}/complete`, { interest: 'High', feedback: 'Liked corner plot, wants to discuss payment plan' }, T); await call('POST', `/leads/${lid}/stage`, { stage: 'Negotiation' }, T); }
    }
    if (i === 9 || i === 21) await call('POST', `/leads/${lid}/stage`, { stage: 'Lost', lost_reason: i === 9 ? 'Budget Mismatch' : 'Bought Elsewhere' }, T);
  }
  // bookings (some in the past so instalments are due/overdue)
  const bookings = [[8, plots1[2], 45, 'Ravi'], [12, plots2[3], 20, 'Sita'], [16, plots1[5], 70, 'Imran'], [20, plots2[8], 5, 'Ravi']];
  for (const [li, plot, ago, who] of bookings) {
    const lid = leadIds[li]; const T = repToken(lid) || A;
    await call('POST', `/leads/${lid}/stage`, { stage: 'Negotiation' }, T).catch(() => {});
    const bk = await call('POST', '/bookings', { lead_id: lid, plot_id: plot.id, token_amount: 100000, token_mode: 'UPI', token_ref: 'UTR' + (1000 + li), booked_on: daysAgo(ago), down_pct: 25, emi_count: 6, emi_interval_days: 30, final_pct: 15, buyer_address: 'Hyderabad, Telangana' }, T);
    if (ago > 30) await call('POST', `/bookings/${bk.id}/payments`, { amount: Math.round(plot.price * 0.25) - 100000, mode: 'Bank Transfer', ref_no: 'NEFT' + li, paid_on: daysAgo(ago - 7) }, A);
    if (ago > 60) await call('POST', `/bookings/${bk.id}/payments`, { amount: Math.round((plot.price * 0.6) / 6), mode: 'Cheque', ref_no: '00' + li + '1', paid_on: daysAgo(ago - 37) }, A);
  }
  // holds & a discount request
  await call('POST', `/plots/${plots1[8].id}/hold`, { lead_id: leadIds[2], hours: 48 }, A);
  // an admin-recorded discount request waiting for approval (reps cannot request discounts)
  await call('POST', '/discounts', { lead_id: leadIds[4], plot_id: plots1[10].id, amount: 90000, reason: 'Customer ready to book this week if we match a competitor offer' }, A);
  // attendance for a rep
  await call('POST', '/attendance/clock-in', { lat: 17.4487, lng: 78.3909 }, tokens['ravi@demo.test']).catch(() => {});
  // a suspicious repeat enquirer
  for (let k = 0; k < 3; k++) await call('POST', '/public/enquire/DEMO', { name: 'Test Enquirer', phone: '9111122233', project_id: k % 2 ? p1 : p2, consent: true }).catch(() => {});

  console.log('\n✅ Demo data created.\n   Admin:  admin@demo.test / demo12345\n   Reps:   ravi@demo.test, sita@demo.test, imran@demo.test / demo12345\n');
  process.exit(0);
})().catch((e) => { console.error('Seed failed:', e); process.exit(1); });
