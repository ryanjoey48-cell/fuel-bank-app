# Finance V3 — Finance-only staging design (REVIEW ONLY)

Goal: the **smallest** isolated Finance test environment on EES Development (`wpmnjfncaoogssgpqxek`) that can exercise intake → arrange → billing → approve → draft documents **without** migrating 70+ operational tables and **without** touching production (`hafoaurzfgkkwpvzedvd`).

**This document does not authorize SQL execution.**

## 1. Boundaries

| In scope | Out of scope |
| --- | --- |
| Synthetic customers / bookings / WOs | Real production clients, drivers, plates |
| Synthetic billing profiles | Copying production PII / tax IDs |
| Simulated invoice groups + simulated TRNs | Official TRN allocator |
| Test-only approval actors | Live Forth / GPS calls |
| Finance `finance_*` tables + RLS + audit | Vehicles, fuel_logs, shipments, safety, HR, … |
| Dry-run tooling + env guards | Changing `.env.local` or Vercel |

Default localhost:3000 stays on production for Ops screens. A future Finance staging session must launch **only** with an explicit staging env file (see `lib/finance-migration-environment.ts`) and must not call Forth.

## 2. Synthetic data contract

All rows carry an unmistakable synthetic marker:

- Client names: `SYN-FINANCE-CUSTOMER-*` (e.g. `SYN-FINANCE-CUSTOMER-APL`)
- Work orders: `SYN-WO-*`
- Booking ids: dedicated UUIDs in `finance_dev_bookings`
- Tax IDs: clearly fake patterns reserved for tests (never real Thai TINs from production)
- Actors: dedicated staging Auth users created by the owner (passwords never stored in repo)

Proposed vs verified pricing rules remain identical to local Finance: proposed Diesel B7 and proposed rate mappings **never** price jobs.

## 3. Schema layers (additive)

1. **Fixture layer** — `finance_dev_clients`, `finance_dev_bookings`, `finance_dev_capabilities`, optional `finance_dev_is_office()` stub.  
2. **Finance domain** — intake, sheets, papers, lines/extras (integer satang), allocations, revisions, approvals, events, fuel references, rate mappings, billing profiles, document artifact hashes.  
3. **Numbering** — `finance_simulated_trn_register` only. Any function named for official allocation **raises** in this variant.  
4. **Security** — RLS on; no direct authenticated writes; RPCs security definer with capability checks; history immutable.

## 4. How this proves Finance without full Ops schema

| Local behaviour today | Staging proof |
| --- | --- |
| Sheet money in satang | `transport_amount_satang` / `extra_amount_satang` columns |
| One WO → one sheet | Unique allocation PK + trigger |
| Approval ≠ issuance | `finance_approve_sheet` never inserts official TRN |
| Idempotent approve | `finance_rpc_idempotency` + expected revision |
| Simulated TRN651-style labels | Simulated register only |
| Pending profiles / proposed fuel | Same status enums as local app |

## 5. Launch contract (future — not executed now)

```
EES_FINANCE_MIGRATION_TARGET=development
EES_FINANCE_MIGRATION_MODE=dry-run
EES_FINANCE_MIGRATION_ENV_FILE=.env.staging.local
node scripts/assert-finance-migration-target.cjs --env-file=.env.staging.local
```

Apply remains hard-disabled in code until a separate owner cutover flips an explicit product constant (not merely an env var).

## 6. Relationship to local `.ees-local`

Local JSON remains the day-to-day Finance workspace while remote staging is unapproved.  
TRN651 Approved demo stays in `.ees-local` and must not be rewritten by staging work.
