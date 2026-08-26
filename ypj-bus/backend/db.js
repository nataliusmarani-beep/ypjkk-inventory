const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs   = require('fs');

// In production (Railway), DB_PATH points to a persistent volume.
// Locally it stays next to this file.
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'bus.sqlite');

const DB_DIR = path.dirname(DB_PATH);
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);

db.exec(`PRAGMA journal_mode = WAL`);
db.exec(`PRAGMA foreign_keys = ON`);

// ── Schema ─────────────────────────────────────────────────────────────────
// Roles: parent | transport_admin | attendant | school_staff | driver | helper
//        | leader | admin | super_admin | contractor
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id                     INTEGER PRIMARY KEY AUTOINCREMENT,
    name                   TEXT    NOT NULL,
    email                  TEXT    NOT NULL UNIQUE,
    password_hash          TEXT,
    role                   TEXT    NOT NULL DEFAULT 'parent'
                             CHECK (role IN ('parent','transport_admin','attendant','school_staff',
                                             'driver','helper','leader','admin','super_admin')),
    -- 'No HP orang tua' on the old form allowed two numbers plus an owner note
    -- crammed into one box; here they are separate columns.
    phone_primary          TEXT,
    phone_alternate        TEXT,
    phone_alternate_owner  TEXT,
    employee_id            TEXT,                      -- 'Nomor ID'
    -- 'Kategori Orang Tua' — a fixed HR-defined eligibility category, replacing
    -- the free-text employer field. See PARENT_CATEGORY_KEYS in lib/cards.js.
    parent_category        TEXT,
    department             TEXT,
    home_address           TEXT,
    is_active              INTEGER NOT NULL DEFAULT 1,
    password_reset_token   TEXT,
    password_reset_expires TEXT,
    created_at             TEXT    DEFAULT (datetime('now')),
    updated_at             TEXT    DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS academic_years (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    code       TEXT    NOT NULL UNIQUE,               -- '2025/2026'
    short_code TEXT    NOT NULL UNIQUE,               -- '2526' (used in card numbers)
    starts_on  TEXT    NOT NULL,
    ends_on    TEXT    NOT NULL,
    is_current INTEGER NOT NULL DEFAULT 0
  );

  -- The 19 pickup points, codes and names exactly as on the original form.
  CREATE TABLE IF NOT EXISTS bus_stops (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    code          TEXT    NOT NULL UNIQUE,            -- 'TPS#17'
    name          TEXT    NOT NULL,
    area          TEXT    NOT NULL,                   -- KK | SP2 | SP3 | TIMIKA
    seat_capacity INTEGER NOT NULL DEFAULT 0,
    sort_order    INTEGER NOT NULL DEFAULT 0,
    is_active     INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS routes (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    academic_year_id INTEGER NOT NULL REFERENCES academic_years(id),
    code             TEXT    NOT NULL,                -- 'SP3-A'
    name             TEXT    NOT NULL,
    -- Where the route ends — almost always the school itself, but kept as
    -- free text rather than a fixed value since a 27/30-seat unit running
    -- several rits a day may need to say so explicitly on each one.
    destination      TEXT,
    seat_capacity    INTEGER NOT NULL DEFAULT 0,
    is_active        INTEGER NOT NULL DEFAULT 1,
    UNIQUE (academic_year_id, code)
  );

  CREATE TABLE IF NOT EXISTS route_stops (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    route_id    INTEGER NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
    bus_stop_id INTEGER NOT NULL REFERENCES bus_stops(id),
    sequence    INTEGER NOT NULL,
    pickup_time TEXT,
    UNIQUE (route_id, bus_stop_id)
  );

  -- "Nomor tugas" — 8 fixed slots (besar×1-4, kecil×1-4). Which PHYSICAL bus
  -- currently holds a given slot rotates weekly (see resolveDutySchedule in
  -- lib/cards.js) — this table is just the slot's identity, not tied to any
  -- one bus_id. bus_group is derived from buses.seat_capacity elsewhere
  -- (>=45 = besar), not stored redundantly here.
  CREATE TABLE IF NOT EXISTS duty_slots (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    bus_group   TEXT    NOT NULL CHECK (bus_group IN ('besar', 'kecil')),
    duty_number INTEGER NOT NULL CHECK (duty_number BETWEEN 1 AND 8),
    -- NULL (the common case): this slot rotates weekly among the group's
    -- duty_order_{besar,kecil} pool, same as always. Set: this slot is
    -- permanently held by one specific bus and takes no part in the weekly
    -- rotation math at all — for a unit whose route genuinely stands on its
    -- own (see the "Tugas 5" kecil slot, added for a bus that only needs to
    -- coordinate with the rotating pool on the afternoon teacher run, not
    -- swap identities with it week to week).
    fixed_bus_id INTEGER REFERENCES buses(id),
    UNIQUE (bus_group, duty_number)
  );

  -- A duty slot's own TPS list for the morning pickup round(s), PER WEEKDAY
  -- (1=Senin .. 5=Jumat) — same shape and meaning as bus_route_stops (see
  -- that table's comment), just keyed to the slot+weekday instead of a
  -- bus_id, so it survives the weekly rotation and can differ day to day.
  -- Small buses in particular split dropoff coverage across days (unit A
  -- runs a trip Senin/Rabu, unit B covers the same trip Selasa/Kamis/Jumat)
  -- — a day with nothing configured for a slot just means that bus doesn't
  -- run that trip that day, see materializeDutySchedule in lib/cards.js.
  CREATE TABLE IF NOT EXISTS duty_slot_stops (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    duty_slot_id      INTEGER NOT NULL REFERENCES duty_slots(id) ON DELETE CASCADE,
    weekday           INTEGER NOT NULL CHECK (weekday BETWEEN 1 AND 5),
    bus_stop_id       INTEGER NOT NULL REFERENCES bus_stops(id),
    sequence          INTEGER NOT NULL DEFAULT 1,
    -- JSON array parallel to duty_slot_pickup_trips, same shape/meaning as
    -- dropoff_times/dropoff_sequences below — a small unit can pick up the
    -- same TPS on more than one pickup round in a morning (e.g. a nearby TPS
    -- served again after the main run, or at a different time for a
    -- different unit like PAUD), so pickup can no longer be a single scalar.
    pickup_times      TEXT NOT NULL DEFAULT '[]',
    pickup_sequences  TEXT NOT NULL DEFAULT '[]',
    dropoff_times     TEXT NOT NULL DEFAULT '[]',
    dropoff_sequences TEXT NOT NULL DEFAULT '[]',
    UNIQUE (duty_slot_id, weekday, bus_stop_id)
  );

  -- A duty slot's afternoon dropoff legs (school → TPS), per weekday — same
  -- shape and meaning as bus_trips, keyed to the slot+weekday.
  CREATE TABLE IF NOT EXISTS duty_slot_trips (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    duty_slot_id   INTEGER NOT NULL REFERENCES duty_slots(id) ON DELETE CASCADE,
    weekday        INTEGER NOT NULL CHECK (weekday BETWEEN 1 AND 5),
    trip_number    INTEGER NOT NULL,
    departure_time TEXT,
    -- Free-text tag admin can set on this trip, e.g. 'PAUD', shown to parents.
    label          TEXT,
    UNIQUE (duty_slot_id, weekday, trip_number)
  );

  -- A duty slot's morning pickup legs (TPS → school), per weekday — mirrors
  -- duty_slot_trips exactly, just for the pickup direction. arrival_time is
  -- when THIS pickup round gets back to school (what a single
  -- duty_slot_days.school_arrival_time used to mean, back when there was
  -- only ever one pickup round).
  CREATE TABLE IF NOT EXISTS duty_slot_pickup_trips (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    duty_slot_id   INTEGER NOT NULL REFERENCES duty_slots(id) ON DELETE CASCADE,
    weekday        INTEGER NOT NULL CHECK (weekday BETWEEN 1 AND 5),
    trip_number    INTEGER NOT NULL,
    arrival_time   TEXT,
    -- Free-text tag admin can set on this trip, e.g. 'PAUD', shown to parents.
    label          TEXT,
    UNIQUE (duty_slot_id, weekday, trip_number)
  );

  -- One attribute per slot+weekday that doesn't belong to any single TPS: the
  -- pickup round's bookend time (when the bus gets back to school after
  -- finishing that day's TPS list) — same meaning buses.school_arrival_time
  -- had when this was edited per-bus. Materialized into buses.school_arrival_time
  -- alongside the TPS/trip rows, see materializeDutySchedule in lib/cards.js.
  CREATE TABLE IF NOT EXISTS duty_slot_days (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    duty_slot_id         INTEGER NOT NULL REFERENCES duty_slots(id) ON DELETE CASCADE,
    weekday              INTEGER NOT NULL CHECK (weekday BETWEEN 1 AND 5),
    school_arrival_time  TEXT,
    UNIQUE (duty_slot_id, weekday)
  );

  CREATE TABLE IF NOT EXISTS buses (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    plate_number  TEXT    NOT NULL UNIQUE,
    label         TEXT,
    seat_capacity INTEGER NOT NULL DEFAULT 0,
    route_id      INTEGER REFERENCES routes(id),
    -- Crew shown on the published schedule. Plain text on purpose: the school
    -- knows the driver's and helper's names without either of them having an
    -- app account, and requiring a users row just to print a name would block
    -- the schedule from being filled in.
    driver_name   TEXT,
    helper_name   TEXT,
    -- Kept for the separate concern of an attendant who *does* sign in to scan
    -- cards; not used for the schedule display.
    driver_id     INTEGER REFERENCES users(id),
    attendant_id  INTEGER REFERENCES users(id),
    is_active     INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS students (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    parent_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    full_name          TEXT    NOT NULL,
    -- Grade options taken verbatim from Q8 'Pilih Kelas' (Toddler..Kelas 9).
    grade              TEXT    NOT NULL,
    nis                TEXT,
    date_of_birth      TEXT,
    photo_file         TEXT,                           -- filename under UPLOAD_DIR
    special_needs_note TEXT,
    is_active          INTEGER NOT NULL DEFAULT 1,
    created_at         TEXT    DEFAULT (datetime('now'))
  );

  -- Versioned 'Peraturan dan Ketentuan Bis Sekolah YPJ'. A consent record always
  -- points at the exact version the parent was shown.
  CREATE TABLE IF NOT EXISTS rule_documents (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    version        TEXT    NOT NULL UNIQUE,
    title          TEXT    NOT NULL,
    body_md        TEXT    NOT NULL,
    effective_from TEXT    NOT NULL,
    published_at   TEXT
  );

  CREATE TABLE IF NOT EXISTS applications (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    application_no     TEXT    UNIQUE,                 -- 'YPJ-BUS-2526-00001'
    academic_year_id   INTEGER NOT NULL REFERENCES academic_years(id),
    student_id         INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    parent_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    requested_stop_id  INTEGER NOT NULL REFERENCES bus_stops(id),
    status             TEXT    NOT NULL DEFAULT 'draft'
                         CHECK (status IN ('draft','submitted','under_review',
                                           'revision_requested','approved','rejected','cancelled')),
    -- What the parent declared at submit time, so later profile edits never
    -- rewrite history.
    submitted_snapshot TEXT,
    notes_for_admin    TEXT,
    submitted_at       TEXT,
    reviewed_by        INTEGER REFERENCES users(id),
    reviewed_at        TEXT,
    rejection_reason   TEXT,
    revision_note      TEXT,
    assigned_route_id  INTEGER REFERENCES routes(id),
    assigned_stop_id   INTEGER REFERENCES bus_stops(id),
    assigned_bus_id    INTEGER REFERENCES buses(id),
    created_at         TEXT    DEFAULT (datetime('now')),
    updated_at         TEXT    DEFAULT (datetime('now')),
    CHECK (status <> 'rejected'           OR (rejection_reason IS NOT NULL AND trim(rejection_reason) <> '')),
    CHECK (status <> 'revision_requested' OR (revision_note    IS NOT NULL AND trim(revision_note)    <> '')),
    CHECK (status <> 'approved'           OR (assigned_route_id IS NOT NULL AND assigned_stop_id IS NOT NULL))
  );

  -- 'Ketentuan 1 form 1 siswa' — one live application per student per year.
  CREATE UNIQUE INDEX IF NOT EXISTS applications_one_live_per_student_year
    ON applications (student_id, academic_year_id) WHERE status <> 'cancelled';

  -- The index above only bites if the same child maps to the same student row.
  -- In the 2024/25 export the duplicate pair (rows 2 and 3) was the same child
  -- entered twice, so a parent must not be able to create a second student
  -- record with the same name and grade.
  CREATE UNIQUE INDEX IF NOT EXISTS students_unique_per_parent
    ON students (parent_id, lower(trim(full_name)), grade) WHERE is_active = 1;

  CREATE INDEX IF NOT EXISTS applications_status_idx ON applications (status, submitted_at);
  CREATE INDEX IF NOT EXISTS applications_parent_idx ON applications (parent_id);

  CREATE TABLE IF NOT EXISTS application_documents (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    doc_type       TEXT    NOT NULL
                     CHECK (doc_type IN ('student_photo','parent_id_card','proof_of_residence','other')),
    file_name      TEXT    NOT NULL,
    mime_type      TEXT    NOT NULL,
    size_bytes     INTEGER,
    uploaded_at    TEXT    DEFAULT (datetime('now')),
    UNIQUE (application_id, doc_type)
  );

  -- Legal evidence. One row per application, never updated after insert.
  CREATE TABLE IF NOT EXISTS consents (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    application_id          INTEGER NOT NULL UNIQUE REFERENCES applications(id) ON DELETE CASCADE,
    rule_document_id        INTEGER NOT NULL REFERENCES rule_documents(id),
    signer_id               INTEGER NOT NULL REFERENCES users(id),
    signer_name             TEXT    NOT NULL,
    agreed_to_rules         INTEGER NOT NULL,
    -- The clause that makes suspension/revocation enforceable.
    acknowledged_revocation INTEGER NOT NULL,
    signature_file          TEXT    NOT NULL,
    signed_at               TEXT    DEFAULT (datetime('now')),
    ip_address              TEXT,
    user_agent              TEXT,
    CHECK (agreed_to_rules = 1),
    CHECK (acknowledged_revocation = 1),
    CHECK (trim(signature_file) <> '')
  );

  CREATE TABLE IF NOT EXISTS bus_id_cards (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    card_no           TEXT    NOT NULL UNIQUE,         -- 'YPJ-BUS-2526-00001'
    transit_id        TEXT    NOT NULL UNIQUE,         -- short scannable id
    application_id    INTEGER NOT NULL UNIQUE REFERENCES applications(id) ON DELETE CASCADE,
    student_id        INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    academic_year_id  INTEGER NOT NULL REFERENCES academic_years(id),
    route_id          INTEGER NOT NULL REFERENCES routes(id),
    bus_stop_id       INTEGER NOT NULL REFERENCES bus_stops(id),
    photo_file        TEXT,
    status            TEXT    NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active','suspended','revoked','expired')),
    status_reason     TEXT,
    status_changed_at TEXT,
    issued_at         TEXT    DEFAULT (datetime('now')),
    valid_until       TEXT    NOT NULL
  );

  CREATE INDEX IF NOT EXISTS bus_id_cards_student_idx ON bus_id_cards (student_id);

  -- Rotating QR tokens: ~90 s lifetime, single use.
  CREATE TABLE IF NOT EXISTS card_tokens (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    card_id     INTEGER NOT NULL REFERENCES bus_id_cards(id) ON DELETE CASCADE,
    token_hash  TEXT    NOT NULL UNIQUE,
    issued_at   TEXT    DEFAULT (datetime('now')),
    expires_at  TEXT    NOT NULL,
    consumed_at TEXT
  );

  CREATE INDEX IF NOT EXISTS card_tokens_card_idx ON card_tokens (card_id, expires_at);

  CREATE TABLE IF NOT EXISTS scan_logs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    card_id     INTEGER REFERENCES bus_id_cards(id),
    scanned_by  INTEGER REFERENCES users(id),
    bus_id      INTEGER REFERENCES buses(id),
    bus_stop_id INTEGER REFERENCES bus_stops(id),
    direction   TEXT    NOT NULL DEFAULT 'boarding'
                  CHECK (direction IN ('boarding','alighting')),
    result      TEXT    NOT NULL
                  CHECK (result IN ('ok','ok_offline','expired','revoked','suspended',
                                    'wrong_route','unknown_card','replay')),
    scanned_at  TEXT    DEFAULT (datetime('now')),
    raw_payload TEXT
  );

  CREATE INDEX IF NOT EXISTS scan_logs_card_idx ON scan_logs (card_id, scanned_at);

  -- Categories are the ten dangerous behaviours listed in section II of the rules.
  CREATE TABLE IF NOT EXISTS violations (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id  INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    card_id     INTEGER REFERENCES bus_id_cards(id),
    category    TEXT    NOT NULL,
    severity    INTEGER NOT NULL DEFAULT 1 CHECK (severity BETWEEN 1 AND 3),
    description TEXT,
    occurred_at TEXT    DEFAULT (datetime('now')),
    bus_id      INTEGER REFERENCES buses(id),
    reported_by INTEGER REFERENCES users(id),
    created_at  TEXT    DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sanctions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id   INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    violation_id INTEGER REFERENCES violations(id),
    card_id      INTEGER REFERENCES bus_id_cards(id),
    action       TEXT    NOT NULL CHECK (action IN ('warning','suspension','revocation')),
    reason       TEXT    NOT NULL,
    starts_on    TEXT    NOT NULL DEFAULT (date('now')),
    ends_on      TEXT,                                  -- NULL = permanent
    issued_by    INTEGER REFERENCES users(id),
    created_at   TEXT    DEFAULT (datetime('now')),
    CHECK (action <> 'suspension' OR ends_on IS NOT NULL)
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    template   TEXT    NOT NULL,
    title      TEXT    NOT NULL,
    body       TEXT,
    payload    TEXT,
    read_at    TEXT,
    created_at TEXT    DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications (user_id, created_at);

  CREATE TABLE IF NOT EXISTS activity_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_id   INTEGER REFERENCES users(id),
    action     TEXT    NOT NULL,
    entity     TEXT    NOT NULL,
    entity_id  INTEGER,
    detail     TEXT,
    ip_address TEXT,
    created_at TEXT    DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS activity_entity_idx ON activity_log (entity, entity_id);

  -- "Setiap keluhan, masukan, maupun saran ... dapat disampaikan ... langsung
  -- ke Penanggung Jawab Transportasi Sekolah YPJ" (rules v1.1, section III.A).
  -- Stored here as the durable record; the Transport Team is also emailed at
  -- submit time so nothing depends on someone remembering to check the app.
  CREATE TABLE IF NOT EXISTS complaints (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    parent_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    student_id  INTEGER REFERENCES students(id) ON DELETE SET NULL,
    subject     TEXT NOT NULL,
    message     TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'baru'
                  CHECK (status IN ('baru', 'ditinjau', 'selesai')),
    resolved_by INTEGER REFERENCES users(id),
    resolved_at TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS complaints_parent_idx ON complaints (parent_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS complaints_status_idx ON complaints (status, created_at DESC);

  -- Which TPS each individual bus serves, and at what time. This is the
  -- published service schedule and it ROTATES: the Transport Team runs a weekly
  -- rolling roster, so the same unit covers different stops from week to week.
  --
  -- Deliberately separate from route_stops. A student's own TPS comes from their
  -- home address and does not change week to week; which bus happens to cover
  -- that TPS this week does. Mixing the two would make a rotation edit look like
  -- a change to every child's registration.
  CREATE TABLE IF NOT EXISTS bus_route_stops (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    bus_id       INTEGER NOT NULL REFERENCES buses(id) ON DELETE CASCADE,
    bus_stop_id  INTEGER NOT NULL REFERENCES bus_stops(id),
    sequence     INTEGER NOT NULL DEFAULT 1,
    -- JSON array parallel to bus_pickup_trips (pickup_times[i] is this
    -- stop's time on Trip i+1's morning round). A 27/30-seat unit can run
    -- more than one pickup round in a morning (e.g. a nearby TPS served
    -- again after the main run, or a separate later round for a different
    -- unit like PAUD), so — unlike when this was a single pickup_time
    -- column — pickup is no longer assumed to be one trip.
    pickup_times      TEXT NOT NULL DEFAULT '[]',
    -- JSON array parallel to pickup_times: pickup_sequences[i] is this
    -- stop's 1-based position within Trip i+1's pickup route, or null if
    -- this stop isn't part of that trip at all.
    pickup_sequences  TEXT NOT NULL DEFAULT '[]',
    -- JSON array of 'HH:MM' strings, e.g. '["15:00","16:30","18:00"]". A
    -- 27/30-seat unit returns to school between drop-offs and runs this stop
    -- again later the same afternoon.
    dropoff_times TEXT NOT NULL DEFAULT '[]',
    -- JSON array parallel to dropoff_times: dropoff_sequences[i] is this
    -- stop's 1-based position within Trip i+1's route (admin-ordered on the
    -- schedule page — "add TPS to this trip" in the order the bus actually
    -- visits them), or null if unset. A stop with no explicit sequence for a
    -- trip falls back to descending TPS numbering (bus_stops.sort_order) at
    -- read time, so existing schedules keep their current order until
    -- someone deliberately reorders them.
    dropoff_sequences TEXT NOT NULL DEFAULT '[]',
    UNIQUE (bus_id, bus_stop_id)
  );

  CREATE INDEX IF NOT EXISTS bus_route_stops_bus_idx  ON bus_route_stops (bus_id, sequence);
  CREATE INDEX IF NOT EXISTS bus_route_stops_stop_idx ON bus_route_stops (bus_stop_id);

  -- Explicit dropoff trips for a bus, e.g. Trip 1 leaving school at 13:00,
  -- Trip 2 at 14:30. This is the source of truth for how many pengantaran
  -- legs a unit runs today and when each one leaves — a stop's dropoff_times
  -- array (above) is indexed against this list (dropoff_times[0] is Trip 1's
  -- time at that stop, etc.) rather than the trip count being guessed from
  -- however many times happen to be filled in across the stop list.
  CREATE TABLE IF NOT EXISTS bus_trips (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    bus_id         INTEGER NOT NULL REFERENCES buses(id) ON DELETE CASCADE,
    trip_number    INTEGER NOT NULL,
    departure_time TEXT,
    -- Free-text tag admin can set on this trip, e.g. 'PAUD', shown to parents.
    label          TEXT,
    UNIQUE (bus_id, trip_number)
  );

  CREATE INDEX IF NOT EXISTS bus_trips_bus_idx ON bus_trips (bus_id, trip_number);

  -- Explicit pickup trips for a bus — mirrors bus_trips exactly, for the
  -- morning penjemputan direction. arrival_time is when this pickup round
  -- gets back to school (what buses.school_arrival_time meant back when a
  -- bus only ever ran one pickup round).
  CREATE TABLE IF NOT EXISTS bus_pickup_trips (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    bus_id         INTEGER NOT NULL REFERENCES buses(id) ON DELETE CASCADE,
    trip_number    INTEGER NOT NULL,
    arrival_time   TEXT,
    -- Free-text tag admin can set on this trip, e.g. 'PAUD', shown to parents.
    label          TEXT,
    UNIQUE (bus_id, trip_number)
  );

  CREATE INDEX IF NOT EXISTS bus_pickup_trips_bus_idx ON bus_pickup_trips (bus_id, trip_number);

  -- Small key/value store. First use: the label for the roster period currently
  -- published, so parents can tell which week the schedule they are reading is for.
  CREATE TABLE IF NOT EXISTS settings (
    key        TEXT PRIMARY KEY,
    value      TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Departure log: the attendant taps "Berangkat" as the bus leaves each TPS,
  -- and the parents waiting at the NEXT stop are told it is on its way.
  --
  -- This is the no-hardware substitute for GPS tracking. It answers the question
  -- parents actually have ("has the bus left yet?") without a tracker in every
  -- unit, a SIM subscription, or a live map that would stall on the SP2/SP3
  -- signal exactly when it matters.
  CREATE TABLE IF NOT EXISTS trip_events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    bus_id      INTEGER NOT NULL REFERENCES buses(id) ON DELETE CASCADE,
    bus_stop_id INTEGER REFERENCES bus_stops(id),
    direction   TEXT NOT NULL DEFAULT 'pickup'
                  CHECK (direction IN ('pickup', 'dropoff')),
    event       TEXT NOT NULL DEFAULT 'departed'
                  CHECK (event IN ('departed', 'started', 'finished')),
    recorded_by INTEGER REFERENCES users(id),
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS trip_events_bus_day_idx
    ON trip_events (bus_id, date(created_at));

  -- Two-way chat between a parent and the Transport Team.
  --
  -- One thread per parent, created on first message: with two staff accounts and
  -- ~250 families, letting parents pick a recipient would only produce messages
  -- sent to whoever is on leave. Complaints stay a separate, tracked channel
  -- (baru → ditinjau → selesai); this is for quick back-and-forth.
  CREATE TABLE IF NOT EXISTS chat_threads (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    parent_id       INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    last_message_at TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS chat_messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id   INTEGER NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
    sender_id   INTEGER NOT NULL REFERENCES users(id),
    -- Which side sent it, stored rather than derived: a staff member's role can
    -- change later, and an old message must keep reading as it was sent.
    sender_side TEXT NOT NULL CHECK (sender_side IN ('parent', 'staff')),
    body        TEXT NOT NULL,
    read_at     TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS chat_messages_thread_idx
    ON chat_messages (thread_id, id);
  CREATE INDEX IF NOT EXISTS chat_threads_recent_idx
    ON chat_threads (last_message_at DESC);

  -- Internal group channel for the people who run the bus day-to-day — Tim
  -- Transportasi, Driver, Helper — separate from the 1:1 parent threads above.
  -- One flat room, not per-bus/per-route: the team is small enough that
  -- splitting it further would just mean re-reading the same announcement in
  -- multiple places.
  CREATE TABLE IF NOT EXISTS staff_group_messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id   INTEGER NOT NULL REFERENCES users(id),
    body        TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Per-user read cursor for the group room — a group chat can't reuse the
  -- 1:1 thread's read_at-per-message approach without an N-way fan-out.
  CREATE TABLE IF NOT EXISTS staff_group_reads (
    user_id               INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    last_read_message_id  INTEGER NOT NULL DEFAULT 0
  );

  -- "Ruang Chat" — one shared room, readable by every logged-in account
  -- (parents and every staff role alike), where Tim Transportasi posts and
  -- any parent may reply. Unlike the 1:1 threads above, every reply here is
  -- visible to the whole room, not just staff — that's the point of it: a
  -- public Q&A/announcement space instead of N private conversations that
  -- all ask the same question.
  CREATE TABLE IF NOT EXISTS public_chat_messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id   INTEGER NOT NULL REFERENCES users(id),
    body        TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS public_chat_reads (
    user_id               INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    last_read_message_id  INTEGER NOT NULL DEFAULT 0
  );

  -- Daily SOP checklists ("Form Checklist & SOP Operasional Bus Sekolah"), one
  -- per bus/type/day. Item text lives in code (lib/safetyChecklists.js), not
  -- here — see that file's header comment for why this differs from the
  -- parent consent flow's submitted_snapshot approach.
  CREATE TABLE IF NOT EXISTS safety_checklists (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    bus_id         INTEGER NOT NULL REFERENCES buses(id) ON DELETE CASCADE,
    checklist_type TEXT    NOT NULL CHECK (checklist_type IN ('driver_pre_op', 'helper_safety_trip')),
    -- WIT (Asia/Jayapura, UTC+9) — plain date('now') is UTC, which stamps
    -- anything submitted before ~09:00 local with yesterday's date. This
    -- column default is a fallback only (routes/safety.js always passes an
    -- explicit WIT date), but it should agree with that when it does fire.
    checklist_date TEXT    NOT NULL DEFAULT (date('now', '+9 hours')),
    -- Who actually did the check. Plain text, same as buses.driver_name/helper_name:
    -- drivers/helpers don't have app accounts, only the staff member submitting
    -- (an attendant/school_staff/transport_admin account) does.
    crew_name      TEXT,
    submitted_by   INTEGER REFERENCES users(id),
    has_issues     INTEGER NOT NULL DEFAULT 0,
    notes          TEXT,
    created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE (bus_id, checklist_type, checklist_date)
  );

  CREATE INDEX IF NOT EXISTS safety_checklists_date_idx ON safety_checklists (checklist_date DESC);

  CREATE TABLE IF NOT EXISTS safety_checklist_items (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    checklist_id  INTEGER NOT NULL REFERENCES safety_checklists(id) ON DELETE CASCADE,
    item_key      TEXT    NOT NULL,
    status        TEXT    NOT NULL CHECK (status IN ('ok', 'not_ok')),
    note          TEXT,
    UNIQUE (checklist_id, item_key)
  );

  -- One-off bus service for a school event (field trip, ceremony, etc.) —
  -- separate from the weekly commute rotation in bus_route_stops. Raised by
  -- school admin staff or Leader, always needs Tim Transportasi's approval
  -- before it's real: this table is the request, not a booking.
  CREATE TABLE IF NOT EXISTS event_bus_requests (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    requested_by     INTEGER NOT NULL REFERENCES users(id),
    event_name       TEXT    NOT NULL,
    event_date       TEXT    NOT NULL,             -- 'YYYY-MM-DD'
    departure_time   TEXT,                          -- 'HH:MM'
    return_time      TEXT,
    destination      TEXT    NOT NULL,
    passenger_count  INTEGER,
    notes            TEXT,
    -- Optional supporting document (permission letter, event flyer): a PDF or
    -- image saved under uploads/documents, same as application_documents.
    attachment_file      TEXT,
    attachment_mime_type TEXT,
    status           TEXT    NOT NULL DEFAULT 'submitted'
                       CHECK (status IN ('submitted', 'approved', 'rejected')),
    assigned_bus_id  INTEGER REFERENCES buses(id),
    reviewed_by      INTEGER REFERENCES users(id),
    reviewed_at      TEXT,
    rejection_reason TEXT,
    created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS event_bus_requests_status_idx ON event_bus_requests (status, event_date);
`);

// ── Migration: multiple buses per event request ─────────────────────────────
// A school event can need more than one unit (e.g. a whole grade going on a
// study tour) — assigned_bus_id (single) becomes assigned_bus_ids (JSON
// array). The existing single assignment is carried over as a one-item array
// so nothing already approved goes blank; assigned_bus_id itself is left in
// place rather than dropped, since it's harmless and this avoids an
// irreversible column drop on a table that already has real approvals in it.
{
  const eventRequestColumns = db.prepare(`PRAGMA table_info(event_bus_requests)`).all().map((c) => c.name);
  if (!eventRequestColumns.includes('assigned_bus_ids')) {
    db.exec(`ALTER TABLE event_bus_requests ADD COLUMN assigned_bus_ids TEXT NOT NULL DEFAULT '[]'`);
    const rows = db.prepare(`SELECT id, assigned_bus_id FROM event_bus_requests`).all();
    const update = db.prepare(`UPDATE event_bus_requests SET assigned_bus_ids = ? WHERE id = ?`);
    for (const r of rows) {
      update.run(JSON.stringify(r.assigned_bus_id ? [r.assigned_bus_id] : []), r.id);
    }
  }
}

// ── Migration: afternoon dropoff time per stop ──────────────────────────────
// route_stops shipped with pickup_time only (the morning run). The service
// schedule shown to parents needs both legs, so the afternoon dropoff gets its
// own column. Both stay nullable — the Transport Team fills them in from the
// admin portal, and a blank time renders as "belum diatur" rather than a guess.
{
  const routeStopColumns = db.prepare(`PRAGMA table_info(route_stops)`).all().map((c) => c.name);
  if (!routeStopColumns.includes('dropoff_time')) {
    db.exec(`ALTER TABLE route_stops ADD COLUMN dropoff_time TEXT`);
  }
}

// ── Migration: multiple dropoff times per stop ───────────────────────────────
// A 27/30-seat unit that shuttles back and forth all afternoon needs several
// dropoff times at the same TPS, not one — dropoff_time (single value)
// becomes dropoff_times (JSON array). Existing single times are carried over
// as the first entry so nothing already published goes blank. Runs before the
// seed migration below, which writes to dropoff_times on existing databases.
{
  const stopColumns = db.prepare(`PRAGMA table_info(bus_route_stops)`).all().map((c) => c.name);
  if (!stopColumns.includes('dropoff_times')) {
    db.exec(`ALTER TABLE bus_route_stops ADD COLUMN dropoff_times TEXT NOT NULL DEFAULT '[]'`);
    const rows = db.prepare(`SELECT id, dropoff_time FROM bus_route_stops`).all();
    const update = db.prepare(`UPDATE bus_route_stops SET dropoff_times = ? WHERE id = ?`);
    for (const r of rows) {
      update.run(JSON.stringify(r.dropoff_time ? [r.dropoff_time] : []), r.id);
    }
    db.exec(`ALTER TABLE bus_route_stops DROP COLUMN dropoff_time`);
  }
}

// ── Migration: multiple pickup trips per stop (bus_route_stops) ────────────
// pickup_time (single value) becomes pickup_times/pickup_sequences — JSON
// arrays parallel to bus_pickup_trips, same idea as the dropoff_time →
// dropoff_times widening just above. A 27/30-seat unit can run more than one
// pickup round in a morning (e.g. a nearby TPS served again after the main
// run, or a separate later round for a different unit like PAUD). Existing
// single pickup times/order become Trip 1, so nothing already published
// changes until an admin adds a second pickup trip. ALTER TABLE ADD/DROP
// COLUMN (not drop-and-recreate) — see the caution at the weekday-column
// migration further down about why a plain column widen is the safe move
// here. Runs here, before "seed each bus's stop list" below, because that
// migration writes pickup_times/pickup_sequences directly and needs the
// columns to already exist — the bus_pickup_trips backfill that depends on
// buses.school_arrival_time (not added until a later migration) is split out
// and runs further down instead.
{
  const cols = db.prepare(`PRAGMA table_info(bus_route_stops)`).all().map((c) => c.name);
  if (!cols.includes('pickup_times')) {
    db.exec(`ALTER TABLE bus_route_stops ADD COLUMN pickup_times TEXT NOT NULL DEFAULT '[]'`);
    db.exec(`ALTER TABLE bus_route_stops ADD COLUMN pickup_sequences TEXT NOT NULL DEFAULT '[]'`);
    const rows = db.prepare(`SELECT id, pickup_time, sequence FROM bus_route_stops`).all();
    const update = db.prepare(`UPDATE bus_route_stops SET pickup_times = ?, pickup_sequences = ? WHERE id = ?`);
    for (const r of rows) {
      // A row with no pickup_time was never a real pickup stop (see GET
      // /api/scan/route's `WHERE pickup_time IS NOT NULL` filter) — it
      // exists solely because of a dropoff trip, so it stays out of every
      // pickup trip rather than becoming a phantom Trip-1 member.
      if (r.pickup_time != null) {
        update.run(JSON.stringify([r.pickup_time]), JSON.stringify([r.sequence]), r.id);
      }
    }
    db.exec(`ALTER TABLE bus_route_stops DROP COLUMN pickup_time`);
  }
}

// ── Migration: seed each bus's stop list from its route ─────────────────────
// Existing databases already have times keyed by route. Copy them onto the
// buses serving that route so the first rotation starts from what is already
// published rather than a blank schedule. Runs once: as soon as a bus has any
// stops of its own, it is left alone.
{
  const buses = db.prepare(`
    SELECT id, route_id FROM buses WHERE is_active = 1 AND route_id IS NOT NULL
  `).all();
  const stopsForRoute = db.prepare(`
    SELECT bus_stop_id, sequence, pickup_time, dropoff_time
    FROM route_stops WHERE route_id = ? ORDER BY sequence
  `);
  const hasOwn = db.prepare(`SELECT 1 FROM bus_route_stops WHERE bus_id = ? LIMIT 1`);
  const insert = db.prepare(`
    INSERT INTO bus_route_stops
      (bus_id, bus_stop_id, sequence, pickup_times, pickup_sequences, dropoff_times)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (bus_id, bus_stop_id) DO NOTHING
  `);

  for (const bus of buses) {
    if (hasOwn.get(bus.id)) continue;
    for (const s of stopsForRoute.all(bus.route_id)) {
      insert.run(bus.id, s.bus_stop_id, s.sequence,
                  JSON.stringify(s.pickup_time ? [s.pickup_time] : []),
                  JSON.stringify(s.pickup_time ? [s.sequence] : []),
                  JSON.stringify(s.dropoff_time ? [s.dropoff_time] : []));
    }
  }
}

// ── Migration: bus crew names on the published schedule ─────────────────────
// Driver and helper are stored as plain text (see the buses table comment), so
// existing databases need the two columns added.
{
  const busColumns = db.prepare(`PRAGMA table_info(buses)`).all().map((c) => c.name);
  if (!busColumns.includes('driver_name')) {
    db.exec(`ALTER TABLE buses ADD COLUMN driver_name TEXT`);
  }
  if (!busColumns.includes('helper_name')) {
    db.exec(`ALTER TABLE buses ADD COLUMN helper_name TEXT`);
  }
}

// ── Migration: route destination ─────────────────────────────────────────────
// Existing databases predate the `destination` column — add it and backfill
// the obvious default so routes created before this feature still show one.
{
  const routeColumns = db.prepare(`PRAGMA table_info(routes)`).all().map((c) => c.name);
  if (!routeColumns.includes('destination')) {
    db.exec(`ALTER TABLE routes ADD COLUMN destination TEXT`);
    db.exec(`
      UPDATE routes SET destination = 'Sekolah YPJ Kuala Kencana' WHERE destination IS NULL
    `);
  }
}

// ── Migration: Perusahaan/Instansi → Kategori Orang Tua ─────────────────────
// The free-text employer field (with its 87-alias lookup table) is replaced by
// a fixed HR-defined eligibility category — see PARENT_CATEGORY_KEYS in
// lib/cards.js. Idempotent: safe to run against a database that already has
// the old columns, and a no-op on a fresh install that never had them.
{
  const userColumns = db.prepare(`PRAGMA table_info(users)`).all().map((c) => c.name);

  if (!userColumns.includes('parent_category')) {
    db.exec(`ALTER TABLE users ADD COLUMN parent_category TEXT`);
  }
  if (userColumns.includes('company_id')) {
    // Best-effort carry-over so existing submissions are not left blank: any
    // parent previously linked to a PTFI-group company lands on the closest
    // equivalent category; everyone else lands on 'other' for the Transport
    // Team to correct by hand.
    db.exec(`
      UPDATE users
      SET parent_category = CASE
        WHEN parent_category IS NOT NULL THEN parent_category
        WHEN company_id IN (SELECT id FROM companies WHERE is_ptfi_group = 1) THEN 'ptfi'
        ELSE 'other'
      END
      WHERE EXISTS (SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'companies')
    `);
    db.exec(`ALTER TABLE users DROP COLUMN company_id`);
  }
  if (userColumns.includes('company_other')) {
    db.exec(`ALTER TABLE users DROP COLUMN company_other`);
  }
  db.exec(`UPDATE users SET parent_category = 'other' WHERE parent_category IS NULL`);
  db.exec(`DROP TABLE IF EXISTS companies`);

  // 'Contractor Family Status' and 'Contractor by Agreement' were removed from
  // the category list; anyone already stored under either falls back to the
  // catch-all 'other' bucket rather than pointing at a category that no longer
  // exists in PARENT_CATEGORY_KEYS.
  db.exec(`
    UPDATE users SET parent_category = 'other'
    WHERE parent_category IN ('contractor_family_status', 'contractor_by_agreement')
  `);
}

// ── Migration: widen users.role to add driver/helper/leader ────────────────
// SQLite enforces a CHECK constraint from however the table was originally
// created — editing the CREATE TABLE text above does not retroactively change
// it for a database that already exists, so a full rebuild is required. Every
// other table's foreign key points at users(id), never at a row's position,
// so copying rows through unchanged preserves every reference. Wrapped in one
// transaction with foreign_keys off for the duration so the drop/rename can't
// leave the database half-migrated.
{
  const usersSql = db.prepare(`
    SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'
  `).get()?.sql || '';

  if (!usersSql.includes("'driver'")) {
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec('BEGIN');
    try {
      db.exec(`
        CREATE TABLE users_new (
          id                     INTEGER PRIMARY KEY AUTOINCREMENT,
          name                   TEXT    NOT NULL,
          email                  TEXT    NOT NULL UNIQUE,
          password_hash          TEXT,
          role                   TEXT    NOT NULL DEFAULT 'parent'
                                   CHECK (role IN ('parent','transport_admin','attendant','school_staff',
                                                   'driver','helper','leader','super_admin')),
          phone_primary          TEXT,
          phone_alternate        TEXT,
          phone_alternate_owner  TEXT,
          employee_id            TEXT,
          parent_category        TEXT,
          department             TEXT,
          home_address           TEXT,
          is_active              INTEGER NOT NULL DEFAULT 1,
          password_reset_token   TEXT,
          password_reset_expires TEXT,
          created_at             TEXT    DEFAULT (datetime('now')),
          updated_at             TEXT    DEFAULT (datetime('now'))
        );
        INSERT INTO users_new
          (id, name, email, password_hash, role, phone_primary, phone_alternate,
           phone_alternate_owner, employee_id, parent_category, department,
           home_address, is_active, password_reset_token, password_reset_expires,
           created_at, updated_at)
        SELECT
          id, name, email, password_hash, role, phone_primary, phone_alternate,
          phone_alternate_owner, employee_id, parent_category, department,
          home_address, is_active, password_reset_token, password_reset_expires,
          created_at, updated_at
        FROM users;
        DROP TABLE users;
        ALTER TABLE users_new RENAME TO users;
      `);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    } finally {
      db.exec('PRAGMA foreign_keys = ON');
    }
  }
}

// ── Migration: attachment on event bus requests ─────────────────────────────
// Plain nullable columns — a straight ADD COLUMN, no rebuild needed.
{
  const cols = db.prepare(`PRAGMA table_info(event_bus_requests)`).all().map((c) => c.name);
  if (!cols.includes('attachment_file')) {
    db.exec(`ALTER TABLE event_bus_requests ADD COLUMN attachment_file TEXT`);
  }
  if (!cols.includes('attachment_mime_type')) {
    db.exec(`ALTER TABLE event_bus_requests ADD COLUMN attachment_mime_type TEXT`);
  }
}

// ── Migration: widen users.role to add 'admin' (school admin staff) ────────
// Same rebuild-required situation as the migration above — a fresh CHECK
// constraint that role='admin' rows need to pass. School admin staff raise
// event bus requests (see event_bus_requests below); Leader can raise them
// too, but only Tim Transportasi (transport_admin) approves them.
{
  const usersSql = db.prepare(`
    SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'
  `).get()?.sql || '';

  if (!usersSql.includes("'admin'")) {
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec('BEGIN');
    try {
      db.exec(`
        CREATE TABLE users_new (
          id                     INTEGER PRIMARY KEY AUTOINCREMENT,
          name                   TEXT    NOT NULL,
          email                  TEXT    NOT NULL UNIQUE,
          password_hash          TEXT,
          role                   TEXT    NOT NULL DEFAULT 'parent'
                                   CHECK (role IN ('parent','transport_admin','attendant','school_staff',
                                                   'driver','helper','leader','admin','super_admin')),
          phone_primary          TEXT,
          phone_alternate        TEXT,
          phone_alternate_owner  TEXT,
          employee_id            TEXT,
          parent_category        TEXT,
          department             TEXT,
          home_address            TEXT,
          is_active              INTEGER NOT NULL DEFAULT 1,
          password_reset_token   TEXT,
          password_reset_expires TEXT,
          created_at             TEXT    DEFAULT (datetime('now')),
          updated_at             TEXT    DEFAULT (datetime('now'))
        );
        INSERT INTO users_new
          (id, name, email, password_hash, role, phone_primary, phone_alternate,
           phone_alternate_owner, employee_id, parent_category, department,
           home_address, is_active, password_reset_token, password_reset_expires,
           created_at, updated_at)
        SELECT
          id, name, email, password_hash, role, phone_primary, phone_alternate,
          phone_alternate_owner, employee_id, parent_category, department,
          home_address, is_active, password_reset_token, password_reset_expires,
          created_at, updated_at
        FROM users;
        DROP TABLE users;
        ALTER TABLE users_new RENAME TO users;
      `);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    } finally {
      db.exec('PRAGMA foreign_keys = ON');
    }
  }
}

// ── Migration: widen users.role to add 'contractor' (bus company owners) ───
// Same rebuild-required situation as the two migrations above. Contractor is
// a view-only role — see the read-only guards in routes/safety.js and
// routes/eventRequests.js, and requireRole('contractor', ...) in server.js —
// for the bus companies' own leadership to check safety checklist history,
// Lacak Bus, the schedule, Ruang Chat, broadcast history, and event bus
// requests without being able to change any of it.
{
  const usersSql = db.prepare(`
    SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'
  `).get()?.sql || '';

  if (!usersSql.includes("'contractor'")) {
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec('BEGIN');
    try {
      db.exec(`
        CREATE TABLE users_new (
          id                     INTEGER PRIMARY KEY AUTOINCREMENT,
          name                   TEXT    NOT NULL,
          email                  TEXT    NOT NULL UNIQUE,
          password_hash          TEXT,
          role                   TEXT    NOT NULL DEFAULT 'parent'
                                   CHECK (role IN ('parent','transport_admin','attendant','school_staff',
                                                   'driver','helper','leader','admin','super_admin',
                                                   'contractor')),
          phone_primary          TEXT,
          phone_alternate        TEXT,
          phone_alternate_owner  TEXT,
          employee_id            TEXT,
          parent_category        TEXT,
          department             TEXT,
          home_address            TEXT,
          is_active              INTEGER NOT NULL DEFAULT 1,
          password_reset_token   TEXT,
          password_reset_expires TEXT,
          created_at             TEXT    DEFAULT (datetime('now')),
          updated_at             TEXT    DEFAULT (datetime('now'))
        );
        INSERT INTO users_new
          (id, name, email, password_hash, role, phone_primary, phone_alternate,
           phone_alternate_owner, employee_id, parent_category, department,
           home_address, is_active, password_reset_token, password_reset_expires,
           created_at, updated_at)
        SELECT
          id, name, email, password_hash, role, phone_primary, phone_alternate,
          phone_alternate_owner, employee_id, parent_category, department,
          home_address, is_active, password_reset_token, password_reset_expires,
          created_at, updated_at
        FROM users;
        DROP TABLE users;
        ALTER TABLE users_new RENAME TO users;
      `);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    } finally {
      db.exec('PRAGMA foreign_keys = ON');
    }
  }
}

// ── Migration: edit-access requests on approved applications ────────────────
// 'revision_requested' already unlocks the parent's edit form (see routes/
// applications.js PUT /:id) for an admin-initiated correction pre-approval.
// These two columns are the same idea for a parent-initiated one *after*
// approval — e.g. a blurry photo caught later — gated on admin sign-off
// before the parent gets write access again.
{
  const appColumns = db.prepare(`PRAGMA table_info(applications)`).all().map((c) => c.name);
  if (!appColumns.includes('edit_requested_at')) {
    db.exec(`ALTER TABLE applications ADD COLUMN edit_requested_at TEXT`);
    db.exec(`ALTER TABLE applications ADD COLUMN edit_request_note TEXT`);
  }
}

// ── Migration: school arrival/departure time per unit ────────────────────────
// The TPS list already has a pickup_time/dropoff_times per stop, but the school
// itself isn't a row in bus_route_stops — it's the implicit last stop of a
// pickup run and the implicit first stop of a dropoff run. These two columns
// give that endpoint an actual time instead of just a "Titik akhir/awal" label.
{
  const busColumns = db.prepare(`PRAGMA table_info(buses)`).all().map((c) => c.name);
  if (!busColumns.includes('school_arrival_time')) {
    db.exec(`ALTER TABLE buses ADD COLUMN school_arrival_time TEXT`);
  }
  if (!busColumns.includes('school_departure_time')) {
    db.exec(`ALTER TABLE buses ADD COLUMN school_departure_time TEXT`);
  }
}

// ── Migration: backfill bus_trips from existing dropoff_times ───────────────
// Before bus_trips existed, the number of dropoff legs a unit ran was guessed
// at read time from the longest dropoff_times array among its stops, and only
// the first leg had a scheduled departure time (school_departure_time). This
// derives an explicit bus_trips row per leg so existing schedules keep working
// unchanged. Runs once per bus: as soon as a bus has any bus_trips rows, it is
// left alone.
{
  const buses = db.prepare(`
    SELECT b.id, b.school_departure_time,
      (SELECT MAX(json_array_length(brs.dropoff_times))
         FROM bus_route_stops brs WHERE brs.bus_id = b.id) AS max_trips
    FROM buses b
    WHERE NOT EXISTS (SELECT 1 FROM bus_trips t WHERE t.bus_id = b.id)
  `).all();
  const insertTrip = db.prepare(`
    INSERT INTO bus_trips (bus_id, trip_number, departure_time) VALUES (?, ?, ?)
  `);
  for (const b of buses) {
    const tripCount = Math.max(1, b.max_trips || 1);
    for (let n = 1; n <= tripCount; n++) {
      insertTrip.run(b.id, n, n === 1 ? b.school_departure_time : null);
    }
  }
}

// ── Migration: explicit per-trip TPS order ──────────────────────────────────
// dropoff_sequences is new — before it existed, dropoff order was always the
// fixed "TPS numbering outward from school" (bus_stops.sort_order DESC), the
// same for every bus and every trip. This backfills each existing stop's
// position in that same fixed order, per trip, so nothing about an already-
// published schedule visibly changes until an admin deliberately reorders a
// trip with the new per-trip TPS picker (see SchedulePanel in
// AdminQueuePage.jsx). Runs once: as soon as the column exists, it is left
// alone — a bus resaved afterwards writes real admin-chosen sequences here.
{
  const cols = db.prepare(`PRAGMA table_info(bus_route_stops)`).all().map((c) => c.name);
  if (!cols.includes('dropoff_sequences')) {
    db.exec(`ALTER TABLE bus_route_stops ADD COLUMN dropoff_sequences TEXT NOT NULL DEFAULT '[]'`);
    const buses = db.prepare(`SELECT DISTINCT bus_id FROM bus_route_stops`).all();
    const updateSeq = db.prepare(`UPDATE bus_route_stops SET dropoff_sequences = ? WHERE id = ?`);
    for (const { bus_id } of buses) {
      const rows = db.prepare(`
        SELECT brs.id, brs.dropoff_times, s.sort_order
        FROM bus_route_stops brs JOIN bus_stops s ON s.id = brs.bus_stop_id
        WHERE brs.bus_id = ?
      `).all(bus_id).map((r) => ({ ...r, dropoff_times: JSON.parse(r.dropoff_times || '[]') }));
      const tripCount = Math.max(0, ...rows.map((r) => r.dropoff_times.length));
      // On a single-trip bus, every stop the admin ever checked was already
      // treated as served in dropoff regardless of whether its time got
      // filled in (see the pickup/dropoff time-vs-membership distinction
      // elsewhere in this codebase) — sequence membership has to preserve
      // that here, not just the time value, because dropoff_sequences (not
      // dropoff_times) becomes the sole "is this stop on this trip" signal
      // from here on. A multi-trip bus keeps the old rule: only a stop with
      // an actual time at that trip's index was ever trip-specific.
      const singleTrip = tripCount === 1;
      for (const r of rows) {
        const seq = [];
        for (let i = 0; i < tripCount; i++) {
          if (!singleTrip && !r.dropoff_times[i]) { seq.push(null); continue; }
          const peers = rows.filter((x) => singleTrip || x.dropoff_times[i])
            .sort((a, b) => b.sort_order - a.sort_order);
          seq.push(peers.findIndex((x) => x.id === r.id) + 1);
        }
        updateSeq.run(JSON.stringify(seq), r.id);
      }
    }
  }
}

// ── Migration: widen safety_checklist_items.status to add 'na' ─────────────
// Some SOP points genuinely don't apply on a given day (e.g. a spotter-only
// item on a unit with no reversing manoeuvre) — before this, a driver/helper
// had to force an OK or Not OK onto something that was neither. 'na' carries
// no note requirement, same as 'ok'; only 'not_ok' still requires one (see
// routes/safety.js).
{
  const itemsSql = db.prepare(`
    SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'safety_checklist_items'
  `).get()?.sql || '';

  if (itemsSql && !itemsSql.includes("'na'")) {
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec('BEGIN');
    try {
      db.exec(`
        CREATE TABLE safety_checklist_items_new (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          checklist_id  INTEGER NOT NULL REFERENCES safety_checklists(id) ON DELETE CASCADE,
          item_key      TEXT    NOT NULL,
          status        TEXT    NOT NULL CHECK (status IN ('ok', 'not_ok', 'na')),
          note          TEXT,
          UNIQUE (checklist_id, item_key)
        );
        INSERT INTO safety_checklist_items_new (id, checklist_id, item_key, status, note)
          SELECT id, checklist_id, item_key, status, note FROM safety_checklist_items;
        DROP TABLE safety_checklist_items;
        ALTER TABLE safety_checklist_items_new RENAME TO safety_checklist_items;
      `);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    } finally {
      db.exec('PRAGMA foreign_keys = ON');
    }
  }
}

// ── Migration: seed the 8 duty slots (besar×1-4, kecil×1-4) ────────────────
// One-time BOOTSTRAP, only for a group with zero duty_slots rows at all —
// deliberately not an ON CONFLICT DO NOTHING per-slot upsert (that was the
// original design, back when these were meant to never be removed through
// the app), because that would silently resurrect a slot a later migration
// deliberately deleted (see the kecil-reduced-to-3 migration below, which
// removes kecil's duty_number 4) every single time the server boots. Once a
// group has any row, this leaves it alone for good — further changes to a
// group's slot set only ever happen through an explicit, targeted migration.
{
  const insertSlot = db.prepare(`
    INSERT INTO duty_slots (bus_group, duty_number) VALUES (?, ?)
    ON CONFLICT (bus_group, duty_number) DO NOTHING
  `);
  const hasAnySlot = db.prepare(`SELECT 1 FROM duty_slots WHERE bus_group = ? LIMIT 1`);
  for (const group of ['besar', 'kecil']) {
    if (hasAnySlot.get(group)) continue;
    for (let n = 1; n <= 4; n++) insertSlot.run(group, n);
  }
}

// ── Migration: duty_slots gains fixed_bus_id, CHECK widened to 8 ───────────
// Table rebuild (not a plain ADD COLUMN) because the duty_number CHECK
// constraint itself needs widening from 1-4 to 1-8, and SQLite has no ALTER
// ... to modify a CHECK. duty_slot_stops/trips/pickup_trips/days all
// reference duty_slots(id) with ON DELETE CASCADE, so this follows the same
// FK-off rebuild pattern already used elsewhere in this file (e.g. the users
// table migration) rather than risking an FK violation on DROP TABLE — ids
// are preserved exactly, so every child row's reference stays valid.
{
  const cols = db.prepare(`PRAGMA table_info(duty_slots)`).all().map((c) => c.name);
  if (!cols.includes('fixed_bus_id')) {
    db.exec('PRAGMA foreign_keys = OFF');
    try {
      db.exec(`
        CREATE TABLE duty_slots_new (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          bus_group    TEXT    NOT NULL CHECK (bus_group IN ('besar', 'kecil')),
          duty_number  INTEGER NOT NULL CHECK (duty_number BETWEEN 1 AND 8),
          fixed_bus_id INTEGER REFERENCES buses(id),
          UNIQUE (bus_group, duty_number)
        );
        INSERT INTO duty_slots_new (id, bus_group, duty_number) SELECT id, bus_group, duty_number FROM duty_slots;
        DROP TABLE duty_slots;
        ALTER TABLE duty_slots_new RENAME TO duty_slots;
      `);
    } finally {
      db.exec('PRAGMA foreign_keys = ON');
    }
  }
}

// ── Migration: kecil rotation reduced to Tugas 1-3 + fixed Tugas 5 ─────────
// PA 7001 MU MPM's route stands on its own (only needs loose coordination
// with the other kecil units on the afternoon teacher run, not a weekly
// identity swap), so it comes out of the 4-way rotating pool and becomes a
// permanent Tugas 5 instead. Tugas 4 (kecil) is retired since the pool below
// it is now only 3 buses. Gated on the exact plate existing and Tugas 5 not
// already set up, so this is a one-time, idempotent, production-specific
// change that no-ops harmlessly on any other database (e.g. local dev, which
// has no bus with this plate).
{
  const bus = db.prepare(`SELECT id FROM buses WHERE plate_number = 'PA 7001 MU MPM'`).get();
  const tugas5 = db.prepare(`SELECT id FROM duty_slots WHERE bus_group = 'kecil' AND duty_number = 5`).get();
  if (bus && !tugas5) {
    const tugas4 = db.prepare(`SELECT id FROM duty_slots WHERE bus_group = 'kecil' AND duty_number = 4`).get();
    if (tugas4 && !db.prepare(`SELECT 1 FROM duty_slot_stops WHERE duty_slot_id = ? LIMIT 1`).get(tugas4.id)) {
      db.prepare(`DELETE FROM duty_slots WHERE id = ?`).run(tugas4.id);
    }
    db.prepare(`
      INSERT INTO duty_slots (bus_group, duty_number, fixed_bus_id) VALUES ('kecil', 5, ?)
    `).run(bus.id);
  }
}

// ── Migration: duty_slot_stops/duty_slot_trips gain a `weekday` column ─────
// These two tables shipped without a day dimension (one standing schedule
// for the whole week) and were widened to per-weekday. This used a straight
// drop-and-recreate on the assumption nothing had been configured yet — that
// assumption was WRONG in practice (an admin filled in real data on
// production between the tables shipping and this migration landing, and
// lost it when the migration ran). The guard below means this specific
// migration only ever fires once per database (it no-ops once `weekday`
// exists), so it can't repeat the mistake — but treat that as luck, not a
// pattern: any future schema change to a table admins can already write to
// must use the rebuild-and-copy approach the other migrations in this file
// use, never drop-and-recreate.
{
  const stopsSql = db.prepare(`
    SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'duty_slot_stops'
  `).get()?.sql || '';
  if (stopsSql && !stopsSql.includes('weekday')) {
    db.exec(`
      DROP TABLE IF EXISTS duty_slot_stops;
      DROP TABLE IF EXISTS duty_slot_trips;
      CREATE TABLE duty_slot_stops (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        duty_slot_id      INTEGER NOT NULL REFERENCES duty_slots(id) ON DELETE CASCADE,
        weekday           INTEGER NOT NULL CHECK (weekday BETWEEN 1 AND 5),
        bus_stop_id       INTEGER NOT NULL REFERENCES bus_stops(id),
        sequence          INTEGER NOT NULL DEFAULT 1,
        pickup_time       TEXT,
        dropoff_times     TEXT NOT NULL DEFAULT '[]',
        dropoff_sequences TEXT NOT NULL DEFAULT '[]',
        UNIQUE (duty_slot_id, weekday, bus_stop_id)
      );
      CREATE TABLE duty_slot_trips (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        duty_slot_id   INTEGER NOT NULL REFERENCES duty_slots(id) ON DELETE CASCADE,
        weekday        INTEGER NOT NULL CHECK (weekday BETWEEN 1 AND 5),
        trip_number    INTEGER NOT NULL,
        departure_time TEXT,
        UNIQUE (duty_slot_id, weekday, trip_number)
      );
    `);
  }
}

// ── Migration: bus_pickup_trips backfill for bus_route_stops ───────────────
// The column widen itself (pickup_time → pickup_times/pickup_sequences) runs
// much earlier, right after the dropoff_times widening above — see that
// block's comment. This second half has to run down here instead, after
// buses.school_arrival_time exists (added by the migration above this one),
// since it copies that column's value into each bus's new Trip-1 pickup-trip
// row. Guarded on bus_pickup_trips being empty for a bus rather than re-using
// the pickup_times/pickup_sequences guard above, since those two migrations
// can no longer share one guard now that they're split apart.
{
  const buses = db.prepare(`
    SELECT DISTINCT b.id, b.school_arrival_time FROM buses b
    WHERE EXISTS (
      SELECT 1 FROM bus_route_stops brs WHERE brs.bus_id = b.id AND brs.pickup_times != '[]'
    )
    AND NOT EXISTS (SELECT 1 FROM bus_pickup_trips WHERE bus_id = b.id)
  `).all();
  const insertPickupTrip = db.prepare(`
    INSERT INTO bus_pickup_trips (bus_id, trip_number, arrival_time) VALUES (?, 1, ?)
    ON CONFLICT (bus_id, trip_number) DO NOTHING
  `);
  for (const b of buses) insertPickupTrip.run(b.id, b.school_arrival_time);
}

// ── Migration: multiple pickup trips per duty-slot day (duty_slot_stops) ───
// Same widening as bus_route_stops above, for the duty-slot template layer.
{
  const cols2 = db.prepare(`PRAGMA table_info(duty_slot_stops)`).all().map((c) => c.name);
  if (!cols2.includes('pickup_times')) {
    db.exec(`ALTER TABLE duty_slot_stops ADD COLUMN pickup_times TEXT NOT NULL DEFAULT '[]'`);
    db.exec(`ALTER TABLE duty_slot_stops ADD COLUMN pickup_sequences TEXT NOT NULL DEFAULT '[]'`);
    const rows = db.prepare(`SELECT id, pickup_time, sequence FROM duty_slot_stops`).all();
    const update = db.prepare(`UPDATE duty_slot_stops SET pickup_times = ?, pickup_sequences = ? WHERE id = ?`);
    for (const r of rows) {
      if (r.pickup_time != null) {
        update.run(JSON.stringify([r.pickup_time]), JSON.stringify([r.sequence]), r.id);
      }
    }
    db.exec(`ALTER TABLE duty_slot_stops DROP COLUMN pickup_time`);

    const slotDays = db.prepare(`
      SELECT DISTINCT dss.duty_slot_id, dss.weekday, dd.school_arrival_time
      FROM duty_slot_stops dss
      LEFT JOIN duty_slot_days dd
        ON dd.duty_slot_id = dss.duty_slot_id AND dd.weekday = dss.weekday
      WHERE dss.pickup_times != '[]'
    `).all();
    const insertPickupTrip = db.prepare(`
      INSERT INTO duty_slot_pickup_trips (duty_slot_id, weekday, trip_number, arrival_time)
      VALUES (?, ?, 1, ?)
      ON CONFLICT (duty_slot_id, weekday, trip_number) DO NOTHING
    `);
    for (const s of slotDays) insertPickupTrip.run(s.duty_slot_id, s.weekday, s.school_arrival_time);
  }
}

// ── Migration: TPS coordinates for the stop-progress map ───────────────────
// Nullable on purpose — this app still has no GPS (see the trip_events
// comment above); a stop with no coordinates just stays off the map until
// the Transport Team sets one, same as an unset seat_capacity today.
{
  const stopColumns = db.prepare(`PRAGMA table_info(bus_stops)`).all().map((c) => c.name);
  if (!stopColumns.includes('latitude')) {
    db.exec(`ALTER TABLE bus_stops ADD COLUMN latitude REAL`);
    db.exec(`ALTER TABLE bus_stops ADD COLUMN longitude REAL`);
  }
}

// ── Migration: trip_events gains 'arrived' ──────────────────────────────────
// A separate marker from 'departed': on a dropoff run there was previously no
// way to record the one moment that isn't "left somewhere" — actually
// reaching the LAST TPS on the leg, which parents/Guru care about seeing an
// honest timestamp for (see routes/track.js's arrival banner) instead of the
// old guess ("nothing left undeparted, so it must be there"). Table rebuild,
// not ALTER TABLE, because SQLite can't widen a CHECK constraint in place —
// same pattern as the users.role widening above. Nothing else references
// trip_events(id), so no FK juggling is needed.
{
  const tripEventsSql = db.prepare(`
    SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'trip_events'
  `).get()?.sql || '';

  if (!tripEventsSql.includes("'arrived'")) {
    db.exec('BEGIN');
    try {
      db.exec(`
        CREATE TABLE trip_events_new (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          bus_id      INTEGER NOT NULL REFERENCES buses(id) ON DELETE CASCADE,
          bus_stop_id INTEGER REFERENCES bus_stops(id),
          direction   TEXT NOT NULL DEFAULT 'pickup'
                        CHECK (direction IN ('pickup', 'dropoff')),
          event       TEXT NOT NULL DEFAULT 'departed'
                        CHECK (event IN ('departed', 'started', 'finished', 'arrived')),
          recorded_by INTEGER REFERENCES users(id),
          created_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT INTO trip_events_new
          (id, bus_id, bus_stop_id, direction, event, recorded_by, created_at)
        SELECT id, bus_id, bus_stop_id, direction, event, recorded_by, created_at
        FROM trip_events;
        DROP TABLE trip_events;
        ALTER TABLE trip_events_new RENAME TO trip_events;
        CREATE INDEX IF NOT EXISTS trip_events_bus_day_idx
          ON trip_events (bus_id, date(created_at));
      `);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
}

// ── Migration: free-text label per trip (e.g. "PAUD") ───────────────────────
// A trip can serve a specific unit or purpose that isn't obvious from its
// time alone (e.g. a separate PAUD pengantaran round); this is a plain
// admin-entered tag shown to parents on the schedule, not a controlled value.
{
  for (const table of ['bus_trips', 'bus_pickup_trips', 'duty_slot_trips', 'duty_slot_pickup_trips']) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    if (!columns.includes('label')) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN label TEXT`);
    }
  }
}

// ── Seed: reference data ───────────────────────────────────────────────────
// Everything below is idempotent, so it is safe to run on every boot.

// The YPJ school year runs mid-July to end of June, so anything from July onwards
// belongs to the year that is just starting. Derived rather than hardcoded: a
// hardcoded year would silently issue already-expired cards after 30 June.
function schoolYearFor(date) {
  const y = date.getFullYear();
  const startYear = date.getMonth() >= 6 ? y : y - 1;   // getMonth() 6 = July
  const short = `${String(startYear).slice(2)}${String(startYear + 1).slice(2)}`;
  return {
    code: `${startYear}/${startYear + 1}`,
    short_code: short,
    starts_on: `${startYear}-07-14`,
    ends_on: `${startYear + 1}-06-30`,
  };
}

const year = schoolYearFor(new Date());
db.prepare(`
  INSERT INTO academic_years (code, short_code, starts_on, ends_on, is_current)
  VALUES (?, ?, ?, ?, 1)
  ON CONFLICT (code) DO UPDATE SET is_current = 1
`).run(year.code, year.short_code, year.starts_on, year.ends_on);

// Only one year may be current.
db.prepare(`UPDATE academic_years SET is_current = 0 WHERE code <> ?`).run(year.code);

// Codes and names are exactly the radio options of the old form. seat_capacity
// is an initial plan sized from observed 2024/25 demand — TPS#1/#2/#3/#17 carried
// 33 / 31 / 45 / 47 students respectively.
const STOPS = [
  ['TPS#1',  'RWB KK',                                     'KK',     45],
  ['TPS#2',  'Halte Timika Indah 1',                       'TIMIKA', 45],
  ['TPS#3',  'Halte Timika Indah 2',                       'TIMIKA', 50],
  ['TPS#4',  'Depan Dealer Honda',                         'TIMIKA', 20],
  ['TPS#5',  'Depan Petrosea',                             'TIMIKA', 20],
  ['TPS#6',  'Depan Kantor KPPN SP2',                      'SP2',    20],
  ['TPS#7',  'Depan Perumahan Hope / BPJS SP2',            'SP2',    25],
  ['TPS#8',  'Halte Perumahan PEMDA SP2',                  'SP2',    20],
  ['TPS#9',  'Simpang 5 SP2 (Awalin)',                     'SP2',    20],
  ['TPS#10', 'Halte Karitas (Depan Gereja Diaspora SP3)',   'SP3',    25],
  ['TPS#11', 'Jalur 3 SP2',                                'SP2',    20],
  ['TPS#12', 'Jalur 4 SP2',                                'SP2',    20],
  ['TPS#13', 'Depan Kantor KPU lama - SP3',                'SP3',    20],
  ['TPS#14', 'Depan Perumahan Regency / BRI SP3',          'SP3',    20],
  ['TPS#15', 'Jalur Jl. Ketapang SP3',                     'SP3',    25],
  ['TPS#16', 'Depan Batako Papua SP3',                      'SP3',    20],
  ['TPS#17', 'Depan Pondok Amor SP3',                       'SP3',    50],
  ['TPS#18', 'Depan Jalur SD Seminari TSM – SP3',           'SP3',    20],
  ['TPS#19', 'Halte Koramil SP3',                           'SP3',    20],
];

const seedStop = db.prepare(`
  INSERT INTO bus_stops (code, name, area, seat_capacity, sort_order)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT (code) DO NOTHING
`);
STOPS.forEach((s, i) => seedStop.run(s[0], s[1], s[2], s[3], i + 1));

// Initial routes, mirroring the corridors in the stop list.
const ROUTES = [
  ['KK-A',  'Kuala Kencana — RWB',                    45, ['TPS#1']],
  ['TMK-A', 'Timika Indah 1 & 2',                     90, ['TPS#2', 'TPS#3', 'TPS#4', 'TPS#5']],
  ['SP2-A', 'SP2 Koridor (Hope–PEMDA–Jalur 3/4)',     90, ['TPS#6', 'TPS#7', 'TPS#8', 'TPS#9', 'TPS#11', 'TPS#12']],
  ['SP3-A', 'SP3 Koridor (Pondok Amor–Ketapang)',     90, ['TPS#13', 'TPS#14', 'TPS#15', 'TPS#16', 'TPS#17']],
  ['SP3-B', 'SP3 Koridor (Karitas–Koramil–Seminari)', 45, ['TPS#10', 'TPS#18', 'TPS#19']],
];

const currentYear = db.prepare(`SELECT id FROM academic_years WHERE is_current = 1`).get();
if (currentYear) {
  const seedRoute = db.prepare(`
    INSERT INTO routes (academic_year_id, code, name, seat_capacity, destination)
    VALUES (?, ?, ?, ?, 'Sekolah YPJ Kuala Kencana')
    ON CONFLICT (academic_year_id, code) DO NOTHING
  `);
  const seedRouteStop = db.prepare(`
    INSERT INTO route_stops (route_id, bus_stop_id, sequence)
    VALUES (?, ?, ?)
    ON CONFLICT (route_id, bus_stop_id) DO NOTHING
  `);
  const findRoute = db.prepare(`SELECT id FROM routes WHERE academic_year_id = ? AND code = ?`);
  const findStop  = db.prepare(`SELECT id FROM bus_stops WHERE code = ?`);

  for (const [code, name, cap, stops] of ROUTES) {
    seedRoute.run(currentYear.id, code, name, cap);
    const route = findRoute.get(currentYear.id, code);
    stops.forEach((stopCode, i) => {
      const stop = findStop.get(stopCode);
      if (route && stop) seedRouteStop.run(route.id, stop.id, i + 1);
    });
  }
}

// Rules text as printed on the 2024/25 form, plus the parent confirmation
// paragraph that sat above the signature question.
const RULES_V1 = `## I. KETENTUAN

- **Bis sekolah YPJ diperuntukan hanya** untuk pelajar/Guru YPJ yang telah terdaftar dan eligible.
- **Pelayanan kepada siswa YPJ tidak dipungut biaya.** Gratis dan melayani selama jam operasional sekolah.
- **Bis hanya berhenti di halte/TPS** yang telah ditetapkan.
- **Jumlah penumpang tidak boleh melebihi** seat yang tersedia.

## II. PERILAKU BERBAHAYA DI DALAM BIS SEKOLAH

- **Berdiri atau berjalan diatas bus saat bus berjalan** tanpa pegangan yang aman.
- **Berteriak atau membuat keributan** yang mengganggu konsentrasi sopir.
- **Mendorong atau berkelahi** dengan sesama siswa.
- **Melempar barang** di dalam bus.
- **Bullying dan berbicara kotor atau kasar serta provokasi** terhadap teman/petugas.
- **Makan dan minum di dalam bus** sehingga mengotori bis dengan tumpahan makanan.
- **Mengganggu sopir** saat mengemudi.
- **Tidak mematuhi instruksi petugas bus** atau sopir.
- **Sengaja merusak fasilitas bus.**

Sejalan dengan kebijakan PTFI mengenai prioritas keselamatan, YPJ menilai keselamatan penumpang Bis sekolah merupakan prioritas utama. Tidak ada toleransi terhadap perilaku tidak selamat di dalam Bis sekolah seperti termuat di atas.

Semua siswa/guru wajib mematuhi aturan penumpang Bis sebagaimana ditetapkan dalam Form Kontrak Pengguna Bis ini. Orangtua siswa pengguna jasa Bis Sekolah wajib menyetujui perjanjian pemakaian Bis Sekolah.

**Jika terjadi pelanggaran aturan Bus Sekolah YPJ, Hak istimewa pengguna Bis Sekolah dapat dicabut.**

## III. KONFIRMASI ORANG TUA

Demikian form pengajuan penggunaan bus sekolah dan pernyataan ini disampaikan dengan sebenarnya; jika dikemudian hari ditemukan ketidaksesuaian atas informasi yang disebutkan di atas atau melakukan pelanggaran seperti tertera di atas; saya bersedia menerima pencabutan akses tanggungan saya serta peninjauan kelayakan pendaftaran masuk sekolah, sebagaimana ditetapkan dalam kebijakan Pemenuhan Syarat Pendaftaran di Sekolah yang Disponsori PTFI (HR.EDUC.01).

## IV. KONTAK ADMIN

- Yoce Pallo — ypallo@fmi.com — HP 0823 4444 75224
- Natalius Marani — nmarani@fmi.com — HP 0813 4433 7315`;

db.prepare(`
  INSERT INTO rule_documents (version, title, body_md, effective_from, published_at)
  VALUES (?, ?, ?, ?, datetime('now'))
  ON CONFLICT (version) DO NOTHING
`).run('1.0', 'Peraturan dan Ketentuan Bis Sekolah YPJ', RULES_V1, '2025-07-01');

// v1.1 adds the pengantar/penjemput conduct rules. Published as a new version
// rather than editing RULES_V1 in place: consents always point at the exact
// rule_document_id a parent saw, so mutating v1.0's text would blur what
// earlier signatures actually agreed to. The app always shows parents the
// highest effective_from among published versions, so this supersedes v1.0
// for every new submission without touching existing consent records.
const RULES_V1_1 = `## I. KETENTUAN

- **Bis sekolah YPJ diperuntukan hanya** untuk pelajar/Guru YPJ yang telah terdaftar dan eligible.
- **Pelayanan kepada siswa YPJ tidak dipungut biaya.** Gratis dan melayani selama jam operasional sekolah.
- **Bis hanya berhenti di halte/TPS** yang telah ditetapkan.
- **Jumlah penumpang tidak boleh melebihi** seat yang tersedia.

## II. PERILAKU BERBAHAYA DI DALAM BIS SEKOLAH

- **Berdiri atau berjalan diatas bus saat bus berjalan** tanpa pegangan yang aman.
- **Berteriak atau membuat keributan** yang mengganggu konsentrasi sopir.
- **Mendorong atau berkelahi** dengan sesama siswa.
- **Melempar barang** di dalam bus.
- **Bullying dan berbicara kotor atau kasar serta provokasi** terhadap teman/petugas.
- **Makan dan minum di dalam bus** sehingga mengotori bis dengan tumpahan makanan.
- **Mengganggu sopir** saat mengemudi.
- **Tidak mematuhi instruksi petugas bus** atau sopir.
- **Sengaja merusak fasilitas bus.**

Sejalan dengan kebijakan PTFI mengenai prioritas keselamatan, YPJ menilai keselamatan penumpang Bis sekolah merupakan prioritas utama. Tidak ada toleransi terhadap perilaku tidak selamat di dalam Bis sekolah seperti termuat di atas.

Semua siswa/guru wajib mematuhi aturan penumpang Bis sebagaimana ditetapkan dalam Form Kontrak Pengguna Bis ini. Orangtua siswa pengguna jasa Bis Sekolah wajib menyetujui perjanjian pemakaian Bis Sekolah.

**Jika terjadi pelanggaran aturan Bus Sekolah YPJ, Hak istimewa pengguna Bis Sekolah dapat dicabut.**

## III. KETENTUAN BAGI ORANG TUA / WALI SISWA (PENGANTAR DAN PENJEMPUT)

### A. Pengantar

- **Kelancaran Bus:** Dilarang menghalangi jalur operasional bus sekolah dengan kendaraan pribadi, baik saat bus bergerak maju maupun mundur.
- **Keselamatan Lalu Lintas:** Dilarang menyalip atau menghentikan bus sekolah di jalan secara mendadak hanya untuk mengejar keterlambatan pengantaran siswa.
- **Keterlambatan Siswa:** Apabila siswa terlambat, orang tua dapat mengantarkan siswa ke titik penjemputan (shelter) bus berikutnya selama masih memungkinkan.
- **Etika & Komunikasi:** Orang tua/wali diharapkan menjaga kesantunan dan tidak mengeluarkan kata-kata kasar atau menegur petugas bus dengan cara yang tidak pantas. Setiap keluhan, masukan, maupun saran terkait pelayanan dapat disampaikan secara baik-baik kepada petugas atau langsung ke Penanggung Jawab Transportasi Sekolah YPJ untuk ditindaklanjuti.

### B. Penjemput

- **Titik Penjemputan:** Penjemputan siswa hanya dilakukan di titik penjemputan (TPS/shelter) sesuai dengan data alamat siswa yang terdaftar.
- **Ketepatan Waktu:** Penjemput wajib berada di titik penjemputan paling lambat 5 menit sebelum kedatangan bus sekolah.
- **Toleransi Waktu Penjemputan:** Batas toleransi penjemputan adalah 5 menit. Jika penjemput belum tiba melebihi batas waktu tersebut, bus akan melanjutkan perjalanan ke titik berikutnya. Siswa yang belum dijemput akan dibawa kembali ke sekolah dan wajib dijemput oleh orang tua di sekolah.
- **Penanganan Kendala Teknis Bus:** Apabila terjadi kendala teknis (kerusakan bus) yang berpotensi mengganggu keamanan, pihak sekolah akan segera menjalankan prosedur keselamatan siswa, menyediakan bus pengganti, serta menginformasikan kondisi siswa kepada orang tua.
- **Penanganan Kondisi Darurat Luar (Eksternal):** Jika terjadi situasi tidak aman di area pengantaran/penjemputan (seperti pemalangan jalan atau kerusuhan), pihak sekolah akan berkoordinasi dengan tim security perusahaan dan pihak berwajib untuk pengawalan. Pengantaran/penjemputan siswa akan dialihkan ke titik aman yang disepakati (seperti di area depan KFC Galael Timika).

## IV. KONFIRMASI ORANG TUA

Demikian form pengajuan penggunaan bus sekolah dan pernyataan ini disampaikan dengan sebenarnya; jika dikemudian hari ditemukan ketidaksesuaian atas informasi yang disebutkan di atas atau melakukan pelanggaran seperti tertera di atas; saya bersedia menerima pencabutan akses tanggungan saya serta peninjauan kelayakan pendaftaran masuk sekolah, sebagaimana ditetapkan dalam kebijakan Pemenuhan Syarat Pendaftaran di Sekolah yang Disponsori PTFI (HR.EDUC.01).

## V. KONTAK ADMIN

- Yoce Pallo — ypallo@fmi.com — HP 0823 4444 75224
- Natalius Marani — nmarani@fmi.com — HP 0813 4433 7315`;

db.prepare(`
  INSERT INTO rule_documents (version, title, body_md, effective_from, published_at)
  VALUES (?, ?, ?, ?, datetime('now'))
  ON CONFLICT (version) DO NOTHING
`).run('1.1', 'Peraturan dan Ketentuan Bis Sekolah YPJ', RULES_V1_1, '2026-07-25');

module.exports = db;
