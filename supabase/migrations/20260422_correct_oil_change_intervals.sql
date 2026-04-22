begin;

update public.vehicles
set oil_change_interval_km = 30000
where vehicle_type in ('SIX_WHEEL_TRUCK', 'SIX_PLUS_SIX_WHEELER')
  and oil_change_interval_km = 10000;

update public.vehicle_service_logs logs
set interval_km = 30000
where logs.interval_km = 10000
  and (
    logs.vehicle_type_snapshot in ('SIX_WHEEL_TRUCK', 'SIX_PLUS_SIX_WHEELER')
    or exists (
      select 1
      from public.vehicles vehicles
      where vehicles.id = logs.vehicle_id
        and vehicles.vehicle_type in ('SIX_WHEEL_TRUCK', 'SIX_PLUS_SIX_WHEELER')
    )
    or exists (
      select 1
      from public.vehicles vehicles
      where lower(btrim(vehicles.vehicle_reg)) = lower(btrim(logs.vehicle_reg))
        and vehicles.vehicle_type in ('SIX_WHEEL_TRUCK', 'SIX_PLUS_SIX_WHEELER')
    )
  );

commit;
