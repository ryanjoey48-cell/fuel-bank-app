# Annual Grease Maintenance

Implemented at `/grease-maintenance`, under Fleet Control beside Weekly Mileage. The mobile title and navigation use the existing English/Thai language system.

## Database rollout

Apply **only** `supabase/migrations/20260914090000_add_grease_maintenance.sql` to the existing Supabase project through its SQL editor or your established migration process. It runs in a transaction and creates only the new grease table, index, trigger function and policies. It depends on the existing `vehicles`, `auth.users`, `is_account_active()` and `current_account_role()` definitions. Do not reset the database or replay unrelated historical migrations.

The migration has been executed successfully in a disposable PostgreSQL instance. It has **not** been applied to the live Supabase project. No production data was modified. Until it is applied, the new page reports unavailable data and the Dashboard reports unavailable grease status without blocking existing dashboard data.

## Behavior

- Stable vehicle IDs link records to existing vehicles; registration changes do not disconnect history. The driver is displayed from the current active assignment.
- Service date is required. Odometer, work items, quantity, unit cost, garage and notes are optional. A missing quantity counts as 1; missing cost counts as 0. Each line is rounded to cents, then summed. The database recalculates totals independently of the browser.
- The latest non-voided service date controls status, with creation time and ID breaking same-day ties. Backdated entries do not displace newer services. Future service dates are rejected.
- Due date is service date plus one calendar year; 29 February clamps to 28 February. Status uses the Thailand calendar day: over 30 days = OK; 0–30 = Due Soon; negative = Overdue; no valid service = No Record.
- Active vehicles appear by default; inactive vehicles remain accessible through a filter. Search, status filters and per-vehicle history are provided.
- Staff/admin can add and edit. Read-only users can view. Database policies reject anonymous, suspended and read-only writes. Fleet visibility follows the existing vehicles policy.
- Creator and updater UUIDs and timestamps are set by the database. Edits preserve the creator fields. Concurrent edits use an updated-timestamp check and report conflicts instead of silently overwriting.
- Invalid records can be voided and restored; no record-deletion capability is exposed or granted. Historical audit fields are visible in the history view.
- Dashboard attention includes overdue, due-soon and missing-history vehicles, independently of the dashboard's reporting month.
- Attachments are omitted because the inspected app has no persisted receipt upload/storage pattern to reuse.
- Existing oil-change calculations, intervals, mileage logic, authentication and existing database objects are unchanged.

## Verification

- `node --test tests/*.test.cjs`: 231 passed.
- Active app TypeScript check: passed. The repository-wide check finds four existing errors under `_vehicle_performance_release`, the separate release copy.
- `next build`: production build passed (the repository config skips build-time lint and type validation, so types were checked separately).
- `node scripts/verify-grease-maintenance-db.cjs`: migration, generated due dates, total calculation, invalid-input rejection, audit integrity, staff/read-only/suspended/anonymous access, void/restore and delete protection passed in PGlite. To reproduce, install `@electric-sql/pglite` under `tmp/grease-qa` without changing the app dependencies.
- Browser checks against the production build with intercepted test data: desktop English, mobile Thai at 390px, add/edit/void/restore, totals, read-only controls, unavailable-data handling, dashboard link and no JavaScript page errors. An unauthenticated browser redirected to login correctly.

Browser requests were intercepted; no test services were written to the live database. Live authenticated save/reload should be checked after applying the migration and deploying the app.
