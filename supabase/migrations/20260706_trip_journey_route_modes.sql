alter table if exists public.trip_journeys
  add column if not exists google_estimated_km numeric,
  add column if not exists google_estimated_minutes numeric,
  add column if not exists route_source text,
  add column if not exists route_start_type text,
  add column if not exists depot_address_used text,
  add column if not exists custom_start_address text,
  add column if not exists pickup_address text,
  add column if not exists dropoff_address text,
  add column if not exists booking_estimated_km numeric,
  add column if not exists booking_estimated_minutes numeric,
  add column if not exists booking_google_maps_route_url text;

notify pgrst, 'reload schema';
