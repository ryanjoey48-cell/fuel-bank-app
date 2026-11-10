# EES V20.3 — production backup restore drill preparation

**Backup timestamp:** `20261101-194605`  
**Production (never restore here):** `hafoaurzfgkkwpvzedvd`  
**Development (never restore here):** `wpmnjfncaoogssgpqxek`  
**Status:** Preparation only. No cloud restore executed. Production SQL gate remains **NO-GO**.

## 1. Backup integrity recheck

| Check | Result |
| --- | --- |
| `roles.sql.aes` / `schema.sql.aes` / `data.sql.aes` present | PASS |
| SHA256 match vs `SHA256SUMS.txt` | PASS (all three) |
| Key dir separate from ciphertext | PASS |
| Restricted ACL (current user only) | PASS |
| Plaintext `.sql` beside backup/keys | **0** (PASS) |
| Artifacts outside Git | PASS |

Ciphertext: `C:\Users\joery\AppData\Local\EES\production-backups\20261101-194605`  
Keys: `C:\Users\joery\AppData\Local\EES\production-backup-keys\20261101-194605`

## 2. Credential cleanup assessment

| Item | Assessment |
| --- | --- |
| Temporary `cli_login_postgres` from backup window | **Expired** — `VALID UNTIL 2026-11-01 12:51:05+00` (≈4 minutes after mint; now past) |
| Temporary read-only CLI login role | **Expired** — `VALID UNTIL 2026-11-01 12:43:08+00` |
| Prior dry-run ephemeral password | Do not reuse; treat as historical log risk only |
| Backup key / customer rows in Git or this report | **Not present** |
| Optional hygiene | Dashboard DB password rotate still optional; not required solely for expired CLI roles |

## 3. Recommended isolated restore target

### Local PostgreSQL 17 — **NOT sufficient for a faithful drill**

Available: PostgreSQL 17.11 tools + `postgresql-x64-17` service on localhost:5432.  

Blockers for an accurate Supabase-like restore:

1. No automated local `postgres` password available in this environment (auth required).  
2. Public schema DDL/functions/policies contain **heavy** `auth.*` / `storage.*` dependencies (`auth.uid()` / `auth.role()` refs ≈182; storage refs ≈4; **81** RLS-enabled tables; **133** policies). Bare Postgres has no GoTrue `auth` schema.  
3. Roles dump includes managed Supabase roles (`anon`, `authenticated`, `service_role`, `supabase_admin`, …). Recreating them on a stock cluster is incomplete/dangerous and still lacks Auth/Storage.  
4. No `CREATE EXTENSION` statements in the public dump (extensions assumed present on Supabase).

**Verdict:** Local PG may support a future **limited count-smoke** only after owner supplies a disposable local superuser password **and** stubs for `auth`/`storage` — it cannot prove RLS/grants/Auth-linked behaviour.

### Temporary isolated Supabase project — **RECOMMENDED**

Create a **new** throwaway project (new ref), restore into it, validate, then delete.  

Hard excludes: production `hafoaurzfgkkwpvzedvd`, Development `wpmnjfncaoogssgpqxek`.

## 4. Compatibility and extension requirements

From decrypted schema inspection (plaintext wiped afterward):

| Item | Observation |
| --- | --- |
| Critical tables in dump | `booking_diary`, `fuel_logs`, `ees_locations`, `ees_location_map_pins`, `vehicles`, `drivers`, `maintenance_records`, `vehicle_monthly_performance`, `account_access` |
| Inventory | 96 tables, 1 view, 100 functions, 146 indexes, 52 triggers, 183 FK refs |
| RLS | 81 tables with RLS enabled; 133 policies |
| Circular FK | `ees_employee_documents` (data restore needs deferred triggers / `session_replication_role=replica` on **isolated** target only) |
| Extensions | Not emitted in public dump; rely on Supabase defaults (`uuid-ossp` / `pgcrypto` etc. as provided by platform) |
| Auth/Storage | **Not restored** by this logical backup |

## 5. Restore procedure (do not run until authorised)

Helper (plan-only by default):

`scripts/prepare-production-backup-restore-drill.ps1`

### A. Owner creates isolated target

1. Supabase Dashboard → **New project** (temporary name e.g. `ees-restore-drill-20261101`).  
2. Record the **new** project ref. Confirm it is neither production nor Development.  
3. Note DB password in a local secret store (not Git).

### B. Verify backup again

```powershell
powershell -File scripts/prepare-production-backup-restore-drill.ps1
```

### C. Decrypt off-repo (authorised)

```powershell
powershell -File scripts/prepare-production-backup-restore-drill.ps1 `
  -OwnerAuthorisedDecrypt `
  -IConfirmIsolatedTarget <NEW_TEMP_PROJECT_REF>
```

Plaintext lands only under `%LOCALAPPDATA%\EES\restore-drill-work\20261101-194605` (restricted ACL). Wipe after restore.

### D. Restore order (isolated target only)

1. Connectivity check to **new** project DB URL only.  
2. Prefer **skipping** full `roles.sql` on a fresh Supabase project (platform already has managed roles). Optionally apply only custom non-managed roles (`driver_portal`, `ees_locations_map_pin_auditor`) if needed.  
3. `psql -v ON_ERROR_STOP=1 -f schema.sql`  
4. Data load with FK deferral **on isolated target only**:  
   `SET session_replication_role = replica;` → `\i data.sql` → `SET session_replication_role = DEFAULT;`  
   Do **not** use this on production.  
5. Re-enable / verify constraints; do not claim PASS if `ON_ERROR_STOP` fired.  
6. Wipe plaintext work files.

Optional scripted path (still requires explicit flags + env var with isolated URL):

```powershell
$env:EES_RESTORE_DRILL_DB_URL = '<isolated postgres url>'  # never prod/dev
powershell -File scripts/prepare-production-backup-restore-drill.ps1 `
  -OwnerAuthorisedDecrypt `
  -IConfirmIsolatedTarget <NEW_TEMP_PROJECT_REF> `
  -ExecutePsqlRestore `
  -DatabaseUrlEnvVarName EES_RESTORE_DRILL_DB_URL
```

### E. Validation (counts only; no customer row dumps)

Baseline from production pre-migration probe:

| Table | Expected |
| --- | --- |
| `booking_diary` | 1572 |
| `fuel_logs` | 2729 |
| `ees_locations` | 103 |
| `ees_location_map_pins` | 0 |
| `account_access` | 4 |
| `vehicle_monthly_performance` | 149 |
| `maintenance_records` | 43 |

Also verify: table/function inventory ≈96/100; RLS enabled on critical tables; spot-check policies exist; indexes present; note Auth/Storage gaps as **expected**.

**PASS** only if counts match (or explained deltas), schema apply had no fatal errors, and target was confirmed isolated.  
**FAIL** must be recorded if any step aborts — do not soft-pass.

### F. Cleanup

- Wipe decrypt work directory  
- Delete temporary Supabase project after evidence captured  
- Keep encrypted backup + separated keys

## 6. Cost / additional permissions

| Option | Cost | Permission needed |
| --- | --- | --- |
| Temp Supabase Free project | Usually **$0** within free org limits until deleted | Owner creates project + authorises restore |
| Temp Pro project | Billed until deleted | Owner spend approval |
| Local PG smoke only | $0 | Local postgres superuser password + accept incomplete Auth/RLS fidelity |
| PITR / platform restore-to-new-project | Paid plan + backups | Separate; not required for this logical drill |

## 7. Exact owner approvals to execute restore

1. Confirm backup integrity recheck accepted.  
2. Authorise creation of a **new temporary** Supabase project (name/ref recorded).  
3. Authorise decrypt of `20261101-194605` into off-repo work dir.  
4. Authorise `psql` restore **only** into that new project (explicit ref confirmation).  
5. Authorise deletion of the temp project after PASS/FAIL evidence.  
6. After drill **PASS**: separate approval to re-open production Fleet Operations SQL gate.

## 8. Production migration GO/NO-GO

**NO-GO** — encrypted backup exists and integrity PASSes, but **restore has not been proven** on an isolated target yet.
