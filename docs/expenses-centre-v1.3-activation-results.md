# Expenses Centre V1.3 — Development activation results

**Date:** 10 November 2026  
**Verdict:** Isolated **EES Development** persistence is activated and verified with synthetic data. **Production remains untouched and is not authorised for company expense saving.**

## 1. Verified Supabase project

| Check | Result |
| --- | --- |
| Approved target | `wpmnjfncaoogssgpqxek` (EES Development) |
| Staging URL / anon / service JWT claims | All match `wpmnjfncaoogssgpqxek` |
| Localhost:3000 profile (`.env.local`) | Confirmed production `hafoaurzfgkkwpvzedvd` |
| Isolation | Development ≠ production |
| Auth health / account_access probe | 200 on Development |
| Evidence | `tmp/expenses-v13-target-verify.json` |

Supabase CLI linked project was also `wpmnjfncaoogssgpqxek`. Every SQL apply used `--remote=wpmnjfncaoogssgpqxek` explicitly.

## 2. Migrations applied (Development only)

Applied in order to `wpmnjfncaoogssgpqxek`:

1. Vehicles prerequisite (empty table only) — `tmp/expenses-v13-apply-vehicles-prereq.sql`
2. `supabase/migrations/20261109090000_expenses_centre_review_only.sql`
3. `supabase/migrations/20261110100000_expenses_centre_v11_review_only.sql`
4. `supabase/migrations/20261110120000_expenses_centre_v12_review_only.sql`
5. Additive prep: `account_access.display_name` column if missing
6. Synthetic account/vehicle seed + `docs/expenses-v13-activation-review-only.sql` enablement — `tmp/expenses-v13-seed-and-activate.sql`

Post-apply:

- `expenses_config.schema_version = 3`
- `expenses_config.enabled = true`
- Expenses RPCs exposed: `expenses_command`, `expenses_finish_upload`, `expenses_role`, `expenses_register`, `expenses_duplicate_matches`

**Production check after activation:** `expenses_config` still `PGRST205` / 404 on `hafoaurzfgkkwpvzedvd` → production Expenses schema absent / untouched.

## 3. Storage configuration

| Item | Result |
| --- | --- |
| Bucket | `expenses-receipts` |
| Public | `false` |
| File size limit | 15,728,640 bytes |
| Allowed MIME | jpeg, png, webp, heic, heif, pdf |
| Restrictive policy | `expenses_receipts_server_only` present for `anon,authenticated` |

## 4. RLS / permission outcomes

- Expenses tables have RLS enabled.
- Authenticated SELECT granted; direct INSERT on `expenses_entries` denied (`auth_insert=false`).
- Mutations go through `expenses_command` / server attachment finalisation.
- Server-side schema tolerance added for Development’s narrower `account_access` / `driver_accounts` columns so office auth resolution does not require production-only `driver_id` / `last_access_changed_at`.

## 5. Isolated test configuration

- Created gitignored `.env.expenses-test.local` with Development keys and:
  - `EES_EXPENSES_WRITES=approved-safe-environment`
  - `EES_EXPENSES_APPROVED_SUPABASE_URL` matching Development URL
- `.env.local` was **not** redirected away from production.
- Approved test app: `http://127.0.0.1:3020` via `scripts/start-expenses-approved-test.cjs`
- localhost:3000 remained up on production credentials (Expenses saving still locked there).

## 6. Saved synthetic expense IDs

From `tmp/expenses-v13-persistence-acceptance.json` (Development only):

| Record | ID |
| --- | --- |
| General / depot electricity (approved + paid) | `ba8e7e71-889f-4342-8784-da4abfee7a9f` |
| Vehicle tyre expense (submitted, missing-receipt reason) | `295e72c2-feee-4967-b589-448c01c221d0` |
| Possible duplicate electricity draft | `4dad490d-61c6-436f-a170-51c1fe98533d` |
| PNG receipt attachment | `46a760e1-0e9e-4a0e-92e7-a906b4580844` |
| PDF receipt attachment | `b7f7253c-0ec4-4964-94fb-3eaa5635e5dc` |
| Synthetic vehicles | `EES-TEST-001`, `ทดสอบ-ส่วนตัว` |

## 7. Receipt upload and retrieval

| Step | Result |
| --- | --- |
| PNG upload → `ready` | Pass |
| PDF upload → `ready` | Pass |
| Sign-out / sign-in retrieve | Pass (2 ready attachments) |
| Signed PNG download HTTP 200 | Pass |
| PDF preview signed URL issued | Pass |

## 8. Authentication / authorisation results

| Step | Result |
| --- | --- |
| Unauthenticated bootstrap/register/bookings/duplicates/attachments | **401** |
| Submitter create/submit | Pass |
| Self-approval denied | Pass (`MANAGER_REQUIRED`) |
| Separate reviewer approve | Pass |
| Partial then final payment | Pass (`500.00` → `1250.50`) |
| Audit events retained | Pass (9 events) |
| Read-only write/approve denied | Pass (`EXPENSES_READ_ONLY`) |
| Cross-session retrieve | Pass |

## 9. Reporting verification

Register query for synthetic November data:

- `totalCount`: 3
- `summary.recorded`: 605050 satang (฿6,050.50)
- `summary.approved`: 125050 satang (฿1,250.50)

Authenticated Overview UI on `:3020` showed the same recorded/vehicle/depot split and pending review count.

## 10. Mobile validation

- 390px and 412px Overview layouts verified with live Development totals and enabled Add Expense.
- Screenshots: `output/expenses-centre-v13-activation/mobile-390-overview.png`, `mobile-412-overview.png`
- **Physical phone camera capture remains outstanding.**

## 11. Failures

None in the final persistence acceptance run: **30/30 passed**, 0 failed.

Earlier blocker during activation (resolved):

- Development `driver_accounts` lacked `driver_id` and `account_access` lacked some production columns; office auth resolution was hardened to tolerate the narrower Development schema without changing production behaviour.

## 12. Distinction: Development vs production

| Capability | Fixture-only | EES Development (now) | Production |
| --- | --- | --- | --- |
| Persistent expenses | No | **Yes — verified synthetic** | No schema / not activated |
| Private receipt durability | No | **Yes — verified synthetic** | Not activated |
| Office UI on localhost:3000 | Shows locked warning | Uses production DB → still locked | Writes refused |
| Isolated UI for activated testing | — | `http://127.0.0.1:3020` | — |

## 13. Remaining production activation requirements

Separate explicit owner authorisation is still required before any production Expenses work. Minimum future production package:

1. Production backup / restore plan and maintenance window.
2. Review whether production already has Vehicles / account schema prerequisites (it does for fleet; Expenses objects remain absent).
3. Apply the same reviewed V1 + V1.1 + V1.2 migrations to production only after approval.
4. Create private `expenses-receipts` bucket + restrictive policy verification on production.
5. Production-specific write-gate design (current gates permanently refuse confirmed production URL / `VERCEL_ENV=production`).
6. Synthetic-then-controlled pilot acceptance on production with non-genuine records first.
7. Explicit owner go-live for real company expense recording.

Until that separate authorisation exists, treat company expense saving as **Development-only**.
