begin;

-- Alerts only: driver_job_events remains the sole progress source of truth.
-- Portal cookies are not database JWTs. Verified server APIs mediate all access.
do $$
declare booking_type text; driver_type text;
begin
  select format_type(atttypid, atttypmod) into booking_type from pg_attribute
    where attrelid = 'public.booking_diary'::regclass and attname = 'id' and not attisdropped;
  select format_type(atttypid, atttypmod) into driver_type from pg_attribute
    where attrelid = 'public.drivers'::regclass and attname = 'id' and not attisdropped;
  if booking_type is null or driver_type is null then
    raise exception 'Booking and driver ID types are required';
  end if;
  execute format($table$
    create table public.driver_operational_notifications (
      id uuid primary key default gen_random_uuid(),
      recipient_user_id uuid not null references auth.users(id) on delete restrict,
      notification_type text not null check (notification_type = 'pickup_wait_30_minutes'),
      booking_id %s not null references public.booking_diary(id) on delete restrict,
      driver_id %s not null references public.drivers(id) on delete restrict,
      arrival_event_id uuid not null references public.driver_job_events(id) on delete restrict,
      title text not null default 'Driver waiting over 30 minutes',
      created_at timestamptz not null default clock_timestamp(),
      read_at timestamptz,
      resolved_at timestamptz,
      unique (recipient_user_id, notification_type, arrival_event_id),
      check (read_at is null or read_at >= created_at),
      check (resolved_at is null or resolved_at >= created_at)
    )
  $table$, booking_type, driver_type);
end $$;

create index driver_operational_notifications_recipient_idx
  on public.driver_operational_notifications(recipient_user_id, created_at desc, id desc);
create index driver_operational_notifications_unread_idx
  on public.driver_operational_notifications(recipient_user_id)
  where read_at is null;
create index driver_operational_notifications_open_booking_idx
  on public.driver_operational_notifications(booking_id) where resolved_at is null;
create index driver_job_events_pickup_wait_idx
  on public.driver_job_events(event_time, booking_id) where event_type = 'pickup_arrived';
create index driver_job_events_completed_history_idx
  on public.driver_job_events(event_time desc, id desc) where event_type = 'job_completed';

alter table public.driver_operational_notifications enable row level security;
revoke all on public.driver_operational_notifications
  from public, anon, authenticated, driver_portal, service_role;
grant select on public.driver_operational_notifications to service_role;
-- No browser policies, INSERT/DELETE grants or ability to edit status/recipient.

-- Existing universal-approval migration pins this same primary administrator UUID.
-- No browser-supplied recipient, email or elapsed-time argument is accepted.
create function public.evaluate_driver_pickup_wait_notifications()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  primary_admin constant uuid := '6b36f383-28e0-48aa-99a0-c1e655d6c3f7'::uuid;
  candidate record;
  inserted_count integer := 0;
  affected integer;
begin
  if not exists (
    select 1 from public.account_access
    where user_id = primary_admin and role = 'admin' and status = 'active'
  ) or exists (
    select 1 from public.driver_accounts where auth_user_id = primary_admin and active = true
  ) then
    raise sqlstate 'PT503' using message = 'Primary operations administrator is unavailable.';
  end if;

  for candidate in
    select e.id, e.booking_id, e.driver_id
    from public.driver_job_events e
    where e.event_type = 'pickup_arrived'
      and e.event_time <= clock_timestamp() - interval '30 minutes'
      and not exists (
        select 1 from public.driver_job_events departed
        where departed.booking_id = e.booking_id and departed.event_type = 'pickup_departed'
      )
      and not exists (
        select 1 from public.driver_operational_notifications notification
        where notification.recipient_user_id = primary_admin
          and notification.notification_type = 'pickup_wait_30_minutes'
          and notification.arrival_event_id = e.id
      )
    order by e.booking_id
  loop
    -- append_driver_job_event already locks this booking. Take the same lock then
    -- recheck departure to avoid inserting an unresolved alert during a race.
    perform 1 from public.booking_diary where id = candidate.booking_id for update;
    if not exists (
      select 1 from public.driver_job_events departed
      where departed.booking_id = candidate.booking_id and departed.event_type = 'pickup_departed'
    ) then
      insert into public.driver_operational_notifications
        (recipient_user_id, notification_type, booking_id, driver_id, arrival_event_id)
      values (primary_admin, 'pickup_wait_30_minutes', candidate.booking_id,
        candidate.driver_id, candidate.id)
      on conflict (recipient_user_id, notification_type, arrival_event_id) do nothing;
      get diagnostics affected = row_count;
      inserted_count := inserted_count + affected;
    end if;
  end loop;
  return inserted_count;
end;
$$;

-- Resolve in the same transaction as the existing secure event RPC. Do not alter
-- its ownership, sequencing, timestamps or GPS handling. Preserve unread status.
create function public.resolve_driver_pickup_wait_notification()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.driver_operational_notifications
    set resolved_at = greatest(new.event_time, created_at)
    where booking_id = new.booking_id and resolved_at is null;
  return new;
end;
$$;
create trigger driver_pickup_wait_notification_resolve
after insert on public.driver_job_events
for each row when (new.event_type = 'pickup_departed')
execute function public.resolve_driver_pickup_wait_notification();

-- Future API must verify the current active office admin and pass that verified
-- auth.uid, never accept recipient UUIDs from browser bodies. Scope each mutation.
create function public.read_driver_operational_notification(p_recipient_user_id uuid, p_notification_id uuid default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare affected integer;
begin
  if not exists (
    select 1 from public.account_access
    where user_id = p_recipient_user_id and role = 'admin' and status = 'active'
  ) or exists (
    select 1 from public.driver_accounts where auth_user_id = p_recipient_user_id and active = true
  ) then
    raise sqlstate 'PT403' using message = 'Administrator access required.';
  end if;
  update public.driver_operational_notifications
    set read_at = greatest(clock_timestamp(), created_at)
    where recipient_user_id = p_recipient_user_id and read_at is null
      and (p_notification_id is null or id = p_notification_id);
  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke all on function public.evaluate_driver_pickup_wait_notifications()
  from public, anon, authenticated, driver_portal;
revoke all on function public.resolve_driver_pickup_wait_notification()
  from public, anon, authenticated, driver_portal;
revoke all on function public.read_driver_operational_notification(uuid, uuid)
  from public, anon, authenticated, driver_portal;
grant execute on function public.evaluate_driver_pickup_wait_notifications() to service_role;
grant execute on function public.read_driver_operational_notification(uuid, uuid) to service_role;

-- No evaluation/backfill runs during migration. The upcoming server implementation
-- calls the evaluator on periodic admin polling. This does not install pg_cron,
-- browser push, continuous GPS tracking or change existing event records.
notify pgrst, 'reload schema';
commit;
