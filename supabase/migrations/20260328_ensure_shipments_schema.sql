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

create table if not exists public.shipments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  company_id uuid,
  job_reference text not null,
  driver_id uuid references public.drivers(id) on delete set null,
  driver text not null,
  vehicle_reg text,
  shipment_date date not null,
  start_location text not null,
  end_location text not null,
  estimated_distance_km numeric(10, 2),
  estimated_fuel_cost_thb numeric(12, 2),
  cost_per_km_snapshot_thb numeric(12, 4),
  cost_estimation_status text not null default 'pending',
  cost_estimation_note text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.route_distance_estimates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  company_id uuid,
  origin_location text not null,
  destination_location text not null,
  origin_key text not null,
  destination_key text not null,
  distance_km numeric(10, 2) not null,
  distance_meters integer,
  duration_seconds integer,
  provider text not null default 'routes_api',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.shipments
  add column if not exists company_id uuid,
  add column if not exists job_reference text,
  add column if not exists driver_id uuid,
  add column if not exists driver text,
  add column if not exists vehicle_reg text,
  add column if not exists shipment_date date,
  add column if not exists start_location text,
  add column if not exists end_location text,
  add column if not exists estimated_distance_km numeric(10, 2),
  add column if not exists estimated_fuel_cost_thb numeric(12, 2),
  add column if not exists cost_per_km_snapshot_thb numeric(12, 4),
  add column if not exists cost_estimation_status text,
  add column if not exists cost_estimation_note text,
  add column if not exists notes text,
  add column if not exists updated_at timestamptz not null default now();

alter table public.route_distance_estimates
  add column if not exists company_id uuid,
  add column if not exists origin_location text,
  add column if not exists destination_location text,
  add column if not exists origin_key text,
  add column if not exists destination_key text,
  add column if not exists distance_km numeric(10, 2),
  add column if not exists distance_meters integer,
  add column if not exists duration_seconds integer,
  add column if not exists provider text,
  add column if not exists updated_at timestamptz not null default now();

alter table public.shipments
  alter column driver drop not null,
  alter column job_reference set not null,
  alter column shipment_date set not null,
  alter column start_location set not null,
  alter column end_location set not null,
  alter column cost_estimation_status set default 'pending';

update public.shipments
set driver = coalesce(nullif(driver, ''), 'Unassigned')
where driver is null or driver = '';

alter table public.shipments
  alter column driver set not null;

alter table public.route_distance_estimates
  alter column origin_location set not null,
  alter column destination_location set not null,
  alter column origin_key set not null,
  alter column destination_key set not null,
  alter column distance_km set not null,
  alter column provider set default 'routes_api',
  alter column provider set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'shipments_cost_estimation_status_check'
      and conrelid = 'public.shipments'::regclass
  ) then
    alter table public.shipments
      add constraint shipments_cost_estimation_status_check
      check (cost_estimation_status in ('ready', 'pending'));
  end if;
end;
$$;

create unique index if not exists shipments_user_id_job_reference_key
  on public.shipments (user_id, lower(job_reference));

create index if not exists shipments_shipment_date_idx
  on public.shipments (shipment_date desc);

create index if not exists shipments_driver_id_idx
  on public.shipments (driver_id);

create unique index if not exists route_distance_estimates_unique_route
  on public.route_distance_estimates (user_id, origin_key, destination_key, provider);

create index if not exists route_distance_estimates_lookup_idx
  on public.route_distance_estimates (origin_key, destination_key, updated_at desc);

alter table public.shipments
  drop constraint if exists shipments_driver_id_fkey;

alter table public.shipments
  add constraint shipments_driver_id_fkey
  foreign key (driver_id) references public.drivers(id) on delete set null;

alter table public.shipments enable row level security;
alter table public.route_distance_estimates enable row level security;

drop policy if exists "shipments_select_own" on public.shipments;
create policy "shipments_select_own" on public.shipments
for select using (auth.uid() = user_id);

drop policy if exists "shipments_insert_own" on public.shipments;
create policy "shipments_insert_own" on public.shipments
for insert with check (auth.uid() = user_id);

drop policy if exists "shipments_update_own" on public.shipments;
create policy "shipments_update_own" on public.shipments
for update using (auth.uid() = user_id);

drop policy if exists "shipments_delete_own" on public.shipments;
create policy "shipments_delete_own" on public.shipments
for delete using (auth.uid() = user_id);

drop policy if exists "route_distance_estimates_select_own" on public.route_distance_estimates;
create policy "route_distance_estimates_select_own" on public.route_distance_estimates
for select using (auth.uid() = user_id);

drop policy if exists "route_distance_estimates_insert_own" on public.route_distance_estimates;
create policy "route_distance_estimates_insert_own" on public.route_distance_estimates
for insert with check (auth.uid() = user_id);

drop policy if exists "route_distance_estimates_update_own" on public.route_distance_estimates;
create policy "route_distance_estimates_update_own" on public.route_distance_estimates
for update using (auth.uid() = user_id);

drop trigger if exists set_shipment_user_id on public.shipments;
create trigger set_shipment_user_id
before insert on public.shipments
for each row execute function public.set_user_id();

drop trigger if exists set_route_distance_estimate_user_id on public.route_distance_estimates;
create trigger set_route_distance_estimate_user_id
before insert on public.route_distance_estimates
for each row execute function public.set_user_id();

drop trigger if exists set_shipments_updated_at on public.shipments;
create trigger set_shipments_updated_at
before update on public.shipments
for each row execute function public.set_updated_at();

drop trigger if exists set_route_distance_estimates_updated_at on public.route_distance_estimates;
create trigger set_route_distance_estimates_updated_at
before update on public.route_distance_estimates
for each row execute function public.set_updated_at();

notify pgrst, 'reload schema';
