# Database access-control audit (V4.7)

Project audited: "Fuel Tracker App" (ref `hafoaurzfgkkwpvzedvd`), the project the local app points at. Date: 2026-11-06.
Method: read-only catalogue queries (`pg_class`, `pg_policies`, `pg_roles`, `pg_proc`, `information_schema`), Supabase table listing, and one non-destructive reachability check using the **public** anon key with `limit=0` (status and row count only).
**Not done, by design:** no record was read, no write or privilege-changing statement was attempted, nothing was enabled, disabled, granted or revoked. No credential appears in this report.
Companion SQL (review only, not executed): `docs/rls-remediation-review-only.sql`. Evidence script: `output/fleet-intelligence-v45/anon-reachability.cjs`.

## 1. Headline

**Demonstrated, urgent exposure.** Fifteen tables in schema `public` have Row Level Security disabled while the `anon` and `authenticated` database roles hold full privileges on them. With only the public key (which every browser receives), an anonymous caller could see **every row** of the 14 populated tables: the row counts returned matched the table totals exactly. The control tables that do have RLS (`booking_diary`, `clients`) returned 0 rows, and `driver_accounts` returned a permission error. Write access is proven by the grants (INSERT, UPDATE, DELETE, TRUNCATE for `anon`), not by an attempt.
Because self-registration exists (the login page has "Create Account"; a new account only creates an access *request*), **any signed-in account also holds the `authenticated` role**, which has the same full access today, even with no `account_access` row. Revoking `anon` alone therefore does not close the exposure; RLS policies tied to `account_access` are needed.

| Question | Answer |
|---|---|
| Can unauthorised callers read? | **Yes, proven** (anonymous, public key). |
| Can unauthorised callers write? | **Granted, not attempted.** `anon` and `authenticated` hold INSERT/UPDATE/DELETE. PostgREST's `safeupdate` setting stops an UPDATE/DELETE with no filter, but a filtered one (for example `id > 0`) is not stopped. |
| Is it the application code? | No. The application checks roles in its API routes, but most of these tables are queried straight from the browser with the signed-in token, so the only enforcement that exists is the database's, and for these tables there is none. |
| Was anything changed? | No. |

## 2. Risk matrix (the 15 tables)

Rows are the live counts the anonymous check returned. "Used by" is from the code. Severity reflects the data and what altering it would damage.

| Table | Rows | RLS | Anon read (proven) | Anon/auth write (grants) | Contains | Used by | Severity | Policy needed |
|---|---|---|---|---|---|---|---|---|
| `bank_transfers` | 6 | off | yes | yes | Payments: driver, vehicle, amount, method | `lib/data.ts` (browser) | **Critical** | Read: active office accounts (consider admin and office_staff only); write: admin, office_staff; delete admin only (option) |
| `fuel_logs` | 2,793 | off | yes | yes | Driver, litres, cost, odometer, location | `lib/data.ts`; Fleet Intelligence routes (caller's token) | **Critical** | Read: office accounts; write: admin, office_staff. **Fleet Intelligence depends on read.** |
| `drivers` | 23 | off | yes | yes | Driver names, assigned vehicle, payment method, `user_id` link | browser (`lib/data.ts`, fleet tracking, safety); server routes | **Critical** | Read: office accounts; write: admin, office_staff |
| `shipments` | 6 | off | yes | yes | Job costs, routes, driver, fuel cost | `lib/data.ts` | **Critical** | Read: office accounts; write: admin, office_staff |
| `weekly_mileage` | 709 | off | yes | yes | Driver, odometer readings | `lib/data.ts`; Fleet Intelligence (caller's token) | **Critical** | Read: office accounts; write: admin, office_staff. **Fleet Intelligence depends on read.** |
| `trip_journeys` | 2 | off | yes | yes | Pickup/drop-off coordinates, route polylines, mileage | browser | **High** (location data) | Read: office accounts; write: admin, office_staff |
| `vehicles` | 24 | off | yes | yes | Registry, per-km costs, `user_id` | browser and 8 server routes (**Fleet Intelligence identity**) | **High** | Replace the 3 existing `user_id` policies (see 3) |
| `vehicle_safety_inspections` | 21 | off | yes | yes | Inspections, driver, booking | office safety pages | **High** | Read: office accounts; write: admin, office_staff |
| `vehicle_safety_inspection_items` | 180 | off | yes | yes | Item results, notes, photo URLs | office safety pages | **High** | same |
| `vehicle_safety_issues` | 18 | off | yes | yes | Issues, severity, photo URLs | office safety pages | **High** | same |
| `oil_change_baselines` | 25 | off | yes | yes | Maintenance baselines (odometer, interval) | browser | **Medium-High** (maintenance integrity) | Replace the 4 `authenticated true` policies (see 3) |
| `oil_change_history` | 3 | off | yes | yes | Oil-change history | browser | **Medium-High** | same |
| `trip_fuel_logs` | 3 | off | yes | yes | Links between trips and fuel logs | browser | Medium | Read: office accounts; write: admin, office_staff |
| `vehicle_safety_requirements` | 9 | off | yes | yes | Reference catalogue (English/Thai names) | office safety pages | Low (reference) | Read: office accounts; write: admin |
| `vehicle_safety_assets` | 0 | off | yes (0 rows) | yes | Asset register (empty, unused in code) | none | Low (empty) | Same pattern; can wait |

Notes:
- The driver portal role (`driver_portal`) has **no grants** on any of the 15, so drivers using the portal are not affected by closing these tables. `service_role` bypasses RLS, so server routes that use it are not affected either.
- Maintenance odometer inputs (`oil_change_*`, `weekly_mileage`) are writable by any caller today. That conflicts directly with the rule that maintenance odometers and reminders must not be changed outside the approved workflow.
- All four storage buckets (`maintenance-receipts`, `insurance-documents`, `driver-avatars`, `ees-employee-documents`) are private.

## 3. Existing policies that are inert today and would activate

Enabling RLS makes these live. They must be replaced, not trusted:
- `vehicles_select_own`, `vehicles_insert_own`, `vehicles_update_own` (role `public`): `user_id IS NULL OR auth.uid() = user_id`. Rows with a null `user_id` would be visible to **everyone including anonymous**, and rows owned by another user would vanish for office staff, breaking Fleet Intelligence and Fleet Tracking identity matching. There is no delete policy.
- `oil_change_baselines_*` and `oil_change_history_*` (four each, role `authenticated`): `USING (true)`. Any signed-in account, including a self-registered one, could read and change them.

## 4. User-token versus server-credential enforcement

| Path | Credential | Enforcement today |
|---|---|---|
| Browser pages (`lib/data.ts`, safety, fleet tracking) | Public key + the signed-in user's token (`authenticated`) | UI only for these 15 tables. Database enforcement exists for the 81 RLS-enabled tables. |
| Fleet Intelligence routes (`evidence/*`) | Public key + the **caller's** token; role checked first by `requireFleetOfficeAccess` | Application check plus whatever RLS the tables have (none on `fuel_logs`, `weekly_mileage`, `vehicles`). |
| Admin routes (35 files) | Service role through `createServerSupabaseAdmin` | Application check (`resolveAccountAccess`, `hasPermission`); bypasses RLS by design. |
| Driver portal | `driver_portal` role / server routes | Not granted on these 15. |
| Direct REST call with the public key | `anon` | **None** on the 15 tables. |

## 5. Other findings

| Finding | Evidence | Severity | Action |
|---|---|---|---|
| New tables are exposed by default | `pg_default_acl`: full `anon`/`authenticated`/`service_role` privileges on new tables in `public` | Medium (precautionary) | Stage 2 in the SQL; every new table needs explicit REVOKE meanwhile (the persistence proposal now does this) |
| 31 SECURITY DEFINER functions are executable by `anon` | `has_function_privilege` | Low-Medium (precautionary) | 21 check the caller and raise on failure, 9 are trigger functions (not callable over the API), and `remember_saved_location` uses `auth.uid()` with no role check. Stage 2 revokes anon on the write RPCs |
| Live roles | `account_access`: 2 admin + 2 office_staff, all active; **no `read_only` account, no `super_admin`** (role check allows only admin, office_staff, read_only) | Information | The owner's system-wide admin permission is the `admin` role live |
| `btree_gist` not installed | `pg_extension` | Information | The persistence proposal no longer depends on it |
| `rls_auto_enable` event trigger exists | `pg_proc` | Information | Newer tables have RLS; the 15 predate it |

## 6. Unknowns (not provable from here)

- Whether sign-ups are open in the Supabase Auth settings (the login page offers it; the dashboard setting was not checked). It decides how reachable the `authenticated` path is.
- Whether the "EES Development" project (`wpmnjfncaoogssgpqxek`) matches production; it was not inspected. Staged rollout should start there.
- Whether any real anonymous (signed-out) screen queries these tables. Code search found none (all uses are in dashboard pages or server routes), but an end-to-end check on Development should confirm before Stage 0.
- Whether anyone has already read or altered the data through the public key. The platform's API logs would show it; they were not queried.

## 7. Recommended order (all require your approval; none executed)

1. **Stage 0, urgent:** revoke `anon` on the 15 tables. Lowest risk: signed-in office users keep working. Closes the proven anonymous path.
2. **Stage 1, urgent:** policies keyed to `account_access` plus RLS enabled, table by table. Closes the self-registered path. Start with the Critical tables, validate Fleet Tracking, Fuel Logs, Weekly Mileage, Safety and Shipments after each.
3. **Stage 2, precautionary:** default privileges and anon EXECUTE on write RPCs.
4. Afterwards: check the Auth sign-up setting, review API logs for the exposure window, and decide on tighter options (admin-only delete on money tables, hiding `bank_transfers` from `read_only`).

## 8. Approval questions

1. Approve Stage 0 on "EES Development" first, then production?
2. Approve Stage 1 with read = any active office account and write = admin or office_staff (matches the app today), or tighter?
3. Should `bank_transfers` be hidden from `read_only` accounts, and deletes on money tables be admin-only?
4. Is "EES Development" a faithful copy, and who tests with a real office_staff and a read_only account?
5. Who checks the Auth sign-up setting and the API logs?
