# Expenses Centre V1.1 — owner approval and safe activation plan

**Status: preparation only; no remote migration, seed, configuration write or activation performed.**

## Verified findings — 10 November 2026

The repository's environment registry identifies the main `.env.local` and Vercel-preview profile as **confirmed production**. Neither has an Expenses-specific approval flag. Their contents were not changed.

`.env.staging.local` identifies a different project, **EES Development** (`wpmnjfncaoogssgpqxek`). The read-only probe checked the credential's project claim where available and requested only schema metadata (`GET …?select=*&limit=0`), API definitions and bucket configuration. It did not retrieve financial rows, call an RPC or write anything.

| Candidate capability | Read-only result |
| --- | --- |
| `account_access`, `driver_accounts` | Available through REST (200) |
| `vehicles` | Unavailable through REST (`PGRST205`, 404) |
| All seven Expenses application tables/configuration | Unavailable through REST (`PGRST205`, 404) |
| Expenses RPC endpoints | Not exposed in the inspected API definitions |
| Private `expenses-receipts` bucket | Not verified; bucket metadata request returned 400 |
| Approval for Expenses testing | **Not present** |

Evidence: `tmp/expenses-v11-readiness.json`. An unavailable REST definition is not permission to recreate an existing SQL object: inspect the actual SQL schema first. The existing Fleet staging documentation does not authorise Expenses migrations, authentication changes, use of company records or production writes.

## Decision the owner must approve

Approve a specific **isolated, non-production Expenses test installation**, its prerequisites, synthetic accounts/vehicles/documents and retention policy. EES Development is a candidate, not an automatically approved target. If another project is selected, verify its identity and update the test allowlist deliberately before using these launchers.

Do not apply the following files until that approval exists. No command in this package automatically applies SQL. Never bulk-run all repository migrations or run `supabase db push` for this task.

## Exact installation order after approval

1. Record the owner, approval date, target project URL/reference and purpose. Verify the SQL editor/project, server key and browser public key all refer to that target. Confirm it is not the confirmed production project. Agree backup/restore and test-data retention with whoever manages the existing development project.
2. Re-run `node scripts/expenses-readiness.cjs .env.staging.local`. This remains read-only. Run `docs/expenses-v11-activation-preflight-read-only.sql` in that **test** project's SQL editor. Inspect account columns/roles, `auth.uid()`, `is_office_account()`, `driver_accounts`, Vehicles schema, table grants and storage policies. If an authentication prerequisite is absent, stop and review the existing official authentication installation; this feature does not replace it.
3. If Vehicles is genuinely absent, review `docs/expenses-v11-test-vehicles-prerequisite-review-only.sql`. It copies the canonical Vehicles table definition from `supabase/schema.sql`, creates no registrations and refuses to overwrite an existing Vehicles table. Acknowledge the verified target in the SQL session using `set ees.expenses.approved_test_project_ref = 'wpmnjfncaoogssgpqxek';` before executing it. This marker records operator acknowledgement; it cannot independently prove that the correct SQL editor was selected.
4. Apply **only** `supabase/migrations/20261109090000_expenses_centre_review_only.sql`, then `supabase/migrations/20261110100000_expenses_centre_v11_review_only.sql`, after both are reviewed. Each is transactional. They do not import financial history. Configuration stays disabled. V1.1 adds schema version 2, validated cumulative partial-payment amounts and a bucket-specific restrictive policy that defeats older permissive storage policies for receipts while leaving other buckets' rules unchanged.
5. Through the existing account-management system, create distinct synthetic submitter/reviewer accounts and appropriate read-only, suspended and driver test accounts. Do not promote, suspend or rename actual employees for testing. The synthetic submitter and reviewer display names must begin `Expenses V11 fixture`; submitter is active office staff, reviewer is active admin/super-admin. Self approval remains disallowed, including for administrators, because no company self-approval exception was supplied.
6. If the test Vehicles table is empty, review `docs/expenses-v11-synthetic-vehicles-review-only.sql`. Supply the two synthetic account UUIDs in `ees.expenses.test_submitter_id` and `ees.expenses.test_reviewer_id`. It refuses a non-empty fleet, creates only two explicitly synthetic vehicles and creates no expenses or payments. The real company's fleet is never copied or altered.
7. Re-run the read-only preflight. Verify Expenses tables have RLS and authenticated SELECT only, direct mutation grants are absent, command/finalisation execution grants are correct, storage RLS is enabled, the bucket is private and its MIME/size limits are correct. Verify `expenses_receipts_server_only` is **RESTRICTIVE** for anonymous/authenticated access to this bucket. Inspect all existing storage policies; do not change unrelated buckets. Confirm an administrator can retain/download removed evidence while ordinary users cannot.
8. After owner review of that readiness and the acceptance plan, run `docs/expenses-v11-activation-review-only.sql` **on the approved test target only**. It requires the target acknowledgement, schema version 2, private bucket, storage RLS and restrictive policy before enabling test writes.
9. Copy `.env.expenses-test.example` to the already-gitignored `.env.expenses-test.local`. Fill it with this test project's keys only, then set `EES_EXPENSES_APPROVED_SUPABASE_URL` to the same URL and `EES_EXPENSES_WRITES=approved-safe-environment` only after approval. Do not edit `.env.local`. Never give a service key a `NEXT_PUBLIC_` name.
10. Run `node scripts/start-expenses-approved-test.cjs .env.expenses-test.local`. It refuses production, mismatched approval and missing/obviously mismatched credentials; it does not reuse the parent's database credentials, migrate or seed. It starts a separate authenticated test app on `http://127.0.0.1:3020`, leaves localhost:3000 intact, disables fixture/Finance preview bypasses and uses a separate build directory. A successful start is not a persistence test; the application still checks schema, private storage and database activation.

## Required acceptance before office use

- Use synthetic receipts and costs only. Create a general/depot/office expense without a vehicle and an expense against each synthetic registration, including Thai search and a personal car. Confirm the actual submitter comes from the verified session.
- Save multiple real-format JPG/PNG/PDF/HEIC documents. Confirm original byte hashes, database metadata, private objects and state `ready`. Interrupt uploads, retry the same file, and confirm no pending upload can be submitted. Check that refresh/re-login retrieves the same originals rather than a browser-only blob.
- Verify a submitted expense and its documents survive refresh, sign-out, a fresh browser session and retrieval from a second office device. Compare identifiers, exact THB amounts and audit history.
- Use a separate manager for needs-information, correction, rejection, approval, cumulative partial payment, final payment, close and void. Approval must leave payment amounts untouched. Test direct RPC/table attempts as ordinary, read-only, suspended and driver accounts. Test authorised Super Admin access without allowing self approval.
- Attempt receipt access as another unauthorised account, without authentication, with an expired signed URL and after removal. Confirm signed downloads and PDF previews still work with the restrictive storage policy. Inspect the actual private bucket settings.
- Exercise existing-source references, customer-rebillable/customer-charge classifications, duplicate warnings, date/payment/category/vehicle filters, sorting, paging, CSV/XLSX and monthly printing. Confirm no Finance invoice, Fuel, Maintenance, Insurance or Vehicle Performance total changes.
- Test actual camera capture and selection on physical iPhone and Android devices, including device HEIC behaviour, large files, throttled/mobile connections and interruption. Use an approved HTTPS/LAN access arrangement for that test; the supplied launcher binds to loopback and does not expose the app or create a public deployment.
- Confirm hosting body limits before any later deployment. The current route supports originals up to 15 MB locally; a host may impose a lower limit. Originals are not recompressed or discarded. Approve any future derived-thumbnail/chunked-upload approach separately from original retention.

Only the approved test environment can be activated by this V1.1 gate. Known production and `VERCEL_ENV=production` remain refused. A production release requires a separate owner decision and implementation review; none is part of this delivery.

## Stop/pause without losing evidence

Clear the test profile's write approval and, after an authorised operator decision, set `expenses_config.enabled=false`. Retain entries, receipts, reservations and audit records. Void synthetic financial entries through the application when appropriate. Do not drop shared development tables, erase audit history or bulk-delete uploaded documents as a rollback.

## Safe preview available now

`EXPENSES_PREVIEW_PORT=3019` and `EXPENSES_PREVIEW_DIST_DIR=.next-expenses-v11-review` with `node scripts/start-expenses-preview.cjs` launch a credential-free fixture preview. The launcher clears Supabase credentials and write approvals. It is intentionally in-memory, is visibly labelled, resets on refresh and is never a substitute for persistent company records. `?volume=1` supplies 45 synthetic rows for register checks. That route is excluded from production builds.
