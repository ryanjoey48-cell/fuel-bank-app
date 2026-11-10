# Finance Centre Phase 1H source reconciliation

## Scope and provenance

The local demonstration reads a static snapshot of the supplied **test data for EES system - Finance.xlsx**, sheet `Sheet1`, populated data rows 2–16. The workbook SHA-256 is `87bae7e93c760c7c54bd2092fe1e401e0759b2682b83989db81cf4f5a13e3781`. Each copied row in `lib/finance-demo-source-data.json` retains its worksheet name and row, and a test compares every copied field with the local reference workbook. The raw workbooks in `demo-references` are ignored by Git.

The 15 distinct work orders total **฿35,000** in column O, headed `Total Amount Collected`. Column I totals **฿5,800** and column J totals **฿600**. These columns are kept separate; they do not establish internal cost, selling price, paid status or an issued invoice without additional evidence. Source customer groups are Mass (3 orders, ฿8,000, historical `TRN010/2026`), Amazing (11 orders, ฿24,200, `TRN037/2026`), and Neo Tradex (1 order, ฿2,800, `TRN042/2026`). All job-number cells in D and all K–N amount cells are empty. The demonstration leaves these fields unrecorded. Dates use Excel serial calendar days without a time-zone shift.

The on-screen returned order, green paper, receipts, document matching, discrepancy, management resolution, office re-verification, finance confirmation and approval are explicitly simulated. The source workbook is not checked against the live Booking Diary or physical originals. Recorded amounts begin unconfirmed; finance must confirm an exact workbook amount or enter a justified manual price before billing. Historical TRN strings remain read-only source references. New drafts use `SIM-BATCH-*` and receive no final TRN number.

## INTEGRA layout reference

The supplied **2026-TRN629-INTEGRA.xls** SHA-256 is `4edfe654f35dad01338189b8859e4f82a0e4a57e39c801953ce6567242f9cd78`. Its sheets are `trn` and `ใบปะหน้า`. The invoice displays the bilingual `ใบแจ้งหนี้/INVOICE` heading at D7 and historical `TRN629/2026` at K8. Row 13 has date, pickup, delivery, work order, parking, overtime, fuel rate and amount headings. The demonstration recreates this table structure and a cover/manifest page with visible `DEMONSTRATION / ตัวอย่าง` marks. It does not claim exact Excel or printed visual fidelity, nor use `TRN629/2026` as a new number.

The source sample has a material formula disagreement: invoice `trn!L22` calculates `L18-L20+L21` and caches **฿5,051**, whereas cover `ใบปะหน้า!J11` calculates `E11-F11+G11+H11+I11` and caches **฿5,451**. The ฿400 difference aligns with the sample overtime total. The demonstration excludes these settlement formulas and shows only the selected source recorded amounts. Its cover-style page repeats the verified column headings but leaves freight, withholding, parking, overtime and due cells blank, because the test workbook does not establish those values for the new draft. Management must settle the intended overtime, tax and advance-payment rules before production invoice work.

## Local walkthrough

The completed Mass demonstration matches three work orders from the January 5 week; one initially lacks simulated paperwork and one is escalated for a simulated route mismatch. Management resolves the mismatch and office re-verifies. Finance confirms the three workbook column O amounts, logs a separate simulated internal expense using a verified column I figure, and creates one weekly draft for **฿8,000**. The simulated approver approves the unnumbered draft; the sample pack orders the draft, three work orders and nine DEMO documents (13 items total). Separate Amazing and Neo Tradex batches reconcile to **฿4,400** for two currently eligible Amazing orders and **฿2,800** for the currently eligible Neo Tradex order. The remaining source orders require workflow actions before billing.

## Open decisions

- Confirm which source field is the contractual customer selling price and whether `Total Amount Collected` means billed, collected, or a demonstration total. The local UI treats it as a recorded amount requiring finance confirmation.
- Supply the live Booking Diary and paper originals for a real reconciliation. Current matching is demonstrative only.
- Resolve the INTEGRA invoice/cover overtime discrepancy and the intended withholding, advance, tax, and due calculations.
- Approve the exact printed TRN, cover and attachments layout against a scanned or exported original before any live issuance.

No remote database, customer document, final TRN sequence, or production financial record is modified by this demonstration.

## Validation results

- Focused Finance Centre test files: **21 passed, 0 failed**, including all-row workbook reconciliation, customer grouping, pricing gate, historical/draft separation, INTEGRA formula checks and print headings.
- TypeScript: `npx tsc --noEmit` passed.
- Full repository suite after the final print check: **807 tests, 750 passed, 57 failed**. The 57 failures match Phase 1G's count and categories: Booking/Trip static assertions, driver UI, HR/People environment checks, and vehicle/maintenance assertions. No Finance Centre test failed. These remain a release blocker outside the permitted scope of this phase.
- Isolated local production build passed. Its app-paths manifest, server route directory, static chunks and route list contain no `/finance-demo`.
- Local fixture server returned HTTP 200 for `/finance-demo`, including source work order `219` and a visible `DEMONSTRATION` label. No Supabase credentials were passed to the fixture server.
