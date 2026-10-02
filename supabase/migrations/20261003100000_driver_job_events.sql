begin;

-- Match the deployed ID types instead of assuming drivers.id is UUID/integer.
do $$
declare driver_type text; booking_type text;
begin
  select format_type(atttypid, atttypmod) into driver_type from pg_attribute
    where attrelid = 'public.drivers'::regclass and attname = 'id' and not attisdropped;
  select format_type(atttypid, atttypmod) into booking_type from pg_attribute
    where attrelid = 'public.booking_diary'::regclass and attname = 'id' and not attisdropped;
  if driver_type is null or booking_type is null then raise exception 'Driver and booking ID types are required'; end if;
  execute format($table$
    create table public.driver_job_events (
      id uuid primary key default gen_random_uuid(),
      booking_id %s not null references public.booking_diary(id) on delete restrict,
      driver_id %s not null references public.drivers(id) on delete restrict,
      auth_user_id uuid not null references auth.users(id) on delete restrict,
      event_type text not null check (event_type in ('pickup_arrived','pickup_departed','delivery_arrived','job_completed')),
      event_time timestamptz not null default clock_timestamp(),
      latitude double precision,
      longitude double precision,
      notes text,
      created_at timestamptz not null default clock_timestamp(),
      unique (booking_id, event_type),
      check ((latitude is null and longitude is null) or
        (latitude is not null and longitude is not null and latitude between -90 and 90 and longitude between -180 and 180))
    )
  $table$, booking_type, driver_type);
end $$;

create index driver_job_events_driver_idx on public.driver_job_events(driver_id, booking_id, event_time);
alter table public.driver_job_events enable row level security;
-- Portal cookies are not database JWTs. Only the verified server API can write/read for drivers.
revoke all on public.driver_job_events from public, anon, authenticated, driver_portal, service_role;
grant select on public.driver_job_events to authenticated, service_role;
create policy driver_job_events_office_read on public.driver_job_events
  for select to authenticated using (public.is_office_account());

create function public.append_driver_job_event(
  p_session_id uuid, p_booking_id uuid, p_event_type text,
  p_latitude double precision default null, p_longitude double precision default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  identity record;
  assigned_driver text;
  existing_count integer;
  expected_event text;
  sequence text[] := array['pickup_arrived','pickup_departed','delivery_arrived','job_completed'];
  inserted public.driver_job_events%rowtype;
begin
  select a.driver_id, a.auth_user_id into identity
    from public.driver_sessions s
    join public.driver_accounts a on a.id = s.driver_account_id
    join public.drivers d on d.id = a.driver_id
    where s.id = p_session_id and s.revoked_at is null and s.expires_at > clock_timestamp()
      and a.active = true and d.active = true
    for share of s, a, d;
  if not found then raise sqlstate 'PT401' using message = 'Driver session expired. Sign in again.'; end if;
  -- Serializes simultaneous submissions and reassignment with this booking.
  select b.driver_id::text into assigned_driver from public.booking_diary b
    where b.id = p_booking_id for update;
  if not found or assigned_driver is distinct from identity.driver_id::text then
    raise sqlstate 'PT404' using message = 'Job not found.';
  end if;
  if p_event_type is null or not (p_event_type = any(sequence)) then
    raise sqlstate 'PT400' using message = 'Invalid progress event.';
  end if;
  if (p_latitude is null) <> (p_longitude is null) or
    (p_latitude is not null and not (p_latitude between -90 and 90 and p_longitude between -180 and 180)) then
    raise sqlstate 'PT400' using message = 'Invalid location.';
  end if;
  select count(*) into existing_count from public.driver_job_events where booking_id = p_booking_id;
  expected_event := sequence[existing_count + 1];
  if expected_event is null or p_event_type <> expected_event then
    raise sqlstate 'PT409' using message = 'Progress already changed. Refresh this job.';
  end if;
  insert into public.driver_job_events(booking_id, driver_id, auth_user_id, event_type, latitude, longitude)
    values (p_booking_id, identity.driver_id, identity.auth_user_id, p_event_type, p_latitude, p_longitude)
    returning * into inserted;
  return jsonb_build_object('id', inserted.id, 'event_type', inserted.event_type,
    'event_time', inserted.event_time, 'latitude', inserted.latitude, 'longitude', inserted.longitude);
end $$;

revoke all on function public.append_driver_job_event(uuid, uuid, text, double precision, double precision)
  from public, anon, authenticated, driver_portal;
grant execute on function public.append_driver_job_event(uuid, uuid, text, double precision, double precision) to service_role;

notify pgrst, 'reload schema';
commit;
