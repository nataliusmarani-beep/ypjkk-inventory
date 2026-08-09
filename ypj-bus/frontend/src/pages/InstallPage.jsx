import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import Crest from '../components/Crest.jsx';

const APP_URL = 'https://bus.ypj.sch.id';

/**
 * "Pasang Aplikasi" — the page a WhatsApp-shared link points parents at.
 *
 * There is no real one-tap install for a PWA: Android/Chrome exposes
 * `beforeinstallprompt`, which genuinely is one tap, but iOS Safari has no
 * equivalent API at all — Apple requires the manual Share → Add to Home
 * Screen flow, and that flow is *only* available in Safari itself, not in
 * WhatsApp's in-app browser. So this page detects the platform and shows
 * whichever of those three paths actually applies, rather than promising a
 * single "Download" button that would silently fail on most phones.
 */
export default function InstallPage() {
  const [platform, setPlatform] = useState('unknown');
  const [inAppBrowser, setInAppBrowser] = useState(false);
  const [standalone, setStandalone] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [installed, setInstalled] = useState(false);
  const [qr, setQr] = useState(null);

  useEffect(() => {
    const ua = navigator.userAgent || '';
    const isIOS = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
    const isAndroid = /Android/.test(ua);
    setPlatform(isIOS ? 'ios' : isAndroid ? 'android' : 'desktop');

    // WhatsApp/Instagram/Facebook open links in their own in-app browser,
    // which iOS Safari's "Add to Home Screen" is not available inside.
    setInAppBrowser(/WhatsApp|FBAN|FBAV|Instagram|Line\//.test(ua));

    setStandalone(
      window.navigator.standalone === true
      || window.matchMedia('(display-mode: standalone)').matches
    );
  }, []);

  useEffect(() => {
    const onPrompt = (e) => { e.preventDefault(); setDeferredPrompt(e); };
    const onInstalled = () => setInstalled(true);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  useEffect(() => {
    if (platform === 'desktop') {
      QRCode.toDataURL(APP_URL, { width: 220, margin: 1 }).then(setQr).catch(() => {});
    }
  }, [platform]);

  async function installAndroid() {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
  }

  return (
    <div className="page center" style={{ maxWidth: 440, paddingTop: 40 }}>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
        <Crest size={72} />
      </div>
      <h1>Pasang Aplikasi Bis Sekolah</h1>
      <p className="muted">
        Ikuti langkah di bawah ini agar aplikasi muncul sebagai ikon di layar
        utama HP Anda, seperti aplikasi lainnya.
      </p>

      <div className="card" style={{ textAlign: 'left', marginTop: 20 }}>
        <div className="row" style={{ gap: 12, marginBottom: 4 }}>
          <img src="/icons/icon-96.png" alt="" width={56} height={56}
               style={{ borderRadius: 12, flex: 'none' }} />
          <div>
            <div style={{ fontWeight: 700 }}>Bis Sekolah YPJ Kuala Kencana</div>
            <div className="muted" style={{ fontSize: 13 }}>bus.ypj.sch.id</div>
          </div>
        </div>
      </div>

      {standalone || installed ? (
        <div className="banner success" style={{ marginTop: 16 }}>
          <span>✅</span>
          <div>Aplikasi sudah terpasang di HP ini. Anda bisa menutup halaman ini.</div>
        </div>
      ) : (
        <>
          {inAppBrowser && platform === 'ios' && (
            <div className="banner warn" style={{ marginTop: 16 }}>
              <span>⚠</span>
              <div>
                Halaman ini dibuka di dalam WhatsApp. Tekan <strong>⋯</strong> atau{' '}
                <strong>ikon Safari</strong> di pojok kanan bawah/atas, lalu pilih
                <strong> "Buka di Safari"</strong> — langkah pemasangan hanya
                berfungsi di Safari.
              </div>
            </div>
          )}
          {inAppBrowser && platform === 'android' && (
            <div className="banner warn" style={{ marginTop: 16 }}>
              <span>⚠</span>
              <div>
                Halaman ini dibuka di dalam WhatsApp. Tekan <strong>⋯</strong> di
                pojok kanan atas lalu pilih <strong>"Buka di browser"</strong> agar
                tombol pasang di bawah berfungsi.
              </div>
            </div>
          )}

          {platform === 'ios' && (
            <div className="card" style={{ marginTop: 16 }}>
              <h3 style={{ marginTop: 0 }}>Langkah pemasangan (iPhone/iPad)</h3>
              <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 1.9 }}>
                <li>Tekan tombol <strong>Bagikan</strong> (kotak dengan panah ke
                  atas) di bagian bawah layar Safari.</li>
                <li>Gulir dan pilih <strong>"Tambah ke Layar Utama"</strong>
                  (Add to Home Screen).</li>
                <li>Tekan <strong>"Tambah"</strong> di pojok kanan atas.</li>
              </ol>
            </div>
          )}

          {platform === 'android' && (
            <div className="card" style={{ marginTop: 16 }}>
              <h3 style={{ marginTop: 0 }}>Pemasangan (Android)</h3>
              {deferredPrompt ? (
                <>
                  <p className="muted">Tekan tombol di bawah untuk memasang aplikasi.</p>
                  <button className="block" onClick={installAndroid}>
                    Pasang Aplikasi
                  </button>
                </>
              ) : (
                <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 1.9 }}>
                  <li>Tekan menu <strong>⋮</strong> (titik tiga) di pojok kanan
                    atas Chrome.</li>
                  <li>Pilih <strong>"Instal aplikasi"</strong> atau
                    <strong> "Tambahkan ke Layar Utama"</strong>.</li>
                  <li>Tekan <strong>"Instal"</strong> / <strong>"Tambahkan"</strong>.</li>
                </ol>
              )}
            </div>
          )}

          {platform === 'desktop' && (
            <div className="card" style={{ marginTop: 16, textAlign: 'center' }}>
              <h3 style={{ marginTop: 0 }}>Buka di HP Anda</h3>
              <p className="muted">
                Pindai kode QR ini dengan kamera HP untuk membuka halaman
                pemasangan di ponsel Anda.
              </p>
              {qr && <img src={qr} alt="Kode QR aplikasi" width={220} height={220}
                          style={{ margin: '0 auto', display: 'block' }} />}
              <p className="muted" style={{ marginTop: 12, fontSize: 13 }}>
                Atau buka <strong>{APP_URL}/install</strong> langsung di HP Anda.
              </p>
            </div>
          )}
        </>
      )}

      <p className="muted center" style={{ marginTop: 24, fontSize: 13 }}>
        Setelah terpasang, buka aplikasi dari ikon di layar utama dan masuk
        menggunakan akun Anda seperti biasa.
      </p>
    </div>
  );
}
