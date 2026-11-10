# EES V20.2 — staging activation checklist

Review only. Do not apply migrations, enable cron, or turn on live push without owner approval.

**Pilot 001 (CAL-COMP):** see `docs/ees-fleet-operations-v20-2-calcomp-pilot-001.md`, strategy `docs/ees-fleet-operations-v20-2-location-activation-strategy.md`, and GO/NO-GO `docs/ees-fleet-operations-v20-2-calcomp-pilot-001-go-nogo.md`.

**Ops rule:** Forth saved coordinates are the default destination candidate. Truck-entrance pins are not required for pilots. Diameter raw is never assumed to be radius. Public-map offsets are warnings only.

**Pilot 001 owner config approval (2026-10-31):** recorded in `output/v20-2-calcomp-pilot-001-owner-approval.json`. Migration approval package (no apply yet): `docs/ees-fleet-operations-v20-2-calcomp-pilot-001-migration-approval-package.md`.

**DATABASE SAFETY:** `hafoaurzfgkkwpvzedvd` = **CONFIRMED PRODUCTION** (matches Vercel Production). Staging SQL apply against it = **NO-GO**.

**Staging candidate recovered:** `wpmnjfncaoogssgpqxek` (**EES Development**, ACTIVE_HEALTHY) — not wired to `.env.local`/Vercel. Setup: `docs/ees-fleet-operations-v20-2-staging-environment-setup.md`. Inventory: `output/v20-2-supabase-projects-inventory.json`.

## Environment checks (before SQL)

- [ ] Staging Supabase project selected (not production)
- [ ] `NEXT_PUBLIC_SUPABASE_URL` / service role available to the deploy that will run the monitor
- [ ] `EES_FLEET_MONITOR_ENABLED=false` until staged visit proof
- [ ] `EES_FLEET_MONITOR_SECRET` prepared (≥ 32 characters) but unused until enablement
- [ ] `EES_WEB_PUSH_TEST_ENABLED=false`
- [ ] VAPID keys present only if an isolated iPhone **test** will be run later (V20.3)
- [ ] Forth credentials remain read-only; no Forth write endpoints used

## SQL apply order (owner-approved staging only)

**Canonical greenfield order:** `docs/ees-fleet-operations-v20-2-staging-installation-order.md`  
**Safety gate:** `output/v20-2-staging-installation-safety-gate.json` (CONDITIONAL_GO — no apply yet)

1. Guard: `node scripts/assert-staging-sql-target.cjs --env-file=.env.staging.local`
2. Prerequisites: `docs/ees-fleet-operations-v20-2-staging-prerequisites-review-only.sql`
3. Locations Directory: `supabase/migrations/20261019100000_ees_locations_directory.sql`
4. Service-role locations grant: `docs/ees-fleet-operations-v20-2-staging-service-role-locations-grant-review-only.sql`
5. Map pins (as postgres): `docs/ees-locations-map-pins-review-only.sql` → post-install verify
6. Booking Diary **stub only**: `docs/ees-fleet-operations-v20-2-staging-booking-diary-stub-review-only.sql`
7. Fleet V20 → verify
8. Forth import V20
9. Fleet V20.2 → verify

## Rollback order (only if staged apply must be reversed)

1. `docs/ees-fleet-operations-v20-2-rollback-review-only.sql`
2. `docs/ees-forth-locations-import-v20-rollback-review-only.sql`
3. `docs/ees-fleet-operations-v20-rollback-review-only.sql`
4. Map-pin rollback only if a dedicated rollback script was prepared and approved for that install

## Office workflow gates (must stay separate)

1. **Import draft** or **link existing** Forth ID (`/fleet-events` Forth panel)  
   - Creates/links `ees_locations` as `needs_check`  
   - Does **not** confirm pins or enable geofences
2. **Confirm destination pin** in Locations Directory (manual_confirmed)  
   - Uses Forth coordinates as candidate evidence only after office confirmation  
   - Diameter raw remains unverified and is not the monitoring radius
3. **Verify Directory record** (`verification_status=verified`) with evidence
4. **Configure + enable zone** (admin only, audit reason ≥ 5 chars)  
   - Server rejects active zones without verified record + confirmed destination pin  
   - UI also requires `admin:user_management`
5. Select pilot sites (optional table `ees_fleet_geofence_pilot_sites`) — recommend 5–10

## First live vehicle acceptance (after SQL + one enabled zone)

1. Confirm one vehicle returns GPS-verified Forth snapshots with trustworthy `sourceAt`
2. Keep monitor disabled until a supervised run is scheduled
3. Run one protected `/api/internal/fleet-monitor` call with the secret
4. Expect: candidate → continuous dwell → one visit event row; repeat poll does not duplicate event key
5. Expect: one outbox intent, `status=push_disabled` unless delivery is explicitly enabled later
6. GPS outage / long gap → `UNCERTAIN` or restarted candidate — never a false departure from missing GPS

## Map-pin SQL requirement

**Yes — confirmed destination pins are required** before any active geofence.  
Live read on 2026-10-31 showed pin storage reachable with **0** confirmed pins. If the table is already installed in staging/production, skip recreate and only confirm pins through the Locations UI. If the table is absent (`PGRST205` / 503), apply the map-pin review-only SQL first.
