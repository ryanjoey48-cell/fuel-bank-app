-- Read-only checks for after an owner-approved installation. Never changes data.
select c.relname as table_name, c.relrowsecurity as row_security
from pg_class c
where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname like 'ees_fleet_%'
order by c.relname;

select location_id, active, radius_meters, entry_dwell_seconds, exit_dwell_seconds
from public.ees_fleet_geofence_zones order by location_id;
select count(*) filter (where is_active) as active_directory_records,
  count(*) filter (where not is_active) as inactive_directory_records from public.ees_locations;

select count(*) as state_rows from public.ees_fleet_vehicle_geofence_state;
select id, expires_at from public.ees_fleet_monitor_lease;
select count(*) as visit_events from public.ees_fleet_visit_events;
select count(*) as subscriptions from public.ees_fleet_push_subscriptions;

select grantee, privilege_type from information_schema.role_routine_grants
where routine_schema = 'public' and routine_name = 'commit_ees_fleet_geofence_transition'
order by grantee, privilege_type;
