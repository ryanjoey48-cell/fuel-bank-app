-- REVIEW ONLY — NOT AN ACTIVE MIGRATION.
-- Do not execute in Supabase or move into supabase/migrations without approval.
--
-- Additive storage for staff-confirmed coordinates and append-only change
-- history. This does not update ees_locations or any other existing table.
-- The API writes only after explicit user confirmation and records the verified
-- EES caller in confirmed_by and updated_by.

begin;

do $preflight$
declare
  locations_rls boolean;
begin
  if to_regclass('public.ees_locations') is null then
    raise exception 'Expected public.ees_locations to exist; no map-pin changes were applied.';
  end if;
  if to_regprocedure('public.is_office_account()') is null
     or to_regprocedure('public.is_account_active()') is null
     or to_regprocedure('public.current_account_role()') is null then
    raise exception 'Expected EES office-account, active-account and role functions; no map-pin changes were applied.';
  end if;

  select relations.relrowsecurity into locations_rls
  from pg_class relations
  join pg_namespace namespaces on namespaces.oid = relations.relnamespace
  where namespaces.nspname = 'public' and relations.relname = 'ees_locations';
  if coalesce(locations_rls, false) is false then
    raise exception 'RLS must be enabled on public.ees_locations before coordinate storage is added.';
  end if;
end;
$preflight$;

create table if not exists public.ees_location_map_pins (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.ees_locations(id) on delete cascade,
  pin_type text not null check (pin_type in ('destination', 'truck_entrance')),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  pin_status text not null default 'manual_confirmed' check (pin_status = 'manual_confirmed'),
  coordinate_source text not null check (length(btrim(coordinate_source)) between 1 and 500),
  source_reference text check (source_reference is null or length(source_reference) <= 2048),
  confirmed_by uuid not null,
  confirmed_at timestamptz not null,
  updated_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ees_location_map_pins_location_type_key unique (location_id, pin_type)
);

create index if not exists ees_location_map_pins_location_idx
  on public.ees_location_map_pins (location_id, pin_type);
create index if not exists ees_location_map_pins_updated_idx
  on public.ees_location_map_pins (updated_at desc);

create table if not exists public.ees_location_map_pin_history (
  id uuid primary key default gen_random_uuid(),
  pin_id uuid not null,
  location_id uuid not null,
  pin_type text not null check (pin_type in ('destination', 'truck_entrance')),
  action text not null check (action in ('insert', 'update')),
  old_latitude double precision,
  old_longitude double precision,
  old_pin_status text,
  old_coordinate_source text,
  old_source_reference text,
  new_latitude double precision not null,
  new_longitude double precision not null,
  new_pin_status text not null,
  new_coordinate_source text not null,
  new_source_reference text,
  changed_by uuid not null,
  changed_at timestamptz not null default now()
);

create index if not exists ees_location_map_pin_history_location_idx
  on public.ees_location_map_pin_history (location_id, changed_at desc);

alter table public.ees_location_map_pins enable row level security;
alter table public.ees_location_map_pin_history enable row level security;

do $policy_guard$
begin
  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename in ('ees_location_map_pins', 'ees_location_map_pin_history')
      and policyname not in (
        'ees_location_map_pins_office_read',
        'ees_location_map_pins_office_insert',
        'ees_location_map_pins_office_update',
        'ees_location_map_pin_history_office_read'
      )
  ) then
    raise exception 'Unexpected map-pin RLS policy found; review policy interactions before applying this change.';
  end if;
end;
$policy_guard$;

drop policy if exists ees_location_map_pins_office_read on public.ees_location_map_pins;
create policy ees_location_map_pins_office_read on public.ees_location_map_pins
  for select to authenticated
  using (
    public.is_office_account()
    and public.is_account_active()
    and public.current_account_role() in ('admin', 'office_staff', 'read_only')
  );

drop policy if exists ees_location_map_pins_office_insert on public.ees_location_map_pins;
create policy ees_location_map_pins_office_insert on public.ees_location_map_pins
  for insert to authenticated
  with check (
    public.is_office_account()
    and public.is_account_active()
    and public.current_account_role() in ('admin', 'office_staff')
    and confirmed_by = auth.uid()
    and updated_by = auth.uid()
  );

drop policy if exists ees_location_map_pins_office_update on public.ees_location_map_pins;
create policy ees_location_map_pins_office_update on public.ees_location_map_pins
  for update to authenticated
  using (
    public.is_office_account()
    and public.is_account_active()
    and public.current_account_role() in ('admin', 'office_staff')
  )
  with check (
    public.is_office_account()
    and public.is_account_active()
    and public.current_account_role() in ('admin', 'office_staff')
    and confirmed_by = auth.uid()
    and updated_by = auth.uid()
  );

drop policy if exists ees_location_map_pin_history_office_read on public.ees_location_map_pin_history;
create policy ees_location_map_pin_history_office_read on public.ees_location_map_pin_history
  for select to authenticated
  using (
    public.is_office_account()
    and public.is_account_active()
    and public.current_account_role() in ('admin', 'office_staff', 'read_only')
  );

create or replace function public.set_ees_location_map_pin_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.audit_ees_location_map_pin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.ees_location_map_pin_history (
      pin_id, location_id, pin_type, action, new_latitude, new_longitude,
      new_pin_status, new_coordinate_source, new_source_reference, changed_by
    ) values (
      new.id, new.location_id, new.pin_type, 'insert', new.latitude, new.longitude,
      new.pin_status, new.coordinate_source, new.source_reference, new.updated_by
    );
    return new;
  end if;

  if row(old.location_id, old.pin_type, old.latitude, old.longitude, old.pin_status, old.coordinate_source, old.source_reference, old.confirmed_by, old.confirmed_at)
     is distinct from
     row(new.location_id, new.pin_type, new.latitude, new.longitude, new.pin_status, new.coordinate_source, new.source_reference, new.confirmed_by, new.confirmed_at) then
    insert into public.ees_location_map_pin_history (
      pin_id, location_id, pin_type, action,
      old_latitude, old_longitude, old_pin_status, old_coordinate_source, old_source_reference,
      new_latitude, new_longitude, new_pin_status, new_coordinate_source, new_source_reference, changed_by
    ) values (
      new.id, new.location_id, new.pin_type, 'update',
      old.latitude, old.longitude, old.pin_status, old.coordinate_source, old.source_reference,
      new.latitude, new.longitude, new.pin_status, new.coordinate_source, new.source_reference, new.updated_by
    );
  end if;
  return new;
end;
$$;

drop trigger if exists ees_location_map_pin_updated_at on public.ees_location_map_pins;
create trigger ees_location_map_pin_updated_at
  before update on public.ees_location_map_pins
  for each row execute function public.set_ees_location_map_pin_updated_at();

drop trigger if exists ees_location_map_pin_audit on public.ees_location_map_pins;
create trigger ees_location_map_pin_audit
  after insert or update on public.ees_location_map_pins
  for each row execute function public.audit_ees_location_map_pin();

revoke all on public.ees_location_map_pins from anon, authenticated;
revoke all on public.ees_location_map_pin_history from anon, authenticated;
grant select, insert, update on public.ees_location_map_pins to authenticated;
grant select on public.ees_location_map_pin_history to authenticated;

commit;

-- The API additionally requires a verified EES session and the application's
-- business:read/business:write permission. This service-role API authorization
-- mirrors /api/locations; the policies above protect direct authenticated SQL.
-- Public OpenStreetMap tiles are best-effort and have no service-level SLA.
-- This migration stores only manually confirmed coordinates; do not bulk scrape
-- Google Maps or persist third-party geocoding results without applicable rights.
