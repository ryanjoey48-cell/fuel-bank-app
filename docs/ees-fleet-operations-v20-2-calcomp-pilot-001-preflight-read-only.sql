-- READ ONLY preflight for CAL-COMP Pilot 001 / V20.2 staging.
-- Run in Supabase SQL Editor. Changes nothing.
-- See also: docs/ees-fleet-operations-v20-2-location-activation-strategy.md

select current_database() as database_name, current_user, session_user, now() as checked_at;

-- Directory vs fleet soft-disable: verification_status already exists; is_active is additive in V20.
select
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'ees_locations' and column_name = 'verification_status'
  ) as has_verification_status,
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'ees_locations' and column_name = 'is_active'
  ) as has_is_active,
  (
    select count(*)::integer from public.ees_locations where company_name = 'CAL-COMP'
  ) as calcomp_rows;

-- Map pins present; truck_entrance_url is optional and must NOT gate pilots.
select
  to_regclass('public.ees_location_map_pins') as map_pins_table,
  to_regclass('public.ees_location_map_pin_history') as map_pin_history_table,
  (
    select count(*)::integer from public.ees_location_map_pins
  ) as pin_count,
  (
    select count(*)::integer
    from public.ees_locations
    where company_name = 'CAL-COMP' and truck_entrance_url is not null
  ) as calcomp_with_truck_entrance_url;

-- Designed history grants: service_role has NO table SELECT; authenticated may SELECT.
-- A service_role REST 42501 is expected, not a schema defect.
select
  has_table_privilege('service_role', 'public.ees_location_map_pins', 'select') as service_can_select_pins,
  has_table_privilege('service_role', 'public.ees_location_map_pin_history', 'select') as service_can_select_history_expected_false,
  has_table_privilege('authenticated', 'public.ees_location_map_pin_history', 'select') as authenticated_can_select_history,
  has_table_privilege('ees_locations_map_pin_auditor', 'public.ees_location_map_pin_history', 'insert')
    as auditor_can_insert_history
where to_regclass('public.ees_location_map_pin_history') is not null;

-- V20 / V20.2 / Forth import presence (expect false until owner-approved apply).
select
  to_regclass('public.ees_fleet_geofence_zones') as zones,
  to_regclass('public.ees_fleet_visit_events') as visit_events,
  to_regclass('public.ees_fleet_notification_outbox') as outbox,
  to_regclass('public.ees_forth_location_links') as forth_links,
  to_regclass('public.ees_fleet_monitor_lease') as monitor_lease,
  to_regprocedure('public.set_ees_fleet_geofence_zone(uuid,integer,integer,integer,integer,boolean,uuid,text)') as set_zone_rpc,
  to_regprocedure('public.commit_ees_fleet_geofence_transition(text,bigint,jsonb,jsonb)') as transition_rpc,
  to_regprocedure('public.commit_ees_fleet_event_review(text,text,uuid,text,uuid,uuid,text)') as review_rpc,
  to_regprocedure('public.enqueue_ees_fleet_notification_outbox(text,text,text,text,text,text,text,text,text,boolean)') as outbox_rpc;

-- CAL-COMP Directory snapshot (identity only; no pin rewrite).
select id, company_name, address, verification_status, verified_at,
       truck_entrance_url is not null as has_truck_entrance_url,
       source_info
from public.ees_locations
where company_name = 'CAL-COMP'
order by updated_at desc;
