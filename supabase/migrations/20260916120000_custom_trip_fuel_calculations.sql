create table if not exists public.fuel_efficiency_trip_calculations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete restrict,
  driver_id uuid references public.drivers(id) on delete set null,
  driver text,
  vehicle_reg text not null,
  calculation_start_date date not null,
  calculation_end_date date not null,
  start_mileage_fuel_log_id uuid not null references public.fuel_logs(id) on delete restrict,
  end_mileage_fuel_log_id uuid not null references public.fuel_logs(id) on delete restrict,
  start_mileage numeric(12, 2) not null,
  end_mileage numeric(12, 2) not null,
  calculated_distance numeric(12, 2) not null check (calculated_distance > 0),
  selected_total_litres numeric(12, 2) not null check (selected_total_litres > 0),
  selected_total_fuel_cost numeric(12, 2) not null default 0 check (selected_total_fuel_cost >= 0),
  calculated_km_per_litre numeric(12, 4) not null check (calculated_km_per_litre > 0),
  notes text,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  updated_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (calculation_end_date >= calculation_start_date),
  check (end_mileage > start_mileage)
);

create table if not exists public.fuel_efficiency_trip_calculation_logs (
  calculation_id uuid not null references public.fuel_efficiency_trip_calculations(id) on delete cascade,
  fuel_log_id uuid not null references public.fuel_logs(id) on delete restrict,
  allocation_status text not null check (allocation_status in ('included', 'excluded')),
  exclusion_reason text check (exclusion_reason is null or exclusion_reason in ('different_job', 'before_trip', 'after_trip', 'incorrect_for_calculation', 'other')),
  created_at timestamptz not null default now(),
  primary key (calculation_id, fuel_log_id),
  check (allocation_status = 'excluded' or exclusion_reason is null)
);

create index if not exists fuel_efficiency_trip_calculations_lookup_idx
  on public.fuel_efficiency_trip_calculations (driver_id, vehicle_reg, calculation_start_date, calculation_end_date);
create index if not exists fuel_efficiency_trip_calculation_logs_fuel_idx
  on public.fuel_efficiency_trip_calculation_logs (fuel_log_id, allocation_status);

alter table public.fuel_efficiency_trip_calculations enable row level security;
alter table public.fuel_efficiency_trip_calculation_logs enable row level security;

drop policy if exists fuel_efficiency_trip_calculations_own on public.fuel_efficiency_trip_calculations;
create policy fuel_efficiency_trip_calculations_own on public.fuel_efficiency_trip_calculations
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists fuel_efficiency_trip_calculation_logs_own on public.fuel_efficiency_trip_calculation_logs;
create policy fuel_efficiency_trip_calculation_logs_own on public.fuel_efficiency_trip_calculation_logs
  for all to authenticated
  using (exists (select 1 from public.fuel_efficiency_trip_calculations c where c.id = calculation_id and c.user_id = auth.uid()))
  with check (exists (select 1 from public.fuel_efficiency_trip_calculations c where c.id = calculation_id and c.user_id = auth.uid()));

create or replace function public.save_fuel_efficiency_trip_calculation(
  p_id uuid,
  p_driver_id uuid,
  p_driver text,
  p_vehicle_reg text,
  p_start_mileage_fuel_log_id uuid,
  p_end_mileage_fuel_log_id uuid,
  p_notes text,
  p_allocations jsonb
) returns public.fuel_efficiency_trip_calculations
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_start public.fuel_logs%rowtype;
  v_end public.fuel_logs%rowtype;
  v_start_mileage numeric;
  v_end_mileage numeric;
  v_litres numeric;
  v_cost numeric;
  v_result public.fuel_efficiency_trip_calculations%rowtype;
begin
  select * into strict v_start from public.fuel_logs where id = p_start_mileage_fuel_log_id and user_id = auth.uid();
  select * into strict v_end from public.fuel_logs where id = p_end_mileage_fuel_log_id and user_id = auth.uid();
  v_start_mileage := coalesce(v_start.odometer, 0);
  v_end_mileage := coalesce(v_end.odometer, 0);
  if v_start_mileage <= 0 or v_end_mileage <= v_start_mileage then raise exception 'CUSTOM_TRIP_MILEAGE_INVALID'; end if;
  if v_end.date < v_start.date then raise exception 'CUSTOM_TRIP_DATE_INVALID'; end if;
  if nullif(btrim(p_vehicle_reg), '') is null then raise exception 'CUSTOM_TRIP_VEHICLE_REQUIRED'; end if;

  select coalesce(sum(f.litres), 0), coalesce(sum(f.total_cost), 0)
  into v_litres, v_cost
  from jsonb_to_recordset(coalesce(p_allocations, '[]'::jsonb)) as a(fuel_log_id uuid, allocation_status text, exclusion_reason text)
  join public.fuel_logs f on f.id = a.fuel_log_id and f.user_id = auth.uid()
  where a.allocation_status = 'included';
  if v_litres <= 0 then raise exception 'CUSTOM_TRIP_FUEL_REQUIRED'; end if;

  if p_id is null then
    insert into public.fuel_efficiency_trip_calculations (
      user_id, driver_id, driver, vehicle_reg, calculation_start_date, calculation_end_date,
      start_mileage_fuel_log_id, end_mileage_fuel_log_id, start_mileage, end_mileage,
      calculated_distance, selected_total_litres, selected_total_fuel_cost, calculated_km_per_litre,
      notes, created_by, updated_by
    ) values (
      auth.uid(), p_driver_id, nullif(btrim(p_driver), ''), btrim(p_vehicle_reg), v_start.date, v_end.date,
      v_start.id, v_end.id, v_start_mileage, v_end_mileage,
      v_end_mileage - v_start_mileage, v_litres, v_cost, (v_end_mileage - v_start_mileage) / v_litres,
      nullif(btrim(p_notes), ''), auth.uid(), auth.uid()
    ) returning * into v_result;
  else
    update public.fuel_efficiency_trip_calculations set
      driver_id = p_driver_id, driver = nullif(btrim(p_driver), ''), vehicle_reg = btrim(p_vehicle_reg),
      calculation_start_date = v_start.date, calculation_end_date = v_end.date,
      start_mileage_fuel_log_id = v_start.id, end_mileage_fuel_log_id = v_end.id,
      start_mileage = v_start_mileage, end_mileage = v_end_mileage,
      calculated_distance = v_end_mileage - v_start_mileage,
      selected_total_litres = v_litres, selected_total_fuel_cost = v_cost,
      calculated_km_per_litre = (v_end_mileage - v_start_mileage) / v_litres,
      notes = nullif(btrim(p_notes), ''), updated_by = auth.uid(), updated_at = now()
    where id = p_id and user_id = auth.uid()
    returning * into v_result;
    if not found then raise exception 'CUSTOM_TRIP_CALCULATION_NOT_FOUND'; end if;
    delete from public.fuel_efficiency_trip_calculation_logs where calculation_id = p_id;
  end if;

  insert into public.fuel_efficiency_trip_calculation_logs (calculation_id, fuel_log_id, allocation_status, exclusion_reason)
  select v_result.id, a.fuel_log_id, a.allocation_status,
    case when a.allocation_status = 'excluded' then nullif(a.exclusion_reason, '') else null end
  from jsonb_to_recordset(coalesce(p_allocations, '[]'::jsonb)) as a(fuel_log_id uuid, allocation_status text, exclusion_reason text)
  join public.fuel_logs f on f.id = a.fuel_log_id and f.user_id = auth.uid()
  where a.allocation_status in ('included', 'excluded');

  return v_result;
end;
$$;

grant execute on function public.save_fuel_efficiency_trip_calculation(uuid, uuid, text, text, uuid, uuid, text, jsonb) to authenticated;
notify pgrst, 'reload schema';
