// In dev, Vite proxies /api → localhost:3001.
// In production, Express serves both frontend and API from the same origin.
const BASE = import.meta.env.VITE_API_URL || '/api';

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',           // sends the HttpOnly cookie automatically
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });

  if (res.status === 401) {
    window.dispatchEvent(new Event('inv:logout'));
    throw new Error('Session expired. Please log in again.');
  }
  if (res.status === 204) return null;
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

const qs = (params = {}) => {
  const s = new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([, v]) => v != null && v !== ''))
  ).toString();
  return s ? `?${s}` : '';
};

export const api = {
  // Auth
  login:            (b)      => request('/auth/login',       { method: 'POST', body: JSON.stringify(b) }),
  logout:           ()       => request('/auth/logout',      { method: 'POST' }),
  me:               ()       => request('/auth/me'),
  verifyResetToken: (token)  => request(`/auth/verify-reset?token=${encodeURIComponent(token)}`),
  setPassword:      (b)      => request('/auth/set-password', { method: 'POST', body: JSON.stringify(b) }),

  // Items
  getItems:   (p)     => request(`/items${qs(p)}`),
  getItem:    (id)    => request(`/items/${id}`),
  getMeta:    ()      => request('/items/meta'),
  createItem: (b)     => request('/items',      { method: 'POST',   body: JSON.stringify(b) }),
  updateItem: (id, b) => request(`/items/${id}`, { method: 'PUT',    body: JSON.stringify(b) }),
  deleteItem: (id)    => request(`/items/${id}`, { method: 'DELETE' }),

  // Requests
  getRequests:    (p)      => request(`/requests${qs(p)}`),
  getGroups:      (p)      => request(`/requests/groups${qs(p)}`),
  getStats:       ()       => request('/requests/stats'),
  submitRequest:  (b)      => request('/requests',           { method: 'POST', body: JSON.stringify(b) }),
  submitCart:     (b)      => request('/requests/cart',      { method: 'POST', body: JSON.stringify(b) }),
  approveRequest: (id, b)  => request(`/requests/${id}/approve`,  { method: 'PUT', body: JSON.stringify(b || {}) }),
  rejectRequest:  (id, b)  => request(`/requests/${id}/reject`,   { method: 'PUT', body: JSON.stringify(b || {}) }),
  forwardRequest: (id, b)  => request(`/requests/${id}/forward`,  { method: 'PUT', body: JSON.stringify(b || {}) }),
  approveGroup:   (gid, b) => request(`/requests/groups/${encodeURIComponent(gid)}/approve`, { method: 'PUT', body: JSON.stringify(b || {}) }),
  rejectGroup:    (gid, b) => request(`/requests/groups/${encodeURIComponent(gid)}/reject`,  { method: 'PUT', body: JSON.stringify(b || {}) }),
  forwardGroup:   (gid, b) => request(`/requests/groups/${encodeURIComponent(gid)}/forward`, { method: 'PUT', body: JSON.stringify(b || {}) }),
  returnRequest:  (id)     => request(`/requests/${id}/return`,   { method: 'PUT', body: JSON.stringify({}) }),

  // Users (Manager only)
  getUsers:      (p)      => request(`/users${qs(p)}`),
  createUser:    (b)      => request('/users',         { method: 'POST',   body: JSON.stringify(b) }),
  updateUser:    (id, b)  => request(`/users/${id}`,   { method: 'PUT',    body: JSON.stringify(b) }),
  resetPassword: (id, b)  => request(`/users/${id}/password`, { method: 'PUT', body: JSON.stringify(b) }),
  resendInvite:  (id)     => request(`/users/${id}/resend-invite`, { method: 'POST' }),
  deleteUser:    (id)     => request(`/users/${id}`,   { method: 'DELETE' }),
  importUsers:   (rows)   => request('/users/import',  { method: 'POST',   body: JSON.stringify({ rows }) }),
  importItems:   (rows)   => request('/items/import',  { method: 'POST',   body: JSON.stringify({ rows }) }),

  // Own profile (any role)
  getMe:      ()  => request('/users/me'),
  updateMe:   (b) => request('/users/me', { method: 'PUT', body: JSON.stringify(b) }),

  // Activity log (Manager only)
  getActivity: (p) => request(`/activity${qs(p)}`),

  // Backup (Manager only)
  getBackupList: () => request('/backup/list'),
};
