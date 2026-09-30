# RealtyPilot — Plot Sales CRM

A complete, self-hosted web app for a company that **sells plots / layouts**: leads → site visits → plot holds → bookings → payment plans → collections → registration, with a multi-tenant team, targets and reporting.

No database server, no build step, **zero npm dependencies**. Needs only **Node.js 22.5+** (tested on 24).

```bash
npm start                # http://localhost:3000
npm run seed             # optional: fills a demo company (DEMO) — admin@demo.test / demo12345
npm test                 # 122 end-to-end API checks on a throw-away database
```

Open the app → **Create your organization** (or use the seeded demo) → add a **project**, generate its **plots**, invite your reps.

## What's inside

| Area | What it does |
|---|---|
| **Organizations & auth** | Self-serve org setup, unique email platform-wide, 8+ char passwords, 5 wrong logins → 15-minute lock, change/forgot/reset password (other devices signed out), 72-hour single-use invite links |
| **Team & targets** | Invite/deactivate/reactivate/delete reps (open leads must be reassigned), free-plan limit of 15 active reps with usage bar, sales-value **and** bookings targets, rep health monitor (Active / Slowing / Inactive), daily/weekly/monthly activity summary with drill-down, session & attendance audit |
| **Inventory (the plot-specific part)** | Projects with RERA no., approval type, default rate, development charges, registration %, discount limit · plots with block, size in sq.yd, dimensions, facing, road width, rate, PLC % · **visual plot map**, bulk generate (A-1…A-40), CSV/Excel import, bulk price revision, plot finder by size/facing/budget · **holds** with auto-expiry |
| **Leads** | Kanban (drag & drop) + table, search, filters, saved filters, custom fields, duplicate detection (last-10-digits phone + email) with *Create anyway*, spam/fraud detection + blacklist, lost reasons, CSV/Excel import with preview & per-row source, reps "Report as duplicate", full activity timeline, lead score → Hot/Warm/Cold |
| **Assignment ("Lead router")** | Rules by source / min budget / project → round-robin, fair-workload or AI-recommended; per-rep open-lead cap; manual & bulk assign; run rules on the unassigned pool |
| **Daily work** | Follow-up tasks (green/amber/red, snooze, postponed-N-times, 10-min overdue reminders, 24h escalation), site-visit planner with pickup + feedback, call & WhatsApp log, WhatsApp templates with variables, telephony/WhatsApp **webhook** with unmatched queue, automation rules (stage → task/notify) |
| **Booking & money (the gap in the original spec)** | Booking wizard: live price (base + PLC + development + registration − discount), token, **payment plan** (down payment %, N EMIs, final % at registration — editable schedule), buyer details, partner. Payments with auto-allocation to oldest dues, **numbered printable receipts** (amount in words), voiding with reason, statements, overdue tracking & reminders, agreement → registration milestones, **cancellation with charge & refund**, blocks cash ≥ ₹2 lakh (Income-Tax §269ST) |
| **Discount control** | Per-project self-approved limit; above it a rep must raise a request, admin approves/adjusts/rejects; every decision logged |
| **Channel partners** | Brokers/referrers on leads, auto-computed commission per booking, approve → paid workflow |
| **Client portal** | Expiring link (WhatsApp-shareable): booking status, payment schedule, receipts, **KYC upload** (PDF/JPG/PNG, magic-byte checked), EMI calculator; admin verifies/rejects with remark |
| **Attendance** | GPS clock-in against an office geofence (flag or block), late detection, admin override, CSV export, **live presence** from real sign-ins + heartbeats |
| **Dashboard & reports** | Admin and rep dashboards with Today/Week/Month/All, widget on/off, funnel with drop-off, leaderboard, source ROI, project sell-through, lost reasons, 6-month trend, collections ageing, CSV exports |
| **RealPilot AI** | Real CRM actions by chat ("distribute 30 leads to Sita" — finds the real rep, asks if ambiguous, reports the *actual* number assigned, notifies them) + pipeline insights, hot leads, overdue payments, inventory, WhatsApp drafts. Optional Anthropic key (Settings → AI) adds open-ended coaching |
| **Notifications** | Addressed to a user, a role or everyone; per-user read/delete that survives refresh; polled every 30 s so reps get them on their own device |
| **Public intake** | Enquiry form (`#/enquire/<ORGCODE>`) and a lead webhook for Zapier/Make/Facebook/portal parsers — repeat enquiries never duplicate |

## Decisions I made where the original spec left questions open

| Question in the spec | Decision (easy to change) |
|---|---|
| Can reps create leads? | **Yes**, on by default; toggle in Settings. A rep's lead is assigned to them. |
| What can a rep see in reports? | Reports page is admin-only. Reps see their own dashboard, their own activity summary, and a leaderboard showing only rank / bookings / conversion of colleagues. |
| Custom-field values when a field is deleted | Hidden but **kept** in the lead record. |
| Workload cap / two rules match | Optional per-rep cap in Settings (0 = none). **First matching rule wins** (top to bottom). |
| Discount workflow | Limit per project → request → admin approve/adjust/reject → approval is single-use for that lead + plot. Admin can override with an audit-log entry. |
| "Booked" definition | Only created through a **booking** (plot + price + token + schedule). Cancelling a booking releases the plot and returns the lead to Negotiation. |
| Deleted rep | Leads, tasks, visits and plot holds move to the person you choose; history stays but shows "Former member". |
| Leads with bookings | Cannot be deleted (financial record). |

## Configuration

| Variable | Default | |
|---|---|---|
| `PORT` / `HOST` | `3000` / `0.0.0.0` | |
| `DATA_DIR` | `./data` | SQLite database + uploaded KYC files. **Back this folder up.** |
| `ANTHROPIC_API_KEY` | – | Optional; can also be set in Settings |

Docker: `docker build -t realtypilot . && docker run -p 3000:3000 -v rp-data:/data realtypilot`

### Going live checklist
1. Put it behind **HTTPS** (Caddy / nginx / Cloudflare) — sign-in tokens travel in headers.
2. Run under a process manager (systemd, pm2, Docker restart policy).
3. Schedule a nightly copy of `DATA_DIR` (e.g. `sqlite3 realtypilot.db ".backup ..."` plus the `uploads` folder).
4. Set the office location under **Settings → Attendance**, and your company name/address for receipts.
5. Point your telephony/WhatsApp provider and lead-ad forms at the URLs under **Calls & WhatsApp → Integrations**.

## Honest limitations
* **Emails/SMS are not sent.** Invite and reset links are shown to the admin to share (WhatsApp button included). Plug an email/SMS provider into `server/routes/auth.js` if you want automatic delivery.
* WhatsApp uses **click-to-chat** (opens WhatsApp with the message and logs it). Sending from the server needs the paid WhatsApp Business API and your own account.
* No online payment gateway — payments are recorded by staff (UPI/cheque/bank/etc.) with receipts.
* Social lead-ad and property-portal integrations work through the lead webhook (Zapier/Make etc.), not native connectors.
* Storage is SQLite on one server — comfortably fine for a sales team of dozens and hundreds of thousands of records; not a multi-server cluster.
* The Excel reader handles standard `.xlsx` files (first sheet). Save odd formats as CSV.
* The free-plan limit is enforced, but there is no billing/upgrade flow.
* Automated tests cover the API and business rules; the browser UI was smoke-tested (every screen and modal opens without errors) but not with a full manual QA pass on every device.

## Project layout
```
server/   db.js (schema)  lib.js (business rules)  router.js  jobs.js  routes/*.js  test.js  seed.js
public/   index.html  style.css  js/ (one module per area)
```
