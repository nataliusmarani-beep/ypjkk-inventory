import { useState, useRef } from 'react';

const EMOJIS = [
  // Stationery / Office
  '✏️','📝','📄','📋','📌','📎','🖊️','📏','📐','✂️','🗂️','📁','🗃️','🖨️',
  // Housekeeping / Cleaning
  '🧹','🧺','🧻','🧼','🪣','🧽','🫧','🗑️','🪠',
  // Learning / Education
  '📚','📖','🎓','🏫','💻','🔬','🔭','🧮','📡','🗺️',
  // Groceries / Food
  '🛒','🍎','🥤','🧃','🍚','🧂','🫙','🥫','🧈','☕',
  // Art & Craft
  '🎨','🖌️','🖍️','🎭','🖼️','🎪','🧵','🪡','🧶',
  // Uniform / Clothing
  '👕','👖','👟','🧢','👔','🧦','🎽','🥿','👗',
  // Sport Equipment
  '⚽','🏀','🏐','🎾','🏓','🏸','🏊','🤸','🏋️','🎯','🥊','🏅',
  // Tools / Hardware
  '🔧','🔨','🪛','🪚','⚙️','🔩','🪝','🔌','💡','🔦','🪜','🧲',
  // Medical / First Aid
  '🏥','💊','🩺','🩹','🧬','💉','🩻','🫀','🌡️',
  // General
  '📦','🏷️','🔑','🗝️','📷','🖥️','📱','⌨️','🖱️',
];

// Resize any uploaded image to a square PNG (max 72px) and return a base64 data URL
function resizeToBase64(file, maxPx = 72) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const size = Math.min(maxPx, Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width  = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        // Scale to fill the square, centred
        const scale = size / Math.min(img.width, img.height);
        const x = (size - img.width  * scale) / 2;
        const y = (size - img.height * scale) / 2;
        ctx.drawImage(img, x, y, img.width * scale, img.height * scale);
        resolve(canvas.toDataURL('image/png', 0.85));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// Exported helper — renders either an emoji string or an uploaded image
export function IconDisplay({ icon, fallback = '📦', size = 'inherit', imgStyle = {} }) {
  if (icon && icon.startsWith('data:')) {
    return (
      <img
        src={icon}
        alt=""
        style={{ width: size === 'inherit' ? 28 : size, height: size === 'inherit' ? 28 : size, objectFit: 'contain', verticalAlign: 'middle', ...imgStyle }}
      />
    );
  }
  return <span style={{ fontSize: size === 'inherit' ? undefined : size }}>{icon || fallback}</span>;
}

export default function EmojiPicker({ value, onChange }) {
  const [open,      setOpen]      = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState('');
  const fileRef = useRef(null);

  const isImage = value && value.startsWith('data:');

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { setUploadErr('Please select an image file.'); return; }
    if (file.size > 2 * 1024 * 1024) { setUploadErr('Image must be smaller than 2 MB.'); return; }
    setUploadErr('');
    setUploading(true);
    try {
      const dataUrl = await resizeToBase64(file, 72);
      onChange(dataUrl);
      setOpen(false);
    } catch {
      setUploadErr('Failed to process image. Try another file.');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  return (
    <div style={{ position: 'relative' }}>
      {/* Preview button */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          style={{
            width: 56, height: 56, borderRadius: 'var(--radius-sm)',
            border: '1.5px solid var(--border)', background: 'var(--off)',
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 4, overflow: 'hidden',
          }}
          title="Pick an icon"
        >
          {isImage
            ? <img src={value} alt="" style={{ width: 44, height: 44, objectFit: 'contain', borderRadius: 4 }} />
            : <span style={{ fontSize: 32, lineHeight: 1 }}>{value || '📦'}</span>
          }
        </button>
        <div>
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>
            {isImage ? 'Custom image uploaded' : value ? 'Custom icon selected' : 'Using category default'}
          </div>
          {value && (
            <button
              type="button"
              onClick={() => { onChange(''); setOpen(false); }}
              style={{ fontSize: 12, color: 'var(--red)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginTop: 2 }}
            >
              ✕ Remove custom icon
            </button>
          )}
        </div>
      </div>

      {/* Dropdown */}
      {open && (
        <div style={{
          position: 'absolute', top: 62, left: 0, zIndex: 200,
          background: 'white', border: '1.5px solid var(--border)',
          borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-lg)',
          padding: 14, width: 310,
        }}>
          {/* Emoji grid */}
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8, fontWeight: 600 }}>SELECT AN EMOJI</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 4, maxHeight: 220, overflowY: 'auto' }}>
            {EMOJIS.map(em => (
              <button
                key={em}
                type="button"
                onClick={() => { onChange(em); setOpen(false); }}
                style={{
                  fontSize: 22, padding: 4, borderRadius: 6, border: 'none',
                  background: value === em ? '#dbeafe' : 'transparent',
                  cursor: 'pointer', lineHeight: 1,
                }}
                title={em}
              >
                {em}
              </button>
            ))}
          </div>

          {/* Divider */}
          <div style={{ margin: '12px 0', borderTop: '1px solid var(--border)' }} />

          {/* Upload section */}
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8, fontWeight: 600 }}>UPLOAD CUSTOM IMAGE</div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handleFile}
          />
          <button
            type="button"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
            style={{
              width: '100%', padding: '9px 12px', borderRadius: 'var(--radius-sm)',
              border: '1.5px dashed var(--border)', background: 'var(--off)',
              cursor: uploading ? 'wait' : 'pointer', fontSize: 13, fontWeight: 600,
              color: 'var(--navy)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
            }}
          >
            {uploading ? '⏳ Processing…' : '🖼️ Choose image from computer'}
          </button>
          {isImage && (
            <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--green)' }}>
              <img src={value} alt="" style={{ width: 24, height: 24, objectFit: 'contain', borderRadius: 4, border: '1px solid var(--border)' }} />
              Custom image in use
            </div>
          )}
          {uploadErr && <div style={{ marginTop: 6, fontSize: 12, color: 'var(--red)' }}>⚠️ {uploadErr}</div>}
          <div style={{ marginTop: 6, fontSize: 11, color: 'var(--muted)' }}>PNG, JPG, SVG, WebP — max 2 MB. Auto-resized to 72 × 72 px.</div>

          <button
            type="button"
            onClick={() => setOpen(false)}
            style={{ marginTop: 12, fontSize: 12, color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
          >
            Close
          </button>
        </div>
      )}
    </div>
  );
}
