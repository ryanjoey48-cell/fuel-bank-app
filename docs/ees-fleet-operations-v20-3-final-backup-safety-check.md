# EES V20.3 — final backup safety check (before owner approval)

**Production:** `hafoaurzfgkkwpvzedvd`  
**Development (protected):** `wpmnjfncaoogssgpqxek`  
**Status:** Safety review only. No backup execution, SQL apply, deploy, commit, or push.

## 1. Credential exposure assessment

### What appeared

During an earlier **connectivity dry-run** (`supabase db dump --project-ref hafoaurzfgkkwpvzedvd --dry-run`), the CLI printed a generated bash script that included:

- `PGUSER=cli_login_postgres`
- `PGPASSWORD=<ephemeral value>`
- Host `db.hafoaurzfgkkwpvzedvd.supabase.co`

This was **not** requested by the backup helper as a durable secret store; it was CLI dry-run stdout.

### Was it a “real” credential?

**Yes, briefly — but not the permanent database password.**

Per Supabase CLI behaviour ([password-less login role](https://github.com/supabase/cli/pull/3885), [cli_login_postgres KB](https://supabase.com/kb/troubleshooting/permission-denied-when-deleting-the-cli-login-postgres-role)):

| Property | Assessment |
| --- | --- |
| Identity | Temporary role `cli_login_postgres` created when CLI runs without `SUPABASE_DB_PASSWORD` |
| Lifetime | Password typically expires in ~minutes (`rolvaliduntil`) |
| Privilege | Escalates to `postgres` for the dump session |
| Permanent `postgres` DB password | **Not** that value (Dashboard Database Settings password is separate) |
| Service role / anon API keys | **Not** involved |

### Where it may have been exposed

| Location | Finding |
| --- | --- |
| Agent terminal capture for that dry-run | Likely retained in Cursor terminal/agent logs on this machine |
| Git repository / `docs` / `output` / scripts | **Not found** (`PGPASSWORD=` search clean in repo) |
| Chat final answers | Must not restate the secret (and this document does not) |

**Risk level:** Moderate while the ephemeral password was valid; declining to low after expiry. Residual risk is log retention of historical stdout on the workstation / Cursor project logs.

## 2. Required credential rotation actions

### Recommended (proportional)

1. **Do not reuse** any password that appeared in dry-run output.  
2. Prefer future CLI dumps with `SUPABASE_DB_PASSWORD` set from a secure prompt / local secret store so `cli_login_postgres` is **not** minted (prevents recreation of the ephemeral flow).  
3. Optional hygiene: Dashboard → Project Settings → Database → reset **database password** if the owner wants belt-and-braces after log exposure.  
   - Dependencies: any local tools, pooler clients, or scripts using the **old** DB password must be updated.  
   - Expect brief Supavisor cache friction after rotate; retry connections.  
   - App Vercel `SUPABASE_SERVICE_ROLE_KEY` / anon keys are **JWT API keys**, not the DB password — usually unchanged by DB password reset.  
4. Optional: Management API delete of CLI login role (`DELETE /v1/projects/{ref}/cli/login-role`) — role will recreate if CLI runs again without DB password.  
5. Restrict access to Cursor project `terminals` / agent log folders on this PC.

### Not required solely because of this event

- Rotating anon/service-role keys (unless independently compromised).  
- Rotating Vercel env as a direct consequence (unless DB password is stored there — it is not in the inspected Production env name list).

## 3. Backup helper security status

File: `scripts/prepare-production-logical-backup.ps1` (**hardened this session**)

| Control | Status |
| --- | --- |
| Explicit owner authorisation | `-OwnerAuthorised` required |
| Strict production target verification | `-IConfirmProductionTarget hafoaurzfgkkwpvzedvd` required |
| Blocks Development | Hard-coded refuse of `wpmnjfncaoogssgpqxek`; env project-ref check |
| Destination outside git | Fail-closed path check |
| `--dry-run` disabled | Removed (was the credential leak vector) |
| Plaintext retained after encrypt | **Refused** (`-KeepPlaintext` throws) |
| Encryption errors | Fail-closed; attempts secure delete of plaintext |
| Filesystem permissions | `icacls` inheritance removed; current user only |
| Checksums | SHA256 of ciphertext written + re-validated |
| No production writes | Dump only |
| No sensitive values committed | Off-repo `%LOCALAPPDATA%\EES\production-backups`; gitignore patterns present |

Plan-only invocation (no dump):  
`powershell -File scripts/prepare-production-logical-backup.ps1`

## 4. Encryption and cleanup safety

On authorised run the helper:

1. Writes `roles.sql` / `schema.sql` / `data.sql` under a new timestamped off-repo directory.  
2. AES-256-CBC encrypts each to `*.aes` with a random key in `backup.key` (same restricted folder).  
3. Overwrites then deletes plaintext `.sql`.  
4. Verifies SHA256 of ciphertext.  
5. On any error: attempts plaintext wipe before exit.

**Owner follow-up:** move `backup.key` to a separate secure store from the `.aes` files when practical.

## 5. Temporary restore requirements and approximate costs

| Item | Requirement |
| --- | --- |
| Target | **New temporary** Supabase project only |
| Forbidden | Development `wpmnjfncaoogssgpqxek`, production `hafoaurzfgkkwpvzedvd` |
| Logical restore gaps | Default CLI dump excludes managed `auth` / `storage` / many internals → **partial** recovery of `public` app data; Auth users, Storage objects, Edge Functions, API keys, Auth provider settings need manual handling |
| Extensions / roles | Re-check after restore; custom LOGIN passwords not in dump |
| Approx cost | Free-tier temp project: usually $0 compute within free limits; Pro temp project: billed until deleted. Platform “Restore to a New Project” needs **paid plan + listed physical backup** (currently **not** verified via CLI). PITR add-on still optional (~$100+/mo) — not required for logical drill |

## 6. Exact owner approvals to run the backup

1. Acknowledge ephemeral `cli_login_postgres` exposure and choose optional DB password reset hygiene.  
2. Authorise **encrypted logical dump** of production (or confirm Dashboard physical backups instead).  
3. Authorise use of off-repo path `%LOCALAPPDATA%\EES\production-backups\...`.  
4. After dump: authorise **temporary restore-drill project** creation (not Development).  
5. After drill PASS: re-open production SQL gate (separate approval).

Approved dump command shape (only after 1–3):

```powershell
powershell -File scripts/prepare-production-logical-backup.ps1 `
  -OwnerAuthorised `
  -IConfirmProductionTarget hafoaurzfgkkwpvzedvd
```

## 7. Production migration GO/NO-GO

# NO-GO

No proven restore artifact / drill yet. Fleet Operations SQL, deploy, monitor, and notifications remain blocked.
