-- REVIEW ONLY rollback for Forth locations import storage.
begin;
drop table if exists public.ees_fleet_geofence_pilot_sites;
drop table if exists public.ees_forth_location_import_audit;
drop table if exists public.ees_forth_location_links;
commit;
