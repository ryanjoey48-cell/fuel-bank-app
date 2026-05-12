alter table public.booking_diary
  alter column booking_id drop not null;

notify pgrst, 'reload schema';
