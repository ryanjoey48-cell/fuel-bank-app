alter table if exists public.booking_diary
  add column if not exists route_distance_meters numeric,
  add column if not exists route_duration_seconds numeric,
  add column if not exists route_static_duration_seconds numeric,
  add column if not exists route_calculated_at timestamptz,
  add column if not exists route_departure_time timestamptz,
  add column if not exists route_preference text,
  add column if not exists route_label text,
  add column if not exists route_description text,
  add column if not exists route_polyline text,
  add column if not exists route_traffic_aware boolean,
  add column if not exists route_source text,
  add column if not exists route_fallback_info jsonb;

alter table if exists public.trip_journeys
  add column if not exists route_distance_meters numeric,
  add column if not exists route_duration_seconds numeric,
  add column if not exists route_static_duration_seconds numeric,
  add column if not exists route_calculated_at timestamptz,
  add column if not exists route_departure_time timestamptz,
  add column if not exists route_preference text,
  add column if not exists route_label text,
  add column if not exists route_description text,
  add column if not exists route_polyline text,
  add column if not exists route_traffic_aware boolean,
  add column if not exists route_source text,
  add column if not exists route_fallback_info jsonb;

notify pgrst, 'reload schema';
