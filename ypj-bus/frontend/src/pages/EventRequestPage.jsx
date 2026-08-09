import { useNavigate } from 'react-router-dom';
import EventRequestsSection from '../components/EventRequests.jsx';

/**
 * Home page for the Admin Sekolah role — they don't get the full Transport
 * Team dashboard (pengajuan siswa, kartu, etc.), just this one thing: raise
 * and track bus requests for school events. Also reachable read-only by
 * Driver/Helper (via ScannerPage.jsx / SafetyChecklistPage.jsx) and Guru
 * (role key 'school_staff' — via GuruDashboardPage.jsx), each through their
 * own "🎉 Acara" nav tab — unlike Admin Sekolah, this isn't their home page,
 * so they need an explicit way back rather than relying on browser back,
 * same as SchedulePage's "Kembali ke Beranda".
 */
export default function EventRequestPage({ user }) {
  const navigate = useNavigate();
  return (
    <div className="page">
      <h1>Permintaan Bis Acara Sekolah</h1>
      <p className="muted">
        Ajukan kebutuhan bis untuk acara sekolah — study tour, upacara, lomba,
        dan sejenisnya. Setiap permintaan perlu persetujuan Tim Transportasi.
      </p>
      <EventRequestsSection user={user} />
      {['driver', 'helper', 'school_staff'].includes(user?.role) && (
        <button className="ghost block" onClick={() => navigate('/')}>Kembali ke Beranda</button>
      )}
    </div>
  );
}
