alter table if exists public.booking_diary
  add column if not exists vehicle_registration text,
  add column if not exists trailer_registration text;

create index if not exists booking_diary_vehicle_registration_idx
  on public.booking_diary (lower(btrim(vehicle_registration)))
  where vehicle_registration is not null;

create index if not exists booking_diary_trailer_registration_idx
  on public.booking_diary (lower(btrim(trailer_registration)))
  where trailer_registration is not null;

create index if not exists booking_diary_vehicle_registration_date_idx
  on public.booking_diary (booking_date, lower(btrim(vehicle_registration)))
  where vehicle_registration is not null;

comment on column public.booking_diary.vehicle_registration is
  'Historical main vehicle registration snapshot used for this specific Booking Diary job. Fuel Log matching must use this main registration only.';

comment on column public.booking_diary.trailer_registration is
  'Optional historical trailer registration snapshot used for this specific Booking Diary job. Do not use for Fuel Log matching.';

create table if not exists public.booking_diary_import_batches (
  id uuid primary key default gen_random_uuid(),
  source_key text not null unique,
  import_name text not null,
  source_fingerprint text not null,
  status text not null default 'preview',
  source_files jsonb not null default '[]'::jsonb,
  summary jsonb not null default '{}'::jsonb,
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_by text,
  approved_by_user_id uuid references auth.users(id) on delete set null,
  approved_by text,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.booking_diary_import_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.booking_diary_import_batches(id) on delete cascade,
  row_fingerprint text not null,
  source_row_number integer not null,
  status text not null,
  approval_status text not null default 'pending',
  confidence numeric,
  reason text,
  evidence jsonb not null default '[]'::jsonb,
  boss_row jsonb not null,
  existing_booking_id uuid references public.booking_diary(id) on delete restrict,
  proposed_values jsonb not null default '{}'::jsonb,
  applied_booking_id uuid references public.booking_diary(id) on delete restrict,
  applied_at timestamptz,
  approved_by_user_id uuid references auth.users(id) on delete set null,
  approved_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (batch_id, row_fingerprint)
);

create index if not exists booking_diary_import_items_batch_status_idx
  on public.booking_diary_import_items (batch_id, status, approval_status);

create index if not exists booking_diary_import_items_existing_booking_idx
  on public.booking_diary_import_items (existing_booking_id)
  where existing_booking_id is not null;

alter table public.booking_diary_import_batches enable row level security;
alter table public.booking_diary_import_items enable row level security;

drop policy if exists "booking_diary_import_batches_admin_select" on public.booking_diary_import_batches;
create policy "booking_diary_import_batches_admin_select" on public.booking_diary_import_batches
for select to authenticated
using (
  lower(coalesce(auth.jwt() ->> 'email', '')) = 'joeryan09@outlook.com'
  or lower(coalesce(auth.jwt() -> 'user_metadata' ->> 'role', auth.jwt() -> 'app_metadata' ->> 'role', '')) = 'admin'
);

drop policy if exists "booking_diary_import_items_admin_select" on public.booking_diary_import_items;
create policy "booking_diary_import_items_admin_select" on public.booking_diary_import_items
for select to authenticated
using (
  lower(coalesce(auth.jwt() ->> 'email', '')) = 'joeryan09@outlook.com'
  or lower(coalesce(auth.jwt() -> 'user_metadata' ->> 'role', auth.jwt() -> 'app_metadata' ->> 'role', '')) = 'admin'
);
