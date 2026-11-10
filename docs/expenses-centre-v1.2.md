# EES Expenses Centre V1.2 — delivery report

## 1. Delivery and implemented features

Continues the V1/V1.1 application in `C:\Projects\EES\fuel-bank-app`. No branch, worktree, commit, push, deployment, remote migration or production write was performed. Unfinished changes in the shared project were preserved. The original V1 and V1.1 delivery reports and activation package were inspected and retained.

Normal authenticated route: [localhost:3000/expenses-centre](http://localhost:3000/expenses-centre), with real saving disabled. Temporary synthetic preview: [127.0.0.1:3021/expenses-fixture](http://127.0.0.1:3021/expenses-fixture); add `?volume=1` to inspect 45 synthetic rows. The existing preview launcher clears company database credentials; its final local output folder is `.next-expenses-v12-acceptance`.

**Permanent company saving remains disabled.** EES Development is still an unapproved candidate; its Expenses schema and private storage have not been activated. A localhost URL is not evidence that the connected database is safe. The existing production-URL refusal, explicit environment allowlist and private-storage gates remain in place. V1.2 additionally requires schema version **3** before any authenticated expense write.

Implemented locally:

- Receipt-first phone entry, category/cost-centre shortcuts and the existing short essential form.
- Classified duplicate evidence: strong match, possible match, or no match detected within the caller's permitted records. Reasons identify file fingerprints, receipt numbers, amount, nearby expense dates, supplier and vehicle. Amount alone never triggers a warning.
- Manager review notes keep both records intact. Resolutions are append-only, audited and bound to both expenses' revisions and attachment evidence. Changed evidence reopens the warning. Reviewing a duplicate does not approve, pay, merge, void or delete anything.
- Optional Booking Diary selection using actual UUIDs, authenticated server-side lookups and the diary's existing RLS. Search covers booking date, diary reference, work-order number (`job_order_number`), customer, vehicle and driver. Vehicle mismatches are explained in EN/TH. Legacy free-text job notes remain explicitly unverified.
- PostgreSQL filtering, sorting, page selection and filtered aggregates. The live bootstrap no longer downloads the entire expense/attachment register. Detail, receipts, booking and history are loaded for an authorised expense when opened.
- Dashboard totals and rankings use the full permitted filtered result, with separately labelled recorded, approved, provisional, paid and outstanding amounts, active submitted count, pending review count, missing receipts, vehicle spending and business overheads. Recent activity is selected across the filtered set, independently of the displayed register page.
- Complete filtered CSV/XLSX and prepared print output retrieve bounded server pages. Numeric `SpendingTHB`, `SpendingPaidTHB` and `SpendingOutstandingTHB` match the active standalone reporting basis. `THB`, `PaidTHB` and `OutstandingTHB` retain per-record values for audit, including excluded records; the reporting sheet explains the distinction. Exports identify synthetic fixture mode explicitly. There is a 10,000-row export/print limit; oversized or detectably changing results fail with a retry/narrow-filter message rather than silently truncating.
- Read-only future cost-handoff contract with stable expense/source identifiers, a source-based deduplication key, cost treatment and standalone-report eligibility. No integration consumer or accounting write is activated.

## 2. Files changed

Existing feature files extended:

- `components/expenses-centre.tsx`
- `components/expenses-entry-form.tsx`
- `components/expenses-register.tsx`
- `components/expenses-centre.module.css`
- `lib/expenses.ts`
- `lib/expenses-server.ts`
- `app/api/expenses-centre/route.ts`

New implementation files:

- `lib/expenses-query.ts` — validated query contract, deterministic sorting and fixture query emulator.
- `lib/expenses-intelligence.ts` — duplicate classification/reasons, booking types, mismatch checks and explicitly synthetic booking fixtures.
- `lib/expenses-bookings-server.ts` — caller-scoped, bounded diary/customer lookup.
- `lib/expenses-receipts.ts` — shared original-byte MIME validation.
- `lib/expenses-reports.ts` — bounded report retrieval, stale-query cancellation and row/summary consistency checks.
- `lib/expenses-integrations.ts` — inactive read-only cost handoff.
- `components/expenses-booking-picker.tsx`
- `components/expenses-duplicate-review.tsx`
- `app/api/expenses-centre/register/route.ts`
- `app/api/expenses-centre/bookings/route.ts`
- `app/api/expenses-centre/duplicates/route.ts`
- `supabase/migrations/20261110120000_expenses_centre_v12_review_only.sql`
- `tests/expenses-v12.test.cjs`, `tests/expenses-v12-api.test.cjs`, `tests/expenses-v12-reports.test.cjs`, `tests/expenses-v12-browser.cjs`.
- This report.

Temporary baselines, checks and logs are under `tmp/expenses-v12-*`; synthetic screenshots/exports are under `output/expenses-centre-v12/`. The V1.1 browser script was copied into `tmp` solely to run its unchanged scenarios against V1.2 without overwriting V1.1 evidence. Generated Next build/type references are task artefacts, not intended application configuration changes.

## 3. Features preserved

Preserved native camera/photo/PDF inputs, multiple private originals, progress, retry, idempotent draft creation, revision checks, same-tab text recovery, signed receipt downloads/previews, PDF canvas rendering, cumulative partial payments, missing-receipt explanations, independent approval/payment states, self-approval refusal, audited soft removal/voiding, bilingual categories/settings and recurring reminders requiring an actual invoice confirmation.

The shared navigation and existing Finance Centre, Fuel Logs, Maintenance Centre, Insurance Centre and Vehicle Performance calculations were not changed. There are no new automatic entries, invoice-total changes, customer rebills or historical transaction rewrites. Source-linked costs and existing customer charges remain outside standalone spending totals.

## 4. Mobile improvements

The receipt panel precedes the essential fields on narrow screens. Staff can take/select a receipt before entering an amount. Category and cost-centre buttons reduce typing; vehicle/category search remains bilingual. Essential fields remain date, amount, category, description and allocation; optional details stay in disclosures.

Files remain original, with a maximum of 12 attachments and 15 MB each. The local attachment counter avoids counting an already uploaded local file twice. Fixture uploads now use the same byte-signature validation as the server and reuse an identical ready file for the same expense. Image/PDF previews, retry and preserved form values remain supported.

HEIC/HEIF originals are accepted when their signatures match. The UI honestly explains that inline viewing is browser-dependent and offers the original download. There is no promise of HEIC conversion or universal decoding. A tiny synthetic HEIC-signature fixture tests this fallback; it is not proof of real iPhone image decoding.

Native touch targets, visible keyboard focus, responsive drawers and EN/TH text were checked at desktop and 390/412-pixel phone widths. **No physical iOS or Android device was available.** Native camera permissions, actual phone HEIC/photo-library behaviour, low-memory mobile devices and real interrupted mobile networks remain device acceptance work.

## 5. Booking Diary integration verification

The implementation reads `booking_diary` and `clients` through the verified caller's Supabase client, never a service-role diary lookup. It uses the existing diary identifier and field contract also used by `lib/finance-ready-jobs.ts`. Search returns up to 30 recent bookings; customer ID search is bounded, so users should refine broad searches.

`expenses_booking_links` stores the actual booking UUID separately from display labels and legacy notes. Insert/update policies require a permitted editable expense, an eligible actor, enabled version-3 configuration, and a booking visible through the caller's real RLS. Updates use an expected link revision; a trigger locks and rechecks the expense before writing and appends old/new audit evidence. There is no booking-table write or permission grant. Links cannot be edited after submission. Unlinking is an audited null link, not a hard delete.

Renamed diary details are looked up afresh. Deletion, loss of access or diary lookup failure retains the original UUID and displays unavailable; it does not stop reading the expense itself. Selecting an unavailable booking fails without creating a fabricated link. A draft acknowledged before a subsequent link failure remains a draft and can be reopened/retried.

Verified with isolated PostgreSQL diary records, including an additional restrictive policy hiding a booking, non-existent IDs, label changes, deletion, submitted-record locks, audit and revision conflicts. Server lookup tests verify caller-scoped queries, real UUID lookup and bounded/escaped search. Browser checks use explicitly labelled synthetic jobs only. **No genuine company booking was linked or modified, and the unapproved remote schema has not been verified end to end.**

## 6. Pagination and reporting verification

`GET /api/expenses-centre/register` validates query parameters, authenticates the caller and calls `expenses_register` with that scoped client. The prepared PostgreSQL function is **SECURITY INVOKER**: existing expense and attachment RLS applies before filtering, page selection and aggregates. Sorting uses a validated expression whitelist and direction; the UUID tie-break is always ascending. PostgreSQL byte collation is mirrored by the fixture sorter, including Thai labels.

Supported filters: inclusive expense-date range, vehicle, category, cost centre, supplier, approval, payment, submitter and free text. Page sizes are limited to 10/20/50 and page numbers are bounded. Empty/out-of-range pages are handled. Register controls consume the returned page; they no longer sort/slice an entire downloaded live dataset. Only synthetic in-memory fixture data uses the equivalent local emulator.

Tests compare every sort column in both directions and languages, tie ordering, adjacent pages, date/text/status/payment/allocation filters, summary invariance between pages, numeric exports and a read-only user's own-record total. Driver/suspended accounts are denied. Pagination is ordered offset pagination: concurrent edits or permission changes can move rows between requests, so refresh after such changes; it is not a long-lived database snapshot. Exports detect changed counts/totals and repeated IDs across their page reads, but do not claim transaction-level snapshot isolation. Prepared print totals are computed from exactly the retrieved rows, and filter changes cancel preparation rather than mixing report contexts.

Reporting is based on **expense dates**. Paid/outstanding figures are cumulative payments allocated to those selected expenses, not cash flow by payment date. Spending includes standalone submitted/needs-information/approved/closed records and excludes drafts, rejected/voided records, source-linked costs and existing customer charges. Rebillable internal expenses remain identifiable; no customer invoice is generated. The active submitted count uses the same spending inclusion basis. Use the workspace Print button to retrieve and prepare every page; direct Ctrl+P without preparation displays an instruction instead of pretending that the visible page is a complete register. Pending review includes the submitted queue; missing receipts use the active standalone reporting set.

## 7. Test results

- 40 regression/domain/PostgreSQL/storage/transport/navigation/Finance checks passed: `tmp/expenses-v12-tests.txt` (the original 38 checks plus the two V1.2 domain/database tests).
- Two additional V1.2 API tests passed; final focused rerun of the four query/API/domain/database tests is in `tmp/expenses-v12-new-tests.txt`. Three additional report-consistency tests passed in `tmp/expenses-v12-report-tests.txt`, including filter changes during asynchronous retrieval, changed totals, repeated rows, limit handling and exact exported-row totals. **45 distinct automated tests passed.** A first parallel run hit a Windows dependency-read error; the sequential rerun passed. No failing application assertion was suppressed.
- The unchanged V1.1 browser acceptance scenarios passed against the credential-free V1.2 preview: receipt/PDF preview, upload failure/retry, separate approval/partial/full payment, recurring confirmation, filtering/sorting/pagination, numeric CSV/XLSX, EN/TH, phone widths, auth and fixture reset.
- New V1.2 browser acceptance passed: receipt-first layout, category shortcut, rejected-file form retention, HEIC fallback, optional synthetic diary search, mismatch warning in both languages, strong file-fingerprint warning, manager resolution without approval, self-approval prevention, 45-row all-page export/print, print invalidation on filter change, cost-centre filters, invalid-date recovery and all three new endpoints refusing unauthenticated requests. Evidence: `tmp/expenses-v12-browser.txt`.
- Browser requests were restricted to loopback/blob/data URLs; test records and uploads were synthetic only. Desktop and mobile screenshots were visually inspected.
- Strict Expenses feature TypeScript check passed: `tmp/expenses-v12-feature-types.txt`. Full-project lint completed with **0 errors and 12 warnings**, outside the Expenses changes: `tmp/expenses-v12-lint.txt`.
- Whole-source TypeScript **failed when checked** in the shared workspace: missing `selectedTripFinancials` references in Vehicle Performance, a Diary picker cast and unfinished Finance workspace identifiers are reported in `tmp/expenses-v12-types.txt`. These files are outside this change and were left untouched to preserve unfinished work and protected financial calculations. These unrelated errors need their own review before a release. The optional full-app production build was stopped during compilation when the shared machine had under 500 MB free physical memory; **no successful V1.2 production build is claimed**. The existing Next configuration skips global type/lint checks during builds, so a build alone would not clear those errors.

## 8. Remaining database blockers

No Expenses migration or storage activation has been approved for EES Development. The existing V1.1 activation plan records missing/unverified prerequisites; V1.2 does not override that restriction.

Before any real authenticated test saving: approve an exact non-production target and retention plan; inspect the actual Vehicles, Booking Diary, Clients, Auth/account-access and Storage schemas/RLS; review V1, V1.1 and the new V1.2 migration together; verify private bucket and restrictive policies; review a **version-3** activation/preflight package; provision isolated synthetic users, bookings, vehicles and receipts; then explicitly authorise installation. The old V1.1 version-2 activation package alone is insufficient for V1.2. No credential profile, config flag or remote object was changed here.

The new migration adds only Expenses-owned functions/tables/indexes/policies and upgrades the schema marker. It deliberately does not enable configuration, alter old expense data or write to Booking Diary. It was executed only in a local synthetic PostgreSQL engine. This proves the tested SQL contract, not an activated Supabase installation.

## 9. Actual persistence status

| Mode | Actual behaviour |
| --- | --- |
| Credential-free fixture preview | Working temporary synthetic UI, uploads and review/booking state in memory. Refresh resets it. Text recovery may retain an unfinished form in that browser tab. No permanent company record exists. |
| Isolated PostgreSQL tests | Real SQL/RLS/audit/query behaviour against synthetic local objects. V1.1 disk reopen regression remains passed. No company transactions or remote writes. |
| Real authenticated application | New routes, query and link contracts are implemented, but require reviewed version-3 schema and approved private persistence. Saving remains disabled. Missing schema/auth/services show an error/readiness notice; live screens never substitute fixtures. |
| Cross-device/private cloud storage | Not activated or verified. No claim of successful permanent company saving, genuine diary linking or office-wide readiness. |

## 10. Recommended V1.3 work

1. Complete the explicit non-production approval and schema/storage acceptance process, followed by authorised real-auth save/retrieve/new-session tests using synthetic records only.
2. Physical iPhone/Android acceptance with real HEIC/photos/PDFs, capture permissions, interrupted uploads, slow networks and hosting request-size limits.
3. Cursor/snapshot-based browsing and queued snapshot exports for a busy multi-user register; add database workload/index profiling after an approved realistic synthetic volume test.
4. Extend duplicate search with carefully bounded supplier-name similarity and receipt-number normalisation, with continued human review and no automatic merging.
5. Add separately authorised integration consumers and a shared source-deduplication registry before any consolidated Finance/Vehicle Performance reporting. Keep accounting and customer rebilling under their existing controls.


## Final acceptance record

| Check | Result |
| --- | --- |
| Automated tests | **45 distinct tests passed**, isolated synthetic data/source checks only |
| V1.1 browser regression | **Passed** on the final fresh preview; `tmp/expenses-v12-browser-regression.txt` |
| V1.2 browser acceptance | **Passed**, including work-order search, stale-error clearing and basis-aware cash exports; `tmp/expenses-v12-browser.txt` |
| Expenses strict TypeScript | **Passed**, exit 0 |
| Final changed-feature lint | **Passed**, exit 0; no code warnings/errors |
| Whole-project lint | 0 errors, 12 unrelated warnings at verification |
| Whole-source TypeScript | Failed when checked in unrelated Finance/Vehicle Performance work; not changed by this task |
| Full production build | **Not verified**; stopped during compilation under shared-machine memory pressure. No successful build or release is claimed |
| Main app availability | `http://localhost:3000/login` returned **HTTP 200** after cleanup |
| Synthetic preview availability | `http://127.0.0.1:3021/expenses-fixture` returned **HTTP 200** after cleanup |
| New API authentication | Register, bookings and duplicates returned **401** without a session |
| Generated configuration cleanup | Removed only two V1.2 test includes; no V1.2 references remain in root TypeScript configuration. The latest existing main-app type reference was preserved |
| Database/storage activation | **Not approved or activated; permanent company saving remains disabled** |

Final checks used desktop and 390/412-pixel browser widths, not physical phones. No remote migration, production write, commit, push or deployment was performed by this task. Other unfinished shared-project changes remain in place.
