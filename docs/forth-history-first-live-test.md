# First Forth Journey History test — preparation only

The source history gate remains `false`. The Preview scope parser in
`lib/forth-history-preview-test.ts` is intentionally not connected to the route.
The previously rejected environment-controlled activation must not be wired in
or deployed. No historical Forth request has run.

## Evidence and unresolved permissions

The supplied Swagger defines `POST /api/vehicle/trips` as a Reports operation
with required `boxIds`, `startDate`, `endDate` and optional `language`. It returns
an array of `Trips` strings. The name and schema indicate a retrieval report,
but the document has no security definition, permission list, side-effect
guarantee, retention/rate limits, error model, or timestamp timezone. Only HTTP
200 is documented. Existing EES code uses the server-side bearer token and a
fixed report URL; whether this account can call the report is untested.

## Proposed exact bound

- Registration to investigate: `3ฒน-9565`. This is a proposed label, not a
  verified registration-to-device match.
- Report day: `2026-10-24`. Records for that day are not guaranteed.
- Forth request: `POST /api/vehicle/trips` with `boxIds` set to the one confirmed
  Forth device ID (withheld here), `startDate: "20261024"`,
  `endDate: "20261024"`, `language: "en"`.
- The existing protected EES route must first see that device exactly once in
  the current authorized Forth feed and confirm the proposed registration also
  identifies that same one device. An EES vehicle association must be reviewed
  separately; a shared or missing registration cannot be silently accepted.

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

For the first attempt, prefer a reviewed one-shot, server-side operator runner
in a restricted Preview environment, with an exact device/date assertion, one
`fetch` call, no automatic retries, no browser-exposed Forth token and no public
history route activation. It needs a separate implementation and security review;
none is included in this preparation commit. If an EES Preview route is required
instead, first design and approve a shared atomic single-use claim with expiry.
A process-local flag or environment-only switch cannot reliably enforce one
request across Vercel function instances. The durable claim would require
separately approved infrastructure and writes; none are made here.

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
