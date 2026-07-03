alter table public.trip_journeys
  add column if not exists start_location_type text default 'depot';

update public.trip_journeys
set start_location_type = 'depot'
where start_location_type is null;

notify pgrst, 'reload schema';
