# EES V20.2 — staging migration approval package (EES Development)

**Prepared:** 2026-11-01  
**Mode:** prepare only — **SQL not applied**  
**CAL-COMP config:** `output/v20-2-calcomp-pilot-001-owner-approval.json` (unchanged)

---

## Confirmed identities

| Role | Name | Ref |
| --- | --- | --- |
| Production (never experimental) | Fuel Tracker App | `hafoaurzfgkkwpvzedvd` |
| **Staging target** | **EES Development** | **`wpmnjfncaoogssgpqxek`** |
| Legacy inactive | Expert Express Sender | `kiewhxiwxmpijhlldlpm` |

Dashboard: https://supabase.com/dashboard/project/wpmnjfncaoogssgpqxek  
Local staging env: `.env.staging.local` (gitignored; monitor/push false)  
Guard: `node scripts/assert-staging-sql-target.cjs`

---

## Production isolation verification

| Check | Result |
| --- | --- |
| Staging ref ≠ production | **Yes** |
| `.env.staging.local` host | `wpmnjfncaoogssgpqxek.supabase.co` |
| `.env.local` unchanged | **Yes** (still production) |
| Vercel Production unchanged | **Yes** (not modified) |
| Experimental SQL guard blocks production | **Yes** (`lib/ees-database-environment.*`) |

---

## Staging schema inventory (read-only REST)

Source: `output/v20-2-staging-candidate-schema-clarified.json`

**Finding:** Public PostgREST schema is effectively **greenfield** for EES app objects.

| Capability | Staging status |
| --- | --- |
| `ees_locations` | **Missing** (`PGRST205`) |
| `ees_location_map_pins` | **Missing** |
| `booking_diary` | **Missing** |
| Fleet V20/V20.2 tables | **Missing** |
| Forth import tables | **Missing** |
| Fleet RPCs | **Missing** |
| `ees_locations.is_active` | N/A (table absent) |
| OpenAPI exposed definitions | Minimal (no EES fleet/location defs) |

Earlier head-count probes that reported `present:true` with `count:null` were **unreliable**; clarified selects with `PGRST205` are authoritative.

### Finance Centre preservation

Probed finance/ops table names (`invoices`, `trn_documents`, `finance_centre_settings`, `ees_finance_*`, `payment_records`, `fuel_logs`, etc.) are **not present** in PostgREST public schema.

**Assessment:** No Finance Centre application tables were detected via API. Treat staging as an empty app baseline for Fleet install. Still:

- Use **additive** review-only SQL only.
- Do not `DROP` unrelated schemas/extensions.
- If Dashboard SQL Editor later shows non-public objects, preserve them.

---

## Required migrations (exact order)

Staging lacks Directory + pins, so prerequisites are required before V20.

| Step | File | Purpose |
| --- | --- | --- |
| 0 | `node scripts/assert-staging-sql-target.cjs` | Refuse production / wrong ref |
| 1 | `supabase/migrations/20261019100000_ees_locations_directory.sql` | Locations Directory + activity |
| 1b | `docs/ees-fleet-operations-v20-2-staging-service-role-locations-grant-review-only.sql` | `service_role` DML on locations (greenfield map-pins preflight) |
| 2 | Map-pin preflight (optional read-only) then `docs/ees-locations-map-pins-review-only.sql` | Destination pins + history |
| 2v | `docs/ees-locations-map-pins-post-install-verification-read-only.sql` | Verify pins |
| 3 | Minimal `booking_diary` stub **or** existing booking migration if owner requires real booking match FK | V20 visit events reference `booking_diary(id)` |
| 4 | `docs/ees-fleet-operations-v20-review-only.sql` | Zones, visits, monitor, push tables, RPCs, `is_active` |
| 4v | `docs/ees-fleet-operations-v20-verification-read-only.sql` | Verify V20 |
| 5 | `docs/ees-forth-locations-import-v20-review-only.sql` | Forth links / audit / pilot sites |
| 6 | `docs/ees-fleet-operations-v20-2-review-only.sql` | Atomic review + outbox |
| 6v | `docs/ees-fleet-operations-v20-2-verification-read-only.sql` | Verify V20.2 |

**Important:** V20 SQL assumes `public.booking_diary` exists (`booking_id` FK). On empty staging, either:

- A) Install the real Booking Diary schema (preferred if Finance/booking work will share this project), or  
- B) Owner-approved temporary stub table with `id uuid primary key` only for Fleet FK compatibility (document as temporary).

Rollback: V20.2 → Forth → V20 rollbacks; map-pin/directory rollbacks only with dedicated scripts.

Isolated proofs already pass locally: `tests/calcomp-pilot-001-migration-safety.test.cjs`, `tests/fleet-operations-database.test.cjs`.

---

## Backup / recovery

**Verified via CLI (`supabase backups list --project-ref wpmnjfncaoogssgpqxek`):**

| Item | Status |
| --- | --- |
| WALG | **true** |
| PITR | **false** |
| Listed backups / restore timestamps | **empty** |

Recovery path: SQL rollbacks first; if needed, recreate empty project or restore-to-new-project after first platform backup. Operator must acknowledge no-PITR before apply. Dashboard: https://supabase.com/dashboard/project/wpmnjfncaoogssgpqxek/database/backups

---

## CAL-COMP Pilot 001 staging setup plan (after SQL)

Owner-approved configuration (do not alter):

- Forth ID `2742427`
- Coordinates `13.234431, 99.806063`
- Radius **150 m provisional**
- 458 m public-map warning retained
- No truck-entrance requirement
- Preserve Forth source evidence from CSV

**Staging data rule:** Do **not** copy production Directory UUID / bookings by default. After schema install:

1. Create staging Directory row for CAL-COMP (synthetic id OK) with `needs_check`.  
2. `link_existing` Forth `2742427` into `source_info`.  
3. Admin confirm destination pin at Forth coords (cite Forth ID).  
4. Verify Directory; configure zone 150 m inactive → enable with audit reason.  
5. Keep monitor/push disabled until supervised approval.  
6. Fixture/supervised GPS proof → one outbox intent `push_disabled`.

Production EES id `74ac5276-…` remains production evidence only.

---

## Staging environment readiness

| Item | Status |
| --- | --- |
| `.env.staging.local` written | **Yes** (gitignored) |
| Approved staging ref set | `EES_APPROVED_STAGING_PROJECT_REF=wpmnjfncaoogssgpqxek` |
| Monitor/push defaults | `false` |
| SQL target assert script | `scripts/assert-staging-sql-target.cjs` |
| App still on production `.env.local` | **Yes** (intentional) |

---

## GO / NO-GO

### CONDITIONAL GO (technical gate passed 2026-11-01)

Authorised DB metadata shows **greenfield** public schema; Finance conflicts none; booking stub compatible; isolated migrate+verify+rollback passed. Full package: `output/v20-2-staging-installation-safety-gate.json`.

### Still NO-GO for apply until

1. [x] Booking Diary approach = **minimal staging stub** (owner direction)  
2. [ ] Operator acknowledges WALG / no-PITR recovery path  
3. [ ] **Approve apply** of ordered SQL on staging only  
4. [ ] Confirm app must **not** auto-switch `.env.local` without a separate approval  

After those: **GO** to apply under `assert-staging-sql-target` + SQL Editor on EES Development only.
