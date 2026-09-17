# Maintenance repair — 14 September 2026

No deployment or production database writes were performed.

## Causes

- Confirmed REST 404: `GET /rest/v1/grease_maintenance_records?select=*&limit=0` returns `PGRST205`: the legacy table is absent from the schema cache. Supabase suggests `public.maintenance_records`. The dashboard still imported `fetchGreaseRecords`, and the sidebar linked to the legacy page. Both now use unified Maintenance. This reproduces the legacy endpoint failure; the user's original authenticated console trace was unavailable.
- Client crash: `t.maintenance` was undefined in both languages because `maintenanceTranslations` was never registered in `lib/translations.ts`. Both pages immediately dereferenced `c.title`/`c.analytics`. The build did not catch it because Next is configured to skip TypeScript validation.
- Current browser blocker: the available session reports `Invalid Refresh Token: Refresh Token Not Found` and redirects to login. A fresh sign-in is needed for authenticated live verification.

## Changes made in this continuation

- `lib/translations.ts`: register English/Thai Maintenance translations.
- `components/sidebar.tsx`: Maintenance links to `/maintenance`.
- `components/mobile-app-bar.tsx`: correct Maintenance and analytics headings.
- `app/(dashboard)/dashboard/page.tsx`: replace legacy grease query/alert with unified Maintenance reminders; preserve the rest of the dashboard.
- `app/(dashboard)/vehicle-performance/page.tsx`: add the Maintenance analytics link; existing performance queries and calculations are unchanged.
- `lib/maintenance-data.ts`: identify failing table/status/PostgREST code, bound queries to 30 seconds, and order composite applicability keys deterministically across pages.
- `app/(dashboard)/maintenance/page.tsx` and `analytics/page.tsx`: clear failed data, retain refresh controls, show localized error messages with table diagnostics.
- `app/(dashboard)/maintenance/error.tsx`: route-level render recovery within the dashboard shell.
- `supabase/migrations/20260914090000_add_maintenance.sql`: clarify prerequisites and manual-production provisioning. The exact file found on disk already created all six tables before indexes; its complete SQL passed execution in a fresh disposable PostgreSQL instance.
- `next.config.ts` and `.gitignore`: optional isolated local build directory, enabled only with `FUEL_BANK_ISOLATED_BUILD=1`, to avoid overwriting a running server's build.
- `tests/maintenance.test.cjs`: translation, empty-history, render, query-failure, and receipt-validation regressions.
- `scripts/verify-maintenance-db.cjs`: disposable PostgreSQL migration/RPC/RLS checks (uses the already installed PGlite under `tmp/grease-qa`).
- `scripts/inspect-maintenance-rest.cjs`: public-key, zero-row, read-only REST endpoint inspection.

The manually repaired `components/maintenance-attachments.tsx` was reviewed and retained without modification. The old `/grease-maintenance` implementation remains intact.

## Verification

| Check | Result |
| --- | --- |
| `npm run build` | PASS using the isolated output directory; all 45 pages generated |
| Existing test suite plus initial Maintenance regressions | 236/236 PASS |
| Final Maintenance regression suite | 6/6 PASS, including the additional loaded/error-state rendering test |
| Migration | PASS: six tables, indexes, RPC create/edit/conflict/delete/requirement, totals, audit, RLS, private bucket and attachment policies |
| `/maintenance` and `/maintenance/analytics` | Built routes return 200; bilingual initial, empty-data and failed-query rendering pass; live authenticated rendering pending sign-in |
| Add Maintenance | Form rendering with a vehicle and zero history passes in English and Thai; live browser click pending sign-in |
| Categories | All 13 requested categories present |
| Receipt code | Matches `maintenance-receipts`; JPEG/PNG/PDF signatures, nonempty/10 MiB limit, authenticated upload, metadata, signed viewing and cleanup paths reviewed; validation and DB policies tested; no live upload performed |
| Existing pages | Dashboard, Vehicle Performance, drivers, weekly mileage and legacy grease routes return 200; authenticated content still requires sign-in |
| Existing data dependencies | Vehicles, drivers, weekly mileage and fuel-log endpoints return 200 on zero-row public-key checks |
| New database objects | All five frontend Maintenance table endpoints resolve but correctly deny anonymous access with 401/42501; production RPC signatures and authenticated grants still require live verification |
| Browser console | No Maintenance render exception observed through the login gate; expired-refresh-token error prevents authenticated testing |
| Full standalone TypeScript check | Four existing errors confined to `_vehicle_performance_release/app/(dashboard)/vehicle-performance/page.tsx`; no Maintenance errors |

## Remaining before deployment

1. Sign in at `http://localhost:3002/login`. The isolated development server is running on port 3002; the existing port-3000 server was not stopped.
2. Verify authenticated Maintenance and analytics reads, Add Maintenance interaction, and existing pages. Compare the manually provisioned production RPC signatures and grants if any request fails. Receipt upload permission testing remains outstanding; no production test records or attachments were created.
3. No additional production SQL is established as necessary. Do not replay the standalone migration over the manually created tables.
4. The legacy grease migration and unified migration share version `20260914090000`. Reconcile this duplicate migration version and the manually provisioned migration history before any automated migration deployment. The legacy file was preserved in this continuation.
5. The retained legacy grease page still queries its absent legacy table if opened directly. Main navigation and dashboard no longer do so.

Deployment remains unapproved and was not attempted.
