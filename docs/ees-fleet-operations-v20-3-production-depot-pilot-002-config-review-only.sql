-- EES V20.3 — production Lorry Depot (Pilot 002) configuration — REVIEW ONLY
-- DO NOT APPLY until: (1) restore drill PASS, (2) production SQL package approved & installed,
-- (3) separate owner approval for depot geofence configuration.
--
-- Production: hafoaurzfgkkwpvzedvd
-- Development (do not use): wpmnjfncaoogssgpqxek
--
-- Owner-confirmed identities:
--   EES Office Forth 1708908 @ 13.763182,100.753118 — NOT the lorry depot; exclude from this pilot.
--   EES Lorry Depot Forth 1977073
--     Forth pin: 13.768732,100.766033
--     Owner Maps: 13.7688008,100.7657385
--     Provisional zone: 120 m radius, 60 s entry/exit dwell, 25 m hysteresis
--
-- Staging used synthetic UUID cccccccc-dddd-4eee-8fff-000000000002.
-- Production must reuse the EXISTING Directory record (evidence id from staging notes):
--   4e2d87d2-9a59-5b7e-a7ce-61d09b097f75
-- Never copy staging UUIDs into production.

-- Preflight (read-only): confirm directory row and Forth link target exist after import schema is installed.
-- select id, company_name, verification_status, is_active
-- from public.ees_locations
-- where id = '4e2d87d2-9a59-5b7e-a7ce-61d09b097f75';

-- After V20 + Forth import SQL are installed, proposed additive steps (NOT executed here):
-- 1) Upsert Forth link 1977073 -> production location id (matched, preserve Forth coords).
-- 2) Confirm destination map pin (prefer owner Maps coords or Forth pin per owner choice at apply time).
-- 3) Upsert geofence zone inactive first (120/60/60/25), then activate only with separate approval.
-- 4) Audit history row with reason referencing Pilot 002 production cutover.
-- 5) NEVER activate monitoring worker or write visit events without further approval.

-- Intentionally empty of executable DML/DDL in this review-only file.
select 'ees-v20-3-production-depot-pilot-002-config-review-only' as review_marker;
