# Oil Service DELETE follow-up

Safe application changes are implemented and tested. No production record, policy, grant or trigger was changed. The valid 5 September record remains present. The deployed policy/trigger causing the zero-row DELETE still requires the read-only SQL results requested during this task; it is not honest to label a particular live policy as confirmed without those results.

## Confirmed evidence

- The configured project is `hafoaurzfgkkwpvzedvd.supabase.co`, table `public.vehicle_service_logs`. A fresh service-role **read-only** audit confirms all seven vehicle records, the UUID primary key and all three existing account-access functions. This privileged read does not establish the browser user's permissions.
- Correct 2026-09-05: `160dd57f-82a1-4834-a896-e9a7fa3d06bd`, odometer 354784 — untouched.
- Incorrect 2026-09-07: `388afff7-6421-483b-a754-da56b2f1b0ca`, odometer 354784 — untouched.
- Incorrect 2026-10-05: `ed4196f7-b1f5-4676-a438-ff06728c8b0f`, odometer 354784 — untouched.
- All three records have `user_id = NULL`. They cannot satisfy an ownership predicate such as `user_id = auth.uid()` for an authenticated user.
- The previous failing path read the selected record by ID, then issued DELETE with the same ID. Its DELETE had no registration, vehicle ID, driver, date or owner filter. The old message meant the response was not exactly one returning ID; it alone did not establish the deployed policy or effective role.
- Repository migrations contain shared authenticated SELECT and an old unrestricted authenticated DELETE policy. These source files are not evidence that those policies are deployed. Reapplying the old `USING (true)` policy is not an acceptable repair.
- The browser connector failed twice during initialization (`failed to write kernel assets`), so the actual user's current JWT and recent network request could not be inspected. The available data API does not expose deployed `pg_policies` or trigger definitions. No credentials were harvested from browser storage.

The likely failure is stale/missing DELETE eligibility for otherwise visible, ownerless rows. A suppressing BEFORE DELETE trigger is another possibility. [PostgreSQL documents that SELECT-visible rows can still fail DELETE policies](https://www.postgresql.org/docs/17/sql-createpolicy.html); DELETE requires the applicable SELECT and DELETE permissions/policies. These mechanics support the diagnosis but cannot prove a deployed policy's contents.

## Implemented application repair

The path is now:

1. Existing History confirmation and loading guard.
2. Obtain the current session; verify its exact JWT with Supabase Auth.
3. Require verified JWT role `authenticated` and matching user ID. Anonymous, expired, driver-portal and service-role browser sessions cannot proceed.
4. Create an operation-scoped PostgREST client bound to that same token. The shared client's headers are not changed, and a later session change cannot silently switch DELETE to an anonymous request.
5. Query the existing `current_account_role`, `is_account_active` and `is_office_account` functions through that client. Only active admin/office-staff office accounts qualify.
6. Read the exact selected primary key using that client. Verify UUID, registration and oil-service type before mutation.
7. Send exactly one filtered DELETE and require exactly the selected returning ID. On a zero-row result, read that same primary key again with that same session.
8. Only verified success recalculates the baseline, invalidates the affected resources and refreshes history/dashboard through the existing refresh coordinator.

Actual PostgREST-builder regression tests confirm this DELETE shape:

```text
DELETE /rest/v1/vehicle_service_logs?id=eq.<selected-uuid>&select=id
Prefer: return=representation
Authorization: Bearer <same verified user token used for the reads>
```

No token is put in diagnostics. Error diagnostics identify the configured project, table, UUID, verified user ID, database role and account role. Distinct error classifications cover invalid ID/record mismatch, absent or SELECT-hidden rows, expired authentication, explicit permission denial, network failure, visible-but-blocked DELETE, and disappearance without returning confirmation. A visible row that persists after a zero-row DELETE is reported as RLS/trigger blocked; disappearance is never falsely counted as verified success. Missing versus SELECT-hidden rows cannot safely be distinguished solely with that user's RLS-limited SELECT.

## SQL review and manual execution

First open the **affected project** in Supabase, choose **SQL Editor → New query**, paste `output/oil-delete-rls/inspect-deployed-policies.sql`, and run it. It contains SELECT statements only. Paste the resulting SELECT/DELETE/ALL policies, table grants and trigger definitions so the exact cause can be confirmed. SQL Editor's postgres identity is not the browser's authenticated identity.

If that inspection confirms missing or ownership-only DELETE eligibility for an authorized office account, review `supabase/migrations/20261012100000_oil_service_delete_business_roles.sql`. To apply an approved repair, paste the entire file into a new SQL Editor query in the same project and run it manually. The app never runs it. Do not apply it merely because a generic error mentions RLS; a wrong session, denied account role or suppressing trigger requires its own correction.

The candidate migration is transactional and idempotent. It keeps RLS enabled and existing SELECT policies, replaces the known unrestricted DELETE policy with an active-office/admin rule for oil-service rows, and adds a restrictive role guard so existing permissive policies cannot authorize read-only/suspended/driver accounts. It removes anonymous/public/driver-role DELETE grants. It changes **no service rows**. It deliberately aborts before any change when an unknown restrictive DELETE/ALL policy exists, so tenant or other restrictions are not silently removed. Such a result requires adapting the migration after reviewing the actual policy.

Whether a migration is required is therefore **not yet confirmed**. If the effective role/session is wrong, no policy migration should be used to bypass that denial. If the live DELETE policy is absent or ownership-only while authorized staff can SELECT the row, the reviewed role-scoped migration is the relevant repair. If a restrictive policy or trigger is responsible, its actual definition must be reviewed first.

## Validation

- Relevant tests: **56 passed, 0 failed**. Includes the actual PostgREST builder/header/filter behavior, ownerless visible-but-blocked records, primary-key targeting, permission/network/auth distinctions, absent/unverified returning rows, office/account guards, selected-record success and existing refresh/calculation tests.
- TypeScript: focused import-graph check and full workspace check **passed**. The first full check collided with build-generated types; the successful full check was rerun after the build completed.
- Next lint: **passed**, no warnings or errors.
- Production build: **passed** in the existing isolated build directory. Independent TypeScript/lint checks were run because the project's build configuration skips them.
- Production DELETE/migrations: **not executed**. Current layout and styling: **not changed in this follow-up**.

## Files changed in this follow-up

1. `lib/data.ts` — session-verified deletion integration; remove obsolete direct-delete helpers; retain verified-success refresh/recalculation.
2. `lib/supabase.ts` — operation-scoped PostgREST client with a frozen user token and existing deadlines.
3. `lib/oil-service-delete.ts` — new primary-key/vehicle validation, exact returning verification and post-read failure classification.
4. `lib/oil-service-delete-session.ts` — new Auth verification and canonical account/office guards.
5. `tests/oil-service-delete-rls.test.cjs` — new regression and actual HTTP-builder tests.
6. `tests/oil-service-repair.test.cjs` — update integration coverage for the new verified deletion path.
7. `supabase/migrations/20261012100000_oil_service_delete_business_roles.sql` — review-only candidate policy repair, not applied.

Read-only audit, SQL inspection query and verification logs are under `output/oil-delete-rls/`. Earlier repair changes are retained; this list describes this follow-up only.
