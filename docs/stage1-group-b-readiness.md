# Stage 1 group B: execution readiness (PREPARATION ONLY, NOT EXECUTED)

Status: **PENDING SEPARATE EXPLICIT APPROVAL AND EXECUTION TIME.** This document authorises nothing. Group A is applied (2026-11-06); groups C1, C2, D, Stage 1b, 1c and Stage 2 are untouched.
Target: `hafoaurzfgkkwpvzedvd` (Fuel Tracker App, production). Scope: `oil_change_baselines`, `oil_change_history`, `vehicle_safety_inspections`, `vehicle_safety_inspection_items`, `vehicle_safety_issues`, `trip_journeys`.

## 1. Export evidence
I searched this machine's Downloads, Desktop, Documents and the project folders (depth 3) for CSV/JSON/SQL/zip/xlsx exports of the 15 tables: **none found**. The export is therefore **not verifiable from here** (it may be in the owner's browser downloads elsewhere, a cloud drive or another computer). I cannot establish its timestamp. Because group B deletes inert policies and changes only access rules (no row is touched), a missing export is not a technical blocker, but it contradicts the precondition. Cheapest fix: the owner replies with the export file names, time taken, and the row count of each group B table. Expected counts today: oil_change_baselines 25, oil_change_history 3, vehicle_safety_inspections 21, vehicle_safety_inspection_items 180, vehicle_safety_issues 18, trip_journeys 2 (and trip_fuel_logs 3, vehicle_safety_requirements 9, vehicle_safety_assets 0 for group A).

## 2. Read-only verification done today
| Item | Finding |
|---|---|
| Existing policies | Only `oil_change_baselines` and `oil_change_history` (4 each, `TO authenticated`, `using (true)` / `check (true)`): fully open to any signed-in account once RLS is on. The runbook drops all eight first, then creates the office rules. The other four tables have no policies. |
| Triggers on the six tables | none |
| SECURITY DEFINER functions using them | `save_vehicle_safety_replacement`, `ees_hr_v7_profile`; owned by `postgres`, RLS not forced, so they keep working and bypass the new policies |
| SECURITY INVOKER functions using them | none |
| Realtime publication | none |
| Foreign keys | trip_journeys -> vehicles; vehicle_safety_* -> vehicles, drivers, booking_diary, requirements, inspections; trip_fuel_logs -> trip_journeys. Referential checks run as the table owner, so RLS does not break them. |
| Roles | `service_role` and `postgres` bypass RLS; `driver_portal` has no grant on any of the six; `authenticated`/`anon` do not bypass |
| Role helpers | passed in the group B dry run (FAILS=0) as admin, office_staff, simulated read_only, unregistered, anon; all six tables had data so writes were exercised |

## 3. Service-role and application dependencies (code audit)
* **Browser, user token (affected, covered by office policies):** `lib/data.ts` for `oil_change_baselines`, `oil_change_history` and `trip_journeys` (Maintenance Centre oil service, Trip Journey), `components/vehicle-safety-check.tsx` and `vehicle-safety-record.tsx` (write inspections, items and issues from the Safety pages), `components/ees-safety-replacement-panel.tsx` (RPC `save_vehicle_safety_replacement`, SECURITY DEFINER), `app/(dashboard)/safety/**`, `dispatch`, `weekly-mileage` (oil service status).
* **Server routes using the service role:** unaffected.
* **Important correction on drivers:** the code contains **no driver-side or server-side workflow that writes `vehicle_safety_*`**. Safety inspections are recorded from the *office* Safety pages with the signed-in office user's token; the Driver Portal does not submit them in this code base. So "driver safety submission through the server-side workflow" has nothing to verify; the equivalent risk is the *office* inspection save, covered by the dry run and by the post-commit check below. A driver account has no `account_access` row, so it would be refused after group B; that matches the design. Confirm with the owner that no driver-facing inspection feature is planned or used on a different path (for example a mobile or external form) before approving.
* **Preservation:** group B changes access rules only. It runs no INSERT, UPDATE or DELETE on business tables, so maintenance mileage, oil-change intervals and driver-reported odometers (`weekly_mileage`, `vehicles`, untouched) are not modified. The transaction asserts the tables are in the audited state, then reads back policies and privileges before committing; before/after row counts are compared after commit.

## 4. Transaction (unchanged from the dry run, `commit` instead of abort)
5 s `lock_timeout`; prechecks (helpers, executability, 4 writers, 2 admins, no office account that is also an active driver, tables in audited state); drop the eight `oil_change_*_authenticated` policies; 24 new policies (4 per table, `TO authenticated`: read = any active office account, write = admin/office_staff); `enable row level security`; `revoke truncate, references, trigger, maintain ... from authenticated`; in-transaction read-back (RLS on, exactly four policies each, `authenticated` keeps SELECT/INSERT/UPDATE/DELETE and loses the four, `anon` none, `service_role` intact); `commit`.
**Do not commit if** any precheck or read-back raises, a lock timeout occurs, or row counts differ from section 1.

## 5. Validation after commit
Catalogue: RLS on and 4 policies for each of the six; `oil_change_*` have only the new `_office_` policies. Anonymous probe: 401 / 42501 on all 15 tables (`output/fleet-intelligence-v48/stage0-anon-probe.cjs`). Signed-in office session: **Safety Centre** loads (inspections, items, issues); **Maintenance Centre** oil service list and status load; **Trip Journey** loads; an inspection/oil-service *edit* only if the owner chooses to perform one, because I will not create or change real records. Row counts equal section 1. Platform logs for 5xx / 401 from `authenticated` on these tables (the log tool has been rejecting queries; if still unusable, the owner watches for errors).

## 6. Rollback
Per table, instant and lossless: `alter table public.<table> disable row level security;`. This returns the tables to today's access (anon already revoked by Stage 0). The eight dropped `oil_change_*_authenticated` policies were `using (true)` rules whose only effect was to keep access open; to be exact, they can be recreated from the text above (`for <cmd> to authenticated using (true)` / `with check (true)`) but there is no reason to, since RLS stays off after rollback. Trigger rollback if: an office or admin screen shows an empty list, a permission error or fails to save on these tables; counts differ; or the owner asks.

## 7. Approval sentence (the owner sends this, with the time)
> Run group B of `docs/stage1-rls-review-only.sql` on project `hafoaurzfgkkwpvzedvd` (Fuel Tracker App, production), committing the transaction, at [Bangkok time or "now"], with the owner present. This covers only group B. Export of the 15 tables: [file names and time, or "already confirmed for group A"].

## 8. Open items before approval
1. Export evidence (section 1) or an explicit statement that the group A confirmation stands.
2. Owner confirms no driver-facing inspection path exists outside the code audited here.
3. Owner picks the time; late evening Bangkok avoids office hours (08:00-20:45).
