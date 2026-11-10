# EES V20.3 — controlled iPhone Web Push TEST plan

**Status:** Preparation complete for local staging secrets/auth. **NO-GO** for send until isolated HTTPS staging exists.  
**Separation:** TEST notifications use `[TEST]` titles and tag `ees-fleet-test-not-operational`. Operational fleet outbox stays `push_disabled` until separately authorised.

## Existing readiness (code)

| Area | Status |
| --- | --- |
| Manifest | `public/manifest.json` — `display: standalone`, icons 192/512 |
| SW registration | `components/pwa-register.tsx` → `/sw.js` |
| Push handler + click deep-link | `public/sw.js` — same-origin `/…` href only → `/fleet-events?testPush=1` |
| Device subscription API | `POST/GET/DELETE /api/fleet-operations/subscriptions` |
| Test-push API | `POST /api/fleet-operations/test-push` gated by `EES_WEB_PUSH_TEST_ENABLED` |
| Delivery logging | `ees_fleet_push_test_attempts` (status / http_status / error_code) |
| Preferences / inbox | `ees_fleet_notification_preferences`, `ees_fleet_notification_inbox` |
| Office UI | Fleet Operations — Register device / on-device TEST / server TEST |
| VAPID | Staging keys in `.env.staging.local` (gitignored) via prep script |

## HTTPS staging — safe deployment options (owner approval required)

### Unsafe (do not use for this TEST)

Current Vercel project `fuel-bank-app` has `NEXT_PUBLIC_SUPABASE_URL` attached to **Production + Preview + Development**. Preview therefore still targets production Supabase `hafoaurzfgkkwpvzedvd`. **Do not** install/push-test against Preview while that remains true.

### Recommended (safest)

1. Create a **separate Vercel project** (e.g. `fuel-bank-app-staging`).
2. Point **only** that project at staging Supabase `wpmnjfncaoogssgpqxek` (anon + service role).
3. Add staging-only VAPID + `EES_WEB_PUSH_TEST_ENABLED=false` + monitor flags off.
4. Deploy main/staging branch there; use a distinct hostname (e.g. `ees-staging.…`).
5. Never copy production Supabase URL/keys into that project.

### Temporary alternative (still isolated)

Owner-approved HTTPS tunnel (cloudflared/ngrok) to a local Next process loaded **only** from `.env.staging.local`. No Vercel Production/Preview change. Suitable for one supervised iPhone TEST.

Prep helper (no deploy/send):  
`npx tsx scripts/prepare-staging-iphone-web-push-readiness.ts`

## Staging authentication

- Synthetic user: `staging-fleet-pilot@ees-development.invalid`
- `account_access`: `admin` / `active` (business read+write for subscriptions, preferences, inbox, test-push)
- Password: `EES_STAGING_PILOT_PASSWORD` in `.env.staging.local` only — **not** a production employee; do not clone production credentials

## iOS Home Screen requirements

1. **HTTPS** origin (Safari will not enable Web Push on insecure LAN HTTP except limited localhost cases).
2. Add to Home Screen from Safari (standalone PWA).
3. Open from Home Screen icon (not a Safari tab) before granting notification permission.
4. iOS 16.4+ with Web Push support.
5. User gesture → permission → `pushManager.subscribe` with VAPID public key.

## Exact owner sequence (after staging HTTPS is available)

1. Open staging HTTPS URL in Safari → Share → **Add to Home Screen**.
2. Launch from Home Screen → sign in as staging pilot → Fleet Operations.
3. Allow notifications → **Register device**.
4. Owner explicitly authorises one TEST: set `EES_WEB_PUSH_TEST_ENABLED=true` on staging runtime only.
5. Tap **Send server push test** once → confirm iPhone **shows** the `[TEST]` notification (do not treat provider HTTP 201 alone as receipt).
6. Tap notification → lands on `/fleet-events?testPush=1`.
7. Immediately set `EES_WEB_PUSH_TEST_ENABLED=false` again.
8. Record attempt row from test-push history + operator confirmation of on-device display.

## Do not

- Use current `fuel-bank-app` Preview while it points at production Supabase
- Send operational arrival/departure pushes
- Enable unattended push delivery from the fleet outbox
- Activate the Forth monitor / change geofences / schedule cron
- Deploy to production or commit secrets
