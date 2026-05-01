import { useState, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Topbar from './components/Layout/Topbar.jsx';
import Sidebar from './components/Layout/Sidebar.jsx';
import Toast from './components/shared/Toast.jsx';
import LoginPage from './pages/LoginPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import InventoryPage from './pages/InventoryPage.jsx';
import AddItemPage from './pages/AddItemPage.jsx';
import RequestsPage from './pages/RequestsPage.jsx';
import ApprovalsPage from './pages/ApprovalsPage.jsx';
import ReportsPage from './pages/ReportsPage.jsx';
import UsersPage from './pages/UsersPage.jsx';
import ActivityLogPage from './pages/ActivityLogPage.jsx';
import BackupPage      from './pages/BackupPage.jsx';
import HelpPage        from './pages/HelpPage.jsx';
import SetPasswordPage from './pages/SetPasswordPage.jsx';
import { api } from './api.js';

export default function App() {
  const [user,         setUser]         = useState(null);   // { id, name, email, role, unit_school }
  const [authChecked,  setAuthChecked]  = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [toast,        setToast]        = useState(null);

  const showToast = (message, type = 'info') => setToast({ message, type });

  // Restore session from HttpOnly cookie on first load
  useEffect(() => {
    api.me()
      .then(u => { setUser(u); setAuthChecked(true); })
      .catch(() => setAuthChecked(true));
  }, []);

  // Listen for any 401 that api.js fires
  useEffect(() => {
    const handler = () => setUser(null);
    window.addEventListener('inv:logout', handler);
    return () => window.removeEventListener('inv:logout', handler);
  }, []);

  const handleLogin  = (u) => setUser(u);
  const handleLogout = () => {
    api.logout().catch(() => {});   // ask server to clear the cookie
    setUser(null);
  };

  const refreshPending = () => {
    if (!user) return;
    // Count distinct request groups, not individual rows
    api.getGroups({ status: 'pending' })
      .then(data => setPendingCount(data.length))
      .catch(() => {});
  };

  useEffect(() => {
    if (user) refreshPending();
  }, [user]);

  // /set-password is always accessible — no auth needed
  if (window.location.pathname === '/set-password') {
    return (
      <>
        <SetPasswordPage showToast={showToast} />
        {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      </>
    );
  }

  if (!authChecked) {
    return (
      <div style={{ display:'flex', alignItems:'center', justifyContent:'center', minHeight:'100vh' }}>
        <p style={{ color:'var(--muted)', fontSize:14 }}>Loading…</p>
      </div>
    );
  }

  if (!user) {
    return (
      <>
        <LoginPage onLogin={handleLogin} />
        {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      </>
    );
  }

  const pageProps = { role: user.role, user, showToast, refreshPending };
  const isAdmin   = user.role === 'Manager' || user.role === 'Storekeeper';
  const adminOnly = (el) => isAdmin ? el : <Navigate to="/" replace />;
  const superOnly = (el) => user.role === 'Manager' ? el : <Navigate to="/" replace />;

  return (
    <>
      <Topbar user={user} pendingCount={pendingCount} onLogout={handleLogout} />
      <div className="layout">
        <Sidebar role={user.role} user={user} pendingCount={pendingCount} />
        <main className="main">
          <Routes>
            <Route path="/"          element={<DashboardPage  {...pageProps} />} />
            <Route path="/inventory" element={<InventoryPage  {...pageProps} />} />
            <Route path="/requests"  element={<RequestsPage   {...pageProps} />} />
            <Route path="/add-item"  element={adminOnly(<AddItemPage   {...pageProps} />)} />
            <Route path="/approvals" element={adminOnly(<ApprovalsPage {...pageProps} />)} />
            <Route path="/reports"      element={adminOnly(<ReportsPage      {...pageProps} />)} />
            <Route path="/activity-log" element={superOnly(<ActivityLogPage  {...pageProps} />)} />
            <Route path="/users"        element={superOnly(<UsersPage        {...pageProps} />)} />
            <Route path="/backup"       element={superOnly(<BackupPage       {...pageProps} />)} />
            <Route path="/help"         element={<HelpPage {...pageProps} />} />
            <Route path="*"          element={<Navigate to="/" replace />} />
          </Routes>
          <footer style={{
            marginTop: 48,
            paddingTop: 20,
            borderTop: '1px solid var(--border)',
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 8,
            fontSize: 12,
            color: 'var(--muted)',
          }}>
            <span>© {new Date().getFullYear()} Yayasan Pendidikan Jayawijaya — Kuala Kencana Campus. All rights reserved.</span>
            <span>
              📧{' '}
              <a href="mailto:natalius_marani@ypj.sch.id" style={{ color:'var(--muted)', textDecoration:'none' }}>
                natalius_marani@ypj.sch.id
              </a>
              {' · '}
              🌐{' '}
              <a href="https://ypj.sch.id" target="_blank" rel="noreferrer" style={{ color:'var(--muted)', textDecoration:'none' }}>
                ypj.sch.id
              </a>
            </span>
          </footer>
        </main>
      </div>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </>
  );
}
