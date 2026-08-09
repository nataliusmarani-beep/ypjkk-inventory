const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');

// Photos and signatures live on the Railway volume, next to the database — never
// inside SQLite. Keeps the DB small and backups quick.
const UPLOAD_DIR = process.env.UPLOAD_DIR
  || (process.env.DB_PATH
        ? path.join(path.dirname(process.env.DB_PATH), 'uploads')
        : path.join(__dirname, '..', 'uploads'));

for (const sub of ['photos', 'signatures', 'documents']) {
  const dir = path.join(UPLOAD_DIR, sub);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// Storage budget, per file type. Parents may pick a photo of up to 2 MB, but the
// browser re-encodes it before upload so that what actually lands on the Railway
// volume is at most 100 KB — enough for the 84×104 pt card photo at 3× density
// and for the admin's zoomed review, and small enough that a full intake of ~250
// students costs well under 30 MB.
const MAX_PHOTO_BYTES      = 100 * 1024;
const MAX_SIGNATURE_BYTES  = 150 * 1024;   // a drawn PNG runs 5–30 KB in practice
// A scanned permission letter or event flyer, not a re-encoded camera photo —
// no client-side compression happens for these, so the budget is generous.
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

const EXT_BY_MIME = {
  'image/jpeg':     'jpg',
  'image/jpg':      'jpg',
  'image/png':      'png',
  'image/webp':     'webp',
  'application/pdf': 'pdf',
};

const IMAGE_MIMES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);

/**
 * Saves a browser data URL ("data:image/jpeg;base64,...") to the volume.
 * Returns the stored file name, which is what goes in the database.
 *
 * `allowedMimes` defaults to images only (photos, signatures); event bus
 * request attachments pass IMAGE_MIMES plus 'application/pdf' explicitly.
 */
function saveDataUrl(dataUrl, folder, prefix, maxBytes = MAX_PHOTO_BYTES, allowedMimes = IMAGE_MIMES) {
  if (typeof dataUrl !== 'string') throw badRequest('Berkas tidak ditemukan.');

  const match = /^data:([a-z/+.-]+);base64,(.+)$/i.exec(dataUrl.trim());
  if (!match) throw badRequest('Format berkas tidak dikenali.');

  const [, mimeRaw, base64] = match;
  const mime = mimeRaw.toLowerCase();
  const ext = EXT_BY_MIME[mime];
  if (!ext || !allowedMimes.has(mime)) {
    throw badRequest(allowedMimes === IMAGE_MIMES
      ? 'Hanya berkas gambar JPG, PNG atau WEBP yang diterima.'
      : 'Hanya berkas PDF, JPG, PNG atau WEBP yang diterima.');
  }

  const buffer = Buffer.from(base64, 'base64');
  if (buffer.length === 0) throw badRequest('Berkas kosong.');

  // The browser is expected to have compressed this already; the cap is enforced
  // here too so a modified or failed client can never fill the volume.
  if (buffer.length > maxBytes) {
    throw badRequest(
      `Ukuran berkas ${formatBytes(buffer.length)} melebihi batas penyimpanan `
      + `${formatBytes(maxBytes)}.`);
  }

  const fileName = `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, folder, fileName), buffer);
  return { fileName, mimeType: mime.toLowerCase(), sizeBytes: buffer.length };
}

// Never trust a name coming from a URL: strip anything that could escape the dir.
function resolveStored(folder, fileName) {
  if (!fileName || fileName.includes('/') || fileName.includes('\\') || fileName.includes('..')) {
    return null;
  }
  const full = path.join(UPLOAD_DIR, folder, path.basename(fileName));
  return fs.existsSync(full) ? full : null;
}

function removeStored(folder, fileName) {
  const full = resolveStored(folder, fileName);
  if (full) {
    try { fs.unlinkSync(full); } catch { /* already gone — nothing to do */ }
  }
}

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

const formatBytes = (n) => (n >= 1024 * 1024
  ? `${(n / (1024 * 1024)).toFixed(1)} MB`
  : `${Math.round(n / 1024)} KB`);

const ATTACHMENT_MIMES = new Set([...IMAGE_MIMES, 'application/pdf']);

module.exports = {
  UPLOAD_DIR,
  MAX_PHOTO_BYTES,
  MAX_SIGNATURE_BYTES,
  MAX_ATTACHMENT_BYTES,
  ATTACHMENT_MIMES,
  saveDataUrl,
  resolveStored,
  removeStored,
};
