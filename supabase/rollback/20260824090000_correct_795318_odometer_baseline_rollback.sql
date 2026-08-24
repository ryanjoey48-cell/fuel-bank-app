begin;

update public.weekly_mileage wm
set odometer_reading = v.old_reading,
    is_odometer_baseline = false,
    odometer_note = null
from (
  values
    ('2026-06-07'::date, 941212::bigint),
    ('2026-06-14'::date, 942526::bigint),
    ('2026-06-21'::date, 944352::bigint),
    ('2026-06-28'::date, 947571::bigint),
    ('2026-07-05'::date, 948371::bigint),
    ('2026-07-12'::date, 950278::bigint),
    ('2026-07-19'::date, 951344::bigint),
    ('2026-07-26'::date, 953847::bigint),
    ('2026-08-02'::date, 954809::bigint),
    ('2026-08-09'::date, 956551::bigint),
    ('2026-08-16'::date, 957476::bigint)
) as v(week_ending, old_reading)
where wm.week_ending = v.week_ending
  and regexp_replace(upper(btrim(wm.vehicle_reg)), '[^0-9A-Zก-ฮ]', '', 'g') = '795318';

delete from public.weekly_mileage wm
where wm.week_ending = '2026-08-23'
  and regexp_replace(upper(btrim(wm.vehicle_reg)), '[^0-9A-Zก-ฮ]', '', 'g') = '795318'
  and wm.odometer_reading = 30169
  and wm.odometer_note = 'Inserted by 20260824090000_correct_795318_odometer_baseline.sql.';

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'weekly_mileage'
      and column_name = 'mileage'
  ) then
    execute $sql$
      update public.weekly_mileage wm
      set mileage = v.old_reading
      from (
        values
          ('2026-06-07'::date, 941212::bigint),
          ('2026-06-14'::date, 942526::bigint),
          ('2026-06-21'::date, 944352::bigint),
          ('2026-06-28'::date, 947571::bigint),
          ('2026-07-05'::date, 948371::bigint),
          ('2026-07-12'::date, 950278::bigint),
          ('2026-07-19'::date, 951344::bigint),
          ('2026-07-26'::date, 953847::bigint),
          ('2026-08-02'::date, 954809::bigint),
          ('2026-08-09'::date, 956551::bigint),
          ('2026-08-16'::date, 957476::bigint)
      ) as v(week_ending, old_reading)
      where wm.week_ending = v.week_ending
        and regexp_replace(upper(btrim(wm.vehicle_reg)), '[^0-9A-Zก-ฮ]', '', 'g') = '795318'
    $sql$;
  end if;
end $$;

update public.vehicles v
set last_oil_change_odometer = 925239,
    last_oil_change_date = '2026-02-21',
    oil_change_interval_km = 30000,
    updated_at = now()
where regexp_replace(upper(btrim(v.vehicle_reg)), '[^0-9A-Zก-ฮ]', '', 'g') = '795318';

update public.oil_change_baselines
set last_oil_change_date = '2026-02-21',
    last_odometer = 925239,
    interval_km = 30000,
    updated_at = now()
where regexp_replace(upper(btrim(vehicle_reg)), '[^0-9A-Zก-ฮ]', '', 'g') = '795318';

delete from public.vehicle_service_logs
where regexp_replace(upper(btrim(vehicle_reg)), '[^0-9A-Zก-ฮ]', '', 'g') = '795318'
  and service_type = 'oil_change'
  and service_date = '2026-08-09'
  and odometer = 27591
  and notes = 'Oil change baseline corrected by weekly mileage odometer reset.';

delete from public.oil_change_history
where regexp_replace(upper(btrim(vehicle_reg)), '[^0-9A-Zก-ฮ]', '', 'g') = '795318'
  and oil_change_date = '2026-08-09'
  and odometer = 27591;

commit;
