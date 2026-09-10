begin;

create or replace function public.normalize_vehicle_registration_key(value text)
returns text
language sql
immutable
as $$
  select lower(regexp_replace(btrim(coalesce(value, '')), '\s+', ' ', 'g'));
$$;

create table if not exists public.vehicle_registration_aliases (
  id uuid primary key default gen_random_uuid(),
  source_registration text not null check (length(btrim(source_registration)) > 0),
  canonical_registration text not null check (length(btrim(canonical_registration)) > 0),
  source_registration_key text not null unique,
  canonical_registration_key text not null,
  reason text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.vehicle_registration_aliases (
  source_registration,
  canonical_registration,
  source_registration_key,
  canonical_registration_key,
  reason
)
values (
  '100-6659',
  '700-6659',
  public.normalize_vehicle_registration_key('100-6659'),
  public.normalize_vehicle_registration_key('700-6659'),
  'Confirmed historical registration alias for Soh; 700-6659 is the canonical vehicle registration.'
)
on conflict (source_registration_key) do update
set
  source_registration = excluded.source_registration,
  canonical_registration = excluded.canonical_registration,
  canonical_registration_key = excluded.canonical_registration_key,
  reason = excluded.reason,
  updated_at = now();

alter table public.fuel_logs add column if not exists vehicle_id uuid references public.vehicles(id) on delete set null;
alter table public.weekly_mileage add column if not exists vehicle_id uuid references public.vehicles(id) on delete set null;

do $$
declare
  canonical_vehicle_id uuid;
  fuel_conflicts integer := 0;
  weekly_conflicts integer := 0;
begin
  select v.id
  into canonical_vehicle_id
  from public.vehicles v
  where public.normalize_vehicle_registration_key(v.vehicle_reg) = public.normalize_vehicle_registration_key('700-6659')
  order by v.active desc, v.updated_at desc nulls last, v.created_at desc nulls last
  limit 1;

  if canonical_vehicle_id is null then
    raise exception 'Cannot merge 100-6659 because canonical vehicle 700-6659 was not found.';
  end if;

  select count(*)
  into fuel_conflicts
  from public.fuel_logs old_log
  where public.normalize_vehicle_registration_key(old_log.vehicle_reg) = public.normalize_vehicle_registration_key('100-6659')
    and exists (
      select 1
      from public.fuel_logs canonical_log
      where public.normalize_vehicle_registration_key(canonical_log.vehicle_reg) = public.normalize_vehicle_registration_key('700-6659')
        and canonical_log.date = old_log.date
        and canonical_log.driver_id is not distinct from old_log.driver_id
        and canonical_log.odometer is not distinct from old_log.odometer
        and canonical_log.litres is not distinct from old_log.litres
        and canonical_log.total_cost is not distinct from old_log.total_cost
        and canonical_log.price_per_litre is not distinct from old_log.price_per_litre
    );

  select count(*)
  into weekly_conflicts
  from public.weekly_mileage old_row
  where public.normalize_vehicle_registration_key(old_row.vehicle_reg) = public.normalize_vehicle_registration_key('100-6659')
    and exists (
      select 1
      from public.weekly_mileage canonical_row
      where public.normalize_vehicle_registration_key(canonical_row.vehicle_reg) = public.normalize_vehicle_registration_key('700-6659')
        and canonical_row.week_ending = old_row.week_ending
        and canonical_row.driver_id is not distinct from old_row.driver_id
        and canonical_row.odometer_reading is not distinct from old_row.odometer_reading
    );

  if fuel_conflicts > 0 or weekly_conflicts > 0 then
    raise exception 'Merge blocked: % duplicate fuel log conflicts and % duplicate weekly mileage conflicts found.', fuel_conflicts, weekly_conflicts;
  end if;

  update public.fuel_logs
  set
    vehicle_reg = '700-6659',
    vehicle_id = canonical_vehicle_id
  where public.normalize_vehicle_registration_key(vehicle_reg) = public.normalize_vehicle_registration_key('100-6659');

  update public.weekly_mileage
  set
    vehicle_reg = '700-6659',
    vehicle_id = canonical_vehicle_id
  where public.normalize_vehicle_registration_key(vehicle_reg) = public.normalize_vehicle_registration_key('100-6659');
end $$;

commit;
