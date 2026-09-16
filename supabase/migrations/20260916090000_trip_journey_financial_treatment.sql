alter table if exists public.trip_journeys
  add column if not exists include_in_financials boolean not null default true,
  add column if not exists original_trip_price numeric(12, 2);

alter table if exists public.trip_journeys
  drop constraint if exists trip_journeys_original_trip_price_nonnegative;

alter table if exists public.trip_journeys
  add constraint trip_journeys_original_trip_price_nonnegative
  check (original_trip_price is null or original_trip_price >= 0);

comment on column public.trip_journeys.include_in_financials is
  'Controls trip-level revenue calculations only. Operational distance and mileage always remain included.';
comment on column public.trip_journeys.original_trip_price is
  'Original trip price retained for audit even when the trip is excluded from financial calculations.';

notify pgrst, 'reload schema';
