alter table if exists public.booking_diary
  add column if not exists created_by_user_id uuid references auth.users(id) on delete set null;

create or replace function public.set_booking_diary_created_by_user_id()
returns trigger as $$
begin
  if new.created_by_user_id is null then
    new.created_by_user_id := auth.uid();
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists set_booking_diary_created_by_user_id on public.booking_diary;
create trigger set_booking_diary_created_by_user_id
before insert on public.booking_diary
for each row execute function public.set_booking_diary_created_by_user_id();

create index if not exists booking_diary_created_by_user_id_idx
  on public.booking_diary (created_by_user_id);

comment on column public.booking_diary.created_by_user_id is 'Authenticated user who originally created the booking. Nullable for historical bookings.';
