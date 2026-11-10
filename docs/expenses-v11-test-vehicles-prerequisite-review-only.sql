-- NOT APPLIED. Owner-approved isolated TEST project only. No fleet rows are copied or created.
-- This is the existing canonical Vehicles definition from supabase/schema.sql, not a new registration list.
begin;
do $$ begin
 if current_setting('ees.expenses.approved_test_project_ref',true) is distinct from 'wpmnjfncaoogssgpqxek' then raise exception 'Approved Expenses TEST project identity must be acknowledged first'; end if;
 if to_regclass('public.vehicles') is not null then raise exception 'Vehicles already exists: inspect its schema; do not overwrite or alter it with this prerequisite'; end if;
 if to_regprocedure('public.is_office_account()') is null then raise exception 'Existing office authentication prerequisite is missing; no authentication routines will be replaced'; end if;
end $$;
create table if not exists public.vehicles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  company_id uuid,
  vehicle_reg text not null,
  vehicle_name text not null,
  vehicle_category text,
  vehicle_type text,
  fuel_type text default 'DIESEL',
  standard_km_per_litre numeric(10, 2),
  default_driver_cost numeric(12, 2),
  last_oil_change_odometer numeric(12, 2),
  last_oil_change_date date,
  oil_change_interval_km numeric(12, 2),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.vehicles enable row level security;
create policy expenses_test_vehicles_office_read on public.vehicles for select to authenticated using(public.is_office_account());
grant select on public.vehicles to authenticated,service_role;
commit;
-- The approved operator can add clearly synthetic test vehicles using reviewed setup SQL.
-- No real EES vehicle, finance, fuel, maintenance or performance records are imported.
