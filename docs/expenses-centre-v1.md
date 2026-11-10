# Expenses Centre V1 — implementation and release notes

## Availability and safety

The authenticated feature is `/expenses-centre`, under Finance in the existing shared navigation. It uses the wide office shell. Home, existing Finance billing, Fuel Logs, Maintenance, Insurance and Vehicle Performance calculations are unchanged.

**Not activated for office-wide use.** The local environment points to a remote, unverified Supabase project. No remote database or storage writes, migrations, imports, commits, pushes or deployments were performed. The migration is prepared only. Do not infer database safety from a localhost browser URL.

Use `node scripts/start-expenses-preview.cjs` for the synthetic preview at `http://127.0.0.1:3018/expenses-fixture` (or set `EXPENSES_PREVIEW_PORT`). The launcher clears Supabase credentials and expense write gates. The fixture route is development-only and requires `EES_EXPENSES_FIXTURE=1`. It never uses the real expense API, vehicles or financial records. Two clearly synthetic vehicles and expenses are provided. Browser fixture mutations and receipt blobs disappear on refresh. The failure checkbox simulates one upload failure to exercise the retry UI; it is never shown in the real workspace.

`http://localhost:3000/expenses-centre` is the normal authenticated route when the existing application is running. Its real persistence is unavailable until a verified safe database has the reviewed migration and activation gates installed. An unavailable service displays an error; fixtures are never substituted into the live dashboard.

## Implemented

- EN/TH overview, short expense entry, searchable/filterable register, review workspace, report exports, receipt/detail/audit view, and administrator categories/settings.
- Native mobile camera input (`capture=environment`), photo picker without capture, separate PDF picker, multiple originals (12 maximum, 15 MB each), previews, removal before saving, upload progress/failure/retry, server-side file signature/size checks and HEIC/HEIF preservation. Browser HEIC inline preview is not guaranteed; the original can be opened/downloaded.
- Five essential fields; optional supplier/payment/document/VAT/reimbursement/job/trip/source fields are in disclosures. Job/trip fields are optional reference text, not verified foreign-key links or automatic financial integrations.
- Existing Vehicles database lookup with Unicode registration search; configurable non-vehicle cost centres. No fleet rows are inserted or changed. Vehicle spending includes all chosen registrations, including personal cars, and is labelled accordingly. It is not a commercial-fleet profitability figure.
- Draft → Submitted → Approved/Rejected, Needs Information/correction, and Closed after confirmed payment. Payment is separate. Controlled voiding retains original records and full before/after evidence. Approved records cannot be silently edited or hard deleted. Correct by voiding and recording a documented replacement.
- Editable bilingual category/subcategory names, activation, sort position, custom cost centres. Entries snapshot category/cost-centre/registration labels; later renames do not rewrite history. A deactivated parent also prevents new entries in its children.
- Source-aware spending basis, possible-duplicate alerts (receipt SHA-256 or date/amount plus document/vendor/vehicle), review notes, missing-receipt reasons, tax-document review and templates with editable monthly/yearly reminder schedules. Templates only prefill an unpaid form; no schedule creates actual transactions, sends messages, or confirms payment.
- Date presets/custom ranges, registration/category/approval/supplier/employee/search filters, CSV and real XLSX files with a reporting-basis sheet, numeric THB values and spreadsheet-formula injection protection. Reports can be printed through the browser.
- Same-tab text recovery keyed to the authenticated user and entry. This is optional sessionStorage recovery, not offline expense saving. Attachments must be reselected after interruption unless already uploaded to private storage. Drafts explicitly saved to the database are durable after activation.

## Database proposal

`supabase/migrations/20261109090000_expenses_centre_review_only.sql` adds only:

- `expenses_config` (disabled by default).
- `expenses_categories`, `expenses_cost_centres`.
- `expenses_entries` with creator/idempotency key, revision locking and money in integer satang inside validated data.
- `expenses_attachments` with original filename, verified MIME, size, SHA-256, pending/ready/removed state.
- `expenses_audit` with authenticated actor, time, action, note and before/after snapshots.
- `expenses_templates` with expected invoice dates and cadence.
- Private Storage bucket `expenses-receipts`; no browser upload/download policies.
- Read-only RLS policies and audited command functions. Authenticated clients have no direct INSERT/UPDATE/DELETE grants.

Prerequisites: the existing account-access and driver-portal migrations (`account_access`, `driver_accounts`, `is_office_account()`), Vehicles UUID table and Supabase Auth/Storage schemas. The actual target schema and grants must be checked before installation. The migration was exercised against isolated PostgreSQL fixtures, not a remote Supabase project.

Roles use the existing authoritative account model: active office staff create/edit their entries and review/request information; read-only accounts see their own entries; admins/super-admins manage configuration, approve/reject, record payments, close and void. Managers cannot approve/reject their own submissions. A second authorised manager is therefore required for manager-created expenses. Driver and suspended accounts are denied. Expense-specific rules do not change any existing Finance capability grants.

Approval does not grant VAT deductibility. The accountant/authorised administrator explicitly verifies tax-document classification; no VAT recovery is inferred. Amount is always the final payable total. If the source document states a VAT-exclusive base, the submitter must enter the final payable amount and VAT separately.

## Attachment durability and failure protocol

1. Create an idempotent draft, recording the verified user identity in PostgreSQL.
2. Validate bytes/size server-side; reserve durable pending metadata under the draft lock.
3. Upload the untouched original to the private path `<expense UUID>/<attachment UUID>` with `upsert:false`.
4. A server-only finalisation function verifies that the object exists and the actor still has edit permission; only then mark it ready and audit the event.
5. A retry reuses pending metadata. If an original was already uploaded before an interrupted response, compare its SHA-256 before finalising. A ready original is returned idempotently.
6. Submission rejects any pending attachment. Failed partial saves remain drafts and are never shown as successfully submitted. Choose the same file to retry or remove the pending metadata with a reason. Stored objects always have retained metadata, including removed objects; do not run unaudited orphan deletion.
7. Receipt downloads first use the requester's RLS-authorised attachment lookup, then issue a 60-second signed download URL. Private originals are never put under `public/`. Removal is a soft state change with a reason and audit; administrators can download retained removed originals for audit evidence. Ordinary submitters cannot download removed evidence.

The browser never receives a service-role credential. It receives only its own session token and short-lived download URLs. New receipt APIs are network-only under the existing service worker. Hosted request-body limits and actual mobile HEIC support must be tested in the eventual approved deployment; local size limits do not override hosting limits.

## Activation — requires environment verification and owner approval

Do not run migration/application commands merely because these notes exist. First identify the approved non-production target and confirm that the app URL, server key and DB connection all refer to it. Take the agreed backup/restore precautions and inspect actual prerequisite schemas and storage policy scope.

After the owner approves that specific target: manually apply the reviewed migration there, verify RLS/grants/private bucket policies and leave old ledgers untouched. Activation additionally needs both server-only variables `EES_EXPENSES_WRITES=approved-safe-environment` and `EES_EXPENSES_APPROVED_SUPABASE_URL` exactly matching `NEXT_PUBLIC_SUPABASE_URL`, plus an explicit approved change to `expenses_config.enabled`. `VERCEL_ENV=production` is refused by this V1 gate. No production activation is supported by this delivery. Never prefix server gate variables or service credentials with `NEXT_PUBLIC_`.

Then run acceptance with synthetic accounts/vehicles only: separate submitter and manager, suspended/driver/read-only accounts, multiple actual images/PDFs/HEIC, refresh/new-session retrieval and signed original downloads, interrupted uploads/retries, approval/rejection/correction, payment/close, category history, voiding, duplicates, Thai and filtered exports. Confirm the missing-receipt policy and document retention rules before company use.

## Reporting and reconciliation contract

Dashboard spending is **this ledger's standalone recorded expense basis**, not a fully reconciled historical company-spending figure. Include Submitted, Needs Information, Approved and Closed standalone entries; exclude Draft, Rejected, Voided, every linked source and existing customer charges. Paid/unpaid is independent. Category/vehicle/range summaries all use the same predicate and visible authorised records. Exports retain all filtered rows, including excluded rows, and explicitly mark inclusion. No legacy costs are silently imported into the new centre.

Source pairs are `(source, source_id)`: standalone, maintenance, insurance, fuel, finance, other. Non-standalone entries require a reference, remain excluded from this centre's spending and must be reconciled explicitly against the authoritative source before any consolidated integration. References are not a claim that historical records have been verified. Duplicate alerts are warnings only; no automatic deletion or merging occurs.

`cost_treatment` distinguishes internal, customer-rebillable (awaits Finance) and customer charges already recorded in Finance. Expense creation/approval/payment never creates or adjusts an invoice or changes a billing approval.

## Future Vehicle Performance integration — disabled

No Vehicle Performance file, total, monthly history or calculation was changed. A future reader may consume an expense only after owner-approved reconciliation and activation:

1. Require Approved/Closed, non-void, vehicle allocation, a verified commercial Vehicle UUID, known reporting period and a reconciliation decision. Never infer commercial status from registration text, expense category or a personal-car selection.
2. Use a stable canonical key: `expenses:<expense UUID>` for a newly approved standalone cost. For linked sources use the source ledger's canonical transaction key, never an additional expenses key. Authoritative fuel/salary/maintenance/insurance costs win; unresolved mappings remain excluded.
3. Return versioned `{ canonical_key, expense_id, revision, vehicle_id, registration_snapshot, incurred_on, amount_satang, source, source_id, cost_treatment, approval, payment_status, audit_reference }`. Resolve category and tax classification separately; never infer billing revenue from rebillable cost.
4. Produce a read-only reconciliation/diff report comparing current and proposed monthly totals. Obtain owner approval of mappings, period locks, recognition basis and commercial-fleet membership before switching readers. Keep historical totals frozen until an approved restatement policy exists.
5. On voiding, never erase historical evidence. Follow the approved restatement/reversal contract and track the expense revision/canonical key idempotently.

## Files

Added application files: `app/(dashboard)/expenses-centre/page.tsx`, `app/expenses-fixture/page.demo.tsx`, `app/api/expenses-centre/route.ts`, `app/api/expenses-centre/attachments/route.ts`, `components/expenses-centre.tsx`, `components/expenses-entry-form.tsx`, `components/expenses-settings.tsx`, `components/expenses-centre.module.css`, `lib/expenses.ts`, `lib/expenses-client.ts`, `lib/expenses-server.ts`, `lib/expenses-fixtures.ts`.

Added delivery/verification files: this document, the review-only migration, `scripts/start-expenses-preview.cjs`, `scripts/expenses-centre.tsconfig.json`, `tests/expenses-centre.test.cjs`, `tests/expenses-attachments.test.cjs`, `tests/expenses-centre-browser.cjs`. Evidence is under `output/expenses-centre/` and `tmp/expenses-*.txt`.

Existing files changed intentionally: `lib/office-nav.tsx` (one new Finance link), `app/(dashboard)/layout.tsx` (one wide-shell route). Existing uncommitted changes were preserved. Next-generated configuration additions are removed after verification, preserving the pre-existing configuration.

## Verification record

- 30 focused tests passed: new expense/domain/security/PostgreSQL/private-storage API tests plus existing shared navigation, Finance workspace and Finance Records regressions. The PostgreSQL test applies the exact migration only to in-memory synthetic PostgreSQL schemas and verifies actual grants/RLS/transactions, identity, history, state changes and disabled activation. Storage API tests use isolated stubs, not live company documents.
- Strict feature TypeScript check passed: `node node_modules/typescript/bin/tsc -p scripts/expenses-centre.tsconfig.json --pretty false`.
- Application source TypeScript check found an existing unrelated error at `components/fleet-visit-map.tsx:53`: the `VisitMapBase` argument lacks `registration`. This file was not changed.
- Full lint: zero errors, ten existing warnings in Inventory, Driver Accounts and Finance components. New feature lint has no errors/warnings after the preview image adjustment.
- Browser/build results are recorded separately in the final acceptance report below. A sleeping computer interrupted early browser runs; those runs are not treated as passes. Native camera launching on a physical iPhone/Android device and end-to-end remote Supabase persistence remain unverified until an approved safe environment is available.

Repeat focused checks with `node --test tests/expenses-centre.test.cjs tests/expenses-attachments.test.cjs tests/ees-office-shell-nav.test.cjs tests/finance-v6-workspace.test.cjs tests/finance-records.test.cjs`. Run the browser test explicitly with `EXPENSES_TEST_ORIGIN` pointing to the local, credential-free fixture server. The browser runner rejects non-loopback targets and blocks all external requests.

## Acceptance results — 10 November 2026

| Check | Result and limits |
| --- | --- |
| Focused domain, database, storage API and regression tests | **30/30 passed**, including actual PostgreSQL RLS denial for active driver/anonymous users, immutable audit and controlled voiding. No remote database used. |
| Strict feature types and feature lint | **Passed**. Full source type check still has the unrelated Fleet map error described above; full lint has zero errors and ten unrelated warnings. |
| Local production build | **Passed** in `.next-expenses-build-safe`. The real expense route and API compile; the development-only fixture route is absent from the production route list. The project intentionally skips global type/lint validation during builds, so the separate checks above are material. A final incremental build is recorded in `tmp/expenses-build-release.txt`. |
| Desktop browser | **Passed**, 1440 × 1000, with synthetic records and external network blocked. Overview, register, details and history render without application errors. |
| iPhone/Android-sized layouts | **Passed**, 390 × 844 and 412 × 915, including full-document width checks and receipt-picker touch targets ≥44px. The hidden-file-input overflow found during QA was fixed. |
| Camera/photo/PDF/multiple attachments | **Passed in desktop browser fixtures**: separate camera input with rear-camera capture hint, separate photo/PDF pickers, previews, two attachments, accidental removal and re-selection. Native phone camera launch and genuine device HEIC capture are **not verified**. |
| Failure and retry | **Passed**: browser one-shot failure simulation, saved draft retained, retry completes; storage-route tests also verify pending metadata, interrupted finalisation, hash-checked original reuse and no false completion. Real remote-network interruption remains a safe-environment acceptance item. |
| Approval/payment | **Passed**: self approval blocked; switch to a distinct synthetic manager, approve, confirm payment separately, then close. Rejection/correction/voiding and history verified against isolated PostgreSQL. |
| EN/TH, filtering and export | **Passed**. Filtered CSV/XLSX contain only the selected synthetic entry; XLSX has numeric 123.45 THB and 123.45 SpendingTHB plus reporting basis. Thai view verified. |
| Monthly printing | **Passed in browser**; generated `output/expenses-centre/filtered-monthly-report.pdf` and visually inspected `monthly-report-print.png`. This is explicitly a synthetic report. |
| Refresh/persistence | Fixture reset on refresh **passed** (intentionally not persistent). Prepared SQL/storage code and isolated persisted record queries passed. Live Supabase write/read, new-session retrieval and private receipt durability are **not activated or verified on localhost**. |
| API authentication | **Passed** against the local real API: unauthenticated GET/POST return 401 without querying financial data. |

Office-wide release remains blocked on owner approval of a verified safe target, schema/storage installation and permission review, agreed missing-receipt/retention policy, and physical-device/end-to-end persistent-storage acceptance. No production data or deployment was changed.
