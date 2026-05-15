alter table public.booking_diary
  add column if not exists status text;

alter table public.booking_diary
  add column if not exists pickup_time time;

create index if not exists booking_diary_pickup_time_idx
  on public.booking_diary (pickup_time);

notify pgrst, 'reload schema';
