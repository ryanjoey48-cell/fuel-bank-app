# Insurance & Compliance Stage 1 data-quality baseline

Captured from production by read-only API calls on 2026-09-21. NULL values were not converted to zero.

## Counts

| Measure | Count | Interpretation |
|---|---:|---|
| Total Insurance assets | 36 | Authoritative Stage 1 Insurance inventory |
| Verified | 27 | Current record-review flag |
| Awaiting review | 9 | Current record-review flag |
| Missing make | 9 | Raw NULL/blank |
| Missing model | 36 | No dedicated model field exists; values were not inferred from vehicle_make |
| Missing year | 9 | Raw NULL |
| Missing chassis | 9 | Raw NULL/blank |
| Missing insurance class | 11 | Raw NULL/blank |
| Missing repair type | 18 raw; 16 requiring review | 2 explicitly described as not stated/applicable in source notes |
| Missing insured value | 12 raw; 10 requiring review | 2 explicitly described as not stated/applicable in source notes |
| Missing insurance premium | 6 | Raw NULL; not counted as zero |
| Missing compulsory information when compulsory is evidenced/applicable | 0 | Requires policy/start/expiry where included or a compulsory policy is recorded |
| Unknown compulsory-included state | 14 | Unknown, not automatically an error |
| Missing registration expiry | 29 | Raw NULL |
| Missing main document | 9 | No current insurance document row |
| Missing applicable compulsory document | 0 | Only counted where included or a compulsory policy is recorded |
| Expired insurance | 6 | Current view status |
| Expiring within 30 days | 2 | Excludes already expired |
| Expiring within 60 days | 4 | Cumulative; excludes expired |
| Expiring within 90 days | 8 | Cumulative; excludes expired |

Exclusive live status bands: active=19, due_30=2, due_60=2, due_90=4, expired=6, missing=3.

## Cost baseline (THB)

| Measure | Confirmed total | Contributing records | Missing values |
|---|---:|---:|---:|
| Main insurance premiums | 890518.52 | 30 | 6 |
| Compulsory insurance costs | 19317.44 | 12 | 24 |
| Vehicle tax | 14712.60 | 4 | 32 |
| Additional premiums | 20216.00 | 2 | 34 |
| Insured value | 17088000.00 | 24 | 12 |

## Future analytical support

| Analysis | Current support |
|---|---|
| Premium by insurer | Partial: insurer values exist but require canonical insurer normalization |
| Premium by asset category | Partial: Stage 1 categories are proposed, not stored or approved |
| Premium by make | Partial: make sometimes includes model and needs normalization |
| Premium by model | Not reliable: no dedicated model field |
| Premium by year | Partial: 27 records have a year |
| Premium as % of insured value | Partial: requires both values; missing values must remain excluded |
| Insured value by vehicle age | Partial: requires year and insured value |
| Repair type distribution | Partial: 18 raw missing values |
| Insurance class distribution | Partial: 11 raw missing values and labels need normalization |