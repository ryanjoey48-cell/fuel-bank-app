-- EES Locations Directory. Additive and safe to apply alongside existing modules.
begin;

create table if not exists public.ees_locations (
  id uuid primary key default gen_random_uuid(),
  company_name text not null check (length(btrim(company_name)) > 0),
  thai_name text,
  alternative_names text[] not null default '{}',
  address text not null check (length(btrim(address)) > 0),
  province text,
  destination_type text not null default 'Other'
    check (destination_type in ('Factory','Warehouse','Airport','Port','Customer','Depot','Other')),
  google_maps_url text,
  truck_entrance_url text,
  verification_status text not null default 'needs_check'
    check (verification_status in ('verified','needs_check')),
  verified_at timestamptz,
  notes text,
  source_info text,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (google_maps_url is null or google_maps_url ~* '^https://(maps\.google\.com|(www\.)?google\.(com|[a-z]{2,3}|co\.[a-z]{2}))/maps'),
  check (truck_entrance_url is null or truck_entrance_url ~* '^https://(maps\.google\.com|(www\.)?google\.(com|[a-z]{2,3}|co\.[a-z]{2}))/maps'),
  check ((verification_status = 'verified') = (verified_at is not null))
);

create index if not exists ees_locations_company_name_idx on public.ees_locations (lower(company_name));
create index if not exists ees_locations_status_idx on public.ees_locations (verification_status);
create index if not exists ees_locations_updated_idx on public.ees_locations (updated_at desc);

create table if not exists public.ees_location_user_activity (
  user_id uuid not null references auth.users(id) on delete cascade,
  location_id uuid not null references public.ees_locations(id) on delete cascade,
  is_favourite boolean not null default false,
  last_used_at timestamptz,
  primary key (user_id, location_id)
);

alter table public.ees_locations enable row level security;
alter table public.ees_location_user_activity enable row level security;

drop policy if exists ees_locations_office_read on public.ees_locations;
create policy ees_locations_office_read on public.ees_locations for select to authenticated
  using (public.is_account_active() and public.current_account_role() in ('admin','office_staff','read_only'));
drop policy if exists ees_locations_office_insert on public.ees_locations;
create policy ees_locations_office_insert on public.ees_locations for insert to authenticated
  with check (public.is_account_active() and public.current_account_role() in ('admin','office_staff'));
drop policy if exists ees_locations_office_update on public.ees_locations;
create policy ees_locations_office_update on public.ees_locations for update to authenticated
  using (public.is_account_active() and public.current_account_role() in ('admin','office_staff'))
  with check (public.is_account_active() and public.current_account_role() in ('admin','office_staff'));
drop policy if exists ees_locations_office_delete on public.ees_locations;
create policy ees_locations_office_delete on public.ees_locations for delete to authenticated
  using (public.is_account_active() and public.current_account_role() in ('admin','office_staff'));

drop policy if exists ees_location_activity_own on public.ees_location_user_activity;
create policy ees_location_activity_own on public.ees_location_user_activity for all to authenticated
  using (auth.uid() = user_id and public.is_account_active())
  with check (auth.uid() = user_id and public.is_account_active());

create or replace function public.set_ees_locations_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  if new.verification_status = 'needs_check' then new.verified_at := null; end if;
  if new.verification_status = 'verified' and new.verified_at is null then new.verified_at := now(); end if;
  return new;
end;
$$;
drop trigger if exists ees_locations_updated_at on public.ees_locations;
create trigger ees_locations_updated_at before update on public.ees_locations
  for each row execute function public.set_ees_locations_updated_at();

grant select, insert, update, delete on public.ees_locations to authenticated;
grant select, insert, update, delete on public.ees_location_user_activity to authenticated;
commit;
