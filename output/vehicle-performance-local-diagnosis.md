# Vehicle Performance local diagnosis — 9 September 2026

Root cause: the uncommitted recovery Supabase client passes `Authorization: Bearer <anon key>` into PostgrestClient and StorageClient. Its authorized fetch previously consulted the authenticated session only when Authorization was absent. Therefore normal database requests retained anonymous authorization even after login. Read-only live queries reproduced HTTP 200 with zero performance rows for anon, while the service-role read found the existing records. The original performance SELECT policy is authenticated-only and owner-scoped. No policy was weakened or changed. Authenticated live SELECT with the user's actual session remains to be verified.

A second local serving issue was observed: port 3000 ran `next start` (previous build), and browser inspection reported a ChunkLoadError. That verified Fuel Bank process was stopped and replaced with `npm run dev` on port 3000. It reports `.env.local` and successfully serves the login page. The temporary second dev process on 3001 was stopped. Starting two processes may also have affected shared build artifacts; the missing chunk's earlier cause was not independently established.

## Source and branch
- Route: `app/(dashboard)/vehicle-performance/page.tsx`.
- Branch: `codex/weekly-mileage-795318-baseline`.
- Route, `lib/vehicle-performance.ts`, `lib/vehicle-identity.ts`, related performance tests and migrations are untracked local work, not ignored. No route history was found across local Git refs; route and these helpers are absent from local main.
- Other prerequisites include local changes in `lib/data.ts`, `types/database.ts`, translations, and the untracked `lib/fuel-spend-report.ts` and safe browser storage helper. Existing unrelated changes were preserved.

## Exact data path
- `fetchVehicleMonthlyPerformance` reads `public.vehicle_monthly_performance`, select *, sorted by year/month/registration, filtered by numeric year/month and optional registration ILIKE. It throws database errors and converts financial numerics.
- `fetchVehicleMonthlyFuelSpend` -> `monthDateRange` -> `fetchFuelLogsForExport` -> `public.fuel_logs`, paginated in 1,000-row ranges with date bounds, optional-column fallback, then `buildFuelSpendReportVehicleMonthlyFuelRows`. Uses log `total_cost`, calendar date, canonical registration. No driver-name join controls performance eligibility.
- `fetchVehicles` reads `public.vehicles`, caches and merges registrations for coverage and import matching.
- `buildVehiclePerformanceRows`, `getVehiclePerformanceFuelMap`, `calculateVehiclePerformanceMetrics`, `buildVehiclePerformanceSummary`, `buildVehicleMonthlyTrend`, and `buildVehicleMonthlyPerformanceRows` derive displayed totals and coverage in memory.
- Import: XLSX workbook chosen by user -> `parseVehiclePerformanceWorkbook` -> explicit vehicle matching and fuel validation -> `saveVehicleMonthlyPerformance` writes the same performance table. Workbook is not a runtime historical-data fallback. Existing local reconciliation CSV is diagnostic output, not a page data source.
- `public.vehicle_performance_import_reviews` holds durable review decisions, fetched during import; it is not the source of revenue. `public.vehicle_performance_correction_audit` stores correction audit writes. Neither is required to load the initial performance dashboard.
- No view or RPC is called for performance dashboard reads. Existing SQL audit triggers and RLS policies govern writes/reads; no migrations were executed.

## Environment
Next env loader and restarted dev server load `.env.local`. `.env` is absent; `.env.example` exists. Host: `hafoaurzfgkkwpvzedvd.supabase.co`. `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and server-only `SUPABASE_SERVICE_ROLE_KEY` are present. No additional SUPABASE variable names were found in the resolved environment. `next.config.ts` forwards the public URL/key into the client build. Service-role key was used only in terminal read-only diagnosis, never added to frontend code. No env files changed. The previous running build's embedded environment was not independently compared.

## Live historical inventory (read-only)
149 total performance rows; 145 in January–July 2026, across 21 registrations. All 145 have a non-null owner and belong to one owner. Period columns are year/month, not a transaction date: historical min/max 2026-01 / 2026-07. Across the entire table the min/max periods are 2000-03 / 2085-05. Four out-of-period rows were left untouched; their origin was not assumed.

| Month 2026 | Records | Revenue THB |
|---|---:|---:|
| January | 20 | 2,631,060.00 |
| February | 20 | 2,438,960.00 |
| March | 21 | 2,966,221.00 |
| April | 21 | 3,390,891.25 |
| May | 21 | 4,041,084.00 |
| June | 21 | 4,040,395.00 |
| July | 21 | 4,106,389.00 |
| Total | 145 | 23,615,000.25 |

Registrations: 61-6672, 62-4337, 64-5956, 64-8665, 68-7154, 700-4145, 61-2835, 62-1085, 63-3543, 64-0359, 64-5954, 700-6659, 701-1654, 74-8969, 78-6996, 79-2945, 79-5318, 3ฒน-9565, 3ฒล-4565, ฒอ-8453, 701-5145.

17 import review rows remain for March, April, May and July 2026. Anonymous reads return zero for both tables. Privileged counts demonstrate presence, not the user's account authorization.

## Filters and identity
Default year is numeric 2026. All loaded months intentionally selects the existing Jan–Jul baseline. Search filters registration in SQL and in memory. Performance rows drive represented vehicles; fleet membership and driver assignment do not discard historical records. Financial null values normalize to zero rather than excluding records. Status and completeness are derived after grouping, not initial database filters. Full registrations already exist in the historical rows. Existing explicit aliases cover 9565, 4565, 8453 and 100-6659 -> 700-6659; no broad suffix matching was added. No evidence registration matching caused the all-zero dashboard. Calculation, eligibility, baseline months, and data-quality rules were preserved.

## Files changed by this task
- `lib/supabase.ts`: replace missing/default anonymous authorization with current session token on each request; propagate session errors instead of silently falling back. Preserve explicit non-default authorization.
- `app/(dashboard)/vehicle-performance/page.tsx`: require session before fetch; separate load error; show loading, retryable error or “No performance records found”; hide KPI/coverage results during failed/empty/loading reads; guard late responses from old filter requests; disable PDF on load failure.
- `tests/supabase-authorized-fetch.test.cjs`: four behavioral regression tests.
- `output/vehicle-performance-local-diagnosis.md`: this report.

## Verification and remaining work
PASS: `npx tsc --noEmit --incremental false`.
PASS: 52 targeted tests covering Supabase request headers/session changes/error propagation, storage, performance calculations, exact registration matching, aliases, monthly aggregation, missing periods, import validation/reviews, and existing layout assertions.
PASS: live read-only historical inventory and anon comparison; dev restart on localhost:3000 using `.env.local`; browser now reaches the expected login page.
PENDING: real authenticated SELECT with importing account, 2026 All loaded months totals including fuel and recorded balance, one month, registration search, one vehicle, no-data year, refresh, and actual sign-out/sign-in. Automated session transition tests passed but do not substitute for real browser login. Available browser has no authenticated session; user was asked to sign in. No browser credentials were extracted or reset.

No database row changes, reimports, migrations, deployment, commits, or production changes. Before later deployment: complete authenticated browser checks, review the shared auth-header fix across existing pages, deliberately package the currently untracked feature dependencies, and audit the existing production schema/RLS prerequisites without applying them blindly. This report does not claim the feature is ready to deploy.
