import { api, getToken, setToken, setUnauthorizedHandler, setCurrentUser, currentUser } from './api.js';
import { $, clear, h, initials, toast } from './ui.js';

import { dashboardView } from './views/dashboard.js';
import { expensesView } from './views/expenses.js';
import { scanView } from './views/scan.js';
import { groupsView } from './views/groups.js';
import { occasionsView } from './views/occasions.js';
import { analyticsView } from './views/analytics.js';
import { importView } from './views/import.js';
import { statementView } from './views/statement.js';
import { settingsView } from './views/settings.js';
import { authView } from './views/auth.js';
import { billingView } from './views/billing.js';

export const app = { data: null };

const ROUTES = [
  { id: 'dashboard', label: 'Dashboard', icon: '📊', group: 'Money', title: 'Dashboard', sub: 'Your money at a glance', view: dashboardView },
  { id: 'expenses', label: 'Expenses', icon: '💳', group: 'Money', title: 'Expenses', sub: 'Every transaction, searchable and editable', view: expensesView },
  { id: 'scan', label: 'Scan & Pay', icon: '📷', group: 'Money', title: 'Scan & Pay', sub: 'Scan any UPI QR — merchant, personal or Bharat QR', view: scanView },
  { id: 'groups', label: 'Groups & Splits', icon: '👥', group: 'Together', title: 'Groups & Splits', sub: 'Split bills, track who owes whom, settle up', view: groupsView },
  { id: 'occasions', label: 'Occasions', icon: '🎉', group: 'Together', title: 'Occasions & Planning', sub: 'Budget festivals, trips and events', view: occasionsView },
  { id: 'analytics', label: 'Analytics', icon: '📈', group: 'Insights', title: 'Analytics', sub: 'Where your money actually goes', view: analyticsView },
  { id: 'import', label: 'Import', icon: '📥', group: 'Insights', title: 'Import transactions', sub: 'Turn bank SMS and CSV statements into expenses', view: importView },
  { id: 'statement', label: 'Statement (PDF)', icon: '🧾', group: 'Insights', title: 'Statement generator', sub: 'Export a full PDF statement with charts and insights', view: statementView },
  { id: 'billing', label: 'Plan & Billing', icon: '⭐', group: 'Account', title: 'Plan & Billing', sub: 'Manage your subscription and usage', view: billingView },
  { id: 'settings', label: 'Settings', icon: '⚙️', group: 'Account', title: 'Settings', sub: 'Budgets, recurring payments and categories', view: settingsView },
];

export function navigate(id, params = {}) {
  if (location.hash.slice(1) !== id) {
    location.hash = id;
    pendingParams = params;
    return;
  }
  render(id, params);
}

let pendingParams = {};
let cleanup = null;

function render(id, params) {
  const route = ROUTES.find((r) => r.id === id) || ROUTES[0];
  $('#page-title').textContent = route.title;
  $('#page-sub').textContent = route.sub;
  clear($('#page-actions'));

  document.querySelectorAll('.nav-item').forEach((el) => el.classList.toggle('active', el.dataset.id === route.id));

  cleanup?.();
  cleanup = null;

  const view = $('#view');
  clear(view);
  const out = route.view({ actions: $('#page-actions'), params: { ...pendingParams, ...params } });
  if (out) view.append(out);
  if (typeof out?.cleanup === 'function') cleanup = out.cleanup;
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
}

function buildNav() {
  const nav = clear($('#nav'));
  let lastGroup = null;
  for (const r of ROUTES) {
    if (r.group !== lastGroup) {
      nav.append(h('div', { class: 'nav-group', text: r.group }));
      lastGroup = r.group;
    }
    nav.append(h('button', { class: 'nav-item', dataset: { id: r.id }, onclick: () => navigate(r.id) },
      h('span', { class: 'ico', text: r.icon }),
      h('span', { text: r.label }),
    ));
  }
}

function renderUser() {
  const u = app.data?.user;
  $('#user-name').textContent = u?.name || '—';
  const plan = u?.plan === 'pro' ? '⭐ Pro' : 'Free plan';
  $('#user-vpa').textContent = u?.vpa ? `${u.vpa} · ${plan}` : plan;
  $('#user-avatar').textContent = initials(u?.name);
}

/** Shows the sign-in screen and hides the app shell. */
function showAuth() {
  setCurrentUser(null);
  $('#app-shell').style.display = 'none';
  const host = clear($('#auth-root'));
  host.style.display = 'flex';
  host.append(authView({ onAuthed: onAuthed, demoAvailable: true }));
}

function onAuthed(user) {
  setCurrentUser(user);
  $('#auth-root').style.display = 'none';
  $('#auth-root').replaceChildren();
  $('#app-shell').style.display = '';
  boot();
}

export async function logout() {
  try { await api.logout(); } catch { /* already gone */ }
  setToken(null);
  showAuth();
}

async function boot() {
  if (!getToken()) return showAuth();
  try {
    app.data = await api.bootstrap();
  } catch (err) {
    if (err.status === 401) return showAuth();
    $('#view').replaceChildren(h('div', { class: 'card' },
      h('h3', { text: 'Could not reach the server' }),
      h('p', { class: 'muted', text: err.message }),
      h('button', { class: 'btn', text: 'Retry', onclick: () => boot() }),
    ));
    return;
  }
  setCurrentUser(app.data.user);
  buildNav();
  renderUser();
  wireAccountMenu();
  window.addEventListener('hashchange', () => { pendingParams = {}; render(location.hash.slice(1) || 'dashboard'); });
  render(location.hash.slice(1) || 'dashboard');
}

function wireAccountMenu() {
  const btn = $('#account-btn');
  if (!btn || btn.dataset.wired) return;
  btn.dataset.wired = '1';
  btn.addEventListener('click', () => {
    const menu = clear($('#account-menu'));
    menu.replaceChildren(
      h('div', { class: 'menu-item muted tiny', text: app.data?.user?.email || '' }),
      h('button', { class: 'menu-item', text: '⭐ Plan & billing', onclick: () => { close(); navigate('billing'); } }),
      h('button', { class: 'menu-item', text: '⚙️ Settings', onclick: () => { close(); navigate('settings'); } }),
      h('button', { class: 'menu-item danger', text: '↩︎ Sign out', onclick: () => { close(); logout(); } }),
    );
    menu.classList.toggle('open');
    function close() { menu.classList.remove('open'); }
    setTimeout(() => document.addEventListener('click', function onDoc(e) {
      if (!menu.contains(e.target) && e.target !== btn) { close(); document.removeEventListener('click', onDoc); }
    }), 0);
  });
}

export async function refreshShell() {
  app.data = await api.bootstrap();
  setCurrentUser(app.data.user);
  renderUser();
}

setUnauthorizedHandler(showAuth);
boot();
void currentUser;
