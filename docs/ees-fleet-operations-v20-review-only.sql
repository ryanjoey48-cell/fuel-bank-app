-- REVIEW ONLY. Do not run until the owner approves both this and the existing
-- ees-locations-map-pins-review-only.sql proposal. No schedule is installed here.
begin;

alter table public.ees_locations add column if not exists is_active boolean not null default true;
create index if not exists ees_locations_active_idx on public.ees_locations (is_active);

create table public.ees_fleet_geofence_zones (
  location_id uuid primary key references public.ees_locations(id) on delete restrict,
  radius_meters integer not null default 150 check (radius_meters between 25 and 5000),
  entry_dwell_seconds integer not null default 60 check (entry_dwell_seconds between 0 and 3600),
  exit_dwell_seconds integer not null default 60 check (exit_dwell_seconds between 0 and 3600),
  hysteresis_meters integer not null default 25 check (hysteresis_meters between 0 and 500),
  active boolean not null default false,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  check (hysteresis_meters <= radius_meters)
);

create table public.ees_fleet_geofence_zone_history (
  id bigint generated always as identity primary key,
  location_id uuid not null references public.ees_locations(id) on delete restrict,
  old_configuration jsonb,
  new_configuration jsonb not null,
  reason text not null check (length(btrim(reason)) between 5 and 500),
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  changed_at timestamptz not null default now()
);

create table public.ees_fleet_vehicle_geofence_state (
  vehicle_key text primary key check (length(vehicle_key) between 1 and 160),
  version bigint not null default 0 check (version >= 0),
  phase text not null check (phase in ('OUTSIDE','ENTRY_CANDIDATE','INSIDE','EXIT_CANDIDATE','DEPARTED','UNCERTAIN')),
  stable text not null check (stable in ('OUTSIDE','INSIDE')),
  location_id uuid references public.ees_locations(id) on delete restrict,
  candidate_since timestamptz,
  arrival_at timestamptz,
  visit_key text,
  last_source_at timestamptz,
  last_detected_at timestamptz,
  uncertain_reason text,
  updated_at timestamptz not null default now(),
  check (stable = 'OUTSIDE' or (location_id is not null and arrival_at is not null and visit_key is not null))
);

create table public.ees_fleet_visit_events (
  event_key text primary key check (length(event_key) between 1 and 400),
  visit_key text not null,
  event_type text not null check (event_type in ('arrival','departure')),
  vehicle_key text not null,
  vehicle_registration text,
  location_id uuid not null references public.ees_locations(id) on delete restrict,
  occurred_at timestamptz not null,
  confirmed_source_at timestamptz not null,
  confirmed_latitude double precision not null check (confirmed_latitude between -90 and 90),
  confirmed_longitude double precision not null check (confirmed_longitude between -180 and 180),
  detected_at timestamptz not null,
  duration_seconds integer check (duration_seconds >= 0),
  evidence text not null check (evidence = 'verified_forth_gps'),
  review_status text not null default 'unreviewed' check (review_status in ('unreviewed','confirmed','needs_review','corrected')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  booking_id uuid references public.booking_diary(id) on delete set null,
  booking_match_status text not null default 'unmatched' check (booking_match_status in ('unmatched','candidate','ambiguous','confirmed','rejected')),
  created_at timestamptz not null default now(),
  unique (visit_key, event_type)
);
create index ees_fleet_visit_events_recent_idx on public.ees_fleet_visit_events (occurred_at desc);
create index ees_fleet_visit_events_vehicle_idx on public.ees_fleet_visit_events (vehicle_key, occurred_at desc);
create index ees_fleet_visit_events_location_idx on public.ees_fleet_visit_events (location_id, occurred_at desc);

create table public.ees_fleet_event_review_history (
  id bigint generated always as identity primary key,
  event_key text not null references public.ees_fleet_visit_events(event_key) on delete restrict,
  action text not null check (action in ('confirm','mark_review','correct','match_booking','reject_booking_match')),
  previous_values jsonb not null default '{}'::jsonb,
  new_values jsonb not null default '{}'::jsonb,
  reason text not null check (length(btrim(reason)) > 0),
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table public.ees_fleet_monitor_runs (
  id bigint generated always as identity primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null check (status in ('running','succeeded','failed','skipped')),
  returned_count integer check (returned_count >= 0),
  processed_count integer check (processed_count >= 0),
  skipped_count integer check (skipped_count >= 0),
  error_code text
);

create table public.ees_fleet_monitor_lease (
  id smallint primary key default 1 check (id = 1),
  lease_token uuid,
  expires_at timestamptz not null default '-infinity'::timestamptz
);
insert into public.ees_fleet_monitor_lease (id) values (1);

create table public.ees_fleet_notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  arrivals boolean not null default false,
  departures boolean not null default false,
  extended_visits boolean not null default false,
  tracker_incidents boolean not null default false,
  gps_incidents boolean not null default false,
  speed_alerts boolean not null default false,
  quiet_start time,
  quiet_end time,
  time_zone text not null default 'Asia/Bangkok',
  updated_at timestamptz not null default now(),
  check ((quiet_start is null) = (quiet_end is null))
);

create table public.ees_fleet_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique check (length(endpoint) between 20 and 2048 and endpoint ~ '^https://'),
  p256dh text not null check (length(p256dh) between 20 and 512),
  auth_secret text not null check (length(auth_secret) between 8 and 512),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  disabled_at timestamptz,
  failure_count integer not null default 0 check (failure_count >= 0)
);
create index ees_fleet_push_subscriptions_user_idx on public.ees_fleet_push_subscriptions (user_id) where disabled_at is null;

create table public.ees_fleet_notification_inbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_key text not null check (length(source_key) between 1 and 400),
  event_key text references public.ees_fleet_visit_events(event_key) on delete restrict,
  category text not null check (category in ('arrival','departure','extended_visit','tracker_incident','gps_incident','speed_alert')),
  severity text not null check (severity in ('info','action_required','critical')),
  title_en text not null,
  title_th text not null,
  body_en text not null,
  body_th text not null,
  href text not null check (href like '/%'),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  acknowledged_at timestamptz,
  acknowledged_by uuid references auth.users(id) on delete set null,
  unique (user_id, source_key, category)
);
create index ees_fleet_notification_inbox_user_idx on public.ees_fleet_notification_inbox (user_id, created_at desc);

create table public.ees_fleet_push_delivery_attempts (
  id bigint generated always as identity primary key,
  notification_id uuid not null references public.ees_fleet_notification_inbox(id) on delete restrict,
  subscription_id uuid not null references public.ees_fleet_push_subscriptions(id) on delete restrict,
  attempted_at timestamptz not null default now(),
  status text not null check (status in ('delivered','retryable_failure','permanent_failure','skipped')),
  http_status integer,
  error_code text,
  -- Never store endpoint URLs, encryption keys or full remote error bodies here.
  unique (notification_id, subscription_id)
);

create table public.ees_fleet_push_test_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  subscription_id uuid not null references public.ees_fleet_push_subscriptions(id) on delete restrict,
  request_bucket bigint not null,
  attempted_at timestamptz not null default now(),
  status text not null check (status in ('running','delivered','retryable_failure','permanent_failure')),
  http_status integer,
  error_code text,
  unique (user_id, request_bucket)
);
create index ees_fleet_push_test_attempts_user_idx on public.ees_fleet_push_test_attempts (user_id, attempted_at desc);

alter table public.ees_fleet_geofence_zones enable row level security;
alter table public.ees_fleet_geofence_zone_history enable row level security;
alter table public.ees_fleet_vehicle_geofence_state enable row level security;
alter table public.ees_fleet_visit_events enable row level security;
alter table public.ees_fleet_event_review_history enable row level security;
alter table public.ees_fleet_monitor_runs enable row level security;
alter table public.ees_fleet_monitor_lease enable row level security;
alter table public.ees_fleet_notification_preferences enable row level security;
alter table public.ees_fleet_push_subscriptions enable row level security;
alter table public.ees_fleet_notification_inbox enable row level security;
alter table public.ees_fleet_push_delivery_attempts enable row level security;
alter table public.ees_fleet_push_test_attempts enable row level security;

create policy ees_fleet_zones_office_read on public.ees_fleet_geofence_zones for select to authenticated
  using (public.is_account_active() and public.current_account_role() in ('admin','office_staff','read_only'));
create policy ees_fleet_visits_office_read on public.ees_fleet_visit_events for select to authenticated
  using (public.is_account_active() and public.current_account_role() in ('admin','office_staff','read_only'));
create policy ees_fleet_inbox_own_read on public.ees_fleet_notification_inbox for select to authenticated
  using (auth.uid() = user_id and public.is_account_active() and public.current_account_role() in ('admin','office_staff','read_only'));
create policy ees_fleet_prefs_own_read on public.ees_fleet_notification_preferences for select to authenticated
  using (auth.uid() = user_id and public.is_account_active() and public.current_account_role() in ('admin','office_staff','read_only'));
-- Subscription endpoints and keys, state, raw attempts and monitor runs are service-role only.
-- All user writes go through verified server endpoints with permission checks.
grant select on public.ees_fleet_geofence_zones, public.ees_fleet_visit_events,
  public.ees_fleet_notification_preferences, public.ees_fleet_notification_inbox to authenticated;
grant all on public.ees_fleet_geofence_zones, public.ees_fleet_geofence_zone_history,
  public.ees_fleet_vehicle_geofence_state,
  public.ees_fleet_visit_events, public.ees_fleet_event_review_history,
  public.ees_fleet_monitor_runs, public.ees_fleet_monitor_lease, public.ees_fleet_notification_preferences,
  public.ees_fleet_push_subscriptions, public.ees_fleet_notification_inbox,
  public.ees_fleet_push_delivery_attempts, public.ees_fleet_push_test_attempts to service_role;
grant usage, select on sequence public.ees_fleet_event_review_history_id_seq,
  public.ees_fleet_monitor_runs_id_seq, public.ees_fleet_push_delivery_attempts_id_seq,
  public.ees_fleet_push_test_attempts_id_seq, public.ees_fleet_geofence_zone_history_id_seq to service_role;

create function public.set_ees_fleet_geofence_zone(
  p_location_id uuid, p_radius_meters integer, p_entry_dwell_seconds integer,
  p_exit_dwell_seconds integer, p_hysteresis_meters integer, p_active boolean,
  p_actor_user_id uuid, p_reason text
) returns void language plpgsql security invoker set search_path = '' as $zone$
declare v_old jsonb; v_new jsonb;
begin
  if auth.role() <> 'service_role' then raise exception 'service role required'; end if;
  if p_actor_user_id is null or length(btrim(coalesce(p_reason, ''))) not between 5 and 500 then raise exception 'actor and reason required'; end if;
  if p_radius_meters not between 25 and 5000 or p_entry_dwell_seconds not between 0 and 3600 or
     p_exit_dwell_seconds not between 0 and 3600 or p_hysteresis_meters not between 0 and 500 or
     p_hysteresis_meters > p_radius_meters or p_active is null then raise exception 'invalid geofence settings'; end if;
  if p_active and not exists (
    select 1 from public.ees_locations l join public.ees_location_map_pins p on p.location_id = l.id
    where l.id = p_location_id and l.is_active and l.verification_status = 'verified'
      and p.pin_type = 'destination' and p.pin_status = 'manual_confirmed'
  ) then raise exception 'active geofence requires an approved EES record and destination pin'; end if;
  select to_jsonb(z) into v_old from public.ees_fleet_geofence_zones z where z.location_id = p_location_id for update;
  insert into public.ees_fleet_geofence_zones (
    location_id,radius_meters,entry_dwell_seconds,exit_dwell_seconds,hysteresis_meters,active,updated_by,updated_at
  ) values (p_location_id,p_radius_meters,p_entry_dwell_seconds,p_exit_dwell_seconds,p_hysteresis_meters,p_active,p_actor_user_id,now())
  on conflict (location_id) do update set radius_meters=excluded.radius_meters,
    entry_dwell_seconds=excluded.entry_dwell_seconds, exit_dwell_seconds=excluded.exit_dwell_seconds,
    hysteresis_meters=excluded.hysteresis_meters, active=excluded.active,
    updated_by=excluded.updated_by, updated_at=excluded.updated_at;
  select to_jsonb(z) into v_new from public.ees_fleet_geofence_zones z where z.location_id = p_location_id;
  insert into public.ees_fleet_geofence_zone_history(location_id,old_configuration,new_configuration,reason,actor_user_id)
    values (p_location_id,v_old,v_new,btrim(p_reason),p_actor_user_id);
end;
$zone$;
revoke all on function public.set_ees_fleet_geofence_zone(uuid,integer,integer,integer,integer,boolean,uuid,text) from public, anon, authenticated;
grant execute on function public.set_ees_fleet_geofence_zone(uuid,integer,integer,integer,integer,boolean,uuid,text) to service_role;

create function public.acquire_ees_fleet_monitor_lease(p_token uuid, p_seconds integer)
returns boolean language plpgsql security invoker set search_path = '' as $lease$
declare v_id smallint;
begin
  if auth.role() <> 'service_role' then raise exception 'service role required'; end if;
  if p_token is null or p_seconds not between 30 and 300 then raise exception 'invalid lease'; end if;
  update public.ees_fleet_monitor_lease
    set lease_token = p_token, expires_at = now() + pg_catalog.make_interval(secs => p_seconds)
    where id = 1 and expires_at < now()
    returning id into v_id;
  return coalesce(v_id = 1, false);
end;
$lease$;
revoke all on function public.acquire_ees_fleet_monitor_lease(uuid,integer) from public, anon, authenticated;
grant execute on function public.acquire_ees_fleet_monitor_lease(uuid,integer) to service_role;

create function public.release_ees_fleet_monitor_lease(p_token uuid)
returns void language plpgsql security invoker set search_path = '' as $lease$
begin
  if auth.role() <> 'service_role' then raise exception 'service role required'; end if;
  update public.ees_fleet_monitor_lease set lease_token = null, expires_at = '-infinity'::timestamptz
    where id = 1 and lease_token = p_token;
end;
$lease$;
revoke all on function public.release_ees_fleet_monitor_lease(uuid) from public, anon, authenticated;
grant execute on function public.release_ees_fleet_monitor_lease(uuid) to service_role;

-- Transition and event are committed as a single transaction. Call with service_role only.
-- A version conflict causes the worker to reload state and retry evaluation.
create function public.commit_ees_fleet_geofence_transition(
  p_vehicle_key text, p_expected_version bigint, p_state jsonb, p_event jsonb default null
) returns boolean language plpgsql security invoker set search_path = '' as $fn$
declare v_current bigint;
begin
  if auth.role() <> 'service_role' then raise exception 'service role required'; end if;
  if p_vehicle_key is null or length(p_vehicle_key) not between 1 and 160 or p_expected_version < 0 then
    raise exception 'invalid transition identity';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_vehicle_key, 0));
  select version into v_current from public.ees_fleet_vehicle_geofence_state where vehicle_key = p_vehicle_key for update;
  if coalesce(v_current, 0) <> p_expected_version then return false; end if;
  if p_state->>'vehicleKey' <> p_vehicle_key then raise exception 'state identity mismatch'; end if;
  if p_event is not null then
    if p_event->>'vehicleKey' <> p_vehicle_key or p_event->>'evidence' <> 'verified_forth_gps' then
      raise exception 'event evidence mismatch';
    end if;
    insert into public.ees_fleet_visit_events (
      event_key, visit_key, event_type, vehicle_key, vehicle_registration, location_id,
      occurred_at, confirmed_source_at, confirmed_latitude, confirmed_longitude,
      detected_at, duration_seconds, evidence
    ) values (
      p_event->>'eventKey', p_event->>'visitKey', p_event->>'type', p_vehicle_key,
      p_event->>'registration', (p_event->>'locationId')::uuid,
      (p_event->>'occurredAt')::timestamptz, (p_event->>'confirmedSourceAt')::timestamptz,
      (p_event->>'confirmedLatitude')::double precision, (p_event->>'confirmedLongitude')::double precision,
      (p_event->>'detectedAt')::timestamptz, (p_event->>'durationSeconds')::integer, 'verified_forth_gps'
    ) on conflict (event_key) do nothing;
  end if;
  insert into public.ees_fleet_vehicle_geofence_state (
    vehicle_key, version, phase, stable, location_id, candidate_since, arrival_at,
    visit_key, last_source_at, last_detected_at, uncertain_reason, updated_at
  ) values (
    p_vehicle_key, p_expected_version + 1, p_state->>'phase', p_state->>'stable',
    (p_state->>'locationId')::uuid, (p_state->>'candidateSince')::timestamptz,
    (p_state->>'arrivalAt')::timestamptz, p_state->>'visitKey',
    (p_state->>'lastSourceAt')::timestamptz, (p_state->>'lastDetectedAt')::timestamptz,
    p_state->>'uncertainReason', now()
  ) on conflict (vehicle_key) do update set
    version = excluded.version, phase = excluded.phase, stable = excluded.stable,
    location_id = excluded.location_id, candidate_since = excluded.candidate_since,
    arrival_at = excluded.arrival_at, visit_key = excluded.visit_key,
    last_source_at = excluded.last_source_at, last_detected_at = excluded.last_detected_at,
    uncertain_reason = excluded.uncertain_reason, updated_at = now();
  return true;
end;
$fn$;
revoke all on function public.commit_ees_fleet_geofence_transition(text,bigint,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.commit_ees_fleet_geofence_transition(text,bigint,jsonb,jsonb) to service_role;

commit;
