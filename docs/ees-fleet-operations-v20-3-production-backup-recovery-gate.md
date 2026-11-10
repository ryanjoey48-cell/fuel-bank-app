# EES V20.3 — production backup & recovery gate

**Production:** `hafoaurzfgkkwpvzedvd` (Fuel Tracker App)  
**Development (protected):** `wpmnjfncaoogssgpqxek` — **do not overwrite**; CAL-COMP + Pilot 002 live here  
**Vercel:** `fuel-bank-app` only  
**Status:** Procedures prepared. Full data export / restore drill / SQL apply **not** executed without owner authorisation.

## Verdict (this session)

| Gate | Decision |
| --- | --- |
| Platform physical restore point verified | **NO** (`backups: null`, `physical_backup_data: {}`, `pitr_enabled: false`) |
| Logical backup procedure ready | **YES** (prepared; not executed) |
| Restore drill proven | **NO** (blocked until backup exists + isolated target approved) |
| Production SQL release gate | Remains **NO-GO** |

`walg_enabled: true` alone is **not** a usable restore point.

---

## 1. Available production backup options

### A. Platform daily physical backups (Dashboard / CLI)

| Fact | Source |
| --- | --- |
| CLI | `supabase backups list --project-ref hafoaurzfgkkwpvzedvd` → no listed backups; PITR false |
| Docs | Pro/Team/Enterprise get automatic daily physical backups; Free should use CLI logical dumps |
| Restore in place | Dashboard → Database → Backups (project downtime) |
| Restore to new project | Paid plans with physical backups enabled; creates **new** project (does not touch Development) |
| PITR add-on | Optional paid (~USD 100/mo for 7-day window) + ≥ Small compute; **not** enabled; do not buy without approval |

**Owner Dashboard check (required):**  
https://supabase.com/dashboard/project/hafoaurzfgkkwpvzedvd/database/backups  

If the UI shows dated daily backups, platform restore is preferred over logical dump. If the UI also shows none, treat as Free / no consumable physical backup.

### B. Encrypted logical backup (CLI `db dump`) — recommended when A is unavailable

Official Supabase path for Free / offline copies:

1. `roles.sql` — `--role-only`  
2. `schema.sql` — schema-only (default dump; excludes managed internal schemas)  
3. `data.sql` — `--data-only --use-copy`  

**What a full recoverable logical set includes:** roles + schema + data for application schemas the CLI dumps (typically `public` objects; CLI excludes many platform internals).

**What remains partial / manual:**

| Area | Logical dump behaviour |
| --- | --- |
| `auth` / `storage` schemas | Excluded by default CLI filters — Auth users & Storage **objects** not fully portable via default dump |
| Storage files | Not in DB dump (metadata only if storage schema included separately) |
| Edge Functions / Auth provider settings / API keys | Not in dump |
| Custom LOGIN role passwords | Not restored; must be reset |
| Vault secrets | May be opaque without root key (platform “restore to new project” copies encryption key; logical restore does not) |

**Classification:**

- **Full recoverable platform backup** = physical daily / PITR + restore-to-new-project (or in-place restore).  
- **Partial logical export** = CLI roles+schema+data for `public` app tables (Booking Diary, Fuel Logs, Locations, Maintenance, etc.) — excellent for **preserving operational EES data** before DDL; **not** a 1:1 clone of the entire Supabase project.

For the V20 SQL gate, a verified **encrypted logical backup of `public` operational data + schema + roles**, plus a restore drill into an **isolated throwaway project**, is the minimum bar when physical backups are absent.

### C. Enable PITR / upgrade plan

Requires owner approval and spend. Not recommended as the first step solely to unblock V20 if a logical backup + restore drill can be completed sooner.

---

## 2. Recommended backup method (now)

**Primary recommendation:** Owner-authorised **encrypted logical backup** to **off-repo** disk, then restore drill into a **new temporary Supabase project** (never into `wpmnjfncaoogssgpqxek`).

**If** Dashboard already shows Pro daily backups: use **Restore to a New Project** for the drill instead (still never overwrite Development).

---

## 3. Exact safe logical backup procedure (do not run until authorised)

### Preconditions

- Maintenance window optional but preferred (read-only dump; still avoid peak load).  
- Docker available (CLI runs `pg_dump` in a container).  
- Destination **outside** the git repo, e.g. `%LOCALAPPDATA%\EES\production-backups\<timestamp>\`  
- Encryption passphrase stored in a password manager — **not** in git / chat / `.env` committed files.  
- Add to machine hygiene: never commit `*.sql.dump`, `*.sql.gpg`, backup folders.

### Commands (owner-run; secrets not logged)

```powershell
# 1) Create off-repo directory
$ts = Get-Date -Format "yyyyMMdd-HHmmss"
$dest = Join-Path $env:LOCALAPPDATA "EES\production-backups\$ts"
New-Item -ItemType Directory -Force -Path $dest | Out-Null

# 2) Dump (prompts/uses linked auth; do not paste passwords into chat)
npx supabase db dump --project-ref hafoaurzfgkkwpvzedvd -f "$dest\roles.sql" --role-only
npx supabase db dump --project-ref hafoaurzfgkkwpvzedvd -f "$dest\schema.sql"
npx supabase db dump --project-ref hafoaurzfgkkwpvzedvd -f "$dest\data.sql" --data-only --use-copy

# 3) Encrypt (example: gpg symmetric). Delete plaintext after verify.
gpg --symmetric --cipher-algo AES256 -o "$dest\ees-prod-$ts.tar.gpg" `
  (Compress-Archive then encrypt, or encrypt each file)

# 4) Record checksums of ciphertext only; store passphrase offline
Get-FileHash "$dest\*.gpg" -Algorithm SHA256 | Out-File "$dest\SHA256SUMS.txt"
```

Helper script (prints steps; **refuses** to dump unless `--owner-authorised`):  
`scripts/prepare-production-logical-backup.ps1`

### Safety rules

- Read-only intent; use dump only (no DDL/DML).  
- Do not print DB URLs/passwords.  
- `--dry-run` can print ephemeral CLI credentials to the console — do not capture dry-run output into git.  
- Do not place backup files under `C:\Projects\EES\fuel-bank-app`.

---

## 4. Restore target requirements (isolated drill)

### Forbidden

- Restoring into **EES Development** `wpmnjfncaoogssgpqxek`  
- Restoring into production `hafoaurzfgkkwpvzedvd` for a “test”  
- Copying production data into Development

### Allowed targets

| Option | Pros | Owner cost / permission |
| --- | --- | --- |
| **New temporary Supabase project** (e.g. `ees-prod-restore-drill`) | Clean isolation; keep Development intact | New project on current org plan (Free compute or Pro project fee as applicable); delete after drill |
| Platform **Restore to a New Project** from physical backup | Closest to full recoverable backup | Paid plan + listed physical backup; new project billing until deleted |
| Local Docker Postgres | Cheap drill for `public` schema/data only | No Supabase Auth/Storage parity; partial only |

### Restore drill checklist (logical → new project)

1. Create empty target project (owner).  
2. Before schema restore: revoke default privileges on `anon`/`authenticated` per Supabase migrate docs if preserving grants.  
3. Apply `roles.sql` → `schema.sql` → `data.sql` via `psql` / SQL Editor in order.  
4. Verify counts vs production pre-counts (Booking Diary, Fuel Logs, Locations, Maintenance, Vehicle Performance, `account_access`).  
5. Spot-check FKs/indexes (`pg_indexes`, `\d+`).  
6. Confirm RLS enabled on critical tables; spot-check policies.  
7. List extensions (`pg_extension`).  
8. Note Auth/Storage gaps explicitly (expected for partial logical).  
9. Document pass/fail; **delete** temporary project when done.  
10. Re-open SQL gate only if drill **PASS**.

### Pre-migration production counts (baseline)

| Table | Count |
| --- | --- |
| `ees_locations` | 103 |
| `ees_location_map_pins` | 0 |
| `booking_diary` | 1572 |
| `fuel_logs` | 2729 |
| `account_access` | 4 |
| `vehicle_monthly_performance` | 149 |
| `maintenance_records` | 43 |

---

## 5. Reopening the production SQL gate (after proven backup)

Still **do not apply** until backup + drill PASS and owner SQL approval.

| Package | Status once recovery proven |
| --- | --- |
| Map-pin preflight / repair if needed | Candidate |
| V20 fleet SQL (`is_active` + fleet tables) | Candidate |
| Forth import/audit SQL | Candidate |
| V20.2 review + outbox SQL | Candidate |
| Staging booking stub / synthetic data | **Excluded** |

Rollback: V20.2 → Forth → V20 SQL rollbacks; catastrophic path = restore from the proven backup artifact / platform backup.

---

## 6. Main-site release posture (unchanged)

- Vercel `fuel-bank-app` + production Supabase URL only  
- Monitor / operational push / Web Push TEST **disabled**  
- App may deploy gated later; SQL still blocked by this recovery gate  
- No new Vercel projects / redesign / unnecessary branches  

---

## Exact next action

1. Owner opens Production Backups Dashboard and reports whether dated physical backups exist.  
2. If **no**: authorise encrypted logical dump (procedure above) **or** approve Pro/physical backup path.  
3. Authorise creation of a **temporary** restore-drill project (not Development).  
4. Complete restore drill + count verification.  
5. Re-run release gate → only then consider SQL **GO**.
