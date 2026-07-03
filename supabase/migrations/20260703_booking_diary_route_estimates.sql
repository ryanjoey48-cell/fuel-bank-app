alter table if exists public.booking_diary
  add column if not exists pickup_place_id text,
  add column if not exists dropoff_place_id text,
  add column if not exists pickup_address text,
  add column if not exists dropoff_address text,
  add column if not exists estimated_distance_km numeric,
  add column if not exists estimated_duration_minutes numeric,
  add column if not exists google_maps_route_url text,
  add column if not exists distance_source text,
  add column if not exists route_calculated_at timestamptz;

alter table if exists public.trip_journeys
  add column if not exists estimated_duration_minutes numeric,
  add column if not exists google_maps_route_url text;

notify pgrst, 'reload schema';
