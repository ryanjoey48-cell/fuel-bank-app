# Fleet Intelligence persistence: compatibility, security and approval review (V4.7 revision)

**Status: REVIEW ONLY. Nothing has been created, applied or enabled.** Companion SQL: `docs/fleet-intelligence-persistence-review-only.sql` (ends in `ROLLBACK`; syntax checked statically by tests, never run against a server).
Temporary office decisions in Fleet Tracking stay in-memory, labelled *Temporary — not saved*, and never feed confirmed km. This document supersedes the V4.5 version; the V4.5 SQL draft had a truncated `CHECK` clause and would not have parsed (found and fixed in V4.7).

## 1. What was verified against the live project (read-only catalogue checks, 2026-11-06)
Project "Fuel Tracker App" (`hafoaurzfgkkwpvzedvd`). No row of a business table was read; no statement changed anything. See `docs/fleet-intelligence-v47-access-control-audit.md`.

| Question | Verified answer |
|---|---|
| Role source | `public.account_access(user_id uuid pk -> auth.users, role, status)`. `profiles` does not exist. |
| Allowed roles | The live check constraint allows **only** `admin`, `office_staff`, `read_only`. `super_admin` is not allowed live (the Super Admin migration is not applied). In use: 2 admin, 2 office_staff, all active; no read_only account yet. |
| Helper functions | `current_account_role()`, `is_account_active()`, `is_account_admin()`, `is_office_account()`, `is_support_ticket_admin()` all exist and are SECURITY DEFINER. `is_account_admin()` is true for the `admin` role only. |
| Booking Diary identifiers | `id uuid` (pk), `booking_id text` (human reference), `vehicle_id uuid` (nullable; older rows are registration-only), `driver_id bigint` (references `drivers.id`), `pickup_time time`. |
| Vehicle identifier | `vehicles.id uuid`. |
| Extensions | `btree_gist` is **not installed**; the proposal no longer needs it. |
| Default privileges | New tables in `public` receive full `anon`/`authenticated`/`service_role` privileges. Every proposed table therefore starts with `REVOKE ALL FROM anon, authenticated`. |
| Migration history | None recorded; apply as a reviewed script, on "EES Development" first (not inspected). |

## 2. Changes from the V4.5 draft
1. **Syntax fix:** the draft's first table had a truncated `CHECK` (the shell had eaten `$')`). Fixed, and a test now checks quote and parenthesis balance.
2. **No extension:** the overlap rule moved into the write function under an advisory lock (`pg_advisory_xact_lock` per vehicle-day). The optional `btree_gist` exclusion constraint is kept as a commented alternative.
3. **Versioned history:** `version` per booking, `unique (booking_id, version)`, `supersedes_id` chain, so every change is a new row.
4. **Provider coverage uncertainty recorded:** each decision stores `provider_coverage` (complete versus unverified) and `position_source` (gps, no_gps, mixed, none). No GPS is never stored as verified. Snapshots also store `provider_report_captured_at` and `open_final_segment`.
5. **Booking copies:** `booking_registration`, `booking_pickup_time`, `booking_job_order` are copied at decision time, because Booking Diary can change later. The booking is never modified.
6. **Roles:** `decided_role` allows only the roles the live constraint allows.
7. **Default-privilege safety:** `REVOKE ALL FROM anon, authenticated` on every table, then `GRANT SELECT` to `authenticated` only.
8. **Append-only for real:** UPDATE/DELETE and **TRUNCATE** are blocked by triggers (row triggers alone do not stop TRUNCATE).
9. **Service-role-only audit inserts:** the audit table has no client write path.

## 3. Proposal summary
- **A. Confirmations:** `fleet_confirmation_events` (append-only, versioned) and `fleet_journey_job_confirmations` (one current row per booking). Written only through `fleet_record_journey_decision(...)`: administrator check, idempotent per (user, key), validates overlap, one transaction. One job maps to one journey; several jobs may share one journey (multi-stop), counted once.
- **B. Historical-route access audit:** the fields `lib/forth-history-audit.ts` records today, in the database. No coordinates, tokens or bodies. Read by administrators only.
- **C. Reconciliation snapshots:** what the screen showed (km per category, per-journey ids, source versions, coverage, status, content hash), deduplicated by `(vehicle_id, day, content_hash)`.
- **Never written:** Booking Diary, Finance, Fuel Logs, Weekly Mileage, Maintenance, Vehicle Performance, Forth.

### Permissions and RLS
| Table | Read | Write |
|---|---|---|
| A (events, current) | active office accounts (`is_office_account()`) | none from clients; only the administrator-checked function |
| B (audit) | administrators (`is_account_admin()`) | server service role only |
| C (snapshots) | active office accounts | server service role only |

## 4. Durable route-history audit: plan and permission model
Today: events go to a server log line and a 300-event in-memory list (admin-readable, cleared on restart).
1. Approve table B. 2. Add a server writer that inserts one row per history request with the service role (same fields as today). 3. **Fail closed for any non-administrator access**: if the audit insert fails, the request is refused. Supervised local administrator access may continue best-effort with a log line. 4. Only then consider widening who may see journeys, and only by explicit allowlist, never by `business:read`. 5. Retention 400 days online, then archive; no coordinates are ever stored, so the audit holds who, when, which device and window, and the outcome.
Until step 3 exists, access stays limited to approved supervised local administrators and production stays blocked.

## 5. Safe local testing and rollout
1. Owner approves the checklist below. 2. Apply to "EES Development" (first confirm it matches production). 3. Test: administrator can record; office_staff and read_only get `42501`; a replayed key returns the same event; a second job on the same journey is accepted; a different overlapping journey is refused with `23P01`; UPDATE, DELETE and TRUNCATE on the append-only tables raise; Booking Diary counts and `updated_at` are unchanged. 4. Add the server route and the "approved record" reader behind a flag that is off by default. 5. Only then the production project, in a maintenance window with a verified backup.
**Rollback:** drop the four tables and two functions (statements are in the SQL). If approved records exist, export them first.

## 6. Approval checklist (tick before anything is applied)
- [ ] 1. Approve tables A, B and C as designed (or name the ones to drop).
- [ ] 2. Who may confirm: administrators only (as written), or `admin` and `office_staff` (one-line change in the function)?
- [ ] 3. Retention: 400 days online for events, audit and snapshots, then archive.
- [ ] 4. Keep the advisory-lock overlap check (no extension), or install `btree_gist` for a database constraint?
- [ ] 5. Confirm "EES Development" mirrors production, and who runs the tests in section 5.
- [ ] 6. Approve fail-closed audit writes for any non-administrator history access (section 4).
- [ ] 7. Separate decision: the RLS remediation in `docs/rls-remediation-review-only.sql`. It is **more urgent** than this proposal and does not depend on it.
- [ ] 8. If `super_admin` is wanted, apply that migration first and re-run the role-constraint check; this proposal does not depend on it.
