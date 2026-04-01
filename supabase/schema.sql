create extension if not exists "pgcrypto";

create table if not exists public.drivers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  vehicle_reg text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.fuel_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  driver_id uuid not null references public.drivers(id) on delete cascade,
  date date not null,
  vehicle_reg text not null,
  odometer numeric(12, 2),
  litres numeric(12, 2) not null,
  total_cost numeric(12, 2) not null,
  station text not null,
  price_per_litre numeric(12, 2),
  fuel_type text,
  payment_method text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.bank_transfers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  driver_id uuid not null references public.drivers(id) on delete cascade,
  date date not null,
  vehicle_reg text not null,
  amount numeric(12, 2) not null,
  transfer_type text not null,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.weekly_mileage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  driver_id uuid not null references public.drivers(id) on delete cascade,
  week_ending date not null,
  vehicle_reg text not null,
  odometer_reading bigint not null,
  created_at timestamptz not null default now()
);

alter table public.drivers enable row level security;
alter table public.fuel_logs enable row level security;
alter table public.bank_transfers enable row level security;
alter table public.weekly_mileage enable row level security;

drop policy if exists "drivers_select_own" on public.drivers;
create policy "drivers_select_own" on public.drivers
for select using (auth.uid() = user_id);

drop policy if exists "drivers_insert_own" on public.drivers;
create policy "drivers_insert_own" on public.drivers
for insert with check (auth.uid() = user_id);

drop policy if exists "drivers_update_own" on public.drivers;
create policy "drivers_update_own" on public.drivers
for update using (auth.uid() = user_id);

drop policy if exists "drivers_delete_own" on public.drivers;
create policy "drivers_delete_own" on public.drivers
for delete using (auth.uid() = user_id);

drop policy if exists "fuel_logs_select_own" on public.fuel_logs;
create policy "fuel_logs_select_own" on public.fuel_logs
for select using (auth.uid() = user_id);

drop policy if exists "fuel_logs_insert_own" on public.fuel_logs;
create policy "fuel_logs_insert_own" on public.fuel_logs
for insert with check (auth.uid() = user_id);

drop policy if exists "fuel_logs_update_own" on public.fuel_logs;
create policy "fuel_logs_update_own" on public.fuel_logs
for update using (auth.uid() = user_id);

drop policy if exists "fuel_logs_delete_own" on public.fuel_logs;
create policy "fuel_logs_delete_own" on public.fuel_logs
for delete using (auth.uid() = user_id);

drop policy if exists "bank_transfers_select_own" on public.bank_transfers;
create policy "bank_transfers_select_own" on public.bank_transfers
for select using (auth.uid() = user_id);

drop policy if exists "bank_transfers_insert_own" on public.bank_transfers;
create policy "bank_transfers_insert_own" on public.bank_transfers
for insert with check (auth.uid() = user_id);

drop policy if exists "bank_transfers_update_own" on public.bank_transfers;
create policy "bank_transfers_update_own" on public.bank_transfers
for update using (auth.uid() = user_id);

drop policy if exists "bank_transfers_delete_own" on public.bank_transfers;
create policy "bank_transfers_delete_own" on public.bank_transfers
for delete using (auth.uid() = user_id);

drop policy if exists "weekly_mileage_select_own" on public.weekly_mileage;
create policy "weekly_mileage_select_own" on public.weekly_mileage
for select using (auth.uid() = user_id);

drop policy if exists "weekly_mileage_insert_own" on public.weekly_mileage;
create policy "weekly_mileage_insert_own" on public.weekly_mileage
for insert with check (auth.uid() = user_id);

drop policy if exists "weekly_mileage_update_own" on public.weekly_mileage;
create policy "weekly_mileage_update_own" on public.weekly_mileage
for update using (auth.uid() = user_id);

drop policy if exists "weekly_mileage_delete_own" on public.weekly_mileage;
create policy "weekly_mileage_delete_own" on public.weekly_mileage
for delete using (auth.uid() = user_id);

create or replace function public.set_user_id()
returns trigger
language plpgsql
security definer
as $$
begin
  if new.user_id is null then
    new.user_id := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists set_driver_user_id on public.drivers;
create trigger set_driver_user_id
before insert on public.drivers
for each row execute function public.set_user_id();

drop trigger if exists set_fuel_log_user_id on public.fuel_logs;
create trigger set_fuel_log_user_id
before insert on public.fuel_logs
for each row execute function public.set_user_id();

drop trigger if exists set_bank_transfer_user_id on public.bank_transfers;
create trigger set_bank_transfer_user_id
before insert on public.bank_transfers
for each row execute function public.set_user_id();

drop trigger if exists set_weekly_mileage_user_id on public.weekly_mileage;
create trigger set_weekly_mileage_user_id
before insert on public.weekly_mileage
for each row execute function public.set_user_id();

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
  cost_estimation_status text not null default 'pending' check (cost_estimation_status in ('ready', 'pending')),
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

create unique index if not exists shipments_user_id_job_reference_key
  on public.shipments (user_id, lower(job_reference));

create unique index if not exists route_distance_estimates_unique_route
  on public.route_distance_estimates (user_id, origin_key, destination_key, provider);

create index if not exists shipments_shipment_date_idx
  on public.shipments (shipment_date desc);

create index if not exists shipments_driver_id_idx
  on public.shipments (driver_id);

create index if not exists route_distance_estimates_lookup_idx
  on public.route_distance_estimates (origin_key, destination_key, updated_at desc);

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

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

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
