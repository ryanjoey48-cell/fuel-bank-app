# Insurance & Compliance — Stage 1 final report

Captured on 2026-09-21. This stage used read-only Supabase REST/OpenAPI and Storage-list operations plus repository inspection. No production row, verification status, Storage object, RLS policy, migration, runtime component, or deployment was changed.

## 1. Live Insurance schema

The live Insurance implementation consists of:

- vehicle_insurance_compliance: 36 current mutable records. Primary key id; no vehicle_id and no FK to the operational vehicles table.
- vehicle_insurance_compliance_view: exposes the table fields plus insurance_status and days_to_insurance_expiry.
- vehicle_insurance_documents: 38 metadata rows. Primary key id; FK insurance_record_id -> vehicle_insurance_compliance.id.
- Private Storage bucket insurance-documents: 10 MiB limit; PDF/JPEG/PNG/WebP allow-list.

The exact live columns, data types, defaults, required/nullability metadata, PK/FK annotations, and bucket configuration are preserved in live-schema-snapshot.json.

### Catalog limitation and Stage 2 gate

The configured credentials expose PostgREST/OpenAPI but not pg_catalog or information_schema. The repository contains no migration for these Insurance objects. Therefore exact live unique constraints, indexes, view SQL, triggers, functions, grants, RLS enablement/policies, Storage policies, and view security_invoker status could not be captured non-destructively from this environment. A database-owner catalog export is mandatory before Stage 2.

No Insurance-specific RPC/function is exposed in PostgREST. Application writes are direct client updates/inserts/deletes, making the uncaptured RLS and Storage policies especially important.

## 2. Total Insurance assets

- Total: 36
- Current: 36
- Verified: 27
- Awaiting review: 9

insurance-asset-inventory.csv contains every requested stored field for all 36 records. Missing values remain blank/NULL. No model was inferred from the combined make text.

## 3. Asset categories identified

- 6-Wheel Truck: 8
- Other Commercial Vehicle: 11
- Passenger Car: 4
- Pickup: 3
- Trailer: 7
- Unknown: 3

Categories are proposals based only on explicit make/model text already stored or an existing matched operational vehicle type. Ambiguous SIX_PLUS_SIX_WHEELER and EIGHTEEN_WHEELER values remain Other Commercial Vehicle instead of being guessed as 10-wheel or tractor units.

## 4–7. Operational and non-operational relationships

- A. Operational fleet vehicle: 20
- B. Trailer / non-driver asset: 7
- C. Passenger/personal/company car: 4
- D. Insurance-only fleet asset: 2
- G. Unable to determine safely: 3

- Operational links are optional and were detected independently across Drivers, Fuel Logs, Weekly Mileage, Maintenance, Trip Journey, and Booking Diary.
- A missing Drivers/shared-vehicle relationship is not treated as an error.
- No Driver records should be created for the passenger cars, trailers, Insurance-only assets, or unknown records.

The earlier 16 unmatched records were unmatched to the shared vehicles table—not proof that they were erroneous or absent from Insurance. Reassessment:

- 7 trailer/non-driver assets
- 4 passenger/personal/company cars
- 2 identifiable Insurance-only fleet assets
- 3 unable to determine safely
- 0 automatically classified as duplicates

Full record-level results are in asset-identity-map.csv.

## 8–10. Identity-quality findings

- Exact duplicate registrations: 0
- Duplicate normalized registrations: 0
- Duplicate nonblank chassis groups: 0
- Same registration with conflicting chassis: 0
- Formatting difference to shared vehicle master:
- ฒอ8453 -> ฒอ-8453
- Duplicate policy-value groups:
- `หางหัวลาก`: 64-8664, 77-5902, 77-8513

The repeated Thai value หางหัวลาก is a trailer description stored in the policy-number field, not evidence that three assets share a real policy. It is a manual-review/data-quality item.

Known alias/history evidence touching Insurance registrations:

- 9565 -> 3ฒน-9565
- 8453 -> ฒอ-8453; Insurance currently stores ฒอ8453
- 100-6659 -> 700-6659

One compulsory contradiction exists: 61-2835 has compulsory_included = false while a separate compulsory policy is recorded. This may mean “not included in the main policy,” but the boolean label is ambiguous and must be preserved and reviewed rather than changed.

## 11. Verified baseline

verified-baseline.csv contains all 27 verified records with policy number, class, expiry, insured value, repair type, document status, compulsory expiry, missing fields, detected discrepancies, and source timestamps.

- All 27 have a resolving main document.
- All applicable recorded compulsory policies have a resolving compulsory document.
- verified_by is NULL on all 27 because the current UI does not write it.
- One verified policy is currently expired; this correctly demonstrates that document verification and compliance state are separate concepts.

## 12. Document reconciliation

- Database document rows: 38
- Main insurance documents: 27
- Compulsory documents: 11
- Storage objects: 38
- Missing referenced Storage objects: 0
- Orphan database rows: 0
- Unreferenced Storage objects: 0

Every document, record association, path, MIME type, size, uploader, and resolution result is in document-reconciliation.csv. No file was opened, moved, renamed, replaced, or deleted.

## 13–14. Data-quality and cost baselines

See data-quality-baseline.md. It reports raw missing values separately from explicit “not stated/applicable” source evidence and does not turn NULL into zero.

## 15. Current renewal behaviour

The current editor updates the existing vehicle_insurance_compliance row by ID. Renewal therefore overwrites current policy/compliance/cost fields. Document replacement updates the existing document metadata row and deletes the previous Storage object. There is no historical policy or document-version workflow.

## 16. Proposed permanent Fleet Asset identity model

fleet_assets must be the authoritative master for every insured asset and must not be based on Drivers:

`	ext
fleet_assets
  ├── fleet_asset_registration_history
  ├── insurance_policies
  ├── compulsory_policies
  ├── compliance_records
  ├── fleet_documents
  ├── fleet_cost_items
  └── validation_findings

optional operational links
  ├── driver assignments
  ├── fuel logs
  ├── weekly mileage
  ├── maintenance
  ├── trip journeys
  └── booking diary
`

Trailers and passenger/company cars are valid Fleet Assets with no Driver or fuel activity. Operational tables should receive nullable fleet_asset_id relationships only where applicable while retaining event-time registration snapshots.

## 17. Proposed historical-policy model

Each renewal must insert a new insurance_policies row linked to one Fleet Asset. Previous policies remain immutable historical records. Compulsory policies and compliance records are separate histories. Documents are append-only versions with supersedes_document_id; ordinary replacement must not delete prior policy evidence. Cost items link to their source policy/compliance period.

Derived current-policy and 30/60/90-day views can then support renewal alerts, expired/missing states, validation findings, year-on-year comparisons, premium/value ratios, depreciation, insurer/category/age comparisons, policy history, and compliance history.

## 18. Remaining manual-review items

1. Obtain the privileged catalog/RLS/Storage-policy export listed below.
2. Take and independently verify a recoverable database backup and Storage backup before any Stage 2 DDL.
3. Approve or correct the 36 proposed asset categories and relationship classes.
4. Resolve the three indeterminate records: 700-6956, ภอ6656, and สินค้า.
5. Confirm ฒอ8453 versus ฒอ-8453 as a formatting-only identity.
6. Review the three trailer descriptions stored as policy numbers.
7. Clarify the meaning of compulsory_included for 61-2835.
8. Review the future canonical identity for the two Insurance-only identifiable vehicles (4ฒล-4565, 61-2836) without creating Drivers.

## 19. Risks

- Automatic merges could combine distinct assets.
- Auto-creating Drivers would incorrectly model trailers and passenger/company vehicles.
- In-place renewals would destroy policy history.
- Current replacement/deletion destroys old document history.
- Missing live RLS/view/index/trigger definitions prevent a provably equivalent Stage 2 migration.
- A database-only backup would not preserve Storage objects; both require separate verified backups.
- Current TypeScript build configuration ignores type errors.
- Dual writes could leave legacy and historical models inconsistent unless transactional and reconciled.

## 20. Stage 2 readiness

The record/document baseline is complete and reproducible, but Stage 2 is blocked until the live catalog/security export and recoverable database/Storage backups are completed and verified. The Stage 1 CSVs are audit documentation, not substitutes for encrypted production backups.

Required database-owner read-only export:

- table/column constraints and unique constraints
- pg_indexes
- pg_get_viewdef('vehicle_insurance_compliance_view', true)
- triggers and trigger functions
- table grants
- RLS enable/force flags and pg_policy
- Storage objects policies for insurance-documents
- checksums/manifests for independently backed-up Storage objects

**NOT SAFE TO PROCEED TO STAGE 2**