// App shell: router, sign-in pages, notifications bell, global search, profile.
import { S, $, $$, esc, api, get, post, patch, loadMeta, toast, modal, modalForm, fld, inp, on, debounce, rel, fmtDT, isAdmin, initials, spinner, empty, badge, copy, fullLink, phoneFmt } from './core.js';
import * as dashboard from './v_dashboard.js';
import * as leads from './v_leads.js';
import * as inventory from './v_inventory.js';
import * as bookings from './v_bookings.js';
import * as work from './v_work.js';
import * as team from './v_team.js';
import * as adminv from './v_admin.js';
import * as pub from './v_public.js';

const NAV = [
  { sec: 'Sell' },
  { to: '/dashboard', ic: '📊', t: 'Dashboard' }, { to: '/leads', ic: '👥', t: 'Leads' }, { to: '/inventory', ic: '🗺️', t: 'Inventory' },
  { to: '/bookings', ic: '📑', t: 'Bookings' }, { to: '/collections', ic: '💰', t: 'Collections' },
  { sec: 'Daily work' },
  { to: '/tasks', ic: '✅', t: 'Follow-ups', id: 'tasks' }, { to: '/visits', ic: '🚗', t: 'Site Visits' }, { to: '/comms', ic: '📞', t: 'Calls & WhatsApp' },
  { to: '/attendance', ic: '🕒', t: 'Attendance' }, { to: '/ai', ic: '🤖', t: 'RealPilot AI' },
  { sec: 'Manage', admin: true },
  { to: '/router', ic: '🔀', t: 'Lead Router', admin: true }, { to: '/team', ic: '🧑‍💼', t: 'Team & Targets', admin: true },
  { to: '/partners', ic: '🤝', t: 'Partners', admin: true }, { to: '/discounts', ic: '🏷️', t: 'Discounts' },
  { to: '/reports', ic: '📈', t: 'Reports', admin: true }, { to: '/settings', ic: '⚙️', t: 'Settings', admin: true },
];
// [pattern, view fn, {public, admin, bare}]
const ROUTES = [
  ['/login', login, { public: true }], ['/setup', setup, { public: true }], ['/forgot', forgot, { public: true }],
  ['/reset/:token', resetPage, { public: true }], ['/invite/:token', invitePage, { public: true }],
  ['/portal/:token', pub.portal, { public: true }], ['/enquire/:code', pub.enquire, { public: true }],
  ['/dashboard', dashboard.render], ['/leads', leads.list], ['/leads/:id', leads.detail],
  ['/inventory', inventory.projects], ['/inventory/:id', inventory.project],
  ['/bookings', bookings.list], ['/bookings/:id', bookings.detail], ['/collections', bookings.collections], ['/discounts', bookings.discounts],
  ['/tasks', work.tasks], ['/visits', work.visits], ['/comms', work.comms], ['/router', work.router, { admin: true }],
  ['/team', team.team, { admin: true }], ['/attendance', team.attendance], ['/partners', team.partners, { admin: true }],
  ['/reports', adminv.reports, { admin: true }], ['/ai', adminv.ai], ['/settings', adminv.settings, { admin: true }],
];
const compiled = ROUTES.map(([p, fn, o = {}]) => { const keys = []; const re = new RegExp('^' + p.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$'); return { re, keys, fn, o }; });
let cleanup = null, pollers = [];

function parseHash() {
  const h = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = h.split('?');
  return { path: path || '/', query: Object.fromEntries(new URLSearchParams(qs || '')) };
}
export const go = (hash) => { if (location.hash === hash) route(); else location.hash = hash; };
window.rpGo = go;

async function route() {
  if (cleanup) { try { cleanup(); } catch { /* ignore */ } cleanup = null; }
  const { path, query } = parseHash();
  if (path === '/') return go(S.user ? '#/dashboard' : '#/login');
  const hit = compiled.map((r) => ({ r, m: r.re.exec(path) })).find((x) => x.m);
  if (!hit) { if (S.user) { renderShell(); $('#view').innerHTML = empty('Page not found', 'That page does not exist.'); } else go('#/login'); return; }
  const params = {}; hit.r.keys.forEach((k, i) => (params[k] = decodeURIComponent(hit.m[i + 1])));
  if (!hit.r.o.public && !S.user) return go('#/login');
  if (hit.r.o.public && S.user && ['/login', '/setup', '/forgot'].includes(path)) return go('#/dashboard');
  if (hit.r.o.admin && !isAdmin()) { renderShell(); $('#view').innerHTML = empty('Admins only', 'You do not have access to this page.'); return; }
  if (hit.r.o.public) { $('#root').innerHTML = ''; shellMounted = false; cleanup = (await hit.r.fn($('#root'), params, query)) || null; return; }
  renderShell(path);
  const oldView = $('#view'); const view = oldView.cloneNode(false); oldView.replaceWith(view); // fresh element = no stale listeners
  view.innerHTML = spinner();
  $('.side').classList.remove('open');
  try { cleanup = (await hit.r.fn(view, params, query)) || null; }
  catch (e) { console.error(e); view.innerHTML = `<div class="err">${esc(e.message)}</div>`; }
  window.scrollTo(0, 0);
  refreshTaskBadge();
}
window.addEventListener('hashchange', route);

// ---------- shell ----------
let shellMounted = false;
function renderShell(path = parseHash().path) {
  if (!shellMounted) {
    const nav = NAV.filter((n) => !n.admin || isAdmin()).map((n) => n.sec ? `<div class="sep">${n.sec}</div>` : `<a href="#${n.to}" data-to="${n.to}">${n.ic ? `<span class="ic">${n.ic}</span>` : ''}${esc(n.t === 'Attendance' && !isAdmin() ? 'Clock-in' : n.t)}${n.id ? `<span class="ct hidden" id="ct-${n.id}"></span>` : ''}</a>`).join('');
    $('#root').innerHTML = `<div class="app"><aside class="side"><div class="brand">🏡<div>RealtyPilot<small>${esc(S.org.name)}</small></div></div><nav class="nav">${nav}</nav></aside>
      <div class="main"><header class="top"><button class="burger" aria-label="Menu">☰</button>
        <div class="search"><input type="search" placeholder="Search leads, bookings, plots…" id="gs"><div class="res hidden" id="gsr"></div></div><div class="grow"></div>
        <div style="position:relative"><button class="icon-btn" id="bell" aria-label="Notifications">🔔<span class="dot hidden" id="bellct">0</span></button><div class="pop hidden" id="notifs"></div></div>
        <div style="position:relative"><button class="icon-btn" id="me" aria-label="Account"><span class="avatar">${esc(initials(S.user.name))}</span></button><div class="menu hidden" id="menu">
          <div style="padding:10px 14px"><b>${esc(S.user.name)}</b><div class="muted small">${esc(S.user.email)} · ${esc(S.user.role)}</div></div>
          <a href="#" data-m="profile">My profile & password</a><a href="#" data-m="enquiry">Public enquiry form link</a><button data-m="out">Sign out</button></div></div>
      </header><main id="view"></main></div></div>`;
    shellMounted = true;
    wireShell();
  }
  $$('.nav a').forEach((a) => a.classList.toggle('on', path === a.dataset.to || path.startsWith(a.dataset.to + '/')));
}
function wireShell() {
  $('.burger').onclick = () => $('.side').classList.toggle('open');
  $('#me').onclick = (e) => { e.stopPropagation(); $('#menu').classList.toggle('hidden'); $('#notifs').classList.add('hidden'); };
  $('#bell').onclick = async (e) => { e.stopPropagation(); const p = $('#notifs'); p.classList.toggle('hidden'); $('#menu').classList.add('hidden'); if (!p.classList.contains('hidden')) await loadNotifs(true); };
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#notifs') && !e.target.closest('#bell')) $('#notifs')?.classList.add('hidden');
    if (!e.target.closest('#menu') && !e.target.closest('#me')) $('#menu')?.classList.add('hidden');
    if (!e.target.closest('.search')) $('#gsr')?.classList.add('hidden');
  });
  on($('#menu'), 'click', '[data-m]', async (el, e) => {
    e.preventDefault(); $('#menu').classList.add('hidden');
    const a = el.dataset.m;
    if (a === 'out') { try { await post('/auth/logout'); } catch { /* ignore */ } localStorage.removeItem('rp_token'); S.token = ''; S.user = null; shellMounted = false; pollers.forEach(clearInterval); pollers = []; location.hash = '#/login'; route(); }
    if (a === 'profile') profileModal();
    if (a === 'enquiry') { const l = fullLink(`#/enquire/${S.org.code}`); modal({ title: 'Public enquiry form', body: `<p>Share or embed this page on your website, Facebook page bio or QR code. Every submission becomes a lead (with duplicate & spam checks).</p><p><code>${esc(l)}</code></p>`, footer: `<button class="btn primary" id="cp">Copy link</button>`, onOpen: (el2) => $('#cp', el2).onclick = () => copy(l) }); }
  });
  const gs = $('#gs'), gsr = $('#gsr');
  gs.addEventListener('input', debounce(async () => {
    const q = gs.value.trim(); if (q.length < 2) return gsr.classList.add('hidden');
    const r = await get('/search?q=' + encodeURIComponent(q));
    const sect = (t, a) => (a.length ? `<h5>${t}</h5>${a.join('')}` : '');
    const html = sect('Leads', r.leads.map((l) => `<a href="#/leads/${l.id}">${esc(l.name)} <span class="muted small">${phoneFmt(l.phone_norm)} · ${esc(l.stage)}</span></a>`))
      + sect('Bookings', r.bookings.map((b) => `<a href="#/bookings/${b.id}">${esc(b.booking_no)} <span class="muted small">${esc(b.buyer_name)}</span></a>`))
      + sect('Plots', r.plots.map((p) => `<a href="#/inventory/${p.project_id}">Plot ${esc(p.plot_no)} <span class="muted small">${esc(p.project_name)} · ${esc(p.status)}</span></a>`));
    gsr.innerHTML = html || '<div class="muted" style="padding:12px">No results</div>'; gsr.classList.remove('hidden');
  }));
  gsr.addEventListener('click', () => { gsr.classList.add('hidden'); gs.value = ''; });
  pollers.forEach(clearInterval);
  pollers = [setInterval(() => loadNotifs(false), 30000), setInterval(() => post('/heartbeat').catch(() => {}), 60000)];
  loadNotifs(false);
}
async function loadNotifs(render) {
  if (!S.user) return;
  let d; try { d = await get('/notifications'); } catch { return; }
  const c = $('#bellct'); if (!c) return;
  c.textContent = d.unread > 99 ? '99+' : d.unread; c.classList.toggle('hidden', !d.unread);
  if (!render && $('#notifs').classList.contains('hidden')) return;
  const p = $('#notifs');
  p.innerHTML = `<div class="ph"><b>Notifications</b><button class="btn sm ghost" id="mar">Mark all read</button></div>` + (d.items.length ? d.items.map((n) => `<div class="nitem ${n.read_at ? '' : 'unread'}" data-id="${n.id}" data-link="${esc(n.link)}"><div style="flex:1;min-width:0"><b>${esc(n.title)}</b><div class="small">${esc(n.message)}</div><div class="muted small">${rel(n.created_at)}</div></div><button class="del" data-del="${n.id}" title="Delete">🗑</button></div>`).join('') : empty('All caught up', 'No notifications'));
  const mar = $('#mar', p); if (mar) mar.onclick = async () => { await post('/notifications/read-all'); loadNotifs(true); };
  $$('.nitem', p).forEach((it) => it.addEventListener('click', async (e) => {
    if (e.target.closest('[data-del]')) { e.stopPropagation(); await api('DELETE', '/notifications/' + e.target.closest('[data-del]').dataset.del); return loadNotifs(true); }
    await post(`/notifications/${it.dataset.id}/read`); p.classList.add('hidden'); loadNotifs(false);
    if (it.dataset.link) go(it.dataset.link);
  }));
}
async function refreshTaskBadge() {
  try { const d = await get('/tasks'); const el = $('#ct-tasks'); if (el) { el.textContent = d.counts.overdue; el.classList.toggle('hidden', !d.counts.overdue); } } catch { /* ignore */ }
}
async function profileModal() {
  const p = await get(`/team/${S.user.id}/profile`);
  const m = modal({ title: 'My profile', wide: true, body: `<div class="grid g2 stack"><div><dl class="kv"><dt>Name</dt><dd>${esc(p.user.name)}</dd><dt>Email</dt><dd>${esc(p.user.email)}</dd><dt>Role</dt><dd>${esc(p.user.role)}</dd><dt>Phone</dt><dd>${esc(phoneFmt(p.user.phone))}</dd></dl>
      <h3 class="mt">Change password</h3><div class="form-err"></div>${fld('Current password', inp('cur', '', 'type="password" autocomplete="current-password"'))}${fld('New password (min 8 characters)', inp('new', '', 'type="password" autocomplete="new-password"'))}<button class="btn primary" id="cpw">Change password</button></div>
      <div><h3>Recent sessions</h3>${p.sessions.map((s) => `<div class="list-row"><div><b>${esc(s.device)}</b><div class="muted small">${fmtDT(s.created_at)}</div></div>${s.online ? badge('Online', 'b-green') : `<span class="muted small">${rel(s.last_seen)}</span>`}</div>`).join('') || empty('No sessions')}</div></div>` });
  $('#cpw', m.el).onclick = async () => {
    const err = $('.form-err', m.el); err.innerHTML = '';
    try { const r = await post('/auth/change-password', { current_password: $('[name=cur]', m.el).value, new_password: $('[name=new]', m.el).value }); toast(r.message, 'ok'); m.close(); }
    catch (e) { err.innerHTML = `<div class="err">${esc(e.message)}</div>`; }
  };
}

// ---------- sign-in / account pages ----------
const authWrap = (inner) => `<div class="auth"><div class="card"><div class="logo">🏡 RealtyPilot</div>${inner}</div></div>`;
async function login(root, _p, q) {
  root.innerHTML = authWrap(`<h1>Sign in</h1><p class="muted">CRM, inventory & collections for plot sales teams.</p><div id="e"></div>
    <form id="f">${fld('Email', inp('email', q.email || '', 'type="email" required autocomplete="username" autofocus'))}${fld('Password', inp('password', '', 'type="password" required autocomplete="current-password"'))}
    <button class="btn primary" style="width:100%;justify-content:center" id="go">Sign in</button></form>
    <div class="row between mt"><a href="#/forgot">Forgot password?</a><a href="#/setup">Create your organization</a></div>`);
  $('#f').onsubmit = async (e) => {
    e.preventDefault(); const b = $('#go'); b.disabled = true; $('#e').innerHTML = '';
    try {
      const r = await api('POST', '/auth/login', { email: $('[name=email]').value, password: $('[name=password]').value });
      S.token = r.token; localStorage.setItem('rp_token', r.token); await bootstrap(); go('#/dashboard');
    } catch (err) { $('#e').innerHTML = `<div class="err">${esc(err.message)}</div>`; b.disabled = false; }
  };
}
async function setup(root) {
  root.innerHTML = authWrap(`<h1>Create your organization</h1><p class="muted">Set up your company and its first admin account.</p><div id="e"></div><form id="f">
    <div class="frm-g">${fld('Organization name *', inp('org_name', '', 'required'), '', 'full')}${fld('Org code *', inp('org_code', '', 'required pattern="[A-Za-z0-9_-]{3,20}" placeholder="e.g. GREEN"'), '3–20 letters/numbers, unique')}${fld('City', inp('city'))}
    ${fld('Your name *', inp('name', '', 'required'), '', 'full')}${fld('Email *', inp('email', '', 'type="email" required'), '', 'full')}${fld('Password *', inp('password', '', 'type="password" minlength="8" required'), 'At least 8 characters', 'full')}</div>
    <button class="btn primary" style="width:100%;justify-content:center" id="go">Create organization</button></form><div class="mt"><a href="#/login">← Back to sign in</a></div>`);
  $('#f').onsubmit = async (e) => {
    e.preventDefault(); const b = $('#go'); b.disabled = true; $('#e').innerHTML = '';
    const d = Object.fromEntries([...new FormData(e.target)]);
    try { await api('POST', '/auth/setup', d); toast('Organization created — sign in now', 'ok'); go(`#/login?email=${encodeURIComponent(d.email)}`); }
    catch (err) { $('#e').innerHTML = `<div class="err">${esc(err.message)}</div>`; b.disabled = false; }
  };
}
async function forgot(root) {
  root.innerHTML = authWrap(`<h1>Forgot password</h1><p class="muted">Enter your email. Your admin will get a request and can send you a secure reset link.</p><div id="e"></div><form id="f">${fld('Email', inp('email', '', 'type="email" required'))}<button class="btn primary" style="width:100%;justify-content:center">Request reset</button></form><div class="mt"><a href="#/login">← Back to sign in</a></div>`);
  $('#f').onsubmit = async (e) => { e.preventDefault(); try { const r = await api('POST', '/auth/forgot', { email: $('[name=email]').value }); $('#e').innerHTML = `<div class="ok-box">${esc(r.message)}</div>`; } catch (err) { $('#e').innerHTML = `<div class="err">${esc(err.message)}</div>`; } };
}
async function resetPage(root, { token }) {
  root.innerHTML = authWrap(`<h1>Set a new password</h1><div id="e"></div><form id="f">${fld('New password', inp('password', '', 'type="password" minlength="8" required'), 'At least 8 characters')}<button class="btn primary" style="width:100%;justify-content:center">Update password</button></form>`);
  $('#f').onsubmit = async (e) => { e.preventDefault(); try { await api('POST', '/auth/reset', { token, password: $('[name=password]').value }); toast('Password updated — please sign in', 'ok'); go('#/login'); } catch (err) { $('#e').innerHTML = `<div class="err">${esc(err.message)}</div>`; } };
}
async function invitePage(root, { token }) {
  let inv; try { inv = await api('GET', '/auth/invite/' + token); } catch (e) { root.innerHTML = authWrap(`<h1>Invitation</h1><div class="err">${esc(e.message)}</div><a href="#/login">Go to sign in</a>`); return; }
  root.innerHTML = authWrap(`<h1>Join ${esc(inv.org_name)}</h1><p class="muted">You've been invited as <b>${esc(inv.role)}</b> (${esc(inv.email)}). Choose a password to activate your account.</p><div id="e"></div>
    <form id="f">${fld('Your name', inp('name', inv.name || '', 'required'))}${fld('Password', inp('password', '', 'type="password" minlength="8" required autocomplete="new-password"'), 'At least 8 characters')}<button class="btn primary" style="width:100%;justify-content:center">Activate account</button></form>`);
  $('#f').onsubmit = async (e) => { e.preventDefault(); try { const r = await api('POST', '/auth/accept-invite', { token, name: $('[name=name]').value, password: $('[name=password]').value }); toast('Account created — sign in now', 'ok'); go(`#/login?email=${encodeURIComponent(r.email)}`); } catch (err) { $('#e').innerHTML = `<div class="err">${esc(err.message)}</div>`; } };
}

async function bootstrap() {
  const me = await get('/auth/me'); S.user = me.user; S.org = me.org; S.settings = me.settings; await loadMeta(); shellMounted = false;
}
(async function boot() {
  if (S.token) { try { await bootstrap(); } catch { S.token = ''; localStorage.removeItem('rp_token'); S.user = null; } }
  route();
})();
