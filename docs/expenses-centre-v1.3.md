# EES Expenses Centre V1.3 — delivery report

## Verdict

V1.3 fixes the empty `/expenses-centre` workspace and consolidates persistence messaging. **Permanent expense saving is still not activated.** Localhost:3000 continues to use confirmed production Supabase (`hafoaurzfgkkwpvzedvd`), which has no Expenses schema. EES Development (`wpmnjfncaoogssgpqxek`) remains an unapproved candidate without Expenses tables, Vehicles REST exposure, or a private receipts bucket. No remote migration, production write, commit, push or deployment was performed.

## 1. Complete list of changes

- Authenticated bootstrap no longer fails hard when Expenses tables are missing. It returns a degraded snapshot (`ready:false`, `readiness:'schema_unavailable'`) with the signed-in user, role capabilities and Vehicles when available.
- Overview/register render zeroed management cards, the full office register chrome and a premium empty state instead of an almost blank page.
- Multiple large persistence banners are replaced by **one** configuration notice that explains why Add Expense is locked.
- Register queries are skipped when schema/query support is absent, avoiding a second false “register unavailable” error.
- Readiness helper formalises `schema_unavailable | schema_upgrade_required | private_storage_required | activation_required | ready`.
- Staging readiness probe extended for Booking Diary / booking links / duplicate resolutions and `expenses_register` / `expenses_duplicate_matches`.
- V1.3 owner activation package prepared for schema version **3** (V1 + V1.1 + V1.2). No SQL was applied remotely.

## 2. Files modified / added

Modified:

- `app/api/expenses-centre/route.ts`
- `components/expenses-centre.tsx`
- `components/expenses-centre.module.css`
- `components/expenses-register.tsx`
- `lib/expenses.ts`
- `lib/expenses-server.ts`
- `lib/expenses-fixtures.ts`
- `scripts/expenses-readiness.cjs`
- `tests/expenses-activation-guards.test.cjs`
- `.env.expenses-test.example`

Added:

- `lib/expenses-readiness-state.ts`
- `docs/expenses-centre-v13-activation-plan.md`
- `docs/expenses-v13-activation-review-only.sql`
- `tests/expenses-v13.test.cjs`
- this report

Evidence: `tmp/expenses-v13-*.txt`, `tmp/expenses-v13-readiness.json`, `output/expenses-centre-v13/`.

## 3. Database environment identification

| Profile | Project ref | Class | Used by localhost:3000 | Expenses writes |
| --- | --- | --- | --- | --- |
| `.env.local` | `hafoaurzfgkkwpvzedvd` | CONFIRMED_PRODUCTION | **Yes** | Refused / not approved |
| `.env.vercel-preview.local` | `hafoaurzfgkkwpvzedvd` | CONFIRMED_PRODUCTION | No | Refused / not approved |
| `.env.staging.local` | `wpmnjfncaoogssgpqxek` | CANDIDATE_STAGING (EES Development) | No | Not approved |
| `.env.expenses-test.local` | — | Not created | No | — |

A localhost browser URL is not evidence of a safe development database connection.

## 4. Migration status

| Migration | Status |
| --- | --- |
| `20261109090000_expenses_centre_review_only.sql` | Prepared only; not applied remotely |
| `20261110100000_expenses_centre_v11_review_only.sql` | Prepared only; not applied remotely |
| `20261110120000_expenses_centre_v12_review_only.sql` | Prepared only; not applied remotely |
| `docs/expenses-v13-activation-review-only.sql` | Prepared only; requires schema_version=3 + private bucket + owner acknowledgement |

**No Expenses migration was executed against production or EES Development in this run.**

## 5. Storage bucket status

- Production / localhost profile: Expenses private bucket not activated for this feature path.
- EES Development probe: `expenses-receipts` metadata request still not verified (`status` 400 / not private-confirmed).
- Application still requires a **private** `expenses-receipts` bucket before write readiness can become `ready`.

## 6. RLS verification

- Existing review-only migrations retain authenticated SELECT-only table grants, command RPCs and restrictive receipt storage policy design.
- Isolated PostgreSQL contract remains covered by prior V1.1/V1.2 synthetic engine tests.
- Remote RLS on EES Development **cannot** be verified until migrations are owner-approved and installed.

## 7. Expense saving status

| Mode | Status |
| --- | --- |
| Fixture preview | Temporary in-memory only; refresh resets |
| Localhost authenticated app | UI operational; **saving locked**; degraded readiness shown honestly |
| EES Development persistence | **Not activated** — schema/bucket/approval absent |
| Production persistence | **Refused** by server gates and not authorised |

## 8. Receipt persistence status

Receipt upload/download protocol from V1–V1.2 is preserved (private originals, pending→ready finalisation, signed URLs, soft removal). Cross-session receipt retrieval on a cloud project has **not** been verified because persistence is not activated. HEIC originals remain accepted by signature where present; inline HEIC preview is not claimed. Physical-phone camera validation remains incomplete.

## 9. Test results

- Focused V12/V13/activation suite: **15/15 passed** (`tmp/expenses-v13-focused-tests.txt`).
- Expenses feature TypeScript: **passed** (`tmp/expenses-v13-feature-types.txt`).
- Feature/project lint via `scripts/lint.cjs`: **0 errors** (12 pre-existing unrelated warnings) (`tmp/expenses-v13-feature-lint.txt`).
- Unauthenticated API probes: bootstrap/register/duplicates/attachments/bookings returned **401**.
- Whole-project TypeScript / full production build: not re-claimed in this run; prior unfinished Finance/Vehicle Performance work remains untouched.

## 10. Browser acceptance results

- Desktop authenticated Overview: single configuration notice, zeroed KPI cards, premium empty hero. Screenshot: `output/expenses-centre-v13/desktop-overview-empty.png`.
- Desktop All Expenses: full register filters/export/print chrome with 0 entries and empty-state copy; live Vehicles populate the registration filter from the connected production fleet read path.
- Mobile 390px and 412px register layouts: no dual banners; Add Expense remains locked with explanation; controls remain usable. Screenshots: `output/expenses-centre-v13/mobile-390-register.png`, `mobile-412-register.png`.
- Physical iPhone/Android camera capture: **not verified**.

## 11. Remaining blockers

1. **Owner approval** to install Expenses on isolated EES Development only (exact wording in §12).
2. Vehicles / Booking Diary prerequisites on that development project must be inspected and completed before Expenses activation.
3. After installation: synthetic save → receipt upload → refresh → sign-out → sign-in → retrieve → signed download → approval/payment → unauthorised denial.
4. Physical device camera/HEIC/network interruption acceptance.
5. Separate later decision for any production activation.

## 12. Exact production / development activation requirements

### Required owner approval (single action — Development only)

> Approve isolated Expenses installation on **EES Development** project ref `wpmnjfncaoogssgpqxek` only: apply the reviewed V1 + V1.1 + V1.2 migrations, create the private `expenses-receipts` bucket, run `docs/expenses-v13-activation-review-only.sql`, create `.env.expenses-test.local` with matching `EES_EXPENSES_APPROVED_SUPABASE_URL` and `EES_EXPENSES_WRITES=approved-safe-environment`, and allow synthetic persistence tests. Do **not** migrate or enable Expenses on production `hafoaurzfgkkwpvzedvd`.

Full sequence: `docs/expenses-centre-v13-activation-plan.md`.

### Production

Not authorised by this delivery. Production remains refused by `isConfirmedEesProductionUrl` and `VERCEL_ENV=production` gates. A later production activation needs a separate owner decision, backup plan and migration review.

## Mode distinction (do not conflate)

| Capability | Fixture-only | Development DB (after approval) | Production |
| --- | --- | --- | --- |
| UI / workflows | Yes (temporary) | Intended target | UI visible; writes refused |
| Permanent records | No | Only after approved install + acceptance | Not activated |
| Private receipt durability | No | Only after approved install + acceptance | Not activated |
| Office-ready company use | No | After synthetic acceptance | Separate later decision |

Expenses Centre is **not** permanently operational for company recording until database writes, private storage and cross-session retrieval are genuinely verified on an approved environment.
