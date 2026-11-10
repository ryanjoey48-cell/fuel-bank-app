# Finance Centre implementation — 4 November 2026

## Recovery and baseline

- Working branch: `main`. Extensive existing tracked edits and untracked Finance/Fleet work retained. No checkout, reset, commit, push, deployment or remote migration performed.
- Existing picker: master/detail cards, server-side inclusive date range, 1,000-row pagination, stable booking IDs, search and existing-link opening. Existing tests mostly assert source structure rather than exercising real queries.
- Finance Centre uses `FinanceFixtureProvider`, local browser cache and `.ees-local/finance-test/state.json`. It is a local test workspace, not an authenticated multi-user finance backend.
- Read-only store inspection found **2 owner Booking Diary records**, plus **17 previous-demo records**, 50 demo documents and one demo batch. The approximately 18 genuine papers described in the request are not available for acceptance testing. User confirmed no real paper/work-order reference is available yet.
- Store SHA256 before browser inspection: `63f860a18343baccfd4daf57adc3711e07104f34c164e2afa37fc75158e35365`.
- Existing modules/migrations cover verification, document reservation/storage, discrepancy decisions, expense/pricing decisions, weekly billing drafts and invoice pack approval. These are foundations, not evidence that a remote schema has been installed or the integrated local workspace uses them.
- All three customer pricing PDFs are missing from the workspace search. Example rates in the brief are not a complete source schedule.

## Dependency checklist

- [x] Inspect Git state, Finance architecture, test persistence, existing migrations and tests.
- [x] Add actual green-paper work order during selection; atomic validation; retain string formatting and duplicate protection.
- [x] Put picker in browser modal top layer; lock background scroll; restore focus; retain master/detail layout.
- [x] Add explicit local-test physical handover and Finance receipt actions.
- [x] Add customer/week paper stacks, search, add, remove, up/down reorder and ordered CSV checklist.
- [x] Connect stacks to existing job pricing and add Save & Next Paper.
- [ ] Complete full required reconciliation field/signature/time coverage and authenticated integrated workflow.
- [ ] Import exact source PDF versions, fuel bands and approved route/customer mappings.
- [ ] Establish permitted historical Diesel B7 access and validated date-specific retrieval; manual evidence workflow still required.
- [ ] Install/review operational persistence in an authorized non-production database; never migrate simulated approvals.
- [x] Browser-check updated picker and integrated Finance panel without entering fabricated business data.
- [ ] Complete genuine paper acceptance test and exact 1366×768 responsive acceptance.

## Workflow and limitations

Booking selection now atomically links an existing booking and entered work-order string into local Finance state. The returned fields remain empty and status remains pending. Existing links open without assigning a second number. Office still must enter returned details and satisfy document checks before verification. Verified jobs appear in the customer/week paperwork inbox; Office explicitly marks physical originals ready, then Finance explicitly confirms receipt. Finance adds received papers to a saved arrangement before pricing, and removes/reorders them without deleting original jobs. The existing manual pricing and draft billing functions continue using the linked job.

All local role choices, decisions, receipts and approvals remain **test actions**. No authenticated real approval is implied. No real-job work orders, receipts, verification, receipt confirmations or approvals were entered during development. Historical Booking Diary rows are never imported in bulk or written by these new actions.

The arrangement is separate from billing allocation: temporary table sorting cannot change its order. Finance can explicitly copy the saved physical order into an empty matching customer/week billing batch. This validates every paper before committing the allocation. The checklist CSV is DRAFT/TEST; invoice numbers remain blank. Customer extras are entered separately from internal expenses, require evidence, reject duplicate evidence across categories, and use integer-satang totals. Draft totals and print summaries include those customer extras.

## External fuel investigation

The business-selected [historical fuel page](https://xn--42c6baaa9bl0b2fcebb3cztja2d.com/history) is reachable and displays Diesel B7 and daily dates. No API or automated-access permission has been established. Attempts to retrieve its terms/robots with the web tool were unsuccessful. Do not treat displayed current prices as a historical job-date lookup, carry prices forward, or infer absent bands.

## Validation

Final check results appear below. Automated fixture results are distinct from genuine business acceptance. The temporary port 3001 server was stopped after port 3000 verification.

## Completion report A–J

### A. Existing work recovered

Preserved the paginated date-filtered picker, stable-ID deep links, existing reconciliation/documents/pricing/billing modules, role simulation, local persistence, previous demonstration workspace and additive SQL foundations. Existing non-Finance edits were retained. No AGENTS.md was found by the workspace file search.

### B. Files changed in this implementation

- `components/finance-booking-diary-picker.tsx`: immediate work-order input, modal top layer/focus/scroll behavior, denser detail grid, date search and stable pagination tiebreaker.
- `components/finance-fixture-provider.tsx`: atomic booking/work-order linking and synchronous action validation/result for navigation.
- `components/finance-centre-workspace.tsx`: integrated paperwork stack, Save & Next Paper, price form reseeding per job and customer totals.
- `components/finance-paper-stack.tsx` (new): customer/week inbox, explicit handover/receipt, saved sequence controls, customer extras, ordered CSV and billing order handoff.
- `components/finance-demo-print.tsx`: customer extras included in draft job totals.
- `lib/finance-demo-centre.ts`: local workflow actions, source snapshot, no invented diary job number/completion, handover/stack gates, customer extras and integer-satang totals, draft-edit/revalidation safeguards.
- `tests/finance-booking-diary-picker.test.cjs`: updated expected action label.
- `tests/job-verification-phase1b.test.cjs`: legacy link expectation updated to the integrated stable-ID Finance Centre reconciliation URL already used by Booking Diary.
- `tests/finance-booking-query-runtime.test.cjs` (new): executable query tests with a stubbed read-only database client.
- `tests/finance-master-workflow.test.cjs` (new): isolated workflow tests.
- This report and `output/finance-master-*` verification logs.

Temporary `.next-finance-master` and `.next-fm-dev` type includes were removed from the already-modified `tsconfig.json`. Next.js added the running `.next-finance-port3000-master` type include. These are tooling effects, not finance features. Existing user changes were not reverted with checkout.

### C. Features completed in code and isolated tests

Atomic explicit booking/work-order selection; exact leading-zero/decimal-suffix identifiers; duplicate rejection without partial link; empty returned fields after linking; explicit verification → Office handover → Finance receipt gates; customer/week paper sequence before pricing; add/remove/reorder with original jobs retained; customer extras separated from internal costs; duplicate receipt-evidence rejection across categories; integer-satang totals; ordered allocation into an empty matching weekly batch; draft-only output and no final TRN issuance.

### D. Partial features

The native modal is browser-verified; Save & Next Paper renders with its gates but has not been exercised with actual papers. Sequence persistence uses the existing local store; automated JSON round-trip testing does not constitute browser refresh verification. Customer extras currently have no dedicated correction/removal UI. Draft print summaries include the total, while the full itemized extras breakdown is visible in Finance and in the ordered CSV. Physical handover confirmations record simulated role identity, not a real authenticated actor.

### E. Missing or blocked

Exact PDF rate import, customer-contract route confirmation, approved historical rate versions, permitted automated historical Diesel B7 lookup, and a manual verified fuel-evidence UI remain outstanding. The existing reasoned manual-price fallback works in local tests. Reconciliation still needs full returned customer/job-number/time/signature coverage. Operational handover/sequence/pricing snapshots are not connected to authenticated Supabase persistence. No real paper was available; user confirmed the current goal is getting the system working before that exercise.

### F. Testing evidence

- `node --test tests/finance-master-workflow.test.cjs tests/finance-booking-diary-picker.test.cjs`: **9 passed** in `output/finance-master-new-tests2.txt`.
- `node --test tests/finance-booking-query-runtime.test.cjs`: **2 passed** in `output/finance-master-query-runtime.txt`; includes 1,001 January fixtures, inclusive boundaries, exact WO preservation and no query for a reversed range.
- `node --test tests/finance-master-workflow.test.cjs tests/finance-booking-diary-picker.test.cjs tests/finance-demo-workflow.test.cjs tests/finance-local-persistence.test.cjs tests/finance-workspace-separation.test.cjs`: **25 passed**, `output/finance-master-regression-final.txt`. Later receipt/source-status hardening requires the final follow-up check.
- Earlier broader baseline: `node --test tests/finance-*.test.cjs tests/job-verification-*.test.cjs`: 82 tests, 78 passed, 2 skipped, 2 failed. The picker-label assertion was subsequently updated and passes. The legacy `job-verification-phase1b` assertion still expects a `/job-verification?booking=` link, while the recovered application intentionally routes Reconcile Job into Finance Centre. It was not rewritten to conceal this mismatch.
- Final `node --test tests/finance-*.test.cjs tests/job-verification-*.test.cjs`: **88 tests, 86 passed, 2 skipped, 0 failures**, `output/finance-master-suite-final.txt`. This includes the latest receipt/source-status and draft safeguards. The stale legacy link assertion was corrected to the actual intended Finance Centre route, not removed.
- Final `npm run lint`: **0 errors, 13 warnings**, `output/finance-master-lint-final.txt`.
- Full `node node_modules/typescript/bin/tsc --noEmit --incremental false`: **exit 0**, `output/finance-master-types-check2.txt`.
- `FUEL_BANK_DIST_DIR=.next-finance-master-build npm run build:isolated`: failed with Windows EPERM creating the unrelated Forth history output directory. The final full production-build retry was stopped after remaining in compilation; **no successful production build is claimed**.
- Browser: after restarting port 3000 with the updated code, the signed-in Finance Centre and new paperwork/charge panels rendered. The picker loaded 1,587 existing bookings; searching `19/01/2026` returned **11 Amazing bookings**. Selecting an unlinked booking displayed the green-paper input and disabled blank-work-order submission. Screenshot inspection showed the modal above dimmed navigation, with no horizontal table scroll. Escape closed it and returned focus to the picker button. The owner count stayed 2 and the previous-demo count stayed 17. No work order was entered, linked, verified, received or billed. Exact date-field interaction and 1366×768 acceptance were not completed; date-filter server calls are covered by the executable stub tests.

### G. Data safety

The persisted store SHA256 remained `63f860a18343baccfd4daf57adc3711e07104f34c164e2afa37fc75158e35365` after initial browser inspection, matching the baseline exactly. No operational bookings, job orders, receipts, approvals, invoices or TRNs were fabricated or changed. Test fixtures remain in automated tests. No remote SQL was applied. No historical bookings were bulk imported.

### H. Business journey

Implemented local path: select existing diary booking and actual WO → enter returned details/documents → reconcile and resolve discrepancies with Office recheck → verified customer inbox → Office ready-for-handover confirmation → Finance physical receipt → customer/week paper order → existing manual transport price and separately reviewed extras → Save & Next Paper → transfer physical order to empty weekly batch → existing draft billing/approval/print flow.

This path is supported by isolated tests, not genuine end-to-end business acceptance. Missing source-rate/fuel automation and required reconciliation checks prevent declaring the entire requested system complete.

### I. Operational readiness

**Not production ready or multi-user ready.** Local role selection is a simulation. Existing authenticated SQL modules are review foundations and were not installed or switched on. Further schema/API integration and authorized development-database tests are required; simulated history must never be imported as real approval history.

### J. Localhost, commits and deployment

After identifying its exact Node listener, the local port 3000 server was restarted to load the updated code while retaining the existing sign-in origin and saved data. The updated development server uses `.next-finance-port3000-master` and successfully compiled `/finance-centre` (939 modules). Port 3001 validation reached login because it had a separate session; no credentials were copied or auth bypassed. Read-only browser checks of the updated picker and Finance panels succeeded on port 3000. Genuine end-to-end paper acceptance remains incomplete. No commits, pushes, deployments, final invoices or final TRNs were created.
