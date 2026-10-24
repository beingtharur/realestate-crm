// Shared state + design-system components used by every screen.
// Sections: state · api · formatting · icons · status vocabulary · feedback (toast/modal/drawer/menu) · forms (validation, searchable select) · loading/empty/error · call helpers
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
};
export { store };
export const S = { token: store.get('rp_token') || '', user: null, org: null, settings: {}, meta: null };
export const isAdmin = () => S.user && S.user.role === 'admin';
export const $ = (sel, el = document) => el.querySelector(sel);
export const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const debounce = (fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

// ---------- appearance preferences (remembered per browser) ----------
export const getTheme = () => store.get('rp_theme') || 'system';
export function applyTheme() { const t = store.get('rp_theme'); t ? document.documentElement.setAttribute('data-theme', t) : document.documentElement.removeAttribute('data-theme'); }
export function setTheme(t) { store.set('rp_theme', t === 'system' ? null : t); applyTheme(); }
export const getDensity = () => store.get('rp_density') || 'comfortable';
export function applyDensity() { document.body.classList.toggle('compact', getDensity() === 'compact'); }
export function setDensity(d) { store.set('rp_density', d); applyDensity(); }
applyTheme();

// ---------- API ----------
const FRIENDLY = { 401: 'Please sign in again.', 403: "You don't have permission to do that.", 404: "We couldn't find that.", 413: 'That file is too large.', 429: 'Too many attempts. Please wait a moment.' };
export async function api(method, path, body) {
  let res;
  try {
    res = await fetch('/api' + path, {
      method, headers: { 'content-type': 'application/json', ...(S.token ? { authorization: 'Bearer ' + S.token } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch { const e = new Error("Can't reach the server. Check your internet connection and try again."); e.status = 0; e.network = true; throw e; }
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json().catch(() => ({})) : await res.text();
  if (!res.ok) {
    if (res.status === 401 && S.token) { S.token = ''; store.set('rp_token', null); try { window.RPNative?.signedOut(); } catch { /* not in the app */ } location.hash = '#/login'; location.reload(); }
    const msg = res.status >= 500 ? 'Something went wrong on our side. Please try again in a moment.' : (data && data.error) || FRIENDLY[res.status] || 'That did not work. Please try again.';
    const e = new Error(msg); e.status = res.status; e.data = data; throw e;
  }
  return data;
}
export const get = (p) => api('GET', p);
export const post = (p, b = {}) => api('POST', p, b);
export const put = (p, b = {}) => api('PUT', p, b);
export const patch = (p, b = {}) => api('PATCH', p, b);
export const del = (p) => api('DELETE', p);
export const authUrl = (path) => `/api${path}${path.includes('?') ? '&' : '?'}t=${S.token}`; // for GET downloads / printable pages
export async function loadMeta() { S.meta = await get('/meta'); return S.meta; }
export const userName = (id) => (S.meta?.users.find((u) => u.id === id)?.name) || (id ? 'Former member' : '—');
export const activeReps = () => (S.meta?.users || []).filter((u) => u.status === 'active');

// ---------- formatting ----------
export const inr = (n) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
export function inrShort(n) {
  n = Number(n) || 0;
  if (n >= 1e7) return '₹' + (n / 1e7).toFixed(2).replace(/\.?0+$/, '') + ' Cr';
  if (n >= 1e5) return '₹' + (n / 1e5).toFixed(2).replace(/\.?0+$/, '') + ' L';
  return inr(n);
}
const D = (iso) => (iso ? new Date(iso) : null);
export const fmtDate = (iso) => (iso ? D(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso + 'T00:00:00+05:30' : iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '—');
export const fmtTime = (iso) => (iso ? D(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '—');
export const fmtDT = (iso) => (iso ? `${fmtDate(iso)}, ${fmtTime(iso)}` : '—');
export function rel(iso) {
  if (!iso) return '—';
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 0) { const f = -s; return f < 3600 ? `in ${Math.max(1, Math.round(f / 60))}m` : f < 86400 ? `in ${Math.round(f / 3600)}h` : `in ${Math.round(f / 86400)}d`; }
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  if (s < 86400 * 30) return Math.floor(s / 86400) + 'd ago';
  return fmtDate(iso);
}
/** "Today, 11:30 AM" · "Tomorrow, 4:00 PM" · "Yesterday, 2:10 PM" · "12 Oct 2026, 9:00 AM" */
export function friendlyDT(iso) {
  if (!iso) return '—';
  const day = (d) => new Date(d.getTime() + 330 * 60000).toISOString().slice(0, 10);
  const d = day(new Date(iso)), t = day(new Date()), diff = Math.round((Date.parse(d) - Date.parse(t)) / 864e5);
  const lab = diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : diff === -1 ? 'Yesterday' : fmtDate(iso);
  return `${lab}, ${fmtTime(iso)}`;
}
export function dayLabel(iso) {
  const day = (d) => new Date(d.getTime() + 330 * 60000).toISOString().slice(0, 10);
  const diff = Math.round((Date.parse(day(new Date())) - Date.parse(day(new Date(iso)))) / 864e5);
  return diff === 0 ? 'Today' : diff === 1 ? 'Yesterday' : fmtDate(iso);
}
/** WhatsApp-style day heading: Today · Yesterday · Thursday (within the last week) · 12 Oct 2026 */
export function dayHeading(iso) {
  const ist = (d) => new Date(d.getTime() + 330 * 60000).toISOString().slice(0, 10);
  const diff = Math.round((Date.parse(ist(new Date())) - Date.parse(ist(new Date(iso)))) / 864e5);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff > 1 && diff < 7) return new Date(iso).toLocaleDateString('en-IN', { weekday: 'long', timeZone: 'Asia/Kolkata' });
  return fmtDate(iso);
}
export const istDay = (iso) => new Date(new Date(iso).getTime() + 330 * 60000).toISOString().slice(0, 10);
/** True when the CRM is running inside the Android app (it exposes window.RPNative). */
export const inApp = () => !!window.RPNative;
/** Save a text file the page built in memory: the app saves it to Downloads, a browser downloads it. */
export function saveTextFile(name, text, mime = 'text/csv') {
  if (window.RPNative?.saveFile) {
    const bytes = new TextEncoder().encode(text); let bin = ''; bytes.forEach((b) => { bin += String.fromCharCode(b); });
    window.RPNative.saveFile(name, mime, btoa(bin)); return;
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: mime })); a.download = name; a.click();
}
export const phoneFmt = (p) => (p && p.length === 10 ? `+91 ${p.slice(0, 5)} ${p.slice(5)}` : p || '');
export const dtLocal = (iso) => { const d = iso ? new Date(iso) : new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
export const fromDT = (v) => (v ? new Date(v).toISOString() : '');
export const today = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
export const initials = (n) => String(n || '?').split(/\s+/).map((x) => x[0]).slice(0, 2).join('').toUpperCase();
export const avatar = (name, cls = '') => `<span class="avatar ${cls}" aria-hidden="true">${esc(initials(name))}</span>`;
export const waLink = (phone, text = '') => `https://wa.me/91${phone}${text ? '?text=' + encodeURIComponent(text) : ''}`;
export const fullLink = (hash) => `${location.origin}/${hash}`;
export async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('Copied to clipboard', 'ok'); }
  catch { const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); toast('Copied', 'ok'); }
}

// ---------- icons: one set, one stroke weight (24px grid, 1.75 stroke) ----------
const P = {
  home: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  userPlus: '<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/>',
  userCheck: '<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><polyline points="17 11 19 13 23 9"/>',
  map: '<polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
  rupee: '<path d="M6 3h12"/><path d="M6 8h12"/><path d="M6 13l8.5 8"/><path d="M6 13h3"/><path d="M9 13c6.667 0 6.667-10 0-10"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  checkCircle: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
  xCircle: '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>',
  phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
  message: '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  truck: '<rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>',
  pin: '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
  zap: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
  shuffle: '<polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/>',
  briefcase: '<rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>',
  tag: '<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>',
  chart: '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  filter: '<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>',
  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  chevDown: '<polyline points="6 9 12 15 18 9"/>', chevUp: '<polyline points="18 15 12 9 6 15"/>', chevRight: '<polyline points="9 18 15 12 9 6"/>', chevLeft: '<polyline points="15 18 9 12 15 6"/>',
  arrowUp: '<line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>', arrowDown: '<line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/>',
  bell: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
  more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
  edit: '<path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  alert: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  info: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
  flame: '<path d="M12 22c4 0 7-2.7 7-7 0-3-1.8-5-3.2-6.8-.7-.9-1-2.2-1-3.2-2.3 1.2-4.1 3.5-4.8 5.8C9 9.6 8.5 8.3 8.5 7 6 8.9 5 11.9 5 15c0 4.3 3 7 7 7z"/>',
  sun: '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>',
  moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
  snow: '<line x1="12" y1="2" x2="12" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="4.9" y1="4.9" x2="19.1" y2="19.1"/><line x1="19.1" y1="4.9" x2="4.9" y2="19.1"/>',
  menu: '<line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  refresh: '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
  undo: '<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>',
  sliders: '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
  grid: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
  list: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
  cards: '<rect x="3" y="3" width="18" height="7" rx="1.5"/><rect x="3" y="14" width="18" height="7" rx="1.5"/>',
  columns: '<path d="M12 3h7a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-7m0-18H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h7m0-18v18"/>',
  logOut: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
  key: '<path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  inbox: '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  layers: '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
  send: '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
  panel: '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="9" y1="3" x2="9" y2="21"/>',
  target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  ban: '<circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>',
  printer: '<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  external: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>',
  building: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4"/><line x1="8" y1="6" x2="8.01" y2="6"/><line x1="12" y1="6" x2="12.01" y2="6"/><line x1="16" y1="6" x2="16.01" y2="6"/><line x1="8" y1="10" x2="8.01" y2="10"/><line x1="12" y1="10" x2="12.01" y2="10"/><line x1="16" y1="10" x2="16.01" y2="10"/>',
  circle: '<circle cx="12" cy="12" r="9"/>',
};
export const ico = (name, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${P[name] || P.info}</svg>`;
// Any emoji that still appears in a template is swapped for the matching icon so the product never mixes styles.
const EMOJI = { '📞': 'phone', '💬': 'message', '📝': 'edit', '✅': 'checkCircle', '🚗': 'truck', '🚐': 'truck', '🔒': 'lock', '📑': 'file', '🗺': 'map', '🔥': 'flame', '🌤': 'sun', '❄': 'snow', '📍': 'pin', '👤': 'user', '⏰': 'clock', '🕒': 'clock', '⚠': 'alert',
  '📱': 'phone', '✏': 'edit', '🗑': 'trash', '⬇': 'download', '⬆': 'upload', '＋': 'plus', '🏷': 'tag', '🤖': 'zap', '🔗': 'link', '🔁': 'refresh', '🔀': 'shuffle', '🔑': 'key', '🖨': 'printer', '🏡': 'home', '☰': 'menu', '📊': 'chart',
  '👥': 'users', '🧑‍💼': 'briefcase', '🤝': 'share', '💰': 'rupee', '📈': 'chart', '⚙': 'settings', '🔔': 'bell', '↩': 'undo', '←': 'chevLeft', '✓': 'check', '✗': 'x', '💾': 'download', '✨': 'zap', '☑': 'checkCircle', '✕': 'x', '💼': 'briefcase', '📅': 'calendar', '🏛': 'building', '🧾': 'file', '📋': 'list', '🔍': 'search', '🎉': '', '🙏': '', '👋': '' };
const EMO_RE = new RegExp('(' + Object.keys(EMOJI).sort((a, b) => b.length - a.length).map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\\uFE0F?', 'gu');
export function iconize(root) {
  if (!root || (root.nodeType !== 1 && root.nodeType !== 11)) return;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: (n) => { EMO_RE.lastIndex = 0; const p = n.parentNode; return EMO_RE.test(n.nodeValue) && p && !/^(SCRIPT|STYLE|TEXTAREA|OPTION|TITLE)$/.test(p.nodeName) && !p.closest('svg') ? 1 : 2; } });
  const nodes = []; while (w.nextNode()) nodes.push(w.currentNode);
  for (const n of nodes) {
    const t = n.nodeValue, frag = document.createDocumentFragment(); let last = 0, m; EMO_RE.lastIndex = 0;
    while ((m = EMO_RE.exec(t))) {
      frag.append(t.slice(last, m.index)); const name = EMOJI[m[1]];
      if (name) { const tmp = document.createElement('span'); tmp.innerHTML = ico(name); frag.append(tmp.firstChild); }
      last = m.index + m[0].length;
    }
    frag.append(t.slice(last)); n.replaceWith(frag);
  }
}
/** Watches the page: icons for new content, searchable dropdowns for long selects. Call once at start-up. */
export function initUi() {
  // phone numbers: only digits, +, space and - ; never more than 12 digits (91 + 10)
  document.addEventListener('input', (e) => {
    const i = e.target; if (!(i instanceof HTMLInputElement) || i.dataset.v !== 'phone') return;
    let v = i.value.replace(/[^\d+\s-]/g, ''), n = 0; v = [...v].filter((c) => (/\d/.test(c) ? ++n <= 12 : true)).join(''); if (v !== i.value) i.value = v;
  });
  const queue = new Set(); let raf = 0;
  const flush = () => { raf = 0; for (const n of queue) { if (n.isConnected) { enhancePasswords(n); iconize(n); enhanceSelects(n); } } queue.clear(); };
  new MutationObserver((muts) => {
    for (const m of muts) for (const n of m.addedNodes) { const el = n.nodeType === 1 ? n : n.parentElement; if (el && !(el.closest && el.closest('svg'))) queue.add(el); }
    if (!raf && queue.size) raf = setTimeout(flush, 0); // not rAF: it is paused in background tabs
  }).observe(document.body, { childList: true, subtree: true });
  enhancePasswords(document.body); iconize(document.body); enhanceSelects(document.body);
  // live field validation inside dialogs, drawers and sign-in forms
  document.addEventListener('focusout', (e) => { const i = e.target; if (i && i.closest && i.closest('.modal, .drawer, .auth') && (i.required || i.dataset.v)) validateField(i); });
  document.addEventListener('input', (e) => { const i = e.target; if (i && i.closest && i.closest('.fld.invalid')) validateField(i); });
}

/** Every password field gets a show / hide (eye) button, wherever it appears in the product. */
export function enhancePasswords(root = document) {
  const scope = root.nodeType === 1 || root.nodeType === 9 ? root : document;
  const fields = scope.matches?.('input[type=password]') ? [scope] : $$('input[type=password]', scope);
  fields.forEach((i) => {
    if (i._pw || i.closest('.pw')) return; i._pw = true;
    const wrap = document.createElement('div'); wrap.className = 'pw'; i.before(wrap); wrap.append(i);
    const b = document.createElement('button'); b.type = 'button'; b.className = 'pw-t'; b.setAttribute('aria-pressed', 'false'); b.setAttribute('aria-label', 'Show password'); b.setAttribute('data-tip', 'Show password'); b.tabIndex = 0;
    b.innerHTML = ico('eye'); wrap.append(b);
    b.addEventListener('click', () => {
      const show = i.type === 'password'; i.type = show ? 'text' : 'password';
      b.innerHTML = ico(show ? 'eyeOff' : 'eye'); b.setAttribute('aria-pressed', show); b.setAttribute('aria-label', show ? 'Hide password' : 'Show password'); b.setAttribute('data-tip', show ? 'Hide password' : 'Show password');
      i.focus({ preventScroll: true });
    });
  });
}

// ---------- status vocabulary: the same word always gets the same colour ----------
export const STATUS = {
  stage: { New: 'slate', Contacted: 'blue', 'Site Visit Scheduled': 'violet', 'Site Visit Completed': 'violet', Negotiation: 'amber', Booked: 'green', Lost: 'red' },
  plot: { available: 'green', hold: 'amber', booked: 'blue', sold: 'slate', blocked: 'red' },
  booking: { booked: 'blue', agreement: 'violet', registered: 'green', cancelled: 'red' },
  kyc: { none: 'slate', pending: 'amber', partial: 'amber', verified: 'green', rejected: 'red' },
  visit: { scheduled: 'amber', completed: 'green', cancelled: 'slate', no_show: 'red' },
  commission: { pending: 'amber', approved: 'blue', paid: 'green', cancelled: 'red' },
  discount: { pending: 'amber', approved: 'green', rejected: 'red' },
  health: { Active: 'green', 'Slowing Down': 'amber', Inactive: 'red' },
};
export const badge = (t, cls = '') => `<span class="badge ${cls}">${esc(t)}</span>`;
export const statusChip = (kind, value, label) => badge(label ?? String(value).replace('_', ' '), `b-${STATUS[kind]?.[value] || 'slate'} dotted`);
export const STAGE_CLS = Object.fromEntries(Object.entries(STATUS.stage).map(([k, v]) => [k, `b-${v} dotted`]));
export const stageBadge = (s) => badge(s, STAGE_CLS[s] || 'b-slate dotted');
export const PLOT_CLS = Object.fromEntries(Object.entries(STATUS.plot).map(([k, v]) => [k, `b-${v} dotted`]));
export const ratingBadge = (r) => `<span class="rate rate-${esc(r)}">${ico(r === 'Hot' ? 'flame' : r === 'Warm' ? 'sun' : 'snow', 'sm')}${esc(r)}</span>`;
export const CALL_LABEL = { Connected: 'Completed', 'Not Answered': 'No Answer', 'Not Picked': 'Not picked', 'Not Interested': 'Not interested', 'Update Later': 'Update later', 'Interview Scheduled': 'Interview scheduled', Initiated: 'Waiting for phone…' };
export const callLabel = (o) => CALL_LABEL[o] || o || '';
export const callCls = (o) => `${o === 'Connected' || o === 'Interview Scheduled' ? 'b-green' : o === 'Initiated' || o === 'Update Later' ? 'b-blue' : o === 'Failed' || o === 'Rejected' || o === 'Not Interested' ? 'b-red' : 'b-amber'} dotted`;
export const mmss = (sec) => `${String(Math.floor((sec || 0) / 60)).padStart(2, '0')}:${String((sec || 0) % 60).padStart(2, '0')}`;

// ---------- feedback: toasts, snackbar ----------
export function toast(msg, type = '') {
  const host = $('#toasts'); if (!host) return;
  const el = document.createElement('div'); el.className = 'toast ' + type; el.setAttribute('role', type === 'err' ? 'alert' : 'status');
  el.innerHTML = `${ico(type === 'err' ? 'xCircle' : type === 'ok' ? 'checkCircle' : 'info')}<span>${esc(msg)}</span>`;
  host.appendChild(el);
  const gone = () => { el.classList.add('out'); setTimeout(() => el.remove(), 220); };
  setTimeout(gone, type === 'err' ? 6500 : 3400); el.addEventListener('click', gone);
}
/** Small bar at the bottom with one action button; goes away by itself. */
export function snack(text, action, onAction, ms = 45000) {
  document.querySelector('.snack')?.remove();
  const el = document.createElement('div'); el.className = 'snack'; el.setAttribute('role', 'status');
  el.innerHTML = `<span>${esc(text)}</span><button class="btn sm primary">${esc(action)}</button><button class="x" aria-label="Dismiss">${ico('x')}</button>`;
  document.body.appendChild(el);
  el.querySelector('.btn').onclick = () => { el.remove(); onAction(); };
  el.querySelector('.x').onclick = () => el.remove();
  setTimeout(() => el.remove(), ms);
}

// ---------- layers: modal · drawer · menu (Esc closes the top one; focus is restored) ----------
const layers = [];
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && layers.length) { e.preventDefault(); layers[layers.length - 1].close(); }
  if (e.key === 'Tab' && layers.length) { // keep keyboard focus inside the open dialog
    const root = layers[layers.length - 1].el; const f = $$('a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]):not(.combo-src),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])', root).filter((x) => x.offsetParent !== null);
    if (!f.length) return; const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
});
// While any modal/drawer is open the page behind it must not scroll (or show through on phones).
const syncScrollLock = () => document.documentElement.classList.toggle('has-layer', layers.length > 0);
function makeLayer(wrap, onClose) {
  const prev = document.activeElement; let closed = false;
  const layer = { el: wrap, close() { if (closed) return; closed = true; wrap.remove(); const i = layers.indexOf(layer); if (i >= 0) layers.splice(i, 1); syncScrollLock(); onClose && onClose(); try { prev && prev.focus && prev.isConnected && prev.focus(); } catch { /* ignore */ } } };
  layers.push(layer); syncScrollLock(); return layer;
}
export function modal({ title, body, footer = '', wide = false, xl = false, onOpen }) {
  const wrap = document.createElement('div'); wrap.className = 'modal-wrap';
  wrap.innerHTML = `<div class="modal ${wide ? 'wide' : ''} ${xl ? 'xl' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="modal-h"><h3>${esc(title)}</h3><button class="x" data-close aria-label="Close">${ico('x')}</button></div>
    <div class="modal-b">${body}</div>${footer ? `<div class="modal-f">${footer}</div>` : ''}</div>`;
  document.body.appendChild(wrap);
  const layer = makeLayer(wrap), close = layer.close;
  wrap.addEventListener('mousedown', (e) => { wrap._down = e.target === wrap; });
  wrap.addEventListener('click', (e) => { if ((e.target === wrap && wrap._down) || e.target.closest('[data-close]')) close(); wrap._down = false; });
  iconize(wrap); enhanceSelects(wrap);
  onOpen && onOpen(wrap, close);
  const first = wrap.querySelector('input:not([type=hidden]):not([type=file]),select:not(.combo-src),textarea'); first && setTimeout(() => first.focus({ preventScroll: true }), 40);
  return { el: wrap, close, body: wrap.querySelector('.modal-b') };
}
/** Side panel (bottom sheet on phones) for inspecting a record without leaving the list. */
export function drawer({ title = '', header = '', body, footer = '', onOpen, onClose }) {
  const wrap = document.createElement('div'); wrap.className = 'drawer-wrap';
  wrap.innerHTML = `<aside class="drawer" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="drawer-h">${header || `<h3 class="grow">${esc(title)}</h3>`}<button class="btn ghost icon" data-close aria-label="Close" data-tip="Close">${ico('x')}</button></div>
    <div class="drawer-b">${body}</div>${footer ? `<div class="drawer-f">${footer}</div>` : ''}</aside>`;
  document.body.appendChild(wrap);
  const layer = makeLayer(wrap, onClose), close = layer.close;
  wrap.addEventListener('mousedown', (e) => { wrap._down = e.target === wrap; });
  wrap.addEventListener('click', (e) => { if ((e.target === wrap && wrap._down) || e.target.closest('[data-close]')) close(); wrap._down = false; });
  iconize(wrap); enhanceSelects(wrap);
  onOpen && onOpen(wrap, close);
  return { el: wrap, close, body: wrap.querySelector('.drawer-b'), footer: wrap.querySelector('.drawer-f') };
}
/** Small action menu anchored to a button. items: [{icon,label,action,danger,hint}, {hr:true}, {header:'Group'}] */
let openMenuEl = null;
export function closeMenu() { if (openMenuEl) { openMenuEl.remove(); openMenuEl = null; } }
export function openMenu(anchor, items) {
  closeMenu();
  const m = document.createElement('div'); m.className = 'menu floating'; m.setAttribute('role', 'menu');
  m.innerHTML = items.map((it, i) => it.hr ? '<hr>' : it.header ? `<div class="mh">${esc(it.header)}</div>` : `<button type="button" role="menuitem" class="${it.danger ? 'danger' : ''}" data-i="${i}">${it.icon ? ico(it.icon) : ''}<span>${esc(it.label)}</span>${it.hint ? `<span class="muted small" style="margin-left:auto">${esc(it.hint)}</span>` : ''}</button>`).join('');
  document.body.appendChild(m); openMenuEl = m;
  const r = anchor.getBoundingClientRect(), mw = m.offsetWidth, mh = m.offsetHeight;
  if (innerWidth > 900) {
    m.style.left = Math.max(8, Math.min(innerWidth - mw - 8, r.right - mw)) + 'px';
    m.style.top = (r.bottom + 6 + mh > innerHeight ? Math.max(8, r.top - mh - 6) : r.bottom + 6) + 'px';
  } else m.classList.add('sheet');
  m.addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (!b) return; const it = items[Number(b.dataset.i)]; closeMenu(); it.action && it.action(); });
  const off = (e) => { if (!m.contains(e.target) && !anchor.contains(e.target)) { closeMenu(); document.removeEventListener('mousedown', off, true); } };
  setTimeout(() => document.addEventListener('mousedown', off, true), 0);
  m.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeMenu(); anchor.focus?.(); } });
  m.querySelector('button')?.focus();
  return m;
}

// ---------- forms ----------
export function getForm(el) {
  const o = {};
  $$('[name]', el).forEach((i) => {
    if (i.type === 'checkbox') o[i.name] = i.checked;
    else if (i.type === 'radio') { if (i.checked) o[i.name] = i.value; }
    else o[i.name] = i.value;
  });
  return o;
}
const RULES = {
  phone: (v) => (/^(\+?91[\s-]?|0)?[6-9](?:[\s-]?\d){9}$/.test(v) ? '' : 'Enter a valid 10-digit Indian mobile number'),
  email: (v) => (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) ? '' : 'Enter a valid email address'),
};
export function validateField(input) {
  const fld = input.closest('.fld'); if (!fld) return true;
  const v = String(input.value || '').trim(); let msg = '';
  if (input.required && !v && input.type !== 'checkbox') msg = 'This field is required';
  else if (v && input.dataset.v && RULES[input.dataset.v]) msg = RULES[input.dataset.v](v);
  else if (v && input.type === 'number' && input.min !== '' && Number(v) < Number(input.min)) msg = `Must be ${input.min} or more`;
  fld.classList.toggle('invalid', !!msg);
  let e = fld.querySelector(':scope > .ferr');
  if (msg) { if (!e) { e = document.createElement('div'); e.className = 'ferr'; e.setAttribute('role', 'alert'); fld.append(e); } e.innerHTML = ico('alert', 'sm') + esc(msg); } else e?.remove();
  return !msg;
}
export function validateForm(root) {
  let first = null;
  $$('input[required],select[required],textarea[required],[data-v]', root).forEach((i) => { if (i.type !== 'hidden' && !validateField(i) && !first) first = i; });
  if (first) { (first.classList.contains('combo-src') ? first.closest('.fld')?.querySelector('.combo-btn') : first)?.focus(); return false; }
  return true;
}
/** Modal with a form; onSubmit(data, ctl) may throw to show an error inline, or return false to stay open. */
export function modalForm({ title, body, submit = 'Save', danger = false, wide = false, xl = false, onSubmit, cancel = 'Cancel', onOpen }) {
  const m = modal({ title, body: `<div class="form-err"></div>${body}`, wide, xl,
    footer: `<button class="btn" data-close>${esc(cancel)}</button><button class="btn ${danger ? 'danger fill' : 'primary'}" data-submit>${esc(submit)}</button>`, onOpen });
  const btn = $('[data-submit]', m.el), errBox = $('.form-err', m.el);
  const run = async () => {
    errBox.innerHTML = '';
    if (!validateForm(m.body)) return;
    btn.classList.add('busy');
    try { const r = await onSubmit(getForm(m.body), m); if (r !== false) m.close(); }
    catch (e) { errBox.innerHTML = `<div class="err" role="alert">${ico('alert', 'sm')}<span>${esc(e.message)}</span></div>`; m.body.scrollTop = 0; m.el.scrollTo?.(0, 0); }
    finally { btn.classList.remove('busy'); }
  };
  btn.addEventListener('click', run);
  m.el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT' && !['search', 'file'].includes(e.target.type) && !e.target.closest('.no-enter, .combo')) { e.preventDefault(); run(); } });
  return m;
}
export function confirmDialog(message, { ok = 'Confirm', danger = false, title = 'Are you sure?' } = {}) {
  return new Promise((res) => {
    let done = false;
    const m = modal({ title, body: `<div style="display:flex;gap:12px"><span class="fi ${danger ? 'red' : 'blue'}" style="width:36px;height:36px;border-radius:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0">${ico(danger ? 'alert' : 'info')}</span><p style="margin:0;white-space:pre-wrap;line-height:1.5">${message}</p></div>`,
      footer: `<button class="btn" data-close>Cancel</button><button class="btn ${danger ? 'danger fill' : 'primary'}" data-ok>${esc(ok)}</button>` });
    $('[data-ok]', m.el).addEventListener('click', () => { done = true; m.close(); res(true); });
    $('[data-ok]', m.el).focus();
    new MutationObserver((_, ob) => { if (!document.body.contains(m.el)) { ob.disconnect(); if (!done) { done = true; res(false); } } }).observe(document.body, { childList: true });
  });
}
export function askText(title, label, { required = true, value = '', submit = 'Save', textarea = true } = {}) {
  return new Promise((res) => {
    let sent = false;
    const m = modalForm({ title, submit, body: fld(label, textarea ? `<textarea name="v" ${required ? 'required' : ''}>${esc(value)}</textarea>` : inp('v', value, required ? 'required' : '')),
      onSubmit: (d) => { sent = true; res(d.v.trim()); } });
    new MutationObserver((_, ob) => { if (!document.body.contains(m.el)) { ob.disconnect(); if (!sent) { sent = true; res(null); } } }).observe(document.body, { childList: true });
  });
}
export const fld = (label, control, hint = '', cls = '') => `<label class="fld ${cls}"><span>${label}</span>${control}${hint ? `<small>${hint}</small>` : ''}</label>`;
export const inp = (name, val = '', attrs = '') => `<input name="${name}" value="${esc(val)}" ${attrs}>`;
export const sel = (name, opts, val = '', attrs = '') => `<select name="${name}" ${attrs}>${opts.map((o) => {
  if (o && o.group) return `<optgroup label="${esc(o.group)}">${o.options.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(val) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</optgroup>`;
  const [v, l] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(v)}" ${String(v) === String(val) ? 'selected' : ''}>${esc(l)}</option>`; }).join('')}</select>`;
export const repOptions = (blank = 'Unassigned', includeInactive = false) => [['', blank], ...(S.meta?.users || []).filter((u) => includeInactive || u.status === 'active').map((u) => [u.id, u.name + (u.role === 'admin' ? ' (admin)' : '')])];
export const projectOptions = (blank = 'Any project') => [['', blank], ...(S.meta?.projects || []).filter((p) => p.status === 'active').map((p) => [p.id, p.name])];

// ---------- searchable dropdown: any <select> with 8+ options becomes type-to-search ----------
const COMBO_MIN = 8;
export function enhanceSelects(root = document) {
  $$('select', root.nodeType === 1 && root.tagName === 'SELECT' ? root.parentNode : root).forEach((s) => {
    if (s._combo || s.multiple || s.dataset.native !== undefined || s.classList.contains('combo-src')) return;
    const n = [...s.options].filter((o) => o.value !== '').length;
    if (n >= COMBO_MIN || s.dataset.combo !== undefined) buildCombo(s);
  });
}
function buildCombo(s) {
  s._combo = true; s.classList.add('combo-src');
  const box = document.createElement('div'); box.className = 'combo'; s.after(box);
  box.innerHTML = '<button type="button" class="combo-btn" aria-haspopup="listbox" aria-expanded="false"><span class="v"></span><span class="end"></span></button>';
  const btn = box.firstChild, vEl = $('.v', btn), end = $('.end', btn);
  const hasBlank = () => !!s.querySelector('option[value=""]');
  const label = () => {
    const has = s.value !== ''; vEl.className = 'v' + (has ? '' : ' ph');
    vEl.textContent = has ? (s.selectedOptions[0]?.textContent || '') : (s.querySelector('option[value=""]')?.textContent || s.dataset.placeholder || 'Select…');
    end.innerHTML = has && hasBlank() && !s.disabled ? `<span class="clr" data-clr role="button" aria-label="Clear selection">${ico('x', 'sm')}</span>` : ico('chevDown', 'sm');
    btn.disabled = s.disabled;
  };
  label(); new MutationObserver(label).observe(s, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'selected'] });
  s.addEventListener('change', label);
  const rk = 'rp_recent_' + (s.name || s.id || 'x');
  let pop = null, list = [], act = 0, scrim = null;
  const recent = () => { try { return JSON.parse(store.get(rk) || '[]'); } catch { return []; } };
  const options = () => { const out = []; const add = (o, g) => { if (o.value !== '') out.push({ v: o.value, t: o.textContent, g }); }; [...s.children].forEach((c) => c.tagName === 'OPTGROUP' ? [...c.children].forEach((o) => add(o, c.label)) : add(c, '')); return out; };
  const close = () => { if (!pop) return; pop.remove(); scrim?.remove(); pop = null; scrim = null; box.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); document.removeEventListener('mousedown', outside, true); };
  const outside = (e) => { if (!box.contains(e.target)) close(); };
  const choose = (v) => {
    s.value = v; s.dispatchEvent(new Event('change', { bubbles: true })); label();
    if (v !== '') store.set(rk, JSON.stringify([v, ...recent().filter((x) => x !== v)].slice(0, 3)));
    close(); btn.focus();
  };
  const paint = (q) => {
    const all = options(), term = q.trim().toLowerCase();
    let rows = term ? all.filter((o) => o.t.toLowerCase().includes(term)) : all;
    const items = [];
    if (hasBlank() && !term && s.dataset.noclear === undefined && false) items.push({ v: '', t: s.querySelector('option[value=""]').textContent });
    const rec = !term && all.length > 12 ? recent().map((v) => all.find((o) => o.v === v)).filter(Boolean) : [];
    if (rec.length) { items.push({ g: 'Recent' }); rec.forEach((o) => items.push(o)); items.push({ g: 'All' }); }
    let lastG = null; rows.forEach((o) => { if (o.g && o.g !== lastG) { items.push({ g: o.g }); lastG = o.g; } items.push(o); });
    list = items.filter((i) => !i.g); if (act >= list.length) act = Math.max(0, list.length - 1);
    const ul = $('.combo-list', pop); let k = -1;
    ul.innerHTML = items.length ? items.map((i) => i.g ? `<li class="g">${esc(i.g)}</li>` : `<li role="option" data-k="${++k}" data-v="${esc(i.v)}" class="${k === act ? 'act' : ''} ${i.v === s.value ? 'sel' : ''}"><span>${esc(i.t)}</span>${i.v === s.value ? ico('check', 'sm') : ''}</li>`).join('') : '<li class="empty-r">No matches</li>';
    $('.act', ul)?.scrollIntoView({ block: 'nearest' });
  };
  const open = () => {
    if (pop || s.disabled) return;
    document.querySelectorAll('.combo.open .combo-btn').forEach((b) => b.click());
    pop = document.createElement('div'); pop.className = 'combo-pop'; pop.innerHTML = `<input type="search" class="combo-q" placeholder="Search…" aria-label="Search options" autocomplete="off" data-native><ul class="combo-list" role="listbox"></ul>`;
    box.append(pop); box.classList.add('open'); btn.setAttribute('aria-expanded', 'true');
    if (innerWidth <= 900) { scrim = document.createElement('div'); scrim.className = 'menu-scrim'; scrim.onclick = close; (s.closest('.modal-wrap, .drawer-wrap') || document.body).append(scrim); }
    act = Math.max(0, options().findIndex((o) => o.v === s.value)); paint(''); const q = $('.combo-q', pop);
    const touch = matchMedia('(pointer:coarse)').matches;
    if (!touch || options().length > 12) q.focus(); else q.style.display = 'none'; // on a phone a short list needs no keyboard
    q.addEventListener('input', () => { act = 0; paint(q.value); });
    q.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); act = Math.min(list.length - 1, act + 1); paint(q.value); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); act = Math.max(0, act - 1); paint(q.value); }
      else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); if (list[act]) choose(list[act].v); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); btn.focus(); }
      else if (e.key === 'Tab') close();
    });
    // mousedown only stops the search box losing focus; the choice is made on click, which is what a finger tap on a phone produces
    pop.addEventListener('mousedown', (e) => { if (e.target.closest('li[data-v]')) e.preventDefault(); });
    pop.addEventListener('click', (e) => { const li = e.target.closest('li[data-v]'); if (li) { e.preventDefault(); choose(li.dataset.v); } });
    document.addEventListener('mousedown', outside, true);
  };
  btn.addEventListener('click', (e) => { if (e.target.closest('[data-clr]')) { e.stopPropagation(); choose(''); return; } pop ? close() : open(); });
  btn.addEventListener('keydown', (e) => { if (['ArrowDown', 'ArrowUp'].includes(e.key) && !pop) { e.preventDefault(); open(); } });
}

// ---------- loading, empty and error states ----------
export const empty = (title, sub = '', cta = '', icon = 'inbox') => `<div class="empty"><div class="empty-ic">${ico(icon, 'lg')}</div><b>${esc(title)}</b>${sub ? `<p>${esc(sub)}</p>` : ''}${cta}</div>`;
export const errorState = (msg = 'Something went wrong while loading this page.', retry = true) =>
  `<div class="empty err-state" role="alert"><div class="empty-ic">${ico('alert', 'lg')}</div><b>${esc(msg)}</b><p>Check your connection, then try again. Nothing you entered was lost.</p>${retry ? `<button class="btn primary" data-retry>${ico('refresh', 'sm')}Try again</button>` : ''}</div>`;
const sk = (c, n = 1) => Array.from({ length: n }, () => `<div class="skel ${c}"></div>`).join('');
export const skeleton = (kind = 'list') => ({
  dashboard: `${sk('skel-title')}<div class="focus">${sk('skel-kpi', 4)}</div><div class="grid g2 stack"><div>${sk('skel-card', 3)}</div><div>${sk('skel-card', 2)}</div></div>`,
  list: `${sk('skel-title')}<div class="skel skel-row" style="height:40px;margin-bottom:12px"></div>${sk('skel-row', 8)}`,
  detail: `<div class="skel skel-title" style="width:300px"></div><div class="skel skel-row" style="height:64px"></div><div class="grid g2 stack mt"><div>${sk('skel-card', 2)}</div><div>${sk('skel-card', 2)}</div></div>`,
  cards: `${sk('skel-title')}<div class="grid g3">${sk('skel-card', 6)}</div>`,
}[kind] || '');
export const spinner = () => skeleton('list');

/** Delegated event helper: on(root,'click','[data-act=x]', (el,e)=>{}) */
export function on(root, type, selector, fn) {
  root.addEventListener(type, (e) => { const el = e.target.closest(selector); if (el && root.contains(el)) fn(el, e); });
}

// ---------- lead search picker ----------
export function leadPicker(name = 'lead_id', preset = null) {
  return `<div class="lp" style="position:relative"><input type="hidden" name="${name}" value="${preset ? preset.id : ''}">
    <input type="search" class="lp-in" placeholder="Search lead by name or phone…" value="${preset ? esc(preset.name) : ''}" autocomplete="off" data-native>
    <div class="lp-res card hidden" style="position:absolute;left:0;right:0;z-index:5;max-height:230px;overflow:auto;padding:0"></div></div>`;
}
export function wireLeadPickers(root, onPick) {
  $$('.lp', root).forEach((lp) => {
    const hid = $('input[type=hidden]', lp), inp = $('.lp-in', lp), res = $('.lp-res', lp);
    const search = debounce(async () => {
      const q = inp.value.trim(); if (q.length < 2) { res.classList.add('hidden'); return; }
      const rows = await get('/leads?limit=8&q=' + encodeURIComponent(q));
      res.innerHTML = rows.length ? rows.map((l) => `<div data-id="${l.id}" style="padding:10px 12px;cursor:pointer"><b>${esc(l.name)}</b> <span class="muted small">${phoneFmt(l.phone_norm)} · ${esc(l.stage)}</span></div>`).join('') : '<div class="muted" style="padding:10px 12px">No matching leads</div>';
      res.classList.remove('hidden');
      $$('[data-id]', res).forEach((d) => d.addEventListener('click', () => { const l = rows.find((x) => x.id == d.dataset.id); hid.value = l.id; inp.value = l.name; res.classList.add('hidden'); onPick && onPick(l); }));
    });
    inp.addEventListener('input', () => { hid.value = ''; search(); });
  });
}

// ---------- charts (pure CSS) ----------
export function hbars(rows, { fmt = (v) => v, max } = {}) {
  const m = max ?? Math.max(1, ...rows.map((r) => r.value));
  return rows.map((r) => `<div class="hbar"><span class="small">${esc(r.label)}</span><div class="bar ${r.cls || ''}"><i style="width:${Math.max(r.value ? 2 : 0, (r.value / m) * 100)}%"></i></div><b class="small right">${fmt(r.value)}</b></div>`).join('');
}

/** Navigate (or re-render the current page when the hash is unchanged). */
export const nav = (h) => { if (location.hash === h) window.dispatchEvent(new HashChangeEvent('hashchange')); else location.hash = h; };
export const reload = () => nav(location.hash || '#/dashboard');

// ---------- phone-first helpers ----------
/** Compact Call / WhatsApp buttons for list rows and cards. Call uses the tracked dial link; WhatsApp opens the usual message box. */
export const quickActions = (id, name, phone) => phone ? `<span class="qa-row"><a class="qa call" href="tel:+91${phone}" data-call="${id}" data-call-name="${esc(name)}" aria-label="Call ${esc(name)}" data-tip="Call">${ico('phone')}</a><button class="qa wa" type="button" data-wa="${id}" data-wa-name="${esc(name)}" data-wa-phone="${phone}" aria-label="WhatsApp ${esc(name)}" data-tip="WhatsApp">${ico('message')}</button></span>` : '';
/** On narrow screens every .tbl turns into a stack of cards. The label of each value comes from its column header. */
export function labelTables(root) {
  root.querySelectorAll('table.tbl').forEach((t) => {
    const heads = [...t.querySelectorAll('thead th')].map((h) => h.textContent.trim());
    if (!heads.length) return;
    t.classList.add('rt');
    t.querySelectorAll('tbody tr').forEach((tr) => [...tr.children].forEach((td, i) => { if (td.dataset.label === undefined) td.dataset.label = td.colSpan > 1 ? '' : heads[i] || ''; }));
  });
}

/** The last few leads you opened — shown first in the search palette. */
export function rememberLead(l) {
  try { const r = JSON.parse(store.get('rp_recent_leads') || '[]').filter((x) => x.id !== l.id); r.unshift({ id: l.id, name: l.name, phone: l.phone_norm, stage: l.stage }); store.set('rp_recent_leads', JSON.stringify(r.slice(0, 5))); } catch { /* ignore */ }
}

/* ---- organization logo ---- */
export const orgMark = (org, cls = '') => org?.logo
  ? `<span class="logo-mark has-img ${cls}"><img src="${org.logo}" alt=""></span>`
  : `<span class="logo-mark ${cls}">${org?.name ? esc(org.name.trim().slice(0, 1).toUpperCase()) : ico('home')}</span>`;
function shrinkImage(file, max = 256) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file is not a readable image')); };
    img.src = url;
  });
}
export const logoPicker = (org) => `<div class="fld full"><span>Brand logo</span><div class="logo-pick" data-logo="${org?.logo ? '1' : ''}">
  <div class="lp-prev">${orgMark(org || { name: '' })}</div>
  <div class="lp-btns"><button type="button" class="btn sm" data-lp="pick">${ico('upload', 'sm')}Upload logo</button> <button type="button" class="btn sm ghost${org?.logo ? '' : ' hidden'}" data-lp="clear">Remove</button>
  <small>PNG, JPG or WebP · square works best · shown in the sidebar and on receipts</small></div>
  <input type="file" accept="image/png,image/jpeg,image/webp" class="hidden" data-lp="file"></div></div>`;
/** Wires a logoPicker inside `root`. Returns { value() } — a data URL, '' (removed) or undefined (unchanged). */
export function wireLogoPicker(root, org, nameInput) {
  const box = $('.logo-pick', root), prev = $('.lp-prev', box), clear = $('[data-lp=clear]', box), file = $('[data-lp=file]', box);
  let val; // undefined = unchanged
  const draw = (logo) => { prev.innerHTML = orgMark({ name: nameInput?.value || org?.name || '', logo }); clear.classList.toggle('hidden', !logo); };
  let cur = org?.logo || '';
  $('[data-lp=pick]', box).onclick = () => file.click();
  file.onchange = async () => {
    const f = file.files[0]; if (!f) return;
    try { val = await shrinkImage(f); cur = val; draw(cur); } catch (e) { toast(e.message, 'err'); }
    file.value = '';
  };
  clear.onclick = () => { val = ''; cur = ''; draw(''); };
  nameInput?.addEventListener('input', () => { if (!cur) draw(''); });
  return { value: () => val };
}

/* ---- team load (shown when choosing who gets a lead) ---- */
let _loads = { at: 0, rows: [] };
export async function repLoads(force = false) {
  if (!isAdmin()) return [];
  if (force || Date.now() - _loads.at > 15000) { try { _loads = { at: Date.now(), rows: await get('/team/loads') }; } catch { /* fall back to plain names */ } }
  return _loads.rows;
}
/** Options for a "who gets this lead" dropdown, with each person's workload and availability in the label. */
export function loadOptions(blank = 'Choose a team member…', rows = _loads.rows) {
  const by = Object.fromEntries(rows.map((r) => [r.id, r]));
  return [['', blank], ...(S.meta?.users || []).filter((u) => u.status === 'active').map((u) => {
    const r = by[u.id];
    const tag = !r ? '' : r.availability === 'on_leave' ? ' · on leave' : r.availability === 'off_duty' ? ' · off duty' : '';
    return [u.id, `${u.name}${u.role === 'admin' ? ' (admin)' : ''}${r ? ` — ${r.open_leads} open${r.untouched ? `, ${r.untouched} untouched` : ''}${r.visits_today ? `, ${r.visits_today} visit${r.visits_today > 1 ? 's' : ''} today` : ''}` : ''}${tag}`];
  })];
}
