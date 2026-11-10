# EES Finance Centre Phase 1C readiness

## Integration boundary

No separate development Supabase project exists. The local and preview environment files point to the same project. The Phase 1B migration has **not** been applied to any Supabase database. Only isolated in-memory Postgres tests ran. No persistent records or live screens were exercised.

## Historical source demonstration

Source: `C:\Users\joery\Downloads\EES System upload data.xlsx`, SHA-256 `4eccbd2bcf136957acd607060d8adc0ad6ff4acd927f615b17505e2d046edfef`. The five selected records are copied cell-for-cell into `lib/job-verification-historical-demo.ts`; `tests/job-verification-historical-source.test.cjs` verifies each value against the workbook when it is available. No source workbook cells were edited.

| Scenario | Source row | Work order (G) | Existing source TRN (H) | Workbook facts | Workflow action |
| --- | --- | --- | --- | --- | --- |
| Matching job | January!2 | 456 | TRN025/2026 | 2026-01-02; vehicle 700-4145; trip charge (I) 500; other (J) 35; total collected (O) 5000 | **Simulated** matching returned job order and paperwork check |
| Missing paperwork | Feb!4 | 671 | TRN099/2026 | 2026-02-01; vehicle 63-3543; I 700; J 280; O 7500 | **Simulated** signed order missing |
| Management discrepancy | April!8 | 439 | TRN224/2026 | 2026-04-24; vehicle 73-5641; I 2100; parking (K) 35; O 2724 | **Simulated** returned destination mismatch |
| Decision and recheck | July!3 | 4465.2 | TRN440/2026 | 2026-07-18; vehicle 71-8047; I 2100; K 200; overtime (L) 400; O 2724 | **Simulated** management decision and office re-verification |
| Finance overview | September!2 | 5085.1 | TRN548/2026 | 2026-09-04; vehicle 4 ฒก 7996; I 1400; O 1990 | **Simulated** verified handover displayed read-only |

The workbook has no customer/client column and no green job order or receipt image. It cannot prove that any selected job was completed, that paperwork matched, or that a TRN was issued in the legal/accounting sense. Column H values are preserved as recorded references, not recreated invoices. Blank amount cells remain absent in the source fixture; no zero or customer amount has been invented.

## Phase 2 design review

1. **Paperwork Inbox:** private Supabase bucket, file metadata table linked to booking, type and checksum, immutable object keys, MIME and size limits, uploader and review history, short-lived authorized downloads, no broad client service-role access. An upload alone must not mark a document matched; office review must cite the file version.
2. **Driver expenses, parking and tolls:** separate per-job expense ledger with category, amount, currency, incurred date, receipt reference, recorder, and append-only correction/reversal entries. Do not repurpose fuel logs or shipment estimates as actual expenses.
3. **Customer selling prices:** effective-dated customer price lists and immutable job price selections. Manual overrides require a reason, actor, previous value, and a distinct approval decision where policy requires it. Historical blanks remain unknown.
4. **Weekly batches:** customer and Bangkok-local billing week, frozen candidate list, priced line snapshots, exceptions for missing client or job order, and a unique active allocation for each work order.
5. **TRN sequencing:** no final number on drafts. On approved issuance, one database transaction locks the sequence, rechecks work-order allocation, assigns a unique number, and writes an immutable snapshot and audit event. Retried requests are idempotent. Cancelled numbers remain reserved. Existing historical TRN references must be reconciled first.
6. **Approval:** explicit finance-manager capability, separate from ordinary admin. Record approver, decision, time, invoice content hash, and rejection reason. Any draft edit invalidates approval. Decide whether self-approval is prohibited before implementation.
7. **Document packs:** ordered manifest of the approved TRN, job order, parking and toll receipts, and other approved attachments, each pinned to an immutable file version/hash. The customer-facing TRN layout needs an authoritative template before rendering.
8. **Outstanding reporting:** derive balances from issued invoices, credits/cancellations, and recorded receipts with as-of date and aging rules. Never calculate outstanding amounts from workbook column O alone or silently rewrite issued records.

## Gate before Phase 2

Create and identify an isolated development Supabase project; verify its schema and RLS independently of production; apply and exercise Phase 1B there with office, read-only, driver, manager-granted, and ungranted accounts; test file storage policies; obtain authentic paperwork and TRN layout samples; decide invoice approval, numbering, cancellation, and historical reconciliation rules. Until then, Phase 2 database implementation is **NO-GO**.
