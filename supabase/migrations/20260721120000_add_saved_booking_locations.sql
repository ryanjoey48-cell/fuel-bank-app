alter table if exists public.booking_diary
  add column if not exists pickup_place_id text,
  add column if not exists pickup_address text,
  add column if not exists pickup_lat numeric,
  add column if not exists pickup_lng numeric,
  add column if not exists dropoff_place_id text,
  add column if not exists dropoff_address text,
  add column if not exists dropoff_lat numeric,
  add column if not exists dropoff_lng numeric;

create or replace function public.normalize_saved_location_name(value text)
returns text
language sql
immutable
strict
as $$
  select lower(regexp_replace(btrim(value), '\s+', ' ', 'g'));
$$;

create table if not exists public.saved_locations (
  id uuid primary key default gen_random_uuid(),
  location_type text not null check (location_type in ('pickup', 'dropoff')),
  display_name text not null,
  normalized_name text not null,
  google_place_id text,
  formatted_address text not null,
  latitude numeric,
  longitude numeric,
  use_count bigint not null default 1 check (use_count >= 0),
  last_used_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  constraint saved_locations_normalized_name_unique unique (location_type, normalized_name)
);

alter table public.saved_locations
  drop constraint if exists saved_locations_verified_location_check;

update public.saved_locations
set
  formatted_address = btrim(display_name),
  updated_at = now()
where nullif(btrim(formatted_address), '') is null;

alter table public.saved_locations
  add constraint saved_locations_verified_location_check check (
    nullif(btrim(formatted_address), '') is not null
  );

create index if not exists saved_locations_rank_idx
  on public.saved_locations (location_type, use_count desc, last_used_at desc);

create index if not exists saved_locations_last_used_idx
  on public.saved_locations (last_used_at desc);

alter table public.saved_locations enable row level security;

drop policy if exists "saved_locations_select_authenticated" on public.saved_locations;
create policy "saved_locations_select_authenticated"
on public.saved_locations for select to authenticated
using (true);

revoke insert, update, delete on public.saved_locations from anon, authenticated;
grant select on public.saved_locations to authenticated;

with location_candidates as (
  select
    booking.id as booking_id,
    'pickup'::text as location_type,
    booking.pickup as display_name,
    public.normalize_saved_location_name(booking.pickup) as normalized_name,
    nullif(btrim(booking.pickup_place_id), '') as google_place_id,
    coalesce(nullif(btrim(booking.pickup_address), ''), btrim(booking.pickup)) as formatted_address,
    booking.pickup_lat as latitude,
    booking.pickup_lng as longitude,
    coalesce(booking.updated_at, booking.created_at, now()) as used_at
  from public.booking_diary booking
  where nullif(btrim(booking.pickup), '') is not null
    and (
      nullif(btrim(booking.pickup_address), '') is not null
      or
      nullif(btrim(booking.pickup_place_id), '') is not null
      or (booking.pickup_lat is not null and booking.pickup_lng is not null)
    )
  union all
  select
    booking.id,
    'dropoff'::text,
    booking.dropoff,
    public.normalize_saved_location_name(booking.dropoff),
    nullif(btrim(booking.dropoff_place_id), ''),
    coalesce(nullif(btrim(booking.dropoff_address), ''), btrim(booking.dropoff)),
    booking.dropoff_lat,
    booking.dropoff_lng,
    coalesce(booking.updated_at, booking.created_at, now())
  from public.booking_diary booking
  where nullif(btrim(booking.dropoff), '') is not null
    and (
      nullif(btrim(booking.dropoff_address), '') is not null
      or
      nullif(btrim(booking.dropoff_place_id), '') is not null
      or (booking.dropoff_lat is not null and booking.dropoff_lng is not null)
    )
), ranked_locations as (
  select
    candidate.*,
    count(*) over (
      partition by candidate.location_type, candidate.normalized_name
    ) as usage_count,
    row_number() over (
      partition by candidate.location_type, candidate.normalized_name
      order by candidate.used_at desc, candidate.booking_id desc
    ) as preference_rank
  from location_candidates candidate
)
insert into public.saved_locations (
  location_type,
  display_name,
  normalized_name,
  google_place_id,
  formatted_address,
  latitude,
  longitude,
  use_count,
  last_used_at
)
select
  location_type,
  btrim(display_name),
  normalized_name,
  google_place_id,
  formatted_address,
  latitude,
  longitude,
  usage_count,
  used_at
from ranked_locations
where preference_rank = 1
on conflict (location_type, normalized_name) do update
set
  display_name = case
    when excluded.last_used_at >= public.saved_locations.last_used_at then excluded.display_name
    else public.saved_locations.display_name
  end,
  google_place_id = case
    when excluded.last_used_at >= public.saved_locations.last_used_at then excluded.google_place_id
    else public.saved_locations.google_place_id
  end,
  formatted_address = case
    when excluded.last_used_at >= public.saved_locations.last_used_at then excluded.formatted_address
    else public.saved_locations.formatted_address
  end,
  latitude = case
    when excluded.last_used_at >= public.saved_locations.last_used_at then excluded.latitude
    else public.saved_locations.latitude
  end,
  longitude = case
    when excluded.last_used_at >= public.saved_locations.last_used_at then excluded.longitude
    else public.saved_locations.longitude
  end,
  use_count = greatest(public.saved_locations.use_count, excluded.use_count),
  last_used_at = greatest(public.saved_locations.last_used_at, excluded.last_used_at),
  updated_at = now();

create or replace function public.remember_saved_location(
  target_location_type text,
  target_display_name text,
  target_google_place_id text,
  target_formatted_address text,
  target_latitude numeric,
  target_longitude numeric,
  target_used_at timestamptz default now()
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  normalized_display_name text;
begin
  normalized_display_name := public.normalize_saved_location_name(target_display_name);

  if target_location_type not in ('pickup', 'dropoff')
    or normalized_display_name = ''
    or nullif(btrim(target_formatted_address), '') is null
    or (
      nullif(btrim(target_google_place_id), '') is null
      and (target_latitude is null or target_longitude is null)
    ) then
    return;
  end if;

  insert into public.saved_locations (
    location_type,
    display_name,
    normalized_name,
    google_place_id,
    formatted_address,
    latitude,
    longitude,
    use_count,
    last_used_at,
    created_by
  ) values (
    target_location_type,
    btrim(target_display_name),
    normalized_display_name,
    nullif(btrim(target_google_place_id), ''),
    btrim(target_formatted_address),
    target_latitude,
    target_longitude,
    1,
    coalesce(target_used_at, now()),
    auth.uid()
  )
  on conflict (location_type, normalized_name) do update
  set
    display_name = excluded.display_name,
    google_place_id = excluded.google_place_id,
    formatted_address = excluded.formatted_address,
    latitude = excluded.latitude,
    longitude = excluded.longitude,
    use_count = public.saved_locations.use_count + 1,
    last_used_at = excluded.last_used_at,
    updated_at = now();
end;
$$;

revoke all on function public.remember_saved_location(text, text, text, text, numeric, numeric, timestamptz) from public;

create or replace function public.remember_booking_diary_locations()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    perform public.remember_saved_location(
      'pickup', new.pickup, new.pickup_place_id, new.pickup_address,
      new.pickup_lat, new.pickup_lng, coalesce(new.updated_at, now())
    );
    perform public.remember_saved_location(
      'dropoff', new.dropoff, new.dropoff_place_id, new.dropoff_address,
      new.dropoff_lat, new.dropoff_lng, coalesce(new.updated_at, now())
    );
    return new;
  end if;

  if row(
    new.pickup,
    new.pickup_place_id,
    new.pickup_address,
    new.pickup_lat,
    new.pickup_lng
  ) is distinct from row(
    old.pickup,
    old.pickup_place_id,
    old.pickup_address,
    old.pickup_lat,
    old.pickup_lng
  ) then
    perform public.remember_saved_location(
      'pickup',
      new.pickup,
      new.pickup_place_id,
      new.pickup_address,
      new.pickup_lat,
      new.pickup_lng,
      coalesce(new.updated_at, now())
    );
  end if;

  if row(
    new.dropoff,
    new.dropoff_place_id,
    new.dropoff_address,
    new.dropoff_lat,
    new.dropoff_lng
  ) is distinct from row(
    old.dropoff,
    old.dropoff_place_id,
    old.dropoff_address,
    old.dropoff_lat,
    old.dropoff_lng
  ) then
    perform public.remember_saved_location(
      'dropoff',
      new.dropoff,
      new.dropoff_place_id,
      new.dropoff_address,
      new.dropoff_lat,
      new.dropoff_lng,
      coalesce(new.updated_at, now())
    );
  end if;

  return new;
end;
$$;

drop trigger if exists remember_booking_diary_locations on public.booking_diary;
create trigger remember_booking_diary_locations
after insert or update of
  pickup,
  pickup_place_id,
  pickup_address,
  pickup_lat,
  pickup_lng,
  dropoff,
  dropoff_place_id,
  dropoff_address,
  dropoff_lat,
  dropoff_lng
on public.booking_diary
for each row execute function public.remember_booking_diary_locations();

alter table if exists public.trip_journeys
  add column if not exists pickup_display_name text,
  add column if not exists dropoff_display_name text,
  add column if not exists pickup_place_id text,
  add column if not exists dropoff_place_id text,
  add column if not exists pickup_lat numeric,
  add column if not exists pickup_lng numeric,
  add column if not exists dropoff_lat numeric,
  add column if not exists dropoff_lng numeric;

comment on table public.saved_locations is
  'Reusable verified Google Maps locations keyed by normalized Booking Diary pickup/drop-off names.';
comment on column public.saved_locations.display_name is
  'Short staff-facing alias used in Booking Diary.';
comment on column public.saved_locations.formatted_address is
  'Verified Google Maps address used for routing.';

notify pgrst, 'reload schema';
