# Future renewal quotation model

No database migration is included in this UI refinement.

The existing `insurance_premium` remains the current-policy premium and must never be overwritten by a quotation. A future implementation should persist quotations separately, preferably in an `insurance_renewal_quotes` table linked to `vehicle_insurance_compliance.id`.

Recommended persisted fields:

- `id uuid primary key`
- `insurance_record_id uuid not null` (foreign key)
- `current_premium_snapshot numeric null`
- `renewal_quote numeric null`
- `renewal_insurer_th text null`
- `renewal_insurer_en text null`
- `renewal_date date null`
- `quote_status text not null`
- `notes text null`
- audit timestamps and user IDs

`difference_thb` and `difference_percent` should normally be derived rather than persisted. Missing premiums remain NULL; a missing value must not be converted to zero. The application-ready comparison contract and pure calculator are in `lib/insurance-renewal-quote.ts`.

Before adding persistence, define RLS, quotation history/selection rules, and whether multiple competing insurer quotes may exist for one renewal cycle.
