# Driver mobile operations / profile phase

## Deployment and scope

The user applied `supabase/migrations/20261004100000_driver_profiles_and_avatars.sql`.
Read-only live checks confirmed the profile table and private avatar bucket are available.
No further migration is required for the application implementation.

Preserved: signup, approval, linking, login routing, Booking Diary assignment, opaque
driver sessions, sequential event RPC, five Google Maps options and Atip's contact.
No POD, signatures, background tracking, push notifications or office event editing.

## Pages

- `/driver`: compact Home with event-derived statuses, green/muted completed cards,
  unfinished Today work first and one unambiguous next job only. Same date grouping.
- `/driver/history`: completed assigned jobs, newest completion first, 20 per page;
  existing detail links retain navigation and the progress timeline.
- `/driver/profile`: private profile, photo, display name, personal phone, language
  preference, official identity, account email and password section.
- `/driver/jobs/[bookingId]`: single next-action control fixed above mobile navigation;
  full timeline remains visible. Desktop control appears before the timeline.
- `/admin/driver-operations`: read-only Today jobs, six summary cards, driver/profile
  details, timelines, event GPS availability and optional valid-event map links.
  All-driver profile selector reuses the existing Driver Accounts API/list without
  changing User Management. Admin menu gains only the Driver Operations link.

Driver navigation has Jobs / History / Profile, fixed at the bottom on phone widths,
and below the existing header on desktop. Safe-area padding protects content/actions.
Driver Home and admin operations refresh every 60 seconds while visible; Operations
also has Refresh, an update timestamp and explicit stale-data feedback on fetch errors.
This is polling, not realtime. Profile lookup is on demand, not continuous polling.

## Security / data design

`driver_profiles.auth_user_id` references the existing linked account UUID. It stores
only editable display name, personal phone and avatar path, never passwords or Auth
tokens. Official name/vehicle come from the linked `drivers` record; email/last login
come from Supabase Auth. Signup phone metadata is the historical fallback until a
canonical profile exists. A first avatar upload preserves that phone fallback.
Language uses the existing EN/TH provider and `fuel-bank-language` local storage.

All driver profile endpoints verify the existing HttpOnly portal cookie. IDs are derived
from that verified session, not request input. PATCH accepts only displayName/phone.
Mutations require an exact same-origin Origin header. JSON/multipart bodies have
stream-enforced size limits, including requests without Content-Length.

Avatar bucket is private, maximum 5 MB, JPEG/PNG/WebP only. Server-side Sharp decodes
actual bytes, rejects other/animated formats and excessive pixel counts, re-encodes to
at most 512px WebP and strips EXIF/GPS metadata. Names are generated under the verified
account UUID; SQL additionally constrains avatar paths to their own UUID folder.
Drivers cannot nominate another account/path. Uploads never expose a service key.
Reads use 120-second signed URLs only after driver-own/admin authorization. Successful
replacement removes the preceding avatar; failed profile persistence removes the new
unreferenced upload. Concurrent replacements may leave an orphan object for later cleanup.

Change Password uses the verified portal identity to obtain the account email. Because
the portal cookie is not a Supabase Auth JWT, current-password reauthentication obtains
a transient same-user Supabase session, then calls `auth.updateUser({ password })`.
Client-provided emails/IDs are rejected; the returned authenticated user must match.
Other portal sessions are revoked and the transient Auth session is signed out globally.
No passwords are persisted/logged. Password minimum is 12 characters, maximum 128.
Actual credential changes must be tested by the user, not by browser automation.
Official reference: https://supabase.com/docs/reference/javascript/auth-updateuser

History filters completion events by verified driver ID and independently checks current
booking ownership again before returning jobs. Event reads are bounded/paginated batches.
Home and Operations derive status from the latest existing `driver_job_events` entry:
no events → Ready; pickup_arrived → At pickup; pickup_departed → En route;
delivery_arrived → At delivery; job_completed → Completed. Fetch failure is not Ready.
Tied pickup times do not create an arbitrary next-job label.

Both new admin APIs call existing `requireAdminAccess` before queries, retaining verified
Supabase user + active-admin permissions and authoritative driver precedence. No email
hardcoding. Client menu/page checks are presentation only, not data authorization.
The all-driver profile endpoint resolves account → official driver server-side.
Existing middleware blocks `/admin/*` for driver portal cookies before office rendering.

GPS is exclusively from explicit event actions. Null coordinates show No GPS and never
produce map links. Only finite in-range coordinate pairs generate an event-location link.
Pickup-time warnings describe missing recorded arrival, not inferred physical absence.

All new driver screens/controls and the admin view support EN/TH. No auth/approval,
User Management, Fuel, Fleet, Reports or Booking Diary layout changes were made.

## Verification

- Relevant tests: 88 passed, 0 failed (operations, existing event/security/routing suites).
- TypeScript: passed separately from production build.
- Targeted lint: all changed application files passed without warnings/errors.
- Production build: final isolated build passed, including the all-driver profile viewer
  and its admin-protected API. Build skips lint/type checks; those are run separately.
- Live migration availability: passed; private bucket config confirmed.
- Unauthenticated live requests to the own-profile, Operations and admin profile
  endpoints all returned 401 after restarting the development server.
- Recovered a broken generated Next.js cache by moving it to
  `.next-driver-operations-dev-backup-20261002` (preserved, not deleted).
  Browser automation still timed out on Profile reload; authenticated verification
  remains outstanding despite the server repair.
- Live Home: Joey Test / vehicle 1998, both Today jobs showed Completed from events;
  future jobs showed Ready. Browser DOM width check at 390px showed no overflow.
- New read-only live Operations query: returned both Joey Test Today jobs and exact
  stored timestamps. First job's four events had no GPS; second job's departure,
  arrival and completion had captured GPS. No new events/bookings/accounts were written.
- Browser navigation/control became unreliable (repeated focus/navigation timeouts).
  Live Profile save/upload, History navigation, sticky action interaction, EN/TH screen
  checks and Joey's authenticated admin view are NOT yet verified. Await browser recovery
  and user-owned sessions. Do not mark the phase complete based only on automated tests.

## Files in this implementation pass

Modified:

- app/driver/(protected)/layout.tsx
- app/driver/(protected)/page.tsx
- components/driver/driver-home.tsx
- components/driver/driver-job-detail.tsx
- components/top-navigation.tsx
- lib/driver-portal-server.ts (exports existing safe job projection/converter)
- package.json
- package-lock.json (explicit Sharp dependency, existing version 0.34.5)

Added:

- app/driver/(protected)/history/page.tsx
- app/driver/(protected)/profile/page.tsx
- app/driver/(protected)/error.tsx
- app/(dashboard)/admin/driver-operations/page.tsx
- app/api/driver/profile/route.ts
- app/api/driver/profile/avatar/route.ts
- app/api/driver/profile/password/route.ts
- app/api/admin/driver-operations/route.ts
- app/api/admin/driver-operations/profiles/[accountId]/route.ts
- components/driver/driver-navigation.tsx
- components/driver/driver-history.tsx
- components/driver/driver-profile.tsx
- components/admin/driver-operations.tsx
- components/admin/driver-profile-browser.tsx
- lib/driver-operations.ts
- lib/driver-work-server.ts
- lib/driver-profile-server.ts
- lib/driver-profile-api.ts
- tests/driver-operations.test.cjs
- docs/driver-operations-phase.md

Previously generated/applied migration: 20261004100000_driver_profiles_and_avatars.sql.
Generated TypeScript cache can change during validation. Unrelated pre-existing dirty
files are preserved. Build-generated TypeScript reference edits are restored afterwards.

## Remaining validation / recommended later work

Recover the browser and verify own profile editing, avatar replacement, History/detail
navigation, sticky action, language preference and office isolation. Then the user signs
in as Joey for real Operations/profile visibility and timestamp/GPS checks. User performs
any real password change. No positive session impersonation or service-key login bypass.
Use an existing unfinished job if available; do not fabricate jobs/events to create a demo.

Later: orphan-avatar lifecycle cleanup, audited event correction, and review of the
existing dependency audit findings. None of these introduces tracking/POD in this phase.
