create table if not exists public.trip_journeys (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid references public.booking_diary(id) on delete set null,
  booking_reference text,
  date date,
  pickup_time text,
  pickup_location text,
  dropoff_location text,
  route text,
  vehicle_type text,
  vehicle_reg text,
  driver text,
  load_text text,
  warehouse_no text,
  notes text,
  start_mileage numeric,
  end_mileage numeric,
  actual_distance_km numeric,
  estimated_distance_km numeric,
  distance_difference_km numeric,
  distance_difference_percent numeric,
  manual_litres numeric,
  manual_fuel_cost numeric,
  fuel_source text default 'manual',
  return_to_depot boolean default false,
  waiting_idle_notes text,
  extra_route_notes text,
  status text default 'created',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.trip_fuel_logs (
  id uuid primary key default gen_random_uuid(),
  trip_journey_id uuid references public.trip_journeys(id) on delete cascade,
  fuel_log_id text not null,
  created_at timestamptz default now()
);

create index if not exists trip_journeys_booking_id_idx
  on public.trip_journeys (booking_id);

create index if not exists trip_journeys_date_idx
  on public.trip_journeys (date desc, id desc);

create index if not exists trip_journeys_driver_idx
  on public.trip_journeys (driver);

create index if not exists trip_journeys_vehicle_reg_idx
  on public.trip_journeys (vehicle_reg);

create index if not exists trip_journeys_status_idx
  on public.trip_journeys (status);

create index if not exists trip_fuel_logs_trip_journey_id_idx
  on public.trip_fuel_logs (trip_journey_id);

create index if not exists trip_fuel_logs_fuel_log_id_idx
  on public.trip_fuel_logs (fuel_log_id);

create unique index if not exists trip_fuel_logs_fuel_log_unique_idx
  on public.trip_fuel_logs (fuel_log_id);

create or replace function public.set_trip_journey_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_trip_journey_updated_at on public.trip_journeys;
create trigger set_trip_journey_updated_at
before update on public.trip_journeys
for each row execute function public.set_trip_journey_updated_at();

alter table public.trip_journeys disable row level security;
alter table public.trip_fuel_logs disable row level security;
