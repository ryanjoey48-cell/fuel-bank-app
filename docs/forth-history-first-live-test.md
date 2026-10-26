# First Forth Journey History test — preparation only

## Phase 6 — updated administrator access and execution plan

### Owner-invoked adapter prepared (offline)

`lib/forth-history-owner-test.ts` now supplies the fixed-scope Method A callable.
It reuses the existing EES bearer verification, active office access and
`business:read` checks, current Forth fleet service and bounded Trips service.
It requires a trusted caller-supplied approval decision for the named operator
and environment; that decision must be based on reviewed account entitlement,
read-only evidence and the owner's separate one-request authorization. Source
code cannot establish those facts from a nonempty reference or boolean alone.
The adapter resolves `3ฒน-9565` uniquely to one current device, fixes the day
to 24 October 2026, rejects missing or mismatched returned boxIds, omits driver
names and leaves time/duration strings uninterpreted. It claims its sole attempt
before calling the existing service and does not retry, even after a timeout.
This is **process-local** single-use only. It has no route, CLI, schedule or
connection to the disabled ordinary history gate. The older durable-grant runner
remains dormant and separate.

This worktree has no `.env.local`, `.env.development.local` or linked Vercel
project file, and the required Forth/Supabase variables are absent from this
process (checked by name/presence only). An approved server-side process with
those existing settings and a secure operator bearer token has not been
identified. The known protected Vercel Preview has assigned variables, but
that alone does not provide an owner-invoked process entrypoint or verify
report permission. Do not copy credentials into this worktree. Once the owner
selects an approved isolated environment, bind its trusted invocation and
approval check to this adapter for review; do not add a generally accessible
HTTP route simply to run the one diagnostic.

The owner confirms full administrative access to the EES Forth console. This
allows inspection of account evidence; it does not establish the permissions
of the separate API client and service user. Preserve the earlier work and keep
the history source gate disabled.

### Evidence to inspect in the existing account

Exact console menu names have not been verified. Inspect the settings or account
documents corresponding to the following items without changing permissions or
displaying secrets:

| Item | Required evidence |
| --- | --- |
| Existing Open API application/client and associated API user | The credentials used by EES belong to this company account, are active, and have historical reporting entitlement; console administrator status alone is insufficient. |
| API roles, scopes or report entitlement, if exposed | Access to `POST /api/vehicle/trips` (`Reports_GetTrips`), or a documented reporting scope explicitly including it. Merely seeing a console Reports menu is insufficient. |
| API vehicle/group access | The API user/client may read the device currently and uniquely associated with `3ฒน-9565`. Revalidate the actual device immediately before execution. |
| API agreement, service order or API onboarding document | Historical report retrieval is included for this account, with any approval requirements, restrictions, fees and limits identified. |
| Endpoint manual or account-specific API documentation | Trips is a retrieval/report operation that does not create or change trips, vehicle settings, mileage or other operational records. Ordinary access logging may still occur. |
| Supplied Swagger `paths[/api/vehicle/trips].post` | `Reports_GetTrips`, `VehicleStandardParams` and `Trips` confirm schema and report intent. They do not supply account permissions or a side-effect guarantee. Do not click Execute/Try it out. |

Retain only redacted entitlement text, relevant agreement/manual sections and
the administrator's confirmation of which existing API identity they cover.
Do not copy client secrets, passwords, tokens or the private device ID into Git
or chat. If these records explicitly establish entitlement and read-only
semantics, the owner can record that evidence as the account administrator;
separate provider confirmation is not an automatic extra gate. If either point
is absent or ambiguous, ask Forth only: "Does our existing EES Open API client
and API user have permission for POST /api/vehicle/trips, and is this report
retrieval read-only with respect to operational records? Does our agreement
require any additional approval for one device/day test?" No report request is
needed to ask or inspect these facts.

### Minimum next implementation and execution

1. Select an approved isolated execution environment with access to existing
   server-held credentials and the real EES authentication helpers. Availability
   of such an environment remains unverified; do not copy Production credentials
   locally or create a permanent test endpoint to work around this.
2. Complete one small executable adapter reusing the existing service/parser:
   verify the named EES operator and `business:read`, resolve exactly one current
   registration/device association, fix the report day to `20261024`, invoke the
   fixed Trips service once, retain its timeout/size limits, and capture actual
   upstream status plus sanitized validation output. Add offline tests for those
   bindings. Keep all output transient and omit driver names. No UI rebuild,
   migration or history gate change is required.
3. Review that adapter and the account evidence. The owner then authorizes one
   attempt by the named operator, in the named environment, for `3ฒน-9565` on
   24 October 2026, with no retries. Preparation approval does not authorize it.
4. Execute once only after that approval. Inspect status, array shape, matching
   boxIds, optional fields, raw origins/destinations and source time/duration
   strings. A 200 response does not establish timezone or duration units. An
   empty array is a valid empty report, not proof of no movement on that day.
5. Close the isolated process, revoke temporary operator access if any, and
   discard transient response data. Keep ordinary Journey History disabled
   until the response and operational access design are reviewed.

Method A has one report attempt per invocation, not a global one-use guarantee
against another deliberate launch. The owner must accept this controlled manual
procedure; otherwise Method B and its separately approved durable atomic store
are necessary. The dormant Phase 4 runner remains disconnected and is not a
finished executable adapter. No historical request is authorized by this plan.

## Phase 4 runner preparation

`lib/forth-history-controlled-test.ts` now implements the dormant orchestration
core with injected dependencies and no route or live-service binding. It rejects
non-Preview context, wrong operator/deployment, missing approval references,
expired grants, wrong date and ambiguous registration/device associations before
consuming the grant. It never restores a consumed grant or retries a failed call.
The existing history panel/parser can display returned sanitized raw records;
the runner is not connected to that panel.

The concurrency test uses a synthetic atomic store double. It proves the runner
obeys the store result, not that distributed enforcement is deployed. A real
durable atomic store, trusted Preview context, verified-user/business permission
adapter and owner-only invocation surface still need implementation and review.
Only trusted owner tooling may create grants after checking approval evidence;
nonempty reference strings alone are not proof of approval. No store, migration,
credential or environment change is included. The existing report service must
be reused to retain its timeout and response bounds. Its normalized error status
is not necessarily the upstream HTTP status; exact status capture must be added
to the private test adapter before execution, without logging response bodies.

The simplest way to establish provider permission is written confirmation from
Forth support or the authorised account administrator for this account and
`POST /api/vehicle/trips`, including read-only semantics. Do not probe the endpoint
to establish permission. After provider confirmation, obtain explicit approval
for one attempt by the named EES operator for the selected registration/date.
Revalidate the device in the live fleet at execution, atomically consume the
approved grant, inspect sanitized output, then revoke operator access and any
unused grants. Keep the general history source gate disabled throughout.

## Phase 5 method decision

For this single diagnostic, prefer **A: one owner-invoked process** in an
approved, isolated server environment that already has access to the existing
server-held Forth credentials. Before the report call, it must verify the named
operator's EES identity and `business:read` permission through trusted server
code, re-fetch the authorized fleet, and confirm the registration and device
uniquely identify the same record. The operator invokes it once, with one fixed
device/day request and no client, HTTP or job retries. Close the environment and
discard transient output afterward. This needs a small reviewed adapter for
trusted authentication, existing Forth service binding and sanitized status
capture; no general history route or persistent grant store is needed. The
current dormant controlled runner is not wired to this method and must not be
treated as the executable test.

No suitable isolated execution environment has yet been verified. Local build
success does not establish credential availability. Method A is conditional on
an approved environment with existing secure credentials and real EES permission
verification; it does not authorise copying Production credentials locally.

Method A avoids a Preview deployment, database migration and ongoing storage
cost. Its limitation is procedural: a second deliberate process launch can send
a second request. If the owner requires an enforceable global one-use guarantee,
choose **B: a protected Preview route with a shared durable atomic claim**.
That route must bind an approved operator, device, registration, day and expiry,
consume the claim before the upstream call and deny subsequent invocations
across all function instances. It adds deployment, store and review work; a
process-local flag or the rejected environment switch cannot provide this
guarantee. Do not implement B solely for this diagnostic without that requirement.

The minimal approval evidence is confirmation from the Forth account
administrator that this EES account may call the Trips report and that the
operation is read-only under the account's API agreement. If the administrator
cannot confirm the agreement or permissions, obtain written confirmation from
Forth. Separately, the EES owner must name the operator and explicitly approve
one request for `3ฒน-9565` on `2026-10-24` after reviewing the exact runner.
Do not use Swagger or nonempty approval-reference strings as proof of either
decision. A failed or timed-out attempt requires fresh owner authorization.

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

If method B is selected, use a reviewed, owner-invoked server-side runner in a
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
