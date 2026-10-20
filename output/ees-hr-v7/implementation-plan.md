# EES Driver & HR V7 — implementation plan

## Phase A findings

The current directory already uses `ees_driver_vehicle_assignments`, `ees_hr_meetings`, `ees_hr_admins` and the existing assignment/meeting RPCs. Schema-only API inspection confirms those tables and signatures. Driver IDs remain BIGINT; fleet IDs remain UUID. The meeting helper converts IDs with Number(), and the general driver editor can still update assignment fields outside the history RPC. The directory exposes hard deletion, uses a large modal profile, and has document/follow-up placeholders. Private personnel/document/licence tables are not present in the inspected schema.

Current safety, account approval, Booking Diary, Dispatch, Driver Portal and Oil Service work will be retained. User changes to the directory, dashboard, dispatch and EES helpers were present at the start of this brief and must be preserved where applicable. No production migrations or test mutations will be run automatically.

## Implementation sequence

1. **Database/security:** additive one-to-one employee linkage to existing drivers, office employees without a driver, separately restricted personal/compensation records, immutable meeting addenda, independent follow-ups and audit history, private/versioned documents, licences and training. Reuse the existing meeting and assignment tables. Keep membership based on authenticated user ID and canonical active-office checks; never grant HR by email. Add restricted operational-manager approval. Generate schema/function/policy inspection SQL and reviewable migrations.
2. **Atomic operations:** permanent/temporary vehicle history through a guarded PostgreSQL workflow, locks and overlap checks; vehicle data from the authoritative fleet; no historical booking/fuel/trip changes or fleet renaming. Close bypasses in other driver editors and replace employee departure deletion with retained/inactive records. Preserve BIGINTs as decimal strings in application interfaces.
3. **Server/data workflows:** verified bearer sessions, role-filtered projections, on-demand personnel and meeting reads, immutable corrections, persisted follow-up completion/outcomes, and private storage upload/preview/download/version/retention flows. Uploads remain disabled until the private bucket, restrictive storage controls and documented company processing/retention policy are verified.
4. **UI:** compact paginated directory with accurate counts; dedicated `/drivers/[driverId]` and office employee profile routes; seven sections; complete meetings and bilingual printable/PDF reports; central restricted follow-ups; clear save/error states and fixed form action footers. Every new label and validation message has EN/TH versions.
5. **Verification:** synthetic fixtures only; real PostgreSQL-compatible workflow/RLS tests where a local engine is available, server authorization tests, TypeScript/lint/build, browser desktop/mobile and EN/TH checks, printable/PDF verification and regressions for preserved logistics paths. Record exact results and migration dependencies, never represent unverified production behavior as working.

## Decisions and boundaries

- Existing driver rows are not bulk duplicated into employee records. Directory rows link to an employee profile only when one exists; a personnel save can create a unique link for that selected driver. Existing `active` driver flags remain distinguishable from recorded employment status and vehicle availability.
- Confidential addresses, emergency contacts, salary, national ID/licence numbers, meetings and documents never belong in general directory responses or ordinary exports.
- No legal licence eligibility is guessed. Known incompatibility requires a reviewed mapping/source; expiry and missing verification are shown explicitly.
- Original meetings are retained. Test-data identification/archive is an explicit administrator action on an exact record, separate from original meeting content.
- Supabase production policy/function definitions are not exposed by the current data API. SQL inspection and administrator verification remain prerequisites for applying the generated migration safely.
