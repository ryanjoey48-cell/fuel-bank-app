# Fleet Intelligence V4: persistence review (documentation only)

5 November 2026. Nothing here was executed. `docs/fleet-intelligence-schema-review-only.sql` (revision 2, ends in `ROLLBACK`) is unchanged and unapplied. No storage, scheduler or ingestion is created or approved by V4.

## Current V4 behaviour (what is local only)

- **Nothing persists.** Provider days live in a per-user, 30-minute, in-memory cache (`lib/fleet-intelligence-session.ts`). A server restart or a different server instance forgets them. The mileage report therefore shows provider distance only for vehicle-days the operator read in that server session.
- **Job confirmations are not stored.** Job suggestions stay `confirmation_required`, `allocatedKm: null`. There is no office confirmation action, so no confirmation is claimed saved. Storage requirement: `job_match` and `allocation_decision` (below).
- Exceptions are computed on request from the sources; none are stored.

## Source reality (verified against the live EES project on 5 Nov 2026) versus the proposal

| Real finding | Where the revision-2 SQL stands |
|---|---|
| Fuel Logs deployed columns: `id, date, vehicle_reg, odometer, litres, total_cost, fuel_type, created_at`; no `full_tank_confirmed`, `receipt_checked`, `vehicle_id` | `source_snapshot.supported_columns` records capabilities; `odometer_checkpoint.full_tank_status` defaults to `unknown`, with `unsupported` available; `identity_status` supports `registration_only` and `ambiguous` |
| `date` and `week_ending` are date-only; `created_at` is entry time | `source_observation_date` + `observation_date_basis` (`reported_refuel_date`, `week_ending_proxy`) are separate from `entered_at`; nullable `observed_at` with earliest/latest bounds |
| Weekly Mileage baseline flag may be absent (`is_odometer_baseline`) | `is_baseline boolean` is nullable and commented as unknown, not "not a baseline" |
| Same-day identical odometer readings (ฒอ-8453 on 3 Nov: 615,524 twice) collapse into one checkpoint and produce no interval | `odometer_interval` requires distinct `from`/`to` checkpoints; status `unknown` withholds distance; `verified_zero` requires zero |
| Provider report: header, Total and segment rows; final end time `-` (open); no GPS coordinates | `provider_report_row.row_kind` separates header/segment/total; `end_at` nullable with `segment_state` closed/open; `semantic_hash` for idempotent identity; reconciliation comments forbid overlapping closed segments |
| Provider distance semantics are report-level (`sumDistance`), not a cumulative odometer | `distance_semantics` defaults to `provider_reported`; the raw log `distance_semantics` is `unknown` by default and requires a contract reference to be anything else |
| Different observation periods are not comparable | `mileage_comparison.period_precision` (`instant`, `day`, `uncertain`) and explicit period start/end |
| Duplicate registry registration (`3ฒล-4565`) | `odometer_checkpoint.identity_status = 'ambiguous'`; `vehicle_id` is `text` (no foreign key into EES tables) |
| Booking Diary lacks `route_confirmation_status` | `source_snapshot.supported_columns`; no mandatory column |

## Items that still need a decision before any approval (unchanged from the validation report, confirmed still relevant)

1. **Device and vehicle validity overlap.** `UNIQUE (device_id, valid_from)` alone is insufficient (file comment already requires serialized writers and the `btree_gist` extension for exclusion constraints on both device and vehicle). The extension is not installed or approved.
2. **Fenced durable commits and a shared provider budget.** The current store interface cannot reject an expired worker's commit; the in-memory rate limiter is per server process. Needed before any scheduled ingestion.
3. **Retention.** Raw precise-location payloads, provider report rows, calculated intervals, source snapshots and review audit need separate approved retention; `source_snapshot` has `retention_deadline` and `legal_hold` columns but no policy.
4. **Access control.** Browser grants must stay absent; reads only through server routes that call the existing office authorisation, with the caller's own RLS for EES source reads (as V4 does today).
5. **Per-vehicle/day aggregates.** Confirm whether to persist `reporting_snapshot` rows for day totals (with coverage and reconciliation status) or keep totals derived on request. Derived-on-request avoids stale or superseded totals but cannot show a day the operator did not read.
6. **Exceptions.** Currently derived. Persist only if an audit trail of acknowledged exceptions is required (a separate, small table with reviewer and reference, not part of this proposal).
7. **Job confirmations.** Must bind to the exact booking snapshot, the calculation run and the authenticated reviewer (`job_match`, `allocation_decision`); one active decision per interval.
8. **Partial backfills.** `sync_window` exists; the provider's retention, pagination and rate limits are still unconfirmed, so backfill depth must not be promised.

## Recommendation

No SQL edit is needed for V4. Approval of a schema is a separate decision after items 1–3 are resolved and an isolated database validation is run. Do not run the SQL against production.
