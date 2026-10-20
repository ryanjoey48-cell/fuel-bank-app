# Weekly Mileage / Oil Service repair

Implemented against the existing app. The purple/cream UI is retained. Nothing was deployed; no production records, constraints or policies were changed.

## Confirmed findings and repairs

- One oil-service mutation emitted four global data-change events. Each event started another fleet reload and cleared the shared read cache; the handler then explicitly reloaded again. Mutations now emit one event containing the affected resources. Concurrent page refreshes share a promise, and a mutation during an existing read schedules a fresh trailing read. Invalidated reads cannot repopulate the cache later.
- Account-menu and sidebar listeners requested support-ticket counts for every unrelated change. Both now filter for support-ticket changes and share the cached count request.
- PostgREST's existing HTTP timeout did not bound the authentication lookup before fetch. Authentication waits, HTTP requests and JSON downloads now have a deadline and cancellation. Service handlers release loading state in finally and synchronously guard against repeated submission.
- Deletion checked only the returned error, so a zero-row RLS result could be reported as success. It now reads and verifies the selected service/vehicle, deletes by the actual primary key, requests the returning ID and requires exactly that row. It does not create or edit a vehicle before deletion. Permission, timeout and partial-summary failures produce actionable messages inside Service History.
- New inserts receive a fresh UUID; edits require an existing readable record and update its selected ID. Database uniqueness rules remain intact. Duplicate-business-record errors ask the user to inspect history rather than overwrite another record.
- Saved 8,000 km intervals were silently rewritten to 10,000 km by a helper. Positive saved intervals are now respected; defaults remain 10,000 km for four-wheel vehicles and 30,000 km for other known types.
- Dashboard and PDFs use one normalized snapshot, the latest valid service by service date and valid weekly odometers. Repeated/decreasing service odometers and conflicting/decreasing weekly readings produce Review Required without changing stored data.
- History's distance field compared consecutive services, producing misleading zeroes. It now compares each service against the latest valid weekly reading. Recorded dates use Asia/Bangkok. Next due is calculated from the historical service odometer and saved interval.
- Both oil PDFs fetch a fresh saved-data snapshot immediately before export. A saved/deleted record also invalidates consumers if its derived-summary write subsequently fails; the message distinguishes that partial success from a failed mutation.

## Production read-only audit

Vehicle 3ฒน-9565 has seven service records and no legacy oil-change-history records. The three entries below are all still present and untouched:

| Service date | Primary key | Odometer | Interval |
|---|---|---:|---:|
| 2026-09-05 (confirmed correct) | 160dd57f-82a1-4834-a896-e9a7fa3d06bd | 354784 | 10000 |
| 2026-09-07 | 388afff7-6421-483b-a754-da56b2f1b0ca | 354784 | 10000 |
| 2026-10-05 | ed4196f7-b1f5-4676-a438-ff06728c8b0f | 354784 | 10000 |

The exposed schema identifies `id` as a UUID primary key with `gen_random_uuid()` default and exposes no `service_id` column. Reuse of an existing ID and the earlier `vehicle_service_logs_unique_service_id` failure were not reproduced. A constraint's name does not establish which columns it covers.

No SQL migration is confirmed necessary. `supabase-read-only-diagnostics.sql` inspects the deployed constraint/index definitions and RLS policies; it makes no changes. Authenticated production DELETE permissions still need that inspection or an authorized live mutation test. Service-role reads cannot establish those permissions. No policy was broadened and no uniqueness constraint was removed.

## Verification

- Targeted oil-service, weekly-mileage and authorized-fetch tests: **43 passed, 0 failed**.
- Full suite: **485 passed, 40 failed** versus **468 passed, 40 failed** before changes. The existing failures concern unrelated prior Booking/Driver/Vehicle Performance assertions; see the baseline/final logs and `test-comparison.json` for exact names.
- Browser: actual Weekly Mileage page compiled with local in-memory data; permission failure and timeout recover; two selected deletions preserve the correct 5 September entry; one read per resource per mutation; fresh PDF download; desktop and 390 px English/Thai layout; no page errors. No browser fixture request writes to Supabase.
- The downloaded raster PDF was opened as an extracted report image and visually checked; its refreshed summary shows one OK vehicle after the two fixture deletions.
- Full-workspace and changed-file/import-graph TypeScript checks: **passed** (`--noEmit --incremental false`).
- Targeted Next lint: **passed, no warnings or errors**.
- Production build: **passed**; the project already skips built-in lint/type validation, so the independent checks above were also run. The isolated build directory was used; generated `next-env.d.ts` changes were restored.

## Exact source/test files changed

1. `app/(dashboard)/weekly-mileage/page.tsx` — refresh coordination, mutation guards, confirmation/status UI, correct history metrics, fresh PDF snapshots.
2. `components/account-menu.tsx` — filter support-count invalidation events.
3. `components/sidebar.tsx` — filter support-count invalidation events.
4. `lib/data.ts` — UUID inserts, exact verified deletion, safe edits/partial success, one invalidation event, cache ownership, bounded service user lookup and shared support count.
5. `lib/oil-change-service.ts` — preserve saved intervals.
6. `lib/operations.ts` — reject missing/negative/invalid-date odometer candidates.
7. `lib/supabase.ts` — bound authentication, JSON requests and downloads while preserving session headers.
8. `lib/request-deadline.ts` — new deadline/cancellation and JSON-response helpers.
9. `lib/oil-service-mutations.ts` — new affected-row verification and refresh coordinator.
10. `lib/oil-service-snapshot.ts` — new shared normalized calculations, conflict checks and historical/recorded-date helpers.
11. `tests/oil-service-repair.test.cjs` — new mutation, timeout, refresh, interval, conflict and history tests.
12. `tests/supabase-authorized-fetch.test.cjs` — retain authenticated-header coverage and add pending-authentication timeout coverage.

Generated evidence and read-only SQL are under `output/oil-service-repair/`; local browser fixture sources are retained there separately from application code.
