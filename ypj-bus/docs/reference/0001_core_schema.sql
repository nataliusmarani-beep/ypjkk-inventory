-- =============================================================================
-- YPJ School Bus Management Application
-- Migration 0001 — core schema (enums, tables, indexes, RLS)
-- Target: PostgreSQL 15+ / Supabase
-- =============================================================================

create extension if not exists "pgcrypto";
create extension if not exists "citext";

-- -----------------------------------------------------------------------------
-- 1. Enumerated types
-- -----------------------------------------------------------------------------

create type user_role as enum (
  'parent', 'transport_admin', 'attendant', 'school_staff', 'super_admin'
);

-- Grade values are taken verbatim from the 2024/25 MS Form option list
-- (Toddler, Playgroup, TK A, TK B, Kelas 1..9) and extended to Kelas 12.
create type grade_level as enum (
  'toddler', 'playgroup', 'tk_a', 'tk_b',
  'kelas_1', 'kelas_2', 'kelas_3', 'kelas_4', 'kelas_5', 'kelas_6',
  'kelas_7', 'kelas_8', 'kelas_9', 'kelas_10', 'kelas_11', 'kelas_12'
);

create type application_status as enum (
  'draft', 'submitted', 'under_review', 'revision_requested',
  'approved', 'rejected', 'cancelled'
);

create type document_type as enum (
  'student_photo', 'parent_id_card', 'proof_of_residence', 'other'
);

create type card_status as enum ('active', 'suspended', 'revoked', 'expired');

create type scan_direction as enum ('boarding', 'alighting');

create type scan_result as enum (
  'ok', 'ok_offline', 'expired', 'revoked', 'suspended',
  'wrong_route', 'unknown_card', 'replay'
);

-- The ten dangerous behaviours enumerated in
-- "PERATURAN DAN KETENTUAN BIS SEKOLAH YPJ", section II.
create type violation_category as enum (
  'standing_or_walking_while_moving',
  'shouting_or_disturbance',
  'pushing_or_fighting',
  'throwing_objects',
  'bullying_or_abusive_language',
  'eating_or_drinking_onboard',
  'distracting_the_driver',
  'disobeying_attendant_instructions',
  'vandalising_bus_facilities',
  'boarding_without_valid_card',
  'other'
);

create type sanction_action as enum ('warning', 'suspension', 'revocation');

create type notification_channel as enum ('email', 'whatsapp', 'push', 'in_app');

-- -----------------------------------------------------------------------------
-- 2. Reference data
-- -----------------------------------------------------------------------------

create table academic_years (
  id           uuid primary key default gen_random_uuid(),
  code         text not null unique,                 -- '2025/2026'
  short_code   text not null unique,                 -- '2526' (used in card numbers)
  starts_on    date not null,
  ends_on      date not null,
  is_current   boolean not null default false,
  created_at   timestamptz not null default now(),
  constraint academic_year_range check (ends_on > starts_on)
);

create unique index academic_years_one_current
  on academic_years (is_current) where is_current;

-- Normalises the 87 distinct free-text spellings found in the 2024/25 export
-- (PTFI, PT FI, PT.FI, PTFi, "Freeport indonesia", ...) into one row each.
create table companies (
  id            uuid primary key default gen_random_uuid(),
  name          text not null unique,
  short_name    text,
  aliases       text[] not null default '{}',
  is_ptfi_group boolean not null default false,      -- drives HR.EDUC.01 eligibility
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

create index companies_aliases_idx on companies using gin (aliases);

-- The 19 pickup points (TPS) exactly as offered on the original form.
create table bus_stops (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,                -- 'TPS#17'
  name          text not null,                       -- 'Depan Pondok Amor SP3'
  area          text not null,                       -- 'KK' | 'SP2' | 'SP3' | 'TIMIKA'
  seat_capacity integer not null default 0 check (seat_capacity >= 0),
  latitude      numeric(9,6),
  longitude     numeric(9,6),
  sort_order    integer not null default 0,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table routes (
  id                uuid primary key default gen_random_uuid(),
  academic_year_id  uuid not null references academic_years (id) on delete restrict,
  code              text not null,                   -- 'SP3-A'
  name              text not null,
  seat_capacity     integer not null default 0 check (seat_capacity >= 0),
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (academic_year_id, code)
);

create table route_stops (
  id           uuid primary key default gen_random_uuid(),
  route_id     uuid not null references routes (id) on delete cascade,
  bus_stop_id  uuid not null references bus_stops (id) on delete restrict,
  sequence     integer not null check (sequence > 0),
  pickup_time  time,
  dropoff_time time,
  unique (route_id, bus_stop_id),
  unique (route_id, sequence)
);

-- -----------------------------------------------------------------------------
-- 3. People
-- -----------------------------------------------------------------------------

create table profiles (
  id                     uuid primary key references auth.users (id) on delete cascade,
  role                   user_role not null default 'parent',
  full_name              text not null,
  email                  citext,
  -- The old form squeezed "081... / 082... (ibu)" into a single field.
  phone_primary          text,
  phone_alternate        text,
  phone_alternate_owner  text,
  employee_id            text,                       -- 'Nomor ID' on the old form
  company_id             uuid references companies (id) on delete set null,
  company_other          text,                       -- free text when not in the list
  department             text,
  home_address           text,
  is_active              boolean not null default true,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index profiles_role_idx on profiles (role);
create index profiles_employee_id_idx on profiles (employee_id);

create table students (
  id                 uuid primary key default gen_random_uuid(),
  parent_profile_id  uuid not null references profiles (id) on delete cascade,
  full_name          text not null,
  grade              grade_level not null,
  nis                text,                            -- school student number, if known
  date_of_birth      date,
  gender             text check (gender in ('L', 'P')),
  photo_path         text,                            -- private storage object path
  special_needs_note text,
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index students_parent_idx on students (parent_profile_id);
create index students_grade_idx on students (grade);

create table buses (
  id                    uuid primary key default gen_random_uuid(),
  plate_number          text not null unique,
  label                 text,
  seat_capacity         integer not null check (seat_capacity > 0),
  route_id              uuid references routes (id) on delete set null,
  driver_profile_id     uuid references profiles (id) on delete set null,
  attendant_profile_id  uuid references profiles (id) on delete set null,
  is_active             boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 4. Rules and consent
-- -----------------------------------------------------------------------------

create table rule_documents (
  id             uuid primary key default gen_random_uuid(),
  version        text not null unique,                -- '1.0'
  title          text not null,
  body_md        text not null,
  effective_from date not null,
  published_at   timestamptz,
  created_at     timestamptz not null default now()
);

create unique index rule_documents_one_published_current
  on rule_documents (effective_from)
  where published_at is not null;

-- -----------------------------------------------------------------------------
-- 5. Applications
-- -----------------------------------------------------------------------------

create table applications (
  id                    uuid primary key default gen_random_uuid(),
  application_no        text unique,                  -- 'YPJ-BUS-2526-00001', set on submit
  academic_year_id      uuid not null references academic_years (id) on delete restrict,
  student_id            uuid not null references students (id) on delete cascade,
  parent_profile_id     uuid not null references profiles (id) on delete cascade,
  requested_stop_id     uuid not null references bus_stops (id) on delete restrict,
  status                application_status not null default 'draft',
  -- Snapshot of the parent-declared data at submission time, so later profile
  -- edits never rewrite history.
  submitted_snapshot    jsonb,
  eligibility_snapshot  jsonb,
  notes_for_admin       text,
  submitted_at          timestamptz,
  reviewed_by           uuid references profiles (id) on delete set null,
  reviewed_at           timestamptz,
  rejection_reason      text,
  revision_note         text,
  assigned_route_id     uuid references routes (id) on delete set null,
  assigned_stop_id      uuid references bus_stops (id) on delete set null,
  assigned_bus_id       uuid references buses (id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint applications_rejection_reason_required
    check (status <> 'rejected' or coalesce(btrim(rejection_reason), '') <> ''),
  constraint applications_revision_note_required
    check (status <> 'revision_requested' or coalesce(btrim(revision_note), '') <> ''),
  constraint applications_approval_requires_assignment
    check (status <> 'approved'
           or (assigned_route_id is not null and assigned_stop_id is not null)),
  constraint applications_submitted_at_present
    check (status in ('draft', 'cancelled') or submitted_at is not null)
);

-- "Ketentuan 1 form 1 siswa": one live application per student per year.
create unique index applications_one_live_per_student_year
  on applications (student_id, academic_year_id)
  where status <> 'cancelled';

create index applications_status_idx on applications (status, submitted_at);
create index applications_parent_idx on applications (parent_profile_id);
create index applications_requested_stop_idx on applications (requested_stop_id);

create table application_documents (
  id              uuid primary key default gen_random_uuid(),
  application_id  uuid not null references applications (id) on delete cascade,
  doc_type        document_type not null,
  storage_path    text not null,
  mime_type       text not null,
  size_bytes      integer check (size_bytes > 0),
  uploaded_at     timestamptz not null default now()
);

create index application_documents_app_idx on application_documents (application_id, doc_type);

create unique index application_documents_single_photo
  on application_documents (application_id)
  where doc_type = 'student_photo';

-- Legal evidence. One consent record per application; immutable once written.
create table consents (
  id                        uuid primary key default gen_random_uuid(),
  application_id            uuid not null unique
                              references applications (id) on delete cascade,
  rule_document_id          uuid not null references rule_documents (id) on delete restrict,
  signer_profile_id         uuid not null references profiles (id) on delete restrict,
  signer_name               text not null,
  agreed_to_rules           boolean not null,
  -- The clause that makes suspension/revocation enforceable.
  acknowledged_revocation   boolean not null,
  signature_path            text not null,           -- private PNG of the drawn signature
  signed_at                 timestamptz not null default now(),
  ip_address                inet,
  user_agent                text,
  device_info               jsonb,

  constraint consents_must_agree check (agreed_to_rules),
  constraint consents_must_acknowledge_revocation check (acknowledged_revocation),
  constraint consents_signature_required
    check (coalesce(btrim(signature_path), '') <> '')
);

-- -----------------------------------------------------------------------------
-- 6. Digital bus ID cards
-- -----------------------------------------------------------------------------

create table bus_id_cards (
  id                uuid primary key default gen_random_uuid(),
  card_no           text not null unique,             -- 'YPJ-BUS-2526-00001'
  transit_id        text not null unique,             -- short scannable id, e.g. 'KK4X7P2M'
  application_id    uuid not null unique references applications (id) on delete cascade,
  student_id        uuid not null references students (id) on delete cascade,
  academic_year_id  uuid not null references academic_years (id) on delete restrict,
  route_id          uuid not null references routes (id) on delete restrict,
  bus_stop_id       uuid not null references bus_stops (id) on delete restrict,
  photo_path        text,
  status            card_status not null default 'active',
  -- HMAC key for the offline-verifiable static QR payload. Never leaves the server
  -- unencrypted; the client receives only signed payloads.
  qr_secret         text not null default encode(gen_random_bytes(32), 'hex'),
  qr_version        integer not null default 1,
  issued_at         timestamptz not null default now(),
  valid_until       date not null,
  status_reason     text,
  status_changed_at timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index bus_id_cards_student_idx on bus_id_cards (student_id);
create index bus_id_cards_status_idx on bus_id_cards (status);
create index bus_id_cards_route_idx on bus_id_cards (route_id, bus_stop_id);

-- Rotating (dynamic) QR tokens, ~60 s lifetime, single use.
create table card_tokens (
  id           uuid primary key default gen_random_uuid(),
  card_id      uuid not null references bus_id_cards (id) on delete cascade,
  token_hash   text not null unique,
  issued_at    timestamptz not null default now(),
  expires_at   timestamptz not null,
  consumed_at  timestamptz,
  constraint card_tokens_window check (expires_at > issued_at)
);

create index card_tokens_card_idx on card_tokens (card_id, expires_at desc);

create table scan_logs (
  id             uuid primary key default gen_random_uuid(),
  card_id        uuid references bus_id_cards (id) on delete set null,
  scanned_by     uuid references profiles (id) on delete set null,
  bus_id         uuid references buses (id) on delete set null,
  bus_stop_id    uuid references bus_stops (id) on delete set null,
  direction      scan_direction not null default 'boarding',
  result         scan_result not null,
  scanned_at     timestamptz not null default now(),
  synced_at      timestamptz,
  raw_payload    text,
  device_info    jsonb
);

create index scan_logs_card_idx on scan_logs (card_id, scanned_at desc);
create index scan_logs_day_idx on scan_logs (scanned_at desc);

-- -----------------------------------------------------------------------------
-- 7. Violations and sanctions
-- -----------------------------------------------------------------------------

create table violations (
  id              uuid primary key default gen_random_uuid(),
  student_id      uuid not null references students (id) on delete cascade,
  card_id         uuid references bus_id_cards (id) on delete set null,
  category        violation_category not null,
  severity        integer not null default 1 check (severity between 1 and 3),
  description     text,
  evidence_path   text,
  occurred_at     timestamptz not null default now(),
  bus_id          uuid references buses (id) on delete set null,
  reported_by     uuid references profiles (id) on delete set null,
  created_at      timestamptz not null default now()
);

create index violations_student_idx on violations (student_id, occurred_at desc);

create table sanctions (
  id            uuid primary key default gen_random_uuid(),
  student_id    uuid not null references students (id) on delete cascade,
  violation_id  uuid references violations (id) on delete set null,
  card_id       uuid references bus_id_cards (id) on delete set null,
  action        sanction_action not null,
  reason        text not null,
  starts_on     date not null default current_date,
  ends_on       date,                                  -- null = permanent
  issued_by     uuid references profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  constraint sanctions_suspension_needs_end
    check (action <> 'suspension' or ends_on is not null),
  constraint sanctions_range check (ends_on is null or ends_on >= starts_on)
);

create index sanctions_student_idx on sanctions (student_id, starts_on desc);

-- -----------------------------------------------------------------------------
-- 8. Notifications and audit
-- -----------------------------------------------------------------------------

create table notifications (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid not null references profiles (id) on delete cascade,
  channel       notification_channel not null,
  template_key  text not null,
  payload       jsonb not null default '{}',
  status        text not null default 'queued'
                  check (status in ('queued', 'sent', 'failed', 'read')),
  error         text,
  sent_at       timestamptz,
  read_at       timestamptz,
  created_at    timestamptz not null default now()
);

create index notifications_profile_idx on notifications (profile_id, created_at desc);

create table audit_logs (
  id          bigserial primary key,
  actor_id    uuid references profiles (id) on delete set null,
  action      text not null,
  entity      text not null,
  entity_id   uuid,
  before      jsonb,
  after       jsonb,
  ip_address  inet,
  created_at  timestamptz not null default now()
);

create index audit_logs_entity_idx on audit_logs (entity, entity_id, created_at desc);

-- -----------------------------------------------------------------------------
-- 9. Reporting views
-- -----------------------------------------------------------------------------

-- Live load per stop: the number the parent form never showed, which is how
-- TPS#17 ended up with 47 requests against 45 seats.
create view v_bus_stop_load as
select
  s.id                as bus_stop_id,
  s.code,
  s.name,
  s.area,
  s.seat_capacity,
  count(distinct c.id) filter (where c.status = 'active')       as issued_active,
  count(distinct a.id) filter (where a.status in ('submitted', 'under_review')) as pending_requests,
  greatest(s.seat_capacity - count(distinct c.id)
    filter (where c.status = 'active'), 0)                      as seats_remaining
from bus_stops s
left join bus_id_cards c on c.bus_stop_id = s.id
left join applications a on a.requested_stop_id = s.id
group by s.id, s.code, s.name, s.area, s.seat_capacity;

create view v_route_load as
select
  r.id            as route_id,
  r.code,
  r.name,
  r.seat_capacity,
  count(c.id) filter (where c.status = 'active') as issued_active,
  greatest(r.seat_capacity - count(c.id)
    filter (where c.status = 'active'), 0)       as seats_remaining
from routes r
left join bus_id_cards c on c.route_id = r.id
group by r.id, r.code, r.name, r.seat_capacity;

-- =============================================================================
-- 10. Row Level Security
-- =============================================================================

alter table profiles              enable row level security;
alter table students              enable row level security;
alter table applications          enable row level security;
alter table application_documents enable row level security;
alter table consents              enable row level security;
alter table bus_id_cards          enable row level security;
alter table card_tokens           enable row level security;
alter table scan_logs             enable row level security;
alter table violations            enable row level security;
alter table sanctions             enable row level security;
alter table notifications         enable row level security;
alter table audit_logs            enable row level security;
alter table academic_years        enable row level security;
alter table companies             enable row level security;
alter table bus_stops             enable row level security;
alter table routes                enable row level security;
alter table route_stops           enable row level security;
alter table buses                 enable row level security;
alter table rule_documents        enable row level security;

-- Helper predicates ----------------------------------------------------------

create or replace function current_role_is(roles user_role[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles p
    where p.id = auth.uid() and p.role = any (roles) and p.is_active
  );
$$;

create or replace function is_transport_admin()
returns boolean language sql stable as
$$ select current_role_is(array['transport_admin', 'super_admin']::user_role[]) $$;

create or replace function is_staff()
returns boolean language sql stable as
$$ select current_role_is(array['transport_admin', 'super_admin',
                                'school_staff', 'attendant']::user_role[]) $$;

-- Reference data: readable by any signed-in user, writable by admins ----------

do $$
declare t text;
begin
  foreach t in array array['academic_years', 'companies', 'bus_stops',
                           'routes', 'route_stops', 'buses', 'rule_documents']
  loop
    execute format(
      'create policy %1$s_read on %1$s for select to authenticated using (true)', t);
    execute format(
      'create policy %1$s_write on %1$s for all to authenticated
         using (is_transport_admin()) with check (is_transport_admin())', t);
  end loop;
end $$;

-- Profiles -------------------------------------------------------------------

create policy profiles_self_read on profiles
  for select to authenticated
  using (id = auth.uid() or is_staff());

create policy profiles_self_update on profiles
  for update to authenticated
  using (id = auth.uid() or is_transport_admin())
  with check (id = auth.uid() or is_transport_admin());

create policy profiles_self_insert on profiles
  for insert to authenticated
  with check (id = auth.uid());

-- Students -------------------------------------------------------------------

create policy students_parent_all on students
  for all to authenticated
  using (parent_profile_id = auth.uid() or is_staff())
  with check (parent_profile_id = auth.uid() or is_transport_admin());

-- Applications ---------------------------------------------------------------

create policy applications_parent_read on applications
  for select to authenticated
  using (parent_profile_id = auth.uid() or is_staff());

create policy applications_parent_insert on applications
  for insert to authenticated
  with check (parent_profile_id = auth.uid() and status = 'draft');

-- A parent may only edit their own DRAFT / revision-requested application, and
-- may not set a decision status. Submission and review go through RPCs.
create policy applications_parent_update on applications
  for update to authenticated
  using (
    (parent_profile_id = auth.uid() and status in ('draft', 'revision_requested'))
    or is_transport_admin()
  )
  with check (
    is_transport_admin()
    or (parent_profile_id = auth.uid() and status in ('draft', 'cancelled'))
  );

-- Documents ------------------------------------------------------------------

create policy application_documents_access on application_documents
  for all to authenticated
  using (
    exists (select 1 from applications a
            where a.id = application_id
              and (a.parent_profile_id = auth.uid() or is_staff()))
  )
  with check (
    exists (select 1 from applications a
            where a.id = application_id
              and a.parent_profile_id = auth.uid()
              and a.status in ('draft', 'revision_requested'))
    or is_transport_admin()
  );

-- Consents: parents may create and read their own, nobody may modify or delete.

create policy consents_read on consents
  for select to authenticated
  using (signer_profile_id = auth.uid() or is_staff());

create policy consents_insert on consents
  for insert to authenticated
  with check (signer_profile_id = auth.uid());

-- Cards ----------------------------------------------------------------------

create policy bus_id_cards_read on bus_id_cards
  for select to authenticated
  using (
    is_staff()
    or exists (select 1 from students s
               where s.id = student_id and s.parent_profile_id = auth.uid())
  );

create policy bus_id_cards_admin_write on bus_id_cards
  for all to authenticated
  using (is_transport_admin()) with check (is_transport_admin());

create policy card_tokens_owner_read on card_tokens
  for select to authenticated
  using (
    exists (select 1 from bus_id_cards c
            join students s on s.id = c.student_id
            where c.id = card_id
              and (s.parent_profile_id = auth.uid() or is_staff()))
  );

-- Scans, violations, sanctions ----------------------------------------------

create policy scan_logs_staff_all on scan_logs
  for all to authenticated
  using (is_staff()) with check (is_staff());

create policy scan_logs_parent_read on scan_logs
  for select to authenticated
  using (
    exists (select 1 from bus_id_cards c
            join students s on s.id = c.student_id
            where c.id = card_id and s.parent_profile_id = auth.uid())
  );

create policy violations_read on violations
  for select to authenticated
  using (
    is_staff()
    or exists (select 1 from students s
               where s.id = student_id and s.parent_profile_id = auth.uid())
  );

create policy violations_staff_write on violations
  for all to authenticated
  using (is_staff()) with check (is_staff());

create policy sanctions_read on sanctions
  for select to authenticated
  using (
    is_staff()
    or exists (select 1 from students s
               where s.id = student_id and s.parent_profile_id = auth.uid())
  );

create policy sanctions_admin_write on sanctions
  for all to authenticated
  using (is_transport_admin()) with check (is_transport_admin());

-- Notifications and audit ----------------------------------------------------

create policy notifications_own on notifications
  for select to authenticated
  using (profile_id = auth.uid() or is_transport_admin());

create policy notifications_mark_read on notifications
  for update to authenticated
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());

create policy audit_logs_admin_read on audit_logs
  for select to authenticated using (is_transport_admin());

-- -----------------------------------------------------------------------------
-- 11. Private storage buckets
-- -----------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('student-photos', 'student-photos', false),
       ('signatures',     'signatures',     false),
       ('documents',      'documents',      false)
on conflict (id) do nothing;

-- Objects are namespaced by the owning parent's uid: '<uid>/<student_id>.jpg'.
create policy storage_parent_manage_own on storage.objects
  for all to authenticated
  using (
    bucket_id in ('student-photos', 'signatures', 'documents')
    and ((storage.foldername(name))[1] = auth.uid()::text or is_staff())
  )
  with check (
    bucket_id in ('student-photos', 'signatures', 'documents')
    and ((storage.foldername(name))[1] = auth.uid()::text or is_transport_admin())
  );
