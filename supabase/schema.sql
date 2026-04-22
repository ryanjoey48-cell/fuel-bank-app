create extension if not exists "pgcrypto";

create table if not exists public.drivers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  vehicle_reg text not null,
  vehicle_type text,
  assigned_vehicle_id uuid,
  active boolean not null default true,
  company_id uuid,
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

do $$
begin
  if not exists (select 1 from pg_type where typname = 'vehicle_category_enum') then
    create type public.vehicle_category_enum as enum ('SMALL_VAN', 'LORRY', 'HEAVY_LORRY');
  end if;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'fuel_type_enum') then
    create type public.fuel_type_enum as enum ('DIESEL');
  end if;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'fuel_region_enum') then
    create type public.fuel_region_enum as enum ('BANGKOK');
  end if;
end;
$$;

create table if not exists public.vehicles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  company_id uuid,
  vehicle_reg text not null,
  vehicle_name text not null,
  vehicle_category text,
  vehicle_type text,
  fuel_type text default 'DIESEL',
  standard_km_per_litre numeric(10, 2),
  default_driver_cost numeric(12, 2),
  last_oil_change_odometer numeric(12, 2),
  last_oil_change_date date,
  oil_change_interval_km numeric(12, 2),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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

alter table public.drivers
  drop constraint if exists drivers_assigned_vehicle_id_fkey;

alter table public.drivers
  add constraint drivers_assigned_vehicle_id_fkey
  foreign key (assigned_vehicle_id) references public.vehicles(id) on delete set null;

create table if not exists public.vehicle_category_defaults (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  company_id uuid,
  category_name public.vehicle_category_enum not null,
  default_km_per_litre numeric(10, 2) not null,
  default_driver_cost numeric(12, 2) not null default 0,
  default_margin_percent numeric(7, 2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.fuel_pricing_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  company_id uuid,
  region public.fuel_region_enum not null default 'BANGKOK',
  fuel_type public.fuel_type_enum not null default 'DIESEL',
  price_per_litre numeric(12, 2) not null,
  fuel_price_source text not null,
  effective_date date not null,
  fuel_risk_buffer_percent numeric(7, 2) not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.vehicle_type_standards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  company_id uuid,
  vehicle_type text not null,
  standard_km_per_litre numeric(10, 2) not null,
  standard_fuel_price numeric(12, 2) not null,
  default_driver_cost numeric(12, 2) not null default 0,
  default_margin_percent numeric(7, 2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.drivers enable row level security;
alter table public.vehicles enable row level security;
alter table public.vehicle_service_logs enable row level security;
alter table public.vehicle_category_defaults enable row level security;
alter table public.fuel_pricing_settings enable row level security;
alter table public.fuel_logs enable row level security;
alter table public.bank_transfers enable row level security;
alter table public.weekly_mileage enable row level security;
alter table public.vehicle_type_standards enable row level security;

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

drop policy if exists "vehicles_delete_own" on public.vehicles;
create policy "vehicles_delete_own" on public.vehicles
for delete using (auth.uid() = user_id);

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

drop policy if exists "vehicle_category_defaults_select_own" on public.vehicle_category_defaults;
create policy "vehicle_category_defaults_select_own" on public.vehicle_category_defaults
for select using (auth.uid() = user_id);

drop policy if exists "vehicle_category_defaults_insert_own" on public.vehicle_category_defaults;
create policy "vehicle_category_defaults_insert_own" on public.vehicle_category_defaults
for insert with check (auth.uid() = user_id);

drop policy if exists "vehicle_category_defaults_update_own" on public.vehicle_category_defaults;
create policy "vehicle_category_defaults_update_own" on public.vehicle_category_defaults
for update using (auth.uid() = user_id);

drop policy if exists "fuel_pricing_settings_select_own" on public.fuel_pricing_settings;
create policy "fuel_pricing_settings_select_own" on public.fuel_pricing_settings
for select using (auth.uid() = user_id);

drop policy if exists "fuel_pricing_settings_insert_own" on public.fuel_pricing_settings;
create policy "fuel_pricing_settings_insert_own" on public.fuel_pricing_settings
for insert with check (auth.uid() = user_id);

drop policy if exists "fuel_pricing_settings_update_own" on public.fuel_pricing_settings;
create policy "fuel_pricing_settings_update_own" on public.fuel_pricing_settings
for update using (auth.uid() = user_id);

drop policy if exists "vehicle_type_standards_select_own" on public.vehicle_type_standards;
create policy "vehicle_type_standards_select_own" on public.vehicle_type_standards
for select using (auth.uid() = user_id);

drop policy if exists "vehicle_type_standards_insert_own" on public.vehicle_type_standards;
create policy "vehicle_type_standards_insert_own" on public.vehicle_type_standards
for insert with check (auth.uid() = user_id);

drop policy if exists "vehicle_type_standards_update_own" on public.vehicle_type_standards;
create policy "vehicle_type_standards_update_own" on public.vehicle_type_standards
for update using (auth.uid() = user_id);

drop policy if exists "vehicle_type_standards_delete_own" on public.vehicle_type_standards;
create policy "vehicle_type_standards_delete_own" on public.vehicle_type_standards
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

drop trigger if exists set_vehicle_user_id on public.vehicles;
create trigger set_vehicle_user_id
before insert on public.vehicles
for each row execute function public.set_user_id();

drop trigger if exists set_vehicle_category_default_user_id on public.vehicle_category_defaults;
create trigger set_vehicle_category_default_user_id
before insert on public.vehicle_category_defaults
for each row execute function public.set_user_id();

drop trigger if exists set_fuel_pricing_setting_user_id on public.fuel_pricing_settings;
create trigger set_fuel_pricing_setting_user_id
before insert on public.fuel_pricing_settings
for each row execute function public.set_user_id();

drop trigger if exists set_vehicle_type_standard_user_id on public.vehicle_type_standards;
create trigger set_vehicle_type_standard_user_id
before insert on public.vehicle_type_standards
for each row execute function public.set_user_id();

create table if not exists public.shipments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  company_id uuid,
  job_reference text not null,
  job_date date,
  weight numeric(12, 2),
  weight_unit text,
  pallets integer,
  length numeric(12, 2),
  width numeric(12, 2),
  height numeric(12, 2),
  vehicle_id uuid references public.vehicles(id) on delete set null,
  driver_id uuid references public.drivers(id) on delete set null,
  driver text not null,
  driver_name_snapshot text,
  vehicle_reg text,
  vehicle_reg_snapshot text,
  vehicle_type text,
  vehicle_type_snapshot text,
  suggested_vehicle_type text,
  used_vehicle_override boolean not null default false,
  vehicle_category public.vehicle_category_enum,
  status text not null default 'Draft' check (status in ('Draft', 'Quoted', 'Accepted', 'Assigned')),
  fuel_type public.fuel_type_enum default 'DIESEL',
  shipment_date date not null,
  pickup_location text,
  dropoff_location text,
  include_base_travel boolean not null default false,
  include_operational_travel boolean not null default false,
  base_location text,
  leg_1_distance_km numeric(10, 2),
  leg_2_distance_km numeric(10, 2),
  leg_3_distance_km numeric(10, 2),
  total_distance_km numeric(10, 2),
  total_operational_distance_km numeric(10, 2),
  quote_distance_mode text,
  quoted_distance_km numeric(10, 2),
  start_location text not null,
  end_location text not null,
  estimated_distance_km numeric(10, 2),
  standard_km_per_litre numeric(10, 2),
  estimated_fuel_litres numeric(12, 2),
  diesel_price numeric(12, 2),
  fuel_cost numeric(12, 2),
  toll_cost numeric(12, 2),
  fuel_price_per_litre numeric(12, 2),
  fuel_price_source text,
  fuel_price_effective_date date,
  base_fuel_cost numeric(12, 2),
  fuel_risk_buffer_percent numeric(7, 2),
  quoted_fuel_cost numeric(12, 2),
  standard_fuel_price numeric(12, 2),
  estimated_fuel_cost numeric(12, 2),
  toll_estimate numeric(12, 2) not null default 0,
  other_costs numeric(12, 2) not null default 0,
  driver_cost numeric(12, 2) not null default 0,
  subtotal_cost numeric(12, 2),
  margin_percent numeric(7, 2) not null default 0,
  final_price numeric(12, 2),
  quoted_price numeric(12, 2),
  actual_distance_km numeric(10, 2),
  actual_fuel_litres numeric(12, 2),
  actual_fuel_cost numeric(12, 2),
  actual_tolls numeric(12, 2),
  actual_total_cost numeric(12, 2),
  variance_amount numeric(12, 2),
  variance_percent numeric(7, 2),
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

create index if not exists shipments_vehicle_id_idx
  on public.shipments (vehicle_id);

create index if not exists shipments_vehicle_date_idx
  on public.shipments (vehicle_id, shipment_date desc);

create index if not exists drivers_assigned_vehicle_id_idx
  on public.drivers (assigned_vehicle_id);

create unique index if not exists vehicles_vehicle_reg_null_user_key
  on public.vehicles (lower(vehicle_reg))
  where user_id is null;

create unique index if not exists vehicles_user_vehicle_reg_key
  on public.vehicles (user_id, lower(vehicle_reg))
  where user_id is not null;

create index if not exists vehicle_service_logs_vehicle_reg_lookup_idx
  on public.vehicle_service_logs (user_id, vehicle_reg, service_date desc, created_at desc);

create index if not exists vehicle_service_logs_vehicle_id_idx
  on public.vehicle_service_logs (vehicle_id);

create unique index if not exists vehicle_service_logs_unique_service_idx
  on public.vehicle_service_logs (
    coalesce(vehicle_id, '00000000-0000-0000-0000-000000000000'::uuid),
    lower(vehicle_reg),
    service_type,
    service_date,
    odometer
  );

create unique index if not exists vehicle_category_defaults_user_category_key
  on public.vehicle_category_defaults (user_id, category_name);

create index if not exists fuel_pricing_settings_active_lookup_idx
  on public.fuel_pricing_settings (user_id, region, fuel_type, is_active, effective_date desc);

create unique index if not exists vehicle_type_standards_user_vehicle_type_key
  on public.vehicle_type_standards (user_id, lower(vehicle_type));

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

drop trigger if exists set_vehicles_updated_at on public.vehicles;
create trigger set_vehicles_updated_at
before update on public.vehicles
for each row execute function public.set_updated_at();

drop trigger if exists set_vehicle_category_defaults_updated_at on public.vehicle_category_defaults;
create trigger set_vehicle_category_defaults_updated_at
before update on public.vehicle_category_defaults
for each row execute function public.set_updated_at();

drop trigger if exists set_fuel_pricing_settings_updated_at on public.fuel_pricing_settings;
create trigger set_fuel_pricing_settings_updated_at
before update on public.fuel_pricing_settings
for each row execute function public.set_updated_at();

drop trigger if exists set_vehicle_type_standards_updated_at on public.vehicle_type_standards;
create trigger set_vehicle_type_standards_updated_at
before update on public.vehicle_type_standards
for each row execute function public.set_updated_at();

drop trigger if exists set_route_distance_estimates_updated_at on public.route_distance_estimates;
create trigger set_route_distance_estimates_updated_at
before update on public.route_distance_estimates
for each row execute function public.set_updated_at();
