# EES V20.2 — staging-only ordered installation checklist

**Target:** EES Development `wpmnjfncaoogssgpqxek`  
**Never:** production `hafoaurzfgkkwpvzedvd`  
**Mode:** apply only after owner word. Safety gate: `output/v20-2-staging-installation-safety-gate.json`

## Pre-flight (every session)

1. Confirm Dashboard project is **EES Development**.
2. Run: `node scripts/assert-staging-sql-target.cjs --env-file=.env.staging.local`
3. Acknowledge recovery path: WALG on, **PITR off**, backup list empty → SQL rollbacks + recreate/restore-to-new-project if needed.
4. Keep `EES_FLEET_MONITOR_ENABLED=false` and `EES_WEB_PUSH_TEST_ENABLED=false`.

## Exact SQL order (prepared files)

| # | File | Action |
| --- | --- | --- |
| 1 | `docs/ees-fleet-operations-v20-2-staging-prerequisites-review-only.sql` | Apply — `account_access` / `driver_accounts` / office RLS helpers |
| 2 | `supabase/migrations/20261019100000_ees_locations_directory.sql` | Apply — Locations Directory |
| 2b | `docs/ees-fleet-operations-v20-2-staging-service-role-locations-grant-review-only.sql` | Apply — `service_role` DML on locations/activity (required by map-pins preflight on greenfield) |
| 3 | `docs/ees-locations-map-pins-review-only.sql` | Apply as **postgres** in SQL Editor (CREATEROLE). Optional read-only preflight first. |
| 3v | `docs/ees-locations-map-pins-post-install-verification-read-only.sql` | Verify (staging-aware: empty Directory is not a FAIL) |
| 4 | `docs/ees-fleet-operations-v20-2-staging-booking-diary-stub-review-only.sql` | Apply — minimal `booking_diary(id)` stub only |
| 5 | `docs/ees-fleet-operations-v20-review-only.sql` | Apply — Fleet V20 |
| 5v | `docs/ees-fleet-operations-v20-verification-read-only.sql` | Verify |
| 6 | `docs/ees-forth-locations-import-v20-review-only.sql` | Apply — Forth link/import/pilot |
| 7 | `docs/ees-fleet-operations-v20-2-review-only.sql` | Apply — V20.2 review/outbox |
| 7v | `docs/ees-fleet-operations-v20-2-verification-read-only.sql` | Verify |

## After schema (still separate approval)

1. Seed office user into `account_access` (admin/active).
2. Insert **synthetic** CAL-COMP package from `output/v20-2-staging-calcomp-synthetic-records.json` (id `aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee`, Forth `2742427`, `13.234431,99.806063`, 150 m).
3. Do **not** copy production EES id `74ac5276-…`.
4. Monitor / push remain off until supervised acceptance.

## Rollback order

1. `docs/ees-fleet-operations-v20-2-rollback-review-only.sql`
2. `docs/ees-forth-locations-import-v20-rollback-review-only.sql`
3. `docs/ees-fleet-operations-v20-rollback-review-only.sql`
4. Directory / map pins / booking stub only with dedicated approved rollback
