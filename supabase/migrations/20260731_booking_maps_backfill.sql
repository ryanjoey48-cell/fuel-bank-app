begin;

create type public.location_approval_status as enum (
  'pending',
  'approved',
  'rejected'
);

create type public.booking_map_resolution_status as enum (
  'legacy_unresolved',
  'unresolved_draft',
  'resolved'
);

create type public.map_backfill_batch_status as enum (
  'dry_run',
  'review',
  'approved',
  'running',
  'completed',
  'failed',
  'rolled_back'
);

create type public.map_backfill_item_status as enum (
  'ready',
  'missing_pickup',
  'missing_dropoff',
  'ambiguous_location',
  'conflicting_route',
  'google_api_failure',
  'suspicious_distance',
  'protected_manual_value',
  'applied',
  'rolled_back'
);

create or replace function public.normalize_booking_location_name(value text)
returns text
language sql
immutable
strict
set search_path = pg_catalog
as $$
  select lower(
    regexp_replace(
      regexp_replace(
        translate(
          normalize(btrim(value), NFC),
          chr(160) || chr(8203) || chr(65279),
          '   '
        ),
        '[[:punct:]]+',
        ' ',
        'g'
      ),
      '\s+',
      ' ',
      'g'
    )
  );
$$;

create table public.canonical_locations (
  id uuid primary key default gen_random_uuid(),
  display_name text not null check (length(btrim(display_name)) > 0),
  normalized_name text not null check (length(btrim(normalized_name)) > 0),
  full_google_address text not null check (length(btrim(full_google_address)) > 0),
  google_place_id text not null check (length(btrim(google_place_id)) > 0),
  latitude numeric not null check (latitude between -90 and 90),
  longitude numeric not null check (longitude between -180 and 180),
  country_code text,
  approval_status public.location_approval_status not null default 'pending',
  outside_thailand_approved boolean not null default false,
  approved_at timestamptz,
  approved_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint canonical_locations_place_id_key unique (google_place_id),
  constraint canonical_locations_approval_check check (
    approval_status <> 'approved'
    or (
      approved_at is not null
      and approved_by is not null
      and (
        upper(coalesce(country_code, '')) = 'TH'
        or outside_thailand_approved
      )
    )
  )
);

create index canonical_locations_normalized_name_idx
  on public.canonical_locations (normalized_name);

create index canonical_locations_approval_name_idx
  on public.canonical_locations (approval_status, display_name);

create table public.canonical_location_aliases (
  id uuid primary key default gen_random_uuid(),
  canonical_location_id uuid not null references public.canonical_locations(id) on delete cascade,
  client_id uuid references public.clients(id) on delete cascade,
  client_scope_id uuid generated always as (
    coalesce(client_id, '00000000-0000-0000-0000-000000000000'::uuid)
  ) stored,
  alias text not null check (length(btrim(alias)) > 0),
  normalized_alias text not null check (length(btrim(normalized_alias)) > 0),
  approval_status public.location_approval_status not null default 'pending',
  approved_at timestamptz,
  approved_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint canonical_location_aliases_approval_check check (
    approval_status <> 'approved'
    or (approved_at is not null and approved_by is not null)
  )
);

create unique index canonical_location_aliases_scope_key
  on public.canonical_location_aliases (
    normalized_alias,
    client_scope_id,
    canonical_location_id
  );

create index canonical_location_aliases_lookup_idx
  on public.canonical_location_aliases (
    normalized_alias,
    client_id,
    approval_status
  );

create table public.canonical_route_cache (
  id uuid primary key default gen_random_uuid(),
  pickup_location_id uuid not null references public.canonical_locations(id) on delete cascade,
  dropoff_location_id uuid not null references public.canonical_locations(id) on delete cascade,
  routing_preference text not null default 'TRAFFIC_AWARE_OPTIMAL',
  distance_meters bigint not null check (distance_meters > 0),
  duration_seconds bigint not null check (duration_seconds > 0),
  static_duration_seconds bigint,
  google_maps_route_url text not null,
  route_label text,
  route_description text,
  encoded_polyline text,
  traffic_aware boolean not null default true,
  fallback_info jsonb,
  calculated_at timestamptz not null,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint canonical_route_cache_route_key unique (
    pickup_location_id,
    dropoff_location_id,
    routing_preference
  )
);

create index canonical_route_cache_expiry_idx
  on public.canonical_route_cache (expires_at);

create table public.booking_map_backfill_batches (
  id uuid primary key default gen_random_uuid(),
  status public.map_backfill_batch_status not null default 'dry_run',
  dry_run boolean not null default true,
  total_bookings integer not null default 0 check (total_bookings >= 0),
  ready_count integer not null default 0 check (ready_count >= 0),
  exception_count integer not null default 0 check (exception_count >= 0),
  processed_count integer not null default 0 check (processed_count >= 0),
  cursor_booking_id uuid,
  options jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  failure_reason text,
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint booking_map_backfill_batches_dry_run_guard check (
    dry_run or status not in ('dry_run', 'review')
  )
);

create index booking_map_backfill_batches_created_idx
  on public.booking_map_backfill_batches (created_at desc);

create table public.booking_map_backfill_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.booking_map_backfill_batches(id) on delete cascade,
  booking_id uuid not null references public.booking_diary(id) on delete restrict,
  item_status public.map_backfill_item_status not null,
  pickup_location_id uuid references public.canonical_locations(id) on delete restrict,
  dropoff_location_id uuid references public.canonical_locations(id) on delete restrict,
  route_cache_id uuid references public.canonical_route_cache(id) on delete restrict,
  original_values jsonb not null,
  proposed_values jsonb,
  exact_reason text,
  suggested_correction text,
  related_booking_count integer not null default 1 check (related_booking_count > 0),
  suspicious_reasons jsonb not null default '[]'::jsonb,
  idempotency_key text not null,
  applied_at timestamptz,
  rolled_back_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint booking_map_backfill_items_batch_booking_key unique (batch_id, booking_id),
  constraint booking_map_backfill_items_idempotency_key unique (idempotency_key)
);

create index booking_map_backfill_items_status_idx
  on public.booking_map_backfill_items (batch_id, item_status);

create table public.booking_map_backfill_changes (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.booking_map_backfill_batches(id) on delete restrict,
  item_id uuid not null unique references public.booking_map_backfill_items(id) on delete restrict,
  booking_id uuid not null references public.booking_diary(id) on delete restrict,
  before_values jsonb not null,
  after_values jsonb not null,
  changed_at timestamptz not null default now(),
  changed_by uuid not null references auth.users(id) on delete restrict,
  rolled_back_at timestamptz,
  rolled_back_by uuid references auth.users(id) on delete restrict
);

create index booking_map_backfill_changes_batch_idx
  on public.booking_map_backfill_changes (batch_id, changed_at);

create or replace function public.approve_canonical_booking_location(
  target_display_name text,
  target_normalized_name text,
  target_full_google_address text,
  target_google_place_id text,
  target_latitude numeric,
  target_longitude numeric,
  target_country_code text,
  target_outside_thailand_approved boolean,
  target_alias text,
  target_normalized_alias text,
  target_client_id uuid,
  actor_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_location_id uuid;
  target_client_scope_id uuid := coalesce(
    target_client_id,
    '00000000-0000-0000-0000-000000000000'::uuid
  );
begin
  if actor_user_id is null then
    raise exception 'An authenticated administrator is required.'
      using errcode = '42501';
  end if;

  if upper(coalesce(target_country_code, '')) <> 'TH'
    and not coalesce(target_outside_thailand_approved, false)
  then
    raise exception 'Locations outside Thailand require explicit approval.'
      using errcode = '23514';
  end if;

  select location.id
    into target_location_id
    from public.canonical_locations location
    where location.google_place_id = target_google_place_id
    for update;

  target_location_id := coalesce(target_location_id, gen_random_uuid());

  if exists (
    select 1
    from public.canonical_location_aliases alias
    where alias.normalized_alias = target_normalized_alias
      and alias.client_scope_id = target_client_scope_id
      and alias.approval_status = 'approved'
      and alias.canonical_location_id <> target_location_id
  ) then
    raise exception 'This alias already points to a different approved location in the same client scope.'
      using errcode = '23505';
  end if;

  insert into public.canonical_locations (
    id,
    display_name,
    normalized_name,
    full_google_address,
    google_place_id,
    latitude,
    longitude,
    country_code,
    approval_status,
    outside_thailand_approved,
    approved_at,
    approved_by,
    created_by,
    updated_by
  ) values (
    target_location_id,
    target_display_name,
    target_normalized_name,
    target_full_google_address,
    target_google_place_id,
    target_latitude,
    target_longitude,
    target_country_code,
    'approved',
    coalesce(target_outside_thailand_approved, false),
    now(),
    actor_user_id,
    actor_user_id,
    actor_user_id
  )
  on conflict (google_place_id) do update
  set
    display_name = excluded.display_name,
    normalized_name = excluded.normalized_name,
    full_google_address = excluded.full_google_address,
    latitude = excluded.latitude,
    longitude = excluded.longitude,
    country_code = excluded.country_code,
    approval_status = 'approved',
    outside_thailand_approved = excluded.outside_thailand_approved,
    approved_at = now(),
    approved_by = actor_user_id,
    updated_by = actor_user_id;

  insert into public.canonical_location_aliases (
    canonical_location_id,
    client_id,
    alias,
    normalized_alias,
    approval_status,
    approved_at,
    approved_by,
    created_by,
    updated_by
  ) values (
    target_location_id,
    target_client_id,
    target_alias,
    target_normalized_alias,
    'approved',
    now(),
    actor_user_id,
    actor_user_id,
    actor_user_id
  )
  on conflict (normalized_alias, client_scope_id, canonical_location_id) do update
  set
    alias = excluded.alias,
    approval_status = 'approved',
    approved_at = now(),
    approved_by = actor_user_id,
    updated_by = actor_user_id;

  return target_location_id;
end;
$$;

revoke all on function public.approve_canonical_booking_location(
  text, text, text, text, numeric, numeric, text, boolean, text, text, uuid, uuid
) from public, anon, authenticated;

grant execute on function public.approve_canonical_booking_location(
  text, text, text, text, numeric, numeric, text, boolean, text, text, uuid, uuid
) to service_role;

drop trigger if exists remember_booking_diary_locations on public.booking_diary;

comment on table public.saved_locations is
  'Legacy unapproved location memory. Do not use for routing; canonical_locations is authoritative.';

alter table public.booking_diary
  add column pickup_location_id uuid references public.canonical_locations(id) on delete restrict,
  add column dropoff_location_id uuid references public.canonical_locations(id) on delete restrict,
  add column map_resolution_status public.booking_map_resolution_status not null default 'legacy_unresolved',
  add column map_backfill_batch_id uuid references public.booking_map_backfill_batches(id) on delete restrict,
  add column map_values_manually_corrected boolean not null default false,
  add column map_original_values jsonb;

create index booking_diary_pickup_location_idx
  on public.booking_diary (pickup_location_id);

create index booking_diary_dropoff_location_idx
  on public.booking_diary (dropoff_location_id);

create index booking_diary_map_resolution_idx
  on public.booking_diary (map_resolution_status, booking_date);

create or replace function public.set_booking_maps_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger set_canonical_locations_updated_at
before update on public.canonical_locations
for each row execute function public.set_booking_maps_updated_at();

create trigger set_canonical_location_aliases_updated_at
before update on public.canonical_location_aliases
for each row execute function public.set_booking_maps_updated_at();

create trigger set_canonical_route_cache_updated_at
before update on public.canonical_route_cache
for each row execute function public.set_booking_maps_updated_at();

create trigger set_booking_map_backfill_batches_updated_at
before update on public.booking_map_backfill_batches
for each row execute function public.set_booking_maps_updated_at();

create trigger set_booking_map_backfill_items_updated_at
before update on public.booking_map_backfill_items
for each row execute function public.set_booking_maps_updated_at();

create or replace function public.validate_booking_map_resolution()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  pickup_approved boolean := false;
  dropoff_approved boolean := false;
begin
  if new.pickup_location_id is not null then
    select location.approval_status = 'approved'
      into pickup_approved
      from public.canonical_locations location
      where location.id = new.pickup_location_id;
  end if;

  if new.dropoff_location_id is not null then
    select location.approval_status = 'approved'
      into dropoff_approved
      from public.canonical_locations location
      where location.id = new.dropoff_location_id;
  end if;

  if new.map_resolution_status = 'resolved' then
    if not coalesce(pickup_approved, false)
      or not coalesce(dropoff_approved, false)
      or nullif(btrim(new.pickup_place_id), '') is null
      or nullif(btrim(new.dropoff_place_id), '') is null
      or new.pickup_lat is null
      or new.pickup_lng is null
      or new.dropoff_lat is null
      or new.dropoff_lng is null
      or coalesce(new.route_distance_meters, 0) <= 0
      or coalesce(new.route_duration_seconds, 0) <= 0
      or nullif(btrim(new.google_maps_route_url), '') is null
    then
      raise exception 'Resolved bookings require two approved canonical locations and a calculated route.'
        using errcode = '23514';
    end if;
  elsif tg_op = 'INSERT' and new.map_resolution_status = 'legacy_unresolved' then
    new.map_resolution_status := 'unresolved_draft';
  end if;

  return new;
end;
$$;

create trigger validate_booking_map_resolution
before insert or update of
  pickup_location_id,
  dropoff_location_id,
  map_resolution_status,
  pickup_place_id,
  dropoff_place_id,
  pickup_lat,
  pickup_lng,
  dropoff_lat,
  dropoff_lng,
  route_distance_meters,
  route_duration_seconds,
  google_maps_route_url
on public.booking_diary
for each row execute function public.validate_booking_map_resolution();

alter table public.canonical_locations enable row level security;
alter table public.canonical_location_aliases enable row level security;
alter table public.canonical_route_cache enable row level security;
alter table public.booking_map_backfill_batches enable row level security;
alter table public.booking_map_backfill_items enable row level security;
alter table public.booking_map_backfill_changes enable row level security;

revoke all on public.canonical_locations from anon, authenticated;
revoke all on public.canonical_location_aliases from anon, authenticated;
revoke all on public.canonical_route_cache from anon, authenticated;
revoke all on public.booking_map_backfill_batches from anon, authenticated;
revoke all on public.booking_map_backfill_items from anon, authenticated;
revoke all on public.booking_map_backfill_changes from anon, authenticated;

grant select on public.canonical_locations to authenticated;
grant select on public.canonical_location_aliases to authenticated;

create policy canonical_locations_select_approved
on public.canonical_locations
for select to authenticated
using (approval_status = 'approved');

create policy canonical_location_aliases_select_approved
on public.canonical_location_aliases
for select to authenticated
using (
  approval_status = 'approved'
  and exists (
    select 1
    from public.canonical_locations location
    where location.id = canonical_location_id
      and location.approval_status = 'approved'
  )
);

comment on table public.canonical_locations is
  'Administrator-approved Google Places. Historical booking values are never promoted automatically.';
comment on table public.canonical_location_aliases is
  'Explicit global or client-specific aliases used by the Booking Maps dry-run matcher.';
comment on table public.canonical_route_cache is
  'One Google recommended driving-route result per approved canonical location pair.';
comment on table public.booking_map_backfill_batches is
  'Resumable Booking Maps dry-run and reviewed backfill batches.';
comment on table public.booking_map_backfill_items is
  'Immutable booking snapshots, proposals, and exceptions. Dry-run rows never update booking_diary.';
comment on table public.booking_map_backfill_changes is
  'Before/after journal reserved for reviewed backfill apply and rollback.';

notify pgrst, 'reload schema';

commit;
