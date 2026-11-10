# Phase 2D: expenses and customer pricing foundation

This work extends the existing Booking Diary UUID and Phase 1B verification. It does not create bookings, issue invoices or assign TRN numbers. The local `/finance-demo` remains fixture-only; the new authenticated `/finance-cost-pricing` screen uses the prepared finance database API.

## Migration order and deployment status

1. `20261030100000_finance_verification_foundation.sql`
2. `20261031100000_finance_paperwork_intake.sql`
3. `20261102100000_finance_expenses_pricing.sql`

All three are **prepared and unapplied remotely**. The development database baseline remains blocked pending verified production schema definitions for missing Insurance and HR objects. Recheck the live Booking Diary and Auth/RLS definitions in a read-only audit before applying any migration to EES Development. Never apply these to production from this worktree.

## Financial records

Expense events are append-only. Corrections add signed delta events; a full reversal adds the opposite of the referenced event and can occur once. An authorized expense reviewer records an approval or rejection in a separate immutable decision row. Pending expense decisions block future billing readiness. Rejected expenses remain in the history but are excluded from approved totals. Every event retains its booking UUID, author, date, receipt or missing-receipt reason, and audit event. Evidence IDs must refer to reviewed paperwork on the same booking. Toll and parking entries require the corresponding receipt kind when a document ID is used. A free-text physical receipt reference is permitted, subject to approval.

Customer price lists are immutable, customer-specific versions keyed by exact route and effective date. The latest version effective on the booking date is used. A newer list version does not rewrite prior history. Job selling-price revisions are separate from expenses; manual proposals store their reason and the available source list price. Every proposal needs a distinct authorized pricing reviewer before readiness. A booking change or a newer effective list version invalidates an old approved list price for readiness. Explicit included expense categories are retained as customer terms but **never calculated into the selling price automatically** in this phase.

The original Booking Diary delete behavior is unchanged. Finance records retain the booking UUID and become inaccessible through client RLS once the booking is absent. Booking existence is checked on every finance write. Before live financial records, management must approve a durable deletion/retention policy for booked jobs with financial history.

## Access

`finance_reviewer` can propose expenses and prices. `expense_approver` and `pricing_approver` are separate explicit grants; the creator cannot approve their own event. Existing `admin` status alone grants no finance capability. All new tables have RLS, authenticated read grants only, and no direct client writes. Security-definer RPCs check the active office account, role grant, booking, document association and data constraints. Finance readiness is calculated in the database from verification, discrepancy, current price and expense decisions. The read-only Finance Centre links to the new screen by booking UUID.

## Decisions needed before live integration

- Confirm which expense categories require a scanned receipt, which can use a physical reference, and who may approve a missing-receipt exception.
- Confirm whether every expense needs independent approval or whether evidence-backed expenses can follow a threshold policy.
- Confirm which customer price overrides need finance manager approval and whether an approver may create price-list versions.
- Confirm customer-specific billable expense terms, tax treatment, rounding and whether zero-priced jobs are valid.
- Decide whether financially referenced bookings can be deleted, archived, or only canceled after finance activity.
- Define how a revised price list affects already approved but unissued weekly batches.

The proposed approvals are deliberately stricter than a threshold policy: all expense events and job prices require separate approval. There is no invoice issuance path.
