# Stage 1 supervised runbook: office-account RLS on the 15 tables (PLAN ONLY, NOT EXECUTED)

Status: **PENDING APPROVAL.** Stage 0 is applied (2026-11-06). After Stage 1 only active office accounts can use these 15 tables; today any signed-in account can.
Target: `hafoaurzfgkkwpvzedvd` (Fuel Tracker App, production). SQL: `docs/stage1-rls-review-only.sql` (generator `output/fleet-intelligence-v48/generate-stage1-sql.cjs`). Development cannot rehearse it (it lacks these tables and the production helpers), so production is done **one group at a time, each its own approval and commit**, with an instant per-table rollback.

## 1. Read-only precheck run on production today (2026-11-06, after Stage 0)
| Check | Result |
|---|---|
| Accounts | 2 admin + 2 office_staff, all active; **no read_only, no unregistered/suspended account exists** |
| Writers who are not active drivers / admins who are not | 4 / 2 (lock-out precheck passes) |
| Office accounts that also hold an active driver account | 0 (would lose access; none) |
| Helpers | 4 SECURITY DEFINER helpers present; `authenticated` can execute `is_office_account()` and `current_account_role()` |
| RLS state | off on all 15; `anon` holds nothing on them (Stage 0 holds) |
| Existing policies | oil_change_baselines 4, oil_change_history 4, vehicles 3 (inert; replaced in their group) |
| Dependent views | none |
| SECURITY DEFINER functions reading the tables (23, e.g. HR v7, maintenance, inventory, driver job events) | owned by `postgres`; RLS is not forced, so they **bypass** the new policies and keep working; they are not made safer by Stage 1 (their own auth checks matter) |
| SECURITY INVOKER functions / triggers | `sync_weekly_mileage_compat`, `sync_weekly_mileage_driver_snapshot` (triggers on `weekly_mileage`) run as the caller and read `drivers`/`vehicles`, so saving mileage needs those read policies; group C therefore includes `vehicles` and `weekly_mileage` together, and `drivers` (group D) must be enabled with a read policy for office accounts before or with mileage saves: see order below |
| Row counts (for before/after comparison) | fuel_logs 2793, weekly_mileage 709, vehicles 24, drivers 23, bank_transfers 6, shipments 6 |

**Ordering consequence:** because the mileage trigger reads `drivers`, enable `drivers` **before or in the same transaction as** `weekly_mileage`. The generated file is ordered accordingly: A, B, C1 (`vehicles`, `drivers`, `weekly_mileage` together), C2 (`fuel_logs`, `shipments`), D (`bank_transfers`), with a pause after each.

## 2. Open owner decisions (answer before approving)
1. Stage 1b: should read_only accounts see banking records; should deletes of money records be admin-only? (default: leave as Stage 1, decide later)
2. Should Stage 1c (identity-table hardening) run in the same window? (recommended, separate approval)
3. Create a read_only and an unregistered test account in production? **Recommended: no.** Use the rolled-back harness instead (below) so no real account or password is created.
4. Backups: confirm or take a manual export of the 15 tables first.

### Owner decisions recorded 2026-11-06
1. Stage 1b: **decide later.** Stage 1 runs with the core rules only (all office roles read; admin and office_staff write and delete).
2. Stage 1c: **separate approval later**, after Stage 1 is validated.
3. Rolled-back dry run on production before each group: **approved in principle** (role simulation, writes nothing, always rolls back). The harness must run in the **same transaction** as the group slice to see its uncommitted policies, so a combined per-group dry-run script is built and shown first.
4. Backup: **owner exports the 15 tables** from the dashboard before group A and confirms in chat.
These answers do not approve running any group. Each group still needs its own exact approval sentence (section 4, step 3).

### Dry-run log
* **Group A, 2026-11-06, production, owner-approved:** `FAILS=0`, no `NOTE` lines. Admin and office_staff saw every row and updated one; read_only (simulated) read all and wrote none; unregistered saw nothing. Row counts: requirements 9, trip_fuel_logs 3, assets 0 (an empty table, so its write probes were skipped). Read-back afterwards: RLS still off on all 15, no new policies, roles unchanged (2 admin, 2 office_staff), `authenticated` TRUNCATE still present, i.e. nothing persisted. The real group A run is still unapproved.

* **Group B, 2026-11-06, production, owner-approved:** `FAILS=0`, no `NOTE` lines, all six tables exercised with data (baselines 25, history 3, inspections 21, items 180, issues 18, journeys 2). Read-back: RLS still off on all 15, original oil-change policies intact (4 each), roles unchanged; nothing persisted. Real group B run unapproved.

* **Group C1, 2026-11-06, production, owner-approved:** `FAILS=0`, no `NOTE` lines (vehicles 24, drivers 23, weekly_mileage 709 rows all exercised). The no-op updates fired the `weekly_mileage` sync triggers and the `drivers` HR guard as admin and office_staff without error, so the trigger dependency is satisfied when the three tables are enabled together. Nothing persisted (read-back below in the execution record). Real C1 run unapproved.

* **Group C2, 2026-11-06, production, owner-approved:** `FAILS=0`, no `NOTE` lines (fuel_logs 2793, shipments 6 rows exercised). Nothing persisted: RLS still off on all 15, no new policies, roles unchanged. Real C2 run unapproved.

* **Group D, 2026-11-06, production, owner-approved:** `FAILS=0`, no `NOTE` lines (bank_transfers 6 rows exercised). Nothing persisted. **All five groups (A, B, C1, C2, D) are now dry-run clean.** The real runs remain unapproved: each needs the owner's backup confirmation and its own approval sentence. Reminder: dry runs prove the policies behave as designed against today's data; they do not exercise the app's own screens, so post-commit validation (section 6) is still required.

## 3. Window and people
Outside 08:00-20:45 Bangkok if possible. Owner present, one office_staff and one administrator ready to click through. Rollback SQL open. One group per sitting is fine; a group can take about 15 minutes with validation.

## 4. Per-group procedure
For each group in order: A (reference), B (maintenance, safety, trips), C1, C2, D.
1. **Precheck** (the `$precheck$` block, unchanged); must pass.
2. **Rolled-back dry run:** run `docs/stage1-dryrun-group-<a|b|c1|c2|d>-review-only.sql` (generated by `output/fleet-intelligence-v48/generate-stage1-dryrun.cjs`). It applies the group's policies, simulates admin, office_staff, read_only (by temporarily demoting one office_staff row inside the transaction), unregistered and anon, then **aborts by raising an exception that carries the report**, so it cannot commit even by accident. Read `FAILS=0` in the error text. Admin and office_staff must see every row and update one; read_only must read all but write none; unregistered and anon see nothing. A `NOTE ... inconclusive` line means a trigger or constraint stopped a probe: investigate before the real run. The scripts have not been executed anywhere yet (Development lacks the tables), so a first-run syntax error is possible and harmless.
3. **Approval sentence (exact):** "Run group <X> of `docs/stage1-rls-review-only.sql` on project `hafoaurzfgkkwpvzedvd` (Fuel Tracker App, production), committing the transaction, at [time], with the owner present."
4. **Run** the group slice (its drop of inert policies, its 4 policies per table, `enable row level security`, the privilege revoke) with `lock_timeout 5s`, then `commit`.
5. **Validate immediately** (below). Compare row counts through an office session; they must equal the baseline.
6. **Decide:** continue to the next group only after the owner says so.

## 5. STOP conditions (do not commit; `rollback;`)
precheck raises; a lock timeout; the dry-run harness shows any FAIL; row counts from an office session differ from baseline.

## 6. Validation after each commit
| Actor | Check | Expected |
|---|---|---|
| Office staff | pages using the group: add and edit a record, list screens | work as before |
| Administrator | same plus user admin, HR, vehicle performance | work as before |
| Weekly Mileage | add/edit a reading (fires the mileage triggers) | saves, no error |
| Fleet Intelligence / Fleet Tracking | open a vehicle, Fuel and Journeys tabs | load |
| Anonymous | `limit=0` probes with `output/fleet-intelligence-v48/stage0-anon-probe.cjs` | still 401 on all 15 |
| Signed-in non-office account | not available; covered by the harness | 0 rows |
| Driver portal | sign in, jobs, safety check (service role, unaffected) | unchanged |
| Catalogue | the group's tables show `relrowsecurity = true`, four `_office_` policies each | yes |
| Logs, next hour | no rise in 401/403/5xx from `authenticated` | none |

## 7. Rollback triggers and procedure
Roll back the group if an office or admin screen that worked now returns an empty list, a permission error, or fails to save; row counts differ; or the owner asks. Per table, instantly and losslessly:
`alter table public.<table> disable row level security;` (then optionally drop the four new policies). The dropped inert policies are not needed (they were inert). Re-test the screen, record the cause, re-audit before retrying. Do not roll back for developer scripts that now fail.

## 8. After the last group
Run the full harness once (all tables, `PRODUCTION-APPROVED`); confirm the catalogue shows RLS on for the 15; update `docs/security-state.json` (`stage1_office_rls: applied`, evidence report); then consider 1b, 1c and Stage 2 (anon-callable write RPCs and default privileges) as separate approvals. `production_secured` stays false until Stage 2 and the open-sign-up decision are settled.

## 9. Known limits
Not rehearsed outside production; the read_only and unregistered paths are tested only by simulation; SECURITY DEFINER functions are unaffected by these policies; backups unverified; the V4.x foreign-key issues and `vehicles.user_id` cascade hazard remain separate work.
