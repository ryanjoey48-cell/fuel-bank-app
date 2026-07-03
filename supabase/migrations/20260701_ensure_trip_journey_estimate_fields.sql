alter table public.trip_journeys
  add column if not exists manual_estimated_distance_km numeric,
  add column if not exists estimated_distance_source text;

notify pgrst, 'reload schema';
