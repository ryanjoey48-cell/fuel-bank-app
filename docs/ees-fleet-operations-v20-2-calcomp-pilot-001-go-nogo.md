# CAL-COMP Pilot 001 — GO / NO-GO staging migration report

**Date:** 2026-10-31  
**Mode:** review only — no migration applied, no geofence enabled, no monitor, no live push  
**Strategy:** `docs/ees-fleet-operations-v20-2-location-activation-strategy.md`

---

## Verdict

| Gate | Result |
| --- | --- |
| Operational pin model (Forth default; no truck-entrance requirement) | **GO** — aligned; code already gates on destination pin only |
| CAL-COMP link candidate (Forth 2742427 ↔ EES CAL-COMP) | **GO pending owner link approval** |
| Confirm Forth coords as destination pin | **GO pending admin confirmation** (preserve Forth ID in `coordinate_source` / `source_reference`) |
| Staging SQL apply (V20 → Forth import → V20.2) | **NO-GO until owner approves** — tables/RPCs/`is_active` still missing on probed project |
| Enable CAL-COMP geofence / monitor / push | **NO-GO** until SQL verified + pin confirmed + radius approved + supervised vehicle |

**Overall staging migration:** **NO-GO to apply until owner signs the decisions below.**  
**Overall pilot preparation (docs/tests/preflight):** **GO to proceed with owner review.**

---

## Blockers resolved by clarification

| Former concern | Resolution |
| --- | --- |
| Require truck-entrance coordinates before pilot | **Dropped.** Drivers use Forth saved destination; entrance finding is operational, not a data gate. |
| ~458 m OSM works offset | **Informational warning only.** Do not replace Forth coordinates. |
| Public factory listing ~4 km from Forth | **Informational.** Other public map features are not the default pin; Forth remains candidate. |
| Map-pin history `service_role` SELECT 42501 | **Not a defect.** Designed grants: history SELECT for `authenticated`; insert via auditor trigger; `service_role` intentionally revoked. Pins table remains readable by service_role. |

---

## Schema findings (probed project)

| Item | Finding | Action |
| --- | --- | --- |
| `verification_status` | Present — Directory truth for verified/needs_check | Keep |
| `is_active` | **Missing** — V20 adds it | **Keep additive.** Not a duplicate of `verification_status`. Soft-disable for monitoring without unverifying. Default `true` leaves all 103 rows behaviourally unchanged for Directory. |
| Map pins | Present, 0 rows; columns match review-only design | No recreate needed; confirm pins via UI after SQL for fleet objects |
| Map-pin history grants | As designed | No grant widening for service_role |
| V20 / Forth / V20.2 tables + RPCs | **Missing** | Apply only after owner approval, in order below |

Isolated PGlite fixture `tests/calcomp-pilot-001-migration-safety.test.cjs`: **pass** — ordered apply does not rewrite Directory business fields or unrelated `booking_diary` rows; `is_active` defaults true; unverified/unpinned CAL-COMP cannot enable a zone.

---

## Exact SQL order (when approved)

Read-only first:

1. `docs/ees-fleet-operations-v20-2-calcomp-pilot-001-preflight-read-only.sql`
2. Map-pin preflights if desired (pins already installed)

Apply:

1. `docs/ees-fleet-operations-v20-review-only.sql` + `docs/ees-fleet-operations-v20-verification-read-only.sql`
2. `docs/ees-forth-locations-import-v20-review-only.sql`
3. `docs/ees-fleet-operations-v20-2-review-only.sql` + `docs/ees-fleet-operations-v20-2-verification-read-only.sql`

Rollback if needed: V20.2 → Forth → V20 rollback scripts. Snapshot/PITR before apply.  
Env: `EES_FLEET_MONITOR_ENABLED=false`, push test off.

No review-only SQL rewrite of Directory rows or Forth coordinates is proposed.

---

## CAL-COMP coordinate pack (owner review)

| Point | Lat, Lon | Maps | Role |
| --- | --- | --- | --- |
| **Forth saved pin (default)** | 13.234431, 99.806063 | https://www.google.com/maps?q=13.234431,99.806063 | **Candidate destination pin** — preserve |
| OSM works (warning) | 13.2356451, 99.8101043 | https://www.google.com/maps?q=13.2356451,99.8101043 | ~458 m offset — informational |
| Public “Phetchaburi Factory” listing | 13.267716, 99.821417 | https://www.google.com/maps?q=13.267716,99.821417 | ~4.06 km — informational public feature |
| EES Directory search URL | — | https://www.google.com/maps/search/?api=1&query=CAL-COMP%20138%20Moo%204%2C%20Sa%20Phang%2C%20Khao%20Yoi%2C%20Phetchaburi%2076140 | Address search only |

Forth diameter raw `100`: **do not** treat as radius.

---

## Remaining owner decisions (checklist)

1. [ ] Approve linking Forth `2742427` → EES `74ac5276-292b-5d30-a409-d9bf65e3e98c` (no second Directory draft).
2. [ ] Approve confirming **Forth coordinates** as the destination pin (source: Forth ID 2742427). Truck entrance not required.
3. [ ] Acknowledge informational warnings (458 m OSM; farther public listings) without changing the default pin unless deliberately choosing otherwise.
4. [ ] Approve **monitoring radius** (150 m only if explicitly accepted as provisional). Diameter raw unused.
5. [ ] Confirm probed Supabase host is the intended **staging** project; approve backup/PITR + SQL apply order.
6. [ ] After SQL: verify Directory, enable zone only for CAL-COMP with audit reason, keep monitor/push off until supervised GPS proof.
7. [ ] If real GPS shows the vehicle on-site but outside the zone: **flag for review** — do not silently enlarge radius.

---

## Permission / workflow notes (no UI redesign)

- Link Forth: `business:write`.
- Confirm Forth lat/lon as pin today: **admin** `manual_correction` path (coordinate_source / source_reference must cite Forth ID). Suitable for Pilot 001; scalable bulk Forth-pin confirm can be a later controlled enhancement — not required to unblock staging SQL.
- Enable geofence: **admin** + verified + `is_active` + confirmed destination pin + audit reason.
- Outbox stays `push_disabled` until separate approval.

---

## Next actions (ordered)

1. Owner completes decisions 1–5.
2. Apply SQL on staging (owner-operated); run verification scripts.
3. Link + confirm Forth pin for CAL-COMP; verify Directory; configure then enable one zone.
4. Supervised monitor when a GPS-verified vehicle approaches the Forth destination.
5. Record hit/miss; miss → review flag only.
