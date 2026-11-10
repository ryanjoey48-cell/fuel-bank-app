# EES V20.3 — finished release report (main website)

**Date:** 2026-11-01  
**Site:** https://fuel-bank-app.vercel.app · Vercel project `fuel-bank-app` only  
**Branch:** local `main` (uncommitted fleet work preserved; no commit/push/deploy this session)  
**Production DB:** `hafoaurzfgkkwpvzedvd`  
**Development DB:** `wpmnjfncaoogssgpqxek` (Pilot 002 + schema staging)

## Executive verdict

Fleet Operations code for V20–V20.3 is **implemented and verified in tests/staging**.  
Production recovery has an **encrypted logical backup (PASS)** but **restore drill not yet run**.  
Therefore: **production SQL = NO-GO**, **monitor/push = NO-GO**, **code-only deploy = CONDITIONAL (gated)**.

---

## 1. Production recovery status

| Item | Status |
| --- | --- |
| Encrypted logical backup `20261101-194605` | **Implemented / PASS** |
| Checksum recheck (this session) | **PASS** |
| Key separation + ACL + no plaintext | **PASS** |
| CLI temp login roles expired | **PASS** |
| Isolated restore drill executed | **Blocked — Requires approval** |
| Disposable restore target available now | **No** (local PG has no usable password; no temp Supabase project exists) |

### Restore target creation requirements (owner approval needed before create)

Create a **new temporary Supabase project** (Free tier preferred):

| Field | Value |
| --- | --- |
| Name suggestion | `ees-restore-drill-20261101` |
| Region | Prefer `ap-northeast-1` (match production) or any Free region |
| Must NOT be | `hafoaurzfgkkwpvzedvd` or `wpmnjfncaoogssgpqxek` |
| Cost | Usually **$0** until deleted (Free); Pro billed until delete |
| After create | Authorise decrypt + `psql` restore via `scripts/prepare-production-backup-restore-drill.ps1` |
| After evidence | Delete temp project |

Partial restore expectations: **public** schema/data only. Auth users, Storage objects, Edge Functions, Dashboard settings are **not** in the logical backup.

## 2. Remaining restoration approval requirement

**Exact next owner approval (recovery):**  
Authorise creation of temporary Supabase project `ees-restore-drill-20261101` (or equivalent new ref), then authorise restore drill of backup `20261101-194605` into that project only.

## 3. Production SQL readiness

| Package | Ready as review-only | Staging applied | Production installed |
| --- | --- | --- | --- |
| Map-pin preflight/repair | Ready if needed | N/A | **Requires approval** after recovery |
| `ees-fleet-operations-v20-review-only.sql` | Ready | Yes | **Blocked** |
| `ees-forth-locations-import-v20-review-only.sql` | Ready | Yes | **Blocked** |
| `ees-fleet-operations-v20-2-review-only.sql` | Ready | Yes | **Blocked** |
| Staging booking diary stub | **Excluded forever from production** | Staging only | Must never install |
| Synthetic staging locations/events | **Excluded** | Staging only | Must never copy |
| Production depot Pilot 002 config | Review-only prepared | Staging PASS | **Requires approval** after SQL |

Pre-migration production baselines: `booking_diary` 1572, `fuel_logs` 2729, `ees_locations` 103, map pins 0, `account_access` 4, `vehicle_monthly_performance` 149, `maintenance_records` 43.

## 4. Features safe for code-only deployment (CONDITIONAL)

Safe **if** monitor/push flags stay off and missing tables soft-fail (503 / storage-pending UI):

| Feature | Classification |
| --- | --- |
| Fleet Tracking / Forth map (existing) | Implemented — releasable with existing prod schema |
| Locations Directory | Implemented — releasable |
| Fleet Events page + APIs (gated UI when tables missing) | Implemented — **code-only OK** |
| Forth import UI (disabled until tables exist) | Implemented — **code-only OK** |
| Geofence engine (pure + APIs soft-fail) | Implemented — **code-only OK** |
| Monitor route (disabled unless flag+secret) | Implemented — **must stay disabled** |
| Web Push register/TEST (needs VAPID + flag) | Implemented — **must stay disabled** |
| Outbox `deliveryEnabled` default false | Implemented — safe |

**Requires separate explicit authorisation:** Vercel Production deploy of this uncommitted `main` scope. No deploy performed this session.

## 5. Features still dependent on migrations

| Feature | Needs |
| --- | --- |
| Visit events / geofence state / monitor runs | V20 + V20.2 SQL |
| Forth draft import / bulk approve storage | Forth import V20 SQL |
| Active Pilot 002 depot zone on production Directory | SQL + depot config approval (use prod id `4e2d87d2-…`, not staging UUID) |
| Booking match review with fleet visits | Fleet visit tables + live diary (diary already exists) |
| Operational iPhone push from arrivals | SQL + VAPID + delivery enablement approvals |

## 6. Forth locations status

| Item | Status |
| --- | --- |
| CSV 466 unique Forth IDs | Implemented / tested |
| Reconciliation + bulk draft workflow | Implemented / tested |
| Staging import schema | **Tested in staging** |
| Production import tables | **Blocked** (absent) |
| Auto-import all / overwrite office coords | **Not done** (correctly refused) |

## 7. Depot arrival/departure readiness

| Item | Status |
| --- | --- |
| Office `1708908` vs Depot `1977073` separation | Documented / corrected |
| Staging Pilot 002 (120 m / 60 s / 25 m) | **Tested in staging (PASS)** |
| Supervised GPS on staging | CONDITIONAL (vehicle often outside 120 m) |
| Production depot config SQL | Review-only prepared — **Requires approval** |
| Live monitor / visit writes | **Requires approval** — currently off |

## 8. iPhone notification readiness

| Item | Status |
| --- | --- |
| PWA manifest + service worker push handlers | Implemented |
| Subscription / TEST APIs with flags | Implemented / tested |
| `[TEST]` labelling path | Implemented |
| Production VAPID | **Missing — Requires approval to create/configure** |
| Operational delivery | Hard-off — **Requires approval** |
| One-device physical TEST | **Requires approval** after VAPID on main site |

## 9. Test / build results (this session)

| Check | Result |
| --- | --- |
| Focused fleet tests | **51/51 PASS** |
| `tsc --noEmit` | **PASS** |
| ESLint | **PASS** (0 errors, 3 pre-existing warnings) |
| `npm run build:isolated` | (running / see report JSON) |

Safe code fix this session: fleet events API treats missing V20 tables as explicit 503 “not installed yet” for code-only deploy safety.

## 10. Exact next owner approvals (ordered)

1. **Create temp restore project** `ees-restore-drill-20261101` (Free) and authorise restore drill of `20261101-194605`.  
2. After drill **PASS** → authorise **production SQL package** (V20 → Forth import → V20.2; never booking stub).  
3. Authorise **code-only Production deploy** of gated fleet UI (monitor/push flags off).  
4. Authorise **production depot Pilot 002 config** on existing Directory id (inactive then active zone as separate steps).  
5. Authorise **production VAPID** + one labelled `[TEST]` iPhone send.  
6. Authorise **supervised monitor pulse** (allowlisted depot only).  
7. Later: unattended schedule / operational push — only after 5–6 PASS.

---

## Classification matrix

| Capability | Implemented | Tested in staging | Released to production | Requires approval | Blocked |
| --- | --- | --- | --- | --- | --- |
| Fleet Tracking UI | Yes | Partial (live Forth) | Prior / ongoing | Deploy of new uncommitted scope | — |
| Locations Directory | Yes | Yes | Yes (103 rows) | — | — |
| Fleet Events / import UI | Yes | Yes (APIs) | No | Code-only deploy | Prod tables |
| Geofence engine | Yes | Fixture/staging | No | — | Live writes |
| Monitor worker | Yes | Isolation tests | No | Enable + pulse | Flags off |
| Notification outbox | Yes | Yes | No | Delivery enable | deliveryEnabled false |
| Web Push / iPhone | Yes | Prep only | No | VAPID + TEST | Prod VAPID |
| Booking match hints | Yes | Fixture | No | After visit tables | Prod fleet DDL |
| Logical backup | Yes | N/A | Off-repo artifact | — | — |
| Restore drill | Helper ready | No | No | Temp project + restore | No target yet |
| Prod V20 SQL | Packaged | Staging install PASS | No | After restore PASS | Recovery gate |
| Pilot 002 depot prod | Review SQL | Staging PASS | No | Config + activate | After SQL |

**Overall production Fleet Operations release gate: NO-GO** until restore drill PASS + SQL approval.
