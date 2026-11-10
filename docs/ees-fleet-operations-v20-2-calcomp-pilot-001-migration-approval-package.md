# CAL-COMP Pilot 001 — staging migration approval package

**Prepared:** 2026-10-31  
**Owner configuration approval recorded:** `output/v20-2-calcomp-pilot-001-owner-approval.json`  
**Preflight snapshot:** `output/v20-2-calcomp-pilot-001-staging-preflight.json`  
**Strategy:** `docs/ees-fleet-operations-v20-2-location-activation-strategy.md`  

**This package does not apply SQL.** Owner must approve apply separately after backup verification.

---

## 1. Staging project identity (from local `.env.local`)

| Field | Value |
| --- | --- |
| API host | `hafoaurzfgkkwpvzedvd.supabase.co` |
| Project ref | `hafoaurzfgkkwpvzedvd` |
| Dashboard | https://supabase.com/dashboard/project/hafoaurzfgkkwpvzedvd |
| Database settings | https://supabase.com/dashboard/project/hafoaurzfgkkwpvzedvd/database/settings |
| Backups | https://supabase.com/dashboard/project/hafoaurzfgkkwpvzedvd/database/backups |

**Environment safety (2026-10-31):** `hafoaurzfgkkwpvzedvd` is **CONFIRMED PRODUCTION** — same project as Vercel Production env. See `docs/ees-fleet-operations-v20-2-database-environment-safety.md`. **NO-GO** for applying SQL under a staging assumption.

---

## 2. Same-destination confirmation (before link)

| Source | Identity |
| --- | --- |
| Forth | ID `2742427`, CAL-COMP, MASS, `13.234431, 99.806063`, CAL-COMP KHAO YOI |
| EES | ID `74ac5276-292b-5d30-a409-d9bf65e3e98c`, CAL-COMP, 138 Moo 4 Sa Phang Khao Yoi Phetchaburi 76140, `needs_check`, Forth ID **not** yet in `source_info` |

**Verdict:** Same **operating destination** for Pilot 001 — approved to **link_existing** (not create a second draft).  
Preserve Forth coordinates; keep ~458 m public-map offset as informational warning.  
**Link write not executed** in this session.

---

## 3. Preflight results (read-only)

| Check | Result |
| --- | --- |
| `ees_locations` | Present — 103 rows; CAL-COMP present |
| `verification_status` | Present |
| `is_active` | **MISSING** (V20 adds) |
| `ees_location_map_pins` | Present — **0** pins |
| Map-pin history | In schema; service_role SELECT denied **by design** |
| OpenAPI `ees_fleet_*` / Forth link tables | **Absent** |
| V20 / V20.2 RPCs | **Absent** (`PGRST202`) |
| `booking_diary` | Present — 1572 rows (must remain untouched by fleet SQL) |
| Monitor / VAPID env | Unset / false — good for pre-enablement |
| Isolated migration safety fixture | **Pass** (`tests/calcomp-pilot-001-migration-safety.test.cjs`) |

Read-only SQL Editor script:  
`docs/ees-fleet-operations-v20-2-calcomp-pilot-001-preflight-read-only.sql`

---

## 4. Migration dependencies (exact order)

Do **not** re-apply map-pin install unless pins table is missing (it is present).

| Step | File | Depends on |
| --- | --- | --- |
| 0 | Owner confirms project ref = staging + backup complete | — |
| 1 | `docs/ees-fleet-operations-v20-review-only.sql` | `ees_locations`, `ees_location_map_pins`, `booking_diary`, `auth.users` |
| 1v | `docs/ees-fleet-operations-v20-verification-read-only.sql` | Step 1 |
| 2 | `docs/ees-forth-locations-import-v20-review-only.sql` | `ees_locations` |
| 3 | `docs/ees-fleet-operations-v20-2-review-only.sql` | Step 1 (`ees_fleet_visit_events`, review history) |
| 3v | `docs/ees-fleet-operations-v20-2-verification-read-only.sql` | Step 3 |

**Rollback (only if apply must be reversed):**

1. `docs/ees-fleet-operations-v20-2-rollback-review-only.sql`
2. `docs/ees-forth-locations-import-v20-rollback-review-only.sql`
3. `docs/ees-fleet-operations-v20-rollback-review-only.sql`

**Safety properties (from fixture + SQL review):**

- Additive fleet objects; Directory business fields not rewritten
- `is_active boolean not null default true` — soft fleet gate; not a duplicate of `verification_status`
- Zone enable still requires verified + confirmed destination pin
- Unrelated operational tables (e.g. booking diary) not targeted

---

## 5. Verified backup / recovery process

Owner/operator must complete these **before** SQL apply. Agent cannot create Dashboard backups from this session.

### Preferred (staging with PITR add-on)

1. Open https://supabase.com/dashboard/project/hafoaurzfgkkwpvzedvd/database/backups  
2. Confirm **daily backups** and/or **PITR** status for the plan.  
3. Note the **earliest and latest recovery points** (timezone Asia/Bangkok).  
4. Record wall-clock time immediately before apply (for PITR target).  
5. Apply SQL in the Editor as a privileged role.  
6. If apply fails badly: Dashboard → Backups → restore to the pre-apply point (PITR) **or** restore daily backup taken before apply. Project is unavailable during restore.  
Docs: https://supabase.com/docs/guides/platform/backups  

### If PITR is not enabled

1. Confirm a **successful daily backup** exists that predates apply, **or**  
2. Take a logical dump via Supabase CLI (`supabase db dump`) / `pg_dump` of schema+data to secure storage, **or**  
3. Prefer **restore to a new project** from a physical backup for dry-run (paid plans) before touching the live ref: https://supabase.com/docs/guides/platform/clone-project  

### Post-restore notes

- Drop/recreate non-Realtime replication slots if used (per Supabase docs).  
- Re-run verification SQL after any restore.  
- Fleet SQL rollbacks above are preferred for clean reverse of a successful partial apply; PITR is the safety net for unexpected damage.

### Approval checkbox (owner)

- [ ] Project ref `hafoaurzfgkkwpvzedvd` confirmed as **staging** (or substitute correct staging ref and re-run preflight)
- [ ] Backup/PITR (or logical dump) verified and timestamp recorded: _______________
- [ ] Rollback scripts and verification scripts located
- [ ] `EES_FLEET_MONITOR_ENABLED` remains unset/false during and after apply until supervised test
- [ ] Apply window scheduled with operator present

---

## 6. After SQL (still not monitoring)

Three-stage workflow for CAL-COMP only:

1. **Link** Forth `2742427` → EES CAL-COMP (`source_info` append; no coord overwrite).  
2. **Approve destination** — confirm pin at Forth coords; cite Forth ID in source fields.  
3. **Configure geofence** — radius **150 m provisional**, dwell defaults; enable only with audit reason after Directory verified.

Then: supervised GPS proof → outbox `push_disabled` check → iPhone later.

---

## 7. Remaining blockers for owner approval

| # | Blocker | Who |
| --- | --- | --- |
| 1 | Confirm `hafoaurzfgkkwpvzedvd` is staging (or name the correct staging ref) | Owner |
| 2 | Complete backup/PITR (or dump) checklist in §5 | Owner / DB admin |
| 3 | Explicit **approve to apply** SQL order in §4 | Owner |
| 4 | After apply: execute link + Forth pin confirm + verify Directory | Office / admin |
| 5 | Explicit approve to **enable** CAL-COMP zone + supervised monitor | Owner |
| 6 | Prepare `EES_FLEET_MONITOR_SECRET` (≥32 chars) only when enabling monitor | Ops |
| 7 | Live push / iPhone still **out of scope** | — |

**Not blockers:** truck-entrance pin; map-pin history service_role SELECT denial; ~458 m OSM warning.
