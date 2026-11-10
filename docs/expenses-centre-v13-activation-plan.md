# Expenses Centre V1.3 — owner approval and safe activation plan

**Status: preparation only. No remote migration, seed, configuration write or activation has been performed in the V1.3 delivery.**

## Verified environment map — 10 November 2026

| Profile | Project | Classification | Expenses approval | Notes |
| --- | --- | --- | --- | --- |
| `.env.local` (localhost:3000) | `hafoaurzfgkkwpvzedvd` | **CONFIRMED_PRODUCTION** | Absent | Must never receive Expenses migrations from this package |
| `.env.vercel-preview.local` | `hafoaurzfgkkwpvzedvd` | **CONFIRMED_PRODUCTION** | Absent | Unchanged |
| `.env.staging.local` | `wpmnjfncaoogssgpqxek` | **CANDIDATE_STAGING** (EES Development) | Absent | Account/driver tables present; Vehicles and all Expenses objects absent through REST |
| `.env.expenses-test.local` | — | Not created | — | Create only after owner approval |

Read-only staging probe evidence: `tmp/expenses-v13-readiness.json`.

## Exact owner approval required (single action)

Approve this exact statement, then the operator may continue:

> Approve isolated Expenses installation on **EES Development** project ref `wpmnjfncaoogssgpqxek` only: apply the reviewed V1 + V1.1 + V1.2 migrations, create the private `expenses-receipts` bucket, run `docs/expenses-v13-activation-review-only.sql`, create `.env.expenses-test.local` with matching `EES_EXPENSES_APPROVED_SUPABASE_URL` and `EES_EXPENSES_WRITES=approved-safe-environment`, and allow synthetic persistence tests. Do **not** migrate or enable Expenses on production `hafoaurzfgkkwpvzedvd`.

Until that approval exists, no remote SQL or write-gate activation is authorised.

## Installation order after approval

1. Confirm the SQL editor, server key and browser public key all refer to `wpmnjfncaoogssgpqxek`. Agree backup/restore and synthetic retention.
2. Re-run `node scripts/expenses-readiness.cjs .env.staging.local` (read-only).
3. Run `docs/expenses-v11-activation-preflight-read-only.sql` in the **test** SQL editor. Inspect Auth/account-access, Vehicles, Booking Diary and Storage prerequisites. Stop if Vehicles or diary office RLS is missing; review official prerequisite SQL before inventing replacements.
4. If Vehicles is genuinely absent, review `docs/expenses-v11-test-vehicles-prerequisite-review-only.sql` with session marker `set ees.expenses.approved_test_project_ref = 'wpmnjfncaoogssgpqxek';`.
5. Apply **only**, in order:
   - `supabase/migrations/20261109090000_expenses_centre_review_only.sql`
   - `supabase/migrations/20261110100000_expenses_centre_v11_review_only.sql`
   - `supabase/migrations/20261110120000_expenses_centre_v12_review_only.sql`
6. Create distinct synthetic submitter/reviewer accounts through the existing account system. Display names must begin `Expenses V13 fixture`. Self-approval remains denied.
7. If the test fleet is empty, review `docs/expenses-v11-synthetic-vehicles-review-only.sql` with the two synthetic account UUIDs.
8. Re-verify private bucket, restrictive storage policy, RLS, grants, schema_version=3 and Expenses RPCs including `expenses_register`.
9. Run `docs/expenses-v13-activation-review-only.sql` on the approved test target only.
10. Copy `.env.expenses-test.example` → `.env.expenses-test.local`, fill Development keys only, then set both write gates. Never edit `.env.local`. Never prefix service credentials with `NEXT_PUBLIC_`.
11. Launch `node scripts/start-expenses-approved-test.cjs .env.expenses-test.local` on port 3020. Leave localhost:3000 untouched. Complete synthetic save/upload/refresh/sign-out/retrieve acceptance before any office use.

## Production activation (separate later decision)

Production activation is **not** included. It requires a separate owner decision, production backup plan, production migration review, and a production-specific write-gate design. Known production URLs and `VERCEL_ENV=production` remain refused by the V1–V1.3 server gates.
