# Local Vehicle Performance management update

No deployment, merge, environment changes, database writes, reimports or migrations. Existing financial formulas, historical records, import controls, and branding remain in place. This request did not modify the shared Supabase client.

## Files changed in this request
- app/(dashboard)/vehicle-performance/page.tsx — integrates Business Impact, action queue, fixed-context benchmarks, movement table filters, registration drill-down, compact Data Quality, and removes redundant on-screen management sections. Fetches the selected year's complete dataset once so a registration search does not redefine the benchmark. Monthly totals still use the selected period and registration search. PDF vehicle rows remain unaffected by the movement-only table filter.
- components/vehicle-performance-management.tsx — new management sections and inline vehicle detail with monthly status/benchmark history.
- lib/vehicle-performance-management.ts — pure benchmark, eligibility, status, opportunity, complete-month comparison and per-vehicle movement calculations.
- lib/vehicle-performance.ts — optional statusReason field on the shared row type; existing monetary formulas and legacy helper thresholds unchanged. The page overlays benchmark-aware statuses consistently across its table, rankings, queue and PDF row explanations.
- tests/vehicle-performance-management.test.cjs — 12 new behavioral tests.
- tests/vehicle-performance.test.cjs — updates old layout assertions to the requested consolidated structure.
- scripts/vehicle-performance-business-audit.cjs — read-only source audit using existing calculations and the new model; prints no credentials or owner identifiers.
- scripts/vehicle-performance-visual-preview.cjs — creates a static local visual audit using the actual new React sections and source-derived results.
- output/vehicle-performance-business-audit.json — source-derived audit results.
- output/vehicle-performance-management-preview.html — static preview; controls are intentionally inactive.
- output/vehicle-performance-management-desktop.png, output/vehicle-performance-management-tablet.png, output/vehicle-performance-management-mobile.png, output/vehicle-performance-action-queue.png — screenshots of the static preview.
- output/vehicle-performance-management-tests.txt — targeted test output.
- output/vehicle-performance-management-report.md — this report.

## Source audit and formulas
Read-only SELECT from public.vehicle_monthly_performance (2026 months 1–7: 145 records) and public.fuel_logs (Jan–Jul: 1932 logs), on hafoaurzfgkkwpvzedvd.supabase.co. Fuel is derived through the existing Fuel Spend Report grouping/registration helper and matched only to represented vehicle-month records. No view, RPC or new table is introduced.

| Metric | Verified value |
|---|---:|
| Revenue | ฿23,615,000.25 |
| Fuel | ฿7,841,299.53 |
| Salary | ฿1,087,500.00 |
| Trip Payments | ฿2,086,742.00 |
| Other Costs | ฿266,773.99 |
| Recorded Balance | ฿12,332,684.73 |
| Margin | 52.2239% |
| Fuel / Revenue | 33.2047% |

Recorded Balance = Revenue − Fuel − Salary − Trip Payments − Other Costs. Margin = Recorded Balance / Revenue × 100. Fuel ratio = Fuel / Revenue × 100. Ratios are unavailable for zero revenue. LPG remains the existing separate reference field and is not added again to the already-recorded fuel spend. Monthly totals and per-vehicle totals reconcile within ฿0.01. No monetary calculation bug was found, and no financial formula was changed.

## Benchmark method
Unweighted median of selected-period vehicle ratios. At least three eligible vehicles are required. Eligible means one record per selected vehicle-month, full selected-period coverage, finite nonnegative financial fields, positive revenue in every selected month, and matching fuel-log evidence in every selected month. These conservative exclusions prevent partial or zero-revenue activity from distorting an opportunity estimate. No best-vehicle target or company target is invented. Actual fleet ratios remain revenue-weighted sums.

Current Jan–Jul benchmark: fuel 32.3330%, margin 53.2244%; 19 eligible vehicles, 2 excluded. Registration search does not change this reference; queue results and queue estimate follow the registration search. Business Impact movement counts explicitly describe the full fleet. Individual-month selections use that month's peer benchmark and retain prior-month context from the year's source data.

## Status logic
1. Attention: recorded balance < 0, margin < 35%, or fuel ratio > 45%. Hard thresholds take precedence, including for incomplete vehicles.
2. Monitor: incomplete/insufficient data or fewer than three peers (clearly labelled data review, without an opportunity); otherwise fuel at least 3 percentage points above fleet median, margin at least 3 points below median, or both at least 2 points worse.
3. Strong: margin at least 3 points better with fuel no worse, or fuel at least 3 points better with margin no worse.
4. Stable: remaining eligible vehicles. A single 1–2-point fluctuation does not trigger Monitor.

Every vehicle row has a status reason. A coverage review is not presented as proven financial underperformance.

## Estimated opportunity and action queue
Formula: vehicle revenue × max(0, vehicle fuel percentage − fleet median fuel percentage) / 100.
Only eligible Monitor/Attention rows contribute. Sum once per vehicle; no overlapping margin opportunity is added. This is selected-period indicative fuel opportunity, not achieved savings, not guaranteed savings, and not an annual forecast. Fleet vehicles can have different duties/routes/loads: management must investigate those differences before treating the median as an achievable target.

Current estimated total: **฿402,235.86**, across 7 vehicles. There are 0 Attention and 9 Monitor rows.

| Registration | Status | Months | Fuel % | Margin % | Indicative fuel opportunity | Reason |
|---|---|---|---|---|---|---|
| 61-6672 | Monitor | 7/7 | 39.45% | 46.82% | ฿94,706.25 | Fuel 39.4%, 7.1 pp above fleet median; margin 46.8%, 6.4 pp below fleet median. |
| 64-5954 | Monitor | 7/7 | 38.95% | 47.88% | ฿85,381.79 | Fuel 38.9%, 6.6 pp above fleet median; margin 47.9%, 5.3 pp below fleet median. |
| 78-6996 | Monitor | 7/7 | 36.78% | 48.72% | ฿58,903.49 | Fuel 36.8%, 4.4 pp above fleet median; margin 48.7%, 4.5 pp below fleet median. |
| 700-6659 | Monitor | 7/7 | 36.31% | 49.27% | ฿53,677.81 | Fuel 36.3%, 4.0 pp above fleet median; margin 49.3%, 4.0 pp below fleet median. |
| 62-1085 | Monitor | 7/7 | 35.57% | 50.74% | ฿42,369.80 | Fuel 35.6%, 3.2 pp above fleet median; margin 50.7%, 2.5 pp below fleet median. |
| 61-2835 | Monitor | 7/7 | 35.12% | 49.73% | ฿33,901.97 | Fuel 35.1%, 2.8 pp above fleet median; margin 49.7%, 3.5 pp below fleet median. |
| 64-8665 | Monitor | 7/7 | 34.95% | 50.72% | ฿33,294.76 | Fuel 35.0%, 2.6 pp above fleet median; margin 50.7%, 2.5 pp below fleet median. |
| 701-5145 | Monitor | 5/7 | 31.82% | 46.05% | Not estimated | Coverage / data review: 5/7 months; missing or duplicate vehicle-month records. Peer comparison withheld. |
| 79-5318 | Monitor | 7/7 | 37.42% | 49.49% | Not estimated | Coverage / data review: zero revenue or incomplete financial fields. Peer comparison withheld. |

## Business direction and historical context
June → July: Improving. Revenue +1.6334%; recorded balance +2.7469%; margin +0.5837 pp; fuel spend -0.4896%; fuel ratio -0.7018 pp.

8 vehicles improved, 4 broadly stable, 9 worsened, 0 without comparable June/July data. Direction requires at least two aligned contribution/efficiency indicators and no opposing material signal: margin/fuel moves of at least 0.5 pp, balance of at least 2%, and no materially opposing revenue move of at least 2%. Small or mixed movement is broadly stable. Percentage changes from zero or negative balance are unavailable; absolute direction may support the classification alongside the two ratios. Revenue growth alone cannot classify Improving.

March → July revenue +38.44%. April peak fuel ratio 36.52% → July 32.89%, a -3.63 pp difference. March lowest margin 49.50% → July 53.86%, a +4.35 pp difference. No causation or actual savings is claimed.

## Data quality and limitations
- January and February remain partial: one missing vehicle-month each, for 701-5145. March–July each have 21 records.
- 701-5145 has 5/7 records, including recorded zero revenue in March–May. No estimate for the Jan–Jul selection.
- 79-5318 has 7/7 records but recorded zero revenue in January–February. Excluded from the conservative Jan–Jul benchmark and opportunity estimate.
- Complete fleet months can contain recorded zero-activity vehicles; those real records remain in fleet monetary totals. Zero-revenue vehicle months are excluded from individual ratio comparisons.
- Month-to-month comparisons never bridge a missing calendar month and prefer the latest complete fleet month with sufficient fuel evidence. Historical comparison months have the same expected registration universe from the year's records. Fleet membership outside that historical universe remains visible in existing excluded-vehicle coverage.
- No duty-class or route-adjusted cost target is configured. Fleet medians are indicative operational comparisons.
- New management sections are on-screen additions. Existing PDF report layout is retained; it does not yet export all new Business Impact/opportunity sections.

## New page structure
KPI cards → Business Impact (movement, historical differences, actual vs benchmark, expandable methodology) → Monthly Performance → trend chart → Action Queue → selected vehicle detail → Vehicle Performance table → Rankings → compact expandable Data Quality. Existing Data Management remains below these sections. Movement counts filter only the vehicle table, with an explicit Clear action; registration links open detail without changing the fleet benchmark.

## Verification
- PASS: 66 targeted tests across management, existing performance/import/PDF assertions, fuel reporting and authorized-fetch behavior. Includes duplicate/missing months, zero revenue, missing fuel evidence, no peers/no data, status tolerances, hard attention thresholds, no false revenue-only improvement, no bridging missing months, single-month comparison context, no input mutation and total reconciliation.
- PASS TypeScript: npx tsc --noEmit --incremental false.
- Static visual inspection at desktop, 820px tablet and 390px mobile. New sections use the existing Tailwind/style definitions; screenshots are explicitly static previews of real source-derived data, not evidence of authenticated UI interaction.
- Available live browser reached login. No authenticated session was available, and user sign-in was requested. Live click-through verification of registration search, movement filters, drill-down, refresh and PDF remains pending. No login bypass, credential reset or fabricated session was used.
