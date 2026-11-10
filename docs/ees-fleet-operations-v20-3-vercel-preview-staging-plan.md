# EES V20.3 — staging via existing `fuel-bank-app` Preview only

**Owner requirement:** Do **not** create `fuel-bank-app-staging` or any new Vercel project.  
**Status:** Plan only. No env changes, no deploy, no commit/push until explicit owner approval.  
**Supersedes:** `docs/ees-fleet-operations-v20-3-vercel-staging-project-preparation.md` (separate-project recommendation withdrawn).

## 1. Exact existing Vercel project identity

| Field | Value |
| --- | --- |
| Team / scope | `ryanjoey48-cells-projects` |
| Project name | `fuel-bank-app` |
| Project ID | `prj_w2DllHvYeMPzc3XpQD1yFQ8PXVAF` |
| Production URL | `https://fuel-bank-app.vercel.app` |
| Latest production deployment (inspected) | `dpl_GMYGhiv7xWZKSfwGv5SMBbv7EkXQ` |
| Node | 24.x |
| Custom domains on team | **0** (only `*.vercel.app` aliases) |
| Local link | `.vercel/repo.json` → same project |

**Approved architecture**

| Environment | Vercel project | Supabase |
| --- | --- | --- |
| Production | `fuel-bank-app` | `hafoaurzfgkkwpvzedvd` (unchanged) |
| Staging Preview | **same** `fuel-bank-app` | `wpmnjfncaoogssgpqxek` |

## 2. Current Preview configuration risks (read-only findings)

### Environment variable scopes (names only)

| Variable | Current scopes | Risk |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Production + Preview + Development (**one shared entry**) | Preview builds bake **production** Supabase host |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Production + Preview + Development (shared) | Preview browser client uses production anon |
| `SUPABASE_SERVICE_ROLE_KEY` | **Separate** Production vs Preview secrets | Preview service-role is **not** the staging key (fingerprint ≠ `.env.staging.local`) |
| Forth `FORTH_*` | Production + Preview (shared) | OK for read-only Forth later; unrelated to DB isolation |
| Google Maps keys | Production + Preview + Development (shared) | Optional for first push TEST |
| `EES_WEB_PUSH_*` / `EES_FLEET_MONITOR_*` | **Absent** on Vercel today | Preview has no staging VAPID / isolation flags yet |

### Preview pull vs staging local (no secret values)

| Check | Result |
| --- | --- |
| Preview `NEXT_PUBLIC_SUPABASE_URL` host | **production** `hafoaurzfgkkwpvzedvd` |
| Preview anon fingerprint vs staging | **different** |
| Preview service-role fingerprint vs staging | **different** |
| Active Preview deployments | Multiple Ready Previews (age 3–4d) — all currently inherit shared production URL/anon |

### Deployment Protection

```text
ssoProtection.deploymentType = "all_except_custom_domains"
gitForkProtection = true
protectionBypass = automation-bypass present
```

Meaning: Vercel Authentication applies to **all** `*.vercel.app` deployments (including Preview and the production `fuel-bank-app.vercel.app` alias) because there are **no** custom domains. This is a **high risk for iPhone Home Screen / service worker / push** (see §4).

### Build-time `NEXT_PUBLIC_*`

`next.config.ts` embeds `NEXT_PUBLIC_SUPABASE_URL` / `ANON_KEY` at build time. A Preview that is not given staging values at **build** will ship a production browser client even if runtime `--env` later differs. Browser and server must both receive staging values for the same deployment.

### Branch-specific variables

`vercel env pull` supports `--git-branch`, but inspected project env listing shows **no** branch-scoped Supabase overrides today. CLI Preview from local files does not rely on Git branch env.

## 3. Safe Preview isolation plan (no changes applied yet)

### Risk of project-wide Preview re-point

If `NEXT_PUBLIC_SUPABASE_URL` / `ANON_KEY` are edited so Preview points at staging **project-wide**, then:

- **Every** future Preview (and existing Preview rebuilds) would use staging Supabase.
- Other active Preview URLs would stop mirroring production (may be desirable for DB safety, but is a behaviour change for any PR/preview workflow).
- Production must keep an unbroken Production-only copy of the production URL/anon/service-role during the edit (order matters).

### Recommended safer path for the first iPhone TEST

**Deployment-scoped overrides** on a single CLI Preview deploy (no dashboard mutation of shared Preview vars):

1. Keep Production / shared Preview dashboard vars **unchanged**.
2. Run one `vercel deploy` (not `--prod`) with `--build-env` **and** `--env` for all staging-critical keys from `.env.staging.local`.
3. That **one** deployment URL is the staging HTTPS target.
4. Other existing Previews continue to use current (production) Preview env until a later permanent split is approved.

This avoids accidental staging DB use by unrelated Previews and avoids a Production env edit window.

### Complete Preview-only variable set (for that staging deployment / later Preview scope)

| Variable | Staging value intent |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://wpmnjfncaoogssgpqxek.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | staging anon |
| `SUPABASE_SERVICE_ROLE_KEY` | staging service role (**not** production) |
| `EES_APPROVED_STAGING_PROJECT_REF` | `wpmnjfncaoogssgpqxek` |
| `EES_FLEET_MONITOR_ALLOWED_PROJECT_REF` | `wpmnjfncaoogssgpqxek` |
| `EES_FLEET_MONITOR_ALLOWED_LOCATION_IDS` | Pilot 002 depot UUID |
| `EES_FLEET_MONITOR_ENABLED` | `false` |
| `EES_FLEET_MONITOR_SECRET` | staging-only ≥32 |
| `EES_WEB_PUSH_TEST_ENABLED` | `false` until separate approval |
| `EES_WEB_PUSH_VAPID_PUBLIC_KEY` | staging-only |
| `EES_WEB_PUSH_VAPID_PRIVATE_KEY` | staging-only (**not** production) |
| `EES_WEB_PUSH_VAPID_SUBJECT` | staging mailto subject |

**Must never appear on the staging Preview deployment:** production Supabase URL, production service-role, production VAPID private key, monitor/push TEST enabled.

### Fail-closed expectations

- Fleet monitor already refuses production / mismatched project refs + empty location allowlist.
- Test-push stays disabled unless `EES_WEB_PUSH_TEST_ENABLED=true`.
- Post-deploy verification must prove browser and server both talk to `wpmnjfncaoogssgpqxek` only.
- Mismatched URL vs service-role must abort before any TEST send.

### Optional later permanent split (same project)

Only after owner approval of project-wide Preview behaviour:

1. Recreate/retain Production-only `NEXT_PUBLIC_SUPABASE_*` + Production service-role (prod values).
2. Set Preview-only `NEXT_PUBLIC_SUPABASE_*` + Preview service-role to **staging**.
3. Add Preview-only VAPID + `EES_*` flags (TEST/monitor false).
4. Leave Production scopes untouched thereafter.

## 4. Deployment Protection / PWA / Web Push findings

| Topic | Finding |
| --- | --- |
| HTTPS | Preview `*.vercel.app` is HTTPS — OK for Safari Web Push requirement |
| SW / manifest | App registers `/sw.js` at origin root; Preview origin ≠ production origin (good isolation) |
| Click-through | `/fleet-events?testPush=1` same-origin |
| Staging Auth redirects | Staging Supabase Auth Site URL / redirect allow list must include the **specific Preview hostname** (wildcard `https://*.vercel.app` only if Supabase allows; otherwise add exact Preview URL after deploy) |
| SSO protection | `all_except_custom_domains` likely blocks anonymous iPhone access to Preview |
| Home Screen risk | Vercel Authentication interstitial often breaks standalone PWA install, SW control, and notification deep links |
| Automation bypass | Exists for tooling; **not** a good permanent iPhone Home Screen solution |
| Production protection | Do **not** globally disable SSO to “make Preview work” without a Preview-scoped protection plan |

**Owner decision required before a useful iPhone TEST:** choose a Preview access mode that does not weaken Production, for example:

1. Preview-only Standard **password** protection (enter once in Safari before Add to Home Screen), or  
2. Temporarily disable Vercel Authentication for Preview only (if the plan/UI allows), keeping Production protected, or  
3. Accept that only Vercel-logged-in devices can test (usually **not** viable for owner iPhone).

## 5. Safe CLI Preview deployment procedure (prepare only — do not run yet)

Preserves local uncommitted work; no new branch; no Production deploy; no Production env mutation.

### Pre-deploy verification

1. Confirm local `.env.staging.local` URL ref = `wpmnjfncaoogssgpqxek`.
2. Confirm staging VAPID present; `EES_WEB_PUSH_TEST_ENABLED=false`; `EES_FLEET_MONITOR_ENABLED=false`.
3. Confirm linked project is `fuel-bank-app` / `prj_w2DllHvYeMPzc3XpQD1yFQ8PXVAF`.
4. Resolve Deployment Protection decision (§4).

### Deploy (Preview only)

```bash
# From repo root, with staging values supplied to BOTH build and runtime.
# Do NOT use --prod.
vercel deploy --yes ^
  --build-env NEXT_PUBLIC_SUPABASE_URL=... ^
  --build-env NEXT_PUBLIC_SUPABASE_ANON_KEY=... ^
  --env NEXT_PUBLIC_SUPABASE_URL=... ^
  --env NEXT_PUBLIC_SUPABASE_ANON_KEY=... ^
  --env SUPABASE_SERVICE_ROLE_KEY=... ^
  --env EES_APPROVED_STAGING_PROJECT_REF=wpmnjfncaoogssgpqxek ^
  --env EES_FLEET_MONITOR_ALLOWED_PROJECT_REF=wpmnjfncaoogssgpqxek ^
  --env EES_FLEET_MONITOR_ALLOWED_LOCATION_IDS=cccccccc-dddd-4eee-8fff-000000000002 ^
  --env EES_FLEET_MONITOR_ENABLED=false ^
  --env EES_FLEET_MONITOR_SECRET=... ^
  --env EES_WEB_PUSH_TEST_ENABLED=false ^
  --env EES_WEB_PUSH_VAPID_PUBLIC_KEY=... ^
  --env EES_WEB_PUSH_VAPID_PRIVATE_KEY=... ^
  --env EES_WEB_PUSH_VAPID_SUBJECT=...
```

(Prefer a small owner-approved wrapper script that reads `.env.staging.local` and never prints secrets.)

### Post-deploy verification

1. Note Preview URL; confirm Environment = Preview (not Production); Production alias unchanged.
2. In browser DevTools on Preview: API/Auth hosts must be `wpmnjfncaoogssgpqxek.supabase.co` only.
3. Sign in as staging pilot only; open Fleet Operations; confirm VAPID public present and server TEST disabled.
4. Abort if any call hits `hafoaurzfgkkwpvzedvd`.

### Rollback / disable

1. Do not promote the Preview to Production.
2. Remove/unpublish that Preview deployment in Vercel UI, or leave it idle with TEST flag false.
3. If project-wide Preview env was later changed, restore Production-only scopes first; never “fix” by editing Production values to staging.

## 6. Staging authentication readiness

| Item | Status |
| --- | --- |
| Staging pilot | `staging-fleet-pilot@ees-development.invalid` |
| `account_access` | `admin` / `active` (subscriptions, preferences, inbox, test-push) |
| Password | `.env.staging.local` `EES_STAGING_PILOT_PASSWORD` (gitignored) |
| Production employees | Not cloned |
| Supabase Auth URLs | Must add the Preview origin on **staging** Supabase after URL is known; do not change production Auth URLs |

## 7. Production isolation verification procedure

1. Before/after: `vercel env ls` — Production scopes for Supabase URL/anon/service-role unchanged.
2. `https://fuel-bank-app.vercel.app` still serves Production deployment / prod Supabase.
3. Staging Preview Network tab → staging host only.
4. Monitor remains disabled; outbox delivery remains off; no cron; no Forth writes; no TEST send until separate approval.

## 8. Remaining owner approvals

1. Accept **existing-project Preview** plan (no new Vercel project).
2. Choose isolation method: **(A)** one-off CLI deploy with build/runtime staging overrides, or **(B)** permanent Preview-scope env split.
3. Decide **Deployment Protection** mode compatible with iPhone Home Screen **without** weakening Production.
4. Approve adding the Preview HTTPS origin to **staging** Supabase Auth redirect allow list.
5. Approve the CLI Preview deploy command (still not Production).
6. Later, separately: one `EES_WEB_PUSH_TEST_ENABLED=true` window for a single `[TEST]` notification.

Until those approvals: do not modify env vars, deploy, commit, push, enable monitor/cron, or send notifications.
