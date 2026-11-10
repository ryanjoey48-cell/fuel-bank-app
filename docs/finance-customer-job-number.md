# Optional customer shipment job reference

The existing Admin intake saves `adminReceipts.customerJobNumber` as text in the existing durable Finance workspace envelope. Whitespace-only input becomes null. Letters, leading zeros, punctuation and case remain intact. No number is generated.

Booking Diary's internal `booking_id`, provisional `job_order_number`, confirmed returned green-paper work order, and customer shipment reference remain separate. If a source row supplies `customer_job_number`, the picker prefills it; the intake snapshots it as `originalCustomerJobNumber`. A changed or cleared customer reference is visibly flagged and uses the existing management discrepancy/recheck gate. Source refresh never replaces the entered value or original intake snapshot. There is no inferred mapping from warehouse numbers, booking IDs or work orders to customer references.

The customer reference follows the same linked record through Job Reconciliation, the Finance paperwork view, physical handover, billing preparation, CSV export and the printable draft. It can be searched alongside work orders in the verified paperwork list and in Booking Diary selection when supplied by the source. Internal BK references stay in source details for linked diary cards.

This extends the current local Finance workspace. It does not enable the gated live finance tables, change historical records, add/apply migrations, alter authentication, deploy, or change production configuration. The current Booking Diary schema does not declare a dedicated customer-job column; optional source values are consumed only when actually supplied, without introducing a database dependency.

Verification uses isolated automated references only, including blank, alphanumeric, leading-zero and punctuation/Thai text. Tests cover the original source remaining unchanged, source/returned differences, management reconciliation, full Admin-to-Finance-to-billing handoff, rendered draft output, exact saved receipt amounts and disk save/reload. Actual company test bookings were not assigned invented references.

Validation: 46 focused automated checks passed across intake, source mapping, picker, disk persistence, workflow handoff, workspace separation, UI formatting and pricing regressions. Full TypeScript checking passed. Targeted ESLint reported zero errors and one pre-existing hook dependency warning in the workspace. No manual writes were made to company test bookings.
