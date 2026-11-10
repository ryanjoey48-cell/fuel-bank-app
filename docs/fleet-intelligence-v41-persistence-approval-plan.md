# Fleet Intelligence persistence: approval plan (nothing executed)

6 November 2026. This is a decision document. `docs/fleet-intelligence-schema-review-only.sql` (revision 2, ends in `ROLLBACK`) was **not run and not changed**. No table, job, schedule, cache store or confirmation write exists or is approved.

## What exists today (local only)

- Provider day reports live in server memory for 30 minutes per signed-in user (`lib/fleet-intelligence-session.ts`). V4.1 shows stored/expiry times, makes repeat reads idempotent (served from memory, no new Forth request) and adds an explicit `refresh=1`. A failed refresh never overwrites the cached day. Memory is lost on restart or on a second server instance.
- Office decisions in the review panel are held in browser state and cleared on reload.
- Everything else is read from existing Fuel Logs, Weekly Mileage, Booking Diary and the live Forth fleet, and computed on request.

## What must be stored, and where revision 2 already provides for it

(Table names checked in the file; columns reviewed for `device_mapping`, `provider_report_row`, `source_snapshot`, `odometer_checkpoint`, `odometer_interval`, `mileage_comparison` and the first lines of the file.)

| Need | Revision 2 table(s) | Gap to settle before approval |
|---|---|---|
| Raw report/segment evidence, header/Total/segment separation, open end, semantic hash | `source_request`, `provider_report_row` | request idempotency key `(device, day, endpoint, language)` and a "current revision" rule so a refresh adds a revision and never edits history |
| Vehicle-day source totals and coverage | `reporting_snapshot` (and `calculation_run`) | define the vehicle-day row: provider total, reconciliation status, open-segment flag, coverage status, source request ids, algorithm version |
| Source reconciliation | `odometer_checkpoint`, `odometer_interval`, `mileage_comparison` | already holds period precision (`instant`/`day`/`uncertain`) and observation vs entry time |
| Booking snapshots | `source_snapshot` (booking_diary) | store the exact booking row hash that a decision relied on |
| Job candidates and allocation decisions | `job_match`, `allocation_decision` | bind to booking snapshot, calculation run, authenticated reviewer; one active decision per provider segment |
| Human approvals and audit | `allocation_decision` revision chain | append-only audit of confirm / reject / needs-review with reason and previous decision |
| Retry and refresh orchestration | `sync_window`, `provider_budget` | operator-triggered only at first; fenced leases and a shared provider budget required before any scheduler |
| Device and vehicle identity over time | `device_mapping` | `UNIQUE (device_id, valid_from)` is insufficient: overlap exclusion on both device and vehicle (needs `btree_gist`, not installed) |

## Decisions needed from management

1. **Approve an isolated staging database** to validate revision 2 first. No production schema change until that passes.
2. **Segment-level job allocation as the confirmation unit.** The review UI lets an officer assign provider report segments to a job. Confirm that this (and not whole-day assignment) is the business rule, and who may confirm (roles).
3. **Retention.** Separate periods for raw log payloads (precise locations, restricted), provider report rows, calculated totals, booking snapshots and the review audit; legal-hold handling.
4. **Access control.** Server-side only, no browser grants, caller's authorisation checked per request, audit rows visible to office/management roles only.
5. **Refresh policy.** Operator-triggered reads only, with a per-day refresh control and visible stored/expiry times; no scheduled backfill until Forth confirms rate limits and retention.
6. **Day acceptance rule.** A vehicle-day is "complete" only when the report reconciles, has no open segment and coverage is verified (depends on Forth's answers); otherwise it stays "unresolved" and is never forced to balance.
7. **Which source is authoritative per claim.** Fuel Logs and Weekly Mileage stay authoritative for their own readings; provider totals stay provider-reported; none overrides another.

## Rollout order (each step needs its own approval)

1. Staging schema validation, backup and restore drill, rollback tested.
2. Server-side write path for **provider evidence only** (read-only for office), operator-triggered.
3. Reconciliation snapshots (derived, recalculable).
4. Job confirmations with the audit chain, behind a role check.
5. Only then consider scheduled ingestion, after Forth answers the retention and rate-limit questions.

## Risks if skipped

Without persistence, vehicle-day evidence disappears after 30 minutes or on restart, job confirmations cannot be saved, and a weekly or monthly total can only cover the days an officer read in that session. The reports label this ("partial", "n of N vehicles").
