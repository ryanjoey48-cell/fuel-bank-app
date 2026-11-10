# EES V20.3 — dedicated Vercel staging project preparation

> **SUPERSEDED (owner requirement):** Do **not** create `fuel-bank-app-staging`.  
> Use the existing `fuel-bank-app` project with an isolated Preview instead.  
> Canonical plan: [`ees-fleet-operations-v20-3-vercel-preview-staging-plan.md`](./ees-fleet-operations-v20-3-vercel-preview-staging-plan.md).

**Status:** Withdrawn — retained for history only.  
**Goal (historical):** Permanent isolated HTTPS site for Fleet Ops + one supervised iPhone `[TEST]` Web Push.  
**No production aliases, domains, env vars, or databases may be changed by this work.**

| Identity | Value |
| --- | --- |
| Proposed Vercel project | `fuel-bank-app-staging` |
| Staging Supabase | `wpmnjfncaoogssgpqxek` |
| Production Supabase (protected) | `hafoaurzfgkkwpvzedvd` |
| Production Vercel project (untouched) | `fuel-bank-app` → `https://fuel-bank-app.vercel.app` |

## Why a separate project (not Preview)

On `fuel-bank-app`, `NEXT_PUBLIC_SUPABASE_URL` / anon key are attached to **Production + Preview + Development**. Preview therefore still targets production Supabase. A separate Vercel project is the safest permanent isolation: staging env vars cannot overwrite production project settings, domains, or aliases.

## Proposed staging Vercel configuration

| Setting | Proposed value |
| --- | --- |
| Project name | `fuel-bank-app-staging` |
| Framework | Next.js (same repo as production) |
| Root directory | `.` |
| Node | Match production (24.x) |
| Production branch for *this* project only | `main` **or** a dedicated `staging` branch (owner choice) |
| Custom domain (optional) | e.g. `ees-staging.<owner-domain>` — recommended for clear Home Screen labelling |
| Default hostname | `fuel-bank-app-staging.vercel.app` (acceptable for first TEST) |
| Deployment Protection | **Vercel Deployment Protection / Password Protection ON** (team members + shared password) |
| Cron | **None** — do not add `vercel.json` crons |
| Linked to production domains | **Never** |

### Isolation guarantees when using a separate project

- Staging deploy updates **only** `fuel-bank-app-staging`.
- Production project `fuel-bank-app` aliases, domains, and env vars remain unchanged.
- Staging must never receive `hafoaurzfgkkwpvzedvd` URL or production service-role / VAPID private keys.
- Post-deploy verification: hit staging `/api/fleet-operations/subscriptions` (authenticated) and confirm VAPID public key / `serverTestEnabled=false`; confirm browser Network calls go to `*.wpmnjfncaoogssgpqxek.supabase.co` only.

## Required staging environment variables (no secret values)

Set these on **`fuel-bank-app-staging` → Production** (and Preview on that project only if used). Source from `.env.staging.local` / staging Supabase dashboard — **never** from production Vercel pull.

### Required for iPhone Web Push TEST

| Variable | Staging expectation |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://wpmnjfncaoogssgpqxek.supabase.co` only |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Staging anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Staging service role only |
| `EES_APPROVED_STAGING_PROJECT_REF` | `wpmnjfncaoogssgpqxek` |
| `EES_FLEET_MONITOR_ALLOWED_PROJECT_REF` | `wpmnjfncaoogssgpqxek` |
| `EES_FLEET_MONITOR_ALLOWED_LOCATION_IDS` | `cccccccc-dddd-4eee-8fff-000000000002` |
| `EES_FLEET_MONITOR_ENABLED` | `false` |
| `EES_FLEET_MONITOR_SECRET` | Staging-only ≥32 chars (unused while disabled) |
| `EES_WEB_PUSH_TEST_ENABLED` | `false` until one approved send |
| `EES_WEB_PUSH_VAPID_PUBLIC_KEY` | Staging-only public key |
| `EES_WEB_PUSH_VAPID_PRIVATE_KEY` | Staging-only private key (**not** production) |
| `EES_WEB_PUSH_VAPID_SUBJECT` | e.g. `mailto:staging-fleet-pilot@ees-development.invalid` |

### Optional / later (not blocking first push TEST)

| Variable | Notes |
| --- | --- |
| Forth `FORTH_*` | Needed for GPS monitor pulses only; keep read-only if added |
| Google Maps keys | Needed for map UI; not required for subscription + server TEST push |

### Must never be set on staging

- Production Supabase URL or keys for `hafoaurzfgkkwpvzedvd`
- Production VAPID private key
- `EES_FLEET_MONITOR_ENABLED=true` or `EES_WEB_PUSH_TEST_ENABLED=true` at first deploy
- Any cron secret that enables unattended fleet monitor

## Environment-variable verification procedure (after owner deploy)

1. In Vercel UI for `fuel-bank-app-staging`, confirm URL host contains `wpmnjfncaoogssgpqxek` (read-only view of env — do not paste secrets into chat/git).
2. Confirm `fuel-bank-app` (production) env listing is **unchanged**.
3. Open staging site → DevTools Network → Auth/API calls must hit staging Supabase only.
4. Sign in as synthetic staging pilot only.
5. Fleet Operations → device status: VAPID public present, `serverTestEnabled` false.
6. Abort if any request targets `hafoaurzfgkkwpvzedvd`.

Local preflight (already available):  
`npx tsx scripts/prepare-staging-iphone-web-push-readiness.ts`  
`npx tsx scripts/verify-staging-vercel-env-contract.ts` (presence/isolation contract; no deploy)

## Authentication and HTTPS readiness

| Item | Status / action |
| --- | --- |
| Staging HTTPS | Provided by Vercel project hostname (or custom domain + TLS) |
| Staging pilot user | `staging-fleet-pilot@ees-development.invalid`, `account_access` admin/active |
| Password | Gitignored `EES_STAGING_PILOT_PASSWORD` in `.env.staging.local` |
| Supabase Auth Site URL | Set staging project Auth → Site URL to staging HTTPS origin |
| Redirect allow list | Add `https://fuel-bank-app-staging.vercel.app/**` and any custom staging domain `/**` |
| Production Auth URLs | Leave production Supabase Auth URLs unchanged |
| Sign-in method for TEST | Email/password (same-origin); no production employee clone |

## PWA / Web Push readiness (code)

| Capability | Location |
| --- | --- |
| Manifest / standalone | `public/manifest.json` |
| SW registration | `components/pwa-register.tsx` → `/sw.js` |
| SW scope | Default site root on **staging origin** (separate from production origin) |
| Push + click deep-link | `public/sw.js` → `/fleet-events?testPush=1` |
| Subscription APIs | `/api/fleet-operations/subscriptions` |
| Gated `[TEST]` send | `/api/fleet-operations/test-push` |
| Diagnostics | `ees_fleet_push_test_attempts` |
| Outbox delivery | Hard-coded off in monitor enqueue path |

**Hostname note:** Install the **staging** URL to Home Screen (label as EES Staging). Do not reuse the production Home Screen icon — different origins have separate service workers and push subscriptions.

## Staging access protection

1. Enable Vercel Deployment Protection / password on `fuel-bank-app-staging`.
2. Only the synthetic staging pilot (and owner-approved staging accounts) in staging `account_access`.
3. Do not invite production staff emails into staging Auth unless intentionally provisioned there.
4. Keep `EES_WEB_PUSH_TEST_ENABLED=false` except for the one-send window.

## Deployment checklist (owner-approved execution only)

### Create (once)

1. Owner approves creation of Vercel project `fuel-bank-app-staging` in the same team/org.
2. Import same Git repo; do **not** transfer production domains.
3. Set staging env vars listed above (Production env of the new project).
4. Enable Deployment Protection.
5. In Supabase **staging** Auth settings, add staging Site URL + redirect URLs.
6. Deploy once to `fuel-bank-app-staging`.
7. Run env verification procedure; abort on production Supabase leakage.
8. Leave `EES_WEB_PUSH_TEST_ENABLED=false`.

### First iPhone TEST (separate approval)

1. Safari → staging HTTPS → Add to Home Screen → open standalone.
2. Sign in as staging pilot → Register device.
3. Owner flips `EES_WEB_PUSH_TEST_ENABLED=true` on staging project only → redeploy or runtime update as applicable → one server TEST.
4. Confirm physical iPhone display + click-through.
5. Set `EES_WEB_PUSH_TEST_ENABLED=false` immediately.

### Rollback

1. Instant: disable Deployment Protection access / unpublish staging deployment in Vercel UI for `fuel-bank-app-staging` only.
2. Remove staging custom domain if added (does not affect production).
3. Revoke staging VAPID by rotating keys in staging env (does not affect production).
4. Disable or delete staging Auth users if compromised.
5. **Never** “fix” staging issues by editing `fuel-bank-app` production env.

## Exact owner approvals required next

1. **Create** Vercel project `fuel-bank-app-staging` (separate from `fuel-bank-app`).
2. **Set** staging-only env vars (Supabase `wpmnjfncaoogssgpqxek` + staging VAPID).
3. **Enable** Deployment Protection on that project.
4. **Update** staging Supabase Auth Site URL / redirect allow list for the new hostname.
5. **Deploy** once to staging (not production).
6. Later, separately: approve one `EES_WEB_PUSH_TEST_ENABLED=true` window for a single `[TEST]` notification.

Until those approvals are given, do not create the project, deploy, send notifications, enable monitor/cron, or modify production.
