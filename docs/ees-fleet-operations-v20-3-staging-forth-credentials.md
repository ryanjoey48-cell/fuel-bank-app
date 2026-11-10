# EES V20.3 — staging Forth credentials (read-only)

**Never commit secrets.** Use `.env.staging.local` (gitignored) from `.env.staging.example`.

## Minimum Forth keys for staging monitor/read probes

| Variable | Purpose |
| --- | --- |
| `FORTH_CLIENT_ID` | OAuth client id |
| `FORTH_CLIENT_SECRET` | OAuth client secret |
| `FORTH_USERNAME` | Tracking account username |
| `FORTH_PASSWORD` | Tracking account password |
| `FORTH_TOKEN_REQUEST_PROFILE` | Must be `oauth-password-basic-v1` |
| `FORTH_SOURCE_TIME_ZONE` | Same as authorised Forth ops config |

## Separation rules

1. Copy **Forth** read credentials into staging runtime only — **do not** copy production `NEXT_PUBLIC_SUPABASE_*` / `SUPABASE_SERVICE_ROLE_KEY` into the same file as a shortcut that overwrites staging.
2. Staging Supabase URL must remain `https://wpmnjfncaoogssgpqxek.supabase.co`.
3. Forth access is **read-only** via existing tracking/token endpoints used by `lib/forth-tracking-server.ts`. No device-setting writes, no Forth geofence edits.
4. Respect Forth rate limits: prefer intermittent readiness probes; no unattended high-frequency polling until owner approves.

## Monitor isolation (required with Forth)

Also set:

- `EES_APPROVED_STAGING_PROJECT_REF=wpmnjfncaoogssgpqxek`
- `EES_FLEET_MONITOR_ALLOWED_PROJECT_REF=wpmnjfncaoogssgpqxek`
- `EES_FLEET_MONITOR_ENABLED=false` until a supervised pulse
- `EES_FLEET_MONITOR_SECRET` ≥ 32 characters (staging-only)
- `EES_FLEET_MONITOR_ALLOWED_LOCATION_IDS=cccccccc-dddd-4eee-8fff-000000000002` (Pilot 002 depot only; fail-closed — empty allowlist refuses the monitor)

The fleet monitor refuses to run if the Supabase URL is production, the project refs mismatch, or the location allowlist is missing. CAL-COMP must stay off the supervised allowlist.

Prep helper (no activation): `npx tsx scripts/prepare-staging-pilot-002-supervised-gps-readiness.ts`
