import { api, currentUserId, setCurrentUserId } from './api.js';
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
  { id: 'settings', label: 'Settings', icon: '⚙️', group: 'Insights', title: 'Settings', sub: 'Budgets, recurring payments and categories', view: settingsView },
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
  const u = app.data.user;
  $('#user-name').textContent = u?.name || '—';
  $('#user-vpa').textContent = u?.vpa || 'no UPI ID';
  $('#user-avatar').textContent = initials(u?.name);
}

async function boot() {
  try {
    app.data = await api.bootstrap();
  } catch (err) {
    $('#view').append(h('div', { class: 'card' }, h('h3', { text: 'Could not reach the server' }), h('p', { class: 'muted', text: err.message })));
    return;
  }
  setCurrentUserId(app.data.user.id);
  buildNav();
  renderUser();

  const sel = clear($('#user-switch'));
  sel.append(h('option', { value: '', text: 'Switch user…' }));
  for (const u of app.data.users) sel.append(h('option', { value: u.id, text: u.name }));
  sel.addEventListener('change', async () => {
    if (!sel.value) return;
    setCurrentUserId(sel.value);
    app.data = await api.bootstrap();
    renderUser();
    toast(`Viewing as ${app.data.user.name}`);
    render(location.hash.slice(1) || 'dashboard');
  });

  window.addEventListener('hashchange', () => { pendingParams = {}; render(location.hash.slice(1) || 'dashboard'); });
  render(location.hash.slice(1) || 'dashboard');
}

export async function refreshShell() {
  app.data = await api.bootstrap();
  renderUser();
}

boot();
