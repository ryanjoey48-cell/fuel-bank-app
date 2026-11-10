# EES V20.2 — database environment safety decision

**Checked:** 2026-10-31 (read-only)  
**Evidence:** `output/v20-2-database-environment-safety.json`  
**No SQL applied. No records modified. No deploy/commit/push.**

---

## Classification

# CONFIRMED PRODUCTION

**Database safety decision: NO-GO** for applying V20 / Forth-import / V20.2 SQL under a “staging” assumption.

Project `hafoaurzfgkkwpvzedvd` is the **same Supabase project wired to Vercel Production** (and Preview / Development). It is **not** a verified dedicated staging database.

---

## 1. Project reference comparison

| Source | Supabase project ref | Notes |
| --- | --- | --- |
| Local `.env.local` | `hafoaurzfgkkwpvzedvd` | Dev machine |
| Vercel **Production** env pull (`VERCEL_ENV=production`) | `hafoaurzfgkkwpvzedvd` | Authorised CLI pull for project `fuel-bank-app` |
| Vercel **Preview** env file (`.env.vercel-preview.local`) | `hafoaurzfgkkwpvzedvd` | Same host |
| Vercel env listing | `NEXT_PUBLIC_SUPABASE_URL` attached to **Production, Preview, Development** | One URL shared across all app environments |
| Documented dedicated staging ref | **None found** | Docs discuss “staging” procedurally; no second project ref appears in repo config |
| Hardcoded edge usage | `hafoaurzfgkkwpvzedvd` | e.g. weekly-mileage OCR function URL in app code |

Secrets/keys were inspected only for host extraction and are **not** repeated here.

**Local hygiene note:** A temporary `.env.vercel-production.check` may exist from the authorised production env pull. Delete it from the machine if present; do not commit it.

---

## 2. Operational data volumes (read-only)

On `hafoaurzfgkkwpvzedvd`:

| Table | Count |
| --- | --- |
| `ees_locations` | **103** |
| `ees_location_map_pins` | **0** |
| `booking_diary` | **1572** |
| `fuel_logs` | **2729** |
| `vehicle_monthly_performance` | **149** |
| `account_access` | **4** |

These volumes match a **live operational** EES database, not an empty sandbox.

---

## 3. Schema / migration compatibility

| Item | State |
| --- | --- |
| `ees_locations.verification_status` | Present (current Directory gate) |
| `ees_locations.is_active` | **Absent** |
| Fleet V20 / V20.2 tables & RPCs | **Absent** (not in OpenAPI) |
| Map pins | Present (0 rows) |
| `supabase_migrations.schema_migrations` via PostgREST | Not readable (`PGRST205`) — migration history not confirmed through API |

### What V20 SQL does to current production tables

From `docs/ees-fleet-operations-v20-review-only.sql`:

- **`alter table public.ees_locations add column if not exists is_active boolean not null default true`**
  - **Introduces a new column** on the live Directory table.
  - Does **not** rewrite company names, addresses, booking rows, or financial tables.
  - Default `true` leaves existing rows logically “active” for fleet gates.
  - Current Locations Directory API field list does **not** expose `is_active`; fleet zone/monitor code **requires** it after V20.
  - Still a **production schema change** on `ees_locations`.
- Remaining V20/V20.2/Forth SQL: additive fleet/Forth tables + RPCs (new objects), not updates to booking/fuel rows — **but still production DDL** if applied here.

Rollback drops `is_active` and fleet objects — still risky on production without a verified restore path.

---

## 4. Backup / PITR availability

**Not verifiable from this agent session** (requires Supabase Dashboard / Management API token).

**Required owner/operator check before any production DDL:**

1. Open https://supabase.com/dashboard/project/hafoaurzfgkkwpvzedvd/database/backups  
2. Record: plan, daily backups vs PITR, earliest/latest recovery points, last successful backup time.  
3. Prefer a **tested** recovery approach (already used in EES insurance gate practice):
   - **Best:** PITR or physical backup → **Restore to a new project** and verify Directory + booking counts there ([clone/restore guidance](https://supabase.com/docs/guides/platform/clone-project)).  
   - **Acceptable:** Confirmed daily backup + documented restore drill; or encrypted `supabase db dump` / `pg_dump` stored off-repo.  
4. Do **not** treat “SQL rollback scripts alone” as sufficient recovery proof for production.

Until backup/PITR is recorded by an operator, recovery readiness remains **UNVERIFIED** even though the environment classification is production.

---

## 5. Decision

| Question | Answer |
| --- | --- |
| Dedicated staging? | **No — not confirmed; evidence contradicts** |
| Environment class | **CONFIRMED PRODUCTION** |
| Apply V20 SQL now as “staging”? | **NO-GO** |
| Safe next path | Provision or identify a **true staging** Supabase project, point a non-production env at it, re-run preflight there — **or** obtain explicit **production** migration approval with verified backup/restore |

---

## 6. Remaining approvals if work continues

1. Accept this classification (or supply a different staging project ref with proof).  
2. If proceeding on production: explicit production migration approval + completed backup/PITR checklist.  
3. If staging path: prefer recovered **EES Development** (`wpmnjfncaoogssgpqxek`) — see `docs/ees-fleet-operations-v20-2-staging-environment-setup.md`. Never assume local `.env.local` is staging while it matches Vercel Production.
