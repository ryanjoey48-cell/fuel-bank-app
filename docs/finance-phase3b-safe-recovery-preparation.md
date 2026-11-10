# Phase 3B: Safe database recovery preparation

Status: **NO-GO for disposable local database replay** until Docker is installed, production CLI link risk is controlled, and authoritative schema metadata is collected.  
Worktree: `codex/ees-finance-phase-1b`. No new branch. Uncommitted Finance and main Fleet/Forth work were inspected and left intact. No remote write, migration, unlink, relink, push, merge, or invoice action was performed.

## 1. Safe CLI configuration approach

### Current local risk (unchanged)

These **local** Supabase CLI metadata files in the Finance worktree currently name production:

| Local file | Observed value |
| --- | --- |
| `supabase/.temp/linked-project.json` | `ref: hafoaurzfgkkwpvzedvd` (“Fuel Tracker App”) |
| `supabase/.temp/project-ref` | `hafoaurzfgkkwpvzedvd` |
| `supabase/.temp/pooler-url` | Production pooler host for the same ref (no password stored in the inspected URL; still treat as sensitive) |

Development project ref (never treat as interchangeable): `wpmnjfncaoogssgppxek`.

There is **no** `supabase/config.toml` in this worktree. CLI remote targeting is driven by `.temp/*`. Renaming or deleting those files would affect **local CLI state only**; it does not change production. Phase 3B deliberately **did not** unlink, relink, rename, or delete them because that step requires explicit owner approval.

### Isolation rules (apply now)

1. From this worktree, do **not** run: `supabase db push`, `db reset`, `db pull`, `migration up`, `link`, `unlink`, `functions deploy`, or any command that needs a remote database URL.
2. Prefer `npx supabase` only for `--version` / docs until a disposable local project exists.
3. Before any future CLI DB command, require a host/project-ref guard that **fails closed** if the target is `hafoaurzfgkkwpvzedvd`.
4. Run disposable local Supabase from a **separate directory** outside both EES checkouts (see §5). That directory must have its own empty `.temp` and must never be linked to production or Development during Phase 3B preparation.

### Approved-later local isolation options (not executed)

| Option | Effect | Production impact | Needs approval |
| --- | --- | --- | --- |
| A. Continue freeze: never run remote CLI from Finance worktree | Safest short term | None | Already in force |
| B. Copy `.temp` aside and remove/rename `linked-project.json` + `project-ref` (+ pooler-url) in the worktree | Clears accidental remote target for this folder only | None (local metadata) | Yes |
| C. `supabase unlink` in this worktree | Clears link metadata via CLI | None if only unlink | Yes |
| D. `supabase link` to Development | Points CLI at `wpmnjfncaoogssgppxek` | None if correct project; high mis-link risk | Yes, after identity gate |

**Recommended sequence when approved:** A → install Docker → create disposable directory (never linked) → only then consider B or C on the Finance worktree → never D until a reviewed Development baseline exists.

## 2. Metadata collection procedure

Authoritative procedure: `supabase/development/read-only-collection.md` (updated in Phase 3B). Summary of the **least-privilege** path:

### Who must act

A database owner (or DBA) with a **temporary read-only** Postgres catalogue role on the confirmed production project. Do **not** use the browser anon key, service-role key, or application user password as a substitute for catalogue access.

### Collect (schema/metadata only)

- Schema-only definitions for `public` (tables, views, materialized views)
- Constraints and indexes
- Functions/procedures (review/redact bodies afterward) and triggers
- RLS flags, policies, and table/routine grants
- Required extensions (`pg_extension`)
- Storage **bucket** metadata and storage policies (not object bytes)
- Migration ledger: `version` column only from `supabase_migrations.schema_migrations`

### Never collect / never store in git

- Business rows, customer documents, storage file bytes
- `auth.users` contents, passwords, API keys, full connection strings with secrets
- Migration `statements` column (may embed identifiers)

### Preferred dump shape

Privileged `pg_dump --schema-only` (or dashboard-equivalent catalogue export) for `public`, plus storage bucket/policy metadata queries. Keep raw output **outside** the repository until redacted. Then compare to `supabase/development/migration-inventory.json` (99 files, 12 collision groups).

Insurance-scoped SQL already exists for a narrower live capture (`docs/insurance-compliance/read-only-live-metadata.sql`); Phase 3B still requires the **full public** schema export for baseline construction, not Insurance alone.

## 3. Missing-schema recovery status

| Object | In repository migrations | Other evidence | Authoritative for baseline? |
| --- | --- | --- | --- |
| `vehicle_insurance_compliance` | Altered only (`20260923090000_insurance_requirement.sql`); **no CREATE** | PostgREST OpenAPI snapshot `docs/insurance-compliance/live-schema-snapshot.json` (columns; explicitly lacks indexes/policies/triggers/functions) | **No** — need schema-only catalogue export or original CREATE migration |
| `ees_hr_admins` | Altered/assumed present from `20261013100000_ees_hr_v7_foundation.sql` onward; foundation **raises** if missing | PostgREST snapshot in `output/ees-hr-v7/schema-read-only.json`; synthetic CREATE in `tests/fixtures/hr-v7-base.sql` / `maintenance-centre-base.sql` | **No** — fixtures are test-only; snapshot lacks security objects |
| `ees_hr_meetings` | Same as above | Same | **No** |
| `ees_driver_vehicle_assignments` | Same as above | Same | **No** |

**Do not** promote test fixtures or OpenAPI property lists into a development baseline. They are recovery clues only. Owner action: provide schema-only DDL (or original creation migrations) covering constraints, indexes, RLS, grants, triggers, and functions for these four tables and their dependencies.

## 4. Tool installation requirements

Phase 3B PATH re-check:

| Tool | Status |
| --- | --- |
| Docker Desktop / `docker` | **Missing** |
| `psql` | **Missing** |
| Global `supabase` | **Missing** |
| `npx supabase --version` | **2.122.0** (usable only after Docker exists) |
| Node / npm / PGlite | Available (Finance unit/DB tests already pass) |

### Exact Windows setup (prepare only)

1. **Docker Desktop**
   - Install from Docker’s Windows installer; enable WSL 2 backend.
   - Verify: `docker version` shows Client **and** Server; `docker info` succeeds.
2. **Supabase CLI**
   - Install via Scoop/Chocolatey/official binary, **or** keep using `npx supabase` after Docker works.
   - Verify: `supabase --version` or `npx supabase --version`.
3. **PostgreSQL client tools** (recommended)
   - Install PostgreSQL 15+ command-line tools; ensure `psql --version` works.
4. **Do not** `supabase link` this Finance worktree during installation.

## 5. Local Supabase replay plan (do not execute yet)

Goal: prove a **disposable** local stack can host a reviewed baseline + Finance migrations without touching remotes.

1. Create `C:\Users\joery\.ees-local-supabase-disposable\` (or similar) **outside** both EES trees.
2. In that folder only: `npx supabase init` then `npx supabase start`.
3. Confirm local API/DB URLs are localhost; confirm `.temp/project-ref` is **not** `hafoaurzfgkkwpvzedvd` or `wpmnjfncaoogssgppxek`.
4. Apply the future reviewed **schema-only baseline** (no rows).
5. Apply only post-cutoff migrations with unique versions; then the five Finance migrations in order:
   1. `20261030100000_finance_verification_foundation.sql`
   2. `20261031100000_finance_paperwork_intake.sql`
   3. `20261102100000_finance_expenses_pricing.sql`
   4. `20261103100000_finance_weekly_billing_drafts.sql`
   5. `20261104100000_finance_invoice_approval_packs.sql`
6. Run the Finance test sequence in §5a.
7. `npx supabase stop` and delete the disposable directory.

Hard stop: if any command would use production/Development project refs or non-localhost DB hosts, abort.

### 5a. Finance migration test sequence (prepared)

Use synthetic users only (`office`, `finance_reviewer`, `management_reviewer`, `invoice_approver`, `pricing_approver` / `expense_approver`). Never production auth users.

| Step | Prove |
| --- | --- |
| Booking link | Finance rows reference real `booking_diary` UUIDs; no booking inserts from Finance RPCs |
| Auth / roles | Admin without grant cannot mutate; each capability is explicit |
| Paperwork / Storage | Private `ees-finance-paperwork` bucket; upload ≠ reviewed; office review required |
| Management hold | Open discrepancy blocks pricing readiness and billing |
| Immutability | Expense/price/approval/pack history reject UPDATE/DELETE |
| Allocations | One active draft per booking / work-order; concurrent conflict errors |
| Approval invalidation | Booking/price/paperwork/draft change invalidates pending/approved submissions and supersedes packs |
| Pack order | Pack lines equal approved revision order |
| Non-issuance | No `trn_number` / `invoice_number` / issue RPC |

Until Docker + baseline exist, continue proving SQL behaviour with the existing PGlite suite (`tests/finance-*-database.test.cjs`, `tests/job-verification-database.test.cjs`, etc.).

## 6. Exact user actions needed

1. **Approve** whether Finance worktree local link metadata may be cleared (option B/C in §1) — not done in Phase 3B.
2. **Install** Docker Desktop (+ optional `psql` / global Supabase CLI) and return verification command output.
3. **Run** the read-only collection as DB owner against production identity `hafoaurzfgkkwpvzedvd` only after the dashboard identity gate; store raw output outside git.
4. **Supply** authoritative schema-only DDL (or original migrations) for the four missing tables.
5. **Supply** the production migration `version` ledger (no `statements`).
6. **Do not** approve Development apply or main merge until local disposable replay passes.

## 7. Integration preservation (shared conflicts, no merge)

Main checkout `C:\Projects\EES\fuel-bank-app` remains on `main` (ahead of origin) with large uncommitted Fleet/Forth work. Five shared files still diverge:

| File | Finance worktree | Main checkout |
| --- | --- | --- |
| `app/(dashboard)/booking-diary/page.tsx` | Verify-job link to Finance | `BookingVehicleGpsChip` |
| `components/top-navigation.tsx` | Job Verification + Finance Centre | Fleet compact / Location Events |
| `next.config.ts` | Finance demo `pageExtensions` + isolated dist helper | MapLibre `transpilePackages` + isolated dist env |
| `package.json` | `dev:finance-demo` | `dev:stable` / isolated scripts + MapLibre deps |
| `tsconfig.json` | Finance QA `.next-*` includes | Fleet/Forth QA `.next-*` includes |

Do not merge these until an approved integration plan runs. Keep both uncommitted sets.

## 8. GO / NO-GO for disposable local replay

**NO-GO** to begin disposable local database replay now.

Blockers still open:

1. Docker (and preferably `psql`) not installed  
2. Production CLI link metadata still present in Finance `.temp`  
3. No privileged schema-only export  
4. No migration version ledger  
5. Four tables still lack authoritative CREATE/security definitions  

**GO** only for the preparation actions in §6 (tool install, owner metadata collection, optional approved local unlink/clear of `.temp` link files).

Phase 3B stops before any remote database operation and before any local Supabase start.
