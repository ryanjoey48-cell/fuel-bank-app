-- REVIEW ONLY. NOT EXECUTED. DO NOT RUN WITHOUT THE OWNER NAMING THIS EXACT TARGET AND CHANGE IN WRITING.
--
-- STAGE 0: remove anonymous (public-key, signed-out) access from the 15 exposed tables, and nothing else.
--
-- TARGET (the ONLY database this is written for)
--   Supabase project ref : hafoaurzfgkkwpvzedvd
--   Project name         : Fuel Tracker App   (region ap-northeast-1, Postgres 17.6)
--   Environment          : CONFIRMED PRODUCTION (repo safety record 2026-10-31; shared by Vercel Production, Preview and the local dev server)
--   NOT the target       : "EES Development" (wpmnjfncaoogssgpqxek). It was unreachable during the preflight and is unverified.
--
-- WHAT IT CHANGES
--   REVOKE ALL from role anon on the 15 tables, and on the 4 ID sequences that anon could use.
-- WHAT IT DOES NOT CHANGE (deliberately)
--   authenticated, service_role, postgres; RLS; policies; functions; default privileges; any data. Signed-in users keep today's access, so this does NOT
--   close the exposure to a self-registered account (sign-ups are open). That is Stage 1.
--
-- AUDITED STARTING STATE (checked 2026-11-06, identical on all 15 tables, no column-level grants, no dependent views, none in a realtime publication):
--   relacl = {postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}
--   sequences bank_transfers_id_seq, drivers_id_seq, fuel_logs_id_seq, weekly_mileage_id_seq: anon=rwU (USAGE, SELECT, UPDATE).
--   (a=INSERT r=SELECT w=UPDATE d=DELETE D=TRUNCATE x=REFERENCES t=TRIGGER m=MAINTAIN)
--
-- SAFETY BUILT IN: section A first ASSERTS that the live permissions are exactly the audited ones (it stops if anything differs), runs the revokes,
-- then ASSERTS the result. The change is one short transaction. Section B restores the audited state exactly and asserts it.
-- Both sections end in ROLLBACK so pasting this file into a console changes nothing. Approval means replacing that line with COMMIT, one section at a time.

-- =====================================================================================================================
-- SECTION A: STAGE 0
-- =====================================================================================================================
begin;
set local lock_timeout = '5s';

do $identity$
begin
  if current_setting('server_version_num')::int < 170000 then raise exception 'unexpected Postgres version: stop'; end if;
  if (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = any(array['bank_transfers', 'drivers', 'fuel_logs', 'oil_change_baselines', 'oil_change_history', 'shipments', 'trip_fuel_logs', 'trip_journeys', 'vehicle_safety_assets', 'vehicle_safety_inspection_items', 'vehicle_safety_inspections', 'vehicle_safety_issues', 'vehicle_safety_requirements', 'vehicles', 'weekly_mileage']) and c.relkind = 'r') <> 15 then
    raise exception 'the 15 tables are not all present: this is not the audited database: stop';
  end if;
  if not exists (select 1 from public.account_access where role = 'admin' and status = 'active') then raise exception 'no active admin in account_access: stop'; end if;
end
$identity$;

do $check$
declare t text; p text; r text; s text; expected boolean;
begin
  foreach t in array array['bank_transfers', 'drivers', 'fuel_logs', 'oil_change_baselines', 'oil_change_history', 'shipments', 'trip_fuel_logs', 'trip_journeys', 'vehicle_safety_assets', 'vehicle_safety_inspection_items', 'vehicle_safety_inspections', 'vehicle_safety_issues', 'vehicle_safety_requirements', 'vehicles', 'weekly_mileage'] loop
    foreach p in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'] loop
      foreach r in array array['anon', 'authenticated', 'service_role'] loop
        expected := (r in ('anon', 'authenticated', 'service_role'));
        if has_table_privilege(r, format('public.%I', t), p) is distinct from expected then
          raise exception 'BEFORE (audited state): % on % for % expected %', p, t, r, expected;
        end if;
      end loop;
    end loop;
  end loop;
  foreach s in array array['bank_transfers_id_seq', 'drivers_id_seq', 'fuel_logs_id_seq', 'weekly_mileage_id_seq'] loop
    foreach p in array array['USAGE', 'SELECT', 'UPDATE'] loop
      if has_sequence_privilege('anon', format('public.%I', s), p) is distinct from true then
        raise exception 'BEFORE (audited state): sequence % privilege % for anon', s, p;
      end if;
    end loop;
  end loop;
end
$check$;

revoke all on table public.bank_transfers from anon;
revoke all on table public.drivers from anon;
revoke all on table public.fuel_logs from anon;
revoke all on table public.oil_change_baselines from anon;
revoke all on table public.oil_change_history from anon;
revoke all on table public.shipments from anon;
revoke all on table public.trip_fuel_logs from anon;
revoke all on table public.trip_journeys from anon;
revoke all on table public.vehicle_safety_assets from anon;
revoke all on table public.vehicle_safety_inspection_items from anon;
revoke all on table public.vehicle_safety_inspections from anon;
revoke all on table public.vehicle_safety_issues from anon;
revoke all on table public.vehicle_safety_requirements from anon;
revoke all on table public.vehicles from anon;
revoke all on table public.weekly_mileage from anon;
revoke all on sequence public.bank_transfers_id_seq from anon;
revoke all on sequence public.drivers_id_seq from anon;
revoke all on sequence public.fuel_logs_id_seq from anon;
revoke all on sequence public.weekly_mileage_id_seq from anon;

do $check$
declare t text; p text; r text; s text; expected boolean;
begin
  foreach t in array array['bank_transfers', 'drivers', 'fuel_logs', 'oil_change_baselines', 'oil_change_history', 'shipments', 'trip_fuel_logs', 'trip_journeys', 'vehicle_safety_assets', 'vehicle_safety_inspection_items', 'vehicle_safety_inspections', 'vehicle_safety_issues', 'vehicle_safety_requirements', 'vehicles', 'weekly_mileage'] loop
    foreach p in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'] loop
      foreach r in array array['anon', 'authenticated', 'service_role'] loop
        expected := (r <> 'anon');
        if has_table_privilege(r, format('public.%I', t), p) is distinct from expected then
          raise exception 'AFTER REVOKE: % on % for % expected %', p, t, r, expected;
        end if;
      end loop;
    end loop;
  end loop;
  foreach s in array array['bank_transfers_id_seq', 'drivers_id_seq', 'fuel_logs_id_seq', 'weekly_mileage_id_seq'] loop
    foreach p in array array['USAGE', 'SELECT', 'UPDATE'] loop
      if has_sequence_privilege('anon', format('public.%I', s), p) is distinct from false then
        raise exception 'AFTER REVOKE: sequence % privilege % for anon', s, p;
      end if;
    end loop;
  end loop;
end
$check$;

-- Post-change validation (outside the database, with the PUBLIC key only, zero rows requested):
--   GET {url}/rest/v1/<table>?select=id&limit=0   apikey: <public key>    -> expect HTTP 401 (permission denied, code 42501); before the change it was 206.
--   Control tables must not change: booking_diary 200 [], clients 200 [], account_access 400, driver_accounts 401.
--   Signed-in office_staff and admin: every page listed in the preflight report still loads.
rollback;  -- REVIEW ONLY. Replace with COMMIT only after written approval of this exact target and change.

-- =====================================================================================================================
-- SECTION B: ROLLBACK (restores the audited starting state exactly; run only if Stage 0 was committed and something real broke)
-- =====================================================================================================================
begin;
set local lock_timeout = '5s';
grant all on table public.bank_transfers to anon;
grant all on table public.drivers to anon;
grant all on table public.fuel_logs to anon;
grant all on table public.oil_change_baselines to anon;
grant all on table public.oil_change_history to anon;
grant all on table public.shipments to anon;
grant all on table public.trip_fuel_logs to anon;
grant all on table public.trip_journeys to anon;
grant all on table public.vehicle_safety_assets to anon;
grant all on table public.vehicle_safety_inspection_items to anon;
grant all on table public.vehicle_safety_inspections to anon;
grant all on table public.vehicle_safety_issues to anon;
grant all on table public.vehicle_safety_requirements to anon;
grant all on table public.vehicles to anon;
grant all on table public.weekly_mileage to anon;
grant usage, select, update on sequence public.bank_transfers_id_seq to anon;
grant usage, select, update on sequence public.drivers_id_seq to anon;
grant usage, select, update on sequence public.fuel_logs_id_seq to anon;
grant usage, select, update on sequence public.weekly_mileage_id_seq to anon;

do $check$
declare t text; p text; r text; s text; expected boolean;
begin
  foreach t in array array['bank_transfers', 'drivers', 'fuel_logs', 'oil_change_baselines', 'oil_change_history', 'shipments', 'trip_fuel_logs', 'trip_journeys', 'vehicle_safety_assets', 'vehicle_safety_inspection_items', 'vehicle_safety_inspections', 'vehicle_safety_issues', 'vehicle_safety_requirements', 'vehicles', 'weekly_mileage'] loop
    foreach p in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'] loop
      foreach r in array array['anon', 'authenticated', 'service_role'] loop
        expected := (r in ('anon', 'authenticated', 'service_role'));
        if has_table_privilege(r, format('public.%I', t), p) is distinct from expected then
          raise exception 'AFTER ROLLBACK (audited state restored): % on % for % expected %', p, t, r, expected;
        end if;
      end loop;
    end loop;
  end loop;
  foreach s in array array['bank_transfers_id_seq', 'drivers_id_seq', 'fuel_logs_id_seq', 'weekly_mileage_id_seq'] loop
    foreach p in array array['USAGE', 'SELECT', 'UPDATE'] loop
      if has_sequence_privilege('anon', format('public.%I', s), p) is distinct from true then
        raise exception 'AFTER ROLLBACK (audited state restored): sequence % privilege % for anon', s, p;
      end if;
    end loop;
  end loop;
end
$check$;

-- Note: re-granting appends the anon entry at the end of each ACL array, so the array ORDER may differ from the audited text while the privileges are identical.
-- The assertion above compares privileges, not text. Run as the role that originally granted them (postgres) so the grantor is unchanged.
rollback;  -- REVIEW ONLY. Replace with COMMIT only if a rollback is actually needed and approved.
