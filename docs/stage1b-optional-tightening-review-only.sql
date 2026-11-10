-- REVIEW ONLY. NOT EXECUTED. OPTIONAL. A BEHAVIOUR CHANGE: apply only after the owner decides the answers to the questions below.
-- STAGE 1b: tighter rules for banking and driver data, layered on top of docs/stage1-rls-review-only.sql (apply that first and validate it).
-- TARGET: project ref hafoaurzfgkkwpvzedvd ("Fuel Tracker App", CONFIRMED PRODUCTION). Rehearse on a verified Development copy first.
--
-- OWNER DECISIONS THIS FILE ASSUMES (change the SQL if the answers differ)
--   Q1. bank_transfers: should read_only accounts see banking records?              Assumed: NO (admin and office_staff only).
--   Q2. Who may DELETE money records (bank_transfers, fuel_logs, shipments)?        Assumed: administrators only. The app currently lets office_staff delete them.
--   Q3. drivers: should read_only accounts see driver names and payment methods?    Assumed: YES (unchanged: the fleet screens need the roster).
-- Each change below REPLACES one policy from the core file. Nothing else is touched.

begin;
set local lock_timeout = '5s';

-- Q1: banking read access limited to admin and office_staff.
drop policy if exists bank_transfers_office_select on public.bank_transfers;
create policy bank_transfers_office_select on public.bank_transfers for select to authenticated
  using ((select public.is_office_account()) and (select public.current_account_role()) in ('admin', 'office_staff'));

-- Q2: delete on money records limited to administrators.
drop policy if exists bank_transfers_office_delete on public.bank_transfers;
create policy bank_transfers_office_delete on public.bank_transfers for delete to authenticated using ((select public.is_account_admin()));
drop policy if exists fuel_logs_office_delete on public.fuel_logs;
create policy fuel_logs_office_delete on public.fuel_logs for delete to authenticated using ((select public.is_account_admin()));
drop policy if exists shipments_office_delete on public.shipments;
create policy shipments_office_delete on public.shipments for delete to authenticated using ((select public.is_account_admin()));

-- Impact to check before approving: the app's own delete buttons for these records (lib/data.ts) for office_staff would start failing silently (0 rows affected).
-- Rollback: re-create the three delete policies and the select policy exactly as in docs/stage1-rls-review-only.sql.
rollback;  -- REVIEW ONLY: replace with COMMIT only after written approval.
