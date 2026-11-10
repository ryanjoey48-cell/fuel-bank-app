-- REVIEW ONLY. Additive Forth locations import / reconciliation storage.
-- Do not run without owner approval. Does not write to Forth.
-- Safe to apply after the existing ees_locations directory migration.
begin;

create table if not exists public.ees_forth_location_links (
  forth_location_id text primary key check (forth_location_id ~ '^[0-9]+$'),
  ees_location_id uuid not null references public.ees_locations(id) on delete restrict,
  link_status text not null check (link_status in ('matched','imported','skipped','updated')),
  forth_name text,
  forth_group_layer text,
  forth_latitude double precision check (forth_latitude is null or forth_latitude between -90 and 90),
  forth_longitude double precision check (forth_longitude is null or forth_longitude between -180 and 180),
  forth_address text,
  forth_location_type text,
  forth_diameter_raw text,
  forth_symbol text,
  diameter_unit_note text not null default 'unverified',
  source_export_label text not null default 'Forth pinned locations CSV',
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (ees_location_id, forth_location_id)
);
create index if not exists ees_forth_location_links_ees_idx
  on public.ees_forth_location_links (ees_location_id);

create table if not exists public.ees_forth_location_import_audit (
  id bigint generated always as identity primary key,
  forth_location_id text not null,
  ees_location_id uuid references public.ees_locations(id) on delete set null,
  action text not null check (action in (
    'parsed','classified','approved_new','linked_existing','skipped','deferred','updated_metadata'
  )),
  classification text check (classification in (
    'MATCHED','POSSIBLE_DUPLICATE','NEW_LOCATION','MISSING_COORDINATES',
    'INVALID_COORDINATES','REQUIRES_REVIEW'
  )),
  details jsonb not null default '{}'::jsonb,
  actor_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists ees_forth_location_import_audit_forth_idx
  on public.ees_forth_location_import_audit (forth_location_id, created_at desc);

alter table public.ees_forth_location_links enable row level security;
alter table public.ees_forth_location_import_audit enable row level security;

drop policy if exists ees_forth_links_office_read on public.ees_forth_location_links;
create policy ees_forth_links_office_read on public.ees_forth_location_links for select to authenticated
  using (public.is_account_active() and public.current_account_role() in ('admin','office_staff','read_only'));

drop policy if exists ees_forth_import_audit_office_read on public.ees_forth_location_import_audit;
create policy ees_forth_import_audit_office_read on public.ees_forth_location_import_audit for select to authenticated
  using (public.is_account_active() and public.current_account_role() in ('admin','office_staff','read_only'));

grant select on public.ees_forth_location_links, public.ees_forth_location_import_audit to authenticated;
grant all on public.ees_forth_location_links, public.ees_forth_location_import_audit to service_role;
grant usage, select on sequence public.ees_forth_location_import_audit_id_seq to service_role;

comment on table public.ees_forth_location_links is
  'Links Forth pinned-location IDs to EES Directory records. Diameter units remain unverified.';
comment on table public.ees_forth_location_import_audit is
  'Audit trail for Forth CSV parse, classification, approval, skip and link actions.';

-- Optional pilot selection list. Enabling a geofence still requires verified Directory + confirmed pin + zone RPC.
create table if not exists public.ees_fleet_geofence_pilot_sites (
  location_id uuid primary key references public.ees_locations(id) on delete restrict,
  selected boolean not null default true,
  reviewer_user_id uuid references auth.users(id) on delete set null,
  notes text,
  updated_at timestamptz not null default now()
);
alter table public.ees_fleet_geofence_pilot_sites enable row level security;
drop policy if exists ees_fleet_pilot_sites_office_read on public.ees_fleet_geofence_pilot_sites;
create policy ees_fleet_pilot_sites_office_read on public.ees_fleet_geofence_pilot_sites for select to authenticated
  using (public.is_account_active() and public.current_account_role() in ('admin','office_staff','read_only'));
grant select on public.ees_fleet_geofence_pilot_sites to authenticated;
grant all on public.ees_fleet_geofence_pilot_sites to service_role;

commit;
