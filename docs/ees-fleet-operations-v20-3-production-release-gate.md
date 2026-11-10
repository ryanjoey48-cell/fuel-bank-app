# EES V20.3 — main website production release gate

**Project:** `fuel-bank-app` (single Vercel project / single main website)  
**Production Supabase:** `hafoaurzfgkkwpvzedvd`  
**Development Supabase:** `wpmnjfncaoogssgpqxek` (isolated testing only)  
**Status:** Gate evaluation only. No migration, deploy, monitor, Forth write, or push send.

## Verdict

# NO-GO for production SQL

**Primary blocker:** Production backup/recovery cannot be verified to a usable restore point.

| Backup check (CLI) | Result |
| --- | --- |
| Command | `supabase backups list --project-ref hafoaurzfgkkwpvzedvd` |
| `walg_enabled` | `true` |
| `pitr_enabled` | `false` |
| `backups` | `[]` (empty — no listed restore timestamp) |
| `physical_backup_data` | `{}` |
| Dashboard | https://supabase.com/dashboard/project/hafoaurzfgkkwpvzedvd/database/backups |

**Implication:** Latest backup time is unknown; PITR restore is unavailable; restore-to-new-project has **no listed physical backup** to select. SQL rollback scripts alone are not sufficient recovery for a live operational database.

### Exact recovery procedure (required before any future SQL GO)

1. **Before DDL:** Create a verified recovery artifact **off-repo** (encrypted), e.g. owner-run logical dump stored outside git, **or** confirm a Dashboard physical backup / restore point with timestamp recorded.  
2. **Do not** download customer data dumps into this repository.  
3. **If migration fails mid-way:**  
   - Prefer reverse SQL rollbacks: V20.2 → Forth import → V20.  
   - If schema/data state is unsafe after rollback: restore to a **new** Supabase project from the pre-migration backup, validate counts, then cut over only with owner approval.  
4. Re-run this gate until CLI/Dashboard shows a concrete restore point **or** owner documents a successful logical-dump restore drill.

Until step 1–4 are satisfied: **production SQL remains NO-GO**.

---

## 1. Production backup / recovery readiness

| Question | Answer |
| --- | --- |
| Latest available backup | **Not listed** (`backups: []`) |
| PITR enabled | **No** |
| Restore-to-new-project available | **Not verifiable** (no listed physical backup) |
| Safe logical backup | Possible via authorised CLI/Dashboard dump to **off-repo** encrypted storage — not performed this session |
| Gate | **FAIL → NO-GO for SQL** |

---

## 2. Exact approved SQL candidates (ready to apply only after backup GO)

### Include (additive; production-compatible; no staging stub)

| Order | Candidate | Role |
| --- | --- | --- |
| A | `docs/ees-locations-map-pins-production-preflight-read-only.sql` | Read-only preflight (map pins already present — confirm auditor/history/grants) |
| B | `docs/ees-locations-map-pins-review-only.sql` | **Only if** preflight shows incomplete install; skip re-apply if verification already PASS |
| C | `docs/ees-fleet-operations-v20-review-only.sql` | `is_active` + fleet geofence/visit/monitor/push tables + RPCs/RLS/grants |
| C-v | `docs/ees-fleet-operations-v20-verification-read-only.sql` | Verify |
| D | `docs/ees-forth-locations-import-v20-review-only.sql` | Forth links, import audit, pilot sites |
| E | `docs/ees-fleet-operations-v20-2-review-only.sql` | Atomic review + notification outbox |
| E-v | `docs/ees-fleet-operations-v20-2-verification-read-only.sql` | Verify |

### Explicitly exclude

- `docs/ees-fleet-operations-v20-2-staging-booking-diary-stub-review-only.sql`
- Synthetic staging Directory / CAL-COMP / Pilot 002 rows
- Synthetic GPS / `staging:synthetic:*` events
- Staging test accounts (`staging-fleet-pilot@…`)

### Compatibility notes

- Production `booking_diary` exists (**1572** rows); UUID `id` compatible with V20 FK — **no stub**.
- Production `ees_locations` lacks `is_active` — V20 adds `boolean not null default true` (preserves existing rows as active).
- Map pins table exists (**0** rows); fleet/Forth/outbox tables **absent** (`PGRST205`).
- V20/V20.2/Forth SQL: mostly `create table` / new RPCs / RLS; idempotency is partial (`if not exists` on some objects; plain `create table` / `create policy` may fail on re-run — apply once after backup GO).
- Data preservation intent: no DML against Booking Diary, Fuel Logs, Maintenance, Weekly Mileage, HR, Insurance, Vehicle Performance, Finance.

### Rollback candidates

1. `docs/ees-fleet-operations-v20-2-rollback-review-only.sql`  
2. `docs/ees-forth-locations-import-v20-rollback-review-only.sql`  
3. `docs/ees-fleet-operations-v20-rollback-review-only.sql`  

---

## 3. Production schema compatibility (read-only probe)

| Object | Status |
| --- | --- |
| `ees_locations` | 103 rows; `verification_status` yes; **`is_active` no** |
| `ees_location_map_pins` | Present, 0 rows |
| Fleet V20 tables / RPCs | Absent |
| Forth import tables | Absent |
| V20.2 outbox | Absent |
| `booking_diary` | Present, UUID ids |

---

## 4. Existing operational data protection

### Pre-migration counts (capture before any future apply)

| Table / area | Count (read-only) |
| --- | --- |
| `ees_locations` | 103 |
| `ees_location_map_pins` | 0 |
| `booking_diary` | 1572 |
| `fuel_logs` | 2729 |
| `account_access` | 4 |
| `vehicle_monthly_performance` | 149 |
| `maintenance_records` | 43 |
| `ees_employee_profiles` | 1 |

### Post-migration verification queries (owner runs after approved apply)

```sql
-- Counts must match pre-migration for operational tables
select 'booking_diary' as t, count(*) from public.booking_diary
union all select 'fuel_logs', count(*) from public.fuel_logs
union all select 'ees_locations', count(*) from public.ees_locations
union all select 'maintenance_records', count(*) from public.maintenance_records
union all select 'vehicle_monthly_performance', count(*) from public.vehicle_monthly_performance;

-- New objects exist; locations gained is_active without row loss
select count(*) as locations_with_is_active
from public.ees_locations where is_active is not null;

select to_regclass('public.ees_fleet_geofence_zones') as zones,
       to_regclass('public.ees_fleet_visit_events') as visits,
       to_regclass('public.ees_forth_location_links') as forth_links,
       to_regclass('public.ees_fleet_notification_outbox') as outbox;
```

No staging data transfer into production.

---

## 5. Deployment readiness (Vercel `fuel-bank-app` — do not deploy yet)

| Check | Status |
| --- | --- |
| Production Supabase URL on Vercel Production | Must remain `hafoaurzfgkkwpvzedvd` |
| App safe if fleet tables missing | Yes — Fleet Ops `storagePending` / missing-table handling |
| `EES_FLEET_MONITOR_ENABLED` | Not set / must stay false |
| `EES_WEB_PUSH_TEST_ENABLED` | Not set / must stay false |
| Production VAPID | Not configured yet |
| New Vercel project | **Forbidden** |

### Safe deploy checklist (after SQL GO + owner word)

1. Verify Production env URL host = `hafoaurzfgkkwpvzedvd`.  
2. Confirm monitor + push TEST flags false.  
3. Deploy to Production on `fuel-bank-app` only.  
4. Smoke: login, Booking Diary, Fuel Logs, Fleet Ops shows storage banner **or** live UI if DDL already applied.  
5. Rollback: redeploy previous Production deployment in Vercel (app-only); DB rollback uses SQL rollbacks / restore procedure above.

Gated app deploy **before** DDL is optionally safe; enabling fleet features still requires SQL GO.

---

## 6. iPhone TEST readiness (main domain)

| Item | Status |
| --- | --- |
| HTTPS | `https://fuel-bank-app.vercel.app` |
| Auth | Real production `account_access` (4 office users) |
| SW / manifest / `[TEST]` API | Code ready |
| Push tables | Pending V20 DDL |
| Production VAPID | Required (generate for production; do not reuse staging private key) |
| Procedure | Home Screen → sign in → Register device → brief TEST flag → one `[TEST]` → confirm on-device → disable |
| Operational / fleet-wide push | Remains off |

Do not send TEST until DDL + VAPID + owner approval.

---

## 7. Remaining blockers

1. **No verifiable production backup restore point / PITR off** → SQL NO-GO.  
2. Production VAPID not configured.  
3. Fleet/Forth schema not installed (expected until SQL GO).  
4. Vercel SSO on `*.vercel.app` may complicate Home Screen — validate before TEST.  
5. Depot production configuration and monitor pulses remain later approvals.

---

## 8. GO / NO-GO

| Scope | Decision |
| --- | --- |
| Production SQL apply | **NO-GO** |
| Production push send / monitor / Forth writes | **NO-GO** |
| Gated app deploy (flags off, prod DB URL) | **CONDITIONAL GO** only after separate owner deploy approval |
| Overall release gate | **NO-GO** until backup/recovery verified |

---

## 9. Exact owner approvals required (in order)

1. Complete backup/recovery verification (listed restore point **or** off-repo logical dump + restore drill).  
2. Re-run this gate → SQL candidate GO.  
3. Approve additive SQL package apply (candidates C–E; map-pin only if preflight requires).  
4. Approve Production VAPID install.  
5. Approve app deploy on `fuel-bank-app` with flags off (sequence flexible vs DDL).  
6. Approve one main-domain `[TEST]` notification.  
7. Later: Forth import / depot 1977073 @ 120 m / supervised monitor (still no cron / no operational push until separate word).

## Local verification (this session)

| Check | Result |
| --- | --- |
| Focused fleet/security/isolation/push/staging-gate tests | 13/13 pass |
| `tsc --noEmit` | pass |
| ESLint | 0 errors (pre-existing warnings only) |
| Isolated production build | pass (session log) |
