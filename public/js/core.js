// Shared state + helpers for every screen.
export const S = { token: localStorage.getItem('rp_token') || '', user: null, org: null, settings: {}, meta: null };
export const isAdmin = () => S.user && S.user.role === 'admin';
export const $ = (sel, el = document) => el.querySelector(sel);
export const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const debounce = (fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

// ---------- API ----------
export async function api(method, path, body) {
  const res = await fetch('/api' + path, {
    method, headers: { 'content-type': 'application/json', ...(S.token ? { authorization: 'Bearer ' + S.token } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : await res.text();
  if (!res.ok) {
    if (res.status === 401 && S.token) { S.token = ''; localStorage.removeItem('rp_token'); location.hash = '#/login'; location.reload(); }
    const e = new Error((data && data.error) || 'Request failed'); e.status = res.status; e.data = data; throw e;
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
  if (s < 0) { const f = -s; return f < 3600 ? `in ${Math.round(f / 60)}m` : f < 86400 ? `in ${Math.round(f / 3600)}h` : `in ${Math.round(f / 86400)}d`; }
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  if (s < 86400 * 30) return Math.floor(s / 86400) + 'd ago';
  return fmtDate(iso);
}
export const phoneFmt = (p) => (p && p.length === 10 ? `+91 ${p.slice(0, 5)} ${p.slice(5)}` : p || '');
export const dtLocal = (iso) => { const d = iso ? new Date(iso) : new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
export const fromDT = (v) => (v ? new Date(v).toISOString() : '');
export const today = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
export const initials = (n) => String(n || '?').split(/\s+/).map((x) => x[0]).slice(0, 2).join('').toUpperCase();
export const badge = (t, cls = '') => `<span class="badge ${cls}">${esc(t)}</span>`;
export const STAGE_CLS = { New: 'b-blue', Contacted: 'b-blue', 'Site Visit Scheduled': 'b-amber', 'Site Visit Completed': 'b-amber', Negotiation: 'b-brand', Booked: 'b-green', Lost: 'b-red' };
export const stageBadge = (s) => badge(s, STAGE_CLS[s] || '');
export const ratingBadge = (r) => `<span class="rate-${esc(r)}" title="${esc(r)}">${r === 'Hot' ? '🔥' : r === 'Warm' ? '🌤️' : '❄️'} ${esc(r)}</span>`;
export const PLOT_CLS = { available: 'b-green', hold: 'b-amber', booked: 'b-blue', sold: '', blocked: 'b-red' };
export const waLink = (phone, text = '') => `https://wa.me/91${phone}${text ? '?text=' + encodeURIComponent(text) : ''}`;
export const fullLink = (hash) => `${location.origin}/${hash}`;
export async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('Copied to clipboard', 'ok'); }
  catch { const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); toast('Copied', 'ok'); }
}

// ---------- UI primitives ----------
export function toast(msg, type = '') {
  const el = document.createElement('div'); el.className = 'toast ' + type; el.textContent = msg;
  $('#toasts').appendChild(el); setTimeout(() => el.remove(), type === 'err' ? 6000 : 3200);
}
const openModals = [];
export function modal({ title, body, footer = '', wide = false, xl = false, onOpen }) {
  const wrap = document.createElement('div'); wrap.className = 'modal-wrap';
  wrap.innerHTML = `<div class="modal ${wide ? 'wide' : ''} ${xl ? 'xl' : ''}" role="dialog" aria-label="${esc(title)}"><div class="modal-h"><h3>${esc(title)}</h3><button class="x" data-close aria-label="Close">&times;</button></div>
    <div class="modal-b">${body}</div>${footer ? `<div class="modal-f">${footer}</div>` : ''}</div>`;
  document.body.appendChild(wrap);
  const close = () => { wrap.remove(); const i = openModals.indexOf(wrap); if (i >= 0) openModals.splice(i, 1); };
  wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) wrap._down = true; });
  wrap.addEventListener('click', (e) => { if ((e.target === wrap && wrap._down) || e.target.closest('[data-close]')) close(); wrap._down = false; });
  openModals.push(wrap);
  onOpen && onOpen(wrap, close);
  const first = wrap.querySelector('input:not([type=hidden]),select,textarea'); first && setTimeout(() => first.focus(), 30);
  return { el: wrap, close, body: wrap.querySelector('.modal-b') };
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && openModals.length) openModals[openModals.length - 1].remove(), openModals.pop(); });

export function getForm(el) {
  const o = {};
  $$('[name]', el).forEach((i) => {
    if (i.type === 'checkbox') o[i.name] = i.checked;
    else if (i.type === 'radio') { if (i.checked) o[i.name] = i.value; }
    else o[i.name] = i.value;
  });
  return o;
}
/** Modal with a form; onSubmit(data, ctl) may throw to show an error inline, or return false to stay open. */
export function modalForm({ title, body, submit = 'Save', danger = false, wide = false, xl = false, onSubmit, cancel = 'Cancel', onOpen }) {
  const m = modal({ title, body: `<div class="form-err"></div>${body}`, wide, xl,
    footer: `<button class="btn" data-close>${esc(cancel)}</button><button class="btn ${danger ? 'danger fill' : 'primary'}" data-submit>${esc(submit)}</button>`, onOpen });
  const btn = $('[data-submit]', m.el), errBox = $('.form-err', m.el);
  const run = async () => {
    errBox.innerHTML = ''; btn.disabled = true;
    try { const r = await onSubmit(getForm(m.body), m); if (r !== false) m.close(); }
    catch (e) { errBox.innerHTML = `<div class="err">${esc(e.message)}</div>`; m.body.scrollTop = 0; m.el.scrollTo?.(0, 0); }
    finally { btn.disabled = false; }
  };
  btn.addEventListener('click', run);
  m.el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'search' && !e.target.closest('.no-enter')) { e.preventDefault(); run(); } });
  return m;
}
export function confirmDialog(message, { ok = 'Confirm', danger = false, title = 'Are you sure?' } = {}) {
  return new Promise((res) => {
    let done = false;
    const m = modal({ title, body: `<p style="margin:0;white-space:pre-wrap">${message}</p>`, footer: `<button class="btn" data-close>Cancel</button><button class="btn ${danger ? 'danger fill' : 'primary'}" data-ok>${esc(ok)}</button>` });
    $('[data-ok]', m.el).addEventListener('click', () => { done = true; m.close(); res(true); });
    new MutationObserver(() => { if (!document.body.contains(m.el) && !done) { done = true; res(false); } }).observe(document.body, { childList: true });
  });
}
export function askText(title, label, { required = true, value = '', submit = 'Save', textarea = true } = {}) {
  return new Promise((res) => {
    let sent = false;
    const m = modalForm({ title, submit, body: fld(label, textarea ? `<textarea name="v" ${required ? 'required' : ''}>${esc(value)}</textarea>` : inp('v', value)),
      onSubmit: (d) => { if (required && !String(d.v).trim()) throw new Error('This field is required'); sent = true; res(d.v.trim()); } });
    new MutationObserver(() => { if (!document.body.contains(m.el) && !sent) { sent = true; res(null); } }).observe(document.body, { childList: true });
  });
}
export const fld = (label, control, hint = '', cls = '') => `<label class="fld ${cls}"><span>${label}</span>${control}${hint ? `<small>${hint}</small>` : ''}</label>`;
export const inp = (name, val = '', attrs = '') => `<input name="${name}" value="${esc(val)}" ${attrs}>`;
export const sel = (name, opts, val = '', attrs = '') => `<select name="${name}" ${attrs}>${opts.map((o) => { const [v, l] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(v)}" ${String(v) === String(val) ? 'selected' : ''}>${esc(l)}</option>`; }).join('')}</select>`;
export const repOptions = (blank = 'Unassigned', includeInactive = false) => [['', blank], ...(S.meta?.users || []).filter((u) => includeInactive || u.status === 'active').map((u) => [u.id, u.name + (u.role === 'admin' ? ' (admin)' : '')])];
export const projectOptions = (blank = 'Any project') => [['', blank], ...(S.meta?.projects || []).filter((p) => p.status === 'active').map((p) => [p.id, p.name])];
export const empty = (title, sub = '') => `<div class="empty"><b>${esc(title)}</b>${esc(sub)}</div>`;
export const spinner = () => '<div class="spinner">Loading…</div>';

/** Delegated event helper: on(root,'click','[data-act=x]', (el,e)=>{}) */
export function on(root, type, selector, fn) {
  root.addEventListener(type, (e) => { const el = e.target.closest(selector); if (el && root.contains(el)) fn(el, e); });
}

// ---------- lead search picker ----------
export function leadPicker(name = 'lead_id', preset = null) {
  return `<div class="lp" style="position:relative"><input type="hidden" name="${name}" value="${preset ? preset.id : ''}">
    <input type="search" class="lp-in" placeholder="Search lead by name or phone…" value="${preset ? esc(preset.name) : ''}" autocomplete="off">
    <div class="lp-res card hidden" style="position:absolute;left:0;right:0;z-index:5;max-height:230px;overflow:auto;padding:0"></div></div>`;
}
export function wireLeadPickers(root, onPick) {
  $$('.lp', root).forEach((lp) => {
    const hid = $('input[type=hidden]', lp), inp = $('.lp-in', lp), res = $('.lp-res', lp);
    const search = debounce(async () => {
      const q = inp.value.trim(); if (q.length < 2) { res.classList.add('hidden'); return; }
      const rows = await get('/leads?limit=8&q=' + encodeURIComponent(q));
      res.innerHTML = rows.length ? rows.map((l) => `<div data-id="${l.id}" style="padding:8px 12px;cursor:pointer"><b>${esc(l.name)}</b> <span class="muted small">${phoneFmt(l.phone_norm)} · ${esc(l.stage)}</span></div>`).join('') : '<div class="muted" style="padding:10px 12px">No matching leads</div>';
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
