alter table if exists public.booking_diary
  add column if not exists pickup_lat numeric,
  add column if not exists pickup_lng numeric,
  add column if not exists dropoff_lat numeric,
  add column if not exists dropoff_lng numeric;

comment on column public.booking_diary.pickup is 'Staff-facing pickup display name shown in Booking Diary.';
comment on column public.booking_diary.dropoff is 'Staff-facing drop-off display name shown in Booking Diary.';
comment on column public.booking_diary.pickup_address is 'Google Maps pickup address used for route calculation when available.';
comment on column public.booking_diary.dropoff_address is 'Google Maps drop-off address used for route calculation when available.';
comment on column public.booking_diary.pickup_lat is 'Optional Google Maps pickup latitude.';
comment on column public.booking_diary.pickup_lng is 'Optional Google Maps pickup longitude.';
comment on column public.booking_diary.dropoff_lat is 'Optional Google Maps drop-off latitude.';
comment on column public.booking_diary.dropoff_lng is 'Optional Google Maps drop-off longitude.';
