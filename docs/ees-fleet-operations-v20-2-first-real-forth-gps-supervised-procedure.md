# EES V20.2 — first supervised real Forth GPS acceptance (staging only)

**Status:** Prepared — **not authorised to activate** until owner word.  
**Staging:** `wpmnjfncaoogssgpqxek`  
**Production (never):** `hafoaurzfgkkwpvzedvd`  
**Readiness probe:** `output/v20-2-first-real-forth-gps-pilot-readiness.json`  
**Synthetic baseline (not a real visit):** `output/v20-2-staging-calcomp-synthetic-pilot-report.json`

## Hard safety rules

1. Forth is **read-only**. No Forth write endpoints.
2. Monitor must target **staging Supabase only**. `.env.local` is production — do not use it as the monitor DB target.
3. Keep `EES_WEB_PUSH_TEST_ENABLED=false` and outbox `deliveryEnabled=false` (code already hard-codes false).
4. No cron / Vercel schedule. One manual `GET /api/internal/fleet-monitor` at a time.
5. Do not invent GPS points or move trucks into the CAL-COMP zone.
6. Synthetic rows use `vehicle_key` prefix `staging:synthetic:*`. Real Forth rows use `forth:<deviceId>`. Do not delete synthetic history unless owner asks; filter reports by prefix.

## Current readiness (from read-only probe)

| Item | Result |
| --- | --- |
| Forth feed | Connected |
| GPS-verified vehicles | 6 of 21 |
| Inside CAL-COMP 150 m | **0** |
| Within 5 km | **0** |
| Nearest verified | ~115 km (`701-5145`) |
| Staging CAL-COMP zone | Active, 150 m provisional, pin confirmed, verified |
| Monitor secret (≥32) on staging env | **Not ready** |
| Forth keys on `.env.staging.local` | **Missing** (present on `.env.local` only) |

**Do not activate yet** while no verified vehicle is near CAL-COMP and env merge/secret blockers remain.

## Required configuration (before activation)

1. Generate a staging-only `EES_FLEET_MONITOR_SECRET` (≥32 random chars); store only in `.env.staging.local` (gitignored).
2. Copy **Forth read credentials** into the staging runtime env without changing `NEXT_PUBLIC_SUPABASE_URL` away from `wpmnjfncaoogssgpqxek`:
   - `FORTH_CLIENT_ID`, `FORTH_CLIENT_SECRET`, `FORTH_USERNAME`, `FORTH_PASSWORD`
   - `FORTH_TOKEN_REQUEST_PROFILE=oauth-password-basic-v1`
   - `FORTH_SOURCE_TIME_ZONE` (same as production Forth config)
3. Confirm flags for the supervised process only:
   - `EES_FLEET_MONITOR_ENABLED=false` until the exact activation minute
   - `EES_WEB_PUSH_TEST_ENABLED=false` always for this test
4. Re-run: `npx tsx scripts/probe-forth-gps-readiness-readonly.ts`  
   Proceed only when a GPS-verified vehicle is inside/near CAL-COMP **or** owner explicitly accepts a wait/watch session.

## Exact supervised activation procedure

Owner must authorise each step.

### A. Pre-flight (same day)

1. `node scripts/assert-staging-sql-target.cjs --env-file=.env.staging.local`
2. Re-run Forth readiness probe; record nearest registration, distance, `sourceAt`.
3. Confirm staging CAL-COMP still: verified + active + pin + `radius_meters=150`.
4. Confirm `forth:%` visit event count baseline (expect 0 before first real arrival).
5. Start Next **with staging env only** (no production URL), e.g. load `.env.staging.local` + Forth keys, never `.env.local` Supabase URL.

### B. Watch for natural presence

1. Poll readiness probe periodically (read-only).
2. When a verified vehicle is **inside 150 m** (or owner accepts watching entry dwell from approach), continue.
3. If none appear, **stop** — do not force coordinates.

### C. Single monitor pulse (owner-authorised)

1. Set `EES_FLEET_MONITOR_ENABLED=true` **only in the staging process env**.
2. Call once:

```http
GET /api/internal/fleet-monitor
Authorization: Bearer <staging EES_FLEET_MONITOR_SECRET>
```

3. Immediately set `EES_FLEET_MONITOR_ENABLED=false` again.
4. Lease: RPC `acquire_ees_fleet_monitor_lease` (180 s) then release — concurrent pulses should skip.

### D. Acceptance checks after pulses

Repeat pulses only as needed to cover entry dwell (≥60 s continuous verified samples) and later exit dwell — still manual, still staging-only.

Expect for one real visit (`vehicle_key` = `forth:<deviceId>`):

| Evidence | Expect |
| --- | --- |
| Arrival | Exactly **one** `ees_fleet_visit_events` row `event_type=arrival`, evidence `verified_forth_gps` |
| Departure | Exactly **one** departure when exit dwell completes with verified GPS |
| Outbox | One intent per event, `status=push_disabled`, `delivery_enabled=false` |
| Idempotency | Repeat pulse must not duplicate `event_key` |
| Synthetic | Existing `staging:synthetic:*` rows unchanged / clearly separable |

### E. Abort conditions

- Any process using production Supabase URL
- Monitor enabled outside the supervised window
- Push/VAPID delivery enabled
- Attempt to fabricate GPS or edit Forth
- Cron / deploy / commit without approval

## Recommendation

Keep **CAL-COMP** as the first live pilot site (owner-approved, staging zone ready).  
**Today’s snapshot:** no eligible vehicle near the site — wait for a real dispatch to Khao Yoi / CAL-COMP rather than switching sites without owner nomination of another verified staging location.
