alter table public.vehicle_service_logs
  add column if not exists oil_change_odometer numeric(12, 2);

with four_wheeler_vehicles as (
  select id, vehicle_reg
  from public.vehicles
  where lower(btrim(coalesce(vehicle_type, ''))) in (
    'four_wheel_truck',
    'four wheel truck',
    '4 wheeler',
    '4 wheel',
    '4 wheel truck',
    '4-wheel truck'
  )
)
update public.vehicles v
set oil_change_interval_km = 10000
from four_wheeler_vehicles fw
where v.id = fw.id
  and (
    v.oil_change_interval_km is null
    or v.oil_change_interval_km = 8000
  );

with four_wheeler_vehicles as (
  select vehicle_reg
  from public.vehicles
  where lower(btrim(coalesce(vehicle_type, ''))) in (
    'four_wheel_truck',
    'four wheel truck',
    '4 wheeler',
    '4 wheel',
    '4 wheel truck',
    '4-wheel truck'
  )
)
update public.oil_change_baselines b
set interval_km = 10000
from four_wheeler_vehicles fw
where lower(btrim(b.vehicle_reg)) = lower(btrim(fw.vehicle_reg))
  and (
    b.interval_km is null
    or b.interval_km = 8000
  );

with ranked_logs as (
  select
    logs.id,
    row_number() over (
      partition by lower(btrim(logs.vehicle_reg))
      order by logs.service_date desc nulls last, logs.created_at desc nulls last, logs.id desc
    ) as rank
  from public.vehicle_service_logs logs
  left join public.vehicles v
    on lower(btrim(v.vehicle_reg)) = lower(btrim(logs.vehicle_reg))
  where coalesce(logs.service_type, 'oil_change') = 'oil_change'
    and logs.interval_km = 8000
    and (
      lower(btrim(coalesce(logs.vehicle_type_snapshot, ''))) in (
        'four_wheel_truck',
        'four wheel truck',
        '4 wheeler',
        '4 wheel',
        '4 wheel truck',
        '4-wheel truck'
      )
      or lower(btrim(coalesce(v.vehicle_type, ''))) in (
        'four_wheel_truck',
        'four wheel truck',
        '4 wheeler',
        '4 wheel',
        '4 wheel truck',
        '4-wheel truck'
      )
    )
)
update public.vehicle_service_logs logs
set
  interval_km = 10000,
  next_service_due_odometer = coalesce(logs.oil_change_odometer, logs.odometer) + 10000
from ranked_logs ranked
where logs.id = ranked.id
  and ranked.rank = 1;

notify pgrst, 'reload schema';
