alter table public.trip_journeys
  add column if not exists start_location text,
  add column if not exists depot_address text,
  add column if not exists manual_actual_km numeric,
  add column if not exists manual_estimated_distance_km numeric;

alter table public.trip_fuel_logs
  drop constraint if exists trip_fuel_logs_fuel_log_id_fkey;

alter table public.trip_fuel_logs
  alter column fuel_log_id type text
  using fuel_log_id::text;

create unique index if not exists trip_fuel_logs_trip_fuel_unique_idx
  on public.trip_fuel_logs (trip_journey_id, fuel_log_id);

notify pgrst, 'reload schema';
