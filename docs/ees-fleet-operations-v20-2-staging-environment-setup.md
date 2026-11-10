# EES V20.2 — safe staging environment setup

**Status:** preparation only. No cloud project created. No env switch. No SQL applied.  
**Related:** `docs/ees-fleet-operations-v20-2-database-environment-safety.md`

---

## 1. Production identity (do not touch for experiments)

| Field | Value |
| --- | --- |
| Dashboard name | Fuel Tracker App |
| Project ref | `hafoaurzfgkkwpvzedvd` |
| Classification | **CONFIRMED PRODUCTION** |
| Used by | Vercel Production, Preview, Development, local `.env.local` |
| Live scale (read-only) | 103 locations, 1572 bookings, 2729 fuel logs |

Code guard: `lib/ees-database-environment.cjs` refuses experimental SQL against this ref.

---

## 2. Recovered Supabase projects (authorised CLI list)

| Name | Ref | Status | Region | Created | Role |
| --- | --- | --- | --- | --- | --- |
| Fuel Tracker App | `hafoaurzfgkkwpvzedvd` | ACTIVE_HEALTHY | ap-northeast-1 | 2026-03-25 | **Production** |
| **EES Development** | `wpmnjfncaoogssgpqxek` | ACTIVE_HEALTHY | ap-northeast-2 | 2026-10-28 | **Staging target (owner preferred)** |
| Expert Express Sender | `kiewhxiwxmpijhlldlpm` | INACTIVE | ap-southeast-2 | 2026-03-30 | Legacy; do not use without revival + review |

**Finding (2026-11-01 read-only inventory):** EES Development is healthy, isolated from Vercel Production, and currently **greenfield** for EES Locations / Booking / Fleet PostgREST tables (`PGRST205`). No Finance Centre tables detected via API. Local `.env.staging.local` prepared (gitignored). Migration approval: `docs/ees-fleet-operations-v20-2-staging-migration-approval.md`.

Dashboard: https://supabase.com/dashboard/project/wpmnjfncaoogssgpqxek

---

## 3. Environment separation plan

| Layer | Supabase | Secrets | Monitor | Push |
| --- | --- | --- | --- | --- |
| Production | `hafoaurzfgkkwpvzedvd` only | Production vault / Vercel Production | Off until separate prod approval | Off |
| Staging | Owner-approved ref (candidate `wpmnjfncaoogssgpqxek`) | Separate anon + service role | `EES_FLEET_MONITOR_ENABLED=false` by default | `EES_WEB_PUSH_TEST_ENABLED=false` |
| Local | Point at staging **only after** owner approval | `.env.staging.local` (gitignored) | false | false |

### Templates (placeholders only)

Use `.env.example` keys. Create locally (never commit):

- `.env.staging.local` — staging URL + keys for `wpmnjfncaoogssgpqxek` (or replacement); template: `.env.staging.example`
- `EES_FLEET_MONITOR_ALLOWED_PROJECT_REF` — must equal staging ref (fleet monitor refuses production / mismatches)
- Forth read-only keys in staging runtime — see `docs/ees-fleet-operations-v20-3-staging-forth-credentials.md`
- Keep `.env.local` on production until switch approval

Required staging flags:

```env
NEXT_PUBLIC_SUPABASE_URL=https://<APPROVED_STAGING_REF>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<staging-anon>
SUPABASE_SERVICE_ROLE_KEY=<staging-service-role>
EES_FLEET_MONITOR_ENABLED=false
EES_WEB_PUSH_TEST_ENABLED=false
EES_APPROVED_STAGING_PROJECT_REF=<APPROVED_STAGING_REF>
```

**No silent production fallback:** tooling must call `assertApprovedStagingTarget(url, EES_APPROVED_STAGING_PROJECT_REF)` before any staging DDL helper. Never default missing staging URL to production.

---

## 4. Staging database baseline (after owner approval)

Do **not** clone production customer/booking/HR/finance rows without explicit approval. Prefer synthetic Directory + CAL-COMP fixture.

### Minimum schema chain

1. Existing Locations Directory migration (if absent on staging): `supabase/migrations/20261019100000_ees_locations_directory.sql`
2. Map pins (if absent): `docs/ees-locations-map-pins-review-only.sql` + post-install verification
3. `docs/ees-fleet-operations-v20-review-only.sql` + verification  
   - Adds `ees_locations.is_active` (additive; not a duplicate of `verification_status`)
4. `docs/ees-forth-locations-import-v20-review-only.sql`
5. `docs/ees-fleet-operations-v20-2-review-only.sql` + verification

Rollback: V20.2 → Forth → V20 (documented rollback scripts).

Isolated PGlite proof (no cloud): `tests/calcomp-pilot-001-migration-safety.test.cjs`, `tests/fleet-operations-database.test.cjs`.

### Objects required for pilot

Locations, map pins, Forth links, geofence zones + history, vehicle geofence state, visit events, review history, monitor lease/runs, notification outbox, push subscriptions/prefs/inbox (for V20.3 prep), booking_diary FK target (empty or synthetic rows only).

---

## 5. CAL-COMP Pilot 001 on staging (after SQL)

Owner config already recorded: `output/v20-2-calcomp-pilot-001-owner-approval.json`

1. Insert/link synthetic or authorised CAL-COMP Directory row (do not pull production UUID blindly unless cloning approved).  
2. Link Forth `2742427`; confirm pin at `13.234431, 99.806063`; radius 150 m provisional.  
3. Keep monitor/push disabled until supervised test.  
4. Feed controlled GPS into existing engine fixtures / supervised read-only Forth snapshots.  
5. One outbox intent per event with push disabled.

Production Directory ID `74ac5276-…` is production evidence only until staging has its own row.

---

## 6. Owner approvals required next

1. Confirm **EES Development** `wpmnjfncaoogssgpqxek` as Fleet Operations staging (or name another ref).  
2. Authorise local `.env.staging.local` creation and optional temporary local switch (not Vercel).  
3. Authorise staging schema inventory + SQL apply order above.  
4. Authorise synthetic CAL-COMP fixture data (no prod clone by default).  
5. Later: supervised monitor + V20.3 single iPhone test — separate approvals.

**Do not** create a new Supabase project until the owner rejects the recovered candidate or requests a fresh empty project.
