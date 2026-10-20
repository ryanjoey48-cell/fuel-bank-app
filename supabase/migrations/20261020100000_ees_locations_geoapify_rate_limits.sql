-- EES Locations: private, database-backed Geoapify request limits.
-- Additive only: does not read or modify destination, pin, history, or activity rows.
-- Apply to the intended Supabase environment before enabling the geocoding API.

begin;

do $preflight$
declare
  v_executor oid := (select oid from pg_catalog.pg_roles where rolname = current_user);
  v_table oid := pg_catalog.to_regclass('public.ees_location_geocode_rate_buckets');
  v_function oid := pg_catalog.to_regprocedure('public.ees_locations_reserve_geocode_lookup(uuid)');
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'service_role')
     or not exists (select 1 from pg_catalog.pg_roles where rolname = 'authenticated')
     or not exists (select 1 from pg_catalog.pg_roles where rolname = 'anon') then
    raise exception 'Expected Supabase service_role, authenticated and anon roles; no geocoding limiter objects were changed.';
  end if;
  if not pg_catalog.has_schema_privilege(current_user, 'public', 'CREATE') then
    raise exception 'The migration executor needs CREATE on schema public; no geocoding limiter objects were changed.';
  end if;
  if not pg_catalog.has_schema_privilege('service_role', 'public', 'USAGE') then
    raise exception 'Supabase service_role needs USAGE on public to call the server-only reservation RPC.';
  end if;
  if v_table is not null then
    if pg_catalog.obj_description(v_table, 'pg_class') is distinct from 'EES Locations private Geoapify request limiter v1.' then
      raise exception 'The reserved geocoding rate-bucket table exists without its expected marker; review it manually.';
    end if;
    if (select relowner from pg_catalog.pg_class where oid = v_table) <> v_executor then
      raise exception 'The existing geocoding rate-bucket table must be owned by the migration executor for a safe repeat install.';
    end if;
  end if;
  if v_function is not null then
    if pg_catalog.obj_description(v_function, 'pg_proc') is distinct from 'EES Locations atomic Geoapify Free-plan quota reservation v1.' then
      raise exception 'The reserved geocoding reservation function exists without its expected marker; review it manually.';
    end if;
    if (select proowner from pg_catalog.pg_proc where oid = v_function) <> v_executor then
      raise exception 'The existing geocoding reservation function must be owned by the migration executor for a safe repeat install.';
    end if;
  end if;
end;
$preflight$;

create table if not exists public.ees_location_geocode_rate_buckets (
  bucket_type text not null check (bucket_type in ('daily', 'per_second', 'per_minute')),
  bucket_key text not null,
  bucket_start timestamptz not null,
  request_count integer not null check (request_count between 1 and 2500),
  updated_at timestamptz not null default pg_catalog.now(),
  primary key (bucket_type, bucket_key, bucket_start)
);

comment on table public.ees_location_geocode_rate_buckets
  is 'EES Locations private Geoapify request limiter v1.';
alter table public.ees_location_geocode_rate_buckets enable row level security;
revoke all on table public.ees_location_geocode_rate_buckets from public, anon, authenticated, service_role;

create or replace function public.ees_locations_reserve_geocode_lookup(p_actor_user_id uuid)
returns table (allowed boolean, reason text, daily_remaining integer)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_day timestamptz;
  v_rate_slot timestamptz;
  v_minute timestamptz;
  v_count integer;
  v_daily_count integer;
  v_reason text;
begin
  if p_actor_user_id is null then
    return query select false, 'invalid_actor'::text, 0;
    return;
  end if;

  v_day := pg_catalog.date_trunc('day', v_now at time zone 'UTC') at time zone 'UTC';
  -- One request per 400ms fixed slot guarantees at most four requests in any
  -- rolling one-second interval, including across slot boundaries.
  v_rate_slot := pg_catalog.date_bin(interval '400 milliseconds', v_now, timestamptz '2000-01-01 00:00:00+00');
  v_minute := pg_catalog.date_trunc('minute', v_now at time zone 'UTC') at time zone 'UTC';

  begin
    -- Keep this small private table bounded while retaining 31 days of daily counts.
    delete from public.ees_location_geocode_rate_buckets
    where (bucket_type = 'daily' and bucket_start < v_day - interval '31 days')
       or (bucket_type <> 'daily' and bucket_start < v_now - interval '2 days');

    -- An authenticated employee may perform at most 6 lookups in any UTC minute.
    insert into public.ees_location_geocode_rate_buckets as current_bucket
      (bucket_type, bucket_key, bucket_start, request_count, updated_at)
    values ('per_minute', p_actor_user_id::text, v_minute, 1, v_now)
    on conflict (bucket_type, bucket_key, bucket_start) do update
      set request_count = current_bucket.request_count + 1, updated_at = excluded.updated_at
      where current_bucket.request_count < 6
    returning request_count into v_count;
    if not found then
      raise exception using errcode = 'P0001', message = 'user_rate_limit';
    end if;

    -- Keep aggregate traffic below Geoapify Free's published 5 requests/second.
    insert into public.ees_location_geocode_rate_buckets as current_bucket
      (bucket_type, bucket_key, bucket_start, request_count, updated_at)
    values ('per_second', 'global', v_rate_slot, 1, v_now)
    on conflict (bucket_type, bucket_key, bucket_start) do update
      set request_count = current_bucket.request_count + 1, updated_at = excluded.updated_at
      where current_bucket.request_count < 1
    returning request_count into v_count;
    if not found then
      raise exception using errcode = 'P0001', message = 'server_rate_limit';
    end if;

    -- Hard application ceiling: 2,500/day, leaving 500 requests of margin under Free's 3,000/day.
    insert into public.ees_location_geocode_rate_buckets as current_bucket
      (bucket_type, bucket_key, bucket_start, request_count, updated_at)
    values ('daily', 'global', v_day, 1, v_now)
    on conflict (bucket_type, bucket_key, bucket_start) do update
      set request_count = current_bucket.request_count + 1, updated_at = excluded.updated_at
      where current_bucket.request_count < 2500
    returning request_count into v_daily_count;
    if not found then
      raise exception using errcode = 'P0001', message = 'daily_limit';
    end if;
  exception when sqlstate 'P0001' then
    v_reason := sqlerrm;
    -- The exception subtransaction rolls back all partial bucket increments.
    return query select false, v_reason, null::integer;
    return;
  end;

  return query select true, null::text, 2500 - v_daily_count;
end;
$function$;

comment on function public.ees_locations_reserve_geocode_lookup(uuid)
  is 'EES Locations atomic Geoapify Free-plan quota reservation v1.';
revoke all on function public.ees_locations_reserve_geocode_lookup(uuid) from public, anon, authenticated, service_role;
grant execute on function public.ees_locations_reserve_geocode_lookup(uuid) to service_role;

commit;
