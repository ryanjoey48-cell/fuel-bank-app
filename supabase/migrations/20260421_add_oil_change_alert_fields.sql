begin;

create extension if not exists "pgcrypto";

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

do $$
declare
  auth_users_id_type text := 'uuid';
  drivers_id_type text := 'uuid';
  weekly_mileage_odometer_type text := 'numeric(12, 2)';
begin
  select format_type(a.atttypid, a.atttypmod)
    into auth_users_id_type
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'auth'
    and c.relname = 'users'
    and a.attname = 'id'
    and not a.attisdropped;

  select format_type(a.atttypid, a.atttypmod)
    into drivers_id_type
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'drivers'
    and a.attname = 'id'
    and not a.attisdropped;

  select format_type(a.atttypid, a.atttypmod)
    into weekly_mileage_odometer_type
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'weekly_mileage'
    and a.attname = 'odometer_reading'
    and not a.attisdropped;

  auth_users_id_type := coalesce(auth_users_id_type, 'uuid');
  drivers_id_type := coalesce(drivers_id_type, 'uuid');
  weekly_mileage_odometer_type := coalesce(weekly_mileage_odometer_type, 'numeric(12, 2)');

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'drivers'
      and column_name = 'user_id'
  ) then
    execute format('alter table public.drivers add column user_id %s', auth_users_id_type);
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'drivers'
      and column_name = 'active'
  ) then
    alter table public.drivers add column active boolean not null default true;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'drivers'
      and column_name = 'assigned_vehicle_id'
  ) then
    alter table public.drivers add column assigned_vehicle_id uuid;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'weekly_mileage'
      and column_name = 'user_id'
  ) then
    execute format('alter table public.weekly_mileage add column user_id %s', auth_users_id_type);
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'weekly_mileage'
      and column_name = 'driver_id'
  ) then
    execute format('alter table public.weekly_mileage add column driver_id %s', drivers_id_type);
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'weekly_mileage'
      and column_name = 'odometer_reading'
  ) then
    execute format('alter table public.weekly_mileage add column odometer_reading %s', weekly_mileage_odometer_type);
  end if;
end
$$;

create table if not exists public.vehicles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  vehicle_reg text not null,
  vehicle_type text,
  vehicle_name text,
  last_oil_change_odometer numeric(12, 2),
  last_oil_change_date date,
  oil_change_interval_km numeric(12, 2),
  active boolean not null default true,
  company_id uuid,
  vehicle_category text,
  fuel_type text default 'DIESEL',
  standard_km_per_litre numeric(10, 2),
  default_driver_cost numeric(12, 2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.vehicles
  add column if not exists user_id uuid references auth.users(id) on delete cascade,
  add column if not exists vehicle_reg text,
  add column if not exists vehicle_type text,
  add column if not exists vehicle_name text,
  add column if not exists last_oil_change_odometer numeric(12, 2),
  add column if not exists last_oil_change_date date,
  add column if not exists oil_change_interval_km numeric(12, 2),
  add column if not exists active boolean not null default true,
  add column if not exists company_id uuid,
  add column if not exists vehicle_category text,
  add column if not exists fuel_type text default 'DIESEL',
  add column if not exists standard_km_per_litre numeric(10, 2),
  add column if not exists default_driver_cost numeric(12, 2),
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'vehicles'
      and column_name = 'registration'
  ) then
    execute 'update public.vehicles set vehicle_reg = registration where vehicle_reg is null and registration is not null';
  end if;
end
$$;

update public.vehicles
set vehicle_reg = btrim(vehicle_reg)
where vehicle_reg is not null;

update public.vehicles
set vehicle_name = coalesce(nullif(btrim(vehicle_name), ''), vehicle_reg)
where vehicle_name is null
   or btrim(vehicle_name) = '';

alter table public.vehicles
  alter column vehicle_reg set not null,
  alter column vehicle_name set not null;

create table if not exists public.vehicle_service_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  vehicle_id uuid references public.vehicles(id) on delete set null,
  vehicle_reg text not null,
  service_type text not null default 'oil_change',
  service_date date not null,
  odometer numeric(12, 2) not null,
  interval_km numeric(12, 2),
  vehicle_type_snapshot text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.vehicle_service_logs
  add column if not exists user_id uuid references auth.users(id) on delete cascade,
  add column if not exists vehicle_id uuid references public.vehicles(id) on delete set null,
  add column if not exists vehicle_reg text,
  add column if not exists service_type text not null default 'oil_change',
  add column if not exists service_date date,
  add column if not exists odometer numeric(12, 2),
  add column if not exists interval_km numeric(12, 2),
  add column if not exists vehicle_type_snapshot text,
  add column if not exists notes text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'vehicle_service_logs'
      and column_name = 'service_odometer'
  ) then
    execute 'update public.vehicle_service_logs set odometer = service_odometer where odometer is null and service_odometer is not null';
  end if;
end
$$;

update public.vehicle_service_logs
set vehicle_reg = v.vehicle_reg
from public.vehicles v
where public.vehicle_service_logs.vehicle_reg is null
  and public.vehicle_service_logs.vehicle_id = v.id;

alter table public.vehicle_service_logs
  alter column vehicle_reg set not null,
  alter column service_date set not null,
  alter column odometer set not null;

update public.vehicles v
set vehicle_type = d.vehicle_type
from public.drivers d
where (v.vehicle_type is null or btrim(v.vehicle_type) = '')
  and d.vehicle_type is not null
  and lower(btrim(v.vehicle_reg)) = lower(btrim(d.vehicle_reg));

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'weekly_mileage'
      and column_name = 'mileage'
  ) then
    execute 'update public.weekly_mileage set odometer_reading = mileage where odometer_reading is null and mileage is not null';
  end if;
end
$$;

do $$
begin
  if exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'weekly_mileage'
        and column_name = 'driver'
    ) then
    execute '
      update public.weekly_mileage wm
      set driver_id = d.id
      from public.drivers d
      where wm.driver_id is null
        and (
          lower(btrim(wm.driver)) = lower(btrim(d.name))
          or lower(btrim(wm.vehicle_reg)) = lower(btrim(d.vehicle_reg))
        )';
  else
    update public.weekly_mileage wm
    set driver_id = d.id
    from public.drivers d
    where wm.driver_id is null
      and lower(btrim(wm.vehicle_reg)) = lower(btrim(d.vehicle_reg));
  end if;
end
$$;

update public.weekly_mileage wm
set user_id = d.user_id
from public.drivers d
where wm.user_id is null
  and wm.driver_id = d.id
  and d.user_id is not null;

alter table public.weekly_mileage
  drop constraint if exists weekly_mileage_driver_id_fkey;

alter table public.weekly_mileage
  add constraint weekly_mileage_driver_id_fkey
  foreign key (driver_id) references public.drivers(id) on delete set null;

alter table public.drivers
  drop constraint if exists drivers_assigned_vehicle_id_fkey;

alter table public.drivers
  add constraint drivers_assigned_vehicle_id_fkey
  foreign key (assigned_vehicle_id) references public.vehicles(id) on delete set null;

create index if not exists drivers_user_id_idx
  on public.drivers (user_id);

create index if not exists drivers_vehicle_reg_idx
  on public.drivers (lower(vehicle_reg));

create index if not exists weekly_mileage_user_id_idx
  on public.weekly_mileage (user_id);

create index if not exists weekly_mileage_vehicle_reg_week_idx
  on public.weekly_mileage (lower(vehicle_reg), week_ending desc);

create index if not exists vehicles_vehicle_reg_idx
  on public.vehicles (lower(vehicle_reg));

create unique index if not exists vehicles_vehicle_reg_null_user_key
  on public.vehicles (lower(vehicle_reg))
  where user_id is null;

create unique index if not exists vehicles_user_vehicle_reg_key
  on public.vehicles (user_id, lower(vehicle_reg))
  where user_id is not null;

create index if not exists vehicles_oil_change_status_idx
  on public.vehicles (user_id, last_oil_change_date, last_oil_change_odometer);

create index if not exists vehicle_service_logs_vehicle_lookup_idx
  on public.vehicle_service_logs (vehicle_id, service_type, service_date desc, created_at desc);

create index if not exists vehicle_service_logs_vehicle_reg_lookup_idx
  on public.vehicle_service_logs (lower(vehicle_reg), service_type, service_date desc, created_at desc);

create unique index if not exists vehicle_service_logs_unique_service_idx
  on public.vehicle_service_logs (
    coalesce(vehicle_id, '00000000-0000-0000-0000-000000000000'::uuid),
    lower(vehicle_reg),
    service_type,
    service_date,
    odometer
  );

drop trigger if exists set_vehicles_updated_at on public.vehicles;
create trigger set_vehicles_updated_at
before update on public.vehicles
for each row execute function public.set_updated_at();

drop trigger if exists set_vehicle_service_logs_updated_at on public.vehicle_service_logs;
create trigger set_vehicle_service_logs_updated_at
before update on public.vehicle_service_logs
for each row execute function public.set_updated_at();

alter table public.vehicles enable row level security;
alter table public.vehicle_service_logs enable row level security;

drop policy if exists "vehicles_select_own" on public.vehicles;
create policy "vehicles_select_own" on public.vehicles
for select using (user_id is null or auth.uid() = user_id);

drop policy if exists "vehicles_insert_own" on public.vehicles;
create policy "vehicles_insert_own" on public.vehicles
for insert with check (user_id is null or auth.uid() = user_id);

drop policy if exists "vehicles_update_own" on public.vehicles;
create policy "vehicles_update_own" on public.vehicles
for update using (user_id is null or auth.uid() = user_id)
with check (user_id is null or auth.uid() = user_id);

drop policy if exists "vehicle_service_logs_select_own" on public.vehicle_service_logs;
create policy "vehicle_service_logs_select_own" on public.vehicle_service_logs
for select using (user_id is null or auth.uid() = user_id);

drop policy if exists "vehicle_service_logs_insert_own" on public.vehicle_service_logs;
create policy "vehicle_service_logs_insert_own" on public.vehicle_service_logs
for insert with check (user_id is null or auth.uid() = user_id);

drop policy if exists "vehicle_service_logs_update_own" on public.vehicle_service_logs;
create policy "vehicle_service_logs_update_own" on public.vehicle_service_logs
for update using (user_id is null or auth.uid() = user_id)
with check (user_id is null or auth.uid() = user_id);

commit;
