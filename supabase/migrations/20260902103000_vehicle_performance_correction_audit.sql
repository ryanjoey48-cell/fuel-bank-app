create table if not exists public.vehicle_performance_correction_audit (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  vehicle_monthly_performance_id uuid references public.vehicle_monthly_performance(id) on delete set null,
  year integer not null check (year between 2000 and 2100),
  month integer not null check (month between 1 and 12),
  vehicle_registration text not null check (length(btrim(vehicle_registration)) > 0),
  field_name text not null check (field_name in ('gross_revenue', 'salary_cost', 'trip_income', 'other_expenses', 'lpg_cost')),
  old_value numeric(12, 2),
  new_value numeric(12, 2),
  reason text,
  corrected_by text,
  corrected_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists vehicle_performance_correction_audit_period_idx
  on public.vehicle_performance_correction_audit (
    user_id,
    year,
    month,
    lower(btrim(vehicle_registration))
  );

create index if not exists vehicle_performance_correction_audit_record_idx
  on public.vehicle_performance_correction_audit (vehicle_monthly_performance_id);

alter table public.vehicle_performance_correction_audit enable row level security;

drop policy if exists "vehicle_performance_correction_audit_select_own"
  on public.vehicle_performance_correction_audit;
create policy "vehicle_performance_correction_audit_select_own"
on public.vehicle_performance_correction_audit
for select to authenticated
using (user_id = auth.uid());

drop policy if exists "vehicle_performance_correction_audit_insert_own"
  on public.vehicle_performance_correction_audit;
create policy "vehicle_performance_correction_audit_insert_own"
on public.vehicle_performance_correction_audit
for insert to authenticated
with check (user_id = auth.uid());

comment on table public.vehicle_performance_correction_audit is
  'Field-level audit entries for Vehicle Performance import correction edits.';
