# First Forth Journey History test — preparation only

The source history gate remains `false`. The Preview scope parser in
`lib/forth-history-preview-test.ts` is intentionally not connected to the route.
The previously rejected environment-controlled activation must not be wired in
or deployed. No historical Forth request has run.

## Evidence and unresolved permissions

The supplied Swagger defines `POST /api/vehicle/trips` as a Reports operation
with required `boxIds`, `startDate`, `endDate` and optional `language`. It returns
an array of `Trips` objects with optional string fields. The name and schema indicate a retrieval report,
but the document has no security definition, permission list, side-effect
guarantee, retention/rate limits, error model, or timestamp timezone. Only HTTP
200 is documented. Existing EES code uses the server-side bearer token and a
fixed report URL; whether this account can call the report is untested.

## Proposed exact bound

- Registration: `3ฒน-9565`. In the authenticated, protected V2 Preview on
  26 October 2026 at 15:31 GMT+7, the manually refreshed 21-record Forth feed
  showed one roster result for this registration and one for its displayed
  Forth device ID. The inspector showed a unique normalized EES registration
  match. The device ID is deliberately not stored in this document. This is
  current-feed UI evidence, not approval for a historical report.
- Report day: `2026-10-24`. Records for that day are not guaranteed.
- Forth request: `POST /api/vehicle/trips` with `boxIds` set to the one confirmed
  Forth device ID (withheld here), `startDate: "20261024"`,
  `endDate: "20261024"`, `language: "en"`.
- Before execution, the approved test mechanism must re-fetch the current
  authorized fleet, find exactly one record for the exact device ID and exactly
  one normalized match for the registration, and confirm both are the same
  record. The dormant EES route currently checks unique device ID but does not
  bind it to a nominated registration; that additional check is required in
  the separately reviewed test mechanism. A shared or missing registration
  cannot be silently accepted.

## Approval and activation sequence

These are three separate decisions; approval of one does not imply the others.

**A. Permission to prepare Preview-only test code.** Review a new, narrowly
scoped mechanism for the selected EES user, uniquely matched device and date.
Keep the current route disabled during that review. Do not connect the rejected
environment-only activation parser. Any proposed code must be tested offline for
unauthorized user, wrong device, wrong date, expiry and Production denial.

**B. Forth/account-owner confirmation.** Obtain written confirmation that this
account may call `POST /api/vehicle/trips` and that the operation is reporting
only and read-only. Confirm the bearer profile, rate limit and any cost or audit
effect. Swagger alone does not establish these permissions or guarantees.

**C. Explicit execution authorisation.** Only after A and B, obtain separate
approval for exactly one report for `3ฒน-9565` on `2026-10-24`. Resolve the
actual device ID uniquely from the current authorized Forth feed; do not guess
it or accept a duplicate or ambiguous registration/device match. Approve the
specific Preview deployment and operator before any request is sent.

For the first attempt, propose a reviewed, owner-invoked server-side runner in a
restricted Preview environment, with no public or generally accessible live
history route. It must verify the operator's EES session and `business:read`,
bind one approved operator, registration, freshly confirmed device and date,
and consume a short-lived, shared atomic single-use grant before one `fetch`.
No client or upstream retry is allowed: a timeout consumes the grant and needs
fresh explicit approval for another attempt. The runner must reuse server-only
credentials and the existing 10-second timeout and 1 MB response bound, then
return only sanitized validation metadata. The source history gate remains
`false` and the environment-controlled parser remains disconnected.

This runner and grant store need separate implementation, security review and
approval; none is included here. A process-local flag or environment-only
switch cannot reliably enforce one request across Vercel function instances.
The shared atomic grant needs separately approved infrastructure and writes;
no such writes or configuration changes are made in this task. If that cannot
be approved, do not execute the report through Vercel.

After the approved attempt, record only HTTP status, field names, row count,
null/missing field patterns, representative redacted time strings and response
size. Do not log credentials, raw driver names or full locations. Inspect whether
the returned `boxId` matches the requested ID, whether the response is empty or
malformed, and whether timezone or `routingTime` units can be established from
Forth. A 200 response alone proves neither interpretation nor complete data.
Revoke the one-shot access and keep the live route hard-disabled. Journey History
remains unavailable to general office users pending review of the findings.

If Forth returns a record without the selected `boxId` or with another device
ID, the EES route rejects the response. The route omits Forth `driver` text
from the browser response. Raw source date/time and `routingTime` strings remain
unconverted. Trip Details, Parking History, customer visits and route replay
require separate evidence and approval.

## Later reports and office rollout

The supplied Swagger also lists `POST /api/vehicle/tripDetails`,
`POST /api/vehicle/parkingTrip`,
`POST /api/vehicle/parkingEngineOverTheLimits`,
`POST /api/vehicle/accessLocations`,
`POST /api/vehicle/accessStartDestinationLocations`, and
`GET /api/log/{id}/{starttime}/{endtime}`. These paths are candidates only;
their permissions, response semantics, retention, units and read-only guarantees
need separate verification. They are not part of the first Trips test.

Journey History may become available to EES office staff only after a real
response validates identity, schema, missing-field behaviour, timestamps and
`routingTime` interpretation or an explicit raw/uninterpreted presentation.
Any office route must retain verified authentication, `business:read`, unique
device/registration checks, one-day bounds, no-store responses, response limits,
sanitized errors and manual requests without polling. Roll it out through a
separately reviewed Preview change first. Keep Forth history read-only and
separate from mileage, maintenance, Booking Diary and existing historical data.
