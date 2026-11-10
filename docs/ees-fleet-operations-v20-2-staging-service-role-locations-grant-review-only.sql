-- REVIEW ONLY. Staging greenfield grant discovered during V20.2 install on wpmnjfncaoogssgpqxek.
-- Do NOT apply on production (hafoaurzfgkkwpvzedvd) without separate approval.
--
-- The Locations Directory migration grants DML to authenticated only.
-- Map-pins preflight and Fleet service-role APIs require service_role SELECT/INSERT/UPDATE/DELETE
-- on ees_locations (and activity) before docs/ees-locations-map-pins-review-only.sql can apply.
-- Idempotent.

begin;

grant select, insert, update, delete
  on public.ees_locations, public.ees_location_user_activity
  to service_role;

commit;
