# Phase 2F: invoice approval and customer document packs

The authenticated `/invoice-approval` and `/document-packs` workspaces extend Weekly Billing. They freeze approved draft snapshots for manager review and ordered pack preparation. Draft identifiers remain internal `DRAFT-...` labels. No issued TRN number, genuine invoice, customer dispatch or payment record is created here. The offline `/finance-demo` remains fixture-only; INTEGRA `2026-TRN629-INTEGRA.xls` supplies headings and layout only.

## Prepared migration order

1. `20261030100000_finance_verification_foundation.sql`
2. `20261031100000_finance_paperwork_intake.sql`
3. `20261102100000_finance_expenses_pricing.sql`
4. `20261103100000_finance_weekly_billing_drafts.sql`
5. `20261104100000_finance_invoice_approval_packs.sql`

These files remain unapplied remotely. The development database baseline is still blocked by missing authoritative Insurance/HR schema definitions and migration-history reconciliation.

## Approval rules

- `finance_reviewer` submits a current weekly draft for approval. The draft must be active, current and revalidated against every allocated booking.
- `invoice_approver` is a separate explicit grant. Existing admin status alone is insufficient. The preparer cannot approve their own submission.
- Each submission freezes an immutable review snapshot: customer, week, ordered work orders, approved selling prices, paperwork references and draft total.
- Approval or rejection requires a written reason. Rejection allows finance to amend the draft and resubmit under a new submission number.
- Pending and approved submissions are invalidated when the draft is revised, cancelled or marked stale after booking, pricing, paperwork or related changes. Active packs are superseded. Append-only approval events record every transition.
- Duplicate decisions against a non-pending submission are rejected. One pending submission per draft is enforced.

## Document pack rules

- Only an approved, still-current submission can prepare a pack. Pack line order must match the approved weekly billing revision exactly.
- Pack snapshots preserve customer details, billing period, ordered work orders, selling-price breakdown, draft totals and supporting document references.
- Screen layouts recreate INTEGRA invoice and cover headings. Settlement formula cells stay blank. Historical TRN629 figures are never used.
- Green-paper retrieval and customer-dispatch checklists are stored with each pack version. Missing green-paper filing references place the pack on a `missing_paperwork` hold. Customer dispatch remains blocked in this phase.
- Pack history is versioned. Material approval invalidation supersedes earlier packs.

## Before persistent use

Confirm whether a rejected submission should keep the draft locked until amendment, how long an approved unissued draft may wait before pack preparation, whether physical checklist completion is mandatory before any later issuance phase, and the exact printed TRN/cover/attachment sequence against a scanned original. Decide tax, withholding, overtime and advance-payment rules before any settlement cells are filled. Final TRN sequence allocation and payment tracking remain out of scope until a later phase.

The prepared migration has been tested only in an isolated local Postgres-compatible database. It has not been applied to EES Development or production.
