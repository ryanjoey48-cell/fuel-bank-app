# Expenses Centre V1.1 — delivery report

## Delivery status

V1.1 extends the existing V1 implementation; it does not rebuild the app or change historical ledgers. **Company persistence is not enabled.** The main profile still targets confirmed production. A separate EES Development candidate was inspected read-only, but is not approved for Expenses and lacks required application objects. No remote migration, seed, activation, commit, push or deployment was performed.

The existing application remains on localhost:3000. Browser verification uses a separate credential-free fixture preview. Fixture state and blob URLs are deliberately temporary and never replace company database records. The V1 report remains unchanged.

## Changes and before/after improvements

| Area | V1 | V1.1 |
| --- | --- | --- |
| Persistence readiness | Prepared migration and default-off write gate | Read-only environment/schema/bucket probe, explicit known-production refusal, schema-version/private-bucket checks and an exact approval/installation package |
| Approval/payment | Independent approval plus paid/unpaid | Independent approval plus unpaid/partially paid/paid, cumulative paid amount, exact outstanding balance and audited corrections |
| Phone entry | Short form, camera/photo/PDF selectors and retry | Preserved short form; searchable bilingual categories; actual transferred-byte progress followed by server verification; clearer uncertain-result messages; recurring-invoice confirmation |
| Original receipts | Private durable upload protocol; links/native PDF viewing | Preserved originals and reservation/retry protocol; image/PDF preview dialog; PDF canvas rendering with page controls so preview does not depend on a browser PDF plug-in |
| Register | Filtered table and exports | Sortable columns, payment filter, 10/20/50 row paging, compact wrapping, expense drawer, all-filtered sorted exports and print-only complete table |
| Dashboard | Recorded spending with a stated standalone basis | Separately labelled recorded, approved, provisional, paid-on-approved and unpaid-approved balances; no fixture substitution when real loading fails |
| Recurring costs | Saved templates with schedules | Six starter reminders, due/upcoming list, manual next-period advancement and mandatory actual-invoice confirmation before submission; no automatic incurred/paid record |
| Storage policy | Private bucket, no new browser grant | Additional restrictive policy for this bucket defeats older broad permissive storage policies without changing other buckets' existing access |
| Payload/reliability | Global audit loaded with snapshot; refresh failure could obscure an acknowledged write | Audit fetched per authorised expense; acknowledged writes retained in the view if a subsequent list refresh fails, with a clear refresh warning |

Original receipt bytes are uploaded untouched. They are not recompressed or discarded; preview scaling is display-only. Hosting upload limits and actual phone HEIC behaviour still require approved-environment acceptance. No offline company saving is claimed. Same-tab text recovery remains an optional interruption aid.

## Database readiness findings

The read-only probe checked the repository's project registry and the candidate key's project claim when available. It performed only GET requests, used zero-row table selects, and printed no credentials or financial records.

- `.env.local`: **confirmed production**, Expenses approval absent; unchanged.
- `.env.vercel-preview.local`: also **confirmed production**, Expenses approval absent; unchanged.
- `.env.staging.local`: distinct **EES Development candidate**; account/driver tables available through REST, Vehicles and all Expenses tables unavailable (`PGRST205`), Expenses RPCs not exposed, private bucket not verified (metadata request 400). No approval for this purpose was found.
- These findings do not establish that the candidate is ready or safely isolated for this application. Existing Fleet staging work is not treated as permission to install Expenses or alter authentication.

Evidence: `tmp/expenses-v11-readiness.json`. The complete operator sequence, dependency checks and acceptance requirements are in `docs/expenses-centre-v11-activation-plan.md`.

Prepared database changes:

1. V1 migration retained unchanged: `supabase/migrations/20261109090000_expenses_centre_review_only.sql`.
2. New additive V1.1 migration: `supabase/migrations/20261110100000_expenses_centre_v11_review_only.sql`. It adds schema version 2, a validated payment helper, the updated audited command function and a bucket-specific restrictive storage policy. It does not backfill or rewrite historical entries.
3. Review-only prerequisite, synthetic vehicle setup, read-only verification and test activation SQL are listed below. None was executed on a remote database.

Both database configuration and matching server approval are required. Every write checks the environment, authenticated office role, schema version, enabled configuration and private bucket. Known production is refused even if someone supplies matching write flags. No service credential enters browser code.

## What is genuinely persistent

The existing private-storage/database implementation remains the intended persistent path. It reserves a draft and pending attachment metadata, verifies original bytes, stores a private original, and marks the attachment ready only after server verification. Submission refuses unfinished uploads. Retried originals are hash checked and reused. Receipt removal retains the original and audit evidence. Signed original/preview access is issued after an RLS-authorised lookup and expires after 60 seconds.

V1.1 payment and audit records were tested with the exact prepared migrations in a task-created isolated PostgreSQL engine, including closing and reopening its on-disk database. That proves the tested local database contract; **it is not an activated Supabase installation or cross-device company persistence**. Remote save/retrieve, sign-out/new-session retrieval and private-storage durability remain blocked on the approved test setup. The fixture preview intentionally resets on refresh.

## Permissions and financial boundaries

- Existing account authentication/role resolution remains authoritative. Active office staff create/correct their own entries and request information. Admins/Super Admins retain system-wide management, payment, approval and void access under server/database rules. Read-only, suspended and active driver restrictions are preserved.
- No user, including a manager, may approve their own submission without a separate explicit company policy. None was supplied, so the default remains denial.
- Partial payment is a cumulative amount, not an extra instalment. It must be greater than zero and less than the total. Paid must equal the full total; unpaid must equal zero. Approval changes neither amount paid nor payment status. Only a fully paid approved expense can close.
- Money remains integer satang/decimal-safe THB. Exported paid/outstanding/spending values are numeric. Existing paid/unpaid V1 records are readable without a data backfill.
- Recorded standalone spending includes submitted/needs-information/approved/closed entries and is labelled as approved plus provisional. Approved spending and its paid/outstanding portions are separate figures. Voided, rejected, draft, linked-source and existing customer-charge exclusions remain intact.
- Fuel, Maintenance, Insurance, Finance and Vehicle Performance sources are never imported or modified. Rebillable expenses never change an invoice. No Vehicle Performance integration is activated. Personal-car selection is not treated as approved commercial-fleet profitability data.
- Related job/trip fields remain optional reference text; V1.1 does not claim a verified foreign-key integration.

## Screens and mobile flows

Desktop checks cover overview, register, sortable numeric amounts, page controls, payment filters, expense drawer, original image/PDF dialogs, approvals, partial/final payment, audit history, recurring reminders, CSV/XLSX and monthly printing. Exports include all filtered rows in the selected sort order, not just the visible page. Normal interaction mounts only the current table page; the complete filtered table is prepared only for printing.

Phone-size checks cover 390×844 and 412×915 layouts, document-width containment, category/Thai registration search, separate camera/photo/PDF controls, multiple files, accidental removal, retry and ≥44px receipt-picker touch targets. Camera capture uses the existing native capture hint; photo selection does not force the camera. HEIC/HEIF originals are accepted where supported; unsupported browser inline display falls back to original download.

**Physical iPhone/Android camera launch, real device HEIC capture, a mobile network interruption and cross-device Supabase retrieval have not been verified.** They are explicit release blockers rather than simulated passes.

## Verification record

- **35 focused/domain/PostgreSQL/storage/transport/navigation/Finance regression checks passed** in `tmp/expenses-v11-tests-release.txt`. Tests include decimal payment math, self-approval and role restrictions, actual database reopen, permanent before/after audit, voiding, pending upload reuse, untouched original bytes, no premature success at 99% transfer and restrictive storage policy behaviour in the presence of a legacy permissive policy.
- Additional approval-launcher/readiness and exact review-SQL tests are recorded in `tmp/expenses-v11-approval-package-tests.txt`. They use synthetic local fixtures and mocked GETs, never a cloud write.
- Full lint completed with **zero errors and ten pre-existing warnings** in Inventory, Driver Accounts and Finance code. No unrelated warning was repaired as part of this task.
- An unsupported PDF option found by TypeScript was removed. Final feature/global type and production build results are appended in the acceptance note below. Builds intentionally clear database credentials and use a separate output folder; the project's existing build configuration skips global type/lint validation, so separate checks matter.
- Screenshot review found the native PDF plug-in could show an empty area; it was replaced with canvas rendering. The synthetic PDF page was then visibly rendered and inspected. Early browser runs during concurrent build/cache changes are not counted as final acceptance passes. Browser checks were separated from the build and use an explicit ready signal.

Evidence is under `output/expenses-centre-v11/` and `tmp/expenses-v11-*.txt`. Only synthetic documents and values are present there.

## Files modified

- `lib/expenses.ts`, `lib/expenses-client.ts`, `lib/expenses-server.ts`, `lib/expenses-fixtures.ts`.
- `components/expenses-centre.tsx`, `components/expenses-entry-form.tsx`, `components/expenses-settings.tsx`, `components/expenses-centre.module.css`.
- `app/api/expenses-centre/route.ts`, `app/api/expenses-centre/attachments/route.ts`, `app/expenses-fixture/page.demo.tsx`.
- `scripts/start-expenses-preview.cjs`, `scripts/expenses-centre.tsconfig.json`.
- `.gitignore` (only the private Expenses test-profile rule and blank-example exception were appended).

## Files added

- `components/expenses-register.tsx`, `components/expenses-detail-drawer.tsx`, `components/expenses-receipt-preview.tsx`, `components/expenses-pdf-preview.tsx`, `components/expenses-partial-payment.tsx`, `components/expenses-recurring-reminders.tsx`.
- `supabase/migrations/20261110100000_expenses_centre_v11_review_only.sql`.
- `scripts/expenses-readiness.cjs`, `scripts/start-expenses-approved-test.cjs`, `.env.expenses-test.example`.
- `docs/expenses-centre-v11-activation-plan.md`, `docs/expenses-v11-activation-preflight-read-only.sql`, `docs/expenses-v11-test-vehicles-prerequisite-review-only.sql`, `docs/expenses-v11-synthetic-vehicles-review-only.sql`, `docs/expenses-v11-activation-review-only.sql`, this report.
- `tests/expenses-v11.test.cjs`, `tests/expenses-v11-browser.cjs`, `tests/expenses-transport.test.cjs`, `tests/expenses-activation-guards.test.cjs`, `tests/expenses-activation-sql.test.cjs`, `tests/helpers/expenses-db.cjs`.

Task-only test logs, baseline copies and generated evidence are under `tmp/expenses-v11-*` and `output/expenses-centre-v11/`. Temporary Next type references are removed after verification without replacing other unfinished configuration changes. No navigation, Home, unrelated module logic, production data or deployment was changed by V1.1.

## Remaining blockers and V1.2 recommendations

1. Owner approval of a verified isolated target and the exact prerequisite/migration/retention package.
2. Install and verify the candidate's existing authentication dependencies, canonical Vehicles schema, Expenses schema and private storage. Do not compensate by copying production financial records or changing the real fleet.
3. Complete genuine Supabase persistence, refresh/sign-out/new-session/second-device and private-document acceptance with synthetic accounts.
4. Perform physical-phone camera/photo/HEIC and throttled-network tests, and verify the intended host's request limits. Consider direct/chunked private uploads only with server verification and preserved originals if hosting requires it.
5. For V1.2, prioritise server-side paging/aggregation for larger ledgers, verified optional job/trip pickers and invoice-confirmation/reminder ergonomics. Keep VAT review human-controlled.
6. Reconcile and obtain separate owner approval before any Finance or commercial Vehicle Performance connection. No production activation or deployment is included here.

## Final acceptance — 10 November 2026

| Verification | Result |
| --- | --- |
| Focused/domain/database/storage/transport and existing navigation/Finance regressions | **35 passed** |
| Approval-profile, read-only probe and exact prerequisite/seed/activation SQL | **3 passed**, only in synthetic local fixtures; **38 total distinct tests passed** |
| Strict Expenses feature TypeScript | **Passed**, `tmp/expenses-v11-feature-types-delivery.txt` |
| Entire application source TypeScript | **Passed**, `tmp/expenses-v11-source-types-final.txt`; the older V1 Fleet type failure was not reproduced in the current worktree and no unrelated module was changed to obtain this result |
| Production build | **Passed**, `.next-expenses-v11-build`; actual bundle includes lazy print-table preparation, and the fixture route is not a production route |
| Full lint | **Zero errors, ten existing warnings** outside Expenses; feature lint is clean |
| Final browser run | **Passed** after build completion and a fresh isolated preview cache, with external requests blocked and zero application page errors |
| Browser flows | EN/TH; searchable category/Thai registration; camera input hint; image and genuinely rendered PDF previews; multiple files/removal/retry; drawer; separate approval, cumulative partial/full payment and close; exact numeric exports; print; recurring confirmation; sorting/paging; 390/412px layouts; unauthenticated API denial; fixture reset on refresh |
| Register rendering | Exactly the current page is mounted outside printing; 45 synthetic rows test paging, sorting and normal desktop width without horizontal scrolling |
| Genuine company persistence | **Not enabled**; only the prepared database contract and isolated database reopen were verified |
| Physical phone/real HEIC/cross-session Supabase | **Not verified**, requires the separately approved test installation |

The native-PDF blank preview and development cache/loading failures encountered during QA were corrected or isolated; those earlier runs are not counted as passes. The final browser log is `tmp/expenses-v11-browser.txt`, and screenshots are in `output/expenses-centre-v11/`.

Final availability checks returned **HTTP 200** for `http://localhost:3000/login` and `http://127.0.0.1:3019/expenses-fixture`. The main server was not replaced. The safe preview remains available separately with company credentials cleared. The new blank test-profile example is retained in version control; the future credential-bearing `.env.expenses-test.local` is explicitly ignored. No approved test credential profile was created or activated.
