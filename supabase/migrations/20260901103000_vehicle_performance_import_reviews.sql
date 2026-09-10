create table if not exists public.vehicle_performance_import_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  vehicle_id uuid references public.vehicles(id) on delete set null,
  canonical_vehicle_registration text not null check (length(btrim(canonical_vehicle_registration)) > 0),
  canonical_vehicle_registration_key text not null check (length(btrim(canonical_vehicle_registration_key)) > 0),
  imported_vehicle_reference text,
  source_sheet text,
  source_row_number integer,
  source_row_key text,
  year integer not null check (year between 2000 and 2100),
  month integer not null check (month between 1 and 12),
  review_status text not null check (review_status in ('approved', 'correction_required')),
  excel_fuel numeric(12, 2),
  app_fuel_at_review numeric(12, 2) not null default 0,
  fuel_difference_at_review numeric(12, 2),
  review_note text,
  reviewed_by text,
  reviewed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists vehicle_performance_import_reviews_vehicle_period_key
  on public.vehicle_performance_import_reviews (
    user_id,
    year,
    month,
    canonical_vehicle_registration_key
  );

create index if not exists vehicle_performance_import_reviews_vehicle_id_idx
  on public.vehicle_performance_import_reviews (vehicle_id);

create index if not exists vehicle_performance_import_reviews_source_row_idx
  on public.vehicle_performance_import_reviews (
    user_id,
    source_row_key
  )
  where source_row_key is not null;

create or replace function public.set_vehicle_performance_import_reviews_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  new.reviewed_at = coalesce(new.reviewed_at, now());
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_vehicle_performance_import_reviews_updated_at
  on public.vehicle_performance_import_reviews;
create trigger set_vehicle_performance_import_reviews_updated_at
before update on public.vehicle_performance_import_reviews
for each row execute function public.set_vehicle_performance_import_reviews_updated_at();

alter table public.vehicle_performance_import_reviews enable row level security;

drop policy if exists "vehicle_performance_import_reviews_select_own"
  on public.vehicle_performance_import_reviews;
create policy "vehicle_performance_import_reviews_select_own"
on public.vehicle_performance_import_reviews
for select to authenticated
using (user_id = auth.uid());

drop policy if exists "vehicle_performance_import_reviews_insert_own"
  on public.vehicle_performance_import_reviews;
create policy "vehicle_performance_import_reviews_insert_own"
on public.vehicle_performance_import_reviews
for insert to authenticated
with check (user_id = auth.uid());

drop policy if exists "vehicle_performance_import_reviews_update_own"
  on public.vehicle_performance_import_reviews;
create policy "vehicle_performance_import_reviews_update_own"
on public.vehicle_performance_import_reviews
for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "vehicle_performance_import_reviews_delete_own"
  on public.vehicle_performance_import_reviews;
create policy "vehicle_performance_import_reviews_delete_own"
on public.vehicle_performance_import_reviews
for delete to authenticated
using (user_id = auth.uid());

comment on table public.vehicle_performance_import_reviews is
  'Persistent manual review decisions for Vehicle Performance Excel import exceptions. Normal ready and duplicate rows are not stored here.';
