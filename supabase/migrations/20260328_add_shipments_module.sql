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
