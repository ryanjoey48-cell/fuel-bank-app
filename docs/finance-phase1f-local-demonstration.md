# Phase 1F local Finance Centre demonstration

The development-only `/finance-demo` route now contains nine connected English/Thai views: Overview, Paperwork Inbox, Job Verification, Management Review, Expenses & Pricing, Weekly Billing, TRN & Invoice Drafts, Print & Document Packs, and Finance Reporting. The workflow uses one in-memory state model and five explicitly fictional bookings. It does not read or write Supabase, issue TRN numbers, send documents, or change the live Booking Diary.

Office staff can match the simulated returned documents to work orders, record where paper originals are filed, and compare returned details with the diary. Missing documents and mismatches block finance readiness. Only the management role can resolve a mismatch; an office recheck is required afterward. Finance can record separate internal expenses and customer prices, group eligible work orders by customer and week, reorder them, and prepare an unnumbered draft. A distinct approver role can record simulated approval. The printable pack is watermarked as a demonstration and has an ordered manifest, original-retrieval list, and dispatch checklist.

The requested `EES System upload data(3).xlsx` and `2026-TRN629-INTEGRA.xls` were not accessible in the local workspace. No historical values or claims of exact TRN template fidelity are used. The print layout is temporary.

## Verification

- Focused Finance and Booking Diary tests: 20 passed, 0 failed.
- TypeScript check passed before the final copy-only error-message adjustment; the final repeat was interrupted by a stalled local command.
- Local browser: HTTP 200, nine views visible, Thai navigation and paperwork inbox rendered without Supabase configuration.
- Production route exclusion is covered by the route/config test. A fresh isolated production build could not finish because Windows denied creation of generated `.next-maintenance-qa/server/app/api/admin` directories (`EPERM`). A prior Phase 1E isolated build confirmed `/finance-demo` was absent; the current build requires a clean environment rerun.
- Full repository suite: 797 tests, 740 passed, 57 failed. The earlier count of 115 counted failures twice because the test reporter prints them again in its final list. No Finance-related test failed. Failures span unrelated driver/route, HR, vehicle/maintenance, Booking Diary static assertions, and integration/environment checks. This exceeds the earlier 42-failure baseline, so it is not treated as a clean regression gate.

## Open locally

In this worktree, run `npm run dev:finance-demo`, wait for `Ready`, then open `http://localhost:3102/finance-demo`. Switch the displayed role and language to show each step. Refreshing resets the fictional state.

## Before live development

Obtain the authoritative customer TRN layout and latest historical workbook, confirm expense and price-override policy, and complete the separate development database baseline and RLS work. None of those are prerequisites for a fixture-only management walkthrough.
