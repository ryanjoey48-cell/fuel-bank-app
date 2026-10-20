-- READ ONLY: review in Supabase SQL Editor. This script changes no data or policies.
-- Identify the reported constraint and all actual uniqueness rules.
select conname, pg_get_constraintdef(oid) as definition
from pg_constraint where conrelid = 'public.vehicle_service_logs'::regclass;
select indexname, indexdef from pg_indexes
where schemaname = 'public' and tablename = 'vehicle_service_logs';
-- Inspect defaults and existing authenticated access. Service-role reads cannot prove driver/staff RLS access.
select column_name, data_type, column_default from information_schema.columns
where table_schema = 'public' and table_name = 'vehicle_service_logs';
select tablename, policyname, roles, cmd, qual, with_check from pg_policies
where schemaname = 'public' and tablename in ('vehicle_service_logs','oil_change_history','oil_change_baselines','vehicles');
select relname, relrowsecurity, relforcerowsecurity from pg_class
where oid in ('public.vehicle_service_logs'::regclass,'public.vehicles'::regclass);
-- Preserve every entry. These are inspection queries, never deletion commands.
select id, vehicle_reg, service_date, odometer, interval_km, created_at
from public.vehicle_service_logs where vehicle_reg = '3ฒน-9565'
order by service_date desc, created_at desc;
-- No migration is currently required by the confirmed UUID schema.
-- Do not remove the uniqueness constraint or broaden RLS without reviewing these results.
