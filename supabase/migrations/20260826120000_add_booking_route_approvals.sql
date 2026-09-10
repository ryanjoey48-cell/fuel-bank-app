begin;

do $$
begin
  create type public.booking_route_approval_status as enum (
    'pending',
    'needs_review',
    'confirmed',
    'reopened'
  );
exception
  when duplicate_object then null;
end;
$$;

create table if not exists public.booking_route_approvals (
  id uuid primary key default gen_random_uuid(),
  normalized_pickup text not null check (length(btrim(normalized_pickup)) > 0),
  normalized_dropoff text not null check (length(btrim(normalized_dropoff)) > 0),
  display_pickup text not null check (length(btrim(display_pickup)) > 0),
  display_dropoff text not null check (length(btrim(display_dropoff)) > 0),
  pickup_canonical_name text,
  pickup_formatted_address text,
  pickup_place_id text,
  pickup_lat numeric check (pickup_lat is null or pickup_lat between -90 and 90),
  pickup_lng numeric check (pickup_lng is null or pickup_lng between -180 and 180),
  dropoff_canonical_name text,
  dropoff_formatted_address text,
  dropoff_place_id text,
  dropoff_lat numeric check (dropoff_lat is null or dropoff_lat between -90 and 90),
  dropoff_lng numeric check (dropoff_lng is null or dropoff_lng between -180 and 180),
  google_distance_km numeric check (google_distance_km is null or google_distance_km > 0),
  route_distance_meters numeric check (route_distance_meters is null or route_distance_meters > 0),
  google_maps_route_url text,
  status public.booking_route_approval_status not null default 'pending',
  approved_at timestamptz,
  approved_by uuid references auth.users(id) on delete set null,
  reopened_at timestamptz,
  reopened_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint booking_route_approvals_route_key unique (normalized_pickup, normalized_dropoff),
  constraint booking_route_approvals_confirmed_check check (
    status <> 'confirmed'
    or (
      approved_at is not null
      and approved_by is not null
      and pickup_place_id is not null
      and pickup_formatted_address is not null
      and pickup_lat is not null
      and pickup_lng is not null
      and dropoff_place_id is not null
      and dropoff_formatted_address is not null
      and dropoff_lat is not null
      and dropoff_lng is not null
    )
  )
);

create index if not exists booking_route_approvals_status_idx
  on public.booking_route_approvals (status, updated_at desc);

create index if not exists booking_route_approvals_impact_idx
  on public.booking_route_approvals (normalized_pickup, normalized_dropoff);

alter table public.booking_diary
  add column if not exists approved_route_id uuid references public.booking_route_approvals(id) on delete set null,
  add column if not exists route_confirmation_status public.booking_route_approval_status not null default 'pending';

create index if not exists booking_diary_approved_route_idx
  on public.booking_diary (approved_route_id, booking_date);

create index if not exists booking_diary_route_confirmation_idx
  on public.booking_diary (route_confirmation_status, booking_date);

create or replace function public.set_booking_route_approvals_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists set_booking_route_approvals_updated_at on public.booking_route_approvals;
create trigger set_booking_route_approvals_updated_at
before update on public.booking_route_approvals
for each row execute function public.set_booking_route_approvals_updated_at();

alter table public.booking_route_approvals enable row level security;

revoke all on public.booking_route_approvals from anon, authenticated;
grant select on public.booking_route_approvals to authenticated;

drop policy if exists booking_route_approvals_select on public.booking_route_approvals;
create policy booking_route_approvals_select
on public.booking_route_approvals
for select
to authenticated
using (true);

comment on table public.booking_route_approvals is
  'Human-approved Booking Diary pickup/drop-off route references. Google Maps results alone are not confirmation.';

comment on column public.booking_diary.approved_route_id is
  'Approved route reference inherited from booking_route_approvals for exact normalized pickup/drop-off matches.';

comment on column public.booking_diary.route_confirmation_status is
  'Human route confirmation status. Confirmed only when a booking_route_approvals row has been approved by an admin.';

commit;
