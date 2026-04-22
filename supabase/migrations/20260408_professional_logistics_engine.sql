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
  user_id uuid not null references auth.users(id) on delete cascade,
  company_id uuid,
  registration text not null,
  vehicle_name text not null,
  vehicle_category public.vehicle_category_enum not null,
  fuel_type public.fuel_type_enum not null default 'DIESEL',
  standard_km_per_litre numeric(10, 2),
  default_driver_cost numeric(12, 2),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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

alter table public.shipments
  add column if not exists vehicle_id uuid references public.vehicles(id) on delete set null,
  add column if not exists vehicle_category public.vehicle_category_enum,
  add column if not exists fuel_type public.fuel_type_enum default 'DIESEL',
  add column if not exists estimated_fuel_litres numeric(12, 2),
  add column if not exists fuel_price_per_litre numeric(12, 2),
  add column if not exists fuel_price_source text,
  add column if not exists fuel_price_effective_date date,
  add column if not exists base_fuel_cost numeric(12, 2),
  add column if not exists fuel_risk_buffer_percent numeric(7, 2),
  add column if not exists quoted_fuel_cost numeric(12, 2);

update public.shipments
set fuel_type = coalesce(fuel_type, 'DIESEL'::public.fuel_type_enum);

update public.shipments
set estimated_fuel_cost = coalesce(estimated_fuel_cost, estimated_fuel_cost_thb)
where estimated_fuel_cost is null
  and estimated_fuel_cost_thb is not null;

update public.shipments
set quoted_fuel_cost = coalesce(quoted_fuel_cost, estimated_fuel_cost)
where quoted_fuel_cost is null
  and estimated_fuel_cost is not null;

update public.shipments
set subtotal_cost = coalesce(quoted_fuel_cost, 0) + coalesce(toll_estimate, 0) + coalesce(other_costs, 0) + coalesce(driver_cost, 0)
where subtotal_cost is null;

update public.shipments
set quoted_price = subtotal_cost * (1 + coalesce(margin_percent, 0) / 100.0)
where quoted_price is null
  and subtotal_cost is not null;

update public.shipments
set actual_total_cost = coalesce(actual_fuel_cost, 0) + coalesce(actual_tolls, 0)
where actual_total_cost is null
  and (actual_fuel_cost is not null or actual_tolls is not null);

update public.shipments
set variance_amount = actual_total_cost - quoted_price
where variance_amount is null
  and actual_total_cost is not null
  and quoted_price is not null;

update public.shipments
set variance_percent = case
  when quoted_price is not null and quoted_price <> 0 and variance_amount is not null
    then (variance_amount / quoted_price) * 100
  else variance_percent
end
where variance_percent is null;

insert into public.vehicle_category_defaults (
  user_id,
  category_name,
  default_km_per_litre,
  default_driver_cost,
  default_margin_percent
)
select
  auth.uid(),
  seeded.category_name,
  seeded.default_km_per_litre,
  0,
  0
from (
  values
    ('SMALL_VAN'::public.vehicle_category_enum, 10.0::numeric),
    ('LORRY'::public.vehicle_category_enum, 5.0::numeric),
    ('HEAVY_LORRY'::public.vehicle_category_enum, 3.8::numeric)
) as seeded(category_name, default_km_per_litre)
where auth.uid() is not null
  and not exists (
    select 1
    from public.vehicle_category_defaults existing
    where existing.user_id = auth.uid()
      and existing.category_name = seeded.category_name
  );

create unique index if not exists vehicles_user_registration_key
  on public.vehicles (user_id, lower(registration));

create unique index if not exists vehicle_category_defaults_user_category_key
  on public.vehicle_category_defaults (user_id, category_name);

create index if not exists shipments_vehicle_id_idx
  on public.shipments (vehicle_id);

create index if not exists shipments_vehicle_date_idx
  on public.shipments (vehicle_id, shipment_date desc);

create index if not exists fuel_pricing_settings_active_lookup_idx
  on public.fuel_pricing_settings (user_id, region, fuel_type, is_active, effective_date desc);

alter table public.vehicles enable row level security;
alter table public.vehicle_category_defaults enable row level security;
alter table public.fuel_pricing_settings enable row level security;

drop policy if exists "vehicles_select_own" on public.vehicles;
create policy "vehicles_select_own" on public.vehicles
for select using (auth.uid() = user_id);

drop policy if exists "vehicles_insert_own" on public.vehicles;
create policy "vehicles_insert_own" on public.vehicles
for insert with check (auth.uid() = user_id);

drop policy if exists "vehicles_update_own" on public.vehicles;
create policy "vehicles_update_own" on public.vehicles
for update using (auth.uid() = user_id);

drop policy if exists "vehicles_delete_own" on public.vehicles;
create policy "vehicles_delete_own" on public.vehicles
for delete using (auth.uid() = user_id);

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

notify pgrst, 'reload schema';
