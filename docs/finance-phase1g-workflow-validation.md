# Phase 1G workflow validation

The local `/finance-demo` now starts with 20 clearly fictional work orders across two example billing weeks. They include returned paperwork awaiting matching, four jobs with absent receipts, three booking/returned-order destination mismatches, two verified and priced jobs ready for billing, and one verified job awaiting a customer price. These are not historical EES records.

Every job in Overview and Reporting has a derived next action, responsible role, and link to the relevant view. A selected job also shows its next action in Verification and Expenses. The link into Billing selects that job's customer and week; disabled workflow actions show role guidance. Batch validation lists empty, duplicate, customer/week, verification, and pricing blockers before an unnumbered draft can be prepared. Work-order identity is checked across active allocations.

The optional **Open completed walkthrough** button builds a sample pack by replaying the same role-gated actions used by the interactive demonstration. It does not bypass job verification or management recheck. The sample contains three ordered work orders, a ฿7,500 customer billing total, separate ฿595 recorded internal expenses for one job, a manual price reason, simulated finance-manager approval, and a 14-item pack manifest. The manifest and print view include document references, physical-original filing locations, a dispatch checklist, and a prominent `DEMONSTRATION / ตัวอย่าง` watermark. No final TRN number exists.

## Validation results

- Phase 1G scenario tests: 4 passed; Finance/Booking-focused tests: 24 passed, 0 failed after the final fixture shortcut.
- TypeScript: `tsc --noEmit --incremental false` passed.
- Local browser: the 20-job Overview, Thai Weekly Billing role guidance, and Thai completed pack with 14 ordered items rendered. The fixture-only server returned HTTP 200 without Supabase configuration.
- Isolated production build: passed. `/finance-demo` is absent from the app-paths manifest, server route directory, client chunks, and build route list. The local build needed execution outside the restricted filesystem sandbox because Windows denied generated `.next-maintenance-qa` directory creation there. No remote operation occurred.
- Full repository suite before the final fixture shortcut: 800 tests, 743 passed, 57 failed. The earlier “115 failures” figure counted reporter output twice. The 57 failures comprise 3 Booking/Trip static assertions, 38 driver UI assertions, 11 HR/People tests, and 5 vehicle/maintenance or other assertions. The HR tests show local `127.0.0.1` `EACCES` socket errors in the restricted test environment. Driver UI failures reproduce when run alone. No Finance test failed, and the 57 failures match the preceding Phase 1F run. The Phase 1E baseline was 42 failures on a smaller 791-test suite; this suite is not a clean release gate.

The original `2026-TRN629-INTEGRA.xls` and latest `EES System upload data(3).xlsx` were not accessible. Print layout is a labelled temporary preview; historical values were not invented.

## Decision

**GO** for a local, fixture-only management walkthrough. **NO-GO** for development database deployment, live invoice issuance, customer dispatch, or production deployment until the database baseline, authoritative TRN layout, and unrelated release-gate failures are resolved.
