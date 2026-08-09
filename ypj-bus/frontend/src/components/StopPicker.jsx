/**
 * Pickup point selector (Q9, "Titik Penjemputan").
 *
 * The old form listed the 19 TPS with no capacity signal, so TPS#17 collected 47
 * requests against 45 seats while TPS#5, #11, #18 and #19 got one each. This
 * control shows the live load and suggests a nearby alternative in the same area.
 */
export default function StopPicker({ stops, value, onChange, error }) {
  const selected = stops.find((s) => String(s.id) === String(value));
  const capacity = selected?.seat_capacity || 0;
  const issued = selected?.issued_active || 0;
  const remaining = selected?.seats_remaining ?? 0;
  const full = capacity > 0 && remaining === 0;
  const nearlyFull = capacity > 0 && !full && remaining <= Math.ceil(capacity * 0.15);

  const alternatives = selected
    ? stops.filter((s) => s.id !== selected.id
        && s.area === selected.area
        && s.seats_remaining > 0).slice(0, 2)
    : [];

  return (
    <div className="field">
      <label htmlFor="stop">Titik Penjemputan <span className="req">*</span></label>
      <select id="stop" value={value || ''} onChange={(e) => onChange(e.target.value)}>
        <option value="">— Pilih TPS —</option>
        {stops.map((s) => (
          <option key={s.id} value={s.id}>
            {s.code} {s.name}
            {s.seat_capacity > 0 ? ` — ${s.issued_active}/${s.seat_capacity} kursi` : ''}
          </option>
        ))}
      </select>

      {selected && (
        <>
          <div className="row" style={{ marginTop: 10, gap: 8 }}>
            <div className="load-bar grow">
              <span
                className={full ? 'danger' : nearlyFull ? 'warn' : ''}
                style={{ width: capacity ? `${Math.min(100, (issued / capacity) * 100)}%` : '0%' }}
              />
            </div>
            <span className={`chip ${full ? 'danger' : nearlyFull ? 'warn' : 'ok'}`}>
              {capacity ? `${issued}/${capacity}` : 'kapasitas belum diatur'}
            </span>
          </div>

          {(full || nearlyFull) && (
            <div className={`banner ${full ? 'danger' : 'warn'}`} style={{ marginTop: 10 }}>
              <span>⚠</span>
              <div>
                <strong>
                  {selected.code} {full ? 'sudah penuh' : 'hampir penuh'} ({issued}/{capacity} kursi).
                </strong>
                {full
                  ? ' Pengajuan tetap dapat dikirim, namun Tim Transportasi mungkin memindahkan penjemputan ke TPS terdekat.'
                  : ` Sisa ${remaining} kursi.`}
                {alternatives.length > 0 && (
                  <div style={{ marginTop: 6 }}>
                    Alternatif di area {selected.area}:{' '}
                    {alternatives.map((a) => (
                      <button key={a.id} type="button" className="link"
                              style={{ marginRight: 10 }}
                              onClick={() => onChange(String(a.id))}>
                        {a.code} ({a.seats_remaining} kursi)
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {error && <div className="error">{error}</div>}
      <div className="hint">Bis hanya berhenti di halte/TPS yang telah ditetapkan.</div>
    </div>
  );
}
