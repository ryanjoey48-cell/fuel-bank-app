# Fleet Tracking V12 — Forth Speed Intelligence

Owner-confirmed Forth device speed-alert settings integrated into EES Fleet Tracking. Forth remains read-only. Road legal limits are not invented.

## Owner-reported device groups (2026-10-28)

| Group | Threshold | Delay | Working max | Idling max | Power-save park | Count |
| --- | --- | --- | --- | --- | --- | --- |
| A | 70 km/h | 10 s | 8 h | 15 min | 12 h | 10 |
| B | 90 km/h | 0 s | not established | not established | 12 h | 11 |

Source label: `owner_forth_console`. Verification: `owner_reported`. This is **not** an independent API verification of every device.

## Evidence model

| Kind | Meaning |
| --- | --- |
| `current_reading` | Live Forth speed only |
| `threshold_exceedance` | GPS-verified driving ≥ owner-reported device alert |
| `confirmed_device_overspeed` | Requires Forth event records — **not** inferred from polls or delay alone |
| `legal_road_violation` | Requires a verified road-limit source — **not implemented** |

Group A: a single snapshot above 70 km/h does **not** prove the 10-second delay elapsed.  
Group B: 0-second delay does **not** by itself confirm a recorded Forth alert.

## Forth API findings (read-only research)

| Endpoint | Contract | EES status |
| --- | --- | --- |
| Live tracking feed | In use | Speed, GPS quality, engine — no device alert settings |
| `POST /api/vehicle/speedOverLimits` | Swagger: `boxIds`, dates, `seconds`; returns overspeed windows | Entitlement/semantics unverified; **not called** |
| Device speed-alert configuration | Not exposed in reviewed live feed | Owner console values maintained in EES catalogue |
| Notification history | Swagger exists | Side effects / auth unverified; **not called** |

Catalogue: `lib/forth-speed-config.ts` (`FORTH_SPEED_CONFIG_VERSION`). Office UI: Speed settings panel (`business:read` view, `business:write` approve/modify).

Working / idling / power-save values are stored for future intelligence and are **not** alerted until event semantics are validated.

## V12.1 shared configuration audit

| Item | Detail |
| --- | --- |
| Migration | `supabase/migrations/20261029100000_forth_speed_config_audit.sql` |
| Rollback | `supabase/rollback/20261029100000_forth_speed_config_audit_rollback.sql` |
| Tables | `forth_speed_config_reviews` (current office state), `forth_speed_config_audit` (append-only) |
| Read | Active office `admin` / `office_staff` / `read_only` |
| Write | Active office `admin` / `office_staff` only (`business:write`) |
| API | `GET/POST /api/admin/forth-tracking/speed-config` |
| Owner catalogue | Remains in code; office review never sets `independently_verified=true` without a future verified device source |
| Forth | Read-only; EES reviews do not change tracker settings |

**Deploy step required before shared approvals work:** apply the migration in Supabase (owner/admin approval). Until then the API returns the owner catalogue read-only with `migrationApplied: false`.
