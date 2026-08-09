import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { api } from './api';
import Crest from './components/Crest.jsx';
import LoginPage from './pages/LoginPage.jsx';
import ResetPasswordPage from './pages/ResetPasswordPage.jsx';
import InstallPage from './pages/InstallPage.jsx';
import ParentHomePage from './pages/ParentHomePage.jsx';
import ApplicationFormPage from './pages/ApplicationFormPage.jsx';
import EditApplicationPage from './pages/EditApplicationPage.jsx';
import RulesViewPage from './pages/RulesViewPage.jsx';
import ComplaintFormPage from './pages/ComplaintFormPage.jsx';
import SchedulePage from './pages/SchedulePage.jsx';
import ChatPage from './pages/ChatPage.jsx';
import EventRequestPage from './pages/EventRequestPage.jsx';
import NotificationsPage from './pages/NotificationsPage.jsx';
import GuruDashboardPage from './pages/GuruDashboardPage.jsx';

// Split out the heavy libraries so a parent on a weak Timika signal never
// downloads them: the card page pulls in qrcode + html2canvas, the admin portal
// pulls in xlsx, and the scanner pulls in html5-qrcode.
const BusCardPage    = lazy(() => import('./pages/BusCardPage.jsx'));
const AdminQueuePage = lazy(() => import('./pages/AdminQueuePage.jsx'));
const ScannerPage    = lazy(() => import('./pages/ScannerPage.jsx'));
const SafetyChecklistPage  = lazy(() => import('./pages/SafetyChecklistPage.jsx'));
const AdminAccountsPage    = lazy(() => import('./pages/AdminAccountsPage.jsx'));
const BackupPage           = lazy(() => import('./pages/BackupPage.jsx'));
// Pulls in leaflet — split out for the same reason as the card/admin/scanner
// bundles above, so a parent on a weak Timika signal doesn't download it
// unless they actually open Lacak Bus.
const TrackBusPage         = lazy(() => import('./pages/TrackBusPage.jsx'));

const isAdmin    = (u) => u?.role === 'transport_admin' || u?.role === 'super_admin';
// Read-only supervisors over the admin dashboard — see the write-guard in
// backend/routes/admin.js. Grouped with isAdmin only for ROUTE access; the
// pages themselves hide mutating controls when the role is 'leader' or
// 'admin' (Admin Sekolah).
const isSupervisor = (u) => isAdmin(u) || ['leader', 'admin'].includes(u?.role);
// Matches backend/server.js's requireRole('attendant', 'helper', 'transport_admin', 'school_staff')
// on /api/scan — Driver deliberately excluded, they only ever fill the Pre-Op checklist.
const canScan      = (u) => isAdmin(u) || ['attendant', 'helper', 'school_staff'].includes(u?.role);
// Matches /api/safety's role list.
const canChecklist = (u) => isAdmin(u) || ['attendant', 'driver', 'helper', 'school_staff'].includes(u?.role);
// Matches backend/routes/eventRequests.js's mount-level role check. Admin
// Sekolah and Leader both raise these (and, like everywhere else, Leader
// supervises the full list) — both folded into isSupervisor above.
const canRequestEvent = (u) => isSupervisor(u);
// Driver/Helper don't raise event requests themselves, but they need to see
// which of their upcoming duty days has an extra event trip, and — once
// approved — which bus was assigned, so the /event-request page (read-only
// for them, same component EventRequestsSection already gates by role) is
// open to them too.
const canViewEvents = (u) => canRequestEvent(u) || ['driver', 'helper', 'school_staff'].includes(u?.role);
// Guru (role key 'school_staff' — not to be confused with 'admin', labelled
// "Admin Sekolah" in the UI, a different role) gets its own dashboard —
// see backend/routes/guru.js for why it's a separate narrow router rather
// than widening /api/admin.
const canViewGuruDashboard = (u) => u?.role === 'school_staff';
// Stop-progress map — Helper, Parent, Guru per the feature request, plus the
// same read-only supervisors everywhere else gets in on. Matches
// backend/server.js's requireRole on /api/track.
const canViewTrack = (u) => ['parent', 'helper', 'school_staff'].includes(u?.role) || isSupervisor(u);

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [chatUnread, setChatUnread] = useState(0);
  const [notifUnread, setNotifUnread] = useState(0);
  const navigate = useNavigate();

  const refresh = useCallback(async () => {
    try {
      setUser(await api.me());
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Chat used to only be reachable from the parent dashboard's own tile —
  // every role now gets a way in from the header, Tim Transportasi/Leader/
  // Admin Sekolah excepted since they already see every conversation in
  // "Chat Orang Tua" from inside the admin dashboard.
  const canChat = !!user && !isSupervisor(user);
  // Driver/Helper also have the internal group room — fold its unread count
  // into the same header badge so a new group message isn't missed just
  // because it didn't come through the personal thread.
  const hasGroupChat = user?.role === 'driver' || user?.role === 'helper';
  useEffect(() => {
    if (!canChat) return;
    let alive = true;
    const pull = () => Promise.all([
      api.chatUnread().catch(() => ({ unread: 0 })),
      hasGroupChat ? api.groupChatUnread().catch(() => ({ unread: 0 })) : Promise.resolve({ unread: 0 }),
      // Ruang Chat is readable by every role that reaches /chat at all.
      api.roomChatUnread().catch(() => ({ unread: 0 })),
    ]).then(([personal, group, room]) => {
      if (alive) setChatUnread(personal.unread + group.unread + room.unread);
    });
    pull();
    const timer = setInterval(pull, 30000);
    return () => { alive = false; clearInterval(timer); };
  }, [canChat, hasGroupChat]);

  // Notifications, unlike chat, are for every role — Tim Transportasi gets
  // "new event request" notices, Admin Sekolah/Leader get decision notices,
  // parents get card/application updates, and so on.
  useEffect(() => {
    if (!user) return;
    let alive = true;
    const pull = () => api.notifications()
      .then((n) => { if (alive) setNotifUnread(n.filter((x) => !x.read_at).length); })
      .catch(() => {});
    pull();
    const timer = setInterval(pull, 30000);
    return () => { alive = false; clearInterval(timer); };
  }, [user]);

  // App icon badge (Badging API) — mirrors the header bell/chat dots onto the
  // home-screen icon for an installed PWA. Android/Chrome only; iOS Safari and
  // desktop browsers without the API just silently no-op.
  useEffect(() => {
    if (!('setAppBadge' in navigator)) return;
    const total = chatUnread + notifUnread;
    if (total > 0) navigator.setAppBadge(total).catch(() => {});
    else navigator.clearAppBadge().catch(() => {});
  }, [chatUnread, notifUnread]);

  // api.js fires this whenever a request comes back 401.
  useEffect(() => {
    const onLogout = () => { setUser(null); navigate('/login'); };
    window.addEventListener('bus:logout', onLogout);
    return () => window.removeEventListener('bus:logout', onLogout);
  }, [navigate]);

  async function logout() {
    await api.logout().catch(() => {});
    if ('clearAppBadge' in navigator) navigator.clearAppBadge().catch(() => {});
    setUser(null);
    navigate('/login');
  }

  if (loading) {
    return <div className="page center muted" style={{ paddingTop: 80 }}>Memuat…</div>;
  }

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage onSignedIn={refresh} />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/install" element={<InstallPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <>
      <header className="app-bar">
        <Crest size={34} />
        <span className="brand">
          Bis Sekolah YPJ
          <small>KUALA KENCANA</small>
        </span>
        <span className="spacer" />
        <button className="icon-btn" onClick={() => navigate('/')}
                title="Beranda" aria-label="Beranda">
          🏠
        </button>
        <button className="icon-btn" onClick={() => navigate('/peraturan')}
                title="Peraturan &amp; Kebijakan" aria-label="Peraturan & Kebijakan">
          📋
        </button>
        {canViewTrack(user) && (
          <button className="icon-btn" onClick={() => navigate('/lacak')}
                  title="Lacak Bus" aria-label="Lacak Bus">
            🗺️
          </button>
        )}
        <button className="icon-btn" onClick={() => navigate('/notifications')}
                title="Pemberitahuan" aria-label="Pemberitahuan"
                style={{ position: 'relative' }}>
          🔔
          {notifUnread > 0 && <span className="tile-badge">{notifUnread}</span>}
        </button>
        {canChat && (
          <button className="icon-btn" onClick={() => navigate('/chat')}
                  title="Chat Tim Transportasi" aria-label="Chat Tim Transportasi"
                  style={{ position: 'relative' }}>
            💬
            {chatUnread > 0 && <span className="tile-badge">{chatUnread}</span>}
          </button>
        )}
        <span className="user-chip">
          <span className="avatar" aria-hidden="true">{initials(user.name)}</span>
          <span className="user-meta">
            <div className="nm" title={user.name}>{user.name}</div>
            <div className="rl">{roleLabel(user.role)}</div>
          </span>
        </span>
        <button className="icon-btn" onClick={logout} title="Keluar" aria-label="Keluar">
          ⏻
        </button>
      </header>

      <Suspense fallback={<div className="page center muted" style={{ paddingTop: 60 }}>Memuat…</div>}>
      <Routes>
        {/* Parents */}
        <Route path="/" element={
          isSupervisor(user) ? <Navigate to="/admin" replace />
            : canViewGuruDashboard(user) ? <Navigate to="/guru" replace />
            : user.role === 'driver' ? <Navigate to="/checklist" replace />
            : canScan(user) ? <Navigate to="/scan" replace />
            : <ParentHomePage user={user} />
        } />
        <Route path="/guru" element={
          canViewGuruDashboard(user) ? <GuruDashboardPage user={user} /> : <Navigate to="/" replace />
        } />
        <Route path="/event-request" element={
          canViewEvents(user) ? <EventRequestPage user={user} /> : <Navigate to="/" replace />
        } />
        <Route path="/ajukan" element={<ApplicationFormPage user={user} onDone={refresh} />} />
        <Route path="/ajukan/:id/perbaiki" element={<EditApplicationPage />} />
        <Route path="/kartu/:id" element={<BusCardPage />} />
        <Route path="/peraturan" element={<RulesViewPage />} />
        <Route path="/keluhan" element={<ComplaintFormPage />} />
        <Route path="/jadwal" element={<SchedulePage />} />
        <Route path="/lacak" element={
          canViewTrack(user) ? <TrackBusPage user={user} /> : <Navigate to="/" replace />
        } />
        <Route path="/chat" element={<ChatPage user={user} />} />
        <Route path="/install" element={<InstallPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/notifications" element={<NotificationsPage />} />

        {/* Transport Team */}
        <Route path="/admin" element={
          isSupervisor(user) ? <AdminQueuePage user={user} /> : <Navigate to="/" replace />
        } />
        <Route path="/admin/akun" element={
          isSupervisor(user) ? <AdminAccountsPage user={user} /> : <Navigate to="/" replace />
        } />
        {/* Backup is Super Admin + Tim Transportasi only — narrower than the
            other admin pages, which also allow the read-only leader/admin
            supervisor roles. */}
        <Route path="/admin/backup" element={
          isAdmin(user) ? <BackupPage user={user} /> : <Navigate to="/" replace />
        } />

        {/* Attendants, helpers, drivers */}
        <Route path="/scan" element={
          canScan(user) ? <ScannerPage user={user} /> : <Navigate to="/" replace />
        } />
        <Route path="/checklist" element={
          canChecklist(user) ? <SafetyChecklistPage user={user} /> : <Navigate to="/" replace />
        } />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
    </>
  );
}

/** First letters of the first two words — "Yoce Pallo" → "YP". */
function initials(name) {
  return String(name || '?')
    .trim().split(/\s+/).slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || '')
    .join('') || '?';
}

function roleLabel(role) {
  return {
    parent: 'Orang Tua',
    transport_admin: 'Tim Transportasi',
    super_admin: 'Super Admin',
    attendant: 'Petugas Bis',
    school_staff: 'Guru',
    driver: 'Driver',
    helper: 'Helper',
    leader: 'Leader',
    admin: 'Admin Sekolah',
  }[role] || role;
}
