# PRE-STAGE-2 SAFETY REPORT

Assessment date: 2026-09-22 (Asia/Bangkok). This review was non-destructive. No production data, document, RLS/Storage policy, migration, runtime component, or deployment was changed. Stage 2 was not started.

## 1. Access and exact live metadata

The current environment is **not sufficient** for a complete owner-level live capture.

What is available:

- Supabase URL and application/API credentials in local environment configuration; values were not printed.
- Read-only PostgREST/OpenAPI and Storage-list access used for the Stage 1 snapshot.
- Column/default/nullability and exposed PK/FK annotations already captured in `live-schema-snapshot.json`.

What is missing:

- No database-owner/direct Postgres connection string or password.
- No Supabase Management API access token capable of checking backup configuration.
- No linked Supabase CLI project and no usable Supabase CLI executable in the repository environment.
- No repository migrations or schema SQL defining the live Insurance tables/view/security.
- PostgREST does not expose the required `pg_catalog`/`information_schema` objects.

Therefore exact constraints, indexes, view SQL/options, trigger definitions/functions, grants, RLS enable/force flags and policies, and Storage policies are not verified. Run `read-only-live-metadata.sql` manually as described under Manual action.

## 2. Backup readiness

| Recovery component | Current result | Evidence |
|---|---|---|
| Supabase automatic database backup | Not independently visible | Current credentials cannot inspect the project plan or Dashboard backup jobs. Supabase documents automatic daily backups for Pro/Team/Enterprise, but project eligibility and latest success are unknown. |
| Point-in-time recovery | Not independently visible | No Management API token or Dashboard session is available. |
| Independent logical/physical database copy | Not found/verified | Stage 1 CSV/JSON files are audit extracts, not a restorable database backup. |
| Independent copy of 38 Storage objects | Not found/verified | All 38 live objects resolved during Stage 1, but live accessibility is not a separate backup. |

Supabase database backups contain Storage metadata, not the object bytes. Database and Storage recovery must therefore be verified separately. See [Supabase database backups](https://supabase.com/docs/guides/platform/backups) and [Storage schema guidance](https://supabase.com/docs/guides/storage/schema/design).

## 3. Known data-quality review

### Registration variant: actual live value is ฒอ, not ฌอ

| Item | Finding |
|---|---|
| Current value | Insurance: `ฒอ8453`; operational vehicle: `ฒอ-8453`; alias `8453 -> ฒอ-8453`. No `ฌอ8453` record was found. |
| Expected semantic meaning | Formatting variants for the same Toyota Hilux Vigo asset. |
| Reliable evidence | One Insurance row: Toyota Hilux Vigo, 2013, chassis `MROCX12G200106928`, policy `726-0131-1659`; one matched operational FOUR_WHEEL_TRUCK; references in Drivers (1), Fuel Logs (80), Weekly Mileage (26), Maintenance (3), and Booking Diary. The operational master has no chassis field, so chassis cannot be cross-compared there; there is no conflicting 8453 candidate. |
| Why flagged | Hyphen/presentation formatting differs, and the request named a different Thai character (`ฌ` versus live `ฒ`). Thai-character substitution must never be treated as formatting normalization. |
| Future normalization | Preserve each source in `display_registration`; normalize separator-only variants to `ฒอ8453`; retain alias/history and source provenance. If `ฌอ8453` is intended as a real separate value, it needs manual evidence and must not auto-match. |
| Stage 2 blocker | **No**, provided migration preserves both display forms and does not auto-merge unreviewed Thai-character differences. Identity confidence for the actual `ฒอ` pair is high. |

### Trailer descriptions in policy_number

| Registration | Chassis | Current policy_number | Meaning/evidence | Genuine policy elsewhere | Future destination |
|---|---|---|---|---|---|
| 64-8664 | NULL | `หางหัวลาก` | Trailer/body description; import note explicitly says it is not a policy number | None found; no document rows | Preserve as legacy raw value; `asset_description`/`body_type = Trailer`; future `policy_number = NULL` |
| 77-5902 | NULL | `หางหัวลาก` | Same | None found; no document rows | Same |
| 77-8513 | NULL | `หางหัวลาก` | Same; source also has an unconfirmed registration-expiry year | None found; no document rows | Same |

These records were flagged because a repeated descriptive Thai phrase violates policy-number semantics. This does **not** block an additive Stage 2 migration when original evidence is preserved and the future policy field remains NULL; it does block treating these strings as real policies.

### 61-2835 compulsory semantics

| Item | Finding |
|---|---|
| Current value | `compulsory_included = false`; main policy `726-0131-1124`; separate compulsory policy `726-0133-785`; compulsory dates 2026-06-30 through 2027-06-30. |
| Expected semantic meaning | False means compulsory cover is not included in the main Class 1 policy, not that the asset lacks compulsory insurance. |
| Why flagged | The generic boolean label can be read as “no compulsory insurance,” while separate populated fields and a document say otherwise. |
| Document evidence | Main PDF states `ไม่รวม พ.ร.บ.`; separate compulsory PDF matches registration `61-2835`, HINO, chassis `FG8JRLA14275`, policy `726-0133-785`, and the same coverage period. |
| Future normalization | `main_policy_includes_compulsory = false`; create a distinct compulsory policy record with confirmed status and its document. |
| Stage 2 blocker | **No** for data interpretation. It is understood and document-confirmed; the schema/security/backup gates still block Stage 2. |

## 4. Three indeterminate assets

No references were found for any of the three in the shared vehicle master, Drivers, Fuel Logs, Weekly Mileage, Maintenance, Trip Journey, or Booking Diary.

| Registration | Make / model / year / chassis | Existing description/body | Insurance information | Likely category | Confidence and reason |
|---|---|---|---|---|---|
| 700-6956 | all NULL | none | Aioi; policy `725-0131-1541`; expiry 2026-06-05; premium 20,414.53; no documents; needs review | Unknown | Low. A registration and policy exist, but no physical-identity or operational evidence establishes vehicle type. |
| ภอ6656 | all NULL | none | Aioi; policy `722-0133-1634`; expiry 2023-09-29; tax 3,438; no documents; needs review; holder blank | Unknown | Low. Historical insurance/tax evidence exists, but type and permanent natural identity are absent. Source expiry year also needs review. |
| สินค้า | all NULL | text appears in registration field and means Goods/Cargo | Aioi; policy `722-0123-133`; expiry 2024-11-18; premium 82,182.42; no documents; needs review | Unknown | Very low. `สินค้า` is not a reliable registration; actual plate and asset type require source confirmation. |

All three can migrate as provisional Unknown Fleet Assets because their permanent UUID and legacy source-row identity are reliable. They must not be merged, linked to Drivers, or assigned a more specific category without new evidence.

## 5–8. Safety controls prepared

- Permanent identity and source-preserving normalization: `migration-normalization-plan.md`.
- Automated before/after proof and checksum rules: `reconciliation-contract.md`.
- Additive-run isolation and reversal: `rollback-plan.md`.
- Owner-level catalog/security capture: `read-only-live-metadata.sql`.

## 9. Gate checklist

| # | Gate | Result |
|---:|---|---|
| 1 | Exact live schema captured | **NO** |
| 2 | Constraints captured | **NO** — exposed PK/FK annotations exist, but the complete owner catalog is not captured |
| 3 | Indexes captured | **NO** |
| 4 | Views captured | **NO** — exposed view shape exists, but exact SQL/options are missing |
| 5 | Triggers/functions captured | **NO** |
| 6 | RLS policies captured | **NO** |
| 7 | Storage policies captured | **NO** |
| 8 | Database backup verified | **NO** |
| 9 | Storage backup verified | **NO** |
| 10 | 36 assets reconciled | **YES** |
| 11 | 27 verified records reconciled | **YES** |
| 12 | 38 documents reconciled | **YES** |
| 13 | Registration formatting issue understood | **YES** |
| 14 | Trailer policy-field issue understood | **YES** |
| 15 | 61-2835 compulsory issue understood | **YES** |
| 16 | 3 indeterminate assets reviewed | **YES** |
| 17 | Permanent asset identity rules defined | **YES** |
| 18 | Reconciliation contract defined | **YES** |
| 19 | Rollback plan defined | **YES** |

## MANUAL ACTION REQUIRED FROM ME

### A. Capture exact live metadata

1. Open the correct production project in Supabase Dashboard.
2. Open **SQL Editor → New query**.
3. Open `docs/insurance-compliance/read-only-live-metadata.sql` locally and confirm every executable statement begins with `select`.
4. Paste it into the SQL Editor and run it with a database-owner-capable Dashboard role.
5. Export every result grid without editing it. Name the files in statement order and record the project reference, run timestamp, and executing role.
6. Return the exports to Codex for comparison and inclusion in the gate package. Do not run any suggested repair or policy statement.

### B. Verify database recoverability

1. In Dashboard open **Database → Backups**.
2. Record the plan, latest successful recovery point, retention window, and whether the page shows daily backups or PITR. For PITR, record both earliest and latest available recovery points.
3. Obtain a restorable copy or recovery point according to the Dashboard/plan. If a downloadable logical copy is needed, use Supabase CLI `db dump` or `pg_dump` with the direct connection details; store it encrypted and outside this repository.
4. Verify by restoring to a separate disposable test project/database—not production. Before allowing any jobs/webhooks to run, account for the warnings in Supabase's [restore-to-new-project guidance](https://supabase.com/docs/guides/platform/clone-project).
5. In the isolated restore, confirm the Insurance tables/view exist and reconcile 36 assets, 27 verified rows, and 38 document metadata rows. Record restore timestamp, backup timestamp, and results.

### C. Create and verify an independent Storage backup

1. Download the entire private `insurance-documents` bucket to encrypted storage outside the repository, preserving every relative path. For a linked CLI project, the read-only copy form is:

   `supabase storage cp ss:///insurance-documents <absolute-backup-directory>/insurance-documents --recursive --experimental --linked`

2. Do not use `storage mv` or `storage rm`. Do not edit `storage.objects` in SQL.
3. Confirm exactly 38 files. Compare every relative path and byte length with `document-reconciliation.csv`.
4. Compute SHA-256 for every downloaded file and save a sorted manifest with the backup. Open/read-test every file or at minimum perform a full checksum read; record failures as a failed backup.
5. Copy the backup plus manifest to a second independent encrypted location, then re-hash and compare. Return the manifest and verification result to Codex.

The CLI copy syntax is documented in the [Supabase CLI Storage reference](https://supabase.com/docs/reference/cli/supabase-storage-cp). If the CLI is unavailable, use authenticated Dashboard downloads or the documented S3-compatible endpoint, still preserving paths and producing the same checksum manifest.

# NOT SAFE TO PROCEED TO STAGE 2

Wait for explicit approval only after the owner-level metadata exports and both verified recovery paths have been reviewed.
