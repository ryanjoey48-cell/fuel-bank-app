-- REVIEW ONLY. NOT EXECUTED. DO NOT RUN WITHOUT WRITTEN OWNER APPROVAL.
-- V4.7 Row Level Security remediation for the 15 public tables found exposed on the live project "Fuel Tracker App" (ref hafoaurzfgkkwpvzedvd), checked 2026-11-06.
--
-- WHAT WAS PROVEN (read-only checks; no record was read and no write was attempted):
--   * All 15 tables: RLS disabled; anon and authenticated hold SELECT/INSERT/UPDATE/DELETE/TRUNCATE (and more).
--   * An anonymous caller holding only the public key could see every row of 14 populated tables (row counts matched the table totals).
--   * Self-registration exists, so any signed-in account (role "authenticated") also has full access today, even with no account_access row.
--   * Three tables already have policies (oil_change_baselines, oil_change_history, vehicles) that are inert while RLS is off. They would become active when RLS is enabled:
--     the vehicles policies are user_id based and would hide other users' vehicles from office staff; the oil_change policies are "authenticated, true".
--   * New tables in schema public receive full anon/authenticated/service_role privileges by default (pg_default_acl).
--   * Live role helpers exist and are SECURITY DEFINER: current_account_role(), is_account_active(), is_account_admin(), is_office_account(), is_support_ticket_admin().
--   * Live account_access roles: admin, office_staff, read_only (no super_admin). In use: 2 admin + 2 office_staff, all active.
--   * driver_portal has NO grants on these 15 tables, so drivers are not affected. service_role has BYPASSRLS, so server routes using it are not affected.
--
-- HOW THE APP USES THEM: mostly the browser with the signed-in user's token (lib/data.ts, safety pages, fleet tracking) and Fleet Intelligence routes that
-- forward the caller's token. So policies must let active office accounts read (and admin/office_staff write) or those screens break.
--
-- RULES USED (mirror lib/authorization.ts): read = any active office account (admin, office_staff, read_only); write = admin or office_staff.
-- Nothing here grants anything to anon. Tighter options (admin-only delete on money tables, hiding bank_transfers from read_only) are listed in
-- docs/fleet-intelligence-v47-access-control-audit.md and are NOT in this script.
--
-- STAGES (apply each only after the previous one is validated, first on the "EES Development" project):
--   Stage 0  Revoke anon (urgent, lowest risk). Does not change what signed-in office users can do.
--   Stage 1  Policies, then enable RLS per table (closes the self-registered-user path). Needs the pre-checks below.
--   Stage 2  Precautionary hardening: default privileges and anon EXECUTE on write RPCs.
--
-- Everything below sits inside a transaction that ends in ROLLBACK so pasting it into a console changes nothing.

begin;

-- ---------------------------------------------------------------------------------------------------------------------
-- PRE-CHECKS (abort if the model this relies on is missing). Also guards against locking everyone out.
-- ---------------------------------------------------------------------------------------------------------------------
do $precheck$
begin
  if to_regprocedure('public.is_office_account()') is null or to_regprocedure('public.current_account_role()') is null then
    raise exception 'role helper functions are missing: stop';
  end if;
  if not exists (select 1 from public.account_access where role = 'admin' and status = 'active') then
    raise exception 'no active admin in account_access: enabling RLS could lock everyone out: stop';
  end if;
end
$precheck$;

-- ---------------------------------------------------------------------------------------------------------------------
-- STAGE 0: close the proven anonymous exposure. Signed-in office users are unaffected (they use the authenticated role).
-- ---------------------------------------------------------------------------------------------------------------------
revoke all on table public.bank_transfers from anon;
revoke all on table public.drivers from anon;
revoke all on table public.fuel_logs from anon;
revoke all on table public.weekly_mileage from anon;
revoke all on table public.shipments from anon;
revoke all on table public.vehicles from anon;
revoke all on table public.oil_change_baselines from anon;
revoke all on table public.oil_change_history from anon;
revoke all on table public.trip_journeys from anon;
revoke all on table public.trip_fuel_logs from anon;
revoke all on table public.vehicle_safety_requirements from anon;
revoke all on table public.vehicle_safety_inspections from anon;
revoke all on table public.vehicle_safety_inspection_items from anon;
revoke all on table public.vehicle_safety_issues from anon;
revoke all on table public.vehicle_safety_assets from anon;

-- Stage 0 validation (with the PUBLIC anon key, zero rows requested): each table must answer HTTP 401/403 (permission denied), no longer 206.
--   GET {url}/rest/v1/fuel_logs?select=id&limit=0   with   apikey: <anon key>   -> expect 401 or 403
-- Stage 0 rollback: grant select, insert, update, delete on table public.<table> to anon;   (only if a real anonymous flow is proven to need it)

-- ---------------------------------------------------------------------------------------------------------------------
-- STAGE 1: policies first, then enable RLS (so there is never a moment with RLS on and no policy).
-- ---------------------------------------------------------------------------------------------------------------------
-- 1a. Remove the old policies that would otherwise become active. Their intent is replaced by the office-account rules below.
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

-- 1b. New policies. All are TO authenticated; anon has none, so it sees nothing even if a grant is restored by mistake.

-- bank_transfers (financial)
create policy bank_transfers_office_select on public.bank_transfers for select to authenticated using (public.is_office_account());
create policy bank_transfers_office_insert on public.bank_transfers for insert to authenticated with check (public.is_office_account() and public.current_account_role() in ('admin', 'office_staff'));
create policy bank_transfers_office_update on public.bank_transfers for update to authenticated using (public.is_office_account() and public.current_account_role() in ('admin', 'office_staff')) with check (public.is_office_account() and public.current_account_role() in ('admin', 'office_staff'));
create policy bank_transfers_office_delete on public.bank_transfers for delete to authenticated using (public.is_office_account() and public.current_account_role() in ('admin', 'office_staff'));

-- drivers (personal)
create policy drivers_office_select on public.drivers for select to authenticated using (public.is_office_account());
create policy drivers_office_insert on public.drivers for insert to authenticated with check (public.is_office_account() and public.current_account_role() in ('admin', 'office_staff'));
create policy drivers_office_update on public.drivers for update to authenticated using (public.is_office_account() and public.current_account_role() in ('admin', 'office_staff')) with check (public.is_office_account() and public.current_account_role() in ('admin', 'office_staff'));
create policy drivers_office_delete on public.drivers for delete to authenticated using (public.is_office_account() and public.current_account_role() in ('admin', 'office_staff'));

-- fuel_logs (financial)
create policy fuel_logs_office_select on public.fuel_logs for select to authenticated using (public.is_office_account());
create policy fuel_logs_office_insert on public.fuel_logs for insert to authenticated with check (public.is_office_account() and public.current_account_role() in ('admin', 'office_staff'));
create policy fuel_logs_office_update on public.fuel_logs for update to authenticated using (public.is_office_account() and public.current_account_role() in ('admin', 'office_staff')) with check (public.is_office_account() and public.current_account_role() in ('admin', 'office_staff'));
create policy fuel_logs_office_delete on public.fuel_logs for delete to authenticated using (public.is_office_account() and public.current_account_role() in ('admin', 'office_staff'));

-- weekly_mileage (operational)
create policy weekly_mileage_office_select on public.weekly_mileage for select to authenticated using (public.is_office_account());
create policy weekly_mileage_office_insert on public.weekly_mileage for insert to authenticated with check (public.is_office_account() and public.current_account_role() in ('admin', 'office_staff'));
create policy weekly_mileage_office_update on public.weekly_mileage for update to authenticated using (public.is_office_account() and public.current_account_role() in ('admin', 'office_staff')) with check (public.is_office_account() and public.current_account_role() in ('admin', 'office_staff'));
create policy weekly_mileage_office_delete on public.weekly_mileage for delete to authenticated using (public.is_office_account() and public.current_account_role() in ('admin', 'office_staff'));

-- shipments (commercial)
create policy shipments_office_select on public.shipments for select to authenticated using (public.is_office_account());
create policy shipments_office_insert on public.shipments for insert to authenticated with check (public.is_office_account() and public.current_account_role() in ('admin', 'office_staff'));
create policy shipments_office_update on public.shipments for update to authenticated using (public.is_office_account() and public.current_account_role() in ('admin', 'office_staff')) with check (public.is_office_account() and public.current_account_role() in ('admin', 'office_staff'));
create policy shipments_office_delete on public.shipments for delete to authenticated using (public.is_office_account() and public.current_account_role() in ('admin', 'office_staff'));

-- vehicles (registry)
create policy vehicles_office_select on public.vehicles for select to authenticated using (public.is_office_account());
create policy vehicles_office_insert on public.vehicles for insert to authenticated with check (public.is_office_account() and public.current_account_role() in ('admin', 'office_staff'));
create policy vehicles_office_update on public.vehicles for update to authenticated using (public.is_office_account() and public.current_account_role() in ('admin', 'office_staff')) with check (public.is_office_account() and public.current_account_role() in ('admin', 'office_staff'));
create policy vehicles_office_delete on public.vehicles for delete to authenticated using (public.is_office_account() and public.current_account_role() in ('admin', 'office_staff'));

-- oil_change_baselines (maintenance)
create policy oil_change_baselines_office_select on public.oil_change_baselines for select to authenticated using (public.is_office_account());
create policy oil_change_baselines_office_insert on public.oil_change_baselines for insert to authenticated with check (public.is_office_account() and public.current_account_role() in ('admin', 'office_staff'));
create policy oil_change_baselines_office_update on public.oil_change_baselines for update to authenticated using (public.is_office_account() and public.current_account_role() in ('admin', 'office_staff')) with check (public.is_office_account() and public.current_account_role() in ('admin', 'office_staff'));
create policy oil_change_baselines_office_delete on public.oil_change_baselines for delete to authenticated using (public.is_office_account() and public.current_account_role() in ('admin', 'office_staff'));

-- oil_change_history (maintenance)
create policy oil_change_history_office_select on public.oil_change_history for select to authenticated using (public.is_office_account());
create policy oil_change_history_office_insert on public.oil_change_history for insert to authenticated with check (public.is_office_account() and public.current_account_role() in ('admin', 'office_staff'));
create policy oil_change_history_office_update on public.oil_change_history for update to authenticated using (public.is_office_account() and public.current_account_role() in ('admin', 'office_staff')) with check (public.is_office_account() and public.current_account_role() in ('admin', 'office_staff'));
create policy oil_change_history_office_delete on public.oil_change_history for delete to authenticated using (public.is_office_account() and public.current_account_role() in ('admin', 'office_staff'));

-- trip_journeys (location)
create policy trip_journeys_office_select on public.trip_journeys for select to authenticated using (public.is_office_account());
create policy trip_journeys_office_insert on public.trip_journeys for insert to authenticated with check (public.is_office_account() and public.current_account_role() in ('admin', 'office_staff'));
create policy trip_journeys_office_update on public.trip_journeys for update to authenticated using (public.is_office_account() and public.current_account_role() in ('admin', 'office_staff')) with check (public.is_office_account() and public.current_account_role() in ('admin', 'office_staff'));
create policy trip_journeys_office_delete on public.trip_journeys for delete to authenticated using (public.is_office_account() and public.current_account_role() in ('admin', 'office_staff'));

-- trip_fuel_logs (operational)
create policy trip_fuel_logs_office_select on public.trip_fuel_logs for select to authenticated using (public.is_office_account());
create policy trip_fuel_logs_office_insert on public.trip_fuel_logs for insert to authenticated with check (public.is_office_account() and public.current_account_role() in ('admin', 'office_staff'));
create policy trip_fuel_logs_office_update on public.trip_fuel_logs for update to authenticated using (public.is_office_account() and public.current_account_role() in ('admin', 'office_staff')) with check (public.is_office_account() and public.current_account_role() in ('admin', 'office_staff'));
create policy trip_fuel_logs_office_delete on public.trip_fuel_logs for delete to authenticated using (public.is_office_account() and public.current_account_role() in ('admin', 'office_staff'));

-- vehicle_safety_requirements (reference)
create policy vehicle_safety_requirements_office_select on public.vehicle_safety_requirements for select to authenticated using (public.is_office_account());
create policy vehicle_safety_requirements_office_insert on public.vehicle_safety_requirements for insert to authenticated with check (public.is_office_account() and public.current_account_role() in ('admin', 'office_staff'));
create policy vehicle_safety_requirements_office_update on public.vehicle_safety_requirements for update to authenticated using (public.is_office_account() and public.current_account_role() in ('admin', 'office_staff')) with check (public.is_office_account() and public.current_account_role() in ('admin', 'office_staff'));
create policy vehicle_safety_requirements_office_delete on public.vehicle_safety_requirements for delete to authenticated using (public.is_office_account() and public.current_account_role() in ('admin', 'office_staff'));

-- vehicle_safety_inspections (safety)
create policy vehicle_safety_inspections_office_select on public.vehicle_safety_inspections for select to authenticated using (public.is_office_account());
create policy vehicle_safety_inspections_office_insert on public.vehicle_safety_inspections for insert to authenticated with check (public.is_office_account() and public.current_account_role() in ('admin', 'office_staff'));
create policy vehicle_safety_inspections_office_update on public.vehicle_safety_inspections for update to authenticated using (public.is_office_account() and public.current_account_role() in ('admin', 'office_staff')) with check (public.is_office_account() and public.current_account_role() in ('admin', 'office_staff'));
create policy vehicle_safety_inspections_office_delete on public.vehicle_safety_inspections for delete to authenticated using (public.is_office_account() and public.current_account_role() in ('admin', 'office_staff'));

-- vehicle_safety_inspection_items (safety)
create policy vehicle_safety_inspection_items_office_select on public.vehicle_safety_inspection_items for select to authenticated using (public.is_office_account());
create policy vehicle_safety_inspection_items_office_insert on public.vehicle_safety_inspection_items for insert to authenticated with check (public.is_office_account() and public.current_account_role() in ('admin', 'office_staff'));
create policy vehicle_safety_inspection_items_office_update on public.vehicle_safety_inspection_items for update to authenticated using (public.is_office_account() and public.current_account_role() in ('admin', 'office_staff')) with check (public.is_office_account() and public.current_account_role() in ('admin', 'office_staff'));
create policy vehicle_safety_inspection_items_office_delete on public.vehicle_safety_inspection_items for delete to authenticated using (public.is_office_account() and public.current_account_role() in ('admin', 'office_staff'));

-- vehicle_safety_issues (safety)
create policy vehicle_safety_issues_office_select on public.vehicle_safety_issues for select to authenticated using (public.is_office_account());
create policy vehicle_safety_issues_office_insert on public.vehicle_safety_issues for insert to authenticated with check (public.is_office_account() and public.current_account_role() in ('admin', 'office_staff'));
create policy vehicle_safety_issues_office_update on public.vehicle_safety_issues for update to authenticated using (public.is_office_account() and public.current_account_role() in ('admin', 'office_staff')) with check (public.is_office_account() and public.current_account_role() in ('admin', 'office_staff'));
create policy vehicle_safety_issues_office_delete on public.vehicle_safety_issues for delete to authenticated using (public.is_office_account() and public.current_account_role() in ('admin', 'office_staff'));

-- vehicle_safety_assets (safety)
create policy vehicle_safety_assets_office_select on public.vehicle_safety_assets for select to authenticated using (public.is_office_account());
create policy vehicle_safety_assets_office_insert on public.vehicle_safety_assets for insert to authenticated with check (public.is_office_account() and public.current_account_role() in ('admin', 'office_staff'));
create policy vehicle_safety_assets_office_update on public.vehicle_safety_assets for update to authenticated using (public.is_office_account() and public.current_account_role() in ('admin', 'office_staff')) with check (public.is_office_account() and public.current_account_role() in ('admin', 'office_staff'));
create policy vehicle_safety_assets_office_delete on public.vehicle_safety_assets for delete to authenticated using (public.is_office_account() and public.current_account_role() in ('admin', 'office_staff'));

-- 1c. Enable RLS (do NOT use FORCE: the table owner and service_role keep working for migrations and server jobs).
alter table public.bank_transfers enable row level security;
alter table public.drivers enable row level security;
alter table public.fuel_logs enable row level security;
alter table public.weekly_mileage enable row level security;
alter table public.shipments enable row level security;
alter table public.vehicles enable row level security;
alter table public.oil_change_baselines enable row level security;
alter table public.oil_change_history enable row level security;
alter table public.trip_journeys enable row level security;
alter table public.trip_fuel_logs enable row level security;
alter table public.vehicle_safety_requirements enable row level security;
alter table public.vehicle_safety_inspections enable row level security;
alter table public.vehicle_safety_inspection_items enable row level security;
alter table public.vehicle_safety_issues enable row level security;
alter table public.vehicle_safety_assets enable row level security;

-- 1d. TRUNCATE and the other table-level privileges are not governed by RLS: remove the ones nobody should hold through the API.
revoke truncate, references, trigger, maintain on table public.bank_transfers from authenticated;
revoke truncate, references, trigger, maintain on table public.drivers from authenticated;
revoke truncate, references, trigger, maintain on table public.fuel_logs from authenticated;
revoke truncate, references, trigger, maintain on table public.weekly_mileage from authenticated;
revoke truncate, references, trigger, maintain on table public.shipments from authenticated;
revoke truncate, references, trigger, maintain on table public.vehicles from authenticated;
revoke truncate, references, trigger, maintain on table public.oil_change_baselines from authenticated;
revoke truncate, references, trigger, maintain on table public.oil_change_history from authenticated;
revoke truncate, references, trigger, maintain on table public.trip_journeys from authenticated;
revoke truncate, references, trigger, maintain on table public.trip_fuel_logs from authenticated;
revoke truncate, references, trigger, maintain on table public.vehicle_safety_requirements from authenticated;
revoke truncate, references, trigger, maintain on table public.vehicle_safety_inspections from authenticated;
revoke truncate, references, trigger, maintain on table public.vehicle_safety_inspection_items from authenticated;
revoke truncate, references, trigger, maintain on table public.vehicle_safety_issues from authenticated;
revoke truncate, references, trigger, maintain on table public.vehicle_safety_assets from authenticated;

-- Stage 1 validation (use a real active admin, an office_staff, a read_only account if one exists, a suspended account, and a self-registered account with no account_access row):
--   admin / office_staff : read every table; insert/update/delete a row you created in a throwaway test; Fleet Tracking, Fuel Logs, Weekly Mileage, Safety and Shipments pages still load.
--   read_only            : reads work; every insert/update/delete returns 42501 (RLS violation).
--   suspended + unregistered account : every read returns 0 rows and every write is refused.
--   anon                 : 401/403 (Stage 0).
--   Fleet Intelligence   : Fuel tab, Mileage report and the evidence routes (they forward the caller's token) still return data for an office account.
--   Catalogue check      : select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
--                          -> must list none of the 15.
-- Stage 1 rollback (immediate, per table): alter table public.<table> disable row level security;
-- The dropped policies can be recreated from the "inert policies" listing in docs/fleet-intelligence-v47-access-control-audit.md.

-- ---------------------------------------------------------------------------------------------------------------------
-- STAGE 2 (precautionary): stop NEW tables being exposed by default, and stop anon calling write RPCs. Needs separate approval.
-- ---------------------------------------------------------------------------------------------------------------------
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role supabase_admin in schema public revoke all on tables from anon;
-- These write RPCs already check the caller and raise on failure; revoking anon EXECUTE removes the exposure without relying on that check.
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
-- NOTE: names without argument lists work only while each name is unique. If PostgreSQL reports an ambiguous name, list the signatures
-- (select oid::regprocedure from pg_proc where proname = '...') and name them in full. The role-helper functions (is_*, current_account_role) are deliberately left alone.
-- Stage 2 rollback: grant execute on function ... to anon;   alter default privileges ... grant all on tables to anon;

rollback;  -- review only: remove this line ONLY after written owner approval, and run stage by stage.
