# Finance Centre Phase 1B development foundation

This branch is an isolated development implementation. The migration has **not** been applied to production. It adds no pricing, invoice, TRN, document storage, or customer sending behavior.

## Local demonstration

With an existing development office sign-in, open `/job-verification?demo=1` and `/finance-centre?demo=1`. The five records are fictional, in-memory, and marked **SIMULATED**. The page components make no verification or finance data calls in demonstration mode; the dashboard shell still checks authentication.

The source-backed read-only view is at `/job-verification?demo=historical` and `/finance-centre?demo=historical`. Its source facts come from five exact rows of `EES System upload data.xlsx`, SHA-256 `4eccbd2bcf136957acd607060d8adc0ad6ff4acd927f615b17505e2d046edfef`; each workflow outcome is separately labeled simulated. The workbook contains no customer column or returned-paperwork files. Source TRN references are displayed only and are never issued by this feature.

For a database-backed local test, apply `supabase/migrations/20261030100000_finance_verification_foundation.sql` only to a development database whose preceding EES migrations have been applied. The normal page at `/job-verification` reads existing bookings. The finance overview at `/finance-centre` shows verified jobs with `handover_status = ready` and offers no write action.

The signed green order is always required. Parking and toll receipts can be marked not applicable only with a recorded reason. A received required document needs a paper or photo reference. This stage stores checklist metadata and references only; no photos are uploaded. Staff must compare the physical diary and returned paperwork before submission. A driver completion event or trip status alone does not verify a job. A client, job order number, driver, and vehicle registration must be present before finance readiness.

## Access and audit

Active `office_staff` and `admin` accounts may submit a verification through `finance_submit_verification`; `read_only` and driver accounts cannot. Direct writes to the new finance tables are not granted to authenticated clients. Management resolution requires a row in `finance_role_grants` with `capability = 'management_reviewer'`, as well as an active office account. An existing admin receives no automatic management review or invoice approval grant. Only a development database owner may assign a grant after management names the reviewer; there is no client-side grant endpoint. The `finance_reviewer` and `invoice_approver` capability names reserve the boundary for later phases and confer no Phase 1B write action.

Every verification submission records the booking snapshot, observed fields, document checklist, actor, time, and revision in append-only `finance_audit_events`. An open discrepancy blocks resubmission until management resolves it. Resolution records the decision and blocks finance until office rechecks. A change to key Booking Diary fields invalidates finance readiness while leaving the diary edit itself available. Booking deletion remains available; finance records and audit history stay intact with readiness blocked. The source booking has not been redesigned.

The migration should be reviewed against the **actual** development schema before use. `supabase/schema.sql` is not a complete representation of later migrations. Finance RLS and functions should be exercised with office, read-only, driver, management-granted, and ungranted sessions before any production migration proposal.

Phase 1C found no separate development Supabase project. The local, backup, and Vercel preview environment files all point to the same Supabase project, and the user confirmed there is no separate development project. The migration therefore remains unapplied. In-memory PGlite tests are useful contract checks, but do not replace Supabase integration or browser testing against persistent records.

## Next stages

The broader design still requires private immutable document attachments, internal expense revisions, effective-dated customer prices and override history, weekly customer batches, transactional TRN issuance with one work order per issued TRN, separate finance-manager approval, ordered document packs, historical reconciliation, and reporting. None of these are enabled by this branch. Numbering, cancellation, tax treatment, management authority, and the authentic customer TRN layout need decisions before invoice code is written.
