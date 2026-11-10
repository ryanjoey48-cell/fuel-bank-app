# Finance Centre V6.2 local review

This refinement works in the existing main tree. It changes presentation and interaction only. Existing unfinished changes were retained. No deployment, database migration, production record write, official invoice issuance or official TRN allocation was performed.

## Screen changes

| Screen | Before | After |
| --- | --- | --- |
| Shared header | Review readiness could appear as document completion; global totals could imply progress for an unselected invoice. | Document completion requires approval without blockers. Unselected stages prompt for an invoice. Draft, awaiting review and approved/not issued remain distinct. |
| Admin Intake | Tall filters and a tall empty form; saved styling could accompany unsaved text. | Single-row toolbar on wide desktops, compact fallback on laptops, a naturally sized selected-booking form, prominent work-order field, visible selection and accurate unsaved styling. |
| Arrange Work Orders | Single-line details truncated routes/drivers; menus could be clipped by the scrolling list. | Wrapped paper details, clearer Add to Invoice wording, singular/plural paper counts, a viewport-positioned menu with arrow/Home/End/Escape navigation and focus return. |
| Customer Billing | Total competed with supporting amounts; text truncated and a locked approved sheet still had a draft caption. | Stronger invoice total, readable wrapped details, aligned cells and lifecycle-aware captions. Selected invoice and customer aggregate remain separate. |
| Invoice & Documents | Width fitting could make a page excessively large on a wide monitor; Zoom In could shrink a wide-fitted page at the old 200% limit. | Automatic reading view uses available width up to 1,000 pixels. Explicit Fit Page, Fit Width and manual zoom up to 400% remain available. Invoice changes reset scrolling instantly while preserving the chosen zoom mode. |
| Pricing administration | Existing separate administration route and access checks. | Authorised access is labelled More → Rates, Fuel & Legacy Billing; the existing legacy screen remains separately accessible. Pricing controls and evidence stay on their existing administration route. |

The EES invoice renderer, legal content, financial calculations, approval actions, server authorisation and floating navigation are unchanged.

The Finance workspace no longer depends on a Google Fonts stylesheet that could reject during navigation when the network blocks it. Existing Thai-capable UI fallbacks remain in use; invoice fonts and artwork are untouched.

## Files changed for this refinement

- `components/finance-workspace-v6.css` — scoped Finance styling, desktop density, mobile layout, readable table inputs and focus states.
- `components/finance-centre-workspace.tsx` — stage/save status, counts, administration menu wording and removal of the failing external stylesheet.
- `components/finance-arrange-stage.tsx` — wrapped paper details, clearer add wording and accessible row menu integration.
- `components/finance-action-menu.tsx` — new viewport-positioned, keyboard-accessible paper action menu.
- `components/finance-billing-sheet-stage.tsx` — invoice total caption follows draft/review/approval state.
- `components/finance-document-viewer.tsx` — automatic reading mode, instant invoice scroll reset and consistent zoom controls.
- `components/finance-trn-documents-stage.tsx` — default automatic reading mode and preserved user fitting state.
- `lib/finance-workspace-view.ts` — reading width cap and 400% inspection zoom geometry.
- `tests/finance-billing-sheet.test.cjs` — current navigation and Add to Invoice labels.
- `tests/finance-v6-workspace.test.cjs` — reading-mode and zoom-limit coverage.
- `tests/finance-v62-browser.cjs` — isolated desktop/mobile workflow, keyboard menu, administration, PDF and print-scope checks.
- `docs/finance-v62-owner-review.md` — this report and acceptance checklist.

Task-only backups, fixtures and logs are under `tmp/finance-v62-*`; screenshots, browser results and draft PDFs are under `output/finance-v62`.

## Owner acceptance checklist

Perform write checks only in the isolated fixture preview. Its customer names explicitly identify fixtures. Do not use live records for this checklist.

- [ ] At 1920×1080, the Finance title, four stages, Finance Records and More are readable without obscuring the floating navigation.
- [ ] In Admin Intake, exercise Today, This Week, This Month, Last Month, custom dates, vehicle and search. Confirm Waiting/Entered/Flagged/All counts and the selected booking remain understandable.
- [ ] Select a booking, enter its green-paper WO, optional customer job number, parking and toll. Expand additional charges and evidence. Confirm receipt costs are not automatically customer charges.
- [ ] Edit a WO and attempt stage navigation. Cancel the warning and confirm the edited value remains. Save it and confirm the save state clears. Exercise Save & Next, Confirm Job and Flag Issue using fixtures.
- [ ] Choose the APL fixture in Arrange Work Orders. Enter a synthetic unassigned WO, review the match and press Enter. Confirm duplicate addition is refused.
- [ ] Reorder a fixture paper with the up/down buttons. Open the last row's More actions menu and use arrow keys, Home, End and Escape. Confirm the menu fits the screen and Escape returns focus.
- [ ] Move a fixture WO between draft groups with a reason, then remove it from its group. Confirm no booking is deleted and audit history is retained.
- [ ] Switch invoice groups. For the APL historical arithmetic fixture, confirm transport ฿23,110, extras ฿1,050 and selected total ฿24,160. Confirm the customer aggregate is explicitly separate.
- [ ] Select WO6144 receipt review. Confirm transport ฿3,300, parking ฿60, toll ฿30 and total ฿3,390. Switch compact/expanded columns and use Enter/arrow/Escape spreadsheet editing.
- [ ] With an unpriced fixture, confirm Price needed remains visible and review/approval is blocked. An entered/manual amount must not say Verified schedule.
- [ ] As an authorised user, open More → Rates, Fuel & Legacy Billing. Confirm rates, fuel, invoice evidence, manual overrides and history are accessible; return to the same billing context.
- [ ] Confirm a draft is labelled Draft, a submitted sheet is Awaiting review, and an approved sheet is Approved, not issued. Awaiting review must not produce a green document-completion tick.
- [ ] In Invoice & Documents, compare Reading view, Fit Page, Fit Width and zoom. Enter/exit Full Screen with Escape. Switch invoices and confirm the first page starts at the top while the chosen zoom is retained.
- [ ] Download single-page and multi-page draft PDFs. Check DRAFT/TEST watermarking and the original EES format. Check invoice and full-pack print previews and their document scopes. Do not issue invoices.
- [ ] Review all four stages at a 390-pixel phone width, and documents at laptop/tablet widths. Confirm no page-level horizontal overflow. The billing spreadsheet may scroll within its table.
- [ ] Switch English/Thai. Confirm labels, focus outlines, invoice data and actions remain readable.

## Verification evidence

| Check | Result |
| --- | --- |
| Full Finance suite | 273 passed, 0 failed, 2 optional source-reference checks skipped (275 total). Log: `tmp/finance-v62-tests-final.txt`. |
| Final focused Finance regression checks | 32 passed, 0 failed. Covers invoice arithmetic, approval safeguards, updated labels, reading geometry and the zoom limit. Log: `tmp/finance-v62-focused-final.txt`. |
| Finance TypeScript | Passed with no diagnostics. Log: `tmp/finance-v62-types-release.txt`. |
| ESLint across the application | Passed: 0 errors, 10 existing warnings. Log: `tmp/finance-v62-lint-release.txt`. |
| Browser workflow | Passed with zero page errors. Results: `output/finance-v62/results.json`; log: `tmp/finance-v62-browser-final.txt`. |
| Production build | Passed, including the final source refresh: `tmp/finance-v62-build-release.txt`, exit code 0. The project config skips built-in type/lint validation, so those checks were run separately above. |
| Wider application source TypeScript | One unrelated error: `components/fleet-visit-map.tsx:53` supplies a `VisitMapBase` without its required `registration`. This file was not changed. Log: `tmp/finance-v62-types-source.txt`. The initial unrestricted repository check exhausted its default Node heap before reporting diagnostics. |

Browser checks covered all four stages at 1920×1080 and at 390-pixel mobile width, plus document review at 1280 and 820 pixels. They exercised date filtering, dirty-edit navigation protection, a failed Save & Next retaining its inputs, successful saving, invoice-group changes, last-row menu positioning and keyboard focus, compact/expanded billing columns, pricing administration access, fitting/zoom/full-screen focus, multi-page scrolling/Home, Thai labels, and no page-level horizontal overflow.

The APL fixture retained transport ฿23,110 + customer-billable tolls ฿1,050 = ฿24,160. The WO6144 fixture retained ฿3,300 + parking ฿60 + toll ฿30 = ฿3,390. Both draft PDF downloads were generated successfully; the multi-page PDF contains multiple pages. Invoice and full-pack print scopes were verified by intercepting the print action. A physical printer/OS print dialog remains an owner acceptance check.

The browser run found and then verified fixes for two issues: Zoom In shrinking a wide-fitted page at the old cap, and a rejected external font stylesheet during navigation. Earlier failed runs remain in task logs; use the final logs named above for release results.

Browser write tests use `tmp/finance-v62-isolated-store` with Supabase credentials cleared by the fixture launcher; the normal Finance store is not their target. The final port 3000 review uses a separate copy at `tmp/finance-v62-review-store`. The isolated QA preview on port 3002 uses its own build directory and test store. No production deployment or real invoice issuance was tested or performed.

Final review: `http://localhost:3000/finance-centre` is running in the background. Both the page and its local-store read returned HTTP 200, and the store was confirmed to contain only synthetic fixture identifiers. Task-generated TypeScript build-directory entries were removed after verification.
