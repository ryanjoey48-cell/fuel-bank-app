alter table public.trip_journeys
  add column if not exists booking_reference text;

alter table public.trip_fuel_logs
  drop constraint if exists trip_fuel_logs_fuel_log_id_fkey;

alter table public.trip_fuel_logs
  alter column fuel_log_id type text
  using fuel_log_id::text;

create index if not exists trip_fuel_logs_fuel_log_id_idx
  on public.trip_fuel_logs (fuel_log_id);

create unique index if not exists trip_fuel_logs_fuel_log_unique_idx
  on public.trip_fuel_logs (fuel_log_id);

notify pgrst, 'reload schema';
