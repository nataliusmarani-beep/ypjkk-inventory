import { useEffect, useState } from 'react';
import { api } from '../api';

/**
 * Today's date/weekday plus the currently published rotation period —
 * same info the admin dashboard's TodayCard shows, reused here for
 * Driver/Helper's own hero sections (Checklist/Scan pages) via the
 * read-only /meta/schedule endpoint they already have access to (see
 * SchedulePage.jsx), rather than the admin-only /admin/schedule.
 */
export default function TodayBanner() {
  const [period, setPeriod] = useState(null);

  useEffect(() => {
    api.schedule().then((d) => setPeriod(d.period)).catch(() => {});
  }, []);

  const now = new Date();
  const dayName = now.toLocaleDateString('id-ID', { weekday: 'long' });
  const dateStr = now.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
  // Sabtu (6) / Minggu (0) — no regular commute service; a special event
  // trip (see EventRequests) can still run, so this is informational only,
  // not a block on the Scan/Checklist pages themselves.
  const isWeekend = [0, 6].includes(now.getDay());

  return (
    <div className="hero-today">
      <span>
        📅 {dayName}, {dateStr}
        {isWeekend && <span className="hero-today-weekend"> · Libur Sekolah, tidak ada rit reguler</span>}
      </span>
      {period && <span className="hero-today-period">Periode rotasi: <strong>{period}</strong></span>}
    </div>
  );
}
