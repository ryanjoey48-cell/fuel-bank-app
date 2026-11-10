# EES V20.2 — CAL-COMP Pilot 001 staging activation preparation

**Status:** preparation only. No migration applied, no link/pin/zone enabled, no monitor cron, no Forth write, no live push.  
**Generated:** 2026-10-31 (local main)  
**Operational strategy:** `docs/ees-fleet-operations-v20-2-location-activation-strategy.md`  
**GO/NO-GO:** `docs/ees-fleet-operations-v20-2-calcomp-pilot-001-go-nogo.md`  
**Evidence files:**

- `output/v20-2-calcomp-pilot-001-service-read.json`
- `output/v20-2-calcomp-pilot-001-table-clarity.json`
- `output/v20-2-calcomp-pilot-001-forth-gps.json`
- `output/v20-2-calcomp-pilot-001-geometry.json`
- `output/v20-2-pilot-candidates.json` (Forth 2742427 entry)

Configured Supabase host probed (read-only): `hafoaurzfgkkwpvzedvd.supabase.co`.

**Binding ops note:** Drivers navigate to the saved Forth destination and find the entrance themselves. Truck-entrance pins are **not** required for pilot preparation. Default candidate = Forth `13.234431, 99.806063`. Public-map offsets are warnings only.

---

## 1. CAL-COMP matching evidence

### Forth export (source of truth for saved Forth location)

| Field | Value |
| --- | --- |
| Forth ID | `2742427` |
| Name | CAL-COMP |
| Group | MASS |
| Latitude | `13.234431` |
| Longitude | `99.806063` |
| Address text | CAL-COMP KHAO YOI |
| Diameter raw | `100` (**unit unverified — not monitoring radius**) |
| Reconcile class | POSSIBLE_DUPLICATE / strong exact-name match |

### Live EES Directory record

| Field | Value |
| --- | --- |
| EES id | `74ac5276-292b-5d30-a409-d9bf65e3e98c` |
| company_name | CAL-COMP |
| thai_name | null |
| address | 138 Moo 4, Sa Phang, Khao Yoi, Phetchaburi 76140 |
| google_maps_url | search link for the address above (`map_link_kind` historically `search_link`) |
| truck_entrance_url | null |
| verification_status | **needs_check** |
| verified_at | null |
| Forth ID in source_info | **not linked yet** |
| Confirmed destination pin | **none** (0 pins on this location; 0 pins fleet-wide) |
| Notes | Historical workbook row; requires location confirmation; **not** a verified truck entrance / exact map pin |

### Independent geography check (not a pin confirmation)

OpenStreetMap Nominatim hit **แคล-คอมพ์ อีเล็คโทรนิคส์ เพชรบุรี** (works):

- ~`13.2356451, 99.8101043`
- Straight-line distance from Forth pin: **≈ 458 m**

### Match verdict (owner decision required)

| Question | Assessment |
| --- | --- |
| Same customer / site name? | **Yes** — exact `CAL-COMP` |
| Same district / city context? | **Strong** — both Khao Yoi / Phetchaburi |
| Default destination candidate | **Forth saved pin** `13.234431, 99.806063` (drivers navigate here) |
| Truck-entrance pin required? | **No** — not part of pilot gate |
| Safe to auto-merge / overwrite Directory? | **No** |
| Recommended office action | **`link_existing`** → confirm **Forth coordinates** as destination pin (cite Forth ID) → configure EES radius → enable with audit |

**Informational warnings (do not replace Forth coords):**

1. OSM works feature ≈ **458 m** from Forth pin — retain in pilot log.
2. Some public “factory” listings sit ≈ **4 km** away — different public features; not the default pin.
3. EES Directory remains `needs_check` until staff verify after pin confirm.
4. Forth diameter raw `100` is **not** the monitoring radius.

---

## 2. Are Forth coordinates suitable for confirmation?

**Yes — as the default destination candidate.** Explicit staff confirmation still required (stage separation). Auto-import without confirmation: **no**.

- Preserve Forth lat/lon and Forth ID in pin `coordinate_source` / `source_reference`.
- Do **not** require `truck_entrance_url`.
- Public-map discrepancies stay as warnings; if live GPS later shows on-site activity outside the approved zone, **flag for review** — do not silently enlarge radius.
- **150 m** remains provisional until owner approves the EES monitoring radius.

---

## 3. Staging database readiness (read-only probe)

| Object | Live state |
| --- | --- |
| `ees_locations` | Present — **103** rows; CAL-COMP present |
| `ees_locations.is_active` | **MISSING** (V20 SQL adds this) |
| `ees_location_map_pins` | Present — **0** rows; columns include `pin_status`, `pin_type`, `coordinate_source`, `source_reference` |
| `ees_location_map_pin_history` | Present; **service_role SELECT denied by design** (authenticated read; auditor insert) |
| All `ees_fleet_*` V20 tables | **MISSING** (`PGRST205`) |
| Forth import tables (`ees_forth_location_*`) | **MISSING** |
| V20 / V20.2 RPCs (`set_ees_fleet_geofence_zone`, `commit_ees_fleet_geofence_transition`, `commit_ees_fleet_event_review`, `acquire_ees_fleet_monitor_lease`, `enqueue_ees_fleet_notification_outbox`) | **MISSING** (`PGRST202`) |
| Monitor / VAPID env on this machine | `EES_FLEET_MONITOR_*` unset; VAPID unset; Forth OAuth profile configured |

**Verdict:** staging/prod project behind local V20.2 code — **not migration-ready to enable a live CAL-COMP geofence** until owner-approved SQL is applied in order and verified.

> Confirm the probed project is the intended **staging** project before any apply. Host above is whatever `.env.local` currently points at.

---

## 4. Exact migration requirements and order

Do **not** apply until owner approval. Prefer a DB backup / PITR restore point first.

### Preflight (read-only SQL Editor)

1. `docs/ees-fleet-operations-v20-2-calcomp-pilot-001-preflight-read-only.sql` (CAL-COMP + designed pin-history grants + missing fleet objects)
2. Optional map-pin preflights if re-validating pin install
3. Confirm: intended **staging** database name before any apply

### Apply order (owner-approved only)

| Step | File | Why for Pilot 001 |
| --- | --- | --- |
| A | Map-pin SQL **only if** pins table missing | Live pins table already present (0 rows). History service_role SELECT denial is **designed** — do not “fix” by granting service_role SELECT. |
| B | `docs/ees-fleet-operations-v20-review-only.sql` | Adds `is_active` (soft fleet gate; not a duplicate of `verification_status`), zones, visits, monitor lease, RPCs |
| B′ | `docs/ees-fleet-operations-v20-verification-read-only.sql` | Verify V20 objects + RLS |
| C | `docs/ees-forth-locations-import-v20-review-only.sql` | Forth link/import audit + pilot site table |
| D | `docs/ees-fleet-operations-v20-2-review-only.sql` | Atomic review RPC, outbox enqueue, request idempotency |
| D′ | `docs/ees-fleet-operations-v20-2-verification-read-only.sql` | Prove outbox + review RPC |

### Rollback order (only if staged apply must be reversed)

1. `docs/ees-fleet-operations-v20-2-rollback-review-only.sql`
2. `docs/ees-forth-locations-import-v20-rollback-review-only.sql`
3. `docs/ees-fleet-operations-v20-rollback-review-only.sql`
4. Map-pin rollback only with a dedicated, owner-approved script (none applied here)

### Environment checks before enablement

- [ ] Staging URL/keys confirmed
- [ ] `EES_FLEET_MONITOR_ENABLED=false`
- [ ] `EES_FLEET_MONITOR_SECRET` prepared (≥ 32 chars) — unused until supervised run
- [ ] `EES_WEB_PUSH_TEST_ENABLED=false`
- [ ] VAPID absent or unused for fleet outbox
- [ ] Forth credentials remain read-only

---

## 5. Backup / rollback readiness

| Item | State |
| --- | --- |
| SQL scripts transactional (`begin`…)? | V20 / Forth / V20.2 review-only scripts use transactions |
| Rollback scripts present? | Yes for V20, Forth import, V20.2 |
| Map-pin history grants | **As designed** — authenticated SELECT; service_role no SELECT; auditor INSERT |
| Automated backup taken in this session? | **No** — owner must snapshot / confirm PITR before apply |
| Data preservation | Scripts are additive; Directory/financial rows are not rewritten by design. Link path only appends `source_info`. |

---

## 6. Workflow support (code already on local main)

| Step | Supported? | Gate |
| --- | --- | --- |
| Link Forth → EES | Yes — `POST /api/fleet-operations/forth-import` `action=link_existing` | `business:write`; does **not** overwrite coords/verification |
| Confirm destination pin | Yes — `POST /api/locations/map-pins` with `confirm=true` | `business:write`; admin for manual lat/lng correction |
| Configure radius / dwell / hysteresis | Yes — `PUT /api/fleet-operations/zones` | Admin only; radius 25–5000 m |
| Enable geofence + audit reason | Yes — same PUT with `active=true`, reason ≥ 5 chars | Requires verified + `is_active` + confirmed destination pin; RPC must exist |
| Outbox on commit | Yes — monitor enqueues with `p_delivery_enabled: false` → `push_disabled` | Needs V20.2 outbox objects |

**150 m:** schema/API default / provisional test value only. Owner must explicitly approve the monitoring radius before enable.

---

## 7. Forth GPS / polling limitations (live read-only snapshot)

Snapshot: 21 vehicles, 2026-10-31 ~22:17 Asia/Bangkok.

| Signal | Count |
| --- | --- |
| Valid coordinates | 21/21 |
| Timestamps current (&lt;15 min) | 20/21 |
| `GPS=ON` | 21/21 |
| `positionSource` quality **gps** (app-verified path) | **6/21** |
| `positionSource` **No GPS** | **15/21** |
| App GPS-verified heuristic | **6** |
| Within provisional 150 m of Forth CAL-COMP | **0** |
| Within 50 km of CAL-COMP | **0** (nearest ~114 km, Samut Prakan area) |

**Implications for a real arrival/departure test:**

- Forth feed is reachable; many positions are **not** `positionQuality=gps` and will be skipped by the geofence engine.
- Polling is **discrete REST snapshots**, not a continuous stream. Arrival needs ≥2 verified samples spanning entry dwell (default 60 s) with gaps ≤ 5 minutes; max observation age 15 minutes.
- **No vehicle is at CAL-COMP now** — a live pilot arrival cannot be claimed from this snapshot.
- Fixture tests prove engine/outbox logic only; they do **not** prove a real truck arrival.

---

## 8. Supervised CAL-COMP monitoring test (when vehicle available)

Keep monitor disabled until this checklist is green.

1. Owner approves Forth pin as default destination candidate + explicit EES radius (150 m only if provisional).
2. Office links Forth `2742427` → EES `74ac5276-292b-5d30-a409-d9bf65e3e98c` (preserve Forth ID).
3. Admin confirms destination pin at Forth coords (cite Forth ID); verify Directory (`is_active` defaults true after V20). Truck entrance not required.
4. Admin enables **only** the CAL-COMP zone with audit reason naming Pilot 001.
5. Select one vehicle that shows **GPS-verified** samples while approaching the site.
6. Set `EES_FLEET_MONITOR_ENABLED=true` temporarily; call protected `/api/internal/fleet-monitor` with secret under supervision.
7. Expect: entry candidate → continuous dwell → **one** arrival visit row; repeat poll does not duplicate `event_key`.
8. Expect: **one** outbox intent, `status=push_disabled`.
9. On departure: continuous exit samples → one departure + duration; missing GPS → UNCERTAIN / no false departure.
10. Disable monitor flag again; leave push delivery disabled.

---

## 9. Notification outbox verification

- Code path: after committed visit events, `enqueueVisitNotificationIntents` calls RPC with `p_delivery_enabled: false`.
- Fixture path already proved one event → one `push_disabled` intent (local PGlite).
- Live outbox table **not installed** on probed DB until V20.2 SQL — re-verify with `docs/ees-fleet-operations-v20-2-verification-read-only.sql` after apply.

---

## 10. Subsequent iPhone test requirements (not now)

Do **not** enable live fleet push for Pilot 001.

Later (V20.3), for one authorised iPhone only:

1. HTTPS EES + Safari Add to Home Screen (iOS 16.4+)
2. Office user subscribed from installed PWA
3. VAPID public/private + subject configured
4. `EES_WEB_PUSH_TEST_ENABLED=true` in non-prod only
5. Use gated server **test-push** — not outbox delivery for fleet events
6. Keep outbox `delivery_enabled=false` until separate owner approval

---

## 11. Outstanding security / permission risks

1. Fleet RPCs/tables absent — enabling UI against this DB will 503/fail closed (good) but staging apply is mandatory first.
2. `is_active` missing — zone enable path cannot succeed until V20 SQL.
3. Map-pin history service_role SELECT denied — **expected**; verify history via authenticated office session or SQL Editor.
4. Anon cannot read Directory/pins (RLS) — expected; office APIs must keep using authenticated/service paths.
5. Zone enable is admin-only — preserve; do not weaken for pilot.
6. Monitor secret / push flags currently unset — keep false until supervised run.
7. Wrong pin + tight radius is an operational integrity risk (false miss/false hit), not only a UX issue.

---

## 12. Required owner approvals

1. Confirm CAL-COMP Forth ↔ EES are the same customer destination (link, do not duplicate).
2. Approve **Forth coordinates** as the confirmed destination pin (cite Forth ID). Truck entrance not required.
3. Acknowledge ~458 m OSM (and farther public listings) as **warnings only**.
4. Approve **monitoring radius** (150 m only if provisional). Diameter raw unused. Misses → review flag, not silent resize.
5. Approve **staging SQL apply** (order in §4) on the correct project + backup/PITR.
6. Approve **single-zone enable** for Pilot 001 with audit reason.
7. Approve **supervised monitor** when a GPS-verified vehicle approaches the Forth destination.
8. Defer live operational push until after visit+outbox proof.

---

## 13. Step-by-step first live arrival/departure acceptance

Preconditions: §12 approvals 1–5 done; SQL verified; only CAL-COMP zone active; push delivery off.

1. On `/fleet-events` / Forth monitor, identify vehicle with `positionSource` quality **gps**, current `dateTime`, tracker connected.
2. Confirm vehicle is tasked to CAL-COMP; watch distance to **confirmed pin** (not OSM alone).
3. Supervised monitor poll while vehicle is outside → no arrival.
4. When vehicle enters radius, ensure polls continue within ≤5 min gaps for ≥ entry dwell.
5. Assert **one** `arrival` visit event for that vehicle/location visit key.
6. Assert **one** outbox row `push_disabled` for that event key; second poll does not add another.
7. During on-site period, confirm state remains INSIDE across continuous samples; long GPS gap → UNCERTAIN / restarted candidate, not invented departure.
8. On exit with continuous samples ≥ exit dwell → **one** departure + `duration_seconds`.
9. Capture run ids, event keys, plates, pin coords, radius, dwell settings in the pilot log.
10. Turn `EES_FLEET_MONITOR_ENABLED` back to `false`.

**Do not** treat fixture success or this prep document as proof of a real truck arrival.
