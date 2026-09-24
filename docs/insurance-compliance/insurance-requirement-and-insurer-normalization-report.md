# Insurance Requirement and Insurer Normalization Final Review

Prepared 23 September 2026. Production inspection was read-only. No migration, classification update, document operation, or deployment was executed.

## Database

The live migration is **not applied**. A direct request for `insurance_requirement` and `insurance_requirement_reason` returned HTTP 400 / PostgreSQL `42703`: `column vehicle_insurance_compliance.insurance_requirement does not exist`.

Apply [20260923090000_insurance_requirement.sql](../../supabase/migrations/20260923090000_insurance_requirement.sql) before any classification SQL. It adds the two fields, constrains the allowed values, defaults existing/unclassified rows to `unknown`, and performs no data updates or deletes.

## Exact seven boss-confirmed trailers

Because the columns do not yet exist, current requirement/reason for every row is **not available (schema absent)**.

| Stored registration | Database ID | Display name / type evidence | Review | Main expiry | Compulsory expiry | Insurance docs | Why currently To review |
|---|---|---|---|---|---|---:|---|
| 77-5902 | `c477bc1e-7dde-420a-9618-6ca079e8cd4e` | No make; source policy cell says `หางหัวลาก` | needs_review | 2024-09-30 | none | 0 | Missing insurer/document/compulsory data and expired main date |
| สินค้า | `db4e0e22-7267-4451-a5e6-cdd561be22eb` | Boss-confirmed trailer; source identity unresolved | needs_review | 2024-11-18 | none | 0 | Stored registration is non-plate text; expired insurance and no document/compulsory evidence |
| 64-2699 | `e23a10e9-2e08-4b27-88d1-393c6e3dafb3` | Source policy cell says `หางพ่วง` | needs_review | none | none | 0 | Missing insurer, genuine policy, expiry, and documents |
| 64-8664 | `f2b60822-708a-4b30-8822-17388b9a1037` | Source policy cell says `หางหัวลาก` | needs_review | none | none | 0 | Missing insurer, genuine policy, expiry, and documents |
| 67-6204 | `4da3e4fe-8cb3-499a-ba66-c96d7b37075f` | Make `Trailer`; chassis `SPN33-0006-04` | needs_review | none | none | 0 | Missing policy, insurer, expiry, compulsory evidence, and insurance document |
| 700-4198 | `c321a8c0-b415-4e64-85c9-94259a143a75` | Make `Trailer`; chassis `PS3-SC1360T` | needs_review | none | none | 0 | Missing policy, insurer, expiry, compulsory evidence, and insurance document |
| 77-8513 | `39971a11-34b9-4079-8c2e-47e01da60b1b` | Source policy cell says `หางหัวลาก` | needs_review | none | none | 0 | Missing insurer, genuine policy, expiry, and documents |

Proposed classification for all seven: `insurance_requirement = 'not_required'`, `insurance_requirement_reason = 'Trailer'`.

### The `สินค้า` identity

`สินค้า` is literally stored in `vehicle_insurance_compliance.vehicle_registration` for ID `db4e0e22-7267-4451-a5e6-cdd561be22eb`; it is not introduced by the React display. The record came from `boss_excel_2026`, source row 8. Its audit note already says the value means Goods/Cargo and the actual plate must be confirmed. No chassis, make, mapped vehicle ID, or alternative plate exists in the Insurance record or the prior asset-identity audit. The approved classification can safely target its immutable UUID, but the application must not invent or replace its registration.

## SQL sequence

Step A is the schema migration file above. Step B is [seven-trailer-classification.sql](seven-trailer-classification.sql), which contains:

1. A preview `SELECT` joined by immutable UUID plus the currently stored registration.
2. One guarded `UPDATE` for exactly the seven approved IDs, only while their value is still `unknown`.
3. A verification `SELECT` for the same seven IDs.

The update changes no verification status, registration, policy, premium, history, or document field.

## UI behaviour after classification

Local regression coverage simulates these exact seven records as `not_required`, including missing and expired insurance dates. Expected result:

- Insurance Not Required card: **7**.
- Effective To review count caused by these seven: **0**.
- No missing/expired insurance or compulsory/document finding.
- No urgent, upcoming, later, or unknown renewal placement.
- Neutral Not Required status in Vehicles, profile, PDF, and Excel.
- All seven remain searchable and present in fleet-wide reports and profiles.
- Tax/registration compliance remains active independently.

The live database currently has exactly these seven persisted `needs_review` rows. Therefore, after the migration and approved classification, no other current row should remain in the effective review queue unless new/incomplete data is added. The stored `verification_status` is preserved; UI review logic correctly treats an exempt asset as complete when it has no non-insurance warning.

## Insurer normalization

`lib/insurance-providers.ts` remains the single deterministic provider directory. It uses Unicode normalization, case folding, whitespace/punctuation normalization, and explicit aliases—never fuzzy matching.

| Raw name | Canonical name | Current records | Main premium |
|---|---|---:|---:|
| Aioi Bangkok Insurance | Aioi Bangkok Insurance Public Company Limited | 2 | THB 124,972.79 |
| Aioi Bangkok Insurance Public Company Limited | Aioi Bangkok Insurance Public Company Limited | 20 | THB 489,378.77 |

All-current combined Aioi result: 22 records, THB 614,351.56, 69.49% of THB 884,048.59. The verified-only dashboard default is 21 records, THB 532,169.14, 66.37% of THB 801,866.17.

Raw `insurer_en` and `insurer_th` values remain unchanged. Canonical values are derived for ordinary UI, analytics, PDF, and Excel; exports also retain separate raw insurer columns.
