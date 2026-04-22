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

alter table public.shipments
  add column if not exists vehicle_type text,
  add column if not exists standard_km_per_litre numeric(10, 2),
  add column if not exists standard_fuel_price numeric(12, 2),
  add column if not exists estimated_fuel_cost numeric(12, 2),
  add column if not exists toll_estimate numeric(12, 2) not null default 0,
  add column if not exists other_costs numeric(12, 2) not null default 0,
  add column if not exists driver_cost numeric(12, 2) not null default 0,
  add column if not exists subtotal_cost numeric(12, 2),
  add column if not exists margin_percent numeric(7, 2) not null default 0,
  add column if not exists quoted_price numeric(12, 2),
  add column if not exists actual_distance_km numeric(10, 2),
  add column if not exists actual_fuel_litres numeric(12, 2),
  add column if not exists actual_fuel_cost numeric(12, 2),
  add column if not exists actual_tolls numeric(12, 2),
  add column if not exists actual_total_cost numeric(12, 2),
  add column if not exists variance_amount numeric(12, 2),
  add column if not exists variance_percent numeric(7, 2);

update public.shipments
set estimated_fuel_cost = coalesce(estimated_fuel_cost, estimated_fuel_cost_thb)
where estimated_fuel_cost is null
  and estimated_fuel_cost_thb is not null;

update public.shipments
set subtotal_cost = coalesce(estimated_fuel_cost, 0) + coalesce(toll_estimate, 0) + coalesce(other_costs, 0) + coalesce(driver_cost, 0)
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

create unique index if not exists vehicle_type_standards_user_vehicle_type_key
  on public.vehicle_type_standards (user_id, lower(vehicle_type));

alter table public.vehicle_type_standards enable row level security;

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

drop trigger if exists set_vehicle_type_standard_user_id on public.vehicle_type_standards;
create trigger set_vehicle_type_standard_user_id
before insert on public.vehicle_type_standards
for each row execute function public.set_user_id();

drop trigger if exists set_vehicle_type_standards_updated_at on public.vehicle_type_standards;
create trigger set_vehicle_type_standards_updated_at
before update on public.vehicle_type_standards
for each row execute function public.set_updated_at();

notify pgrst, 'reload schema';
