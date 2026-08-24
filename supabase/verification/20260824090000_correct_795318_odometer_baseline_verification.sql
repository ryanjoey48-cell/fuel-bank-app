with expected_readings(week_ending, expected_odometer, expected_baseline) as (
  values
    ('2026-06-07'::date, 8017::bigint, true),
    ('2026-06-14'::date, 9749::bigint, false),
    ('2026-06-21'::date, 12035::bigint, false),
    ('2026-06-28'::date, 16009::bigint, false),
    ('2026-07-05'::date, 17812::bigint, false),
    ('2026-07-12'::date, 19343::bigint, false),
    ('2026-07-19'::date, 20695::bigint, false),
    ('2026-07-26'::date, 23934::bigint, false),
    ('2026-08-02'::date, 25237::bigint, false),
    ('2026-08-09'::date, 27591::bigint, false),
    ('2026-08-16'::date, 29056::bigint, false),
    ('2026-08-23'::date, 30169::bigint, false)
),
weekly_checks as (
  select e.week_ending,
         e.expected_odometer,
         wm.odometer_reading as actual_odometer,
         e.expected_baseline,
         coalesce(wm.is_odometer_baseline, false) as actual_baseline,
         wm.odometer_note,
         case
           when wm.id is null then false
           when wm.odometer_reading is distinct from e.expected_odometer then false
           when coalesce(wm.is_odometer_baseline, false) is distinct from e.expected_baseline then false
           else true
         end as ok
  from expected_readings e
  left join public.weekly_mileage wm
    on wm.week_ending = e.week_ending
   and regexp_replace(upper(btrim(wm.vehicle_reg)), '[^0-9A-Zก-ฮ]', '', 'g') = '795318'
),
oil_checks as (
  select 'vehicle_oil_baseline' as check_name,
         (v.last_oil_change_date = '2026-08-09'
          and v.last_oil_change_odometer = 27591
          and v.oil_change_interval_km = 30000
          and (27591 + 30000) = 57591) as ok,
         jsonb_build_object(
           'last_oil_change_date', v.last_oil_change_date,
           'last_oil_change_odometer', v.last_oil_change_odometer,
           'interval', v.oil_change_interval_km,
           'next_due', v.last_oil_change_odometer + v.oil_change_interval_km
         ) as details
  from public.vehicles v
  where regexp_replace(upper(btrim(v.vehicle_reg)), '[^0-9A-Zก-ฮ]', '', 'g') = '795318'
  union all
  select 'oil_service_usage_2026_08_23',
         ((30169 - 27591) = 2578 and (57591 - 30169) = 27422),
         jsonb_build_object('used', 30169 - 27591, 'remaining', 57591 - 30169)
  union all
  select 'oil_service_log_2026_08_09',
         exists (
           select 1 from public.vehicle_service_logs vsl
           where regexp_replace(upper(btrim(vsl.vehicle_reg)), '[^0-9A-Zก-ฮ]', '', 'g') = '795318'
             and vsl.service_type = 'oil_change'
             and vsl.service_date = '2026-08-09'
             and vsl.odometer = 27591
             and vsl.interval_km = 30000
             and vsl.next_service_due_odometer = 57591
         ),
         jsonb_build_object('expected_service_date', '2026-08-09', 'expected_odometer', 27591, 'expected_next_due', 57591)
  union all
  select 'previous_2026_02_21_history_retained',
         exists (
           select 1 from public.vehicle_service_logs vsl
           where regexp_replace(upper(btrim(vsl.vehicle_reg)), '[^0-9A-Zก-ฮ]', '', 'g') = '795318'
             and vsl.service_date = '2026-02-21'
             and vsl.odometer = 925239
         ) or exists (
           select 1 from public.oil_change_history och
           where regexp_replace(upper(btrim(och.vehicle_reg)), '[^0-9A-Zก-ฮ]', '', 'g') = '795318'
             and och.oil_change_date = '2026-02-21'
             and och.odometer = 925239
         ),
         jsonb_build_object('expected_date', '2026-02-21', 'expected_odometer', 925239)
)
select 'weekly_mileage_' || week_ending as check_name,
       ok,
       jsonb_build_object(
         'expected_odometer', expected_odometer,
         'actual_odometer', actual_odometer,
         'expected_baseline', expected_baseline,
         'actual_baseline', actual_baseline,
         'note', odometer_note
       ) as details
from weekly_checks
union all
select check_name, ok, details
from oil_checks
order by check_name;
