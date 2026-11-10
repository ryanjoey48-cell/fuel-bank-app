# EES V20.3 — main website integration readiness

**Owner direction:** One main website, one Vercel project `fuel-bank-app`. No extra Vercel projects or permanent staging sites.  
**Status:** Plan + verification only. No production migration, deploy, monitor, or push activation until explicit approval.  
**Production Supabase:** `hafoaurzfgkkwpvzedvd` (protected)  
**Development Supabase:** `wpmnjfncaoogssgpqxek` (isolated testing; keep available)

## Architecture (confirmed)

| Layer | Target |
| --- | --- |
| Main website / Vercel | `fuel-bank-app` → `https://fuel-bank-app.vercel.app` |
| Production DB | `hafoaurzfgkkwpvzedvd` only |
| Dev / isolated testing DB | `wpmnjfncaoogssgpqxek` |
| App ↔ DB rule | Production website must **never** point at Development Supabase |

## 1. Integration readiness (application)

| Area | State |
| --- | --- |
| Fleet Operations UI | Present; uses `storagePending` / missing-table handling when V20 storage absent |
| Forth 466 import / review | Code + reconciliation ready; production Forth tables **not** installed yet |
| Geofence / visit / duration | Engine + monitor code ready; production tables/RPCs **absent** |
| Booking Diary match | FK expects real `booking_diary(id)` UUID — **production already has 1572 bookings** (do **not** use staging stub) |
| Existing Fleet Tracking / other EES | Unchanged paths; continue on production schema |
| Feature gating | Monitor off unless `EES_FLEET_MONITOR_ENABLED=true`; push TEST off unless `EES_WEB_PUSH_TEST_ENABLED=true`; outbox delivery hard-coded off |
| Safe code deploy before DDL | **Possible**: ship UI with storage banner; do not enable monitor/push until schema + approvals |

### Production schema probe (read-only, 2026-11-01)

| Object | Production |
| --- | --- |
| `ees_locations` | Present (103); `verification_status` yes; **`is_active` missing** |
| `ees_location_map_pins` | Present (0 rows) |
| `booking_diary` | Present (1572); id UUID-compatible |
| `fuel_logs` | Present (2729) |
| `account_access` | Present (4 active office users) |
| `ees_fleet_*` / Forth link/import/outbox tables | **Absent** (`PGRST205`) |
| Fleet RPCs | **Absent** |

## 2. Production migration package (additive — not applied)

**Do not** apply the staging booking-diary stub on production.  
**Do not** transfer synthetic staging events or staging Directory UUIDs into production.

### Proposed apply order (owner-authorised only)

| # | Package | Notes |
| --- | --- | --- |
| 0 | Operator backup/PITR checklist | Record Dashboard backups/PITR for `hafoaurzfgkkwpvzedvd`; prefer restore-to-new-project drill |
| 1 | Confirm Locations helpers | Production already has Directory + map-pin table; skip greenfield Locations migration if already installed |
| 2 | `docs/ees-fleet-operations-v20-review-only.sql` | Adds `ees_locations.is_active` (default true) + fleet geofence/visit/monitor/push tables + RPCs; FK to **live** `booking_diary` |
| 2v | `docs/ees-fleet-operations-v20-verification-read-only.sql` | Verify |
| 3 | `docs/ees-forth-locations-import-v20-review-only.sql` | Forth links, import audit, pilot sites |
| 4 | `docs/ees-fleet-operations-v20-2-review-only.sql` | Review actions + notification outbox |
| 4v | `docs/ees-fleet-operations-v20-2-verification-read-only.sql` | Verify |

### Explicitly excluded from production

- `docs/ees-fleet-operations-v20-2-staging-booking-diary-stub-review-only.sql`
- Staging-only synthetic CAL-COMP / Pilot 002 Directory rows and synthetic GPS events
- Any bulk copy of staging data into production

### Rollback

Use matching rollback SQL in reverse order (`v20-2` → Forth → `v20`). Treat SQL rollback as incomplete without verified backup/PITR. Dropping `is_active` after app depends on it needs coordinated release.

### Data preservation

Additive DDL only for fleet objects. No intended updates to Booking Diary, Fuel Logs, Maintenance, Weekly Mileage, HR, Finance, or Vehicle Performance row content. Only Directory change is nullable-safe `is_active boolean not null default true`.

## 3. Main-domain iPhone Web Push readiness

| Item | State |
| --- | --- |
| HTTPS main site | `https://fuel-bank-app.vercel.app` |
| Auth | Real production `account_access` users (not staging pilot) |
| Manifest / SW / push / click-through | Implemented (`public/manifest.json`, `public/sw.js`, Fleet Operations UI) |
| Subscription / preferences / inbox / TEST API | Implemented; **tables missing until V20 DDL** |
| VAPID on Vercel Production | **Not configured today** — generate **production** keys (do not reuse staging private key) |
| Operational push | Must stay off; outbox `deliveryEnabled` hard-coded false |
| Controlled TEST | After DDL + VAPID: Home Screen → Register device → brief `EES_WEB_PUSH_TEST_ENABLED=true` → one `[TEST]` → confirm on-device → disable |
| Deployment Protection | SSO on `*.vercel.app` may affect standalone PWA; resolve without weakening Production carelessly |

## 4. Forth depot intelligence (production — after schema approval)

Preserve (configure only after DDL + separate owner approval):

| Fact | Value |
| --- | --- |
| Office | Forth `1708908` — **no** depot geofence |
| Lorry depot | Forth `1977073` |
| Forth pin | `13.768732, 100.766033` |
| Owner Maps ref | `13.7688008, 100.7657385` |
| Radius | 120 m provisional |

Staging Pilot 002 remains completed on Development only. Do **not** auto-replicate synthetic staging events into production.

## 5. Safe deployment process (same Vercel project)

1. Keep Vercel Production env on **production** Supabase only.  
2. Deploy app code with monitor/push flags **false** (or unset).  
3. UI remains safe while fleet tables missing (`storagePending`).  
4. Apply production SQL package only after backup checklist + owner word.  
5. Configure production VAPID; run single-device `[TEST]` under separate approval.  
6. Import/review Forth locations; confirm depot pin; enable geofence under separate approval.  
7. Supervised monitor pulses last — still no cron until authorised.

**No new Vercel project. No Production → Development URL switch.**

## 6. Verification run (this session)

| Check | Result |
| --- | --- |
| Focused fleet / isolation / push / staging-gate tests | 13/13 pass |
| TypeScript `tsc --noEmit` | pass |
| ESLint | 0 errors (3 pre-existing warnings) |
| Isolated production build | see session build log |

## 7. Risks to existing EES

| Risk | Mitigation |
| --- | --- |
| Adding `is_active` on live Directory | Default `true`; coordinate app release; verified backup first |
| Accidental Production env → Dev DB | Forbidden; verify URL ref before every deploy |
| Enabling monitor/push too early | Flags default off; outbox delivery hard-coded off |
| Forth bulk import noise | Import as drafts; individual review; no auto geofence |
| Booking stub on production | **Never**; real `booking_diary` already present |
| PWA behind Vercel SSO | Test Home Screen carefully; adjust Preview/prod protection with care |
| SQL rollback alone | Insufficient — require PITR/backup proof |

## 8. Exact owner approval steps (controlled rollout)

1. Confirm one-website / one-Vercel-project direction (this doc).  
2. Complete production backup/PITR checklist for `hafoaurzfgkkwpvzedvd`.  
3. Approve **additive production SQL package** (V20 → Forth → V20.2; **no** booking stub).  
4. Approve production app deploy with flags off (optional before or after DDL).  
5. Approve production VAPID + one `[TEST]` push on main domain.  
6. Approve Forth import / depot pin / 120 m geofence enablement (office excluded).  
7. Approve supervised GPS monitor pulses (still no cron / no operational push until separate word).

Until each step is authorised: no migration apply, no production config writes, no monitor, no operational notifications.
