# EES Maintenance Centre — implementation and release notes

Repository: `C:\Users\User\Downloads\Fuel Bank App`
Status: implementation prepared locally; production database migration and deployment are pending. No production records, baselines, receipts or mileage were changed during this task.

## Delivered behavior

The existing `/maintenance` route now contains Overview, Service Schedule, Service History and Settings. It has a compact dark interface, purple accents, vehicle/driver search, status filtering, overdue and due-soon counts, vehicle attention counts and a count of vehicles still needing configuration. Existing reminder requirements participate in the same overview and schedule. Unconfigured catalogue entries are available through the Not Configured filter; they are not activated in the database automatically.

The schedule catalogue includes five fluids and eleven components, plus custom items. Each vehicle can have independent inspection and replacement schedules, km/month intervals, warning thresholds, applicability, an explicit condition-based strategy, specification, capacity and notes. New replacement/inspection intervals remain empty until staff supplies them. Existing oil business rules and saved overrides are preserved. Missing intervals, missing confirmed history, missing reliable mileage and Not Applicable are distinct states. A combined schedule is due when either threshold reaches its due point. Dates use Bangkok time, and month arithmetic clamps to the target month's final day.

The existing maintenance visit/receipt form is retained. Each item can identify a service key, action, confirmation and condition. Top-ups, repairs and unconfirmed items do not advance replacement schedules. Inspection and replacement histories remain independent. One visit contains all receipt items and costs. The original receipt bucket, upload validation, attachment metadata and signed-URL retrieval workflow remain in use. History retains date presets, date inputs, archived/voided records and CSV/Excel export.

Confirmed oil replacements are projected into the shared oil-history reader using a reference to the original maintenance visit; no duplicate row is inserted into vehicle_service_logs or oil_change_history. Corrected legacy baselines and service logs remain intact. Editing or voiding a visit changes the projection and recalculates its schedule. Weekly Mileage and the vehicle assignment summary read the same oil snapshot. New oil work opens Maintenance; old Weekly Mileage correction controls remain available during transition. Maintenance also exposes legacy oil corrections through the existing save and verified-delete helpers.

## Source of truth and audit findings

- Vehicle/driver identity: vehicles.id, drivers.assigned_vehicle_id, plus existing registration compatibility for legacy oil rows. New maintenance relationships use vehicle IDs.
- Odometers: weekly_mileage; mileage submission and distance calculation processes were retained.
- Maintenance visits/items/costs: maintenance_records and maintenance_items; existing atomic save RPC, optimistic concurrency and maintenance_audit are retained and extended.
- Receipts: maintenance_attachments and private maintenance-receipts storage bucket.
- Legacy oil events/baselines: vehicle_service_logs, oil_change_history, oil_change_baselines and existing vehicle oil fields. Existing corrections were preserved, including the distinction between advisory historical anomalies and current unreliable readings.
- Configuration: existing maintenance_requirements and maintenance_requirement_vehicles. No new business-data tables were created.
- Legacy reminders: lib/maintenance.ts; extended preventative calculations: lib/preventative-maintenance.ts; oil snapshot: lib/oil-service-snapshot.ts. Service-key items are excluded from legacy free-text reminders to prevent double reminders.
- Office permissions: established account helpers and business permissions; restrictive RLS adds office-only protection while retaining existing scope policies. It also protects driver_portal even if a table grant exists.
- The repository already had uncommitted HR, dashboard, dispatch and oil-correction work. Those unrelated changes were preserved. Review this task's file list rather than committing the entire mixed working tree blindly.

The supplied Facebook videos could not be fetched. Their intervals/specifications were not inferred. The implementation uses the item lists in the request and office-entered settings.

## Files created by this task

- components/maintenance-centre.tsx
- components/maintenance-legacy-oil-history.tsx
- components/maintenance-schedule-settings.tsx
- components/maintenance-service-fields.tsx
- components/vehicle-maintenance-summary.tsx
- lib/maintenance-centre-copy.ts
- lib/maintenance-oil-data.ts
- lib/preventative-maintenance.ts
- supabase/migrations/20261014100000_preventative_maintenance_centre.sql
- docs/maintenance-centre-preflight.sql
- tests/maintenance-centre.test.cjs
- tests/maintenance-centre-database.test.cjs
- tests/maintenance-centre-browser.cjs
- tests/fixtures/maintenance-centre-base.sql
- tests/fixtures/maintenance-centre-http.cjs

## Existing files modified by this task

- app/(dashboard)/maintenance/page.tsx
- app/(dashboard)/weekly-mileage/page.tsx
- app/globals.css
- components/maintenance-record-form.tsx
- components/hr/assignment-section.tsx (part of the prior HR work)
- lib/data.ts
- lib/maintenance-data.ts
- lib/maintenance-types.ts
- lib/maintenance.ts
- lib/maintenance-intelligence.ts
- lib/operations.ts
- lib/oil-service-snapshot.ts (previously untracked correction work)
- types/database.ts
- tests/maintenance.test.cjs
- tests/oil-service-repair.test.cjs (previously untracked correction tests)

## SQL and rollout

1. Back up the intended database and run `maintenance-centre-preflight.sql` there. Verify the existing schema/functions/policies against this checkout. Live schema drift has not been audited from this session.
2. Apply only `20261014100000_preventative_maintenance_centre.sql` to staging first. It is a transactional, one-time migration. It adds columns/checks, allows explicitly incomplete preventative settings, extends the existing record RPC and adds a per-vehicle configuration RPC. It adds restrictive office-account policies. It never backfills qualifying events or rewrites legacy oil baselines. Existing prerequisite receipt schema and account helpers must already exist.
3. Do not replay `20260914090000_add_maintenance.sql` on production: it is a standalone creation migration and says production was manually provisioned.
4. Verify `select public.maintenance_centre_version();` returns 1. The new Centre intentionally refuses to load when the required migration is unavailable instead of pretending writes are supported.
5. Rebuild with the real staging environment and test the record/edit/void/receipt workflow as office, read-only, suspended and driver accounts. Check corrected baseline samples and actual Supabase storage permissions.
6. After approval of staging, apply the reviewed additive migration to production and deploy the frontend through the normal release process. No deployment was performed here.
7. Build fresh with the real Supabase environment. The local `.next-maintenance-qa` build uses a synthetic localhost backend and must never be uploaded as a production artifact. No new dependency installation was required by this maintenance work.
8. Prefer reverting the frontend release while leaving additive columns/audit history intact if rollback is needed. Do not drop tables/columns or delete events to roll back this feature.

## Staff workflow

Open Maintenance, search a registration and click its row. Review its schedule, then use Record Maintenance for a garage visit. Enter receipt details, add each service item and select the correct action. Confirm completed work only when verified. Save once and upload the receipt. Use Service History to retrieve receipts or correct/void a visit. Use Settings to select a vehicle, service item and inspection/replacement schedule, then enter management-approved intervals or mark it Not Applicable. Weekly Mileage remains the place to submit odometer readings.

## Verification boundaries and remaining release work

Synthetic PostgreSQL tests execute the actual migration/RPC/RLS definitions, and local browser tests use the actual production Next.js build with a synthetic Supabase-compatible transport. They do not establish that the migration is active on production or that production storage and device sessions work. Real Supabase staging smoke tests, cross-device verification and production deployment remain release work. Legacy corrections continue to use the established helper's existing write/recompute behavior; this task did not migrate legacy events or silently rewrite their stored summaries. Office staff must still supply the correct manufacturer/management requirements for new fluids and parts.

The build configuration already skips its internal type/lint checks; separate typecheck and lint were executed. See the accompanying verification results and logs for actual outcomes. Existing lint warnings are in inventory images and the driver-account component. The build also reports an older Browserslist dataset.

Final local verification: typecheck passed; lint passed with 0 errors and 3 pre-existing warnings; 90 automated tests passed; production build passed; all 12 browser checkpoints passed with no page errors. Desktop, mobile and Thai previews are included. The accompanying verification report documents the synthetic-test boundary. docs/maintenance-centre-release-notes.md is also saved in the repository.
