# Stage 2 migration reconciliation contract

This contract is a mandatory pass/fail gate. It does not authorize Stage 2.

## Frozen source and run identity

Immediately before any future backfill, take a transactionally consistent source snapshot and assign an immutable `migration_run_id`. Record capture time, database version, migration commit, normalization-rule version, and SHA-256 of every exported source file. Keep the Stage 1 baseline for comparison, but use the new pre-migration snapshot as the final source of truth if legitimate production changes occurred after Stage 1.

Every new Stage 2 row must carry `migration_run_id`, `legacy_table`, and `legacy_id`. A mapping ledger must contain exactly one row for each of the 36 legacy Insurance assets, including provisional/Unknown assets, and must never use registration as the primary key.

## Canonical hashing

For every legacy row and its mapped Stage 2 representation:

1. Serialize fields in a fixed published order as UTF-8 JSON.
2. Preserve NULL with an explicit null value; never convert it to zero, empty text, or false.
3. Serialize dates as `YYYY-MM-DD`, timestamps as UTC ISO-8601, booleans as true/false, and money as exact decimal strings with two fractional digits.
4. Preserve original text byte-for-byte after valid UTF-8 decoding; also hash normalized values separately.
5. Compute SHA-256 per source row, per mapped entity, and for sorted aggregate sets. Sort by legacy UUID and document UUID, never by display order.

## Required assertions

All assertions must pass in one report:

| Assertion | Required result |
|---|---:|
| Legacy Insurance assets represented | 36 / 36, exactly once |
| Legacy records marked verified represented | 27 / 27 |
| Document metadata rows represented and resolvable | 38 / 38 |
| Unique legacy document paths preserved | 38 / 38 |
| Missing or orphaned source mappings | 0 |
| Unexpected many-to-one asset mappings | 0 unless explicitly approved in a signed exception ledger |
| Registrations preserved as original/display values | 36 / 36 |
| Nonblank chassis values preserved | 27 / 27 |
| Nonblank genuine policy values preserved | all; descriptive trailer text is preserved as legacy raw data, not promoted to a policy number |
| Main policy dates preserved | all non-NULL values |
| Compulsory policy dates preserved | all non-NULL values |
| Insured values preserved | all non-NULL values and aggregate `17,088,000.00` for the Stage 1 snapshot |
| Main premiums preserved | all non-NULL values and aggregate `890,518.52` for the Stage 1 snapshot |
| Compulsory costs preserved | all non-NULL values and aggregate `19,317.44` for the Stage 1 snapshot |
| Vehicle tax preserved | all non-NULL values and aggregate `14,712.60` for the Stage 1 snapshot |
| Additional premiums preserved | all non-NULL values and aggregate `20,216.00` for the Stage 1 snapshot |
| Notes/import-review notes preserved | all values, including blanks versus NULL |
| Verification state preserved | 27 verified, 9 needs-review for the Stage 1 snapshot |

The Stage 1 monetary totals are drift detectors, not substitutes for row-level matching. If a legitimate post-Stage-1 production change exists, it must appear in the frozen pre-migration snapshot and an explained delta report.

## Document proof

For each of the 38 documents, reconcile document UUID, insurance record UUID, document type, bucket, path, MIME type, stored size, uploader, and timestamps. Perform an authenticated read of each object and compute SHA-256 of the bytes before and after migration. A matching metadata row without readable object bytes does not pass.

## Failure rule

Any count mismatch, field mismatch, unreadable document, unexplained duplicate, missing path, or checksum mismatch fails Stage 2. Application reads remain on the legacy model; no cutover or cleanup is allowed until the discrepancy is resolved and the entire report passes again.
