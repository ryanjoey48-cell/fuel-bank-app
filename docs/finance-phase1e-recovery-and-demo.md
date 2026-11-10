# EES Finance Centre Phase 1E: recovery and local demonstration

## Database recovery

No remote database was queried or changed. `supabase/development/read-only-collection.md` provides a metadata-only production collection procedure; it explicitly excludes business rows, auth users, storage objects, credentials, and migration SQL statement bodies. A privileged schema-only export and the version-only production migration ledger are still needed. The repository's Insurance and HR PostgREST snapshots and HR test fixture do not contain complete authoritative table creation, indexes, triggers, grants, RLS, and function definitions. Do not synthesize an executable baseline from them.

`supabase/development/migration-inventory.json` hashes and classifies all 95 repository migrations. It finds 12 duplicate-version groups and four tables altered without a repository creation definition: `vehicle_insurance_compliance`, `ees_hr_admins`, `ees_hr_meetings`, and `ees_driver_vehicle_assignments`. The proposed separate development baseline and ledger approach is in `supabase/development/README.md`. Historical migration filenames and production history remain unchanged.

Docker, Supabase CLI, `psql`, and local PostgreSQL server tools were not found on PATH. Node/npm and PGlite are available. A full local Supabase replay remains blocked by tooling and missing authoritative definitions. Install a compatible container runtime and Supabase CLI in an isolated local setup; verify their versions and local-only `supabase start` before any database test. Never link this worktree to production or development while installing tools.

## Classification of 42 full-suite failures

The full repository test run after the demonstration changes produced 791 tests: 749 passed, 42 failed. The earlier Phase 1D run had 786 tests: 744 passed, 42 failed. The five new demonstration tests pass and add no failures. Test assertions were inspected from the local output. Among tracked application files, only the pre-existing Phase 1B Booking Diary link and navigation entries differ from `HEAD`; Phase 1E does not edit any failing module. The two failing Booking Diary assertions seek literals that are also absent from the committed Booking Diary file. These failures predate Phase 1E; the table distinguishes the likely cause of each group rather than claiming the underlying product behavior is correct.

| Group | Fails | Observed cause | Action outside this phase |
| --- | ---: | --- | --- |
| Booking Maps/Diary and Trip Journey UI | 3 | Static tests expect old feature flags, labels, or JSX structure (`NEXT_PUBLIC_BOOKING_LOCATION_REVIEW_ENABLED`, `Booking check`, direct `LocationAutocomplete` pattern). The Phase 1B Diary diff only adds a verification link. | Reconcile tests with current approved UI and verify route behavior. |
| Driver active-job, home, workflow, redesign and mobile UI | 32 | Several render harnesses do not mock newly imported `next/image` or `next/navigation`; others assert old route arrays, hardcoded contact, action placement, and markup. Driver code is untouched by Finance work. | Update fixtures/mocks, then investigate any remaining real behavior failures. |
| Maintenance and oil service | 2 | Numeric/status assertions differ from current oil logic. No Finance code is involved. | Compare expected business rule with implementation and test data. |
| Browser storage | 1 | Test reports direct storage access in `components/forth-tracking-centre.tsx`. | Address in that module's own track; do not change it here. |
| Trip financial toggle | 1 | Static test expects an older direct JSX layout. | Reconcile test with current Trip UI. |
| Vehicle Performance | 3 | Static tests expect old dashboard, PDF, and month-mode strings/structure. | Review product changes and update tests or UI in its own track. |

The test suite is **not** a green regression gate. No unrelated module was changed to make it pass.

## Fixture-only demonstration

The route `/finance-demo` is part of the existing Next.js application and returns 404 in production builds. In development it renders without the dashboard's Supabase authentication shell, and the demonstration component has no Supabase import or network calls. All three jobs, customers, dates, work orders and THB amounts are fictional and visibly marked as simulated. The historical workbook fixture and existing Phase 1B screens remain available separately.

The local interaction supports signed order, parking and toll receipt intake; verification; missing-document block; discrepancy escalation; management decision and mandatory office recheck; finance expense entry; price-list or manual pricing; weekly batch; unnumbered draft TRN; a separate simulated approver; and a printable ordered sample pack. The pack is a **prototype** until management supplies and approves the existing customer-facing TRN layout. Approval never issues an invoice or final TRN number. Role separation is demonstrated in the local state machine and is not a substitute for database RLS.

Focused Finance tests and TypeScript checks pass. The local development server returned HTTP 200 for `/finance-demo` with the fictional work order and simulation banner while Supabase environment variables were absent. The server was stopped after the smoke test.

## Decisions and gates

Management must provide the authoritative TRN layout; approve expense categories and required receipt rules; confirm price-list precedence and manual-price approval policy; decide whether approvers may approve their own pricing; and settle numbering, cancellation, and historical TRN reconciliation before any live invoice work. A metadata-only database owner must provide the missing schema definitions and migration ledger. No remote baseline deployment is approved until a complete disposable local Supabase replay, Auth/RLS tests, and a green relevant regression gate are documented.
