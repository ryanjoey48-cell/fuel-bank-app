create or replace function public.set_booking_diary_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create table if not exists public.booking_diary (
  id uuid primary key default gen_random_uuid(),
  booking_id text not null,
  booking_date date not null,
  amount_pallets numeric,
  weight numeric,
  dimensions text,
  pickup text not null,
  warehouse_no text,
  dropoff text not null,
  vehicle text,
  driver text,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  created_by text,
  modified_by text
);

alter table public.booking_diary
  drop column if exists user_id,
  drop column if exists updated_by,
  drop column if exists created_by_name,
  drop column if exists updated_by_name;

alter table public.booking_diary
  add column if not exists booking_id text,
  add column if not exists booking_date date,
  add column if not exists amount_pallets numeric,
  add column if not exists weight numeric,
  add column if not exists dimensions text,
  add column if not exists pickup text,
  add column if not exists warehouse_no text,
  add column if not exists dropoff text,
  add column if not exists vehicle text,
  add column if not exists driver text,
  add column if not exists notes text,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now(),
  add column if not exists created_by text,
  add column if not exists modified_by text;

alter table public.booking_diary
  alter column amount_pallets type numeric using nullif(regexp_replace(amount_pallets::text, '[^0-9.\-]', '', 'g'), '')::numeric,
  alter column weight type numeric using nullif(regexp_replace(weight::text, '[^0-9.\-]', '', 'g'), '')::numeric,
  alter column created_by type text using created_by::text,
  alter column modified_by type text using modified_by::text,
  alter column created_at set default now(),
  alter column updated_at set default now();

update public.booking_diary
set
  booking_id = coalesce(nullif(booking_id, ''), 'BOOKING-' || left(id::text, 8)),
  booking_date = coalesce(booking_date, current_date),
  pickup = coalesce(nullif(pickup, ''), 'Pending pickup'),
  dropoff = coalesce(nullif(dropoff, ''), 'Pending dropoff');

alter table public.booking_diary
  alter column booking_id set not null,
  alter column booking_date set not null,
  alter column pickup set not null,
  alter column dropoff set not null;

drop index if exists booking_diary_user_booking_id_key;
drop index if exists booking_diary_user_date_idx;
drop index if exists booking_diary_pickup_idx;
drop index if exists booking_diary_dropoff_idx;
drop index if exists booking_diary_vehicle_idx;
drop index if exists booking_diary_driver_idx;

create index if not exists booking_diary_booking_date_idx
  on public.booking_diary (booking_date);

create index if not exists booking_diary_booking_id_idx
  on public.booking_diary (booking_id);

create index if not exists booking_diary_vehicle_idx
  on public.booking_diary (vehicle);

create index if not exists booking_diary_driver_idx
  on public.booking_diary (driver);

drop trigger if exists set_booking_diary_user_id on public.booking_diary;
drop trigger if exists set_booking_diary_updated_at on public.booking_diary;
create trigger set_booking_diary_updated_at
before update on public.booking_diary
for each row execute function public.set_booking_diary_updated_at();

drop policy if exists "booking_diary_select_own" on public.booking_diary;
drop policy if exists "booking_diary_insert_own" on public.booking_diary;
drop policy if exists "booking_diary_update_own" on public.booking_diary;
drop policy if exists "booking_diary_delete_own" on public.booking_diary;
alter table public.booking_diary disable row level security;

do $$
begin
  alter publication supabase_realtime add table public.booking_diary;
exception
  when duplicate_object then null;
  when undefined_object then null;
end;
$$;

notify pgrst, 'reload schema';
