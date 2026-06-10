create table if not exists public.vehicle_service_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  vehicle_id uuid references public.vehicles(id) on delete set null,
  vehicle_reg text,
  service_type text default 'oil_change',
  service_date date,
  odometer numeric(12, 2),
  oil_change_odometer numeric(12, 2),
  interval_km numeric(12, 2),
  next_service_due_odometer numeric(12, 2),
  vehicle_type_snapshot text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.vehicle_service_logs
  add column if not exists user_id uuid references auth.users(id) on delete cascade,
  add column if not exists vehicle_id uuid references public.vehicles(id) on delete set null,
  add column if not exists vehicle_reg text,
  add column if not exists service_type text default 'oil_change',
  add column if not exists service_date date,
  add column if not exists odometer numeric(12, 2),
  add column if not exists oil_change_odometer numeric(12, 2),
  add column if not exists interval_km numeric(12, 2),
  add column if not exists next_service_due_odometer numeric(12, 2),
  add column if not exists vehicle_type_snapshot text,
  add column if not exists notes text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

update public.vehicle_service_logs
set service_type = 'oil_change'
where service_type is null or btrim(service_type) = '';

update public.vehicle_service_logs
set oil_change_odometer = odometer
where oil_change_odometer is null
  and odometer is not null;

update public.vehicle_service_logs
set odometer = oil_change_odometer
where odometer is null
  and oil_change_odometer is not null;

update public.vehicle_service_logs
set next_service_due_odometer = oil_change_odometer + interval_km
where next_service_due_odometer is null
  and oil_change_odometer is not null
  and interval_km is not null;

update public.vehicle_service_logs
set next_service_due_odometer = odometer + interval_km
where next_service_due_odometer is null
  and odometer is not null
  and interval_km is not null;

create index if not exists vehicle_service_logs_vehicle_reg_lookup_idx
  on public.vehicle_service_logs (user_id, vehicle_reg, service_date desc, created_at desc);

create index if not exists vehicle_service_logs_vehicle_id_idx
  on public.vehicle_service_logs (vehicle_id);

notify pgrst, 'reload schema';
