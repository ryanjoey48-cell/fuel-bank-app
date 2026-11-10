# Fleet Intelligence persistence: security readiness (REVIEW ONLY)

No table, policy or route history access is created by this document. The proposal itself is `docs/fleet-intelligence-persistence-review-only.sql` (+ `.md`).

## 1. Storage needed and the live access model it must use
| Need | Proposed object | Who writes | Who reads |
|---|---|---|---|
| Job confirmations | events + current-state tables | admin, office_staff (via policy `(select public.current_account_role()) in ('admin','office_staff')`) | any active office account |
| Playback access audit | append-only audit table | server route (service role) only | admin |
| Evidence snapshots | immutable snapshot table | admin, office_staff | any active office account |
| Mileage allocation | allocation table keyed to journey + vehicle + Bangkok date | admin, office_staff | office accounts |
| Provider coverage metadata | small reference table | server (service role) | office accounts |
All access keys off `account_access` through the existing SECURITY DEFINER helpers (`is_office_account`, `current_account_role`, `is_account_admin`), wrapped in `(select ...)`. Nothing keys off `auth.uid() = user_id` ownership, and drivers (no `account_access` office role) match no policy. `anon` gets nothing, and new tables must `revoke all ... from anon` explicitly until Stage 2 changes the default privileges.

## 2. Dependencies (apply in this order, none before the one above it)
1. **Stage 0** (anon revoked) so the new tables are not the only protected ones.
2. **Stage 1** core (office policies on the 15 tables), so Fleet Intelligence reads of `fuel_logs`, `weekly_mileage`, `vehicles` keep working for office accounts and stop for others.
3. **Stage 2** default privileges, otherwise every new table is born open to anon and must be hand-revoked.
4. Foreign keys: reference `vehicles(id)` with the live column type (uuid) and journeys by their real key; do not copy the V4.x FK/type mismatches found in the audit (`driver_id bigint` vs uuid on some tables). Check types against the target database before writing the migration.
5. Time: store `timestamptz` and a separate Bangkok service date (`date`), never derive the date client-side.

## 3. Constraints that protect integrity
Append-only events (update/delete/truncate triggers raise), one current row per journey (unique), allocation overlap prevented by advisory-lock-guarded check, `decided_role in ('admin','office_staff')` on every decision row, notes length-limited, no raw GPS track stored (only references and summaries), so persistence cannot widen route-history access. Playback audit rows hold actor id, vehicle, window, reason, outcome, timestamp, no coordinates.

## 4. Test strategy
* Static tests (this repo): the SQL carries the review-only marker, revokes anon, uses helper-based policies, contains no `true` policy and no `auth.uid() = user_id` ownership, and ends in ROLLBACK.
* Development rehearsal (needs the Dev project awake): apply to a transaction, run `docs/stage1-validation-harness-review-only.sql` pattern against the new tables for admin, office_staff, read_only, unregistered, anon.
* Behavioural: confirm twice is idempotent, overlapping allocation is rejected, update/delete of events is rejected, snapshot is immutable.
* Production: nothing runs until the owner approves migrations separately.

## 5. Not ready until
Stage 0 and Stage 1 are approved and applied (or the owner explicitly accepts persistence landing first), Development is awake for a rehearsal, and the owner decides the retention period for playback audit rows.
