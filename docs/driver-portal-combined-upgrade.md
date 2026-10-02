# Driver Portal / Driver Operations combined upgrade

## Implementation and security

- Retained existing driver-cookie authentication, approval/linkage, office/admin
  guards, booking assignment and sequential event RPC. No credentials or events
  were rewritten. Progress still comes exclusively from driver_job_events.
- Phone-first Jobs now has a separate next/current card with pickup date, four
  operational summary figures, quieter completed work and no duplicated next card.
  nextDriverJob still refuses ambiguous equal pickup ordering.
- Header and Jobs use the canonical profile display name; official driver name
  and identity remain read-only. Profile has grouped personal details/preferences,
  existing secure password form and validated JPEG/PNG/WebP upload feedback.
- Header, Profile, admin Operations and Driver Directory resolve avatars from
  the existing private profile/bucket infrastructure. No storage-policy changes.
- Driver History remains own-driver, completed-only, newest-first and paginated.
  Cards now include completion date/time, pickup time, route, customer and vehicle.
- Admin retains its Operations/Active/Attention/Completed layout, adds History
  between Operations and Drivers, and reuses its existing job drawer/timeline.
- Admin History is a separate, bounded 20-row completed-event query, excludes
  completions today, supports literal-text search and completion-date range.
  Historical driver identity comes from the completion event, not a later booking
  assignment. Today retains current booking assignment semantics.
- All new admin routes call requireAdminAccess before reading data. Notification
  reads/counts are scoped to the verified admin's auth user ID. Mark-read is
  same-origin, body-size limited and rejects browser-supplied recipient identities.
- Waiting minutes use API/server time against persisted arrival time; departure
  ends waiting. The applied DB migration creates one notification per recipient
  and arrival event, locks the booking like the existing event RPC, and resolves
  notification records in the departure transaction without marking them read.
- The existing bell retains its existing support/fuel/maintenance items and adds
  persisted driver alerts, unread badge contribution, mark-read/mark-all-read,
  newest-first panel and links to the appropriate admin job drawer.
- Alert creation is evaluated by admin API polling every 60 seconds while an
  admin app is visible, and by manual refresh. There is no background scheduler
  installed, push notification, repeated popup or continuous GPS tracking.
  Detection can occur up to one polling interval after the 30-minute threshold.
  Departure resolution is transactional and does not depend on an open browser.

## Avatar investigation

The existing driver-avatars bucket is private, 5 MB, JPEG/PNG/WebP. The existing
upload helper validates actual decoded bytes, converts to bounded WebP without
metadata and saves an own-user/server-generated unique path. Live read-only
checks found a saved avatar and valid signed URLs; both Today job profiles had
the linked driver's photo.

Two UI defects were corrected: the header previously did not read profile/avatar
data, and the Profile mutation helper swallowed post-save reload failures but
still showed success. Avatar upload now returns the newly signed canonical
profile, applies it immediately, notifies the header and refreshes server data.
Failed reloads no longer produce false success feedback. Client file validation
and a distinct Uploading state were added; server validation remains authoritative.

A separate localhost cache failure was confirmed during browser testing:
`/_next/static/chunks/main-app.js` returned 404, preventing hydration and keeping
Profile on Loading. After stopping the dev server, its generated cache was moved
to `.next-driver-upgrade-dev-backup-20261002` (preserved, not deleted). Restart
restored that bundle to HTTP 200 and authenticated Profile API calls to HTTP 200.
This is evidence for the observed local loading failure, not proof of the exact
historical cause of the user's first unsuccessful photo interaction.

## Validation results

- Relevant tests: **99 passed, 0 failed** (six driver/navigation test files).
- TypeScript: passed separately, `npx tsc --noEmit`.
- Targeted lint: passed with no ESLint warnings/errors.
- Production build: passed, using the existing isolated-build option. The project
  build skips lint/types; those were explicitly run separately.
- Applied migration: table and both RPCs are visible in the live Supabase schema.
- Live read-only Today query: two jobs, valid profile avatars.
- Live read-only History queries: unfiltered, Joey/customer/vehicle search and
  date range execute successfully; no completed jobs before today exist to show.
- Unauthenticated own-profile, admin notifications, admin History and admin job
  detail requests returned HTTP 401.
- Real driver browser at 390 x 844: Profile loads; header and Profile show the
  stored photo, official Joey Test / ID 26 / vehicle 1998 remains unchanged;
  EN/TH works. Profile DOM has no horizontal overflow (scrollWidth 380, width 390).
- Real driver History: only its two completed jobs, newest first, correct pickup
  and completion times. Jobs: next future job prominent with its date, remaining
  Today 0, completed Today quieter, no duplicated next job in Upcoming.
- Completed detail: full four-event timeline, all five Maps links, Atip contact
  and completed state, no active progress CTA.
- Real driver navigation to /admin/driver-operations redirects to /driver; no
  office navigation renders.

**Not yet complete:** a newly selected photo's immediate-change/full-reload
verification; user-owned password change; real Joey-admin Operations/History/
Directory/bell checks; live 30-minute wait/duplicate/read/resolve test with an
explicitly identified disposable booking. Boundary/authorization/API tests and
SQL-contract assertions pass, but SQL-contract tests are not a substitute for
executing the waiting scenario against PostgreSQL. No existing event timestamps
were backdated, real jobs advanced or fabricated test bookings created.

No production deployment. Unrelated dirty worktree files preserved. Build-generated
TypeScript references restored; generated tsconfig.tsbuildinfo can change.

## Exact files changed in this implementation turn

Modified:

- app/api/admin/driver-operations/route.ts
- app/api/driver/profile/avatar/route.ts
- components/account-menu.tsx
- components/admin/driver-operations.tsx
- components/admin/driver-profile-browser.tsx
- components/driver/driver-home.tsx
- components/driver/driver-history.tsx
- components/driver/driver-profile.tsx
- components/driver/driver-portal-header.tsx
- lib/driver-operations.ts
- lib/driver-work-server.ts
- tests/driver-operations.test.cjs (new dependency mocks; existing coverage retained)

Added:

- app/api/admin/driver-notifications/route.ts
- app/api/admin/driver-operations/history/route.ts
- app/api/admin/driver-operations/jobs/[bookingId]/route.ts
- components/admin/driver-notifications.tsx
- components/admin/driver-operations-history.tsx
- lib/driver-notifications-server.ts
- tests/driver-upgrade.test.cjs
- scripts/verify-driver-upgrade.cjs (read-only diagnostics)
- docs/driver-portal-combined-upgrade.md

Previously generated, user-applied and unchanged this turn:
supabase/migrations/20261005100000_driver_pickup_wait_notifications.sql.

## Remaining live verification sequence

1. Driver uploads a test JPEG/PNG/WebP, confirms immediate Profile/header change,
   then reloads and verifies persistence. Any password change is user-owned.
2. User signs in normally as Joey at /admin/driver-operations. Verify tabs, shared
   avatar in Operations/Directory/drawer, History filter and bell/error states.
3. Identify a disposable test booking. Record arrival normally and use real server
   elapsed time, or a separately authorized isolated database fixture/transaction.
   Never backdate or delete historical operational events.
4. At 29 minutes: no waiting alert. At 30+: Attention + exactly one unread alert.
   Repeat refresh, verify no duplicate and correct unread count; open correct job,
   mark read, then record departure normally. Confirm Attention condition ends and
   stored notification resolves while its audit record remains.
