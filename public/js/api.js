const state = { userId: 1 };

export function currentUserId() { return state.userId; }
export function setCurrentUserId(id) { state.userId = Number(id) || 1; }

function withUser(url) {
  const u = new URL(url, location.origin);
  if (!u.searchParams.has('user_id')) u.searchParams.set('user_id', String(state.userId));
  return u.pathname + u.search;
}

async function request(method, path, body) {
  const res = await fetch(withUser(path), {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

export const api = {
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

export const statementUrl = (q = {}) => withUser(`/api/statement.pdf${qs(q)}`);
export const qrUrl = (q = {}) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== '') p.set(k, v);
  return `/qr.png?${p.toString()}`;
};
