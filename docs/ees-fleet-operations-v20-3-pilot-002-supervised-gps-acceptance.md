# Pilot 002 — supervised real-GPS acceptance (staging only)

**Depot:** Forth `1977073` @ 13.768732, 100.766033 — 120 m provisional  
**Directory UUID:** `cccccccc-dddd-4eee-8fff-000000000002`  
**Office `1708908`:** out of scope  
**Activate only after readiness report is GO/CONDITIONAL_GO and owner authorises a pulse.**

## Preconditions

1. `assert-staging-sql-target` + monitor isolation env (`ALLOWED` + `APPROVED` = `wpmnjfncaoogssgpqxek`).
2. Depot Directory + Forth link + destination pin + **active** 120 m zone on staging.
3. Forth read-only credentials in `.env.staging.local` (copied without production Supabase keys).
4. `EES_FLEET_MONITOR_SECRET` ≥ 32 characters (staging-only).
5. **Fail-closed location allowlist:**  
   `EES_FLEET_MONITOR_ALLOWED_LOCATION_IDS=cccccccc-dddd-4eee-8fff-000000000002`  
   (CAL-COMP and any other active zones must not be listed.)
6. `EES_FLEET_MONITOR_ENABLED=false` until each pulse; `EES_WEB_PUSH_TEST_ENABLED=false`.
7. Re-run readiness: `npx tsx scripts/prepare-staging-pilot-002-supervised-gps-readiness.ts`  
   and/or `npx tsx scripts/probe-ees-depot-gps-proximity-readonly.ts` — prefer a GPS-verified vehicle near the **depot** (not office).

## Exact pulse window

1. Run Next against **staging env only** (never production Supabase URL).
2. Owner authorises a short window. Set `EES_FLEET_MONITOR_ENABLED=true` for that process only.
3. One `GET /api/internal/fleet-monitor` with `Authorization: Bearer <EES_FLEET_MONITOR_SECRET>`.
4. Immediately set `EES_FLEET_MONITOR_ENABLED=false`.
5. Repeat only as needed for entry dwell (≥60 s continuous verified samples) and later exit dwell.
6. No cron. No push delivery. No Forth API writes. No commit/deploy.

## Pass criteria

| Check | Expect |
| --- | --- |
| Arrival | One `ees_fleet_visit_events` arrival for `forth:<deviceId>` at depot location id |
| Evidence | `verified_forth_gps`; Forth lat/lng/timestamps preserved |
| Departure | One departure when exit dwell completes |
| Outbox | One intent per event, `push_disabled` / delivery off |
| Idempotency | Repeat pulse does not duplicate `event_key` |
| Restriction | Only allowlisted depot zone evaluated; CAL-COMP excluded |
| Separation | No office 1708908 zone; synthetic `staging:synthetic:*` rows untouched |

## Fail / abort

Production Supabase URL, empty location allowlist, fabricated GPS, push delivery on, cron on, or office used as depot centre.
