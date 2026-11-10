-- REVIEW ONLY. NOT EXECUTED. DO NOT RUN WITHOUT THE OWNER NAMING THE EXACT TARGET, TABLE GROUP AND CHANGE IN WRITING.
-- STAGE 1 (V4.8 revision, replaces docs/rls-remediation-review-only.sql): office-account row level security for the 15 exposed tables.
-- TARGET: project ref hafoaurzfgkkwpvzedvd ("Fuel Tracker App", CONFIRMED PRODUCTION). Rehearse on a verified Development copy first.
--
-- RELATIONSHIP TO OTHER STAGES
--   Stage 0 (docs/stage0-anon-revoke-review-only.sql) removes anonymous access and should be applied FIRST. This stage closes the signed-in-user exposure.
--   Stage 1b (docs/stage1b-optional-tightening-review-only.sql) holds the optional behaviour-changing tightening. It is deliberately NOT in this file.
--
-- WHAT WAS VERIFIED LIVE FOR THIS REVISION (read-only, 2026-11-06)
--   * Helper functions are owned by postgres, SECURITY DEFINER, with a fixed search_path, and RLS is not FORCED on account_access, so a policy that calls them
--     reads account_access as the owner and cannot recurse. is_office_account() = active account_access row AND NOT an active driver account.
--   * authenticated has EXECUTE on is_office_account() and current_account_role(); anon has no EXECUTE on is_office_account().
--   * account_access and account_access_audit: RLS on, SELECT-only policies, no INSERT/UPDATE/DELETE policy, so a signed-in user cannot promote themselves.
--   * driver_accounts, driver_sessions, driver_access_requests: no grants to anon or authenticated; drivers reach data only through server routes (service role).
--   * driver_portal has no grants on these 15 tables. service_role has BYPASSRLS. Roles live: 2 admin + 2 office_staff (no read_only account exists yet).
--   * The browser only ever SELECTs its own account_access row; every write to it comes from a server route.
--
-- RULES (mirror lib/authorization.ts): read = any active office account (admin, office_staff, read_only). Write = admin or office_staff.
-- Drivers, unregistered accounts, suspended accounts and anonymous callers match no policy, so they see no rows and cannot write.
--
-- CHANGES FROM THE V4.7 DRAFT
--   1. (select ...) wrappers: helpers evaluate once per statement, not once per row (matters on fuel_logs and weekly_mileage).
--   2. Lock-out simulation and an "admin with an active driver account" check before anything changes.
--   3. Tables are grouped for a staged rollout (A, B, C, D) with a validation pause between groups.
--   4. Identity-table hardening moved to its own optional section (1c) with its own approval.
--
-- Everything sits in a transaction that ends in ROLLBACK so pasting it into a console changes nothing.

begin;
set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------------------------------------------------
-- PRE-CHECKS (abort if the authorisation model is not what was audited, or if enabling RLS would lock people out)
-- ---------------------------------------------------------------------------------------------------------------------
do $precheck$
declare writers integer; blocked integer;
begin
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosecdef and p.proname in ('is_office_account', 'current_account_role', 'is_account_active', 'is_account_admin')) <> 4 then
    raise exception 'role helper functions missing or not SECURITY DEFINER: stop';
  end if;
  if not has_function_privilege('authenticated', 'public.is_office_account()', 'EXECUTE') or not has_function_privilege('authenticated', 'public.current_account_role()', 'EXECUTE') then
    raise exception 'authenticated cannot execute the role helpers: every policy would fail: stop';
  end if;
  -- Lock-out simulation: who can still WRITE after this change? (active admin or office_staff who is not an active driver account)
  select count(*) into writers from public.account_access a where a.status = 'active' and a.role in ('admin', 'office_staff')
    and not exists (select 1 from public.driver_accounts d where d.auth_user_id = a.user_id and d.active = true);
  if writers < 1 then raise exception 'no administrator or office_staff would keep write access: stop'; end if;
  if not exists (select 1 from public.account_access a where a.status = 'active' and a.role = 'admin' and not exists (select 1 from public.driver_accounts d where d.auth_user_id = a.user_id and d.active = true)) then
    raise exception 'no administrator would remain an office account (an active driver account excludes them): stop';
  end if;
  -- Anyone with office access AND an active driver account would silently lose access: list the count, require it to be understood.
  select count(*) into blocked from public.account_access a where a.status = 'active' and exists (select 1 from public.driver_accounts d where d.auth_user_id = a.user_id and d.active = true);
  if blocked > 0 then raise exception '% office account(s) also have an active driver account and would lose access: resolve first', blocked; end if;
end
$precheck$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 1a. Remove the inert policies that would otherwise become active. Their intent is replaced by the office-account rules below.
-- ---------------------------------------------------------------------------------------------------------------------
drop policy if exists vehicles_insert_own on public.vehicles;
drop policy if exists vehicles_select_own on public.vehicles;
drop policy if exists vehicles_update_own on public.vehicles;
drop policy if exists oil_change_baselines_delete_authenticated on public.oil_change_baselines;
drop policy if exists oil_change_baselines_insert_authenticated on public.oil_change_baselines;
drop policy if exists oil_change_baselines_select_authenticated on public.oil_change_baselines;
drop policy if exists oil_change_baselines_update_authenticated on public.oil_change_baselines;
drop policy if exists oil_change_history_delete_authenticated on public.oil_change_history;
drop policy if exists oil_change_history_insert_authenticated on public.oil_change_history;
drop policy if exists oil_change_history_select_authenticated on public.oil_change_history;
drop policy if exists oil_change_history_update_authenticated on public.oil_change_history;

-- ---------------------------------------------------------------------------------------------------------------------
-- 1b. Policies, then RLS, group by group. Apply ONE GROUP AT A TIME and validate before the next (see the validation notes at the end).
--     Every policy is TO authenticated; anon has none. Each table block is self-contained and can be run on its own.
-- ---------------------------------------------------------------------------------------------------------------------

-- ===== GROUP A: reference and low-use =====

-- vehicle_safety_requirements
create policy vehicle_safety_requirements_office_select on public.vehicle_safety_requirements for select to authenticated using ((select public.is_office_account()));
create policy vehicle_safety_requirements_office_insert on public.vehicle_safety_requirements for insert to authenticated with check ((select public.is_office_account()) and (select public.current_account_role()) in ('admin', 'office_staff'));
create policy vehicle_safety_requirements_office_update on public.vehicle_safety_requirements for update to authenticated using ((select public.is_office_account()) and (select public.current_account_role()) in ('admin', 'office_staff')) with check ((select public.is_office_account()) and (select public.current_account_role()) in ('admin', 'office_staff'));
create policy vehicle_safety_requirements_office_delete on public.vehicle_safety_requirements for delete to authenticated using ((select public.is_office_account()) and (select public.current_account_role()) in ('admin', 'office_staff'));
alter table public.vehicle_safety_requirements enable row level security;
revoke truncate, references, trigger, maintain on table public.vehicle_safety_requirements from authenticated;

-- vehicle_safety_assets
create policy vehicle_safety_assets_office_select on public.vehicle_safety_assets for select to authenticated using ((select public.is_office_account()));
create policy vehicle_safety_assets_office_insert on public.vehicle_safety_assets for insert to authenticated with check ((select public.is_office_account()) and (select public.current_account_role()) in ('admin', 'office_staff'));
create policy vehicle_safety_assets_office_update on public.vehicle_safety_assets for update to authenticated using ((select public.is_office_account()) and (select public.current_account_role()) in ('admin', 'office_staff')) with check ((select public.is_office_account()) and (select public.current_account_role()) in ('admin', 'office_staff'));
create policy vehicle_safety_assets_office_delete on public.vehicle_safety_assets for delete to authenticated using ((select public.is_office_account()) and (select public.current_account_role()) in ('admin', 'office_staff'));
alter table public.vehicle_safety_assets enable row level security;
revoke truncate, references, trigger, maintain on table public.vehicle_safety_assets from authenticated;

-- trip_fuel_logs
create policy trip_fuel_logs_office_select on public.trip_fuel_logs for select to authenticated using ((select public.is_office_account()));
create policy trip_fuel_logs_office_insert on public.trip_fuel_logs for insert to authenticated with check ((select public.is_office_account()) and (select public.current_account_role()) in ('admin', 'office_staff'));
create policy trip_fuel_logs_office_update on public.trip_fuel_logs for update to authenticated using ((select public.is_office_account()) and (select public.current_account_role()) in ('admin', 'office_staff')) with check ((select public.is_office_account()) and (select public.current_account_role()) in ('admin', 'office_staff'));
create policy trip_fuel_logs_office_delete on public.trip_fuel_logs for delete to authenticated using ((select public.is_office_account()) and (select public.current_account_role()) in ('admin', 'office_staff'));
alter table public.trip_fuel_logs enable row level security;
revoke truncate, references, trigger, maintain on table public.trip_fuel_logs from authenticated;
-- >>> PAUSE: validate group A (office_staff, admin, unregistered, driver, anon) before continuing. <<<

-- ===== GROUP B: maintenance, safety and trips =====

-- oil_change_baselines
create policy oil_change_baselines_office_select on public.oil_change_baselines for select to authenticated using ((select public.is_office_account()));
create policy oil_change_baselines_office_insert on public.oil_change_baselines for insert to authenticated with check ((select public.is_office_account()) and (select public.current_account_role()) in ('admin', 'office_staff'));
create policy oil_change_baselines_office_update on public.oil_change_baselines for update to authenticated using ((select public.is_office_account()) and (select public.current_account_role()) in ('admin', 'office_staff')) with check ((select public.is_office_account()) and (select public.current_account_role()) in ('admin', 'office_staff'));
create policy oil_change_baselines_office_delete on public.oil_change_baselines for delete to authenticated using ((select public.is_office_account()) and (select public.current_account_role()) in ('admin', 'office_staff'));
alter table public.oil_change_baselines enable row level security;
revoke truncate, references, trigger, maintain on table public.oil_change_baselines from authenticated;

-- oil_change_history
create policy oil_change_history_office_select on public.oil_change_history for select to authenticated using ((select public.is_office_account()));
create policy oil_change_history_office_insert on public.oil_change_history for insert to authenticated with check ((select public.is_office_account()) and (select public.current_account_role()) in ('admin', 'office_staff'));
create policy oil_change_history_office_update on public.oil_change_history for update to authenticated using ((select public.is_office_account()) and (select public.current_account_role()) in ('admin', 'office_staff')) with check ((select public.is_office_account()) and (select public.current_account_role()) in ('admin', 'office_staff'));
create policy oil_change_history_office_delete on public.oil_change_history for delete to authenticated using ((select public.is_office_account()) and (select public.current_account_role()) in ('admin', 'office_staff'));
alter table public.oil_change_history enable row level security;
revoke truncate, references, trigger, maintain on table public.oil_change_history from authenticated;

-- vehicle_safety_inspections
create policy vehicle_safety_inspections_office_select on public.vehicle_safety_inspections for select to authenticated using ((select public.is_office_account()));
create policy vehicle_safety_inspections_office_insert on public.vehicle_safety_inspections for insert to authenticated with check ((select public.is_office_account()) and (select public.current_account_role()) in ('admin', 'office_staff'));
create policy vehicle_safety_inspections_office_update on public.vehicle_safety_inspections for update to authenticated using ((select public.is_office_account()) and (select public.current_account_role()) in ('admin', 'office_staff')) with check ((select public.is_office_account()) and (select public.current_account_role()) in ('admin', 'office_staff'));
create policy vehicle_safety_inspections_office_delete on public.vehicle_safety_inspections for delete to authenticated using ((select public.is_office_account()) and (select public.current_account_role()) in ('admin', 'office_staff'));
alter table public.vehicle_safety_inspections enable row level security;
revoke truncate, references, trigger, maintain on table public.vehicle_safety_inspections from authenticated;

-- vehicle_safety_inspection_items
create policy vehicle_safety_inspection_items_office_select on public.vehicle_safety_inspection_items for select to authenticated using ((select public.is_office_account()));
create policy vehicle_safety_inspection_items_office_insert on public.vehicle_safety_inspection_items for insert to authenticated with check ((select public.is_office_account()) and (select public.current_account_role()) in ('admin', 'office_staff'));
create policy vehicle_safety_inspection_items_office_update on public.vehicle_safety_inspection_items for update to authenticated using ((select public.is_office_account()) and (select public.current_account_role()) in ('admin', 'office_staff')) with check ((select public.is_office_account()) and (select public.current_account_role()) in ('admin', 'office_staff'));
create policy vehicle_safety_inspection_items_office_delete on public.vehicle_safety_inspection_items for delete to authenticated using ((select public.is_office_account()) and (select public.current_account_role()) in ('admin', 'office_staff'));
alter table public.vehicle_safety_inspection_items enable row level security;
revoke truncate, references, trigger, maintain on table public.vehicle_safety_inspection_items from authenticated;

-- vehicle_safety_issues
create policy vehicle_safety_issues_office_select on public.vehicle_safety_issues for select to authenticated using ((select public.is_office_account()));
create policy vehicle_safety_issues_office_insert on public.vehicle_safety_issues for insert to authenticated with check ((select public.is_office_account()) and (select public.current_account_role()) in ('admin', 'office_staff'));
create policy vehicle_safety_issues_office_update on public.vehicle_safety_issues for update to authenticated using ((select public.is_office_account()) and (select public.current_account_role()) in ('admin', 'office_staff')) with check ((select public.is_office_account()) and (select public.current_account_role()) in ('admin', 'office_staff'));
create policy vehicle_safety_issues_office_delete on public.vehicle_safety_issues for delete to authenticated using ((select public.is_office_account()) and (select public.current_account_role()) in ('admin', 'office_staff'));
alter table public.vehicle_safety_issues enable row level security;
revoke truncate, references, trigger, maintain on table public.vehicle_safety_issues from authenticated;

-- trip_journeys
create policy trip_journeys_office_select on public.trip_journeys for select to authenticated using ((select public.is_office_account()));
create policy trip_journeys_office_insert on public.trip_journeys for insert to authenticated with check ((select public.is_office_account()) and (select public.current_account_role()) in ('admin', 'office_staff'));
create policy trip_journeys_office_update on public.trip_journeys for update to authenticated using ((select public.is_office_account()) and (select public.current_account_role()) in ('admin', 'office_staff')) with check ((select public.is_office_account()) and (select public.current_account_role()) in ('admin', 'office_staff'));
create policy trip_journeys_office_delete on public.trip_journeys for delete to authenticated using ((select public.is_office_account()) and (select public.current_account_role()) in ('admin', 'office_staff'));
alter table public.trip_journeys enable row level security;
revoke truncate, references, trigger, maintain on table public.trip_journeys from authenticated;
-- >>> PAUSE: validate group B (office_staff, admin, unregistered, driver, anon) before continuing. <<<

-- ===== GROUP C1: vehicles, drivers and weekly mileage (trigger dependency) =====

-- vehicles
create policy vehicles_office_select on public.vehicles for select to authenticated using ((select public.is_office_account()));
create policy vehicles_office_insert on public.vehicles for insert to authenticated with check ((select public.is_office_account()) and (select public.current_account_role()) in ('admin', 'office_staff'));
create policy vehicles_office_update on public.vehicles for update to authenticated using ((select public.is_office_account()) and (select public.current_account_role()) in ('admin', 'office_staff')) with check ((select public.is_office_account()) and (select public.current_account_role()) in ('admin', 'office_staff'));
create policy vehicles_office_delete on public.vehicles for delete to authenticated using ((select public.is_office_account()) and (select public.current_account_role()) in ('admin', 'office_staff'));
alter table public.vehicles enable row level security;
revoke truncate, references, trigger, maintain on table public.vehicles from authenticated;

-- drivers
create policy drivers_office_select on public.drivers for select to authenticated using ((select public.is_office_account()));
create policy drivers_office_insert on public.drivers for insert to authenticated with check ((select public.is_office_account()) and (select public.current_account_role()) in ('admin', 'office_staff'));
create policy drivers_office_update on public.drivers for update to authenticated using ((select public.is_office_account()) and (select public.current_account_role()) in ('admin', 'office_staff')) with check ((select public.is_office_account()) and (select public.current_account_role()) in ('admin', 'office_staff'));
create policy drivers_office_delete on public.drivers for delete to authenticated using ((select public.is_office_account()) and (select public.current_account_role()) in ('admin', 'office_staff'));
alter table public.drivers enable row level security;
revoke truncate, references, trigger, maintain on table public.drivers from authenticated;

-- weekly_mileage
create policy weekly_mileage_office_select on public.weekly_mileage for select to authenticated using ((select public.is_office_account()));
create policy weekly_mileage_office_insert on public.weekly_mileage for insert to authenticated with check ((select public.is_office_account()) and (select public.current_account_role()) in ('admin', 'office_staff'));
create policy weekly_mileage_office_update on public.weekly_mileage for update to authenticated using ((select public.is_office_account()) and (select public.current_account_role()) in ('admin', 'office_staff')) with check ((select public.is_office_account()) and (select public.current_account_role()) in ('admin', 'office_staff'));
create policy weekly_mileage_office_delete on public.weekly_mileage for delete to authenticated using ((select public.is_office_account()) and (select public.current_account_role()) in ('admin', 'office_staff'));
alter table public.weekly_mileage enable row level security;
revoke truncate, references, trigger, maintain on table public.weekly_mileage from authenticated;
-- >>> PAUSE: validate group C1 (office_staff, admin, unregistered, driver, anon) before continuing. <<<

-- ===== GROUP C2: fuel and shipments =====

-- fuel_logs
create policy fuel_logs_office_select on public.fuel_logs for select to authenticated using ((select public.is_office_account()));
create policy fuel_logs_office_insert on public.fuel_logs for insert to authenticated with check ((select public.is_office_account()) and (select public.current_account_role()) in ('admin', 'office_staff'));
create policy fuel_logs_office_update on public.fuel_logs for update to authenticated using ((select public.is_office_account()) and (select public.current_account_role()) in ('admin', 'office_staff')) with check ((select public.is_office_account()) and (select public.current_account_role()) in ('admin', 'office_staff'));
create policy fuel_logs_office_delete on public.fuel_logs for delete to authenticated using ((select public.is_office_account()) and (select public.current_account_role()) in ('admin', 'office_staff'));
alter table public.fuel_logs enable row level security;
revoke truncate, references, trigger, maintain on table public.fuel_logs from authenticated;

-- shipments
create policy shipments_office_select on public.shipments for select to authenticated using ((select public.is_office_account()));
create policy shipments_office_insert on public.shipments for insert to authenticated with check ((select public.is_office_account()) and (select public.current_account_role()) in ('admin', 'office_staff'));
create policy shipments_office_update on public.shipments for update to authenticated using ((select public.is_office_account()) and (select public.current_account_role()) in ('admin', 'office_staff')) with check ((select public.is_office_account()) and (select public.current_account_role()) in ('admin', 'office_staff'));
create policy shipments_office_delete on public.shipments for delete to authenticated using ((select public.is_office_account()) and (select public.current_account_role()) in ('admin', 'office_staff'));
alter table public.shipments enable row level security;
revoke truncate, references, trigger, maintain on table public.shipments from authenticated;
-- >>> PAUSE: validate group C2 (office_staff, admin, unregistered, driver, anon) before continuing. <<<

-- ===== GROUP D: banking data =====

-- bank_transfers
create policy bank_transfers_office_select on public.bank_transfers for select to authenticated using ((select public.is_office_account()));
create policy bank_transfers_office_insert on public.bank_transfers for insert to authenticated with check ((select public.is_office_account()) and (select public.current_account_role()) in ('admin', 'office_staff'));
create policy bank_transfers_office_update on public.bank_transfers for update to authenticated using ((select public.is_office_account()) and (select public.current_account_role()) in ('admin', 'office_staff')) with check ((select public.is_office_account()) and (select public.current_account_role()) in ('admin', 'office_staff'));
create policy bank_transfers_office_delete on public.bank_transfers for delete to authenticated using ((select public.is_office_account()) and (select public.current_account_role()) in ('admin', 'office_staff'));
alter table public.bank_transfers enable row level security;
revoke truncate, references, trigger, maintain on table public.bank_transfers from authenticated;
-- >>> PAUSE: validate group D (office_staff, admin, unregistered, driver, anon) before continuing. <<<

-- ---------------------------------------------------------------------------------------------------------------------
-- 1c. OPTIONAL defence in depth for the identity tables (own approval). Server routes write them with the service role, and the browser only reads its own row.
-- ---------------------------------------------------------------------------------------------------------------------
revoke all on table public.account_access, public.account_access_audit from anon;
revoke insert, update, delete, truncate, references, trigger, maintain on table public.account_access, public.account_access_audit from authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- STAGE 2 (precautionary, own approval): new tables are exposed by default; write RPCs are callable by anon (each already checks the caller).
-- ---------------------------------------------------------------------------------------------------------------------
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role supabase_admin in schema public revoke all on tables from anon;
revoke execute on function public.delete_maintenance_record from anon;
revoke execute on function public.delete_unused_booking_client from anon;
revoke execute on function public.post_inventory_movement from anon;
revoke execute on function public.remember_saved_location from anon;
revoke execute on function public.save_inventory_category from anon;
revoke execute on function public.save_inventory_item from anon;
revoke execute on function public.save_maintenance_record from anon;
revoke execute on function public.save_maintenance_requirement from anon;
revoke execute on function public.save_maintenance_vehicle_checks from anon;
revoke execute on function public.save_vehicle_maintenance_schedule from anon;
revoke execute on function public.save_vehicle_safety_replacement from anon;

-- ---------------------------------------------------------------------------------------------------------------------
-- VALIDATION (per group; see docs/stage1-validation-harness-review-only.sql for a transaction-only harness that needs no real accounts)
--   admin / office_staff : every page that uses the group still loads and saves (Fleet Tracking, Fleet Intelligence Fuel/Journeys tabs, Fuel Logs, Weekly Mileage, Safety, Shipments, vehicles).
--   read_only            : reads work; every insert/update/delete is refused (42501 on insert; update and delete affect 0 rows).
--   unregistered, suspended and driver accounts : every read returns 0 rows; every write is refused.
--   anon                 : refused (Stage 0).
--   Catalogue            : select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
--                          must no longer list the tables of the groups already enabled.
-- ROLLBACK (instant, per table): alter table public.<table> disable row level security;   then drop the six new policies if they should not remain.
-- The dropped inert policies can be recreated from the listing in docs/fleet-intelligence-v47-access-control-audit.md.
-- ---------------------------------------------------------------------------------------------------------------------
rollback;  -- REVIEW ONLY: replace with COMMIT only after written approval of this exact target, table group and change.
