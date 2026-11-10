# EES — Free restore project eligibility (read-only)

**Decision preference:** Option A (temporary Free org + `ees-restore-drill-20261101`) **only if genuinely $0**.  
**Result:** **NOT ELIGIBLE** for one additional active Free project at $0.  
**Protected:** do not pause/delete/transfer `hafoaurzfgkkwpvzedvd` or `wpmnjfncaoogssgpqxek`.  
**Actions taken:** inspection only — no project create, no charges, no decrypt/restore, no SQL/deploy.

## Exact organisation subscription status

| Field | Value |
| --- | --- |
| Organisation | EXPERT EXPRESS SENDER CO., LTD |
| Org id / slug | `eaantipuplxbdxzjajim` |
| Subscription plan (API) | **`free`** |
| Orgs visible to this account | **1** (this org only) |

Source: `GET /v1/organizations/{id}` → `"plan":"free"`.

## Active Free project count (account-wide)

Free quota is **2 active Free projects across all orgs** where the user is Owner/Admin. A second Free organisation does **not** add two more Free slots.

| Project | Ref | Status | Counts toward Free active quota? |
| --- | --- | --- | --- |
| Fuel Tracker App (production) | `hafoaurzfgkkwpvzedvd` | `ACTIVE_HEALTHY` | **Yes** |
| EES Development | `wpmnjfncaoogssgpqxek` | `ACTIVE_HEALTHY` | **Yes** |
| Expert Express Sender | `kiewhxiwxmpijhlldlpm` | `INACTIVE` | **No** (inactive/paused excluded) |

**Active Free projects in use: 2 / 2.**  
**Remaining $0 active Free slots: 0.**

## Eligibility for one more $0 project

| Question | Answer |
| --- | --- |
| Can we create another Free project in this org? | **No** — Free active quota exhausted |
| Can a new Free org unlock another Free project? | **No** — quota is account-wide for Owner/Admin |
| Would payment details / upgrade be required for a *cloud* third active project? | **Yes** — paid organisation plan (typically Pro) and/or paid compute for an additional project |
| Preserve prod + Development without pause/delete/transfer? | Required → **blocks** freeing a Free slot |

**STOP on Option A as a genuine $0 path.**

## If cloud restore is still required later (paid)

| Option | Billing implication (approx.) |
| --- | --- |
| Upgrade this org Free → Pro, then create temp project | Pro org ~**USD 25/mo** + additional project Micro compute ~**USD 0.01344/hour (~$10/mo)** until deleted |
| New paid org solely for drill | Similar or higher; still not $0 |
| Add-ons (PITR, custom domain, larger compute) | **Not required** for this logical restore drill; keep off |

Any paid path needs **separate explicit spend approval**. Not authorised in this check.

## Alternative: no-additional-charge local restore path

Local PostgreSQL **17.11** is installed (`postgresql-x64-17` running). This can support a **meaningful public-schema recovery test** at **$0**, without a cloud project.

### What a local drill CAN validate
- Decrypt + restore of `schema.sql` / `data.sql` off-repo
- Row counts for Booking Diary, Fuel Logs, Locations, Maintenance, Vehicle Performance, account_access
- Presence of indexes/constraints/functions in `public`
- Circular FK handling via `session_replication_role=replica` on the **local** DB only
- Cleanup of plaintext work files

### What a local drill CANNOT validate
- Full Supabase Auth (`auth.uid()` / GoTrue users) behaviour
- Storage buckets/objects
- Hosted RLS as experienced through PostgREST + JWT roles exactly as in cloud
- Dashboard/API keys, Edge Functions, pooler, platform role wiring
- “Restore to a New Project” physical backup path

**Verdict:** Local drill is a strong **operational data recovery** proof for the logical backup, but **not** a full platform disaster-recovery clone. It is the only **confirmed $0** path that preserves both existing EES cloud projects.

Prerequisite: owner must provide a **local disposable** Postgres superuser password (or authorise creating a local role/database) — not the production DB password. No production credentials in local config.

## Security controls (restore environment)

| Control | Status |
| --- | --- |
| Restricted admin access | Local: Windows ACL on backup/key/work dirs (current user). Cloud (if later): EES-controlled org only |
| No production credentials in restore project config | Enforced — use fresh local DB password / temp project password only |
| Keys separate from ciphertext | `%LOCALAPPDATA%\EES\production-backup-keys\…` vs `production-backups\…` |
| No plaintext in Git | Off-repo work dir; helper wipes after restore path |
| No public customer data exposure | Counts-only validation; no row dumps in reports |
| Cleanup | Wipe work dir; drop local DB / delete temp cloud project after PASS/FAIL |

## Restore-target guard verification

Helper: `scripts/prepare-production-backup-restore-drill.ps1`

Negative tests (authorised decrypt attempted):

| Target / allowlist | Result |
| --- | --- |
| production `hafoaurzfgkkwpvzedvd` | **REFUSED** |
| Development `wpmnjfncaoogssgpqxek` | **REFUSED** |
| production target with mismatched allowlist | **REFUSED** |

Allowlist requires exact 20-char ref via `-AllowedRestoreProjectRef` / `EES_RESTORE_DRILL_ALLOWED_REF`; URL must contain that ref.

## Exact owner approvals needed next

**For $0 path (recommended given ineligibility):**
1. Authorise **local disposable PostgreSQL restore drill** (new local DB name e.g. `ees_restore_drill_20261101` only).  
2. Provide/authorise local DB admin access (not production password).  
3. Authorise decrypt + restore into that local DB only.  
4. Authorise wipe/drop of local drill DB after report.

**For paid cloud path (only if owner rejects local):**
1. Explicit spend approval (Pro upgrade and/or temp project compute).  
2. Create paid/eligible temp project `ees-restore-drill-20261101`.  
3. Authorise decrypt + restore into that ref.  
4. Authorise delete immediately after PASS/FAIL.

## Gate

**Production V20 SQL: NO-GO** until a suitable recovery drill PASSes (local public-data PASS may reopen the gate for SQL if owner accepts logical-backup limitations; full platform DR still incomplete without Auth/Storage).
