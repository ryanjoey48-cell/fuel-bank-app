# Phase 2E: weekly billing and unnumbered drafts

The authenticated `/weekly-billing` workspace extends Booking Diary, Paperwork Intake, Job Verification and Expenses & Customer Pricing. It reads existing booking UUIDs and never creates operational bookings. The offline `/finance-demo` remains fixture-only and retains the source-verified 15-row demonstration; the INTEGRA spreadsheet is solely a visual reference. No customer document, issued TRN number, real invoice or payment record is created here.

## Prepared migration order

1. `20261030100000_finance_verification_foundation.sql`
2. `20261031100000_finance_paperwork_intake.sql`
3. `20261102100000_finance_expenses_pricing.sql`
4. `20261103100000_finance_weekly_billing_drafts.sql`

These files remain unapplied remotely. The existing development database baseline is still blocked by missing authoritative Insurance/HR schema definitions and migration-history reconciliation.

## Draft rules

- A billing week is Monday through Sunday in Thailand. A batch belongs to one customer and one week. A partial unique index permits one open batch per customer-week.
- A draft has only a UUID-derived `DRAFT-...` internal identifier. There is no final TRN or invoice field and no issuance function.
- Each selected booking must be in that customer-week, have a nonblank work-order number, verified paperwork, no management hold, the latest customer price approved and all expense decisions resolved. A zero or overflowing total is rejected. Internal expenses are not added to customer prices.
- A unique active allocation per booking UUID and per customer/work-order reference prevents two active drafts from claiming the same job. These constraints arbitrate concurrent finance users. A draft row lock and expected revision number prevent a later editor from silently replacing another user's change. Exact repeat amendments are rejected.
- Every create or amendment writes a full, ordered, immutable revision: booking snapshot, pricing approval snapshot, line amount and total. The current allocation is a transactionally updated projection. Removal, reorder, cancellation and automatic staleness each leave append-only billing events. Cancellation releases allocations but retains all snapshots.
- Booking, verification, paperwork, price, expense and relevant price-list changes mark affected drafts stale. Amendments revalidate every selected job. No approval or issuance state exists yet; Phase 2F must require a fresh validation before approval.
- Only an active office account with an explicit `finance_reviewer` grant can call draft mutation functions. Direct client table writes are revoked. Finance draft reads are protected by RLS and existing Booking Diary access. Existing admin status alone is insufficient.

## Before persistent use

Confirm whether EES permits more than one draft per customer-week, how duplicate work-order references across years are handled, whether a zero-priced work order is allowed inside a positive batch, and the treatment of taxes, discounts and customer-specific reimbursable items. Decide how stale drafts are reviewed after a booking or price-list change. Phase 2F must define approval separation, cancellation after approval, final TRN sequence allocation, exact print-pack rules and payment tracking before any invoice is issued.

The prepared migration has been tested only in an isolated local Postgres-compatible database. It has not been applied to EES Development or production.
