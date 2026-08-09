// In dev, Vite proxies /api → localhost:3001.
// In production, Express serves both frontend and API from the same origin.
const BASE = import.meta.env.VITE_API_URL || '/api';

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',           // sends the HttpOnly cookie automatically
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });

  // Login/register attempts return 401 for wrong credentials, not an expired
  // session — there's no session yet, so show the server's actual reason
  // instead of masking it as "session expired" and firing a logout. Same for
  // the initial session check on mount (App.jsx's refresh()): a 401 there
  // just means "not logged in yet", which its own caller already handles by
  // setting user to null — dispatching bus:logout on top of that force-
  // navigates to /login and stomps on whatever public route (e.g.
  // /reset-password) the visitor actually landed on.
  const isAuthAttempt = path === '/auth/login' || path === '/auth/register' || path === '/auth/me';

  if (res.status === 401 && !isAuthAttempt) {
    window.dispatchEvent(new Event('bus:logout'));
    throw new Error('Sesi berakhir. Silakan masuk kembali.');
  }
  if (res.status === 204) return null;
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Permintaan gagal.');
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
  register: (b) => request('/auth/register', { method: 'POST', body: JSON.stringify(b) }),
  login:    (b) => request('/auth/login',    { method: 'POST', body: JSON.stringify(b) }),
  logout:   ()  => request('/auth/logout',   { method: 'POST' }),
  me:       ()  => request('/auth/me'),
  updateMe: (b) => request('/auth/me',       { method: 'PUT', body: JSON.stringify(b) }),
  forgotPassword: (email) =>
    request('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) }),
  resetPassword: (token, password) =>
    request('/auth/reset-password', { method: 'POST', body: JSON.stringify({ token, password }) }),

  // Reference data for the form (stops with live load, parent categories, rules, grades)
  meta: () => request('/meta'),
  notifications:     ()   => request('/meta/notifications'),
  markNotification:  (id) => request(`/meta/notifications/${id}/read`, { method: 'PUT' }),

  // Bus service schedule — read-only for parents, editable by the Transport Team
  schedule:       (day) => request(`/meta/schedule${day === 'besok' ? '?day=besok' : ''}`),
  adminSchedule:  () => request('/admin/schedule'),
  saveSchedulePeriod: (startDate, endDate) =>
    request('/admin/schedule/period', {
      method: 'PUT',
      body: JSON.stringify({ start_date: startDate, end_date: endDate }),
    }),
  saveBusSchedule: (busId, body) =>
    request(`/admin/schedule/bus/${busId}`, { method: 'PUT', body: JSON.stringify(body) }),
  addBus:    (b)     => request('/admin/schedule/bus', { method: 'POST', body: JSON.stringify(b) }),
  removeBus: (busId) => request(`/admin/schedule/bus/${busId}`, { method: 'DELETE' }),
  addRoute:  (b)     => request('/admin/routes', { method: 'POST', body: JSON.stringify(b) }),
  updateStopCapacity: (stopId, seatCapacity) =>
    request(`/admin/stops/${stopId}`, { method: 'PUT', body: JSON.stringify({ seat_capacity: seatCapacity }) }),
  updateRouteCapacity: (routeId, seatCapacity) =>
    request(`/admin/routes/${routeId}`, { method: 'PUT', body: JSON.stringify({ seat_capacity: seatCapacity }) }),

  // Nomor tugas — duty-slot rotation (authoring layer over the per-bus
  // schedule above; see backend/lib/cards.js resolveDutySchedule/materializeDutySchedule)
  dutySchedule:    () => request('/admin/duty-schedule'),
  saveDutySlotDay: (slotId, weekday, b) =>
    request(`/admin/duty-schedule/slot/${slotId}/day/${weekday}`, { method: 'PUT', body: JSON.stringify(b) }),
  saveDutyOrder:   (b) => request('/admin/duty-schedule/order', { method: 'PUT', body: JSON.stringify(b) }),
  applyDutySchedule: () => request('/admin/duty-schedule/apply', { method: 'POST' }),

  // Parent applications
  myApplications: ()   => request('/applications'),
  myApplication:  (id) => request(`/applications/${id}`),
  submitApplication: (b) => request('/applications', { method: 'POST', body: JSON.stringify(b) }),
  updateApplication: (id, b) => request(`/applications/${id}`, { method: 'PUT', body: JSON.stringify(b) }),
  cancelApplication: (id) => request(`/applications/${id}/cancel`, { method: 'POST' }),
  requestEdit: (id, note) =>
    request(`/applications/${id}/request-edit`, { method: 'POST', body: JSON.stringify({ note }) }),

  // Bus ID cards
  myCards: ()   => request('/cards'),
  card:    (id) => request(`/cards/${id}`),
  cardQr:  (id) => request(`/cards/${id}/qr`),

  // Complaints ("Laporkan Keluhan") — emailed to the Transport Team on submit
  myComplaints:     ()  => request('/complaints'),
  submitComplaint:  (b) => request('/complaints', { method: 'POST', body: JSON.stringify(b) }),
  adminComplaints:      (p)     => request(`/admin/complaints${qs(p)}`),
  setComplaintStatus:   (id, status) =>
    request(`/admin/complaints/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) }),

  // Guru dashboard (read-only)
  guruStats:         ()      => request('/guru/stats'),
  guruStudents:      (p)     => request(`/guru/students${qs(p)}`),

  // Transport Team
  adminStats:        ()      => request('/admin/stats'),
  adminApplications: (p)     => request(`/admin/applications${qs(p)}`),
  adminApplication:  (id)    => request(`/admin/applications/${id}`),
  claimApplication:  (id)    => request(`/admin/applications/${id}/claim`, { method: 'POST' }),
  decideApplication: (id, b) => request(`/admin/applications/${id}/decision`, { method: 'POST', body: JSON.stringify(b) }),
  remindApplication: (id)    => request(`/admin/applications/${id}/remind`, { method: 'POST' }),
  undoRevision:      (id)    => request(`/admin/applications/${id}/undo-revision`, { method: 'POST' }),
  deleteStudent:     (id)    => request(`/admin/students/${id}`, { method: 'DELETE' }),
  adminEditRequests: ()      => request('/admin/edit-requests'),
  approveEditRequest: (id)   => request(`/admin/applications/${id}/edit-request/approve`, { method: 'POST' }),
  denyEditRequest:   (id, reason) =>
    request(`/admin/applications/${id}/edit-request/deny`, { method: 'POST', body: JSON.stringify({ reason }) }),
  adminCards:        (p)     => request(`/admin/cards${qs(p)}`),
  sanctionCard:      (id, b) => request(`/admin/cards/${id}/sanction`,  { method: 'POST', body: JSON.stringify(b) }),
  reinstateCard:     (id)    => request(`/admin/cards/${id}/reinstate`, { method: 'POST' }),
  adminManifest:     (p)     => request(`/admin/manifest${qs(p)}`),
  adminTripEvents:   ()      => request('/admin/trip-events'),
  adminViolations:   ()      => request('/admin/violations'),
  adminScans:        (p)     => request(`/admin/scans${qs(p)}`),
  adminExport:       ()      => request('/admin/export'),
  adminActivity:     ()      => request('/admin/activity'),
  sendBroadcast:     (b)     => request('/admin/broadcast', { method: 'POST', body: JSON.stringify(b) }),

  // Staff accounts (Tim Transportasi, Driver, Helper, Guru, Leader)
  adminStaff:          ()      => request('/admin/staff'),
  createStaffAccount:  (b)     => request('/admin/staff', { method: 'POST', body: JSON.stringify(b) }),
  updateStaffAccount:  (id, b) => request(`/admin/staff/${id}`, { method: 'PUT', body: JSON.stringify(b) }),
  resetStaffPassword:  (id, b) =>
    request(`/admin/staff/${id}/reset-password`, { method: 'POST', body: JSON.stringify(b || {}) }),

  // Database backups — Super Admin + Tim Transportasi only
  backupList: () => request('/backup/list'),

  // Event bus requests — one-off service for school events. Raised by Admin
  // Sekolah / Leader, approved or rejected by Tim Transportasi.
  eventRequests:       ()     => request('/event-requests'),
  createEventRequest:  (b)    => request('/event-requests', { method: 'POST', body: JSON.stringify(b) }),
  decideEventRequest:  (id, b) =>
    request(`/event-requests/${id}/decision`, { method: 'POST', body: JSON.stringify(b) }),

  // Trip status — the no-GPS "has the bus left yet?" for parents
  tripStatus: () => request('/meta/trip-status'),

  // Chat — two-way, parent ↔ Transport Team
  chat:         ()   => request('/chat'),
  chatUnread:   ()   => request('/chat/unread'),
  sendChat:     (b)  => request('/chat', { method: 'POST', body: JSON.stringify({ body: b }) }),
  chatThreads:  ()   => request('/chat/threads'),
  chatThread:   (id) => request(`/chat/threads/${id}`),
  replyChat:    (id, b) =>
    request(`/chat/threads/${id}`, { method: 'POST', body: JSON.stringify({ body: b }) }),

  // Group chat — Tim Transportasi + Driver + Helper, separate from the
  // per-parent threads above.
  groupChat:       ()  => request('/chat/group'),
  groupChatUnread: ()  => request('/chat/group/unread'),
  sendGroupChat:   (b) => request('/chat/group', { method: 'POST', body: JSON.stringify({ body: b }) }),

  // Ruang Chat — public room, everyone reads, Tim Transportasi + parents post.
  roomChat:       ()  => request('/chat/room'),
  roomChatUnread: ()  => request('/chat/room/unread'),
  sendRoomChat:   (b) => request('/chat/room', { method: 'POST', body: JSON.stringify({ body: b }) }),

  // Attendant scanner
  scan:            (b) => request('/scan',           { method: 'POST', body: JSON.stringify(b) }),
  scanSearch:      (p) => request(`/scan/search${qs(p)}`),
  scanManual:      (b) => request('/scan/manual',    { method: 'POST', body: JSON.stringify(b) }),
  reportViolation: (b) => request('/scan/violation', { method: 'POST', body: JSON.stringify(b) }),
  scanManifest:    (p) => request(`/scan/manifest${qs(p)}`),
  scanRoute:       (p) => request(`/scan/route${qs(p)}`),
  markDeparture:   (b) => request('/scan/departure', { method: 'POST', body: JSON.stringify(b) }),
  markArrival:     (b) => request('/scan/arrival',   { method: 'POST', body: JSON.stringify(b) }),
  startTrip:       (bus_id, direction) => request('/scan/trip/start', { method: 'POST', body: JSON.stringify({ bus_id, direction }) }),
  returnTrip:      (bus_id, direction) => request('/scan/trip/return', { method: 'POST', body: JSON.stringify({ bus_id, direction }) }),

  // Daily driver/helper safety checklists
  safetyDefinitions: ()   => request('/safety/definitions'),
  safetyChecklists:  (p)  => request(`/safety/checklists${qs(p)}`),
  safetyChecklist:   (id) => request(`/safety/checklists/${id}`),
  submitSafetyChecklist: (b) =>
    request('/safety/checklists', { method: 'POST', body: JSON.stringify(b) }),

  // Stop-progress map (no GPS — see backend/routes/track.js)
  track: (busId, direction) => request(`/track/${busId}?direction=${direction}`),
  updateStopLocation: (stopId, b) =>
    request(`/admin/stops/${stopId}/location`, { method: 'PUT', body: JSON.stringify(b) }),
};

// Photos and signatures are served through an authenticated route, never
// statically — these helpers just build the URL.
export const photoUrl = (file) => (file ? `${BASE}/files/photos/${encodeURIComponent(file)}` : null);
export const signatureUrl = (file) => (file ? `${BASE}/files/signatures/${encodeURIComponent(file)}` : null);
export const documentUrl = (file) => (file ? `${BASE}/files/documents/${encodeURIComponent(file)}` : null);

// SQLite stores every timestamp as UTC ('YYYY-MM-DD HH:MM:SS', no offset) —
// slicing the string directly (the old approach) just prints the UTC clock
// time as if it were local. Kuala Kencana runs on WIT (UTC+9, no DST), so
// this parses the value as UTC explicitly and re-renders it in that zone.
// Formatted by hand (via formatToParts) rather than toLocaleTimeString: the
// id-ID locale's default time separator varies by ICU build ("." on some
// Node/CI environments, ":" in every browser we actually target), and this
// value is shown throughout the crew and parent UI where a stray "21.07"
// instead of "21:07" would just look broken.
export const formatWIT = (sqliteDatetime) => {
  if (!sqliteDatetime) return null;
  const iso = sqliteDatetime.includes('T') ? sqliteDatetime : `${sqliteDatetime.replace(' ', 'T')}Z`;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jayapura', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(iso));
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return `${get('hour')}:${get('minute')}`;
};

// "Today" in Kuala Kencana (WIT, UTC+9), independent of the device's own
// clock/timezone setting or the server's. Matching this against
// checklist_date (also WIT, see backend/routes/safety.js) is what makes the
// daily safety checklist "today" check actually mean the same "today" for
// staff filling it in on the bus floor.
export const todayWIT = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jayapura' }).format(new Date());
