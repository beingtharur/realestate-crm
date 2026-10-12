// App shell: grouped collapsible navigation, command palette (global search), router, sign-in pages, notifications, preferences.
import { S, $, $$, esc, api, get, post, patch, loadMeta, toast, modal, modalForm, fld, inp, on, debounce, rel, fmtDT, isAdmin, initials, empty, errorState, skeleton, badge, copy, fullLink, phoneFmt, snack, reload,
  labelTables, ico, initUi, store, rememberLead, getTheme, setTheme, getDensity, setDensity, applyDensity, openMenu, stageBadge, statusChip, avatar, orgMark, logoPicker, wireLogoPicker, nav as navTo } from './core.js';
import * as dashboard from './v_dashboard.js';
import * as leads from './v_leads.js';
import * as inventory from './v_inventory.js';
import * as bookings from './v_bookings.js';
import * as work from './v_work.js';
import * as team from './v_team.js';
import * as adminv from './v_admin.js';
import * as pub from './v_public.js';
import { prefsModal } from './v_prefs.js';

// ---------- navigation: grouped, role-aware ----------
const NAV = [
  { sec: 'Workspace' },
  { to: '/dashboard', icon: 'home', t: 'Dashboard' },
  { to: '/leads', icon: 'users', t: 'Leads', children: [
    { to: '/leads', t: 'All leads', exact: true }, { to: '/leads?stage=New', t: 'New leads' }, { to: '/tasks', t: 'Follow-ups', id: 'tasks' },
    { to: '/leads?tab=unassigned', t: 'Unassigned', admin: true }, { to: '/leads?tab=flagged', t: 'Suspicious', admin: true }] },
  { to: '/inventory', icon: 'map', t: 'Projects & plots' },
  { to: '/bookings', icon: 'file', t: 'Bookings' },
  { sec: 'Activity' },
  { to: '/visits', icon: 'truck', t: 'Site visits' },
  { to: '/comms', icon: 'phone', t: 'Calls & WhatsApp' },
  { to: '/attendance', icon: 'clock', t: 'Attendance', repT: 'Clock-in' },
  { sec: 'Finance', admin: true },
  { to: '/collections', icon: 'rupee', t: 'Collections', admin: true },
  { to: '/discounts', icon: 'tag', t: 'Discounts', admin: true },
  { sec: 'Team', admin: true },
  { to: '/router', icon: 'shuffle', t: 'Lead router', admin: true },
  { to: '/team', icon: 'briefcase', t: 'Team & targets', admin: true },
  { to: '/partners', icon: 'share', t: 'Partners', admin: true },
  { sec: 'Insights', admin: true },
  { to: '/reports', icon: 'chart', t: 'Reports', admin: true },
  { to: '/ai', icon: 'zap', t: 'RealPilot AI', admin: true },
];
const FOOT_NAV = [{ to: '/settings', icon: 'settings', t: 'Settings', admin: true }];
// [pattern, view fn, {public, admin, skel}]
const ROUTES = [
  ['/login', login, { public: true }], ['/setup', setup, { public: true }], ['/forgot', forgot, { public: true }],
  ['/reset/:token', resetPage, { public: true }], ['/invite/:token', invitePage, { public: true }],
  ['/portal/:token', pub.portal, { public: true }], ['/enquire/:code', pub.enquire, { public: true }],
  ['/dashboard', dashboard.render, { skel: 'dashboard' }], ['/leads', leads.list, { skel: 'list' }], ['/leads/:id', leads.detail, { skel: 'detail' }],
  ['/inventory', inventory.projects, { skel: 'cards' }], ['/inventory/:id', inventory.project, { skel: 'detail' }],
  ['/bookings', bookings.list, { skel: 'list' }], ['/bookings/:id', bookings.detail, { skel: 'detail' }], ['/collections', bookings.collections, { admin: true, skel: 'list' }], ['/discounts', bookings.discounts, { admin: true, skel: 'list' }],
  ['/tasks', work.tasks, { skel: 'list' }], ['/visits', work.visits, { skel: 'list' }], ['/comms', work.comms, { skel: 'list' }], ['/router', work.router, { admin: true, skel: 'list' }],
  ['/team', team.team, { admin: true, skel: 'cards' }], ['/attendance', team.attendance, { skel: 'list' }], ['/partners', team.partners, { admin: true, skel: 'list' }],
  ['/reports', adminv.reports, { admin: true, skel: 'dashboard' }], ['/ai', adminv.ai, { admin: true }], ['/settings', adminv.settings, { admin: true, skel: 'list' }],
];
const compiled = ROUTES.map(([p, fn, o = {}]) => { const keys = []; const re = new RegExp('^' + p.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$'); return { re, keys, fn, o, p }; });
let cleanup = null, pollers = [], shellMounted = false;

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
  if (!hit) { if (S.user) { renderShell(path); $('#view').innerHTML = empty('Page not found', "That page doesn't exist or has moved.", '<a class="btn primary" href="#/dashboard">Go to dashboard</a>', 'search'); } else go('#/login'); return; }
  const params = {}; hit.r.keys.forEach((k, i) => (params[k] = decodeURIComponent(hit.m[i + 1])));
  if (!hit.r.o.public && !S.user) return go('#/login');
  if (hit.r.o.public && S.user && ['/login', '/setup', '/forgot'].includes(path)) return go('#/dashboard');
  if (hit.r.o.admin && !isAdmin()) { toast('That page is not available for your account', 'err'); return go('#/dashboard'); }
  if (hit.r.o.public) { $('#root').innerHTML = ''; shellMounted = false; document.querySelector('.bottomnav')?.remove(); cleanup = (await hit.r.fn($('#root'), params, query)) || null; return; }
  renderShell(path, query);
  const oldView = $('#view'); const view = oldView.cloneNode(false); oldView.replaceWith(view); // fresh element = no stale listeners
  view.innerHTML = skeleton(hit.r.o.skel || 'list');
  new MutationObserver(() => labelTables(view)).observe(view, { childList: true, subtree: true }); // tables become cards on phones
  $('.side').classList.remove('open'); document.body.classList.remove('nav-open');
  try { cleanup = (await hit.r.fn(view, params, query)) || null; }
  catch (e) {
    console.error(e);
    view.innerHTML = errorState(e.network ? "We can't reach the server." : 'Something went wrong while loading this page.');
    on(view, 'click', '[data-retry]', () => route());
  }
  window.scrollTo(0, 0);
  refreshTaskBadge();
}
window.addEventListener('hashchange', route);

// ---------- shell ----------
const navLabel = (n) => (!isAdmin() && n.repT) || n.t;
function isActive(to, path, query, exact) {
  const [p, qs] = to.split('?'); if (p !== path && !(p !== '/' && path.startsWith(p + '/') && !qs)) return false;
  const want = Object.fromEntries(new URLSearchParams(qs || ''));
  if (Object.keys(want).length) return Object.entries(want).every(([k, v]) => query[k] === v);
  return exact ? !query.stage && !query.tab : true;
}
const openGroups = () => { try { return JSON.parse(store.get('rp_navopen') || '{}'); } catch { return {}; } };
function navHtml(path, query) {
  const admin = isAdmin(), open = openGroups();
  let sec = null, html = '';
  for (const n of NAV) {
    if (n.admin && !admin) continue;
    if (n.sec) { html += `<div class="sep">${n.sec}</div>`; continue; }
    const kids = (n.children || []).filter((c) => !c.admin || admin);
    const childOn = kids.some((c) => isActive(c.to, path, query, c.exact));
    const on_ = isActive(n.to, path, query, true) || childOn;
    if (kids.length) {
      const isOpen = open[n.to] ?? true;
      html += `<div class="grp ${isOpen || childOn ? 'open' : ''}" data-grp="${n.to}"><button type="button" class="navbtn ${on_ ? 'on' : ''}" data-ntip="${esc(n.t)}" aria-expanded="${isOpen}" data-go="${n.to}">${ico(n.icon)}<span class="lbl">${esc(n.t)}</span><span class="ct hidden" id="ct-tasks-p"></span><span class="caret" data-caret>${ico('chevRight', 'sm')}</span></button>
        <div class="sub">${kids.map((c) => `<a href="#${c.to}" class="${isActive(c.to, path, query, c.exact) ? 'on' : ''}" data-to="${c.to}">${esc(c.t)}${c.id ? `<span class="ct hidden" id="ct-${c.id}"></span>` : ''}</a>`).join('')}</div></div>`;
    } else html += `<a href="#${n.to}" class="${on_ ? 'on' : ''}" data-to="${n.to}" data-ntip="${esc(navLabel(n))}">${ico(n.icon)}<span class="lbl">${esc(navLabel(n))}</span></a>`;
  }
  return html;
}
function bottomNavHtml() {
  const items = isAdmin() ? [['/dashboard', 'home', 'Home'], ['/leads', 'users', 'Leads'], ['/tasks', 'checkCircle', 'Follow-ups'], ['/bookings', 'file', 'Bookings']] : [['/dashboard', 'home', 'Home'], ['/leads', 'users', 'Leads'], ['/tasks', 'checkCircle', 'Follow-ups'], ['/visits', 'truck', 'Visits']];
  return items.map(([to, ic, t]) => `<a href="#${to}" data-to="${to}">${ico(ic)}${t}${to === '/tasks' ? '<span class="dot hidden" id="ct-tasks2">0</span>' : ''}</a>`).join('') + `<button type="button" id="bn-more">${ico('menu')}More</button>`;
}
function renderShell(path = parseHash().path, query = parseHash().query) {
  if (!shellMounted) {
    $('#root').innerHTML = `<div class="app"><aside class="side" id="side"><div class="brand">${orgMark(S.org)}<div class="brand-t"><div>${esc(S.org.name)}</div><small>${esc(S.org.city || 'RealtyPilot')}</small></div></div>
      <nav class="nav" aria-label="Main" id="mainnav"></nav><div class="side-foot">${FOOT_NAV.filter((n) => !n.admin || isAdmin()).map((n) => `<a class="navbtn" href="#${n.to}" data-to="${n.to}" data-ntip="${n.t}" style="display:flex;align-items:center;gap:10px;height:var(--h-ctl);padding:0 var(--s3);border-radius:var(--r-md);color:var(--text-2);font-weight:500">${ico(n.icon)}<span class="lbl">${n.t}</span></a>`).join('')}
        <button type="button" class="navbtn" id="collapse" data-ntip="Collapse menu">${ico('panel')}<span class="lbl">Collapse menu</span></button></div></aside>
      <div class="main"><header class="top">
        <button class="searchbtn" id="gs" aria-label="Search">${ico('search')}<span class="long">Search leads, phone numbers, projects…</span><span class="short">Search</span><kbd>/</kbd></button><div class="grow"></div>
        <button class="btn sm d-only" id="qadd" aria-haspopup="menu">${ico('plus', 'sm')}New${ico('chevDown', 'sm')}</button>
        <div style="position:relative"><button class="icon-btn" id="bell" aria-label="Notifications" data-tip="Notifications">${ico('bell')}<span class="dot hidden" id="bellct">0</span></button><div class="pop hidden" id="notifs" role="dialog" aria-label="Notifications"></div></div>
        <div style="position:relative"><button class="icon-btn" id="me" aria-label="Account menu" aria-haspopup="menu">${avatar(S.user.name)}</button><div class="menu hidden" id="menu" role="menu"></div></div>
      </header><main id="view" tabindex="-1"></main></div></div>`;
    shellMounted = true;
    document.querySelector('.bottomnav')?.remove();
    const nv = document.createElement('nav'); nv.className = 'bottomnav'; nv.setAttribute('aria-label', 'Quick navigation'); nv.innerHTML = bottomNavHtml(); document.body.appendChild(nv);
    document.body.classList.toggle('rep', !isAdmin());
    wireShell();
  }
  document.body.classList.toggle('nav-collapsed', store.get('rp_nav') === 'collapsed');
  $('#mainnav').innerHTML = navHtml(path, query);
  $$('.bottomnav a').forEach((a) => a.classList.toggle('on', path === a.dataset.to || path.startsWith(a.dataset.to + '/')));
  $$('.side-foot a').forEach((a) => a.classList.toggle('on', path === a.dataset.to));
  const cur = NAV.find((n) => n.to && (path === n.to || path.startsWith(n.to + '/'))) || FOOT_NAV.find((n) => path === n.to) || NAV.flatMap((n) => n.children || []).find((c) => c.to.split('?')[0] === path);
  const kid = NAV.flatMap((n) => n.children || []).find((c) => isActive(c.to, path, query, c.exact) && c.to !== '/leads');
  const title = kid && path === '/leads' ? kid.t : cur ? navLabel(cur) : 'RealtyPilot';
  document.title = `${title} · RealtyPilot`;
  refreshTaskBadge(true);
}
function wireShell() {
  const side = $('#side');
  $('#bn-more').onclick = () => side.classList.toggle('open');
  document.addEventListener('click', (e) => { if (side.classList.contains('open') && !e.target.closest('.side, #bn-more')) side.classList.remove('open'); });
  $('#collapse').onclick = () => { const c = !document.body.classList.contains('nav-collapsed'); store.set('rp_nav', c ? 'collapsed' : 'open'); document.body.classList.toggle('nav-collapsed', c); };
  on($('#mainnav'), 'click', '[data-go]', (el, e) => {
    const g = el.closest('.grp'), caret = e.target.closest('[data-caret]'), collapsed = document.body.classList.contains('nav-collapsed') && innerWidth > 900;
    if (caret && !collapsed) { // the arrow only opens/closes the group; the label opens the page
      const willOpen = !g.classList.contains('open'); g.classList.toggle('open', willOpen); el.setAttribute('aria-expanded', willOpen);
      const open = openGroups(); open[g.dataset.grp] = willOpen; store.set('rp_navopen', JSON.stringify(open)); return;
    }
    go('#' + el.dataset.go);
  });
  // top bar
  $('#gs').onclick = openPalette;
  $('#qadd').onclick = (e) => openMenu(e.currentTarget, quickAddItems());
  $('#me').onclick = (e) => { e.stopPropagation(); renderAccountMenu(); $('#menu').classList.toggle('hidden'); $('#notifs').classList.add('hidden'); };
  $('#bell').onclick = async (e) => { e.stopPropagation(); const p = $('#notifs'); p.classList.toggle('hidden'); $('#menu').classList.add('hidden'); if (!p.classList.contains('hidden')) await loadNotifs(true); };
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#notifs') && !e.target.closest('#bell')) $('#notifs')?.classList.add('hidden');
    if (!e.target.closest('#menu') && !e.target.closest('#me')) $('#menu')?.classList.add('hidden');
  });
  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
    if ((e.key === '/' && !typing && !e.ctrlKey && !e.metaKey) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k')) { e.preventDefault(); openPalette(); }
  });
  pollers.forEach(clearInterval);
  pollers = [setInterval(() => loadNotifs(false), 30000), setInterval(() => post('/heartbeat').catch(() => {}), 60000)];
  loadNotifs(false);
}
const quickAddItems = () => [
  { icon: 'userPlus', label: 'Add lead', action: () => leads.leadForm(null, () => reload()) },
  { icon: 'checkCircle', label: 'New follow-up', action: () => leads.taskModal(null, () => reload()) },
  { icon: 'file', label: 'New booking', action: () => bookings.bookingWizard({ onDone: () => reload() }) },
];
function renderAccountMenu() {
  const m = $('#menu'), th = getTheme(), dn = getDensity();
  m.innerHTML = `<div style="padding:10px var(--s3);display:flex;gap:10px;align-items:center">${avatar(S.user.name, 'lg')}<div style="min-width:0"><b>${esc(S.user.name)}</b><div class="muted small" style="overflow:hidden;text-overflow:ellipsis">${esc(S.user.email)}</div><div class="small">${badge(isAdmin() ? 'Admin' : 'Representative', 'b-brand')}</div></div></div><hr>
    <div class="mh">Appearance</div><div style="padding:2px var(--s3) 6px"><div class="seg mini" id="seg-theme" style="width:100%">${[['system', 'Auto'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) => `<button data-th="${v}" class="${th === v ? 'on' : ''}" style="flex:1">${l}</button>`).join('')}</div></div>
    <div class="mh">Density</div><div style="padding:2px var(--s3) 8px"><div class="seg mini" id="seg-den" style="width:100%">${[['comfortable', 'Comfortable'], ['compact', 'Compact']].map(([v, l]) => `<button data-dn="${v}" class="${dn === v ? 'on' : ''}" style="flex:1">${l}</button>`).join('')}</div></div><hr>
    <button data-m="profile">${ico('user')}My profile & password</button><button data-m="prefs">${ico('bell')}Notifications & availability${S.user.availability && S.user.availability !== 'available' ? `<span class="chip sm amber" style="margin-left:auto">${S.user.availability === 'on_leave' ? 'On leave' : 'Off duty'}</span>` : ''}</button>${isAdmin() ? `<button data-m="enquiry">${ico('link')}Public enquiry form link</button>` : ''}<button data-m="out" class="danger">${ico('logOut')}Sign out</button>`;
  m.onclick = async (e) => {
    const th2 = e.target.closest('[data-th]'), dn2 = e.target.closest('[data-dn]'), b = e.target.closest('[data-m]');
    if (th2) { setTheme(th2.dataset.th); renderAccountMenu(); return; }
    if (dn2) { setDensity(dn2.dataset.dn); renderAccountMenu(); return; }
    if (!b) return; m.classList.add('hidden');
    const a = b.dataset.m;
    if (a === 'out') { try { await post('/auth/logout'); } catch { /* ignore */ } store.set('rp_token', null); S.token = ''; S.user = null; shellMounted = false; document.querySelector('.bottomnav')?.remove(); document.body.classList.remove('rep'); pollers.forEach(clearInterval); pollers = []; location.hash = '#/login'; route(); }
    if (a === 'profile') profileModal();
    if (a === 'prefs') prefsModal();
    if (a === 'enquiry') { const l = fullLink(`#/enquire/${S.org.code}`); modal({ title: 'Public enquiry form', body: `<p>Share or embed this page on your website, Facebook page bio or QR code. Every submission becomes a lead (with duplicate & spam checks).</p><p><code>${esc(l)}</code></p>`, footer: `<button class="btn primary" id="cp">${ico('copy', 'sm')}Copy link</button>`, onOpen: (el2) => $('#cp', el2).onclick = () => copy(l) }); }
  };
}

// ---------- command palette: one search for everything ----------
function openPalette() {
  if ($('.cmd-wrap')) return;
  const wrap = document.createElement('div'); wrap.className = 'cmd-wrap';
  wrap.innerHTML = `<div class="cmd" role="dialog" aria-modal="true" aria-label="Search"><div class="cmd-in">${ico('search')}<input id="cq" type="search" placeholder="Search leads, phone numbers, projects, notes…" autocomplete="off" data-native aria-label="Search"><kbd>Esc</kbd></div><div class="cmd-list" id="cl" role="listbox"></div>
    <div class="cmd-foot"><span><span class="kbd">↑</span> <span class="kbd">↓</span> to move</span><span><span class="kbd">Enter</span> to open</span><span><span class="kbd">Esc</span> to close</span></div></div>`;
  document.body.appendChild(wrap);
  const q = $('#cq', wrap), list = $('#cl', wrap); let items = [], act = 0, seq = 0;
  const close = () => { wrap.remove(); document.removeEventListener('keydown', onKey, true); };
  const run = (it) => { close(); it.run ? it.run() : go(it.href); };
  const paint = (groups) => {
    items = []; let k = 0;
    list.innerHTML = groups.filter((g) => g.rows.length).map((g) => `<div class="cmd-h">${esc(g.h)}</div>` + g.rows.map((r) => { items.push(r); return `<div class="cmd-i ${k === act ? 'act' : ''}" role="option" data-k="${k++}"><span class="ci">${ico(r.icon)}</span><span class="t"><b>${esc(r.title)}</b><span>${esc(r.sub || '')}</span></span>${r.chip || ''}</div>`; }).join('')).join('') || `<div class="empty" style="padding:var(--s6)"><div class="empty-ic">${ico('search', 'lg')}</div><b>No results</b><p>Try a name, a phone number or a plot number.</p></div>`;
    $('.act', list)?.scrollIntoView({ block: 'nearest' });
  };
  const pages = () => NAV.filter((n) => n.to && (!n.admin || isAdmin())).map((n) => ({ icon: n.icon, title: navLabel(n), sub: 'Go to page', href: n.to }));
  const home = () => {
    const recent = (() => { try { return JSON.parse(store.get('rp_recent_leads') || '[]'); } catch { return []; } })();
    paint([{ h: 'Quick actions', rows: quickAddItems().map((a) => ({ icon: a.icon, title: a.label, sub: 'Create', run: a.action })) },
      { h: 'Recently viewed', rows: recent.map((l) => ({ icon: 'user', title: l.name, sub: phoneFmt(l.phone), href: `#/leads/${l.id}`, chip: l.stage ? stageBadge(l.stage) : '' })) },
      { h: 'Go to', rows: pages().slice(0, 6).map((p) => ({ ...p, href: '#' + p.href })) }]);
  };
  const search = debounce(async () => {
    const term = q.value.trim(); if (term.length < 2) return home();
    const my = ++seq; let r; try { r = await get('/search?q=' + encodeURIComponent(term)); } catch { return; } if (my !== seq) return;
    const lc = term.toLowerCase();
    act = 0;
    paint([
      { h: 'Leads', rows: r.leads.map((l) => ({ icon: 'user', title: l.name, sub: `${phoneFmt(l.phone_norm)}${l.rep_name ? ' · ' + l.rep_name : ''}`, href: `#/leads/${l.id}`, chip: stageBadge(l.stage) })) },
      { h: 'Bookings', rows: r.bookings.map((b) => ({ icon: 'file', title: b.booking_no, sub: b.buyer_name, href: `#/bookings/${b.id}` })) },
      { h: 'Projects', rows: (r.projects || []).map((p) => ({ icon: 'map', title: p.name, sub: [p.location, p.city].filter(Boolean).join(', ') || 'Project', href: `#/inventory/${p.id}` })) },
      { h: 'Plots', rows: r.plots.map((p) => ({ icon: 'layers', title: `Plot ${p.plot_no}`, sub: p.project_name, href: `#/inventory/${p.project_id}?plot=${p.id}`, chip: statusChip('plot', p.status) })) },
      { h: 'Activities', rows: (r.activities || []).map((a) => ({ icon: a.type === 'call' ? 'phone' : a.type === 'whatsapp' ? 'message' : 'edit', title: a.lead_name, sub: (a.content || '').slice(0, 90), href: `#/leads/${a.lead_id}` })) },
      { h: 'Pages', rows: pages().filter((p) => p.title.toLowerCase().includes(lc)).map((p) => ({ ...p, href: '#' + p.href })) },
    ]);
  }, 140);
  const onKey = (e) => {
    if (!wrap.isConnected) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); act = Math.min(items.length - 1, act + 1); paintAct(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); act = Math.max(0, act - 1); paintAct(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (items[act]) run(items[act]); }
  };
  const paintAct = () => { $$('.cmd-i', list).forEach((el, i) => el.classList.toggle('act', i === act)); $('.act', list)?.scrollIntoView({ block: 'nearest' }); };
  document.addEventListener('keydown', onKey, true);
  q.addEventListener('input', search);
  list.addEventListener('click', (e) => { const el = e.target.closest('.cmd-i'); if (el) run(items[Number(el.dataset.k)]); });
  list.addEventListener('mousemove', (e) => { const el = e.target.closest('.cmd-i'); if (el && Number(el.dataset.k) !== act) { act = Number(el.dataset.k); paintAct(); } });
  wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(); });
  home(); q.focus();
}

// ---------- notifications ----------
async function loadNotifs(render) {
  if (!S.user) return;
  let d; try { d = await get('/notifications'); } catch { return; }
  const c = $('#bellct'); if (!c) return;
  c.textContent = d.unread > 99 ? '99+' : d.unread; c.classList.toggle('hidden', !d.unread);
  if (!render && $('#notifs').classList.contains('hidden')) return;
  const p = $('#notifs');
  p.innerHTML = `<div class="ph"><b>Notifications</b><button class="btn ghost sm" id="mar">${ico('check', 'sm')}Mark all read</button></div>` + (d.items.length ? d.items.map((n) => `<div class="nitem ${n.read_at ? '' : 'unread'}" data-id="${n.id}" data-link="${esc(n.link)}" role="button" tabindex="0"><div style="flex:1;min-width:0"><b>${esc(n.title)}</b><div class="small">${esc(n.message)}</div><div class="muted small">${rel(n.created_at)}</div></div><button class="del" data-del="${n.id}" aria-label="Delete notification" data-tip="Delete">${ico('trash', 'sm')}</button></div>`).join('') : empty('You are all caught up', 'New assignments, follow-up reminders and approvals will appear here.', '', 'bell'));
  const mar = $('#mar', p); if (mar) mar.onclick = async () => { await post('/notifications/read-all'); loadNotifs(true); };
  $$('.nitem', p).forEach((it) => it.addEventListener('click', async (e) => {
    if (e.target.closest('[data-del]')) { e.stopPropagation(); await api('DELETE', '/notifications/' + e.target.closest('[data-del]').dataset.del); return loadNotifs(true); }
    await post(`/notifications/${it.dataset.id}/read`); p.classList.add('hidden'); loadNotifs(false);
    if (it.dataset.link) go(it.dataset.link);
  }));
}
async function refreshTaskBadge(quiet) {
  try {
    const d = await get('/tasks'); const n = d.counts.overdue;
    ['#ct-tasks', '#ct-tasks-p', '#ct-tasks2'].forEach((id) => { const el = $(id); if (el) { el.textContent = n; el.classList.toggle('hidden', !n); } });
  } catch { /* ignore */ }
}
async function profileModal() {
  const p = await get(`/team/${S.user.id}/profile`);
  const m = modal({ title: 'My profile', wide: true, body: `<div class="grid g2 stack"><div><div class="row" style="margin-bottom:var(--s3)">${avatar(p.user.name, 'lg')}<div><b>${esc(p.user.name)}</b><div class="muted small">${esc(p.user.email)}</div></div></div><dl class="kv"><dt>Role</dt><dd>${esc(p.user.role === 'admin' ? 'Admin' : 'Representative')}</dd><dt>Phone</dt><dd>${esc(phoneFmt(p.user.phone)) || '—'}</dd></dl>
      <div class="fsec" style="margin-top:var(--s5)">Change password</div><div class="form-err"></div>${fld('Current password', inp('cur', '', 'type="password" autocomplete="current-password"'))}${fld('New password', inp('new', '', 'type="password" autocomplete="new-password"'), 'At least 8 characters')}<button class="btn primary" id="cpw">Change password</button></div>
      <div><div class="fsec">Phone app — automatic call logging</div>${S.companion ? `<div class="ok-box">${ico('checkCircle', 'sm')}<span>Linked: <b>${esc(S.companion.device.replace('Phone app · ', ''))}</b> · last sync ${rel(S.companion.last_seen)}.<br><span class="small">Calls you make to your leads are added to their timeline with the real duration.</span></span></div>` : `<div class="info-box">${ico('info', 'sm')}<span>Not linked yet. Install the <b>RealtyPilot Companion</b> app on your Android phone and sign in with this email and password.<br><span class="small">Server address to enter in the app: <code>${esc(location.origin)}</code></span></span></div>`}
      <div class="fsec">Recent sessions</div>${p.sessions.map((s) => `<div class="list-row"><div><b>${esc(s.device)}</b><div class="muted small">${fmtDT(s.created_at)}</div></div>${s.online ? statusChip('health', 'Active', 'Online') : `<span class="muted small">${rel(s.last_seen)}</span>`}</div>`).join('') || empty('No sessions')}</div></div>` });
  $('#cpw', m.el).onclick = async () => {
    const err = $('.form-err', m.el); err.innerHTML = '';
    try { const r = await post('/auth/change-password', { current_password: $('[name=cur]', m.el).value, new_password: $('[name=new]', m.el).value }); toast(r.message, 'ok'); m.close(); }
    catch (e) { err.innerHTML = `<div class="err">${ico('alert', 'sm')}<span>${esc(e.message)}</span></div>`; }
  };
}

// ---------- sign-in / account pages ----------
const authWrap = (inner) => `<div class="auth"><div class="card"><div class="logo"><span class="logo-mark">${ico('home')}</span>RealtyPilot</div>${inner}</div></div>`;
async function login(root, _p, q) {
  document.title = 'Sign in · RealtyPilot';
  // Team members who joined through an invitation (on this browser, or just now) belong to an existing organization — they are never offered "Create your organization".
  let canSignup = true;
  try { canSignup = (await api('GET', '/auth/status')).signup_open; } catch { /* keep the link if the server cannot say */ }
  const invited = q.invited === '1' || store.get('rp_invited') === '1' || !canSignup;
  root.innerHTML = authWrap(`<h1>${q.invited === '1' ? 'Your account is ready' : 'Welcome back'}</h1><p class="muted" style="margin:0 0 var(--s5)">${q.invited === '1' ? 'Sign in with your email and the password you just set.' : 'Sign in to your sales workspace.'}</p><div id="e"></div>
    <form id="f">${fld('Email', inp('email', q.email || '', 'type="email" required autocomplete="username" autofocus placeholder="you@company.com" data-v="email"'))}${fld('Password', inp('password', '', 'type="password" required autocomplete="current-password" placeholder="••••••••"'))}
    <button class="btn primary" style="width:100%;height:var(--h-touch)" id="go">Sign in</button></form>
    <div class="row between mt"><a href="#/forgot">Forgot password?</a>${invited ? '' : '<a href="#/setup">Create your organization</a>'}</div>`);
  $('#f').onsubmit = async (e) => {
    e.preventDefault(); const b = $('#go'); b.classList.add('busy'); $('#e').innerHTML = '';
    try {
      const r = await api('POST', '/auth/login', { email: $('[name=email]').value, password: $('[name=password]').value });
      S.token = r.token; store.set('rp_token', r.token); await bootstrap(); go('#/dashboard');
    } catch (err) { $('#e').innerHTML = `<div class="err" role="alert">${ico('alert', 'sm')}<span>${esc(err.message)}</span></div>`; b.classList.remove('busy'); }
  };
}
async function setup(root) {
  if (store.get('rp_invited') === '1') return go('#/login'); // invited team members cannot start a new organization from here
  root.innerHTML = authWrap(`<h1>Create your organization</h1><p class="muted" style="margin:0 0 var(--s5)">Set up your company and its first admin account.</p><div id="e"></div><form id="f">
    <div class="frm-g">${fld('Organization name <span class="req">*</span>', inp('org_name', '', 'required'), '', 'full')}${fld('Org code <span class="req">*</span>', inp('org_code', '', 'required pattern="[A-Za-z0-9_-]{3,20}" placeholder="e.g. GREEN"'), '3–20 letters or numbers')}${fld('City', inp('city'))}${logoPicker(null)}
    ${fld('Your name <span class="req">*</span>', inp('name', '', 'required'), '', 'full')}${fld('Email <span class="req">*</span>', inp('email', '', 'type="email" required data-v="email"'), '', 'full')}${fld('Password <span class="req">*</span>', inp('password', '', 'type="password" minlength="8" required'), 'At least 8 characters', 'full')}</div>
    <button class="btn primary" style="width:100%;height:var(--h-touch)" id="go">Create organization</button></form><div class="mt"><a href="#/login">${ico('chevLeft', 'sm')}Back to sign in</a></div>`);
  const lp = wireLogoPicker($('#f'), null, $('[name=org_name]'));
  $('#f').onsubmit = async (e) => {
    e.preventDefault(); const b = $('#go'); b.classList.add('busy'); $('#e').innerHTML = '';
    const d = Object.fromEntries([...new FormData(e.target)]); if (lp.value()) d.logo = lp.value();
    try { await api('POST', '/auth/setup', d); toast('Organization created — sign in now', 'ok'); go(`#/login?email=${encodeURIComponent(d.email)}`); }
    catch (err) { $('#e').innerHTML = `<div class="err" role="alert">${ico('alert', 'sm')}<span>${esc(err.message)}</span></div>`; b.classList.remove('busy'); }
  };
}
async function forgot(root) {
  root.innerHTML = authWrap(`<h1>Forgot password</h1><p class="muted" style="margin:0 0 var(--s5)">Enter your email. Your admin will get a request and can send you a secure reset link.</p><div id="e"></div><form id="f">${fld('Email', inp('email', '', 'type="email" required data-v="email"'))}<button class="btn primary" style="width:100%;height:var(--h-touch)">Request reset</button></form><div class="mt"><a href="#/login">${ico('chevLeft', 'sm')}Back to sign in</a></div>`);
  $('#f').onsubmit = async (e) => { e.preventDefault(); try { const r = await api('POST', '/auth/forgot', { email: $('[name=email]').value }); $('#e').innerHTML = `<div class="ok-box">${ico('checkCircle', 'sm')}<span>${esc(r.message)}</span></div>`; } catch (err) { $('#e').innerHTML = `<div class="err">${esc(err.message)}</div>`; } };
}
async function resetPage(root, { token }) {
  root.innerHTML = authWrap(`<h1>Set a new password</h1><div id="e"></div><form id="f">${fld('New password', inp('password', '', 'type="password" minlength="8" required'), 'At least 8 characters')}<button class="btn primary" style="width:100%;height:var(--h-touch)">Update password</button></form>`);
  $('#f').onsubmit = async (e) => { e.preventDefault(); try { await api('POST', '/auth/reset', { token, password: $('[name=password]').value }); toast('Password updated — please sign in', 'ok'); go('#/login'); } catch (err) { $('#e').innerHTML = `<div class="err">${esc(err.message)}</div>`; } };
}
async function invitePage(root, { token }) {
  let inv; try { inv = await api('GET', '/auth/invite/' + token); } catch (e) { root.innerHTML = authWrap(`<h1>Invitation</h1><div class="err">${esc(e.message)}</div><a href="#/login">Go to sign in</a>`); return; }
  root.innerHTML = authWrap(`<h1>Join ${esc(inv.org_name)}</h1><p class="muted" style="margin:0 0 var(--s5)">You've been invited as <b>${esc(inv.role)}</b> (${esc(inv.email)}). Choose a password to activate your account.</p><div id="e"></div>
    <form id="f">${fld('Your name', inp('name', inv.name || '', 'required'))}${fld('Password', inp('password', '', 'type="password" minlength="8" required autocomplete="new-password"'), 'At least 8 characters')}<button class="btn primary" style="width:100%;height:var(--h-touch)">Activate account</button></form>`);
  $('#f').onsubmit = async (e) => { e.preventDefault(); try { const r = await api('POST', '/auth/accept-invite', { token, name: $('[name=name]').value, password: $('[name=password]').value }); store.set('rp_invited', '1'); toast('Account created — sign in now', 'ok'); go(`#/login?email=${encodeURIComponent(r.email)}&invited=1`); } catch (err) { $('#e').innerHTML = `<div class="err">${esc(err.message)}</div>`; } };
}

// ---------- CALL buttons (any <a data-call="leadId" href="tel:…">) ----------
// The link opens the phone dialer as before. We also tell the server, so a linked phone app can report the
// real duration afterwards; without a linked phone the user is offered the manual "Log call" form.
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-call]'); if (!a || !S.user) return;
  const leadId = Number(a.dataset.call), name = a.dataset.callName || 'this lead';
  const onLead = () => location.hash.startsWith('#/leads/' + leadId) && !document.querySelector('.modal-wrap');
  post(`/leads/${leadId}/call-intent`).then((r) => {
    if (!r.tracked) return snack(`Called ${name}? Log how it went.`, 'Log call', () => leads.callModal({ id: leadId, name }, () => onLead() && reload()));
    toast('Calling… the result will appear here when you hang up', 'ok');
    if (onLead()) reload();
    const back = () => { // refresh the timeline a few times once the user returns from the dialer
      if (document.visibilityState !== 'visible') return;
      document.removeEventListener('visibilitychange', back);
      [5000, 15000, 40000].forEach((ms) => setTimeout(() => onLead() && reload(), ms));
    };
    document.addEventListener('visibilitychange', back);
  }).catch(() => {});
});

// ---------- WhatsApp quick button (any <button data-wa="leadId" …>) → the standard WhatsApp message box (templates, logged) ----------
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-wa]'); if (!b || !S.user) return;
  e.preventDefault(); e.stopPropagation();
  const id = Number(b.dataset.wa);
  leads.waModal({ id, name: b.dataset.waName || 'lead', phone_norm: b.dataset.waPhone }, () => location.hash.startsWith('#/leads/' + id) && reload());
}, true);

async function bootstrap() {
  const me = await get('/auth/me'); S.user = me.user; S.org = me.org; S.settings = me.settings; S.companion = me.companion; await loadMeta(); shellMounted = false;
}
(async function boot() {
  applyDensity(); initUi();
  if (S.token) { try { await bootstrap(); } catch { S.token = ''; store.set('rp_token', null); S.user = null; } }
  route();
})();
