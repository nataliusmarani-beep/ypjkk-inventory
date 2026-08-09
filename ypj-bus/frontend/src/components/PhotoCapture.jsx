import { useRef, useState } from 'react';

/** What a parent is allowed to pick from their camera roll. */
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;   // 2 MB

/**
 * What may actually be stored on the Railway volume. The card photo renders at
 * 84×104 pt (≈252×312 px at 3×) and the admin review panel at 140×172 pt, so
 * ~100 KB of JPEG is generous for both.
 */
const MAX_STORED_BYTES = 100 * 1024;        // 100 KB

// Tried in order until the encode lands under the storage budget. A 2 MB phone
// photo normally settles at 640 px / q0.82 ≈ 60–90 KB; the smaller steps exist
// for busy backgrounds that compress badly.
const EDGE_STEPS    = [640, 512, 420, 340];
const QUALITY_STEPS = [0.82, 0.7, 0.6, 0.5, 0.42];

/**
 * Student photo — mandatory. The old form collected no photo at all, which left
 * bus attendants with no way to verify who was boarding.
 *
 * The full-size file never leaves the phone: it is re-encoded in the browser
 * first, so a parent on a weak Timika signal uploads ~80 KB instead of 2 MB.
 * The server enforces the same 100 KB ceiling, so the storage guarantee does not
 * depend on the client behaving.
 *
 * Calls onChange(dataUrl | null).
 */
export default function PhotoCapture({ value, onChange, error }) {
  const cameraRef = useRef(null);
  const galleryRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState(null);
  const [savings, setSavings] = useState(null);

  async function handleFile(file) {
    if (!file) return;
    setLocalError(null);
    setSavings(null);

    if (!/^image\/(jpeg|jpg|png|webp)$/i.test(file.type)) {
      setLocalError('Gunakan berkas gambar JPG, PNG atau WEBP.');
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setLocalError(
        `Ukuran foto ${formatBytes(file.size)} melebihi batas 2 MB. `
        + 'Pilih foto lain atau ambil ulang dengan resolusi lebih rendah.');
      return;
    }

    setBusy(true);
    try {
      const result = await compressToBudget(file);
      if (result.bytes > MAX_STORED_BYTES) {
        // Only reachable for a pathological image; the server would reject it too.
        setLocalError('Foto tidak dapat diperkecil sampai 100 KB. '
                    + 'Coba foto dengan latar polos.');
        return;
      }
      onChange(result.dataUrl);
      setSavings({ from: file.size, to: result.bytes });
    } catch {
      setLocalError('Foto tidak dapat diproses. Coba foto ulang.');
    } finally {
      setBusy(false);
    }
  }

  const shown = error || localError;

  return (
    <div className="field">
      <label>Foto Siswa <span className="req">*</span></label>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div className={`photo-box${shown ? ' error' : ''}`}>
          {value
            ? <img src={value} alt="Foto siswa" />
            : <span className="muted" style={{ fontSize: 26 }}>👤</span>}
        </div>
        <div className="col grow">
          <button type="button" className="ghost" disabled={busy}
                  onClick={() => cameraRef.current.click()}>
            {busy ? 'Memproses…' : 'Ambil Foto'}
          </button>
          <button type="button" className="ghost" disabled={busy}
                  onClick={() => galleryRef.current.click()}>
            Pilih dari Galeri
          </button>
          {value && (
            <button type="button" className="link"
                    onClick={() => { onChange(null); setSavings(null); }}>
              Hapus foto
            </button>
          )}
        </div>
      </div>

      {/* capture="user" opens the front camera straight away on Android/iOS. */}
      <input ref={cameraRef} type="file" accept="image/*" capture="user" hidden
             onChange={(e) => handleFile(e.target.files?.[0])} />
      <input ref={galleryRef} type="file" accept="image/*" hidden
             onChange={(e) => handleFile(e.target.files?.[0])} />

      <div className={shown ? 'error' : 'hint'}>
        {shown || 'Wajah menghadap kamera, latar terang, tanpa masker atau topi. '
                + 'Maksimal 2 MB — foto otomatis diperkecil sebelum dikirim.'}
      </div>

      {savings && !shown && (
        <div className="hint" style={{ color: 'var(--success)' }}>
          ✓ Foto {formatBytes(savings.from)} diperkecil menjadi {formatBytes(savings.to)}.
        </div>
      )}
    </div>
  );
}

/**
 * Re-encodes the image, shrinking the longest edge and then the JPEG quality
 * until the result fits the storage budget. Returns the smallest attempt if
 * nothing fits, so the caller can report it rather than silently uploading.
 */
async function compressToBudget(file) {
  const img = await loadImage(file);
  let smallest = null;

  try {
    for (const edge of EDGE_STEPS) {
      const canvas = drawScaled(img, edge);
      for (const quality of QUALITY_STEPS) {
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        const bytes = dataUrlBytes(dataUrl);
        if (!smallest || bytes < smallest.bytes) smallest = { dataUrl, bytes };
        if (bytes <= MAX_STORED_BYTES) return { dataUrl, bytes };
      }
    }
    return smallest;
  } finally {
    img.close?.();   // release an ImageBitmap's decoded pixels promptly
  }
}

/**
 * Modern phone cameras routinely produce 12–200 MP photos, and some formats
 * (notably HEIC on iPhones) never even reach the <img> onload handler — the
 * decode just fails silently, which is what actually produced "Foto tidak
 * dapat diproses" here. createImageBitmap decodes off the main thread with
 * broader codec support, so it is tried first; the <img> approach is kept as
 * a fallback for browsers without Blob support in createImageBitmap.
 *
 * Deliberately not passed a resize option here: giving createImageBitmap both
 * resizeWidth and resizeHeight stretches the image to that exact box rather
 * than preserving aspect ratio, which would visibly distort every non-square
 * photo. Downscaling stays canvas-side in drawScaled(), same as the <img> path.
 */
async function loadImage(file) {
  if (window.createImageBitmap) {
    try {
      return await createImageBitmap(file);
    } catch { /* fall through to the <img> path below */ }
  }

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode failed')); };
    img.src = url;
  });
}

function drawScaled(img, maxEdge) {
  const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  const ctx = canvas.getContext('2d');
  // JPEG has no alpha: fill white first so a transparent PNG does not go black.
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** Decoded byte length of a base64 data URL, without allocating the buffer. */
function dataUrlBytes(dataUrl) {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor(base64.length * 3 / 4) - padding;
}

const formatBytes = (n) => (n >= 1024 * 1024
  ? `${(n / (1024 * 1024)).toFixed(1)} MB`
  : `${Math.round(n / 1024)} KB`);
