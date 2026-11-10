# Forth historical journey playback: security and audit (V4.3)

## Permission architecture
- Historical vehicle locations need a dedicated permission, `fleet:history_playback`, checked on the server after the existing `business:read` check. `business:read` alone is not enough.
- Granted by role to `super_admin` and `admin` only. `office_staff` and `read_only` do not have it.
- Per-person grants: `FORTH_HISTORY_PLAYBACK_ALLOWED_USER_IDS` (comma-separated user IDs, max 25). **Not set.** An allowlisted user still needs a valid, active office account.
- Denial message (no coordinates, no internals): "Historical journey access needs explicit authorisation. Ask an administrator."
- Both history routes (playback points, journey reports) use the same decision (`lib/forth-playback-access.ts`).
- The server-side gate (`lib/forth-history-live-gate.ts`) is separate and still applies: closed by default; the supervised flag never opens in production. Local `.env.local` holds only the approved `FORTH_HISTORY_SUPERVISED_SESSION=1`. No office or production flag is set.

## Audit trail (current)
- Every request records: correlation ID (also returned as `X-Correlation-Id`), time (UTC and Bangkok), user ID, role, access basis, action, outcome, reason, HTTP status, device ID, date, requested window, observation **count**.
- Never recorded: tokens, credentials, request bodies, addresses, coordinates or per-point history. Events are built from a fixed allowlist with validation.
- Storage today is **not durable**: a server log line (`forth_history_audit`) plus a 300-event in-memory ring, cleared on restart and not shared between instances. Administrators can read it at `GET /api/admin/forth-tracking/history/audit` (response says `durable: false`).

## Persistence blocker and approval gate
Durable logging needs a new table, i.e. a database migration. The review-only schema is in `docs/forth-playback-audit-schema-review-only.sql` (ends in ROLLBACK, never applied). **Until the owner approves and applies it, access stays limited to administrators under supervised local use; the allowlist and office-wide access remain blocked, and production stays off.**

## Remaining limitations
1. Audit is non-durable (above). Server logs may be the only record after a restart.
2. Allowlist is by environment variable, which needs a redeploy to change and is blocked by policy until durable audit exists.
3. Playback payload still contains coordinates for the authorised user by design; the map shows them to whoever holds the permission.
4. Rate limiting is per-process, not shared.
5. Forth gives one day per request; there is no multi-day playback.
6. All of ฒอ-8453's positions are provider-labelled "No GPS": the trail is reported position, never verified GPS.

## GO / NO-GO
- Administrators, supervised local use: **GO**.
- Wider office / read-only / allowlisted staff: **NO-GO** until durable audit is approved and applied.
- Production: **NO-GO** (flag not set; supervised mode cannot open in production).
