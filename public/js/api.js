const state = { user: null };

const TOKEN_KEY = 'whyso_token';

export function getToken() {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
export function setToken(token) {
  try { token ? localStorage.setItem(TOKEN_KEY, token) : localStorage.removeItem(TOKEN_KEY); } catch { /* storage disabled */ }
}

export function currentUser() { return state.user; }
export function setCurrentUser(user) { state.user = user; }

/** Called when the server rejects our session so the shell can show login. */
let onUnauthorized = null;
export function setUnauthorizedHandler(fn) { onUnauthorized = fn; }

async function request(method, path, body, { retry = true } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  const token = getToken();
  if (token) headers.authorization = `Bearer ${token}`;

  const res = await fetch(path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && retry) {
    setToken(null);
    state.user = null;
    onUnauthorized?.();
  }

  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.fields = data?.fields;
    err.upgrade = Boolean(data?.upgrade);
    throw err;
  }
  return data;
}

export const api = {
  // auth
  signup: (b) => request('POST', '/api/auth/signup', b),
  login: (b) => request('POST', '/api/auth/login', b),
  demoLogin: () => request('POST', '/api/auth/demo', {}),
  logout: () => request('POST', '/api/auth/logout', {}),
  me: () => request('GET', '/api/auth/me'),
  updateMe: (b) => request('PATCH', '/api/auth/me', b),
  changePassword: (b) => request('POST', '/api/auth/change-password', b),

  // billing
  billingStatus: () => request('GET', '/api/billing/status'),
  checkout: (b = {}) => request('POST', '/api/billing/checkout', b),
  portal: (b = {}) => request('POST', '/api/billing/portal', b),
  devActivate: (plan) => request('POST', '/api/billing/dev-activate', { plan }),

  bootstrap: () => request('GET', '/api/bootstrap'),
  summary: (q = {}) => request('GET', `/api/analytics/summary${qs(q)}`),
  insights: () => request('GET', '/api/insights'),
  budgetRecommendations: () => request('GET', '/api/analytics/budget-recommendations'),

  expenses: (q = {}) => request('GET', `/api/expenses${qs(q)}`),
  expense: (id) => request('GET', `/api/expenses/${id}`),
  createExpense: (b) => request('POST', '/api/expenses', b),
  updateExpense: (id, b) => request('PUT', `/api/expenses/${id}`, b),
  deleteExpense: (id) => request('DELETE', `/api/expenses/${id}`),

  parseQr: (text) => request('POST', '/api/upi/parse', { text }),
  payLink: (b) => request('POST', '/api/upi/link', b),
  payees: () => request('GET', '/api/upi/payees'),
  scanHistory: () => request('GET', '/api/upi/history'),

  groups: () => request('GET', '/api/groups'),
  group: (id) => request('GET', `/api/groups/${id}`),
  createGroup: (b) => request('POST', '/api/groups', b),
  addMember: (id, b) => request('POST', `/api/groups/${id}/members`, b),
  removeMember: (id, uid) => request('DELETE', `/api/groups/${id}/members/${uid}`),
  settle: (id, b) => request('POST', `/api/groups/${id}/settle`, b),

  occasions: () => request('GET', '/api/occasions'),
  occasion: (id) => request('GET', `/api/occasions/${id}`),
  createOccasion: (b) => request('POST', '/api/occasions', b),
  updateOccasion: (id, b) => request('PUT', `/api/occasions/${id}`, b),
  deleteOccasion: (id) => request('DELETE', `/api/occasions/${id}`),

  budgets: () => request('GET', '/api/budgets'),
  saveBudgets: (items) => request('PUT', '/api/budgets', { items }),
  recurring: () => request('GET', '/api/recurring'),
  createRecurring: (b) => request('POST', '/api/recurring', b),
  deleteRecurring: (id) => request('DELETE', `/api/recurring/${id}`),
  categories: () => request('GET', '/api/categories'),
  createCategory: (b) => request('POST', '/api/categories', b),

  importSms: (b) => request('POST', '/api/import/sms', b),
  importCsv: (b) => request('POST', '/api/import/csv', b),
  seed: () => request('POST', '/api/seed'),
};

function qs(obj) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj || {})) {
    if (v !== undefined && v !== null && v !== '') p.set(k, v);
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** Statement PDFs open in a new tab, so the token rides along as a query param. */
export const statementUrl = (q = {}) => {
  const params = new URLSearchParams(qs(q).replace(/^\?/, ''));
  const token = getToken();
  if (token) params.set('access_token', token);
  return `/api/statement.pdf?${params.toString()}`;
};

export const qrUrl = (q = {}) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== '') p.set(k, v);
  return `/qr.png?${p.toString()}`;
};
