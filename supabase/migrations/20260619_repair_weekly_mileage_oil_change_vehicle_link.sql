-- Repair a known stale oil-change vehicle registration used by test data.
-- This is intentionally narrow: it only re-keys 12345 to 701-5145 when
-- weekly_mileage already contains the real 701-5145 vehicle.

do $$
declare
  has_real_weekly_vehicle boolean;
  has_real_baseline boolean;
  has_real_vehicle boolean;
  latest_real_odometer numeric;
begin
  select exists (
    select 1
    from public.weekly_mileage
    where upper(replace(replace(btrim(coalesce(vehicle_reg, '')), '-', ''), ' ', '')) = '7015145'
  )
  into has_real_weekly_vehicle;

  if not has_real_weekly_vehicle then
    return;
  end if;

  select coalesce(odometer_reading, mileage)
  from public.weekly_mileage
  where upper(replace(replace(btrim(coalesce(vehicle_reg, '')), '-', ''), ' ', '')) = '7015145'
  order by week_ending desc nulls last, created_at desc nulls last, id desc
  limit 1
  into latest_real_odometer;

  if to_regclass('public.oil_change_baselines') is not null then
    select exists (
      select 1
      from public.oil_change_baselines
      where upper(replace(replace(btrim(coalesce(vehicle_reg, '')), '-', ''), ' ', '')) = '7015145'
    )
    into has_real_baseline;

    if not has_real_baseline then
      update public.oil_change_baselines
      set
        vehicle_reg = '701-5145',
        last_odometer = case
          when latest_real_odometer is not null and (last_odometer is null or last_odometer < 100000)
            then latest_real_odometer
          else last_odometer
        end,
        interval_km = 30000,
        updated_at = now()
      where upper(replace(replace(btrim(coalesce(vehicle_reg, '')), '-', ''), ' ', '')) = '12345';
    end if;
  end if;

  if to_regclass('public.vehicle_service_logs') is not null then
    update public.vehicle_service_logs
    set
      vehicle_reg = '701-5145',
      odometer = case
        when latest_real_odometer is not null and (odometer is null or odometer < 100000)
          then latest_real_odometer
        else odometer
      end,
      oil_change_odometer = case
        when latest_real_odometer is not null and (oil_change_odometer is null or oil_change_odometer < 100000)
          then latest_real_odometer
        else oil_change_odometer
      end,
      vehicle_type_snapshot = coalesce(nullif(vehicle_type_snapshot, ''), 'EIGHTEEN_WHEELER'),
      interval_km = coalesce(interval_km, 30000),
      next_service_due_odometer = case
        when latest_real_odometer is not null and (next_service_due_odometer is null or next_service_due_odometer < 100000)
          then latest_real_odometer + 30000
        else coalesce(next_service_due_odometer, coalesce(oil_change_odometer, odometer) + 30000)
      end
    where upper(replace(replace(btrim(coalesce(vehicle_reg, '')), '-', ''), ' ', '')) = '12345';
  end if;

  if to_regclass('public.oil_change_history') is not null then
    update public.oil_change_history
    set
      vehicle_reg = '701-5145',
      odometer = case
        when latest_real_odometer is not null and (odometer is null or odometer < 100000)
          then latest_real_odometer
        else odometer
      end
    where upper(replace(replace(btrim(coalesce(vehicle_reg, '')), '-', ''), ' ', '')) = '12345';
  end if;

  select exists (
    select 1
    from public.vehicles
    where upper(replace(replace(btrim(coalesce(vehicle_reg, '')), '-', ''), ' ', '')) = '7015145'
  )
  into has_real_vehicle;

  if not has_real_vehicle then
    update public.vehicles
    set
      vehicle_reg = '701-5145',
      vehicle_name = coalesce(nullif(vehicle_name, ''), '701-5145'),
      vehicle_type = coalesce(nullif(vehicle_type, ''), 'EIGHTEEN_WHEELER'),
      oil_change_interval_km = coalesce(oil_change_interval_km, 30000),
      active = true,
      updated_at = now()
    where upper(replace(replace(btrim(coalesce(vehicle_reg, '')), '-', ''), ' ', '')) = '12345';
  end if;

  update public.vehicles
  set
    vehicle_type = coalesce(nullif(vehicle_type, ''), 'EIGHTEEN_WHEELER'),
    oil_change_interval_km = coalesce(oil_change_interval_km, 30000),
    active = true,
    updated_at = now()
  where upper(replace(replace(btrim(coalesce(vehicle_reg, '')), '-', ''), ' ', '')) = '7015145';

  update public.drivers
  set
    vehicle_reg = '701-5145',
    vehicle_type = coalesce(nullif(vehicle_type, ''), 'EIGHTEEN_WHEELER')
  where lower(btrim(coalesce(name, ''))) = 'ede new'
     or upper(replace(replace(btrim(coalesce(vehicle_reg, '')), '-', ''), ' ', '')) = '7015145';
end $$;
