// SQLite (node:sqlite, built into Node >= 22.5) — schema + tiny query helpers.
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(path.join(DATA_DIR, 'uploads'), { recursive: true });
const db = new DatabaseSync(process.env.DB_PATH || path.join(DATA_DIR, 'realtypilot.db'));
db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');

db.exec(`
CREATE TABLE IF NOT EXISTS orgs (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, code TEXT NOT NULL UNIQUE COLLATE NOCASE, city TEXT,
  plan TEXT NOT NULL DEFAULT 'free', settings TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, org_id INTEGER NOT NULL REFERENCES orgs(id), name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE, phone TEXT, role TEXT NOT NULL CHECK (role IN ('admin','rep')),
  password_hash TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', specialization TEXT,
  monthly_target REAL NOT NULL DEFAULT 0, target_bookings INTEGER NOT NULL DEFAULT 0,
  failed_attempts INTEGER NOT NULL DEFAULT 0, locked_until TEXT, last_active_at TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, user_id INTEGER NOT NULL, org_id INTEGER NOT NULL,
  device TEXT, ip TEXT, created_at TEXT NOT NULL, last_seen TEXT NOT NULL, ended_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS invites (
  id INTEGER PRIMARY KEY, org_id INTEGER NOT NULL, token_hash TEXT NOT NULL UNIQUE, name TEXT, email TEXT NOT NULL,
  role TEXT NOT NULL, phone TEXT, specialization TEXT, monthly_target REAL DEFAULT 0, target_bookings INTEGER DEFAULT 0,
  expires_at TEXT NOT NULL, used_at TEXT, created_by INTEGER, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS resets (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, token_hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, used_at TEXT
);
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY, org_id INTEGER NOT NULL, name TEXT NOT NULL, location TEXT, city TEXT, developer TEXT,
  rera_no TEXT, approval TEXT, total_area_acres REAL, base_rate REAL DEFAULT 0, dev_charges_per_sqyd REAL DEFAULT 0,
  registration_pct REAL DEFAULT 0, max_discount_pct REAL DEFAULT 0, amenities TEXT, description TEXT,
  status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS plots (
  id INTEGER PRIMARY KEY, org_id INTEGER NOT NULL, project_id INTEGER NOT NULL REFERENCES projects(id),
  plot_no TEXT NOT NULL, block TEXT, area_sqyd REAL NOT NULL, length REAL, width REAL, facing TEXT,
  road_width_ft REAL, rate_per_sqyd REAL NOT NULL, plc_pct REAL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','hold','booked','sold','blocked')),
  hold_lead_id INTEGER, hold_until TEXT, hold_by INTEGER, notes TEXT, created_at TEXT NOT NULL,
  UNIQUE (project_id, plot_no)
);
CREATE INDEX IF NOT EXISTS ix_plots_project ON plots(org_id, project_id, status);
CREATE TABLE IF NOT EXISTS partners (
  id INTEGER PRIMARY KEY, org_id INTEGER NOT NULL, name TEXT NOT NULL, phone TEXT, email TEXT,
  type TEXT NOT NULL DEFAULT 'broker', commission_pct REAL NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1,
  notes TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY, org_id INTEGER NOT NULL, name TEXT NOT NULL, phone TEXT NOT NULL, phone_norm TEXT NOT NULL,
  email TEXT, source TEXT, partner_id INTEGER, stage TEXT NOT NULL DEFAULT 'New', rating TEXT NOT NULL DEFAULT 'Cold',
  score INTEGER NOT NULL DEFAULT 0, rating_manual INTEGER NOT NULL DEFAULT 0, budget_min REAL, budget_max REAL, pref_size_min REAL, pref_size_max REAL,
  pref_facing TEXT, pref_location TEXT, pref_project_id INTEGER, purpose TEXT, assigned_to INTEGER, notes TEXT,
  custom TEXT NOT NULL DEFAULT '{}', consent INTEGER NOT NULL DEFAULT 1,
  flag_status TEXT NOT NULL DEFAULT 'none', flag_reason TEXT,
  dup_reported INTEGER NOT NULL DEFAULT 0, dup_note TEXT, dup_reported_by INTEGER, dup_status TEXT,
  lost_reason TEXT, lost_note TEXT, lost_at TEXT, portal_token TEXT, portal_expires TEXT, kyc_status TEXT DEFAULT 'none',
  created_by INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_activity_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_leads_org ON leads(org_id, stage, assigned_to);
CREATE INDEX IF NOT EXISTS ix_leads_phone ON leads(org_id, phone_norm);
CREATE TABLE IF NOT EXISTS spam_numbers (org_id INTEGER NOT NULL, phone_norm TEXT NOT NULL, PRIMARY KEY (org_id, phone_norm));
CREATE TABLE IF NOT EXISTS enquiry_log (
  id INTEGER PRIMARY KEY, org_id INTEGER NOT NULL, phone_norm TEXT NOT NULL, project_id INTEGER, source TEXT, at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_enq ON enquiry_log(org_id, phone_norm, at);
CREATE TABLE IF NOT EXISTS activities (
  id INTEGER PRIMARY KEY, org_id INTEGER NOT NULL, lead_id INTEGER, user_id INTEGER, type TEXT NOT NULL,
  direction TEXT, outcome TEXT, duration INTEGER, content TEXT, meta TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_act_lead ON activities(org_id, lead_id, created_at);
CREATE INDEX IF NOT EXISTS ix_act_user ON activities(org_id, user_id, created_at);
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY, org_id INTEGER NOT NULL, lead_id INTEGER, title TEXT NOT NULL, description TEXT,
  due_at TEXT NOT NULL, priority TEXT NOT NULL DEFAULT 'Medium', assigned_to INTEGER, created_by INTEGER,
  status TEXT NOT NULL DEFAULT 'open', completed_at TEXT, postponed_count INTEGER NOT NULL DEFAULT 0,
  last_reminded_at TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_tasks ON tasks(org_id, assigned_to, status, due_at);
CREATE TABLE IF NOT EXISTS visits (
  id INTEGER PRIMARY KEY, org_id INTEGER NOT NULL, lead_id INTEGER NOT NULL, project_id INTEGER NOT NULL, plot_id INTEGER,
  scheduled_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'scheduled', pickup_required INTEGER DEFAULT 0,
  pickup_address TEXT, feedback TEXT, interest TEXT, assigned_to INTEGER, created_by INTEGER, completed_at TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS saved_filters (
  id INTEGER PRIMARY KEY, org_id INTEGER NOT NULL, user_id INTEGER NOT NULL, name TEXT NOT NULL, filters TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS custom_fields (
  id INTEGER PRIMARY KEY, org_id INTEGER NOT NULL, label TEXT NOT NULL, type TEXT NOT NULL,
  required INTEGER NOT NULL DEFAULT 0, options TEXT, position INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS assign_rules (
  id INTEGER PRIMARY KEY, org_id INTEGER NOT NULL, name TEXT NOT NULL, source TEXT, min_budget REAL, project_id INTEGER,
  strategy TEXT NOT NULL DEFAULT 'round_robin', rep_ids TEXT NOT NULL DEFAULT '[]', active INTEGER NOT NULL DEFAULT 1,
  position INTEGER NOT NULL DEFAULT 0, rr_pointer INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS automation_rules (
  id INTEGER PRIMARY KEY, org_id INTEGER NOT NULL, trigger_stage TEXT NOT NULL, create_task INTEGER NOT NULL DEFAULT 1,
  task_title TEXT, due_hours INTEGER DEFAULT 24, notify_admin INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY, org_id INTEGER NOT NULL, user_id INTEGER, role TEXT, title TEXT NOT NULL, message TEXT,
  link TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS notif_state (
  notification_id INTEGER NOT NULL, user_id INTEGER NOT NULL, read_at TEXT, deleted_at TEXT,
  PRIMARY KEY (notification_id, user_id)
);
CREATE TABLE IF NOT EXISTS templates (
  id INTEGER PRIMARY KEY, org_id INTEGER NOT NULL, name TEXT NOT NULL, body TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS webhook_events (
  id INTEGER PRIMARY KEY, org_id INTEGER NOT NULL, type TEXT, phone_norm TEXT, direction TEXT, duration INTEGER,
  outcome TEXT, content TEXT, agent_email TEXT, payload TEXT, lead_id INTEGER, matched INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS attendance (
  id INTEGER PRIMARY KEY, org_id INTEGER NOT NULL, user_id INTEGER NOT NULL, date TEXT NOT NULL, clock_in TEXT,
  clock_out TEXT, lat REAL, lng REAL, place TEXT, inside_geofence INTEGER, distance_m REAL, late INTEGER DEFAULT 0,
  override_by INTEGER, note TEXT, UNIQUE (user_id, date)
);
CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY, org_id INTEGER NOT NULL, booking_no TEXT NOT NULL, lead_id INTEGER NOT NULL, plot_id INTEGER NOT NULL,
  project_id INTEGER NOT NULL, partner_id INTEGER, sold_by INTEGER, status TEXT NOT NULL DEFAULT 'booked',
  area_sqyd REAL, rate REAL, base_amount REAL, plc_amount REAL, dev_amount REAL, reg_amount REAL, discount REAL DEFAULT 0,
  total REAL NOT NULL, token_amount REAL DEFAULT 0, booked_on TEXT NOT NULL, agreement_date TEXT, registration_date TEXT,
  cancel_reason TEXT, cancelled_at TEXT, cancellation_charge REAL DEFAULT 0, refund_amount REAL DEFAULT 0,
  buyer_name TEXT, buyer_phone TEXT, buyer_address TEXT, buyer_pan TEXT, notes TEXT, created_by INTEGER, created_at TEXT NOT NULL,
  UNIQUE (org_id, booking_no)
);
CREATE TABLE IF NOT EXISTS installments (
  id INTEGER PRIMARY KEY, org_id INTEGER NOT NULL, booking_id INTEGER NOT NULL, seq INTEGER NOT NULL, label TEXT NOT NULL,
  due_date TEXT NOT NULL, amount REAL NOT NULL, paid_amount REAL NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'pending',
  reminded_on TEXT
);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY, org_id INTEGER NOT NULL, booking_id INTEGER NOT NULL, receipt_no TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'receipt', amount REAL NOT NULL, mode TEXT, ref_no TEXT, paid_on TEXT NOT NULL,
  received_by INTEGER, note TEXT, voided INTEGER NOT NULL DEFAULT 0, void_reason TEXT, created_at TEXT NOT NULL,
  UNIQUE (org_id, receipt_no)
);
CREATE TABLE IF NOT EXISTS payment_alloc (
  payment_id INTEGER NOT NULL, installment_id INTEGER NOT NULL, amount REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS discount_requests (
  id INTEGER PRIMARY KEY, org_id INTEGER NOT NULL, lead_id INTEGER NOT NULL, plot_id INTEGER NOT NULL, amount REAL NOT NULL,
  reason TEXT, status TEXT NOT NULL DEFAULT 'pending', requested_by INTEGER, decided_by INTEGER, decided_at TEXT,
  decision_note TEXT, used INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS commissions (
  id INTEGER PRIMARY KEY, org_id INTEGER NOT NULL, booking_id INTEGER NOT NULL, partner_id INTEGER NOT NULL,
  pct REAL, amount REAL NOT NULL, status TEXT NOT NULL DEFAULT 'pending', paid_on TEXT, note TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS kyc_docs (
  id INTEGER PRIMARY KEY, org_id INTEGER NOT NULL, lead_id INTEGER NOT NULL, doc_type TEXT NOT NULL, filename TEXT,
  path TEXT NOT NULL, mime TEXT, status TEXT NOT NULL DEFAULT 'pending', remark TEXT, uploaded_at TEXT NOT NULL, reviewed_by INTEGER
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY, org_id INTEGER NOT NULL, user_id INTEGER, action TEXT NOT NULL, entity TEXT, entity_id INTEGER,
  detail TEXT, at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_messages (
  id INTEGER PRIMARY KEY, org_id INTEGER NOT NULL, user_id INTEGER NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, at TEXT NOT NULL
);
`);

// Schema changes after go-live: append a function here (never edit or reorder existing ones).
// Each runs once per database, tracked with SQLite's PRAGMA user_version. Example:
//   (d) => d.exec("ALTER TABLE leads ADD COLUMN alt_phone TEXT"),
// New tables can simply be added to the CREATE TABLE IF NOT EXISTS block above.
const MIGRATIONS = [
  // 1: phone call-log id of a call reported by the Android companion app (prevents logging the same call twice)
  (d) => d.exec("ALTER TABLE activities ADD COLUMN ext_id TEXT; CREATE UNIQUE INDEX IF NOT EXISTS ux_act_ext ON activities(org_id, user_id, ext_id) WHERE ext_id IS NOT NULL;"),
  // 2: organization logo (small data URL)
  (d) => d.exec("ALTER TABLE orgs ADD COLUMN logo TEXT"),
  // 3: phone alerts, rep availability, escalation, visit lifecycle, re-enquiries, stage templates
  (d) => d.exec(`
    ALTER TABLE users ADD COLUMN availability TEXT NOT NULL DEFAULT 'available';
    ALTER TABLE users ADD COLUMN unavailable_until TEXT;
    ALTER TABLE users ADD COLUMN work_start TEXT;
    ALTER TABLE users ADD COLUMN work_end TEXT;
    ALTER TABLE users ADD COLUMN work_days TEXT;
    ALTER TABLE users ADD COLUMN notif_prefs TEXT NOT NULL DEFAULT '{}';
    ALTER TABLE users ADD COLUMN last_briefing TEXT;
    ALTER TABLE notifications ADD COLUMN kind TEXT;
    ALTER TABLE notifications ADD COLUMN action_url TEXT;
    ALTER TABLE notifications ADD COLUMN action_label TEXT;
    ALTER TABLE leads ADD COLUMN assigned_at TEXT;
    ALTER TABLE leads ADD COLUMN esc_level INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE leads ADD COLUMN reenquiry_at TEXT;
    ALTER TABLE leads ADD COLUMN reenquiry_count INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE tasks ADD COLUMN pre_reminded TEXT;
    ALTER TABLE visits ADD COLUMN on_way_at TEXT;
    ALTER TABLE visits ADD COLUMN rem_day TEXT;
    ALTER TABLE visits ADD COLUMN rem_30 TEXT;
    ALTER TABLE visits ADD COLUMN rem_late TEXT;
    ALTER TABLE visits ADD COLUMN rem_out TEXT;
    ALTER TABLE templates ADD COLUMN stage TEXT;
    ALTER TABLE templates ADD COLUMN link TEXT;
    UPDATE leads SET assigned_at=COALESCE(created_at, updated_at) WHERE assigned_to IS NOT NULL;
  `),
  // 4: second phone number per lead, how a lead was added (manual / import / website…) and which import batch it came from
  (d) => d.exec(`
    ALTER TABLE leads ADD COLUMN alt_phone TEXT;
    ALTER TABLE leads ADD COLUMN alt_phone_norm TEXT;
    ALTER TABLE leads ADD COLUMN added_via TEXT;
    ALTER TABLE leads ADD COLUMN import_batch TEXT;
    CREATE INDEX IF NOT EXISTS ix_leads_alt ON leads(org_id, alt_phone_norm);
    UPDATE leads SET added_via=CASE WHEN created_by IS NULL THEN 'intake' ELSE 'manual' END;
  `),
  // 5: message templates a rep adds for themselves (created_by = that rep; NULL = shared by the admin with everyone)
  (d) => d.exec("ALTER TABLE templates ADD COLUMN created_by INTEGER"),
  // 6: a rep can ask for a private template to be shared with the team: private (NULL) → pending → shared (admin approves)
  (d) => d.exec("ALTER TABLE templates ADD COLUMN share_status TEXT"),
];
for (let v = db.prepare('PRAGMA user_version').get().user_version; v < MIGRATIONS.length; v++) {
  MIGRATIONS[v](db);
  db.exec(`PRAGMA user_version=${v + 1}`);
}

const norm = (a) => a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v !== null && typeof v === 'object' ? JSON.stringify(v) : v));
const cache = new Map();
function prep(sql) {
  let s = cache.get(sql);
  if (!s) { s = db.prepare(sql); cache.set(sql, s); }
  return s;
}
const all = (sql, ...a) => prep(sql).all(...norm(a));
const get = (sql, ...a) => prep(sql).get(...norm(a));
const run = (sql, ...a) => prep(sql).run(...norm(a));
let depth = 0;
function tx(fn) {
  if (depth > 0) return fn();
  db.exec('BEGIN IMMEDIATE');
  depth++;
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
  finally { depth--; }
}
/** Consistent copy of the database (safe while the app is running). Keeps the newest `keep` copies in DATA_DIR/backups. */
function backup(keep = 7) {
  const dir = path.join(DATA_DIR, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `realtypilot-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  const old = fs.readdirSync(dir).filter((f) => /^realtypilot-.*\.db$/.test(f)).sort().reverse().slice(keep);
  for (const f of old) fs.unlinkSync(path.join(dir, f));
  return file;
}
module.exports = { db, all, get, run, tx, DATA_DIR, backup };
