# RealtyPilot — Plot Sales CRM

Self-hosted web app for a company that **sells plots / layouts**: leads → site visits → plot holds → bookings → payment plans → collections → registration, with a multi-user team, targets and reports.

* **Stack:** Node.js 22.5+ (built-in SQLite) · plain JavaScript in the browser (not React) · no build step.
* **Libraries:** only two, both for reading uploaded files — SheetJS (`xlsx`) for Excel and `pdfjs-dist` for PDFs. Run `npm install` once after copying the project to a new machine.
* **Phone app:** `android-companion/` — optional Android helper that logs real call durations (see §9).
* **Size:** ~7,500 lines. Backend in `server/`, browser app in `public/`.
* **Multi-company:** many organizations share one install, each with its own data, logo and brand name (set when the organization is created, editable in Settings).
* **Where to read next:** §1 run it · §3 code map · §4 how to change things · §9–§12 what was added after the first version (import, phone app, roles, design, alerts).

---

## 1. Run it

Open a terminal **in this folder** (`Desktop/RealtyPilot/realtypilot`).

| I want to… | Command |
|---|---|
| First time on a new machine | `npm install` |
| Start the app | `npm start` → open <http://localhost:3000> |
| Start on another port (if 3000 is busy) | `PORT=3100 npm start` |
| Fill it with demo data (first time only) | `npm run seed` |
| Run the automated tests | `npm test` |
| Stop it | `Ctrl + C` in the terminal that is running it |
| **Wipe everything and start fresh** | stop the app, then delete the `data/` folder |

> Tip: run `npm run seed` **before** `npm start` the first time. The seed refuses to run twice (it looks for the org code `DEMO`).

**Demo logins** (created by `npm run seed`, password for all: `demo12345`)

| Role | Email |
|---|---|
| Admin | `admin@demo.test` |
| Reps | `ravi@demo.test` · `sita@demo.test` · `imran@demo.test` |

**Your own company:** on the login page click **Create your organization**. The demo company and yours can live in the same database — each only sees its own data. When you are ready for real use, delete `data/` (removes the demo) and create your organization.

---

## 2. What each screen does (quick map)

| Menu item | Who | Purpose |
|---|---|---|
| Dashboard | all | KPIs, funnel, follow-ups, rep health, collections; range = Today/Week/Month/All |
| Leads | all | Kanban/table, add, **import from Excel/CSV/PDF**, duplicate & spam review; click a lead for full history, **CALL** and other actions |
| Inventory | all (edit: admin) | Projects → plot map, holds, plot finder |
| Bookings | all | Booking wizard, payments, receipts, cancellation, registration |
| Collections | admin | Instalments due/overdue with call / WhatsApp-reminder / record-payment |
| Follow-ups | all | Tasks with snooze and colour coding |
| Site Visits | all | Schedule, complete with feedback, no-show |
| Calls & WhatsApp | all (setup: admin) | Log, templates, unmatched webhook events, integration URLs |
| Attendance / Clock-in | all | GPS clock-in; admin sees live presence, absentees, overrides, CSV |
| RealPilot AI | admin | Chat: real CRM commands + insights |
| Lead Router | admin | Auto-assignment rules |
| Team & Targets | admin | Invite, deactivate, delete, targets, profile, daily activity |
| Partners | admin | Brokers/referrers and their commission |
| Discounts | admin | Discount approvals (reps cannot see or request discounts) |
| Reports | admin | Funnel, leaderboard, sources (visit conversion, cost per lead/booking), lead aging, projects, collections aging, exports |
| Settings | admin | Everything configurable without touching code (see §5), incl. logo, **Alerts & routing** (§12) |
| Avatar menu → Notifications & availability | all | Own alert types, do-not-disturb, working hours, leave (§12) |

Public pages (no login): client portal `#/portal/<token>` and enquiry form `#/enquire/<ORGCODE>`.

---

## 3. How the code is organised

```
realtypilot/
├─ package.json            scripts: start, seed, test
├─ Dockerfile              optional container build
├─ data/                   ← created at first run. SQLite DB + uploaded KYC files. BACK THIS UP. Not in git.
├─ server/
│  ├─ index.js             HTTP server, static files, error handling, starts background jobs
│  ├─ router.js            tiny router + sign-in check (Bearer token or ?t= for downloads)
│  ├─ db.js                ★ DATABASE SCHEMA + query helpers + MIGRATIONS list
│  ├─ lib.js               ★ BUSINESS RULES: lead creation, duplicates, spam, scoring, assignment,
│  │                         stages, pricing, payment allocation, settings defaults
│  ├─ files.js             reads uploaded CSV / .xlsx / .xls / PDF into a table (lead import, plot import)
│  ├─ jobs.js              runs every minute: hold expiry, task/visit reminders, escalation, morning briefing, payment reminders, unreported calls
│  ├─ nba.js               "Next step" banner logic for a lead
│  ├─ routes/
│  │  ├─ auth.js           org setup, login/lockout, invites, reset, settings, custom fields, notifications
│  │  ├─ team.js           team, profile, daily activity, attendance, presence
│  │  ├─ inventory.js      projects, plots, holds, discount requests, partners, commissions
│  │  ├─ leads.js          leads CRUD, import (mapping → preview → commit), saved filters, spam review, public form + lead webhook
│  │  ├─ work.js           tasks, visits, call/WhatsApp log, CALL button + phone-app endpoints, event webhook, templates, rules
│  │  ├─ sales.js          bookings, payment plans, payments, receipts, KYC, client portal, collections
│  │  ├─ insights.js       dashboard, reports, exports, search, audit log, AI assistant
│  │  └─ ops.js            phone-alert feed (long-poll), notification prefs, availability, team load, hand-over, lead aging, visit "on the way"
│  ├─ test.js              248 end-to-end checks (temp database)
│  └─ seed.js              demo-data generator
└─ public/
   ├─ index.html · style.css        (colours are CSS variables at the top of style.css)
   └─ js/
      ├─ core.js           shared helpers: api(), modal(), forms, formatters, lead picker
      ├─ app.js            shell, menu (NAV list), routes table, sign-in pages, bell, search
      ├─ v_*.js            one file per area: dashboard, leads, inventory, bookings, work, team, admin, public
      └─ v_prefs.js        notifications & availability dialog, hand-over, Settings → Alerts & routing
```

**How a request flows:** browser screen (`public/js/v_*.js`) → `fetch('/api/...')` → route in `server/routes/*.js` → rules in `server/lib.js` → SQLite (`server/db.js`).

---

## 4. Making changes — recipes

Always: stop the app → edit → `npm test` → start the app → check the screen in the browser (refresh; static files are served with no cache).

### 4.1 Change a list of options (no database change)
| Change | Where |
|---|---|
| Lead stages | `STAGES` in `server/lib.js` (also see the score points table in `rescore()`) |
| Lost reasons | `LOST_REASONS` in `server/lib.js` |
| Lead sources | `SOURCES` in `server/lib.js` |
| Call statuses | `CALL_OUTCOMES` in `server/lib.js`; display names (`Connected` → "Completed") in `CALL_LABEL` in `public/js/core.js` |
| Import: header names recognised automatically | `ALIASES` in `server/routes/leads.js` |
| Payment modes | `PAY_MODES` in `server/routes/sales.js` (and `MODES` in `public/js/v_bookings.js`) |
| KYC document types | `KYC_TYPES` / `KYC_REQUIRED` in `server/routes/sales.js` |
| Plot facings | `FACINGS` in `server/routes/inventory.js` (and `public/js/v_inventory.js`, `v_leads.js`) |
| Layout approval types | `APPROVALS` in `public/js/v_inventory.js` |
| Menu items / order | `NAV` in `public/js/app.js` (admin-only = `admin: true`) |

### 4.2 Change a business rule
| Rule | Where |
|---|---|
| **Price formula** (base + PLC + development + registration − discount) | `priceFor()` in `server/lib.js` |
| **Payment-plan generator** (down %, EMIs, final %) | `buildPlan()` in `server/routes/sales.js` |
| Cash limit (₹2 lakh) | `CASH_LIMIT` in `server/routes/sales.js` |
| **Lead score / Hot-Warm-Cold** | `rescore()` in `server/lib.js` (Hot ≥ 60, Warm ≥ 35) |
| Rep health thresholds (24 h / 48 h) | `repHealth()` in `server/lib.js` |
| Spam rule (3 submissions or 3 projects in 24 h) | `checkFlags()` in `server/lib.js` |
| Assignment strategies | `pickRep()` in `server/lib.js` |
| Free-plan rep limit (15) | `FREE_PLAN_REPS` in `server/routes/team.js` |
| Login lockout (5 tries / 15 min) | `server/routes/auth.js` (`/api/auth/login`) |
| Invite validity (72 h) | `server/routes/team.js` (`/api/team/invite`) |
| Overdue-reminder interval (10 min) and escalation (24 h) | `server/jobs.js` |
| Unreported call becomes "Failed" (2 h) | `server/jobs.js` |
| How a phone call is matched to a lead (15-minute window after CALL, then by number) | `POST /api/device/calls` in `server/routes/work.js` |
| Import value clean-up ("35 L" → 3500000, first of two phone numbers…) | `pickPhone()`, `moneyRange()`, `sizeRange()` in `server/routes/leads.js` |
| PDF table reading | `pdfTable()` in `server/files.js` |
| Commission base (base + PLC − discount) | `server/routes/sales.js` (booking creation) |
| Rep permissions | each route file: `{ admin: true }` = admin only; otherwise rep sees only own records (`leadFor()`, `bookingFor()`, `scope()`) |

### 4.3 Add a field to leads (example: "Alternate phone")
1. **Database** — append a migration in `server/db.js`:
   ```js
   const MIGRATIONS = [
     (d) => d.exec("ALTER TABLE leads ADD COLUMN alt_phone TEXT"),
   ];
   ```
   (Migrations run once per database, in order. **Never edit or reorder old ones.** For a brand-new table, just add a `CREATE TABLE IF NOT EXISTS` to the schema block.)
2. **Save it** — `createLead()` in `server/lib.js` (the `INSERT`) and the `UPDATE` in `PATCH /api/leads/:id` (`server/routes/leads.js`).
3. **Show/edit it** — form in `leadForm()` and the "Requirements" card in `detail()` in `public/js/v_leads.js`.

*No-code alternative:* **Settings → Custom fields** adds text/number/date/dropdown/checkbox fields without any code. Use code only for fields that drive logic or reports.

### 4.4 Add a new API endpoint
In the relevant `server/routes/*.js`:
```js
r.get('/api/things', (ctx) => all('SELECT * FROM things WHERE org_id=?', ctx.oid));   // any signed-in user
r.post('/api/things', { admin: true }, (ctx) => { /* ctx.body, ctx.user, ctx.isAdmin */ return { ok: true }; });
```
Rules: **always filter by `org_id = ctx.oid`**; check ownership for reps; throw `bad('message')` / `notFound()` / `forbidden()` for errors; log sensitive actions with `L.audit(...)`.

### 4.5 Add a new screen
1. Create `export async function myScreen(root, params, query) { … }` in a `public/js/v_*.js` file.
2. Register it in the `ROUTES` table in `public/js/app.js` (`['/things', mod.myScreen, { admin: true }]`) and, if it should be in the menu, in `NAV`.
3. **Gotcha:** `root` is a fresh element per page visit, but inside a screen that re-draws itself (`root.innerHTML = …`) register delegated listeners (`on(root, 'click', '[data-x]', fn)`) **once, outside the draw function** — otherwise every redraw stacks another listener. Direct handlers on elements you just created (`$('#btn').onclick = …`) are fine.
4. Use helpers from `core.js`: `modalForm()`, `confirmDialog()`, `toast()`, `fld()/inp()/sel()`, `inr()` (₹ formatting), `fmtDate()`.

### 4.6 Add a setting that admins can change
1. Default in `DEFAULT_SETTINGS()` (`server/lib.js`).
2. Allow it in `PUT /api/settings` (`server/routes/auth.js`).
3. Add a control on the matching tab in `settings()` (`public/js/v_admin.js`).
4. Read it with `L.getSettings(oid).your_key` (server) or `S.settings.your_key` (browser; non-admin users only receive `widgets`, `reps_can_create_leads`, `hold_hours_default` — add more in `/api/auth/me` if reps need it).

### 4.7 Change the look
Colours, radius and dark-mode colours are variables at the top of `public/style.css` (`--brand`, `--accent`, …). The name and logo emoji are in `public/index.html` (title), `NAV` shell in `app.js` (`🏡 RealtyPilot`) and the sign-in pages.

### 4.8 Conventions worth keeping
* **Money** is stored as whole rupees (numbers, no paise). **Dates** for bookings/payments are `YYYY-MM-DD` in **India time (IST)**; timestamps are UTC ISO strings and shown in IST.
* **Phones** are stored as 10 digits (`phone_norm`); use `normPhone()` for anything typed by a user.
* **Every table row carries `org_id`** — that is what keeps companies separate. Never query without it.
* Deleting people/records: prefer keeping history. Leads with bookings cannot be deleted.
* Add a test in `server/test.js` for every new rule (copy the style of the nearby checks).

---

## 5. Preferences — where each choice lives

### 5.1 Adjustable in the app (Settings menu, admin only)
| Preference | Settings tab |
|---|---|
| Company name, city, phone, address (printed on receipts), client-portal link validity | Organization |
| Auto-assign on/off · reps can add leads · max open leads per rep · default plot-hold hours · overdue reminders | Leads & assignment |
| Extra lead fields | Custom fields |
| "When lead reaches stage X → create task / notify admin" | Automation |
| Which dashboard widgets show | Dashboard |
| Shift start time, office location, radius, block-or-flag outside geofence | Attendance |
| Anthropic API key, AI tone/instructions | AI assistant |
| Who did what (read-only) | Audit log |
| Per-project: default rate, development charges, registration %, **max discount reps can give** | Inventory → Edit project |
| Per-rep monthly targets | Team & Targets → profile → Edit |
| Assignment rules | Lead Router |

### 5.2 Decisions taken (change in code — see §4.2)
| Topic | Current decision |
|---|---|
| Reps creating leads | Allowed (toggle). Rep-created leads belong to that rep |
| Reports access | Admin only; reps see own dashboard + rank-only leaderboard |
| Deleted custom field | Values kept, hidden |
| Two matching assignment rules | First (top-to-bottom) wins |
| Discounts | Per-project self-approved %; above needs admin approval; approval usable once per lead + plot; admin override is audit-logged |
| "Booked" | Only via a booking; cancelling returns the lead to Negotiation and frees the plot |
| Deleting a rep | Leads/tasks/visits/holds move to a chosen person; history shows "Former member" |
| Cash payments | ≥ ₹2,00,000 blocked (Income Tax §269ST) |
| Password reset | Admin generates a link (no email is sent) |
| Attendance outside geofence | Allowed but flagged (switchable to block) |

### 5.3 Your notes & future wishes
Keep the running list here so it survives across sessions.

| Date | Preference / idea | Status |
|---|---|---|
| | *(example)* Send receipts by email automatically | idea |
| | *(example)* Hindi / Telugu labels | idea |
| | | |

**Ideas not built yet** (good next steps): e-mail/SMS delivery for invites, receipts and reminders · WhatsApp Business API sending · online payment links (Razorpay / UPI collect) · sale-agreement PDF generator · loan-bank tracking per booking · plot-layout image upload with clickable hotspots · Telugu/Hindi UI · mobile app (PWA install) · billing & plans · per-project teams.

---

## 6. Go-live, backup, restore, upgrade

**Configuration (environment variables):** `PORT` (3000) · `HOST` (0.0.0.0) · `DATA_DIR` (`./data`) · `ANTHROPIC_API_KEY` (optional).

**Checklist**
1. Run on a server (VPS or office PC) with Node 22.5+; keep it running with `pm2`, `systemd`, or Docker (`docker build -t realtypilot . && docker run -d -p 3000:3000 -v rp-data:/data --restart unless-stopped realtypilot`).
2. Put **HTTPS** in front (Caddy, nginx or Cloudflare Tunnel). Do not expose plain HTTP to the internet.
3. Create your organization, set office location, company details, then add projects/plots and invite reps.
4. Point telephony/WhatsApp/lead-ad tools at the URLs under **Calls & WhatsApp → Integrations**.

**Hosting note (Vercel and similar):** RealtyPilot is one long-running Node server with a SQLite file and a held-open alerts connection. Serverless hosts such as Vercel have no persistent disk and stop functions after seconds, so data would vanish and phone alerts would not work. Use a small VPS, Railway/Render/Fly with a persistent volume (mount it at `DATA_DIR`), or the Dockerfile. Vercel can only host a static front-end, which this app is not.

**Backup** (do nightly): copy the whole `DATA_DIR`. For a consistent copy while running:
```bash
sqlite3 data/realtypilot.db ".backup 'backup/realtypilot-$(date +%F).db'" && cp -R data/uploads backup/
```
**Restore:** stop the app, put the `.db` file back as `data/realtypilot.db` (delete any `-wal` / `-shm` files next to it) and the `uploads` folder, start again.

**Upgrade the code:** back up first → replace `server/` and `public/` → start. New migrations apply automatically.

---

## 7. Troubleshooting

| Symptom | Fix |
|---|---|
| `EADDRINUSE … port 3000` | Something else uses the port → `PORT=3100 npm start` |
| `Cannot find module 'node:sqlite'` | Node is too old → install Node 22.5+ (`node -v`) |
| Page looks blank / old | Hard-refresh (Cmd+Shift+R). Check the browser console (F12) for red errors |
| "Please sign in" keeps appearing | Session expired or user deactivated/deleted → sign in again |
| Locked out after wrong passwords | Wait 15 minutes, or another admin can generate a reset link (Team → 🔑) |
| Only admin locked out | Stop the app and run: `sqlite3 data/realtypilot.db "UPDATE users SET locked_until=NULL, failed_attempts=0 WHERE email='you@example.com'"` |
| Clock-in says location denied | Allow location for the site in the browser; GPS needs HTTPS or `localhost` |
| Webhook returns 401 | Wrong org code or secret → copy the URL again from Integrations |
| Seed says demo exists | Delete `data/` to start over |
| Tests fail after my change | Read the ✗ line — it names the rule that broke; tests use a temp database, never your real data |

---

## 8. Known limits
* No e-mail/SMS sending — invite & reset links are shown to the admin to share.
* PDF import reads text-based PDFs only (no OCR for scans). Unusual layouts can misalign columns — always check the preview.
* Real call durations need the Android companion app; it compiles but has not been tested on a real phone yet (see §9). iPhone cannot do this at all.
* WhatsApp uses click-to-chat (opens WhatsApp with the text and logs it).
* No online payment gateway; staff record payments and print receipts.
* One server with SQLite — ideal for a sales team of dozens; not a multi-server cluster.
* Excel import reads the first sheet that has data.
* Free-plan limit is enforced; there is no billing screen.
* Automated tests (248) cover the API and business rules, including Excel/PDF import and the phone-app call sync; the screens were smoke-tested in a browser, not fully QA'd on every device.

---

## 9. Lead import and call tracking (added 3 Oct 2026)

### 9.1 Bulk lead import
**Leads → Import** accepts `.xlsx`, `.xls`, `.csv` and text-based `.pdf`.

1. Upload → the server reads the file (`server/files.js`) and guesses which column is which (`ALIASES`).
2. **Column mapping** — shown open if headers were not recognised; otherwise collapsed and editable. Changing it re-checks the file without uploading again (parsed uploads are kept in memory for 30 minutes).
3. **Preview** with five numbers — Total, Valid, Duplicates, Invalid, Will be imported — and tabs for each group. Every skipped row says why.
4. **Import** inserts only valid, non-duplicate rows; each row is re-checked at insert time.

* Duplicate = same phone (last 10 digits) or same email, either earlier in the file or already in the CRM (same rule as manual entry: `findDuplicates()`).
* **Any format is accepted.** Excel/CSV/TSV/text (comma, semicolon, tab or pipe separated; UTF-8, UTF-16 or Windows encodings), with or without a header row, title rows above the header, columns in any order, one or several sheets (sheets with the same header are stacked). Columns are recognised first by exact header names, then by similar wording (`Mob. No.`, `Client Details`, `Enquiry From`…), then by what the cells contain (a column full of mobile numbers is the phone column).
* **Only a phone number is required.** Empty cells and placeholders (`N/A`, `NULL`, `none`, `-`, `?`) are treated as blank. A row with no name is imported as e.g. `Lead 5566` (or named from its email) with a note in the preview; a phone found in the "wrong" column is picked up; an invalid email is dropped with a warning instead of rejecting the row. Rows with no mobile number anywhere are marked Invalid and skipped (the CRM identifies and de-duplicates leads by phone).
* Columns that cannot be mapped are appended to the lead's notes (`Header: value`) so nothing in the file is lost — switchable in the mapping box.
* Clean-up applied: phone normalised (takes the first valid mobile from cells like `98765 43210 / 98450 12345`), email lower-cased, budgets such as `35 L`, `1.2 Cr`, `30-40 lakhs` converted to rupees, source and facing matched to the standard lists, project and rep matched by name.
* PDFs: a table with a header row is read column by column; a PDF with no header is read as one lead per line that contains a mobile number. Title rows above the header are skipped in all formats.

### 9.2 Call from the CRM with the rep's normal phone
The **CALL** button still opens the phone dialer (`tel:` link). What is new is what happens afterwards:

| Rep's setup | What happens after tapping CALL |
|---|---|
| Android phone with the **companion app** linked | A "Waiting for phone…" entry appears on the lead. When the call ends the app reports it and the entry becomes e.g. **Outgoing call · Completed · Duration: 04:32**. Nothing to type. |
| iPhone, desktop, or no app | A bar appears: "Called X? Log how it went." → the existing Log call form. |

* Calls are stored where they always were — the `activities` table (`type = 'call'`). `created_at` is the call start, `duration` is seconds, `direction` is outgoing/incoming, `outcome` is the status, `meta` holds `ended_at`, `phone` and `source` (`manual` / `device` / `webhook`). The only schema change is one column, `activities.ext_id` (the phone's call-log id, so a call is never stored twice).
* Statuses: Completed (`Connected`), No Answer (`Not Answered`), Rejected, Failed, plus the older Busy / Switched Off / Wrong Number / Voicemail / Missed for manual logs.
* One function writes every call: `recordCall()` in `server/lib.js` (manual log, telephony webhook and phone app all use it).
* A phone is "linked" when the rep has signed in from the companion app in the last 30 days (visible in **My profile** and in the rep's session list under Team).
* Build and install instructions, Android limits and the three API calls the app uses are in `android-companion/README.md`.

---

## 10. Roles — what a Representative can and cannot do (changed 3 Oct 2026)

The Representative ("rep") experience is a purpose-built, phone-first sales workspace. These are enforced **on the server** (`{ admin: true }` on the route, or the data is removed from the response for reps) and the matching UI is not rendered — it is not just hidden.

| Area | Admin | Representative |
|---|---|---|
| Menu | everything | Dashboard · Leads · Inventory · Bookings · Follow-ups · Site Visits · Calls & WhatsApp · Clock-in |
| **Collections** (page, dues, overdue, reminders, "Collected"/"Overdue payments" dashboard cards, recording payments, payment statement, payment schedule and receipts list on a booking, payment-due notifications) | yes | **none** — routes return 403, data is not sent |
| **RealPilot AI** (menu, dashboard "Pipeline Insights" button, "Ask RealPilot" on a lead, chat/history API) | yes | **none** |
| **Discounts** (approvals page, request button, discount field in the booking form, discount limits in project/plot data, discount notifications) | yes | **none** — a rep's booking is always at the listed price; the API refuses any discount from a rep |
| Call & WhatsApp | yes | **one tap** from every lead card/row, follow-up, site-visit row, the dashboard hot-prospects list, the booking page, and a fixed Call · WhatsApp · Log call · Follow-up bar on the lead page (phones) |
| Bookings | full (money, schedule, commission) | create a booking (token + payment plan at the listed price), see the sale, plot, price, buyer and KYC — no money-collected, dues, discount or commission data |
| Everything else (leads, tasks, visits, attendance, inventory browsing) | yes | unchanged — own leads only |

Direct URLs: a rep who types `#/collections`, `#/discounts`, `#/ai`, `#/reports`, `#/team`, `#/settings` … is sent back to the dashboard with a notice. Calling the APIs directly returns 403.

Where it is implemented: server — `server/routes/sales.js` (`salesView()`, payments/collections/statement routes), `inventory.js` (discount routes, `repProject()`), `insights.js` (dashboard fields, AI routes), `leads.js` (lead page), `auth.js` (`ADMIN_ONLY_NOTICES`), `jobs.js`; browser — `NAV`/`ROUTES` in `public/js/app.js`, and `isAdmin()` branches in the `v_*.js` files.

### Phone-first layout
* Under 900 px wide a rep gets a bottom tab bar (Home · Leads · Follow-ups · Visits · More) and the full menu in a drawer; dialogs fill the screen with the action buttons pinned at the bottom; inputs are 16 px (no iOS zoom) and buttons ≥ 44 px.
* Under 700 px every table becomes a stack of cards (`labelTables()` in `public/js/core.js` reads the column headers) — no sideways scrolling. Rep lead cards show name, phone, Call and WhatsApp buttons, stage, rating and next follow-up; secondary columns are hidden.
* Leads open as cards on phones and as a swipeable board (one column at a time) if the rep switches to Kanban.
* To check a layout: run the app, sign in as `ravi@demo.test`, and use the browser's device mode at 375, 768 and 1280 px.

---

## 11. Design system & UX (redesign, 4 Oct 2026)

One stylesheet (`public/style.css`) and one component module (`public/js/core.js`) define how the whole product looks. Screens do not invent their own styles — change a token and every screen follows.

### Tokens (top of `style.css`)
| What | Where | Notes |
|---|---|---|
| Brand colour | `--brand`, `--brand-hover`, `--brand-soft` | Change these three to re-brand. Dark-mode values are in the `[data-theme=dark]` block |
| Status colours | `--slate / --blue / --violet / --amber / --green / --red` (+ `-bg`) | The only colours used for status anywhere |
| Type | `--fs-xs … --fs-2xl`, font stack `Inter, system-ui…` | Uses Inter if installed, otherwise the system font — no web-font download |
| Spacing / radius / shadow | `--s1…--s8` (4px steps), `--r-sm/md/lg/xl`, `--sh-1/2/3` | |
| Control size | `--h-ctl` 36px (44px under 900px wide for touch), `--h-ctl-sm` 30px | Every button, input and select uses it |

### One vocabulary for status (`STATUS` in `core.js`)
Lead stages, plot status, booking status, KYC, visits, commissions, discounts and rep health each map a value to one of the six colours. Use `statusChip('stage', 'Hot')`, `stageBadge()`, `ratingBadge()` or `badge(text, 'b-green dotted')`. Chips always carry a dot or icon **and** text, never colour alone. To add a status, add it to `STATUS` — nothing else.

### Components (all in `core.js`)
`ico(name)` icon set (one stroke weight; any leftover emoji in templates is auto-swapped by `iconize()`) · `modal()` / `modalForm()` (focus trap, Esc, inline validation) · `drawer()` (side panel on desktop, bottom sheet on phones) · `openMenu()` (action menu / bottom sheet) · `toast()` / `snack()` · `confirmDialog()` · `empty()` / `errorState()` / `skeleton()` · `quickActions()` (Call + WhatsApp) · `statusChip()` · `avatar()`.
* **Forms:** mark a field `required` or give it `data-v="phone"` / `"email"` — it is validated on blur and on submit with an inline message.
* **Long dropdowns:** any `<select>` with 8+ options automatically becomes a type-to-search list with recent choices, keyboard navigation and a clear (×) button. Opt out with `data-native`.

### Patterns
* **Dashboard** opens with *what needs attention* (overdue / due-today follow-ups, new leads to contact, hot leads going cold, visits today; admins also see unassigned leads, overdue payments, discount approvals). Each tile opens the exact filtered list. Below: a one-line KPI strip, then today's work, then pipeline and activity.
* **Leads:** search, one *Filters* panel (quick views, status, priority, follow-up, source, project, owner, dates, saved views), removable filter chips, sort menu, three layouts (List with sortable sticky header and chooseable columns · collapsible Cards · Board with drag-and-drop), progressive "Show more", and a bulk bar (assign, change status, schedule follow-up, export, delete).
* **Click a lead → drawer** with contact, status, last contacted, next follow-up, owner, requirements, open follow-ups and recent activity — without losing your place in the list. "Open full details" goes to the lead page (context strip, activity timeline grouped by day, follow-ups, visits, bookings, documents).
* **Search (`/` or Ctrl/Cmd-K):** leads (name, phone, email, notes), bookings, projects, plots, activities and pages in one palette, plus quick actions and recently viewed leads.
* **Navigation:** grouped sidebar (Workspace · Activity · Finance · Team · Insights) with Leads → All / New / Follow-ups; collapse to icons (remembered). Under 900px it becomes a drawer plus a bottom tab bar.

### Remembered per browser (localStorage)
Theme (Auto / Light / Dark) and density (Comfortable / Compact) from the avatar menu · sidebar collapsed state and open groups · leads layout, sort and visible columns · last project used when adding a lead · recently viewed leads.

### Breakpoints
≥1700 large desktop (content centred, max 1360px) · 1101–1700 desktop · 901–1100 laptop / large tablet (sidebar auto-collapses to icons) · ≤900 tablet & phone (drawer navigation, bottom tab bar, full-screen dialogs, bottom-sheet drawers/menus, 44px touch targets) · ≤700 tables become cards · ≤480 compact phone grid.

### Accessibility
Visible keyboard focus everywhere, labelled icon buttons with tooltips, `aria-live` toasts, dialogs with focus trap and Esc, form errors announced inline, status never by colour alone, `prefers-reduced-motion` respected, system dark mode honoured.

### Checking a UI change
Run the app (`npm start`) with demo data (`npm run seed`), then look at it at 375 px (phone), 768 px, 1280 px and 1920 px, as both `admin@demo.test` and `ravi@demo.test`. `npm test` covers the API behind the screens.


## 12. Phone alerts, escalation, availability and visit lifecycle

**How alerts reach the phone.** Every in-app notification (`notifications` table) has a `kind` (lead, followup, visit, escalation,
reenquiry, briefing, payment, other) and an optional `action_url` (a `tel:` or `wa.me` link shown as a button on the phone notification).
The companion app holds `GET /api/device/alerts?after=<id>&wait=25` open (long-poll, no Google services) and shows what arrives within
a second or two. Per user, the server filters switched-off kinds and marks alerts `silent` inside the do-not-disturb window.
The 15-minute sync also polls once as a safety net. `server/routes/ops.js`, `android-companion/.../AlertService.kt`.

**Background jobs** (`server/jobs.js`, every minute): follow-up reminder 30 min before due; visit reminders (day ahead with a ready
WhatsApp message for the client, 30 min before, client late, "how did it go" after); uncalled-new-lead escalation (rep at
`escalation.remind_min`, admin at `escalate_min`, optional auto-reassign, clock runs only in the rep's working hours); morning briefing
(`briefing_time`, per-user override); leave auto-expiry; instalment reminders carry a WhatsApp-the-buyer button.

**Availability.** `users.availability` = available / off_duty / on_leave (+ `unavailable_until`), working hours/days per user or org default
(`shift_start`, `shift_end`, `work_days`). `lib.isRoutable` / `isOnShift` decide who auto-routing may pick; if nobody can take a lead the
admin is told. Rep edits their own under avatar → *Notifications & availability*; admin from the Team page (*Availability*, *Hand over*).

**Other.** Re-enquiry on an existing lead (`createLead` with `intake`) bumps it, reopens it if Lost, creates a call-back task and alerts the
owner. `server/nba.js` computes the "Next step" banner on the lead page. `GET /api/team/loads` feeds the workload shown when assigning.
Templates have an optional `stage` and `link` lines. Reports: lead→visit→booking by source, cost per lead/booking from
`settings.source_spend` (monthly ₹ per source), and `GET /api/reports/lead-aging`.


---

## 13. Version history (newest first)

| Date | What changed |
|---|---|
| 4 Oct 2026 | Phone alerts (Companion v1.1), escalation, morning briefing, availability & leave, visit lifecycle, re-enquiry bump, "Next step" banner, one-tap call results, stage templates with links, source conversion + spend, lead aging, hand-over, organization logo, leads table column order (Contact → Budget → Source), calls log redesign, top bar simplified |
| 4 Oct 2026 | Premium UI/UX redesign (§11), password eye toggle, invited reps cannot create organizations |
| 3 Oct 2026 | Representative role clean-up (§10), bulk import from any file (§9.1), call tracking via Android app (§9.2) |
| 3 Oct 2026 | First complete version: leads → visits → bookings → payments → reports |

---

## 14. Repository layout

```
realestate-crm/
├─ server/ · public/ · package.json · Dockerfile      the CRM (this README)
├─ android-companion/                                  Android app source (own README: build, install, how alerts + sync work)
└─ RealtyPilot-Companion-debug.apk                     ready-built debug APK of the Android app (v1.1)
```
Rebuild the APK after changing the app (see `android-companion/README.md`), then copy `app/build/outputs/apk/debug/app-debug.apk` over the file above.
