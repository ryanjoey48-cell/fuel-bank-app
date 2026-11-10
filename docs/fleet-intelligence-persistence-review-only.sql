-- REVIEW ONLY. NOT APPLIED. DO NOT RUN AGAINST ANY DATABASE WITHOUT WRITTEN OWNER APPROVAL.
-- V4.7 revision (replaces the V4.5 draft, whose first table had a truncated CHECK clause and would not have parsed).
-- Proposal for: (A) durable journey/job confirmation, (B) historical-route access audit, (C) reconciliation evidence snapshots.
--
-- VERIFIED AGAINST THE LIVE PROJECT "Fuel Tracker App" (ref hafoaurzfgkkwpvzedvd), read-only catalogue checks, 2026-11-06:
--   * public.profiles does NOT exist. Roles come from public.account_access(user_id uuid pk -> auth.users, role, status).
--   * account_access role check allows ONLY admin, office_staff, read_only. super_admin is NOT allowed live. In use: 2 admin + 2 office_staff, all active.
--   * The helpers exist and are SECURITY DEFINER: current_account_role(), is_account_active(), is_account_admin() (= role admin and active), is_office_account(), is_support_ticket_admin().
--   * booking_diary.id is uuid; booking_diary.vehicle_id is uuid (nullable); booking_diary.driver_id is BIGINT (references drivers.id); booking_diary.booking_id is text; pickup_time is time.
--   * vehicles.id is uuid. auth.users.id is uuid.
--   * btree_gist is NOT installed. This version needs no extension: overlap is checked inside the write function under an advisory lock.
--   * New tables in schema public get FULL privileges for anon, authenticated and service_role by default (pg_default_acl). Every table below therefore starts with REVOKE ALL FROM anon, authenticated.
--   * The live project has no migration history: apply as a reviewed script, on "EES Development" first.
--   * 15 other tables are exposed (see docs/fleet-intelligence-v47-access-control-audit.md); this script does not touch them.
-- Booking Diary, Finance, Fuel Logs, Weekly Mileage, Maintenance and Forth data are only REFERENCED or COPIED into snapshots; nothing in them is ever written.
-- The script ends in ROLLBACK so pasting it into a console changes nothing.

begin;

do $guard$
begin
  if to_regclass('public.account_access') is null or to_regclass('public.booking_diary') is null or to_regclass('public.vehicles') is null then
    raise exception 'account_access, booking_diary and vehicles must exist';
  end if;
  if to_regprocedure('public.is_account_admin()') is null or to_regprocedure('public.is_office_account()') is null or to_regprocedure('public.current_account_role()') is null then
    raise exception 'role helper functions missing: stop and review (do not recreate them from this script)';
  end if;
end
$guard$;

-- Shared guard: blocks UPDATE, DELETE and TRUNCATE on the append-only tables, for every role including service_role.
create or replace function public.fleet_events_are_immutable() returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'append-only table: % is not allowed', tg_op using errcode = '42501';
end
$$;

-- ============================================================================================================================
-- A. Durable journey/job confirmation: an append-only, versioned event log plus a one-row-per-booking current state.
-- ============================================================================================================================
create table if not exists public.fleet_confirmation_events (
  id                      uuid primary key default gen_random_uuid(),
  booking_id              uuid not null references public.booking_diary(id) on delete restrict,
  version                 integer not null check (version >= 1),                 -- 1, 2, 3 ... per booking: the change history
  vehicle_id              uuid not null references public.vehicles(id) on delete restrict,
  day                     date not null,                                          -- Asia/Bangkok calendar day
  forth_device_id         text not null check (forth_device_id ~ '^[A-Za-z0-9_-]{1,40}$'),
  segment_hash            text not null check (segment_hash ~ '^[0-9a-f]{64}$'),  -- sha256 of device|day|start|end|km, computed by the server
  segment_start           timestamptz not null,
  segment_end             timestamptz not null,                                   -- an open (unclosed) provider segment can never be decided
  segment_km              numeric(10,2) not null check (segment_km >= 0),
  provider_coverage       text not null check (provider_coverage in ('reconciled_complete','reconciled_coverage_unverified')),  -- what was known about the Forth report when the decision was made
  position_source         text not null check (position_source in ('gps','no_gps','mixed','none')),                            -- the labels stay as reported; No GPS is never recorded as verified
  decision                text not null check (decision in ('confirm','reject','needs_review')),
  evidence                jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object' and pg_column_size(evidence) <= 8192),  -- reasons and counts only. NO coordinates.
  booking_registration    text,                                                   -- copies of what Booking Diary said at decision time (the booking itself is never changed)
  booking_pickup_time     time,
  booking_job_order       text,
  decided_by              uuid not null references auth.users(id) on delete restrict,
  decided_role            text not null check (decided_role in ('admin','office_staff')),   -- the roles allowed by the live account_access constraint
  decided_at              timestamptz not null default now(),
  supersedes_id           uuid references public.fleet_confirmation_events(id) on delete restrict,
  idempotency_key         text not null check (length(idempotency_key) between 8 and 80),
  correlation_id          text check (correlation_id is null or correlation_id ~ '^[A-Za-z0-9-]{8,64}$'),
  check (segment_end > segment_start),
  unique (booking_id, version),
  unique (decided_by, idempotency_key)                                           -- a retried request cannot create a second decision
);

create table if not exists public.fleet_journey_job_confirmations (
  booking_id       uuid primary key references public.booking_diary(id) on delete restrict,   -- one current decision per job
  vehicle_id       uuid not null references public.vehicles(id) on delete restrict,
  day              date not null,
  segment_hash     text not null,
  segment_start    timestamptz not null,
  segment_end      timestamptz not null,
  segment_km       numeric(10,2) not null,
  decision         text not null check (decision in ('confirm','reject','needs_review')),
  event_id         uuid not null references public.fleet_confirmation_events(id) on delete restrict,
  decided_by       uuid not null references auth.users(id) on delete restrict,
  decided_at       timestamptz not null
);

create index if not exists fleet_confirmation_events_booking_idx on public.fleet_confirmation_events (booking_id, version desc);
create index if not exists fleet_confirmation_events_vehicle_day_idx on public.fleet_confirmation_events (vehicle_id, day);
create index if not exists fleet_journey_job_confirmations_vehicle_idx on public.fleet_journey_job_confirmations (vehicle_id, segment_start, segment_end) where decision = 'confirm';
create index if not exists fleet_journey_job_confirmations_segment_idx on public.fleet_journey_job_confirmations (vehicle_id, segment_hash) where decision = 'confirm';

create trigger fleet_confirmation_events_immutable before update or delete on public.fleet_confirmation_events for each row execute function public.fleet_events_are_immutable();
create trigger fleet_confirmation_events_no_truncate before truncate on public.fleet_confirmation_events for each statement execute function public.fleet_events_are_immutable();

-- The ONLY write path. SECURITY DEFINER, administrator-checked, idempotent. Event and current row are written in one transaction.
-- Rules enforced here: several jobs may share ONE journey (multi-stop), but two DIFFERENT confirmed journeys of one vehicle may not overlap in time.
-- To let office_staff confirm too, change the first check to: public.current_account_role() in ('admin','office_staff')  (approval question 2).
create or replace function public.fleet_record_journey_decision(
  p_booking uuid, p_vehicle uuid, p_day date, p_device text, p_hash text, p_start timestamptz, p_end timestamptz, p_km numeric,
  p_coverage text, p_position_source text, p_decision text, p_evidence jsonb,
  p_booking_registration text, p_booking_pickup_time time, p_booking_job_order text, p_key text, p_correlation text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_event uuid; v_role text; v_version integer; v_previous uuid; v_conflict uuid;
begin
  if not public.is_account_admin() then raise exception 'administrator access required' using errcode = '42501'; end if;
  select id into v_event from public.fleet_confirmation_events where decided_by = auth.uid() and idempotency_key = p_key;
  if v_event is not null then return v_event; end if;                                   -- idempotent replay returns the first result
  perform pg_advisory_xact_lock(hashtextextended(p_vehicle::text || ':' || p_day::text, 0));   -- serialises decisions for one vehicle-day
  if p_decision = 'confirm' then
    select c.booking_id into v_conflict from public.fleet_journey_job_confirmations c
      where c.vehicle_id = p_vehicle and c.decision = 'confirm' and c.booking_id <> p_booking and c.segment_hash <> p_hash
        and tstzrange(c.segment_start, c.segment_end) && tstzrange(p_start, p_end) limit 1;
    if v_conflict is not null then raise exception 'a different confirmed journey of this vehicle overlaps in time' using errcode = '23P01'; end if;
  end if;
  v_role := public.current_account_role();
  select event_id into v_previous from public.fleet_journey_job_confirmations where booking_id = p_booking;
  select coalesce(max(version), 0) + 1 into v_version from public.fleet_confirmation_events where booking_id = p_booking;
  insert into public.fleet_confirmation_events (booking_id, version, vehicle_id, day, forth_device_id, segment_hash, segment_start, segment_end, segment_km, provider_coverage, position_source,
      decision, evidence, booking_registration, booking_pickup_time, booking_job_order, decided_by, decided_role, supersedes_id, idempotency_key, correlation_id)
    values (p_booking, v_version, p_vehicle, p_day, p_device, p_hash, p_start, p_end, p_km, p_coverage, p_position_source,
      p_decision, coalesce(p_evidence, '{}'::jsonb), p_booking_registration, p_booking_pickup_time, p_booking_job_order, auth.uid(), v_role, v_previous, p_key, p_correlation)
    returning id into v_event;
  insert into public.fleet_journey_job_confirmations (booking_id, vehicle_id, day, segment_hash, segment_start, segment_end, segment_km, decision, event_id, decided_by, decided_at)
    values (p_booking, p_vehicle, p_day, p_hash, p_start, p_end, p_km, p_decision, v_event, auth.uid(), now())
    on conflict (booking_id) do update set vehicle_id = excluded.vehicle_id, day = excluded.day, segment_hash = excluded.segment_hash, segment_start = excluded.segment_start,
      segment_end = excluded.segment_end, segment_km = excluded.segment_km, decision = excluded.decision, event_id = excluded.event_id, decided_by = excluded.decided_by, decided_at = excluded.decided_at;
  return v_event;
end
$$;
revoke all on function public.fleet_record_journey_decision(uuid, uuid, date, text, text, timestamptz, timestamptz, numeric, text, text, text, jsonb, text, time, text, text, text) from public, anon;
grant execute on function public.fleet_record_journey_decision(uuid, uuid, date, text, text, timestamptz, timestamptz, numeric, text, text, text, jsonb, text, time, text, text, text) to authenticated;

alter table public.fleet_confirmation_events enable row level security;
alter table public.fleet_journey_job_confirmations enable row level security;
create policy fleet_confirmation_events_read on public.fleet_confirmation_events for select to authenticated using (public.is_office_account());
create policy fleet_journey_job_confirmations_read on public.fleet_journey_job_confirmations for select to authenticated using (public.is_office_account());
-- Default privileges would otherwise give anon and authenticated full access to these new tables.
revoke all on public.fleet_confirmation_events, public.fleet_journey_job_confirmations from anon, authenticated;
grant select on public.fleet_confirmation_events, public.fleet_journey_job_confirmations to authenticated;

-- ============================================================================================================================
-- B. Historical-route access audit (what lib/forth-history-audit.ts records today, in memory). No coordinates, tokens or bodies.
-- ============================================================================================================================
create table if not exists public.forth_history_access_audit (
  id                uuid primary key default gen_random_uuid(),
  correlation_id    text not null check (correlation_id ~ '^[A-Za-z0-9-]{8,64}$'),
  occurred_at       timestamptz not null default now(),
  user_id           uuid references auth.users(id) on delete set null,           -- keeps the event if the account is removed; the id is the only personal identifier stored
  role              text check (role in ('admin','office_staff','read_only')),
  access_basis      text check (access_basis in ('role_permission','explicit_allowlist')),
  action            text not null check (action in ('playback_points','journey_report','journey_detail')),
  outcome           text not null check (outcome in ('authorised_ready','unauthenticated','denied_no_office_access','denied_playback_permission','denied_gate_closed',
                      'rejected_invalid_request','rejected_device_not_in_fleet','rejected_ambiguous_device','rate_limited','upstream_unavailable','error')),
  reason            text check (reason ~ '^[a-z0-9_]{1,60}$'),
  http_status       integer,
  device_id         text check (device_id ~ '^[A-Za-z0-9_-]{1,40}$' or device_id = 'invalid'),
  request_date      text,
  window_start      text,
  window_end        text,
  observation_count integer check (observation_count is null or observation_count >= 0)
);
create index if not exists forth_history_access_audit_time_idx on public.forth_history_access_audit (occurred_at desc);
create index if not exists forth_history_access_audit_user_idx on public.forth_history_access_audit (user_id, occurred_at desc);
create trigger forth_history_access_audit_immutable before update or delete on public.forth_history_access_audit for each row execute function public.fleet_events_are_immutable();
create trigger forth_history_access_audit_no_truncate before truncate on public.forth_history_access_audit for each statement execute function public.fleet_events_are_immutable();
alter table public.forth_history_access_audit enable row level security;
create policy forth_history_access_audit_admin_read on public.forth_history_access_audit for select to authenticated using (public.is_account_admin());
revoke all on public.forth_history_access_audit from anon, authenticated;       -- the server inserts with the service role only
grant select on public.forth_history_access_audit to authenticated;

-- ============================================================================================================================
-- C. Source evidence / reconciliation snapshots: what the screen showed when a decision was made. Append-only, deduplicated by content.
-- ============================================================================================================================
create table if not exists public.fleet_reconciliation_snapshots (
  id                 uuid primary key default gen_random_uuid(),
  vehicle_id         uuid not null references public.vehicles(id) on delete restrict,
  day                date not null,
  captured_at        timestamptz not null default now(),
  captured_by        uuid not null references auth.users(id) on delete restrict,
  forth_device_id    text not null,
  provider_report_captured_at timestamptz,                  -- when the Forth day report was read (the report can change; this pins which read was used)
  provider_km        numeric(10,2),                         -- null = unknown, never 0
  trail_km           numeric(10,2),
  open_final_segment boolean,                               -- the provider's last segment was open (coverage cannot be claimed complete)
  coverage           text not null check (coverage in ('not_read','not_reconciled','reconciled_coverage_unverified','reconciled_complete')),
  status             text not null check (status in ('complete_verified','partially_allocated','awaiting_office_review','conflicting_evidence','source_incomplete','unknown')),
  categories         jsonb not null check (jsonb_typeof(categories) = 'object' and pg_column_size(categories) <= 16384),   -- km per category and per journey id. NO coordinates.
  source_versions    jsonb not null check (jsonb_typeof(source_versions) = 'object' and pg_column_size(source_versions) <= 4096), -- booking fingerprint, fuel/weekly counts
  content_hash       text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  unique (vehicle_id, day, content_hash)                    -- an identical re-capture is a no-op
);
create trigger fleet_reconciliation_snapshots_immutable before update or delete on public.fleet_reconciliation_snapshots for each row execute function public.fleet_events_are_immutable();
create trigger fleet_reconciliation_snapshots_no_truncate before truncate on public.fleet_reconciliation_snapshots for each statement execute function public.fleet_events_are_immutable();
alter table public.fleet_reconciliation_snapshots enable row level security;
create policy fleet_reconciliation_snapshots_read on public.fleet_reconciliation_snapshots for select to authenticated using (public.is_office_account());
revoke all on public.fleet_reconciliation_snapshots from anon, authenticated;
grant select on public.fleet_reconciliation_snapshots to authenticated;

-- Retention (owner to decide): events, audit and snapshots 400 days online, then archive. Nothing here schedules a purge.
-- Privacy: only account ids are stored (no names, emails or coordinates); evidence JSON is size-capped and holds reasons and counts.
-- Backfill: none. No confirmations or history-access events have ever been persisted.
-- Optional stricter overlap rule (needs btree_gist, approval question 4):
--   alter table public.fleet_journey_job_confirmations add constraint no_overlapping_confirmed_journeys
--     exclude using gist (vehicle_id with =, tstzrange(segment_start, segment_end) with &&, segment_hash with <>) where (decision = 'confirm');
-- Rollback (only if no approved records exist): drop the four tables and the two functions below. If approved records exist, EXPORT them first,
--   because the tables are append-only by design and dropping them destroys the audit trail.
--   drop table public.fleet_reconciliation_snapshots, public.forth_history_access_audit, public.fleet_journey_job_confirmations, public.fleet_confirmation_events;
--   drop function public.fleet_record_journey_decision(uuid, uuid, date, text, text, timestamptz, timestamptz, numeric, text, text, text, jsonb, text, time, text, text, text);
--   drop function public.fleet_events_are_immutable();

rollback;  -- review only: remove this line ONLY after written owner approval.
