# EES — production backup restore drill execution pack

**Backup:** `20261101-194605` (integrity PASS)  
**Forbidden:** `hafoaurzfgkkwpvzedvd` (production), `wpmnjfncaoogssgpqxek` (Development)  
**Proposed temp project name:** `ees-restore-drill-20261101`  
**Status:** Prepared only — **no project created, no restore executed**

Helper: `scripts/prepare-production-backup-restore-drill.ps1`  
Allowlist: `-AllowedRestoreProjectRef` **or** `EES_RESTORE_DRILL_ALLOWED_REF` (must equal the new 20-char ref)

---

## 1. Organisation capacity and charges

Org: **EXPERT EXPRESS SENDER CO., LTD** (`eaantipuplxbdxzjajim`)

| Project | Ref | Status |
| --- | --- | --- |
| Fuel Tracker App (production) | `hafoaurzfgkkwpvzedvd` | ACTIVE_HEALTHY |
| EES Development | `wpmnjfncaoogssgpqxek` | ACTIVE_HEALTHY |
| Expert Express Sender | `kiewhxiwxmpijhlldlpm` | INACTIVE |

**Free plan rule:** max **2 active** free projects (paused/inactive do not count).  
This org already has **2 ACTIVE** projects → **no Free slot remains** inside this org.

| Path | Charge risk | Notes |
| --- | --- | --- |
| **A. New Free organisation** for drill only | Usually **$0** | Recommended. Create Free org → create project `ees-restore-drill-20261101` → restore → delete project (and org if unused). |
| **B. Create project inside current org if it is Pro/Team** | **Paid compute** (Micro ~USD 10/mo, **prorated hourly** until deleted) | Owner must accept spend. Delete immediately after PASS/FAIL evidence. |
| **C. Pause Development to free a Free slot** | $0 but **disrupts staging** | Not recommended while Pilot 002 evidence lives on Development. |

**Owner must confirm org plan in Dashboard before create.**  
This pack does **not** create a paid resource without explicit spend approval.

---

## 2. Backup readiness (rechecked)

| Check | Result |
| --- | --- |
| `roles.sql.aes` / `schema.sql.aes` / `data.sql.aes` | Present + SHA256 PASS |
| Separated keys | `%LOCALAPPDATA%\EES\production-backup-keys\20261101-194605` |
| Plaintext beside backup | **0** |
| Coverage | public schema/data + roles (no role passwords) |
| Gaps | Auth, Storage objects, Edge Functions, Dashboard settings |

Baseline counts (production probe):

| Table | Expected |
| --- | --- |
| `booking_diary` | 1572 |
| `fuel_logs` | 2729 |
| `ees_locations` | 103 |
| `ees_location_map_pins` | 0 |
| `account_access` | 4 |
| `vehicle_monthly_performance` | 149 |
| `maintenance_records` | 43 |

---

## 3. Exact owner approvals required (in order)

1. **Choose billing path:** A (new Free org, $0) **or** B (current org Pro compute, paid until delete).  
2. **Authorise create** project named `ees-restore-drill-20261101` (region prefer `ap-northeast-1`).  
3. After create: send the agent the **new 20-char project ref** only (not DB password in chat if avoidable — use env).  
4. **Authorise decrypt + restore** into that ref only (allowlist enforced).  
5. **Authorise delete** of the temp project after PASS/FAIL report.  
6. If drill **PASS** → separate approval for production Fleet SQL (still not in this pack).

---

## 4. Executable procedure (after approvals 1–4)

### Step A — Owner creates isolated project

Dashboard → New organisation (if path A) → New project:

- Name: `ees-restore-drill-20261101`
- Database password: store locally (password manager), not in Git
- Region: `Northeast Asia (Tokyo)` / `ap-northeast-1` preferred

Record: `NEW_TEMP_REF=<20-char-ref>`

### Step B — Agent/operator verification (fail-closed)

```powershell
# Plan-only integrity
powershell -File scripts/prepare-production-backup-restore-drill.ps1

# Must refuse production/development; require allowlist
$env:EES_RESTORE_DRILL_ALLOWED_REF = '<NEW_TEMP_REF>'
$env:EES_RESTORE_DRILL_DB_URL = 'postgresql://postgres.<NEW_TEMP_REF>:<PASSWORD>@aws-0-....pooler.supabase.com:5432/postgres'
# Prefer direct db.<NEW_TEMP_REF>.supabase.co:5432 if pooler rejects session settings
```

### Step C — Authorised restore (single command)

```powershell
powershell -File scripts/prepare-production-backup-restore-drill.ps1 `
  -OwnerAuthorisedDecrypt `
  -IConfirmIsolatedTarget <NEW_TEMP_REF> `
  -AllowedRestoreProjectRef <NEW_TEMP_REF> `
  -ExecutePsqlRestore `
  -DatabaseUrlEnvVarName EES_RESTORE_DRILL_DB_URL
```

Behaviour:

- Decrypts off-repo under `%LOCALAPPDATA%\EES\restore-drill-work\20261101-194605`
- Refuses URL unless it contains allowlisted ref and excludes prod/dev
- Restores **schema.sql** then **data.sql** with `session_replication_role=replica` (isolated only)
- Skips full managed `roles.sql` conflicts by design of operator follow-up if needed (schema/data are the recovery proof)
- Prints **counts only** (no customer row dumps)
- Wipes plaintext after restore path

### Step D — Validation checklist → PASS/FAIL

**PASS only if all true:**

- [ ] Target ref ≠ production and ≠ Development  
- [ ] `booking_diary` = 1572  
- [ ] `fuel_logs` = 2729  
- [ ] `ees_locations` = 103  
- [ ] `ees_location_map_pins` = 0  
- [ ] `account_access` = 4  
- [ ] `vehicle_monthly_performance` = 149  
- [ ] `maintenance_records` = 43  
- [ ] Schema apply had no fatal `ON_ERROR_STOP` abort  
- [ ] Spot-check: RLS enabled on sample critical tables; function count roughly ~100  
- [ ] Plaintext work files wiped  

**Known non-failures (document, do not block public-data PASS):**

- Auth users/sessions not restored  
- Storage buckets/objects not restored  
- Edge Functions / API keys / Auth providers not restored  
- Role passwords not restored  

**FAIL** if any count mismatches without explained delta, or restore aborts, or wrong project touched.

### Step E — Cleanup

1. Delete temp Supabase project.  
2. Clear `EES_RESTORE_DRILL_DB_URL` from shell.  
3. Keep encrypted backup + separated keys.  
4. Write PASS/FAIL into `output/v20-3-restore-drill-result.json`.

---

## 5. Current gate

| Gate | Status |
| --- | --- |
| Backup integrity | **PASS** |
| Restore drill | **NOT RUN** — waiting owner create+restore approvals |
| Production V20 SQL | **NO-GO** |
