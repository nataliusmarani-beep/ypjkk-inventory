-- =============================================================================
-- YPJ School Bus Management Application
-- Migration 0002 — functions, triggers and RPCs
--   * updated_at maintenance
--   * application number generation
--   * submit guard: photo + e-signature + revocation consent are mandatory
--   * approval trigger: automatic Bus ID card + QR issuance
--   * capacity guard per stop and per route
--   * rotating QR token issuance and scan verification
--   * sanctions -> card status enforcement
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Generic helpers
-- -----------------------------------------------------------------------------

create or replace function touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['bus_stops', 'routes', 'profiles', 'students', 'buses',
                           'applications', 'bus_id_cards']
  loop
    execute format(
      'create trigger %1$s_touch before update on %1$s
         for each row execute function touch_updated_at()', t);
  end loop;
end $$;

create or replace function write_audit(
  p_action text, p_entity text, p_entity_id uuid,
  p_before jsonb, p_after jsonb
) returns void language sql security definer set search_path = public as $$
  insert into audit_logs (actor_id, action, entity, entity_id, before, after)
  values (auth.uid(), p_action, p_entity, p_entity_id, p_before, p_after);
$$;

-- New auth user -> profile row (parents self-register).
create or replace function handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    new.email,
    coalesce((new.raw_user_meta_data ->> 'role')::user_role, 'parent')
  )
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_auth_user();

-- -----------------------------------------------------------------------------
-- 1. Application number:  YPJ-BUS-2526-00001
-- -----------------------------------------------------------------------------

create sequence if not exists application_no_seq;

create or replace function next_application_no(p_academic_year_id uuid)
returns text language plpgsql as $$
declare v_short text;
begin
  select short_code into v_short from academic_years where id = p_academic_year_id;
  if v_short is null then
    raise exception 'Unknown academic year %', p_academic_year_id;
  end if;
  return format('YPJ-BUS-%s-%s', v_short,
                lpad(nextval('application_no_seq')::text, 5, '0'));
end $$;

-- -----------------------------------------------------------------------------
-- 2. Submit guard — Module 1 business rule
--    "Form cannot be submitted without an e-signature and photo upload."
-- -----------------------------------------------------------------------------

create or replace function assert_application_submittable(p_application_id uuid)
returns void language plpgsql as $$
declare
  v_has_photo     boolean;
  v_consent       consents;
  v_student       students;
begin
  select exists (
    select 1 from application_documents
    where application_id = p_application_id and doc_type = 'student_photo'
  ) into v_has_photo;

  select s.* into v_student
  from students s join applications a on a.student_id = s.id
  where a.id = p_application_id;

  if not v_has_photo and coalesce(btrim(v_student.photo_path), '') = '' then
    raise exception 'Foto siswa wajib diunggah sebelum pengajuan dikirim.'
      using errcode = 'check_violation', hint = 'student_photo_missing';
  end if;

  select * into v_consent from consents where application_id = p_application_id;

  if v_consent.id is null then
    raise exception 'Persetujuan peraturan dan tanda tangan wajib diisi.'
      using errcode = 'check_violation', hint = 'consent_missing';
  end if;

  if coalesce(btrim(v_consent.signature_path), '') = '' then
    raise exception 'Tanda tangan elektronik wajib diisi.'
      using errcode = 'check_violation', hint = 'signature_missing';
  end if;

  if not v_consent.acknowledged_revocation then
    raise exception 'Orang tua wajib menyetujui pencabutan hak pengguna bis '
                    'apabila terjadi pelanggaran.'
      using errcode = 'check_violation', hint = 'revocation_not_acknowledged';
  end if;
end $$;

-- RPC used by the mobile app. Runs the guard, stamps the number, snapshots data.
create or replace function submit_application(p_application_id uuid)
returns applications
language plpgsql security definer set search_path = public as $$
declare
  v_app applications;
  v_before jsonb;
begin
  select * into v_app from applications where id = p_application_id for update;

  if v_app.id is null then
    raise exception 'Pengajuan tidak ditemukan.';
  end if;
  if v_app.parent_profile_id <> auth.uid() and not is_transport_admin() then
    raise exception 'Tidak berwenang mengirim pengajuan ini.';
  end if;
  if v_app.status not in ('draft', 'revision_requested') then
    raise exception 'Pengajuan dengan status % tidak dapat dikirim.', v_app.status;
  end if;

  perform assert_application_submittable(p_application_id);

  v_before := to_jsonb(v_app);

  update applications a
     set status         = 'submitted',
         submitted_at   = now(),
         application_no = coalesce(a.application_no,
                                   next_application_no(a.academic_year_id)),
         revision_note  = null,
         submitted_snapshot = (
           select jsonb_build_object(
             'student',   jsonb_build_object('full_name', s.full_name,
                                             'grade', s.grade,
                                             'photo_path', s.photo_path),
             'parent',    jsonb_build_object('full_name', p.full_name,
                                             'phone_primary', p.phone_primary,
                                             'phone_alternate', p.phone_alternate,
                                             'employee_id', p.employee_id,
                                             'company_id', p.company_id,
                                             'company_other', p.company_other,
                                             'department', p.department,
                                             'home_address', p.home_address,
                                             'email', p.email),
             'requested_stop', jsonb_build_object('code', bs.code, 'name', bs.name)
           )
           from students s, profiles p, bus_stops bs
           where s.id = a.student_id
             and p.id = a.parent_profile_id
             and bs.id = a.requested_stop_id
         )
   where a.id = p_application_id
   returning * into v_app;

  perform write_audit('application.submitted', 'applications', v_app.id,
                      v_before, to_jsonb(v_app));

  insert into notifications (profile_id, channel, template_key, payload)
  select p.id, 'in_app', 'application.received',
         jsonb_build_object('application_no', v_app.application_no)
  from profiles p where p.id = v_app.parent_profile_id;

  return v_app;
end $$;

-- -----------------------------------------------------------------------------
-- 3. Capacity guard — Module 2
-- -----------------------------------------------------------------------------

create or replace function assert_capacity_available(
  p_route_id uuid, p_stop_id uuid, p_exclude_application_id uuid default null
) returns void language plpgsql as $$
declare
  v_stop  record;
  v_route record;
begin
  select * into v_stop from v_bus_stop_load where bus_stop_id = p_stop_id;
  if v_stop.bus_stop_id is null then
    raise exception 'Titik penjemputan tidak ditemukan.';
  end if;
  if v_stop.seat_capacity > 0 and v_stop.issued_active >= v_stop.seat_capacity then
    raise exception '% (%) sudah penuh: %/% kursi terpakai.',
      v_stop.code, v_stop.name, v_stop.issued_active, v_stop.seat_capacity
      using errcode = 'check_violation', hint = 'stop_full';
  end if;

  select * into v_route from v_route_load where route_id = p_route_id;
  if v_route.route_id is null then
    raise exception 'Rute tidak ditemukan.';
  end if;
  if v_route.seat_capacity > 0 and v_route.issued_active >= v_route.seat_capacity then
    raise exception 'Rute % sudah penuh: %/% kursi terpakai.',
      v_route.code, v_route.issued_active, v_route.seat_capacity
      using errcode = 'check_violation', hint = 'route_full';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 4. Module 3 — automatic Bus ID card issuance on approval
-- -----------------------------------------------------------------------------

-- Crockford-ish base32, no vowels, so transit ids cannot spell anything and
-- cannot be confused when read aloud over the radio.
create or replace function generate_transit_id()
returns text language plpgsql as $$
declare
  alphabet constant text := '0123456789BCDFGHJKLMNPQRSTVWXZ';
  candidate text;
begin
  loop
    candidate := '';
    for i in 1..8 loop
      candidate := candidate ||
        substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from bus_id_cards where transit_id = candidate);
  end loop;
  return candidate;
end $$;

create or replace function issue_card_on_approval()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_valid_until date;
  v_photo       text;
  v_card        bus_id_cards;
begin
  if new.status <> 'approved' or old.status = 'approved' then
    return new;
  end if;

  perform assert_capacity_available(new.assigned_route_id, new.assigned_stop_id, new.id);

  select ends_on into v_valid_until from academic_years where id = new.academic_year_id;

  select coalesce(
           (select storage_path from application_documents
             where application_id = new.id and doc_type = 'student_photo' limit 1),
           s.photo_path)
    into v_photo
  from students s where s.id = new.student_id;

  insert into bus_id_cards (
    card_no, transit_id, application_id, student_id, academic_year_id,
    route_id, bus_stop_id, photo_path, status, valid_until
  ) values (
    coalesce(new.application_no, next_application_no(new.academic_year_id)),
    generate_transit_id(), new.id, new.student_id, new.academic_year_id,
    new.assigned_route_id, new.assigned_stop_id, v_photo, 'active', v_valid_until
  )
  on conflict (application_id) do update
    set status      = 'active',
        route_id    = excluded.route_id,
        bus_stop_id = excluded.bus_stop_id,
        photo_path  = excluded.photo_path,
        valid_until = excluded.valid_until,
        updated_at  = now()
  returning * into v_card;

  perform write_audit('card.issued', 'bus_id_cards', v_card.id, null, to_jsonb(v_card));

  insert into notifications (profile_id, channel, template_key, payload)
  values (new.parent_profile_id, 'in_app', 'card.issued',
          jsonb_build_object('card_no', v_card.card_no,
                             'transit_id', v_card.transit_id));

  return new;
end $$;

create trigger applications_issue_card
  after update of status on applications
  for each row execute function issue_card_on_approval();

-- Rejection / revision notification
create or replace function notify_application_decision()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = old.status then
    return new;
  end if;

  if new.status = 'rejected' then
    insert into notifications (profile_id, channel, template_key, payload)
    values (new.parent_profile_id, 'in_app', 'application.rejected',
            jsonb_build_object('application_no', new.application_no,
                               'reason', new.rejection_reason));
  elsif new.status = 'revision_requested' then
    insert into notifications (profile_id, channel, template_key, payload)
    values (new.parent_profile_id, 'in_app', 'application.revision_requested',
            jsonb_build_object('application_no', new.application_no,
                               'note', new.revision_note));
  end if;
  return new;
end $$;

create trigger applications_notify_decision
  after update of status on applications
  for each row execute function notify_application_decision();

-- Admin review RPC: single entry point for approve / reject / request revision.
create or replace function review_application(
  p_application_id   uuid,
  p_decision         text,                    -- 'approve' | 'reject' | 'request_revision'
  p_route_id         uuid default null,
  p_stop_id          uuid default null,
  p_bus_id           uuid default null,
  p_reason           text default null
) returns applications
language plpgsql security definer set search_path = public as $$
declare
  v_app    applications;
  v_before jsonb;
begin
  if not is_transport_admin() then
    raise exception 'Hanya Tim Transportasi yang dapat memverifikasi pengajuan.';
  end if;

  select * into v_app from applications where id = p_application_id for update;
  if v_app.id is null then
    raise exception 'Pengajuan tidak ditemukan.';
  end if;
  if v_app.status not in ('submitted', 'under_review') then
    raise exception 'Pengajuan dengan status % tidak dapat ditinjau.', v_app.status;
  end if;

  v_before := to_jsonb(v_app);

  if p_decision = 'approve' then
    perform assert_application_submittable(p_application_id);

    update applications
       set status            = 'approved',
           assigned_route_id = coalesce(p_route_id, assigned_route_id),
           assigned_stop_id  = coalesce(p_stop_id, assigned_stop_id, requested_stop_id),
           assigned_bus_id   = coalesce(p_bus_id, assigned_bus_id),
           reviewed_by       = auth.uid(),
           reviewed_at       = now(),
           rejection_reason  = null,
           revision_note     = null,
           eligibility_snapshot = jsonb_build_object(
             'checked_at', now(),
             'checked_by', auth.uid(),
             'company_is_ptfi_group', (
               select coalesce(c.is_ptfi_group, false)
               from profiles p left join companies c on c.id = p.company_id
               where p.id = applications.parent_profile_id
             ))
     where id = p_application_id
     returning * into v_app;

  elsif p_decision = 'reject' then
    if coalesce(btrim(p_reason), '') = '' then
      raise exception 'Alasan penolakan wajib diisi.'
        using errcode = 'check_violation', hint = 'reason_required';
    end if;
    update applications
       set status = 'rejected', rejection_reason = p_reason,
           reviewed_by = auth.uid(), reviewed_at = now()
     where id = p_application_id
     returning * into v_app;

  elsif p_decision = 'request_revision' then
    if coalesce(btrim(p_reason), '') = '' then
      raise exception 'Catatan perbaikan wajib diisi.'
        using errcode = 'check_violation', hint = 'reason_required';
    end if;
    update applications
       set status = 'revision_requested', revision_note = p_reason,
           reviewed_by = auth.uid(), reviewed_at = now()
     where id = p_application_id
     returning * into v_app;
  else
    raise exception 'Keputusan tidak dikenal: %', p_decision;
  end if;

  perform write_audit('application.' || p_decision, 'applications',
                      v_app.id, v_before, to_jsonb(v_app));
  return v_app;
end $$;

-- -----------------------------------------------------------------------------
-- 5. QR payload: static signed part + rotating token
-- -----------------------------------------------------------------------------

-- Static, offline-verifiable payload. Carries opaque identifiers only — never
-- the child's name, address or the parent's phone number.
create or replace function build_static_qr_payload(p_card_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_card bus_id_cards;
  v_body text;
begin
  select * into v_card from bus_id_cards where id = p_card_id;
  if v_card.id is null then
    raise exception 'Kartu tidak ditemukan.';
  end if;

  v_body := format('YPJB1|%s|%s|%s|%s',
                   v_card.transit_id,
                   replace(v_card.route_id::text, '-', ''),
                   to_char(v_card.valid_until, 'YYYYMMDD'),
                   v_card.qr_version);

  return v_body || '|' ||
         left(encode(hmac(v_body, v_card.qr_secret, 'sha256'), 'hex'), 16);
end $$;

-- Rotating token for online scans (default 60 s). Returns the plaintext token
-- once; only its hash is stored.
create or replace function issue_card_token(p_card_id uuid, p_ttl_seconds int default 60)
returns table (token text, expires_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  v_token   text;
  v_expires timestamptz;
  v_allowed boolean;
begin
  select exists (
    select 1 from bus_id_cards c join students s on s.id = c.student_id
    where c.id = p_card_id
      and c.status = 'active'
      and (s.parent_profile_id = auth.uid() or is_staff())
  ) into v_allowed;

  if not v_allowed then
    raise exception 'Kartu tidak aktif atau tidak dapat diakses.';
  end if;

  v_token   := encode(gen_random_bytes(16), 'hex');
  v_expires := now() + make_interval(secs => p_ttl_seconds);

  insert into card_tokens (card_id, token_hash, expires_at)
  values (p_card_id, encode(digest(v_token, 'sha256'), 'hex'), v_expires);

  delete from card_tokens
  where card_id = p_card_id and expires_at < now() - interval '1 day';

  return query select v_token, v_expires;
end $$;

-- Full QR string handed to the app: static payload plus the rotating token.
create or replace function get_card_qr(p_card_id uuid)
returns table (payload text, expires_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  v_token text;
  v_exp   timestamptz;
begin
  select t.token, t.expires_at into v_token, v_exp
  from issue_card_token(p_card_id) t;

  return query select build_static_qr_payload(p_card_id) || '|' || v_token, v_exp;
end $$;

-- Attendant scan. Verifies signature, token freshness, card status and route,
-- then always writes a scan_logs row — including for denied boardings.
create or replace function verify_scan(
  p_payload      text,
  p_bus_id       uuid default null,
  p_bus_stop_id  uuid default null,
  p_direction    scan_direction default 'boarding',
  p_device_info  jsonb default '{}'
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  parts       text[];
  v_transit   text;
  v_sig       text;
  v_token     text;
  v_body      text;
  v_card      bus_id_cards;
  v_student   students;
  v_result    scan_result;
  v_token_row card_tokens;
begin
  if not is_staff() then
    raise exception 'Hanya petugas yang dapat memindai kartu.';
  end if;

  parts := string_to_array(p_payload, '|');
  -- YPJB1 | transit_id | route | valid_until | qr_version | signature [| token]
  if array_length(parts, 1) < 6 or parts[1] <> 'YPJB1' then
    insert into scan_logs (result, raw_payload, scanned_by, bus_id, bus_stop_id,
                           direction, device_info)
    values ('unknown_card', p_payload, auth.uid(), p_bus_id, p_bus_stop_id,
            p_direction, p_device_info);
    return jsonb_build_object('allowed', false, 'result', 'unknown_card',
                              'message', 'Kode QR tidak dikenali.');
  end if;

  v_transit := parts[2];
  v_sig     := parts[6];
  v_token   := parts[7];
  v_body    := array_to_string(parts[1:5], '|');

  select * into v_card from bus_id_cards where transit_id = v_transit;

  if v_card.id is null
     or left(encode(hmac(v_body, v_card.qr_secret, 'sha256'), 'hex'), 16) <> v_sig then
    insert into scan_logs (card_id, result, raw_payload, scanned_by, bus_id,
                           bus_stop_id, direction, device_info)
    values (v_card.id, 'unknown_card', p_payload, auth.uid(), p_bus_id,
            p_bus_stop_id, p_direction, p_device_info);
    return jsonb_build_object('allowed', false, 'result', 'unknown_card',
                              'message', 'Kartu tidak valid.');
  end if;

  select * into v_student from students where id = v_card.student_id;

  if v_card.status = 'revoked' then
    v_result := 'revoked';
  elsif v_card.status = 'suspended' then
    v_result := 'suspended';
  elsif v_card.status = 'expired' or v_card.valid_until < current_date then
    v_result := 'expired';
  elsif p_bus_id is not null
        and exists (select 1 from buses b
                    where b.id = p_bus_id
                      and b.route_id is not null
                      and b.route_id <> v_card.route_id) then
    v_result := 'wrong_route';
  elsif v_token is null then
    v_result := 'ok_offline';           -- static payload only; flagged for review
  else
    select * into v_token_row from card_tokens
     where card_id = v_card.id
       and token_hash = encode(digest(v_token, 'sha256'), 'hex')
     for update;

    if v_token_row.id is null or v_token_row.expires_at < now() then
      v_result := 'ok_offline';
    elsif v_token_row.consumed_at is not null then
      v_result := 'replay';
    else
      update card_tokens set consumed_at = now() where id = v_token_row.id;
      v_result := 'ok';
    end if;
  end if;

  insert into scan_logs (card_id, result, raw_payload, scanned_by, bus_id,
                         bus_stop_id, direction, device_info)
  values (v_card.id, v_result, p_payload, auth.uid(), p_bus_id, p_bus_stop_id,
          p_direction, p_device_info);

  return jsonb_build_object(
    'allowed',     v_result in ('ok', 'ok_offline'),
    'result',      v_result,
    'card_no',     v_card.card_no,
    'transit_id',  v_card.transit_id,
    'student_name', v_student.full_name,
    'grade',       v_student.grade,
    'photo_path',  v_card.photo_path,
    'valid_until', v_card.valid_until,
    'message', case v_result
      when 'ok'          then 'Izinkan naik.'
      when 'ok_offline'  then 'Izinkan naik (verifikasi offline).'
      when 'suspended'   then 'Hak pengguna bis sedang DITANGGUHKAN.'
      when 'revoked'     then 'Hak pengguna bis telah DICABUT.'
      when 'expired'     then 'Kartu sudah kadaluarsa.'
      when 'wrong_route' then 'Siswa tidak terdaftar pada rute bus ini.'
      when 'replay'      then 'Kode QR sudah dipakai. Minta siswa memuat ulang kartu.'
      else 'Kartu tidak valid.' end
  );
end $$;

-- -----------------------------------------------------------------------------
-- 6. Sanctions drive card status (the consequence parents consented to)
-- -----------------------------------------------------------------------------

create or replace function apply_sanction_to_card()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_card_id uuid;
begin
  v_card_id := coalesce(
    new.card_id,
    (select id from bus_id_cards
      where student_id = new.student_id and status <> 'expired'
      order by issued_at desc limit 1));

  if v_card_id is null or new.action = 'warning' then
    return new;
  end if;

  update bus_id_cards
     set status = case new.action when 'revocation' then 'revoked'
                                 else 'suspended' end,
         status_reason = new.reason,
         status_changed_at = now()
   where id = v_card_id;

  insert into notifications (profile_id, channel, template_key, payload)
  select s.parent_profile_id, 'in_app',
         case new.action when 'revocation' then 'card.revoked' else 'card.suspended' end,
         jsonb_build_object('reason', new.reason,
                            'starts_on', new.starts_on,
                            'ends_on', new.ends_on)
  from students s where s.id = new.student_id;

  perform write_audit('sanction.' || new.action, 'bus_id_cards', v_card_id,
                      null, to_jsonb(new));
  return new;
end $$;

create trigger sanctions_apply_to_card
  after insert on sanctions
  for each row execute function apply_sanction_to_card();

-- Nightly job (pg_cron): expire cards and lift finished suspensions.
create or replace function reconcile_card_statuses()
returns integer language plpgsql security definer set search_path = public as $$
declare v_count integer := 0;
begin
  update bus_id_cards
     set status = 'expired', status_changed_at = now()
   where status in ('active', 'suspended') and valid_until < current_date;
  v_count := v_count + coalesce((select count(*) from bus_id_cards
                                 where status = 'expired'), 0);

  update bus_id_cards c
     set status = 'active', status_reason = null, status_changed_at = now()
   where c.status = 'suspended'
     and c.valid_until >= current_date
     and not exists (
       select 1 from sanctions s
       where s.student_id = c.student_id
         and (s.action = 'revocation'
              or (s.action = 'suspension'
                  and s.starts_on <= current_date
                  and (s.ends_on is null or s.ends_on >= current_date))));
  return v_count;
end $$;

-- -----------------------------------------------------------------------------
-- 7. Execution grants
-- -----------------------------------------------------------------------------

revoke all on function build_static_qr_payload(uuid) from authenticated;
grant execute on function submit_application(uuid)                  to authenticated;
grant execute on function review_application(uuid, text, uuid, uuid, uuid, text)
                                                                    to authenticated;
grant execute on function get_card_qr(uuid)                         to authenticated;
grant execute on function verify_scan(text, uuid, uuid, scan_direction, jsonb)
                                                                    to authenticated;
