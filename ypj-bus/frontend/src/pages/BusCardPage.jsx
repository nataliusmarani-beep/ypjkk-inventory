import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import QRCode from 'qrcode';
import html2canvas from 'html2canvas';
import { api, photoUrl } from '../api';
import Crest from '../components/Crest.jsx';

/**
 * Module 3 — Digital Bus ID Card.
 *
 * The card is created by the server the moment the Transport Team approves the
 * application; this page only renders it. The QR is hybrid:
 *   * a signed static payload, so an attendant can validate the card with no
 *     signal on the SP2/SP3 runs;
 *   * plus a single-use token refreshed every ~90 s while online, which is what
 *     stops one screenshot being passed around the neighbourhood.
 */
export default function BusCardPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const cardRef = useRef(null);

  const [card, setCard] = useState(null);
  const [qrImage, setQrImage] = useState(null);
  const [expiresAt, setExpiresAt] = useState(null);
  const [seconds, setSeconds] = useState(0);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const refreshQr = useCallback(async () => {
    try {
      const { payload, expires_at } = await api.cardQr(id);
      // Render locally: the payload never has to leave the device as an image.
      setQrImage(await QRCode.toDataURL(payload, {
        width: 324, margin: 0, errorCorrectionLevel: 'Q',
        color: { dark: '#121826', light: '#FFFFFF' },
      }));
      setExpiresAt(new Date(expires_at));
      setOffline(false);
    } catch (err) {
      // Keep whatever is on screen — the static half still validates offline.
      setOffline(true);
      if (!qrImage) setError(err.message);
    }
  }, [id, qrImage]);

  useEffect(() => {
    (async () => {
      try {
        const c = await api.card(id);
        setCard(c);
        if (c.status === 'active') refreshQr();
      } catch (err) {
        setError(err.message);
      }
    })();
    // refreshQr is intentionally excluded: it changes identity on every render
    // and would re-run this effect in a loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Countdown, then mint a new payload.
  useEffect(() => {
    if (!expiresAt) return;
    const tick = setInterval(() => {
      const left = Math.max(0, Math.round((expiresAt - new Date()) / 1000));
      setSeconds(left);
      if (left === 0) refreshQr();
    }, 1000);
    return () => clearInterval(tick);
  }, [expiresAt, refreshQr]);

  async function saveImage() {
    setSaving(true);
    try {
      const canvas = await html2canvas(cardRef.current, { scale: 3, backgroundColor: null });
      const link = document.createElement('a');
      link.download = `${card.card_no}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch {
      alert('Gagal menyimpan gambar kartu. Coba gunakan tombol Cetak.');
    } finally {
      setSaving(false);
    }
  }

  if (error && !card) {
    return (
      <div className="page">
        <div className="banner danger"><span>⚠</span><div>{error}</div></div>
        <button className="ghost" onClick={() => navigate('/')}>Kembali</button>
      </div>
    );
  }
  if (!card) return <div className="page muted center" style={{ paddingTop: 60 }}>Memuat kartu…</div>;

  const statusChip = {
    active:    ['AKTIF', 'ok'],
    suspended: ['DITANGGUHKAN', 'warn'],
    revoked:   ['DICABUT', 'danger'],
    expired:   ['KADALUARSA', 'neutral'],
  }[card.status];

  const frameClass = frameClassForStop(card.stop_code);

  return (
    <div className="page">
      {card.status !== 'active' && (
        <div className="banner danger">
          <span>⛔</span>
          <div>
            <strong>Kartu {statusChip[0]}</strong>
            {card.status_reason || 'Hubungi Tim Transportasi YPJ untuk informasi lebih lanjut.'}
          </div>
        </div>
      )}

      {/* Everything inside this ref is what gets captured for download/print. */}
      <div className={`bus-card ${frameClass}`} ref={cardRef}>
        <div className="head">
          {/* Same-origin file, so html2canvas can rasterise it when the parent
              saves or prints the card. */}
          <Crest size={40} />
          <div className="grow">
            <div className="org">YPJ KUALA KENCANA</div>
            <div className="kind">KARTU AKSES BIS SEKOLAH</div>
          </div>
          <span className={`chip ${statusChip[1]}`}>{statusChip[0]}</span>
        </div>

        <div className="body">
          <div className="body-content">
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <div className="photo">
                {card.photo_file
                  ? <img src={photoUrl(card.photo_file)} alt="" crossOrigin="use-credentials" />
                  : <div className="center muted" style={{ paddingTop: 34, fontSize: 24 }}>👤</div>}
              </div>
              <div className="grow">
                <div className="name">{card.student_name.toUpperCase()}</div>
                <div className="muted">{card.grade_label}</div>
                <div style={{ marginTop: 12 }}>
                  <div className="micro">TRANSIT ID</div>
                  <div>{card.transit_id}</div>
                </div>
                <div style={{ marginTop: 8 }}>
                  <div className="micro">RUTE</div>
                  <div>{card.route_code} · {card.stop_code}</div>
                </div>
              </div>
              <BusWatermark />
            </div>

            <hr style={{ border: 0, borderTop: '1px solid var(--outline)', margin: '14px 0' }} />

            <div className="row" style={{ alignItems: 'flex-start' }}>
              <div className="grow">
                <div className="micro">TITIK PENJEMPUTAN</div>
                <div>{card.stop_code} {card.stop_name}</div>
                <div className="micro" style={{ marginTop: 10 }}>BERLAKU HINGGA</div>
                <div>{formatDate(card.valid_until)}</div>
                <div className="micro" style={{ marginTop: 10 }}>NO. KARTU</div>
                <div>{card.card_no}</div>
              </div>
              {/* Opaque identifiers only — no name, address or phone number. */}
              <div className="qr">
                {qrImage
                  ? <img src={qrImage} alt="Kode QR kartu bis" />
                  : <div style={{ width: 108, height: 108, display: 'grid', placeItems: 'center' }}
                         className="muted">…</div>}
              </div>
            </div>
          </div>
        </div>

        <div className="foot">
          Kartu ini milik YPJ dan wajib ditunjukkan kepada petugas bis.
          Pelanggaran aturan dapat mengakibatkan pencabutan hak pengguna bis.
        </div>
      </div>

      {card.status === 'active' && (
        <div className="center muted" style={{ marginTop: 10 }}>
          {offline
            ? '⚠ Mode offline — kartu tersimpan tetap dapat dipindai.'
            : `🔒 Kode QR diperbarui dalam ${seconds} detik`}
        </div>
      )}

      <div className="row" style={{ marginTop: 18, gap: 12 }}>
        <button className="ghost grow" onClick={saveImage} disabled={saving}>
          {saving ? 'Menyimpan…' : 'Simpan Gambar'}
        </button>
        <button className="ghost grow" onClick={() => window.print()}>Cetak</button>
      </div>

      <div className="card" style={{ marginTop: 18 }}>
        <h3>Detail Kartu</h3>
        <Detail k="Nomor Kartu" v={card.card_no} />
        <Detail k="Transit ID" v={card.transit_id} />
        <Detail k="Nama Siswa" v={card.student_name} />
        <Detail k="Kelas" v={card.grade_label} />
        <Detail k="Rute" v={`${card.route_code} — ${card.route_name}`} />
        <Detail k="Titik Penjemputan" v={`${card.stop_code} ${card.stop_name}`} />
        <Detail k="Tahun Ajaran" v={card.academic_year} />
        <Detail k="Diterbitkan" v={formatDate(card.issued_at)} />
        <Detail k="Berlaku hingga" v={formatDate(card.valid_until)} />
      </div>

      <div className="banner info">
        <span>ℹ</span>
        <div>
          <strong>Cara pakai</strong>
          Tunjukkan kartu ini kepada petugas bis setiap kali naik. Bis hanya
          berhenti di halte/TPS yang telah ditetapkan.
        </div>
      </div>

      <button className="ghost block" onClick={() => navigate('/')}>Kembali ke Beranda</button>
    </div>
  );
}

// TPS#1 (RWB KK) runs its own route; TPS#2–TPS#6 is the Timika Indah / Petrosea
// corridor. The frame colour lets a parent or attendant tell the group apart
// without reading the small print. Every other stop keeps the default blue.
const RED_FRAME_STOPS = ['TPS#2', 'TPS#3', 'TPS#4', 'TPS#5', 'TPS#6'];
function frameClassForStop(stopCode) {
  if (stopCode === 'TPS#1') return 'frame-green';
  if (RED_FRAME_STOPS.includes(stopCode)) return 'frame-red';
  return '';
}

// Decorative only. Same-origin static file (like the crest) so html2canvas
// rasterises it correctly on save/print. It's a real bus photo with the studio
// background cut out, so — unlike a flat icon — it isn't recoloured per frame;
// it stays a soft, uniform ghost image behind the card's white details panel.
const BusWatermark = () => <img className="watermark" src="/bus-icon.png" alt="" aria-hidden="true" />;

const Detail = ({ k, v }) => (
  <div className="row" style={{ padding: '5px 0', alignItems: 'flex-start' }}>
    <div className="muted" style={{ width: 140, flex: 'none' }}>{k}</div>
    <div style={{ fontWeight: 500 }}>{v}</div>
  </div>
);

function formatDate(value) {
  if (!value) return '-';
  return new Date(value.replace(' ', 'T')).toLocaleDateString('id-ID', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
}
