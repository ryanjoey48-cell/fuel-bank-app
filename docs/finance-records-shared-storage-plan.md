# Finance Records — shared-storage migration plan

**Status: PROPOSED — NOT APPLIED — REVIEW ONLY.**
Nothing in this plan has been run against any Supabase project (production or otherwise). The SQL lives in
`docs/proposed/PROPOSED-migration-finance-records-shared-storage.sql`, deliberately outside `supabase/migrations/`
so no tooling can pick it up by accident. No simulated approval event, simulated TRN (TRN651+) or test record is
to be migrated as genuine financial history.

**V3 companions (also unapplied):**
- Finance-only Development variant: `docs/proposed/PROPOSED-migration-finance-records-development-isolated.sql`
- Dependency map: `docs/finance-v3-development-dependency-map.md`
- Staging design: `docs/finance-v3-finance-only-staging-design.md`
- Migration env guards: `lib/finance-migration-environment.ts` (+ CLI `scripts/assert-finance-migration-target.cjs`)
- Production (`hafoaurzfgkkwpvzedvd`) is refused by those guards under all circumstances.

## 1. Current (local) model → durable entities

The Finance Centre today keeps one JSON document in `.ees-local/finance-test/state.json`, served by
`app/api/finance-local-store/route.ts`. It is whole-file, single-writer, and not shared between users.

| Local concept (`lib/finance-demo-centre.ts`) | Proposed table |
| --- | --- |
| Admin Intake entry (work order no., receipts, notes) | `finance_intake_records`, `finance_intake_receipts` |
| `BillingSheet` (batch) + `jobIds` order | `finance_billing_sheets`, `finance_billing_sheet_papers` (position) |
| One work order belongs to one sheet | `finance_work_order_allocations` (PK = booking) |
| Customer-billable lines / extras (blank ≠ zero) | `finance_billing_sheet_lines`, `…_extras` |
| TRN number (official) | `finance_trn_register` (unique year + number), `finance_trn_register_verifications` |
| Simulated TRN (local / rehearsal only) | `finance_simulated_trn_register` — **never** joins official register |
| Mark ready / reopen / approve / issue | `finance_billing_sheet_revisions` (snapshot + sha256), `…_approvals`, `…_events` |
| Verified Diesel B7 evidence | `finance_fuel_references` (+ immutable history rows) |
| Customer rate mappings (proposed vs approved) | `finance_rate_mappings` (`review_status`) |
| Customer billing profiles | `finance_customer_billing_profiles`, `…_profile_events` |
| Document file hashes / metadata | `finance_document_artifacts` |

Records in the Finance Records screen are projections of this data; nothing is duplicated.

## 2. Review of the already-prepared migrations (also unapplied)

`supabase/migrations/20261030…20261106` cover verification foundation, paperwork intake, expenses/pricing,
weekly billing drafts, invoice approval packs, the reconciliation expense recorder and super-admin access.
Gaps against the three-stage workflow:

- No intake table keyed by work-order number; weekly drafts are Monday-based and UUID-derived, not arbitrary paper stacks.
- No per-line customer-billable decision, and no batch/paper position.
- No TRN identity register or concurrency-safe allocator.
- No document snapshots, no explicit lifecycle, no correction history.
- No verified fuel evidence store, no customer billing profile store.

The proposal is additive and reuses the helpers `finance_has_capability`, `finance_reject_history_change`,
`is_office_account`, `current_account_role`.

## 3. Proposed design (summary)

- Money in integer satang (or `numeric(12,2)` with blank ≠ zero checks).
- One work order per sheet (allocation PK) and one booking per work-order number (case/space-insensitive).
- Status guard: `(status='issued') = (trn_id is not null)`; issued/locked sheets reject edits.
- History tables are immutable (`finance_reject_history_change`).
- RLS: office accounts read; **no direct writes**; activity events readable by finance roles only.
- `revision` / `row_version` on mutable sheets and profiles; RPCs take `p_expected_revision` and fail with `FINANCE_STALE` on mismatch.
- `finance_verify_trn_register` (super admin), `finance_allocate_trn` (advisory lock; requires a verified
  register, an approved sheet and the `invoice_approver` capability), `finance_reopen_sheet`,
  `finance_approve_sheet` (idempotent), `finance_record_fuel_reference`, `finance_upsert_customer_profile`.
- Simulated TRN numbers live in a separate table/namespace and **cannot** be inserted into `finance_trn_register`.

Validated in an in-memory PGlite database by `tests/finance-records-storage-plan.test.cjs` (invariants, TRN
allocation, RLS). That is a logic check only, not a check against the live schema.

## 4. Security model

| Concern | Control |
| --- | --- |
| Authorization | Server-side RPCs check `finance_has_capability` / `current_account_role`; RLS denies table writes |
| Stale edits | `revision` optimistic concurrency; `FINANCE_STALE` |
| Duplicate approval / issuance | Unique approval per revision; allocate TRN under advisory lock + unique `(year, number)` |
| Official vs simulated TRN | Separate tables; issuance RPC refuses simulated identifiers |
| Audit | Append-only events + immutable revisions with SHA-256 of snapshot |
| Secrets / attachments | Document artifacts store hash + metadata only; blobs outside DB with signed access |

## 5. Idempotent RPC specifications (review)

### `finance_approve_sheet(p_sheet_id, p_expected_revision, p_note, p_idempotency_key)`

1. `SELECT … FOR UPDATE` sheet; require status in (`ready_for_review`,`awaiting_approval`).
2. Reject if `revision <> p_expected_revision` → `FINANCE_STALE`.
3. If an approval row already exists for `(sheet_id, idempotency_key)` return the prior result (no second event).
4. Insert revision snapshot + approval (`approved`); set status `approved`; bump revision.
5. Never allocates a TRN.

### `finance_allocate_trn(p_sheet_id, p_year, p_idempotency_key)`

1. Require `invoice_approver` + sheet status `approved` + `trn_id is null`.
2. Advisory lock on year; require verified register high-water.
3. If idempotency key already issued for this sheet, return existing TRN text.
4. Insert official register row; set sheet `issued`; append event. Simulated register is never touched.

### `finance_record_fuel_reference(...)`

1. Exact calendar date only; refuse future dates; refuse non-approved source URL.
2. New values default to `proposed` unless caller has verify capability and sets verified deliberately.
3. Supersede prior active row with required revision reason; never reprice saved sheet lines.

## 6. Decisions needed from the owner

1. Is a work-order number globally unique, or unique per client? (Proposal: globally unique.)
2. TRN650/2026 is an owner-stated value. It must be verified in the register by a Super Admin before any
   official allocation; TRN651+ remain simulated test numbers until then.
3. Confirm which actors may approve customer billing profiles vs rate mappings vs sheet figures.
4. Approve APL (and other) legal billing details before any profile leaves `pending_owner_approval`.

## 7. Prerequisites before anything is applied

- Full backup and a tested restore drill.
- RLS review of every new table and function (grants, `security definer`, search_path).
- Reconcile against the live production schema (the migrations in the repo are not known to match it).
- Role grants set up for finance reviewer / invoice approver; Super Admin activation approved by the owner.
- Historical TRN register import and verification against the paper/PDF record.
- Read-only rehearsal against a local snapshot (`docs/finance-migration-rehearsal.md`) with zero error findings that block import.

## 8. RPCs still to be specified in SQL body

Save intake; create sheet; add / move / remove paper; set transport / extra; mark ready (with snapshot);
submit; decide (approve / reject); cancel; upsert / submit / approve customer profile; propose / approve rate mapping.
