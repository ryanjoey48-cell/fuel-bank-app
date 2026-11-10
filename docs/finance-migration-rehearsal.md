# Finance shared-storage migration rehearsal (read-only)

**Status: design + local dry-run only. No database is modified by this process.**

## Purpose

Before any development or production import, rehearse against an exported local Finance snapshot
(`.ees-local/finance-test/state.json` or a copied fixture) and prove the data is consistent enough to map.

## Read-only utility

```bash
node scripts/finance-migration-rehearsal-readonly.cjs
node scripts/finance-migration-rehearsal-readonly.cjs path/to/snapshot.json
node scripts/finance-migration-rehearsal-readonly.cjs --json
```

The script:

- reads JSON only;
- refuses `--write`, `--apply`, `--migrate`, `--import`, `--fix`;
- never opens Supabase / Postgres;
- never mutates the snapshot file.

It reports:

- duplicate work-order associations across sheets;
- invoice / line money totals per sheet;
- missing customer identity / unverified billing profiles;
- missing Diesel B7 verification and rate-mapping conflicts / gaps;
- simulated TRN collisions and any official TRN leakage into local state;
- orphan confirmed work orders;
- unsupported lifecycle inconsistencies;
- missing approval audit evidence.

## Safe future import sequence (not executed here)

1. **Backup** the target database (logical dump + storage). Verify restore on a disposable clone.
2. **Apply proposal SQL** only after owner review, only to a development project, never by dropping this file into `supabase/migrations/` without a signed change control.
3. **Import in one transaction** per customer batch: intake → papers → lines/extras → revision snapshot → approval event. Abort on any duplicate WO or TRN conflict.
4. **Never promote** simulated TRN651+ as official. Official TRNs require `finance_verify_trn_register` then `finance_allocate_trn` on an approved sheet.
5. **Rollback**: `ROLLBACK` the import transaction; if already committed, restore from the pre-import backup and re-run the read-only rehearsal.
6. **Idempotency**: import keys are booking UUID / work-order number / draft identifier; re-running the same payload must no-op or fail closed, never double-allocate.

## What this rehearsal does *not* do

- Issue invoices
- Allocate official TRNs
- Change TRN651 / approved demo records
- Invent fuel prices or customer legal details
