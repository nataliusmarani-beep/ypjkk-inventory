import { gradeLabel } from '../pages/ParentHomePage.jsx';

// Shared with the admin dashboard's per-grade filters — kept here too since
// both AdminQueuePage and the Guru dashboard chart against the same set of
// grades and need it in the same order (Toddler → Kelas 9).
export const GRADES = {
  toddler: 1, playgroup: 1, tk_a: 1, tk_b: 1,
  kelas_1: 1, kelas_2: 1, kelas_3: 1, kelas_4: 1, kelas_5: 1, kelas_6: 1,
  kelas_7: 1, kelas_8: 1, kelas_9: 1,
};

// School-level grouping used to colour the per-grade chart and to roll it up
// into a 3-bar PAUD/SD/SMP chart.
export const SCHOOL_CATEGORIES = {
  paud: { label: 'PAUD', color: '#F2B705', grades: ['toddler', 'playgroup', 'tk_a', 'tk_b'] },
  sd:   { label: 'SD',   color: '#B3261E', grades: ['kelas_1', 'kelas_2', 'kelas_3', 'kelas_4', 'kelas_5', 'kelas_6'] },
  smp:  { label: 'SMP',  color: '#3B6FE0', grades: ['kelas_7', 'kelas_8', 'kelas_9'] },
};

export const categoryOfGrade = (g) => (
  Object.keys(SCHOOL_CATEGORIES).find((c) => SCHOOL_CATEGORIES[c].grades.includes(g))
);

// Short x-axis labels — "Toddler"/"Playgroup" don't fit under a narrow bar,
// unlike the row labels gradeLabel() gives the old horizontal layout.
const shortGradeLabel = (g) => (
  { toddler: 'Td', playgroup: 'PG', tk_a: 'TK A', tk_b: 'TK B' }[g]
  || g.replace('kelas_', '')
);

/** Enrolled students per grade level, in the school's Toddler→Kelas 9 order
 * (not sorted by count) so it reads as a curriculum-wide headcount rather
 * than a leaderboard. Counts come from stats.by_grade — applications not yet
 * cancelled/rejected, joined to the student's grade. */
export function StudentsByGradeCard({ byGrade }) {
  const counts = Object.fromEntries((byGrade || []).map((g) => [g.grade, g.n]));
  const rows = Object.keys(GRADES).map((g) => ({ grade: g, n: counts[g] || 0 }));
  const max = Math.max(1, ...rows.map((r) => r.n));
  const total = rows.reduce((sum, r) => sum + r.n, 0);
  const chartHeight = 130;

  return (
    <div className="card">
      <div className="dash-card-head" style={{ marginBottom: 12 }}>
        <span className="ico" aria-hidden="true">🎓</span>
        <span className="grow">
          <div className="dash-card-title">Siswa per Jenjang</div>
          <div className="muted" style={{ fontSize: 12 }}>{total} siswa (pengajuan aktif)</div>
        </span>
        <div className="row" style={{ gap: 10 }}>
          {Object.values(SCHOOL_CATEGORIES).map((c) => (
            <span key={c.label} className="donut-legend-row" style={{ fontSize: 11 }}>
              <span className="donut-legend-dot" style={{ background: c.color }} />
              {c.label}
            </span>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: chartHeight }}>
        {rows.map((r) => (
          <div
            key={r.grade}
            style={{
              flex: 1, height: '100%', display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'flex-end', gap: 4,
            }}
          >
            <span style={{ fontSize: 11 }}>{r.n || ''}</span>
            <div
              title={`${gradeLabel(r.grade)}: ${r.n}`}
              style={{
                width: '70%', maxWidth: 22,
                height: Math.max(Math.round((r.n / max) * (chartHeight - 24)), 3),
                background: SCHOOL_CATEGORIES[categoryOfGrade(r.grade)].color, borderRadius: '4px 4px 0 0',
              }}
            />
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
        {rows.map((r) => (
          <span key={r.grade} className="muted" style={{ flex: 1, fontSize: 10, textAlign: 'center' }}>
            {shortGradeLabel(r.grade)}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Same headcount rolled up to PAUD/SD/SMP — the three-bar view someone
 * scanning quota by school level actually wants, vs. reading 13 grade bars. */
export function SchoolCategoryCard({ byGrade }) {
  const counts = Object.fromEntries((byGrade || []).map((g) => [g.grade, g.n]));
  const bars = Object.entries(SCHOOL_CATEGORIES).map(([key, c]) => ({
    key, ...c, n: c.grades.reduce((sum, g) => sum + (counts[g] || 0), 0),
  }));
  const max = Math.max(1, ...bars.map((b) => b.n));
  const total = bars.reduce((sum, b) => sum + b.n, 0);
  const chartHeight = 130;

  return (
    <div className="dash-card">
      <div className="dash-card-head">
        <span className="ico" aria-hidden="true">🏫</span>
        <span className="grow">
          <div className="dash-card-title">Siswa per Kategori Sekolah</div>
          <div className="muted" style={{ fontSize: 12 }}>{total} siswa (pengajuan aktif)</div>
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-evenly', gap: 16, height: chartHeight, marginTop: 8 }}>
        {bars.map((b) => (
          <div
            key={b.key}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              justifyContent: 'flex-end', height: '100%', gap: 4,
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 700 }}>{b.n || ''}</span>
            <div
              title={`${b.label}: ${b.n}`}
              style={{
                width: 44,
                height: Math.max(Math.round((b.n / max) * (chartHeight - 28)), 3),
                background: b.color, borderRadius: '6px 6px 0 0',
              }}
            />
            <span className="muted" style={{ fontSize: 12, fontWeight: 600 }}>{b.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
