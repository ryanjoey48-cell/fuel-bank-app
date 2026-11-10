# Phase 3A: Development database recovery and integration readiness

Status: **NO-GO for applying any Finance baseline to EES Development or production.**  
Branch/worktree: `codex/ees-finance-phase-1b` (no new branch). Uncommitted Finance Centre work was inspected and left intact. The separate main checkout at `C:\Projects\EES\fuel-bank-app` retains substantial uncommitted Fleet/Forth work and was not modified.

## 1. Database baseline readiness

| Item | Status |
| --- | --- |
| Production project | `hafoaurzfgkkwpvzedvd` |
| Development project | `wpmnjfncaoogssgppxek` |
| Authoritative schema-only export | **Missing** |
| Production migration ledger (`version` only) | **Missing** |
| Versioned development baseline | **Not approved / not built** |
| Local disposable Supabase replay | **Blocked** (no Docker/psql; CLI only via `npx`) |
| Finance migrations applied remotely | **None** (local files only) |

`supabase/development/` remains a preparation area, not an executable migration directory. Prefer a **new versioned baseline** from a privileged schema-only catalogue export, reviewed against the app and repository migrations, with no business rows, auth users, or secrets. Do not point a fresh development project at the existing `supabase/migrations` directory until collisions and missing creations are reconciled.

**Safety note:** `supabase/.temp/linked-project.json` currently names production (`hafoaurzfgkkwpvzedvd`). Treat the Finance worktree as **linked-to-production for CLI purposes** until an owner explicitly unlinks and re-targets a disposable or development project. No `supabase db` / push / reset command was run in Phase 3A.

## 2. Missing definitions and migrations

### Inventory (regenerated locally)

- Migration files now: **99** (was 95; includes five Finance migrations through Phase 2F).
- Duplicate version groups: still **12**.
- Tables altered in repository migrations with **no repository `CREATE TABLE`**:  
  `vehicle_insurance_compliance`, `ees_hr_admins`, `ees_hr_meetings`, `ees_driver_vehicle_assignments`.

### Finance migrations prepared (unapplied remotely)

1. `20261030100000_finance_verification_foundation.sql`
2. `20261031100000_finance_paperwork_intake.sql`
3. `20261102100000_finance_expenses_pricing.sql`
4. `20261103100000_finance_weekly_billing_drafts.sql`
5. `20261104100000_finance_invoice_approval_packs.sql`

### Still required from a database owner (read-only)

Follow `supabase/development/read-only-collection.md`:

1. Confirm project identity before every connection.
2. Collect `supabase_migrations.schema_migrations.version` only (no `statements`).
3. Privileged **schema-only** export of `public` (constraints, functions, triggers, grants, RLS, policies) plus storage bucket metadata.
4. Authoritative Insurance/HR table definitions (not PostgREST snapshots or test fixtures alone).
5. Redact secrets before any schema material enters the repository.

Do not invent missing tables, policies, or historical rows. Do not rename collision-group files already recorded in production without the ledger.

## 3. Local Supabase replay results

| Tool | Result |
| --- | --- |
| Docker | **Not installed / not on PATH** |
| `supabase` CLI binary | **Not on PATH** |
| `npx supabase --version` | **2.122.0** (downloadable, but cannot start local stack without Docker) |
| `psql` / PostgreSQL server tools | **Not on PATH** |
| PGlite Finance migration tests | **Pass** (focused synthetic schema; not a full Supabase replay) |

**Local replay: not executed.** Full Auth, Storage, and platform-level RLS proof remains blocked until Docker Desktop (or equivalent) and a disposable `supabase start` environment exist.

### Precise setup instructions (local only)

1. Install Docker Desktop for Windows with WSL 2 backend; confirm `docker version` shows a running engine.
2. Install Supabase CLI (or continue using `npx supabase`) and confirm `supabase --version`.
3. Install PostgreSQL client tools so `psql --version` works (optional but useful for catalogue checks).
4. Create a **new empty directory** outside this worktree for disposable local Supabase (do not `supabase link` to production).
5. In that disposable directory: `supabase init` then `supabase start`. Record the local project identity and empty migration ledger.
6. Only after a reviewed baseline SQL exists: apply baseline → apply post-cutoff migrations in unique version order → run Auth/RLS/Storage drills → destroy the instance.
7. Never run remote commands against `hafoaurzfgkkwpvzedvd`. Any future Development apply requires a separate written approval and project-ref/URL-host guard on every command.

## 4. Auth, RLS and Storage test results

| Check | Evidence | Result |
| --- | --- | --- |
| Full local Supabase Auth | Requires disposable stack | **Not run** |
| Platform Storage policies | Requires disposable stack + private bucket | **Not run** |
| Finance role grants vs admin | PGlite DB tests | **Pass** (admin alone insufficient; explicit capabilities required) |
| Paperwork upload ≠ verified | PGlite paperwork DB test | **Pass** |
| Management discrepancy blocks readiness | PGlite verification/pricing/billing tests | **Pass** |
| Immutable price/expense/approval history | PGlite append-only triggers | **Pass** |
| Unique billing allocations | PGlite weekly billing test | **Pass** |
| Approval invalidation on material change | PGlite invoice approval test | **Pass** |
| Pack order matches approved lines | PGlite pack test | **Pass** |
| No TRN/invoice issuance columns or RPCs | Migration + UI static tests | **Pass** |

PGlite proves Finance SQL behaviour against a synthetic minimal schema. It does **not** prove a fresh EES Development database can be installed from historical migrations.

## 5. Finance Centre integration readiness

### Preserve both worktrees

- Finance worktree: large uncommitted Finance surface + light shared-file edits.
- Main checkout: large uncommitted Fleet/Forth/Locations surface + different shared-file edits.
- Shared files that **differ** and must be merged manually later:  
  `booking-diary/page.tsx`, `top-navigation.tsx`, `next.config.ts`, `package.json`, `tsconfig.json`.

### Overlap summary (do not merge yet)

| File | Finance change | Main change | Integration approach |
| --- | --- | --- | --- |
| `booking-diary/page.tsx` | Link to `/job-verification` | `BookingVehicleGpsChip` on cards | Keep both; additive UI only |
| `top-navigation.tsx` | Job Verification + Finance Centre items | Fleet compact mode, `/fleet-events`, focus/blur behaviour | Merge nav items into current Fleet nav structure |
| `next.config.ts` | Finance demo pageExtensions + isolated dist dir helper | MapLibre transpilePackages + alternate isolated dist env | Combine flags; keep production excluding `demo.tsx` |
| `package.json` | `dev:finance-demo` script | `dev:stable`, isolated build/start, MapLibre deps | Union scripts and dependencies |
| `tsconfig.json` | Extra `.next-finance-*` types include | Multiple Fleet/Forth `.next-*` includes | Union includes; avoid deleting either side’s QA dirs |

### Safest consolidation sequence (approval required before execution)

1. Freeze both worktrees (no discard/reset). Optionally commit each track separately when the owner requests commits.
2. Bring Fleet/Forth main work to a reviewed, tested state first (or park it), because it already touches production-adjacent ops surfaces.
3. Create an integration branch **from the chosen main baseline** only after approval (not done in Phase 3A).
4. Cherry-pick or copy **Finance-only paths** first (`app/(dashboard)/finance-*`, `invoice-approval`, `document-packs`, `paperwork-inbox`, `job-verification`, `weekly-billing`, `lib/finance-*`, `lib/job-verification*`, Finance migrations/tests/docs).
5. Manually merge the five shared files with the table above; run focused Finance + Fleet smoke tests after each shared-file merge.
6. Do **not** apply Finance SQL to Development until baseline recovery clears the gates below.
7. One integrated EES app is the goal; permanent dual branches are not.

## 6. Regression findings

### Focused Finance suite

**59/59 passed** (verification, paperwork, expenses/pricing, weekly billing, invoice approval/packs, demos, historical source).

### Booking-related regressions

**107/110** in the sampled Booking/Maps/route set. Three failures are **pre-existing at HEAD** and unrelated to Finance logic:

1. `Booking Diary location review stays admin-only...` — expects `NEXT_PUBLIC_BOOKING_LOCATION_REVIEW_ENABLED` in diary page; absent in committed and Finance-edited diary.
2. `Booking check UI exposes field confirmations...` — expects `Booking check` label; absent in current diary UI.
3. `Trip Journey receives and persists booking aliases...` — expects contiguous JSX `<LocationAutocomplete...updateTripStructuredLocation("pickup"`; current trip page imports the component and defines the helper but no longer matches that static pattern.

Finance diary diff only adds a Verify-job link. Do not “fix” these by rewriting Booking/Trip product behaviour inside the Finance track.

### TypeScript / build

- `npx tsc --noEmit`: **passed**
- Isolated production build (`.next-finance-phase3a`): **passed**
- Routes include `/invoice-approval`, `/document-packs`, `/weekly-billing`; `/finance-demo` **excluded** from production

## 7. Exact remaining blockers

1. No privileged schema-only export of the real EES schema.
2. No production migration ledger (`version` list) to resolve the 12 collision groups.
3. No authoritative Insurance/HR CREATE definitions (indexes, RLS, grants, triggers, functions).
4. Docker / local PostgreSQL tooling missing → no disposable Supabase replay.
5. Worktree CLI link metadata currently points at **production**.
6. Development project baseline history still unresolved.
7. Shared-file conflicts with uncommitted Fleet/Forth main work.
8. Three stale Booking/Trip static tests (test/UI reconciliation outside Finance).
9. Open Finance product decisions (tax/OT/settlement, TRN print pack sign-off, issuance/payment phases) still block live invoicing later — not required for baseline recovery, but required before issuance.

## 8. GO / NO-GO

**NO-GO** for applying the Finance migrations or any reconstructed baseline to EES Development (`wpmnjfncaoogssgppxek`) or production (`hafoaurzfgkkwpvzedvd`).

**GO** only for the next **preparation** steps:

1. Owner runs the read-only collection procedure and supplies redacted schema + version ledger.
2. Install Docker + confirm local `supabase start` in a disposable directory (never linked to production).
3. Keep both Finance and Fleet/Forth uncommitted sets preserved until an approved integration plan is executed.
4. Continue using PGlite Finance tests as the local SQL proof gate until a real baseline exists.

Phase 3A stops before any remote database operation.
