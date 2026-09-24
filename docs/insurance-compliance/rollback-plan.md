# Stage 2 rollback requirements

This is a design only. No rollback or migration has been executed.

## Preconditions

- A verified database recovery point and a verified independent copy of all `insurance-documents` objects must exist.
- The exact live schema/security capture must be archived with the migration package.
- Stage 2 must be additive: legacy tables, rows, IDs, registrations, policy data, verification state, document metadata, and Storage paths remain untouched.
- Application reads and writes remain on the legacy implementation behind a default-off cutover flag until reconciliation passes.

## Identification and isolation

Assign one immutable `migration_run_id`. Every new Fleet Asset, alias/history row, policy, compulsory policy, compliance row, document-reference row, cost item, and mapping-ledger row created by the backfill must carry it. Record exact inserted IDs and row counts in a signed run manifest. Do not reuse a run ID.

No Stage 2 row may replace or repoint a legacy document. New document records reference the existing immutable bucket/path; the 38 Storage objects are not copied, renamed, overwritten, or deleted during the backfill.

## Reversal sequence after a failed validation

1. Keep the cutover flag off and stop the backfill writer.
2. Preserve the failed reconciliation report and run manifest.
3. In one controlled database transaction, remove only rows whose `migration_run_id` exactly matches the failed run, child tables before parent tables.
4. Assert that deleted row IDs exactly equal the run manifest and that no pre-existing ID is affected.
5. Re-run the full legacy baseline: 36 assets, 27 verified records, 38 document rows, 38 readable paths, and all field/value hashes.
6. If legacy state differs, stop and recover into an isolated environment from the verified database recovery point. Do not restore production casually.

The reversal script must be written and reviewed with the Stage 2 migration, but must not be run merely because a report is still pending. It must contain a hard guard for the intended `migration_run_id`, expected row counts, and current environment/project identifier.

## Cutover and post-cutover boundary

Before cutover, rollback is deletion of only the additive run rows. After any future write is accepted into the new model, simple deletion is no longer safe; rollback requires a documented reverse-sync of those writes or restoration to a coordinated database and Storage recovery point. Therefore Stage 2 must not enable new-model writes until reconciliation, authorization, monitoring, and a cutover-specific rollback rehearsal all pass.
