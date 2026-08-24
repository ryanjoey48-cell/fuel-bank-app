begin;

alter table public.weekly_mileage
  add column if not exists is_odometer_baseline boolean not null default false,
  add column if not exists odometer_note text;

do $$
declare
  expected_count integer;
  actual_count integer;
  mismatch_details text;
  source_driver_id uuid;
  source_user_id uuid;
  source_vehicle_id uuid;
begin
  create temporary table expected_795318_readings (
    week_ending date primary key,
    old_reading bigint not null,
    new_reading bigint not null
  ) on commit drop;

  insert into expected_795318_readings (week_ending, old_reading, new_reading)
  values
    ('2026-06-07', 941212, 8017),
    ('2026-06-14', 942526, 9749),
    ('2026-06-21', 944352, 12035),
    ('2026-06-28', 947571, 16009),
    ('2026-07-05', 948371, 17812),
    ('2026-07-12', 950278, 19343),
    ('2026-07-19', 951344, 20695),
    ('2026-07-26', 953847, 23934),
    ('2026-08-02', 954809, 25237),
    ('2026-08-09', 956551, 27591),
    ('2026-08-16', 957476, 29056);

  select count(*) into expected_count from expected_795318_readings;

  select count(*) into actual_count
  from public.weekly_mileage wm
  join expected_795318_readings e on e.week_ending = wm.week_ending
  where regexp_replace(upper(btrim(wm.vehicle_reg)), '[^0-9A-Zก-ฮ]', '', 'g') = '795318';

  if actual_count <> expected_count then
    raise exception '79-5318 safety check failed: expected % matching weekly rows for 2026-06-07 through 2026-08-16, found %',
      expected_count, actual_count;
  end if;

  select string_agg(format('%s expected %s found %s', e.week_ending, e.old_reading, wm.odometer_reading), '; ' order by e.week_ending)
    into mismatch_details
  from expected_795318_readings e
  join public.weekly_mileage wm on wm.week_ending = e.week_ending
  where regexp_replace(upper(btrim(wm.vehicle_reg)), '[^0-9A-Zก-ฮ]', '', 'g') = '795318'
    and wm.odometer_reading is distinct from e.old_reading;

  if mismatch_details is not null then
    raise exception '79-5318 safety check failed: %', mismatch_details;
  end if;

  select wm.driver_id, wm.user_id
    into source_driver_id, source_user_id
  from public.weekly_mileage wm
  where regexp_replace(upper(btrim(wm.vehicle_reg)), '[^0-9A-Zก-ฮ]', '', 'g') = '795318'
    and wm.week_ending = '2026-08-16'
    and wm.odometer_reading = 957476
  order by wm.created_at desc, wm.id desc
  limit 1;

  if source_driver_id is null or source_user_id is null then
    raise exception '79-5318 safety check failed: could not identify driver/user from 2026-08-16 row';
  end if;

  select v.id
    into source_vehicle_id
  from public.vehicles v
  where regexp_replace(upper(btrim(v.vehicle_reg)), '[^0-9A-Zก-ฮ]', '', 'g') = '795318'
  order by v.created_at desc, v.id desc
  limit 1;

  update public.weekly_mileage wm
  set odometer_reading = e.new_reading,
      is_odometer_baseline = (e.week_ending = date '2026-06-07'),
      odometer_note = case
        when e.week_ending = date '2026-06-07' then 'New odometer baseline for 79-5318. Legacy readings before 2026-06-07 retained as audit history.'
        when e.week_ending = date '2026-08-09' then 'Oil change at corrected odometer 27591.'
        else null
      end
  from expected_795318_readings e
  where wm.week_ending = e.week_ending
    and regexp_replace(upper(btrim(wm.vehicle_reg)), '[^0-9A-Zก-ฮ]', '', 'g') = '795318';

  if not exists (
    select 1 from public.weekly_mileage wm
    where wm.week_ending = '2026-08-23'
      and regexp_replace(upper(btrim(wm.vehicle_reg)), '[^0-9A-Zก-ฮ]', '', 'g') = '795318'
  ) then
    insert into public.weekly_mileage (
      user_id,
      driver_id,
      week_ending,
      vehicle_reg,
      odometer_reading,
      is_odometer_baseline,
      odometer_note
    )
    values (
      source_user_id,
      source_driver_id,
      '2026-08-23',
      '79-5318',
      30169,
      false,
      'Inserted by 20260824090000_correct_795318_odometer_baseline.sql.'
    );
  end if;

  update public.weekly_mileage wm
  set odometer_reading = 30169,
      is_odometer_baseline = false,
      odometer_note = coalesce(nullif(wm.odometer_note, ''), 'Corrected 79-5318 reading for 2026-08-23.')
  where wm.week_ending = '2026-08-23'
    and regexp_replace(upper(btrim(wm.vehicle_reg)), '[^0-9A-Zก-ฮ]', '', 'g') = '795318';

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'weekly_mileage'
      and column_name = 'mileage'
  ) then
    execute $sql$
      update public.weekly_mileage wm
      set mileage = coalesce(e.new_reading, 30169)
      from (
        select week_ending, new_reading from expected_795318_readings
        union all
        select '2026-08-23'::date, 30169::bigint
      ) e
      where wm.week_ending = e.week_ending
        and regexp_replace(upper(btrim(wm.vehicle_reg)), '[^0-9A-Zก-ฮ]', '', 'g') = '795318'
    $sql$;
  end if;

  update public.vehicles v
  set vehicle_type = 'EIGHTEEN_WHEELER',
      last_oil_change_odometer = 27591,
      last_oil_change_date = '2026-08-09',
      oil_change_interval_km = 30000,
      updated_at = now()
  where regexp_replace(upper(btrim(v.vehicle_reg)), '[^0-9A-Zก-ฮ]', '', 'g') = '795318';

  insert into public.vehicle_service_logs (
    user_id,
    vehicle_id,
    vehicle_reg,
    service_type,
    service_date,
    odometer,
    oil_change_odometer,
    interval_km,
    next_service_due_odometer,
    vehicle_type_snapshot,
    notes
  )
  select source_user_id,
         source_vehicle_id,
         '79-5318',
         'oil_change',
         '2026-08-09',
         27591,
         27591,
         30000,
         57591,
         'EIGHTEEN_WHEELER',
         'Oil change baseline corrected by weekly mileage odometer reset.'
  where not exists (
    select 1 from public.vehicle_service_logs vsl
    where regexp_replace(upper(btrim(vsl.vehicle_reg)), '[^0-9A-Zก-ฮ]', '', 'g') = '795318'
      and vsl.service_type = 'oil_change'
      and vsl.service_date = '2026-08-09'
      and vsl.odometer = 27591
  );

  insert into public.oil_change_history (vehicle_reg, oil_change_date, odometer)
  select '79-5318', '2026-08-09', 27591
  where not exists (
    select 1 from public.oil_change_history och
    where regexp_replace(upper(btrim(och.vehicle_reg)), '[^0-9A-Zก-ฮ]', '', 'g') = '795318'
      and och.oil_change_date = '2026-08-09'
      and och.odometer = 27591
  );

  update public.oil_change_baselines
  set last_oil_change_date = '2026-08-09',
      last_odometer = 27591,
      interval_km = 30000,
      updated_at = now()
  where regexp_replace(upper(btrim(vehicle_reg)), '[^0-9A-Zก-ฮ]', '', 'g') = '795318';

  insert into public.oil_change_baselines (vehicle_reg, last_oil_change_date, last_odometer, interval_km)
  select '79-5318', '2026-08-09', 27591, 30000
  where not exists (
    select 1
    from public.oil_change_baselines
    where regexp_replace(upper(btrim(vehicle_reg)), '[^0-9A-Zก-ฮ]', '', 'g') = '795318'
  );
end $$;

commit;
