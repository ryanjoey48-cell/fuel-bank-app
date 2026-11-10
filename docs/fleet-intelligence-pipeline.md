# Fleet Intelligence pipeline: stage 1 review package

4 November 2026, Asia/Bangkok. Local implementation only. No live ingestion, scheduling, schema application or deployment has occurred. The owner will perform live testing and office confirmation.

## Review decision

Accept the audit's conservative boundaries for implementation. Do **not** treat its contract inventory as verified live entitlement or approve all audit conclusions as facts. Prior localhost/browser validation was incomplete. No real vehicle-day, historical report comparison, measured fuel result or human-confirmed job match has been established in this stage.

The implementation is ready for code/schema review and offline testing. Production enablement is not ready. This document and the adjacent `fleet-intelligence-schema-review-only.sql` are the concrete proposal for approval before implementing a production persistence adapter.

## Implemented architecture

1. `fleet-intelligence-forth-source.ts`: server-only binding to existing fixed Forth GET log service. Reuses server-held authentication, timeout and bounded response reader. Existing history gate is checked for authorization and retrieval. Trusted caller must verify office permissions and effective-dated vehicle mapping; the current Forth feed must contain exactly one matching device. No credential output, URL overrides, relay/trip commands or provider writes. Authorization is consumed for one exact window. No public route or scheduler is installed.
2. `fleet-intelligence-sync.ts`: bounded one-device windows, retention/future checks, provider contract references, shared-budget/lease interface, row/byte/page caps, deduplication and transactional commit/checkpoint contract. Errors are sanitized; automatic retries are absent. Pagination is supported only through an injected verified adapter and shared budget on every additional page. Forth log pagination is **not known** and its adapter rejects cursors. Unknown truncation leaves the sync incomplete even after HTTP 200. The planner splits at Bangkok midnight and overlaps other windows for reconciliation.
3. `fleet-intelligence.ts`: deterministic daily intervals, source evidence links, conditional counter differences, GPS chord estimates, observed/unknown coverage, state segments and exactly-once interval allocation. Policy is included in output with algorithm version.
4. `fleet-intelligence-ees-source.ts`: bounded `SELECT` snapshots of Booking Diary, fuel purchases and odometer checkpoints. Uses a trusted user-scoped client and authorization callback. Stable vehicle ID takes priority when the selected source schema supports it; otherwise registration-only identity remains explicit. Historical registration aliases must be supplied from reviewed mapping. More than 500 source rows fails closed. Odometer reads retry only on recognized missing-column errors, report the selected column capability, and retain unsupported baseline/full-tank fields as unknown. Existing browser `lib/data.ts` mutation helpers are not imported.
5. `fleet-intelligence-operations.ts`: ranked job suggestions and separate purchase/consumption evidence by fuel kind. All job suggestions require office confirmation. No bookings or fuel rows are changed.
6. `fleet-intelligence-report.ts`: reconciled fleet scopes and per-job observed distance; numeric totals remain unrounded. Measured and estimated fuel totals stay separate. Missing values remain null; report counts disclose missing consumption. CSV escapes spreadsheet formulas and requires reconciliation first.
7. `scripts/fleet-intelligence-preview.cjs`: offline review command. Reads one local input up to 1 MB and creates a new JSON report. Does not load environment files, authenticate, make provider requests or connect to a database. Existing output files are never overwritten. Reports expressly say input authenticity has not been verified.

## Distance and state rules

- A Bangkok day is `[00:00, next 00:00)` using UTC+07:00. Timestamps are retained raw and as UTC. Explicit invalid dates are rejected.
- Default analytical policy: at most 300 seconds between samples, at most 150 km/h implied jump, movement threshold 5 km/h and stationary radius 20 m. These are conservative calculation defaults, **not provider limits or legal speed limits**. They need tuning against real device sampling and operating conditions.
- Only valid coordinates, connected GPS and explicit GPS source quality support derived distance. Reported trails, Wi-Fi, LBS and unknown sources are excluded.
- Exact repeated evidence IDs deduplicate. Different revisions at the same timestamp conflict; no averaging or silent last-write-wins correction.
- A gap, unverified endpoint, unrealistic jump or unresolved counter reset has null distance. Leading/trailing missing periods are explicit intervals. Invalid timestamp counts are retained.
- `Distance` is not interpreted unless a reviewed counter policy supplies its unit conversion and evidence reference. Negative/reset, implausible or geometrically inconsistent deltas are unknown. No reset bridging.
- GPS fallback sums straight-line chords between accepted observations. It can undercount road curvature. Low-speed stationary jitter is suppressed. Output remains `derived_with_conditions`, including when samples cover the full day.
- Cross-midnight segments without an exact boundary point are unknown; there is no linear distance proration. The Forth same-date API request ends at 23:59:59, so missing midnight coverage stays visible. Planner windows crossing dates are split.
- Moving/stopped/idling/unknown describe **inferred intervals**, not exact event timestamps. Idling requires stationary samples and engine-on at both ends; no engine signal produces unknown. Unavailable intervals are separate from observed intervals with unknown activity.
- `daily.complete` means temporal sample coverage under the configured policy with no invalid timestamp; it does **not** assert every road kilometre is known. CSV explicitly calls this sample coverage.

## Booking and allocation evidence

Actual inspected Booking Diary fields: `id`, `booking_date`, `pickup_time`, `vehicle_id`, `vehicle`, `vehicle_registration`, `driver_id`, `job_order_number`, `pickup_lat`, `pickup_lng`, `dropoff_lat`, `dropoff_lng`, `route_confirmation_status`, `updated_at`.

Pickup time is not a verified delivery/completion time. Existing route distance/duration estimates are not measured GPS distance. `driver_id` alone does not prove who drove. The source adapter returns snapshots rather than inventing a job completion window or confirmed driver.

The ranker accepts reviewed job windows and ordered stops. Scoring: stable ID 40 (registration-only 20), overlapping time 20, confirmed driver 10, work order 10, all ordered stops within 150 m 20. Scores are evidence weights, not probabilities. Contradictory stable IDs reject a candidate. Multi-stop and overlapping candidates remain separate suggestions; no winner is auto-confirmed.

Allocation needs reviewer identity and evidence reference. Each observed interval receives at most one allocation: depot, job or repositioning. Competing decisions remain unassigned. Empty travel is not automatically repositioning just because no booking matched. Multi-job sharing must be reviewed with interval boundaries; do not allocate the same interval to each job. Unmatched/ambiguous kilometres remain unassigned.

After corrections, create a new calculation run and re-review affected allocations. Retain old decisions; never silently reuse a confirmation against changed evidence. A production implementation must bind confirmed job IDs to the exact reviewed booking snapshot and current calculation run; the pure calculator does not authenticate reviewer strings.

## Fuel audit and boundaries

Inspected EES Fuel Log fields: `id`, `date`, `vehicle_reg`, `litres`, `total_cost`, `fuel_type`, `odometer`, `created_at`; `receipt_checked` is an optional source capability. The 3 November 2026 deployed source did not support `full_tank_confirmed`, so full-tank status stays unknown. The odometer adapter selects compatible column variants and exposes the columns used. Fuel Log rows are purchase/source-quality evidence, not automatically consumed litres. `created_at` is entry time, not odometer observation time.

Weekly Mileage uses `week_ending` as a date-only proxy, never as an exact observation timestamp. When the selected source does not expose `is_odometer_baseline`, its status remains unknown and the corresponding checkpoint interval is withheld rather than treating the reading as non-baseline. No existing maintenance or weekly-mileage value is corrected or written.

Forth parser fields include `Fuel`, `Sensor1`, `Sensor2`, `Sensor3`; no verified sensor installation, calibration or consumption units exist in the reviewed runtime evidence. Raw allowlisted values may be retained for review but cannot automatically feed consumption.

The new calculator separates diesel, petrol and LPG. Existing fuel subtypes must be reviewed/mapped before being supplied; unknown types must not default to diesel. A measured consumption input requires source evidence. An estimate requires matching vehicle/day/fuel, validated vehicle-specific km/L, distance and reference; litres must equal that distance divided by km/L. The trusted adapter must verify efficiency validity dates, fuel type and period coverage before accepting such evidence.

Purchase cost and consumed-fuel cost remain separate. Consumption valuation requires a reviewed unit-price reference; today's purchase price is not applied implicitly. Competing consumption inputs withhold a result. Vehicle/job costing and km/L must stay unavailable when compatible distance, fuel, period or cost evidence is missing. Customer costing needs confirmed job/customer links and an approved cost-allocation policy.

Existing ฒอ-8453 rules are unchanged. `vehicle-financial-accounting-policy.ts` records January–July 2026 LPG included in Fuel and August onward LPG separate once. The new pipeline does not import, restate or rewrite those historical financial balances, and does not add historical Fuel and LPG amounts together. Historical aliases must resolve through the existing approved vehicle policy.

## Proposed storage and security

Review-only SQL creates a dedicated `fleet_intelligence` schema. It ends in `ROLLBACK` and is outside automatic migrations. No existing EES table, trigger or workflow is changed. All tables have RLS and no browser grants/policies.

Separate entities: effective-dated device mapping; sync windows/provider budget; immutable allowlisted raw observations and window membership; explicit revision resolutions; versioned calculation runs; intervals and journeys; job suggestions/reviews; allocation decisions; fuel evidence; reporting snapshots. Existing EES IDs are references, not cascading foreign keys or write targets. Raw revisions include hashes and received/source times; `IDCard`, `IDTransport`, driver names, secrets and arbitrary nested fields are not copied.

The production store is **not implemented or approved**. Its required transaction must atomically acquire account-wide provider budget and a fenced lease, insert raw revisions idempotently, commit the window manifest and derived revision, and checkpoint only after commit. Recover expired leases after crashes; reject stale workers. On 429, persist cooldown based on verified provider response; no retry storms. Durable cursor checkpoints are needed before enabling large paginated retrieval. SQL is a schema proposal, not proof those transaction semantics exist.

Before approving a migration: verify actual ID types/roles, mapping-overlap enforcement under serialized vehicle/device locks, SQL constraints, backup/restore, source retention/privacy and least-privilege service grants. Define operational raw/derived retention separately from the still-unverified provider history retention. A privileged store should have SELECT only on explicitly approved EES source columns and writes only within the intelligence schema.

## Verified stages and remaining gates

| Stage | Current evidence | Remaining acceptance |
|---|---|---|
| Source/contract review | Existing log gate, fixed GET client, exact EES columns and LPG policy inspected | Account entitlement, log limits/retention/time semantics and sensor contracts |
| Pure calculation/sync orchestration | Local automated tests, including a clearly synthetic full day | Real device sampling, counter units, corrections and outage comparisons |
| Schema proposal | Review-only SQL, rollback, no application | Explicit schema approval, isolated DB validation and production store implementation |
| Offline pilot tool | Local JSON pipeline and reconciled output | Operator's genuine vehicle-day and provenance review |
| Live pilot | Not run; owner will test | One device/day, Forth report comparison, human-confirmed real booking and fuel evidence |
| Production ingestion | Disabled; no route/cron/store | Approved schema/store/security, durable rate budget and recovery tests |
| Reports/UI/export | Pure JSON report and reconciled CSV function | Authenticated UI integration, validated live totals, printable PDF/XLSX and customer costing |

PDF/XLSX publication is deliberately staged after real reporting-total acceptance. CSV is currently a library export, not a public endpoint. No new report is presented as production-ready.

## Operator pilot procedure

1. Review the schema proposal and authorize an isolated storage implementation separately from production migration. Existing approval to implement code does not apply SQL.
2. Check the Forth account contract, existing gates and permitted source timezone. Choose one vehicle/day and verify unique effective-dated mapping. Do not copy credentials into input files or chat.
3. Retrieve only a permitted short window using the existing authenticated server surface. Confirm size/range/rate/retention before increasing to one day. An array ending early or HTTP 200 is not proof of complete history.
4. For offline calculation, create a private local JSON object with `vehicleId`, `deviceId`, `day` and `forthLog` (the actual Forth array). Optional `purchases`, `consumption`, `valuation`, `journeyCandidates`, `jobs` and `confirmedAllocations` use the exported TypeScript contracts. Never include tokens, full driver identities or card identifiers. The tool does not establish vehicle identity merely from these strings.
5. Run `npm run fleet:intelligence:preview -- INPUT.json NEW-OUTPUT.json`. Preview is raw-input review, not an ingestion/approval bypass. Keep files local and out of Git. An output already present causes failure rather than overwrite. `docs/fleet-intelligence-preview.synthetic.json` is a deliberately synthetic two-point example for learning the format; it is not real pilot evidence. Use `npm run test:fleet-intelligence` and `npm run check:fleet-intelligence` for the repeatable local checks.
6. Check daily observed km against timeline km and allocated+unassigned km. Inspect every unavailable period, source field and correction conflict. Compare with Forth's own historical report with units/timezone confirmed; record discrepancies instead of adjusting totals to match.
7. Review ranked candidates against the real Booking Diary row/work order and GPS stops. Record office confirmation outside the booking; in production it belongs in the separate job-match table. Confirmation must be tied to evidence/version, not an untrusted text field.
8. Review receipts/sensor calibration/validated efficiency. Purchased litres remain purchases; absent consumption stays unknown. Verify ฒอ-8453 historical policy is unchanged.
9. Before any production pilot, capture approved read-only baseline manifests (IDs, counts, updated timestamps and hashes) for the relevant business records and compare after. Code review/no configured write path supports isolation, but is not an independently captured before/after database proof.

## Safety evidence

New calculation modules have no database clients or network calls. EES source binding contains SELECT queries only. Forth source binding calls only current tracking and historical GET services. No app route imports the new pipeline; no environment flags, Supabase migration files, existing business modules or existing data were modified by this stage. No database query or Forth request was executed during this implementation. Live acceptance remains pending, not fabricated.
