begin;

create extension if not exists "pgcrypto";

create table if not exists public.vehicle_monthly_performance (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  year integer not null check (year between 2000 and 2100),
  month integer not null check (month between 1 and 12),
  vehicle_registration text not null check (length(btrim(vehicle_registration)) > 0),
  salary_cost numeric(12, 2) not null default 0 check (salary_cost >= 0),
  trip_income numeric(12, 2) not null default 0 check (trip_income >= 0),
  other_expenses numeric(12, 2) not null default 0 check (other_expenses >= 0),
  gross_revenue numeric(12, 2) not null default 0 check (gross_revenue >= 0),
  lpg_cost numeric(12, 2) not null default 0 check (lpg_cost >= 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null
);

create unique index if not exists vehicle_monthly_performance_period_vehicle_key
  on public.vehicle_monthly_performance (
    coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid),
    year,
    month,
    lower(btrim(vehicle_registration))
  );

create index if not exists vehicle_monthly_performance_period_idx
  on public.vehicle_monthly_performance (year, month);

create index if not exists vehicle_monthly_performance_vehicle_idx
  on public.vehicle_monthly_performance (lower(btrim(vehicle_registration)));

create or replace function public.set_vehicle_monthly_performance_audit_fields()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.vehicle_registration := regexp_replace(btrim(new.vehicle_registration), '\s+', ' ', 'g');

  if tg_op = 'INSERT' then
    if new.user_id is null then
      new.user_id := auth.uid();
    end if;
    if new.created_by is null then
      new.created_by := auth.uid();
    end if;
  end if;

  new.updated_at := now();
  if new.updated_by is null then
    new.updated_by := auth.uid();
  end if;

  return new;
end;
$$;

drop trigger if exists set_vehicle_monthly_performance_audit_fields
  on public.vehicle_monthly_performance;
create trigger set_vehicle_monthly_performance_audit_fields
before insert or update on public.vehicle_monthly_performance
for each row execute function public.set_vehicle_monthly_performance_audit_fields();

alter table public.vehicle_monthly_performance enable row level security;

drop policy if exists "vehicle_monthly_performance_select_own" on public.vehicle_monthly_performance;
create policy "vehicle_monthly_performance_select_own"
on public.vehicle_monthly_performance
for select
to authenticated
using (user_id is null or user_id = auth.uid());

drop policy if exists "vehicle_monthly_performance_insert_own" on public.vehicle_monthly_performance;
create policy "vehicle_monthly_performance_insert_own"
on public.vehicle_monthly_performance
for insert
to authenticated
with check (user_id is null or user_id = auth.uid());

drop policy if exists "vehicle_monthly_performance_update_own" on public.vehicle_monthly_performance;
create policy "vehicle_monthly_performance_update_own"
on public.vehicle_monthly_performance
for update
to authenticated
using (user_id is null or user_id = auth.uid())
with check (user_id is null or user_id = auth.uid());

drop policy if exists "vehicle_monthly_performance_delete_own" on public.vehicle_monthly_performance;
create policy "vehicle_monthly_performance_delete_own"
on public.vehicle_monthly_performance
for delete
to authenticated
using (user_id is null or user_id = auth.uid());

comment on table public.vehicle_monthly_performance is
  'Manually entered monthly vehicle revenue and direct non-fuel costs. Normal fuel spend is calculated from fuel_logs.';

comment on column public.vehicle_monthly_performance.lpg_cost is
  'Manual LPG amount for Phase 1 historical data only. Normal fuel spend is sourced from fuel_logs.';

notify pgrst, 'reload schema';

commit;
