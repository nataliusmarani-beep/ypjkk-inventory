const express = require('express');
const jwt     = require('jsonwebtoken');
const db      = require('../db');
const {
  saveDataUrl, removeStored, MAX_PHOTO_BYTES, MAX_SIGNATURE_BYTES,
} = require('../lib/files');
const { notify, templates } = require('../lib/notify');
const {
  GRADES, PARENT_CATEGORY_KEYS, currentAcademicYear, nextApplicationNo,
  assertSubmittable, logActivity, fail,
} = require('../lib/cards');

const router = express.Router();

// Matches routes/auth.js's own cookie — kept in sync manually since email
// changes here must reissue the same session cookie or req.user.email goes
// stale (still the pre-edit address) until the parent logs in again.
const SECRET = process.env.JWT_SECRET || 'ypjkk-bus-2025-secret-key';
const IS_PROD = process.env.NODE_ENV === 'production';
const COOKIE_OPTS = {
  httpOnly: true, secure: IS_PROD, sameSite: IS_PROD ? 'strict' : 'lax',
  maxAge: 8 * 60 * 60 * 1000, path: '/',
};

// GET /api/applications — the parent's own submissions, newest first.
router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT a.id, a.application_no, a.status, a.submitted_at, a.reviewed_at,
           a.rejection_reason, a.revision_note, a.edit_requested_at,
           s.id AS student_id, s.full_name AS student_name, s.grade, s.photo_file,
           rq.code AS requested_stop_code, rq.name AS requested_stop_name,
           asg.code AS assigned_stop_code,  asg.name AS assigned_stop_name,
           r.code AS route_code, r.name AS route_name,
           c.id AS card_id, c.card_no, c.transit_id, c.status AS card_status,
           c.valid_until
    FROM applications a
    JOIN students  s  ON s.id  = a.student_id
    JOIN bus_stops rq ON rq.id = a.requested_stop_id
    LEFT JOIN bus_stops asg ON asg.id = a.assigned_stop_id
    LEFT JOIN routes    r   ON r.id  = a.assigned_route_id
    LEFT JOIN bus_id_cards c ON c.application_id = a.id
    WHERE a.parent_id = ?
    ORDER BY a.created_at DESC
  `).all(req.user.id);
  res.json(rows);
});

/**
 * POST /api/applications — one call submits the whole form.
 *
 * The four form steps arrive together because a half-saved application is worse
 * than none: the parent would have no way to tell what the Transport Team can
 * see. Everything is written inside a transaction, so a failure anywhere leaves
 * no orphan student row or stray upload.
 *
 * Body: { parent:{...}, student:{full_name, grade, nis, photo}, requested_stop_id,
 *         consent:{rule_document_id, signer_name, signature, agreed_to_rules,
 *                  acknowledged_revocation}, notes_for_admin }
 */
router.post('/', (req, res, next) => {
  const b = req.body || {};
  const saved = [];        // files written so far, removed again if we roll back
  const stalePhotos = [];  // superseded photos, deleted only after a commit

  try {
    const student = b.student || {};
    const consent = b.consent || {};

    const parent = b.parent || {};

    // ── Validate before touching disk ─────────────────────────────────────
    if (!student.full_name?.trim())  throw fail(400, 'Nama lengkap anak wajib diisi.');
    if (!GRADES.includes(student.grade)) throw fail(400, 'Kelas tidak valid.');
    if (!PARENT_CATEGORY_KEYS.includes(parent.parent_category)) {
      throw fail(400, 'Kategori Orang Tua wajib dipilih.');
    }
    if (!b.requested_stop_id)        throw fail(400, 'Titik penjemputan wajib dipilih.');
    if (!student.photo)              throw fail(400, 'Foto siswa wajib diunggah.');
    if (!consent.signature)          throw fail(400, 'Tanda tangan elektronik wajib diisi.');
    if (!consent.signer_name?.trim())throw fail(400, 'Nama penanda tangan wajib diisi.');
    if (!consent.agreed_to_rules)    throw fail(400, 'Anda harus menyetujui Peraturan Bis Sekolah YPJ.');
    if (!consent.acknowledged_revocation) {
      throw fail(400, 'Anda harus menyetujui ketentuan pencabutan hak pengguna bis.');
    }

    const stop = db.prepare(`SELECT * FROM bus_stops WHERE id = ? AND is_active = 1`)
      .get(b.requested_stop_id);
    if (!stop) throw fail(400, 'Titik penjemputan tidak ditemukan.');

    const rules = consent.rule_document_id
      ? db.prepare(`SELECT * FROM rule_documents WHERE id = ?`).get(consent.rule_document_id)
      : db.prepare(`
          SELECT * FROM rule_documents WHERE published_at IS NOT NULL
          ORDER BY effective_from DESC, id DESC LIMIT 1
        `).get();
    if (!rules) throw fail(500, 'Dokumen peraturan belum tersedia.');

    const year = currentAcademicYear();

    // ── Files first: if a write fails we have not touched the database ─────
    const photo = saveDataUrl(student.photo, 'photos', 'student', MAX_PHOTO_BYTES);
    saved.push(['photos', photo.fileName]);
    const signature = saveDataUrl(
      consent.signature, 'signatures', 'sign', MAX_SIGNATURE_BYTES);
    saved.push(['signatures', signature.fileName]);

    db.exec('BEGIN');

    // Parent contact details (Q1–Q6) are stored on the account itself.
    const p = parent;
    db.prepare(`
      UPDATE users
      SET name = COALESCE(?, name),
          phone_primary = COALESCE(?, phone_primary),
          phone_alternate = ?, phone_alternate_owner = ?,
          employee_id = COALESCE(?, employee_id),
          parent_category = ?,
          department = ?, home_address = COALESCE(?, home_address),
          updated_at = datetime('now')
      WHERE id = ?
    `).run(
      p.name?.trim() || null, p.phone_primary?.trim() || null,
      p.phone_alternate?.trim() || null, p.phone_alternate_owner?.trim() || null,
      p.employee_id?.trim() || null, p.parent_category,
      p.department?.trim() || null,
      p.home_address?.trim() || null, req.user.id,
    );

    // Reuse the child's existing record when this parent has registered them
    // before — otherwise a second submission for the same child would create a
    // second student row and slip past the one-application-per-student index,
    // which is precisely how the 2024/25 export ended up with duplicate pairs.
    const existingStudent = db.prepare(`
      SELECT * FROM students
      WHERE parent_id = ? AND lower(trim(full_name)) = lower(trim(?))
        AND grade = ? AND is_active = 1
    `).get(req.user.id, student.full_name, student.grade);

    let studentId;
    if (existingStudent) {
      studentId = existingStudent.id;
      db.prepare(`
        UPDATE students SET nis = COALESCE(?, nis), photo_file = ? WHERE id = ?
      `).run(student.nis?.trim() || null, photo.fileName, studentId);
      if (existingStudent.photo_file && existingStudent.photo_file !== photo.fileName) {
        stalePhotos.push(existingStudent.photo_file);
      }
    } else {
      const studentInfo = db.prepare(`
        INSERT INTO students (parent_id, full_name, grade, nis, photo_file)
        VALUES (?, ?, ?, ?, ?)
      `).run(req.user.id, student.full_name.trim(), student.grade,
             student.nis?.trim() || null, photo.fileName);
      studentId = Number(studentInfo.lastInsertRowid);
    }

    const appInfo = db.prepare(`
      INSERT INTO applications
        (application_no, academic_year_id, student_id, parent_id, requested_stop_id,
         status, notes_for_admin, submitted_at, submitted_snapshot)
      VALUES (?, ?, ?, ?, ?, 'submitted', ?, datetime('now'), ?)
    `).run(
      nextApplicationNo(year), year.id, studentId, req.user.id, stop.id,
      b.notes_for_admin?.trim() || null,
      JSON.stringify({
        parent: {
          name: parent.name, phone_primary: parent.phone_primary,
          phone_alternate: parent.phone_alternate,
          employee_id: parent.employee_id, parent_category: parent.parent_category,
          department: parent.department,
          home_address: parent.home_address, email: req.user.email,
        },
        student: { full_name: student.full_name, grade: student.grade, nis: student.nis },
        requested_stop: { code: stop.code, name: stop.name },
        rules_version: rules.version,
      }),
    );
    const applicationId = Number(appInfo.lastInsertRowid);

    db.prepare(`
      INSERT INTO application_documents
        (application_id, doc_type, file_name, mime_type, size_bytes)
      VALUES (?, 'student_photo', ?, ?, ?)
    `).run(applicationId, photo.fileName, photo.mimeType, photo.sizeBytes);

    // Legal evidence: the exact rules version, both acknowledgements, the drawn
    // signature, and who/where/when. Never updated after this insert.
    db.prepare(`
      INSERT INTO consents
        (application_id, rule_document_id, signer_id, signer_name,
         agreed_to_rules, acknowledged_revocation, signature_file,
         ip_address, user_agent)
      VALUES (?, ?, ?, ?, 1, 1, ?, ?, ?)
    `).run(applicationId, rules.id, req.user.id, consent.signer_name.trim(),
           signature.fileName, req.ip || null,
           (req.headers['user-agent'] || '').slice(0, 500));

    // Same gate the admin approve route uses, so a bad row can never exist.
    assertSubmittable(applicationId);

    const app = db.prepare(`SELECT * FROM applications WHERE id = ?`).get(applicationId);
    db.exec('COMMIT');

    // Safe now that the new photo is committed.
    for (const name of stalePhotos) removeStored('photos', name);

    const studentRow = db.prepare(`SELECT * FROM students WHERE id = ?`).get(app.student_id);
    logActivity(req, 'application.submitted', 'applications', app.id,
                { application_no: app.application_no });
    notify({
      userId: req.user.id, email: req.user.email,
      ...templates.submitted(app, studentRow),
    });

    res.status(201).json({
      id: app.id,
      application_no: app.application_no,
      status: app.status,
    });
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* no open transaction */ }
    for (const [folder, name] of saved) removeStored(folder, name);

    // The partial unique index is what enforces "1 form 1 siswa".
    if (/UNIQUE constraint failed: applications\.student_id/.test(err.message)) {
      return res.status(409).json({
        error: 'Siswa ini sudah memiliki pengajuan aktif untuk tahun ajaran ini.',
      });
    }
    // Belt-and-suspenders for nextApplicationNo() (lib/cards.js): should not
    // happen now that numbering is MAX-based instead of COUNT-based, but a
    // 409 telling the parent to retry is far better than the generic 500
    // that this exact collision used to produce for every submission.
    if (/UNIQUE constraint failed: applications\.application_no/.test(err.message)) {
      return res.status(409).json({
        error: 'Nomor pengajuan bentrok, silakan coba kirim ulang.',
      });
    }
    next(err);
  }
});

// GET /api/applications/:id — one submission, full detail, for the edit form.
router.get('/:id', (req, res) => {
  const app = db.prepare(`
    SELECT a.*, s.full_name AS student_name, s.grade, s.nis, s.photo_file
    FROM applications a JOIN students s ON s.id = a.student_id
    WHERE a.id = ? AND a.parent_id = ?
  `).get(req.params.id, req.user.id);
  if (!app) return res.status(404).json({ error: 'Pengajuan tidak ditemukan.' });

  const parent = db.prepare(`SELECT * FROM users WHERE id = ?`).get(req.user.id);
  res.json({
    ...app,
    parent: {
      name: parent.name, phone_primary: parent.phone_primary,
      phone_alternate: parent.phone_alternate, phone_alternate_owner: parent.phone_alternate_owner,
      employee_id: parent.employee_id, parent_category: parent.parent_category,
      department: parent.department, home_address: parent.home_address, email: parent.email,
    },
  });
});

/**
 * PUT /api/applications/:id — the parent's own correction after "Perlu
 * Perbaikan" (or after an approved edit-request unlocks it the same way —
 * both leave status = 'revision_requested').
 *
 * Deliberately narrower than the create form: only the fields that can go
 * wrong at intake (student name/grade/nis/photo, requested stop, parent
 * contact details, note to admin). Consent and signature are not re-asked —
 * this is a correction to what was already agreed to, not a new agreement.
 */
router.put('/:id', (req, res, next) => {
  const b = req.body || {};
  const saved = [];
  const stalePhotos = [];

  try {
    const app = db.prepare(`SELECT * FROM applications WHERE id = ? AND parent_id = ?`)
      .get(req.params.id, req.user.id);
    if (!app) throw fail(404, 'Pengajuan tidak ditemukan.');
    if (app.status !== 'revision_requested') {
      throw fail(409, 'Pengajuan ini tidak sedang menunggu perbaikan.');
    }

    const student = b.student || {};
    const parent = b.parent || {};

    if (!student.full_name?.trim())      throw fail(400, 'Nama lengkap anak wajib diisi.');
    if (!GRADES.includes(student.grade)) throw fail(400, 'Kelas tidak valid.');
    if (!b.requested_stop_id)            throw fail(400, 'Titik penjemputan wajib dipilih.');

    const stop = db.prepare(`SELECT * FROM bus_stops WHERE id = ? AND is_active = 1`)
      .get(b.requested_stop_id);
    if (!stop) throw fail(400, 'Titik penjemputan tidak ditemukan.');

    // Email is optional here (most corrections don't touch it), but when
    // present it replaces the login email outright — this is how a parent
    // fixes a typo'd address made at first registration (see the Iwanggin
    // support case: registered as "aiwanggi@fmi.com" instead of their real
    // "aiwanggin@fmi.com" and could never log in again to notice).
    let newEmail = null;
    if (parent.email?.trim()) {
      newEmail = parent.email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
        throw fail(400, 'Format email tidak valid.');
      }
      const taken = db.prepare(`SELECT id FROM users WHERE email = ? AND id <> ?`)
        .get(newEmail, req.user.id);
      if (taken) throw fail(409, 'Email ini sudah digunakan oleh akun lain.');
    }

    const existingStudent = db.prepare(`SELECT * FROM students WHERE id = ?`).get(app.student_id);

    // Photo is optional here — most corrections don't touch it, and re-asking
    // for one every edit would be a step backwards from "fix what's wrong."
    let photoFile = existingStudent.photo_file;
    let newPhoto = null;
    if (student.photo) {
      newPhoto = saveDataUrl(student.photo, 'photos', 'student', MAX_PHOTO_BYTES);
      saved.push(['photos', newPhoto.fileName]);
      photoFile = newPhoto.fileName;
    }

    db.exec('BEGIN');

    db.prepare(`
      UPDATE users
      SET name = COALESCE(?, name),
          email = COALESCE(?, email),
          phone_primary = COALESCE(?, phone_primary),
          phone_alternate = ?, phone_alternate_owner = ?,
          employee_id = COALESCE(?, employee_id),
          parent_category = COALESCE(?, parent_category),
          department = ?, home_address = COALESCE(?, home_address),
          updated_at = datetime('now')
      WHERE id = ?
    `).run(
      parent.name?.trim() || null, newEmail,
      parent.phone_primary?.trim() || null,
      parent.phone_alternate?.trim() || null, parent.phone_alternate_owner?.trim() || null,
      parent.employee_id?.trim() || null, parent.parent_category || null,
      parent.department?.trim() || null, parent.home_address?.trim() || null,
      req.user.id,
    );

    db.prepare(`
      UPDATE students SET full_name = ?, grade = ?, nis = ?, photo_file = ? WHERE id = ?
    `).run(student.full_name.trim(), student.grade, student.nis?.trim() || null, photoFile, app.student_id);

    if (existingStudent.photo_file && photoFile !== existingStudent.photo_file) {
      stalePhotos.push(existingStudent.photo_file);
    }

    // issueCard() (lib/cards.js) reads the photo from application_documents
    // first, students.photo_file only as a fallback — so re-approval after
    // this edit would keep stamping the card with the *original* submission's
    // photo unless this row is kept in sync too.
    if (newPhoto) {
      db.prepare(`
        UPDATE application_documents
        SET file_name = ?, mime_type = ?, size_bytes = ?, uploaded_at = datetime('now')
        WHERE application_id = ? AND doc_type = 'student_photo'
      `).run(newPhoto.fileName, newPhoto.mimeType, newPhoto.sizeBytes, app.id);
    }

    db.prepare(`
      UPDATE applications
      SET status = 'submitted', revision_note = NULL, requested_stop_id = ?,
          notes_for_admin = ?, submitted_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ?
    `).run(stop.id, b.notes_for_admin?.trim() || null, app.id);

    const updated = db.prepare(`SELECT * FROM applications WHERE id = ?`).get(app.id);
    db.exec('COMMIT');
    for (const name of stalePhotos) removeStored('photos', name);

    logActivity(req, 'application.resubmitted', 'applications', app.id,
                newEmail && newEmail !== req.user.email ? { email_changed: true } : null);

    // The confirmation goes to whichever address is now on file — if the
    // parent just fixed a typo'd email, sending to the old (broken) one
    // would defeat the point.
    const notifyEmail = newEmail || req.user.email;
    const studentRow = db.prepare(`SELECT * FROM students WHERE id = ?`).get(app.student_id);
    notify({
      userId: req.user.id, email: notifyEmail,
      ...templates.submitted(updated, studentRow),
    });

    // Keep the session cookie in sync so req.user.email doesn't go stale for
    // the rest of this login (notify() calls elsewhere in this process read
    // it straight off the JWT, not the database).
    if (newEmail && newEmail !== req.user.email) {
      const freshUser = db.prepare(`SELECT id, name, email, role FROM users WHERE id = ?`).get(req.user.id);
      res.cookie('bus_token', jwt.sign(freshUser, SECRET, { expiresIn: '8h' }), COOKIE_OPTS);
    }

    res.json({ ok: true, status: updated.status });
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* no open transaction */ }
    for (const [folder, name] of saved) removeStored(folder, name);
    next(err);
  }
});

/**
 * POST /api/applications/:id/request-edit — parent asks permission to fix
 * data on an application that's already approved (a card may already be
 * issued). Gated on Tim Transportasi's sign-off — see admin.js's
 * edit-request approve/deny, which is what actually reopens the edit form
 * (by moving status back to 'revision_requested').
 */
router.post('/:id/request-edit', (req, res, next) => {
  try {
    const app = db.prepare(`SELECT * FROM applications WHERE id = ? AND parent_id = ?`)
      .get(req.params.id, req.user.id);
    if (!app) throw fail(404, 'Pengajuan tidak ditemukan.');
    if (app.status !== 'approved') {
      throw fail(409, 'Hanya pengajuan yang sudah disetujui yang dapat diajukan perubahan.');
    }
    if (app.edit_requested_at) {
      throw fail(409, 'Permintaan perubahan data sudah dikirim, menunggu persetujuan.');
    }

    const note = (req.body?.note || '').trim();
    if (!note) throw fail(400, 'Jelaskan data apa yang perlu diperbaiki.');

    db.prepare(`
      UPDATE applications SET edit_requested_at = datetime('now'), edit_request_note = ?
      WHERE id = ?
    `).run(note, app.id);

    logActivity(req, 'application.edit_requested', 'applications', app.id, { note });

    const student = db.prepare(`SELECT * FROM students WHERE id = ?`).get(app.student_id);
    const parent  = db.prepare(`SELECT * FROM users WHERE id = ?`).get(req.user.id);
    const admins = db.prepare(`
      SELECT id, email FROM users WHERE role IN ('transport_admin','super_admin') AND is_active = 1
    `).all();
    for (const admin of admins) {
      notify({
        userId: admin.id, email: admin.email,
        ...templates.editRequestForSchool(app, student, parent, note),
      });
    }

    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/applications/:id/cancel — parent withdraws a submission.
router.post('/:id/cancel', (req, res) => {
  const app = db.prepare(`
    SELECT * FROM applications WHERE id = ? AND parent_id = ?
  `).get(req.params.id, req.user.id);

  if (!app) return res.status(404).json({ error: 'Pengajuan tidak ditemukan.' });
  if (['approved', 'cancelled'].includes(app.status)) {
    return res.status(400).json({
      error: 'Pengajuan yang sudah disetujui atau dibatalkan tidak dapat dibatalkan lagi.',
    });
  }

  db.prepare(`
    UPDATE applications SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?
  `).run(app.id);

  // A previously-approved application reopened for editing (status
  // 'revision_requested') still carries an active card — cancelling from
  // that state must revoke it, or the family keeps boarding on a withdrawn
  // application.
  db.prepare(`
    UPDATE bus_id_cards
    SET status = 'revoked', status_reason = 'Pengajuan dibatalkan oleh orang tua.',
        status_changed_at = datetime('now')
    WHERE application_id = ? AND status = 'active'
  `).run(app.id);

  logActivity(req, 'application.cancelled', 'applications', app.id, null);
  res.json({ ok: true });
});

module.exports = router;
