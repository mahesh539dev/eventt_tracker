export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function request(method, path, body) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') headers['X-Requested-With'] = 'event-decor-tracker';
  const res = await fetch(path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error?.message ?? 'Request failed.');
  return data;
}

export const login = (password) => request('POST', '/api/auth/login', { password });
export const logout = () => request('POST', '/api/auth/logout');
export const checkAuth = () => request('GET', '/api/auth/me');

export const listEvents = (filters = {}) => {
  const params = new URLSearchParams(filters);
  return request('GET', `/api/events?${params.toString()}`);
};
export const getEvent = (id) => request('GET', `/api/events/${id}`);
export const createEvent = (data) => request('POST', '/api/events', data);
export const updateEvent = (id, data) => request('PATCH', `/api/events/${id}`, data);
export const deleteEvent = (id) => request('DELETE', `/api/events/${id}`);

export const addExpense = (eventId, data) => request('POST', `/api/events/${eventId}/expenses`, data);
export const updateExpense = (eventId, expenseId, data) =>
  request('PATCH', `/api/events/${eventId}/expenses/${expenseId}`, data);
export const deleteExpense = (eventId, expenseId) => request('DELETE', `/api/events/${eventId}/expenses/${expenseId}`);

export const listGlobalExpenses = (filters = {}) => {
  const params = new URLSearchParams(filters);
  return request('GET', `/api/global-expenses?${params.toString()}`);
};
export const addGlobalExpense = (data) => request('POST', '/api/global-expenses', data);
export const updateGlobalExpense = (id, data) => request('PATCH', `/api/global-expenses/${id}`, data);
export const deleteGlobalExpense = (id) => request('DELETE', `/api/global-expenses/${id}`);

export const getReport = (query) => {
  const params = new URLSearchParams(query);
  return request('GET', `/api/reports?${params.toString()}`);
};
