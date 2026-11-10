# Fleet Operations Centre — Journey & Parking History readiness (V8)

Live Fleet Tracking (map, monitor, Speed Watch, Attention) remains the priority. Historical features stay gated until owner-approved bounded Forth report tests succeed.

## Confirmed live today

| Capability | Status |
| --- | --- |
| Current fleet via `/api/admin/forth-tracking` | Live, read-only |
| Compact Operations Workspace shell on `/fleet-tracking` | Default; hides full site nav; compact app bar / workspace header |
| Compact command strip + KPI click-to-filter | Implemented |
| Speed Watch (top 5, expand, Focus map) | Live speed ranking only — separate from Attention |
| Attention Centre (session-only review) | Needs-action vs advisories; engine-on-stopped advisory only |
| Speed review model | Vehicle-class operational advisories + explicit “road limit unavailable”; never a legal offence |
| Monitor display presets (Operations / Detailed) | Browser `localStorage` |
| Thailand-first cameras + outside-core strip | Core ops / TH+neighbours / full fleet (min zoom floor) |

## Speed intelligence (V12)

Owner-reported Forth device alert settings are maintained in `lib/forth-speed-config.ts` (Group A 70 km/h / 10 s; Group B 90 km/h / 0 s). Live snapshots above threshold are **threshold exceedance**, not confirmed Forth overspeed events or legal road violations. See `docs/forth-speed-intelligence-v12.md`. `POST /api/vehicle/speedOverLimits` remains undocumented for this account and is not called.

## Historical endpoints — unresolved before activation

| Capability | Contract evidence | Blocker | Exact next requirement |
| --- | --- | --- | --- |
| Journey timeline | Swagger `POST /api/vehicle/trips`; adapter exists | `FORTH_HISTORY_LIVE_REQUESTS_ENABLED` remains false; account entitlement for history not proven on this paid profile in a bounded live test | Owner-approved one-device/one-day `trips` call; compare times/distances to Forth console without writing EES mileage |
| Parking / stops | Swagger `POST /api/vehicle/parkingTrip`; offline CSV in `docs/forth-parking-csv-analysis.md` | No verified live response for this account; duration/unit semantics not confirmed | After journeys succeed, one `parkingTrip` day vs CSV; keep idle duration as source text only |
| Route replay | `GET /api/log/{id}/{start}/{end}`; offline normalizer | Entitlement, size limits, retention unknown | Confirm entitlement then one bounded log day fixture |

**Do not** invent journey distance, idle minutes, parking duration, or legal speeding from the live feed. **Do not** write Weekly Mileage, Maintenance, Fuel, Booking Diary, or Vehicle Performance from history.

Gate remains: keep `FORTH_HISTORY_LIVE_REQUESTS_ENABLED` off until the bounded journey test is approved and documented.
