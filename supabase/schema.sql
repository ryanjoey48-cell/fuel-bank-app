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
  driver_id uuid references public.drivers(id) on delete set null,
  date date not null,
  vehicle_reg text not null,
  odometer numeric(12, 2),
  litres numeric(12, 2) not null,
  total_cost numeric(12, 2) not null,
  station text not null,
  price_per_litre numeric(12, 2),
  fuel_type text,
  payment_method text,
  entry_source text not null default 'line_message' check (entry_source in ('line_message', 'direct_from_receipt', 'statement_manual', 'statement_import', 'other')),
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
  oil_change_odometer numeric(12, 2),
  interval_km numeric(12, 2),
  next_service_due_odometer numeric(12, 2),
  vehicle_type_snapshot text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.oil_change_baselines (
  id uuid primary key default gen_random_uuid(),
  vehicle_reg text not null,
  last_oil_change_date date not null,
  last_odometer numeric not null,
  interval_km numeric not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.oil_change_history (
  id uuid primary key default gen_random_uuid(),
  vehicle_reg text not null,
  oil_change_date date not null,
  odometer numeric not null,
  created_at timestamptz not null default now()
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
alter table public.oil_change_baselines enable row level security;
alter table public.oil_change_history enable row level security;
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

drop policy if exists "Allow authenticated read oil baselines" on public.oil_change_baselines;
create policy "Allow authenticated read oil baselines" on public.oil_change_baselines
for select to authenticated using (true);

drop policy if exists "Allow authenticated write oil baselines" on public.oil_change_baselines;
create policy "Allow authenticated write oil baselines" on public.oil_change_baselines
for all to authenticated using (true) with check (true);

drop policy if exists "Allow authenticated read oil history" on public.oil_change_history;
create policy "Allow authenticated read oil history" on public.oil_change_history
for select to authenticated using (true);

drop policy if exists "Allow authenticated write oil history" on public.oil_change_history;
create policy "Allow authenticated write oil history" on public.oil_change_history
for all to authenticated using (true) with check (true);

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

create unique index if not exists oil_change_baselines_vehicle_reg_unique_idx
  on public.oil_change_baselines (vehicle_reg);

create index if not exists oil_change_history_vehicle_reg_date_idx
  on public.oil_change_history (lower(btrim(vehicle_reg)), oil_change_date desc, created_at desc);

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

create or replace function public.normalize_client_name(value text)
returns text language sql immutable strict as $$
  select lower(regexp_replace(btrim(value), '\s+', ' ', 'g'));
$$;

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  normalized_name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  constraint clients_name_not_blank check (length(btrim(name)) > 0),
  constraint clients_normalized_name_not_blank check (length(btrim(normalized_name)) > 0)
);

create unique index if not exists clients_normalized_name_key on public.clients (normalized_name);
create index if not exists clients_active_name_idx on public.clients (active, name);

create or replace function public.set_client_normalized_name()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE'
    and old.normalized_name = public.normalize_client_name('Internal / Other')
    and (
      public.normalize_client_name(new.name) <> old.normalized_name
      or new.active is not true
    )
  then
    raise exception 'Internal / Other cannot be renamed or deactivated.' using errcode = '23514';
  end if;
  new.name := regexp_replace(btrim(new.name), '\s+', ' ', 'g');
  new.normalized_name := public.normalize_client_name(new.name);
  new.updated_at := now();
  if tg_op = 'INSERT' and new.created_by is null then new.created_by := auth.uid(); end if;
  return new;
end;
$$;

drop trigger if exists set_client_normalized_name on public.clients;
create trigger set_client_normalized_name before insert or update on public.clients
for each row execute function public.set_client_normalized_name();

alter table public.clients enable row level security;

drop policy if exists "clients_select_authenticated" on public.clients;
create policy "clients_select_authenticated" on public.clients for select to authenticated using (true);

drop policy if exists "clients_insert_authenticated" on public.clients;
create policy "clients_insert_authenticated" on public.clients for insert to authenticated
with check (created_by is null or created_by = auth.uid());

drop policy if exists "clients_update_admin" on public.clients;
create policy "clients_update_admin" on public.clients for update to authenticated
using (
  lower(coalesce(auth.jwt() ->> 'email', '')) = 'joeryan09@outlook.com'
  or lower(coalesce(auth.jwt() -> 'user_metadata' ->> 'role', auth.jwt() -> 'app_metadata' ->> 'role', '')) = 'admin'
)
with check (
  lower(coalesce(auth.jwt() ->> 'email', '')) = 'joeryan09@outlook.com'
  or lower(coalesce(auth.jwt() -> 'user_metadata' ->> 'role', auth.jwt() -> 'app_metadata' ->> 'role', '')) = 'admin'
);

insert into public.clients (name, normalized_name, active, created_by)
values ('Internal / Other', public.normalize_client_name('Internal / Other'), true, null)
on conflict (normalized_name) do update set active = true;

create table if not exists public.booking_diary (
  id uuid primary key default gen_random_uuid(),
  booking_id text,
  client_id uuid references public.clients(id) on delete restrict,
  booking_date date not null,
  pickup_time time,
  amount_pallets numeric,
  weight numeric,
  dimensions text,
  pickup text not null,
  pickup_place_id text,
  pickup_address text,
  pickup_lat numeric,
  pickup_lng numeric,
  warehouse_no text,
  dropoff text not null,
  dropoff_place_id text,
  dropoff_address text,
  dropoff_lat numeric,
  dropoff_lng numeric,
  estimated_distance_km numeric,
  estimated_duration_minutes numeric,
  google_maps_route_url text,
  distance_source text,
  route_calculated_at timestamptz,
  route_distance_meters numeric,
  route_duration_seconds numeric,
  route_static_duration_seconds numeric,
  route_departure_time timestamptz,
  route_preference text,
  route_label text,
  route_description text,
  route_polyline text,
  route_traffic_aware boolean,
  route_source text,
  route_fallback_info jsonb,
  job_order_number text,
  vehicle text,
  driver text,
  notes text,
  status text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_by text,
  modified_by text
);

create index if not exists booking_diary_booking_date_idx
  on public.booking_diary (booking_date);

create index if not exists booking_diary_pickup_time_idx
  on public.booking_diary (pickup_time);

create index if not exists booking_diary_vehicle_idx
  on public.booking_diary (vehicle);

create index if not exists booking_diary_driver_idx
  on public.booking_diary (driver);

create index if not exists booking_diary_created_by_user_id_idx
  on public.booking_diary (created_by_user_id);

create index if not exists booking_diary_booking_id_idx
  on public.booking_diary (booking_id);

create index if not exists booking_diary_client_id_idx
  on public.booking_diary (client_id);

alter table public.booking_diary disable row level security;

create or replace function public.require_booking_diary_client()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' and new.client_id is null then
    raise exception 'Client name is required for new Booking Diary entries.' using errcode = '23502';
  end if;
  if tg_op = 'INSERT' or new.client_id is distinct from old.client_id then
    if new.client_id is null then
      raise exception 'Client name cannot be removed from a Booking Diary entry once recorded.' using errcode = '23502';
    end if;
    if not exists (select 1 from public.clients where id = new.client_id and active = true) then
      raise exception 'The selected client is inactive or does not exist.' using errcode = '23503';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists require_booking_diary_client on public.booking_diary;
create trigger require_booking_diary_client before insert or update of client_id on public.booking_diary
for each row execute function public.require_booking_diary_client();

create or replace function public.get_booking_client_delete_eligibility()
returns table (client_id uuid, booking_references bigint, other_references bigint)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  client_row record;
  foreign_key_row record;
  reference_count bigint;
begin
  if auth.uid() is null or not (
    lower(coalesce(auth.jwt() ->> 'email', '')) = 'joeryan09@outlook.com'
    or lower(coalesce(auth.jwt() -> 'user_metadata' ->> 'role', auth.jwt() -> 'app_metadata' ->> 'role', '')) = 'admin'
  ) then
    raise exception 'Admin permission required to manage clients.' using errcode = '42501';
  end if;
  for client_row in select id from public.clients loop
    client_id := client_row.id;
    booking_references := 0;
    other_references := 0;
    for foreign_key_row in
      select constraint_row.conrelid::regclass as reference_table, source_attribute.attname as reference_column
      from pg_catalog.pg_constraint constraint_row
      cross join lateral unnest(constraint_row.conkey) with ordinality source_key(attnum, position)
      join lateral unnest(constraint_row.confkey) with ordinality target_key(attnum, position) on target_key.position = source_key.position
      join pg_catalog.pg_attribute source_attribute on source_attribute.attrelid = constraint_row.conrelid and source_attribute.attnum = source_key.attnum
      join pg_catalog.pg_attribute target_attribute on target_attribute.attrelid = constraint_row.confrelid and target_attribute.attnum = target_key.attnum
      where constraint_row.contype = 'f' and constraint_row.confrelid = 'public.clients'::regclass and target_attribute.attname = 'id'
    loop
      execute format('select count(*) from %s where %I = $1', foreign_key_row.reference_table, foreign_key_row.reference_column)
      into reference_count using client_row.id;
      if foreign_key_row.reference_table = 'public.booking_diary'::regclass then
        booking_references := booking_references + reference_count;
      else
        other_references := other_references + reference_count;
      end if;
    end loop;
    return next;
  end loop;
end;
$$;

revoke all on function public.get_booking_client_delete_eligibility() from public;
grant execute on function public.get_booking_client_delete_eligibility() to authenticated;

create or replace function public.delete_unused_booking_client(target_client_id uuid)
returns table (deleted_id uuid, deleted_name text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  current_name text;
  current_normalized_name text;
  foreign_key_row record;
  has_reference boolean;
begin
  if auth.uid() is null or not (
    lower(coalesce(auth.jwt() ->> 'email', '')) = 'joeryan09@outlook.com'
    or lower(coalesce(auth.jwt() -> 'user_metadata' ->> 'role', auth.jwt() -> 'app_metadata' ->> 'role', '')) = 'admin'
  ) then
    raise exception 'Admin permission required to manage clients.' using errcode = '42501';
  end if;
  select client.name, client.normalized_name into current_name, current_normalized_name
  from public.clients client where client.id = target_client_id for update;
  if not found then raise exception 'Client no longer exists.' using errcode = 'P0002'; end if;
  if current_normalized_name = public.normalize_client_name('Internal / Other') then
    raise exception 'Internal / Other cannot be deleted.' using errcode = '42501';
  end if;
  if exists (select 1 from public.booking_diary booking where booking.client_id = target_client_id) then
    raise exception 'Cannot delete this client because it is used by bookings. Deactivate it instead.' using errcode = '23503';
  end if;
  for foreign_key_row in
    select constraint_row.conrelid::regclass as reference_table, source_attribute.attname as reference_column
    from pg_catalog.pg_constraint constraint_row
    cross join lateral unnest(constraint_row.conkey) with ordinality source_key(attnum, position)
    join lateral unnest(constraint_row.confkey) with ordinality target_key(attnum, position) on target_key.position = source_key.position
    join pg_catalog.pg_attribute source_attribute on source_attribute.attrelid = constraint_row.conrelid and source_attribute.attnum = source_key.attnum
    join pg_catalog.pg_attribute target_attribute on target_attribute.attrelid = constraint_row.confrelid and target_attribute.attnum = target_key.attnum
    where constraint_row.contype = 'f'
      and constraint_row.confrelid = 'public.clients'::regclass
      and constraint_row.conrelid <> 'public.booking_diary'::regclass
      and target_attribute.attname = 'id'
  loop
    execute format('select exists(select 1 from %s where %I = $1)', foreign_key_row.reference_table, foreign_key_row.reference_column)
    into has_reference using target_client_id;
    if has_reference then
      raise exception 'Cannot delete this client because it is referenced by other records. Deactivate it instead.' using errcode = '23503';
    end if;
  end loop;
  delete from public.clients client where client.id = target_client_id
  returning client.id, client.name into deleted_id, deleted_name;
  return next;
end;
$$;

revoke all on function public.delete_unused_booking_client(uuid) from public;
grant execute on function public.delete_unused_booking_client(uuid) to authenticated;

create or replace function public.set_booking_diary_created_by_user_id()
returns trigger as $$
begin
  if new.created_by_user_id is null then
    new.created_by_user_id := auth.uid();
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists set_booking_diary_created_by_user_id on public.booking_diary;
create trigger set_booking_diary_created_by_user_id
before insert on public.booking_diary
for each row execute function public.set_booking_diary_created_by_user_id();

drop trigger if exists set_booking_diary_updated_at on public.booking_diary;
create trigger set_booking_diary_updated_at
before update on public.booking_diary
for each row execute function public.set_updated_at();

create or replace function public.normalize_saved_location_name(value text)
returns text language sql immutable strict as $$
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
  constraint saved_locations_verified_location_check check (
    nullif(btrim(formatted_address), '') is not null
  ),
  constraint saved_locations_normalized_name_unique unique (location_type, normalized_name)
);

create index if not exists saved_locations_rank_idx
  on public.saved_locations (location_type, use_count desc, last_used_at desc);
create index if not exists saved_locations_last_used_idx
  on public.saved_locations (last_used_at desc);

alter table public.saved_locations enable row level security;
drop policy if exists "saved_locations_select_authenticated" on public.saved_locations;
create policy "saved_locations_select_authenticated" on public.saved_locations
for select to authenticated using (true);
revoke insert, update, delete on public.saved_locations from anon, authenticated;
grant select on public.saved_locations to authenticated;

create or replace function public.remember_saved_location(
  target_location_type text,
  target_display_name text,
  target_google_place_id text,
  target_formatted_address text,
  target_latitude numeric,
  target_longitude numeric,
  target_used_at timestamptz default now()
)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare normalized_display_name text;
begin
  normalized_display_name := public.normalize_saved_location_name(target_display_name);
  if target_location_type not in ('pickup', 'dropoff')
    or normalized_display_name = ''
    or nullif(btrim(target_formatted_address), '') is null
    or (nullif(btrim(target_google_place_id), '') is null and (target_latitude is null or target_longitude is null)) then
    return;
  end if;
  insert into public.saved_locations (
    location_type, display_name, normalized_name, google_place_id, formatted_address,
    latitude, longitude, use_count, last_used_at, created_by
  ) values (
    target_location_type, btrim(target_display_name), normalized_display_name,
    nullif(btrim(target_google_place_id), ''), btrim(target_formatted_address),
    target_latitude, target_longitude, 1, coalesce(target_used_at, now()), auth.uid()
  )
  on conflict (location_type, normalized_name) do update set
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
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    perform public.remember_saved_location('pickup', new.pickup, new.pickup_place_id, new.pickup_address, new.pickup_lat, new.pickup_lng, coalesce(new.updated_at, now()));
    perform public.remember_saved_location('dropoff', new.dropoff, new.dropoff_place_id, new.dropoff_address, new.dropoff_lat, new.dropoff_lng, coalesce(new.updated_at, now()));
    return new;
  end if;
  if row(new.pickup, new.pickup_place_id, new.pickup_address, new.pickup_lat, new.pickup_lng)
    is distinct from row(old.pickup, old.pickup_place_id, old.pickup_address, old.pickup_lat, old.pickup_lng) then
    perform public.remember_saved_location('pickup', new.pickup, new.pickup_place_id, new.pickup_address, new.pickup_lat, new.pickup_lng, coalesce(new.updated_at, now()));
  end if;
  if row(new.dropoff, new.dropoff_place_id, new.dropoff_address, new.dropoff_lat, new.dropoff_lng)
    is distinct from row(old.dropoff, old.dropoff_place_id, old.dropoff_address, old.dropoff_lat, old.dropoff_lng) then
    perform public.remember_saved_location('dropoff', new.dropoff, new.dropoff_place_id, new.dropoff_address, new.dropoff_lat, new.dropoff_lng, coalesce(new.updated_at, now()));
  end if;
  return new;
end;
$$;

drop trigger if exists remember_booking_diary_locations on public.booking_diary;
create trigger remember_booking_diary_locations
after insert or update of pickup, pickup_place_id, pickup_address, pickup_lat, pickup_lng,
  dropoff, dropoff_place_id, dropoff_address, dropoff_lat, dropoff_lng
on public.booking_diary for each row execute function public.remember_booking_diary_locations();

alter table if exists public.trip_journeys
  add column if not exists pickup_display_name text,
  add column if not exists dropoff_display_name text,
  add column if not exists pickup_place_id text,
  add column if not exists dropoff_place_id text,
  add column if not exists pickup_lat numeric,
  add column if not exists pickup_lng numeric,
  add column if not exists dropoff_lat numeric,
  add column if not exists dropoff_lng numeric;

alter table if exists public.trip_journeys
  add column if not exists route_distance_meters numeric,
  add column if not exists route_duration_seconds numeric,
  add column if not exists route_static_duration_seconds numeric,
  add column if not exists route_calculated_at timestamptz,
  add column if not exists route_departure_time timestamptz,
  add column if not exists route_preference text,
  add column if not exists route_label text,
  add column if not exists route_description text,
  add column if not exists route_polyline text,
  add column if not exists route_traffic_aware boolean,
  add column if not exists route_source text,
  add column if not exists route_fallback_info jsonb;

do $$
begin
  alter publication supabase_realtime add table public.booking_diary;
exception
  when duplicate_object then null;
  when undefined_object then null;
end;
$$;

notify pgrst, 'reload schema';
