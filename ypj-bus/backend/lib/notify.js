require('dotenv').config();
const db = require('../db');

// ── Resend HTTP API (same approach as the Inventory app — avoids Railway's
// IPv6 problems with SMTP) ─────────────────────────────────────────────────
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_NAME   = 'YPJ Bis Sekolah';
const FROM_DOMAIN = process.env.MAIL_FROM_DOMAIN || 'ypj.sch.id';
const FROM        = `"${FROM_NAME}" <noreply@${FROM_DOMAIN}>`;
const APP_URL     = process.env.FRONTEND_URL || 'http://localhost:5173';

async function sendMail({ to, subject, html }) {
  if (!RESEND_API_KEY) {
    console.warn('[notify] RESEND_API_KEY not set — skipping email to', to);
    return;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({ from: FROM, to, subject, html }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Resend API ${res.status}: ${body}`);
  }
}

function layout(title, bodyHtml) {
  return `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;color:#121826">
      <div style="background:#13407A;padding:18px 22px;border-radius:12px 12px 0 0">
        <div style="color:#F5B301;font-size:11px;font-weight:700;letter-spacing:1.2px">YPJ KUALA KENCANA</div>
        <div style="color:#fff;font-size:17px;font-weight:700;margin-top:2px">${title}</div>
      </div>
      <div style="border:1px solid #D5D9E3;border-top:0;border-radius:0 0 12px 12px;padding:22px;font-size:14px;line-height:1.6">
        ${bodyHtml}
        <p style="margin-top:22px">
          <a href="${APP_URL}" style="background:#13407A;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">Buka Aplikasi</a>
        </p>
        <p style="color:#5A6376;font-size:12px;margin-top:18px">
          Bantuan: Yoce Pallo (0823 4444 75224) &middot; Natalius Marani (0813 4433 7315)
        </p>
      </div>
    </div>`;
}

/**
 * Records an in-app notification and, when an email address is known, sends the
 * same message by email. Never throws — a failed notification must not roll back
 * an approval that already happened.
 */
function notify({ userId, template, title, body, payload, email, subject }) {
  try {
    db.prepare(`
      INSERT INTO notifications (user_id, template, title, body, payload)
      VALUES (?, ?, ?, ?, ?)
    `).run(userId, template, title, body || null, payload ? JSON.stringify(payload) : null);
  } catch (e) {
    console.error('[notify] Could not store notification:', e.message);
  }

  if (email) {
    sendMail({
      to: email,
      subject: subject || title,
      html: layout(title, `<p>${(body || '').replace(/\n/g, '<br>')}</p>`),
    }).catch((e) => console.error('[notify] Email failed:', e.message));
  }
}

// ── Message templates ──────────────────────────────────────────────────────

const templates = {
  submitted: (app, student) => ({
    template: 'application.submitted',
    title: 'Pengajuan bis diterima',
    body: `Pengajuan untuk ${student.full_name} (${gradeLabel(student.grade)}) telah kami terima `
        + `dengan nomor ${app.application_no}.\n\n`
        + `Tim Transportasi YPJ akan memverifikasi data dan kapasitas rute. Kartu Akses Bis `
        + `diterbitkan otomatis di aplikasi setelah pengajuan disetujui.`,
  }),

  approved: (app, student, card) => ({
    template: 'card.issued',
    title: 'Kartu Akses Bis sudah terbit',
    body: `Pengajuan ${app.application_no} untuk ${student.full_name} DISETUJUI.\n\n`
        + `Nomor kartu: ${card.card_no}\nTransit ID: ${card.transit_id}\n`
        + `Berlaku hingga: ${card.valid_until}\n\n`
        + `Buka aplikasi untuk melihat, menyimpan, atau membagikan kartu. Tunjukkan kartu `
        + `kepada petugas bis setiap kali naik.`,
  }),

  rejected: (app, student, reason) => ({
    template: 'application.rejected',
    title: 'Pengajuan bis ditolak',
    body: `Pengajuan ${app.application_no} untuk ${student.full_name} belum dapat disetujui.\n\n`
        + `Alasan: ${reason}\n\nAnda dapat memperbaiki data dan mengirim pengajuan kembali.`,
  }),

  revision: (app, student, note) => ({
    template: 'application.revision_requested',
    title: 'Pengajuan bis perlu diperbaiki',
    body: `Pengajuan ${app.application_no} untuk ${student.full_name} memerlukan perbaikan.\n\n`
        + `Catatan Tim Transportasi: ${note}\n\nSilakan perbaiki lalu kirim ulang.`,
  }),

  // Sent when a transport_admin's revision request turns out to be a
  // mistake and a super_admin withdraws it — the parent already got the
  // "perlu diperbaiki" notice, so they need the explicit all-clear.
  revisionCancelled: (app, student) => ({
    template: 'application.revision_cancelled',
    title: 'Permintaan perbaikan dibatalkan',
    body: `Permintaan perbaikan data untuk pengajuan ${app.application_no} (${student.full_name}) `
        + `telah dibatalkan oleh Tim Transportasi. Tidak ada tindakan yang perlu Anda lakukan — `
        + `pengajuan sedang ditinjau kembali.`,
  }),

  // Parent asks to fix data on an application that's already approved (e.g. a
  // blurry photo caught after the fact) — sent to Tim Transportasi, who must
  // sign off before write access reopens (see routes/admin.js's edit-request
  // approve/deny).
  editRequestForSchool: (app, student, parent, note) => ({
    template: 'application.edit_requested',
    title: `Permintaan edit data: ${student.full_name}`,
    body: `${parent.name} meminta izin mengubah data pengajuan ${app.application_no} `
        + `(${student.full_name}, ${gradeLabel(student.grade)}).\n\nAlasan: ${note}`,
  }),

  editRequestApproved: (app, student) => ({
    template: 'application.edit_request_approved',
    title: 'Anda dapat mengedit data sekarang',
    body: `Permintaan perubahan data untuk ${student.full_name} (${app.application_no}) `
        + `telah disetujui. Buka pengajuan ini di beranda untuk memperbarui datanya.`,
  }),

  editRequestDenied: (app, student, reason) => ({
    template: 'application.edit_request_denied',
    title: 'Permintaan edit data belum disetujui',
    body: `Permintaan perubahan data untuk ${student.full_name} (${app.application_no}) `
        + `belum dapat disetujui.${reason ? `\n\nCatatan Tim Transportasi: ${reason}` : ''}`,
  }),

  sanction: (student, action, reason) => ({
    template: action === 'revocation' ? 'card.revoked' : 'card.suspended',
    title: action === 'revocation'
      ? 'Hak pengguna bis dicabut'
      : 'Hak pengguna bis ditangguhkan',
    body: `Kartu Akses Bis ${student.full_name} `
        + `${action === 'revocation' ? 'DICABUT secara permanen' : 'DITANGGUHKAN'}.\n\n`
        + `Alasan: ${reason}\n\nKetentuan ini sesuai pernyataan persetujuan yang Anda `
        + `tandatangani pada saat pendaftaran.`,
  }),

  // Sent to every Transport Team member when a parent files a complaint —
  // rules v1.1 §III.A names the Penanggung Jawab Transportasi as the escalation
  // point, so this is that channel made concrete instead of relying on parents
  // finding a phone number.
  complaintForSchool: (complaint, parent, student) => ({
    template: 'complaint.received',
    title: `Keluhan baru: ${complaint.subject}`,
    body: `Dari: ${parent.name} (${parent.email})`
        + `${parent.phone_primary ? ` · ${parent.phone_primary}` : ''}\n`
        + `${student ? `Siswa: ${student.full_name} (${gradeLabel(student.grade)})\n` : ''}`
        + `Waktu: ${complaint.created_at} WIT\n\n${complaint.message}`,
  }),

  // Sent to parents waiting at the NEXT stop when the bus leaves the one before
  // it. Deliberately in-app only (see routes/scan.js): a departure notice per
  // stop per run would be two emails a day per family.
  busApproaching: (bus, fromStop, toStop, student, eta) => ({
    template: 'trip.approaching',
    title: `Bis menuju ${toStop.code}`,
    body: `Bis ${bus.plate_number}${bus.label ? ` (${bus.label})` : ''} baru saja `
        + `berangkat dari ${fromStop.code} ${fromStop.name}.\n\n`
        + `Titik penjemputan ${student.full_name}: ${toStop.code} ${toStop.name}`
        + `${eta ? `\nPerkiraan tiba: ${eta} WIT` : ''}\n\n`
        + `Mohon penjemput sudah berada di titik penjemputan.`,
  }),

  // Ad-hoc admin broadcast to every parent currently riding a given bus or
  // route — delays, route changes, emergency info. Unlike busApproaching this
  // always goes by email too: it is rare and always something a parent needs
  // to act on immediately, not a routine per-stop update.
  broadcast: (subject, message) => ({
    template: 'admin.broadcast',
    title: subject,
    body: message,
  }),

  complaintReceipt: (complaint) => ({
    template: 'complaint.receipt',
    title: 'Keluhan Anda telah terkirim',
    body: `Keluhan "${complaint.subject}" telah kami teruskan ke Tim Transportasi YPJ `
        + `melalui email dan akan ditindaklanjuti.\n\nIsi keluhan Anda:\n${complaint.message}`,
  }),
};

const GRADE_LABELS = {
  toddler: 'Toddler', playgroup: 'Playgroup', tk_a: 'TK A', tk_b: 'TK B',
};
const gradeLabel = (g) => GRADE_LABELS[g] || `Kelas ${String(g).replace('kelas_', '')}`;

module.exports = { notify, sendMail, templates, gradeLabel, layout };
