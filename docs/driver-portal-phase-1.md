# Driver portal phase 1 setup

The driver portal uses the existing `drivers`, `booking_diary`, `clients`, and vehicle assignment data. It adds authentication linkage, opaque web sessions, a relational `booking_diary.driver_id` assignment, and a driver-only self-registration approval queue.

## Deployment order

1. Apply `supabase/migrations/20261001100000_driver_portal_phase_1.sql` through the normal reviewed migration process.
2. Apply `supabase/migrations/20261002100000_driver_self_registration.sql`.
3. In Supabase Dashboard, open **Authentication → Hooks → Custom Access Token** and confirm `public.custom_access_token_hook` remains selected after the migration.
4. A driver uses **Create Account** on `/login`. The public form always submits `registration_type: "driver"`; it cannot request an office or administrator role.
5. An active administrator opens **Admin → User Management**, reviews **Pending driver requests**, and links an approved request to an existing active `drivers` record. Approval atomically activates `driver_accounts`; rejection grants no access.
6. Assign the driver to Booking Diary work in the existing office UI. The UI continues to store the display name and also stores the unique `driver_id` used by the portal.
7. Have the approved driver sign in at `/driver/login` (or `/login`, which redirects drivers correctly). Existing tokens minted before enabling the updated hook must be refreshed by signing out and in again.

## Pilot checklist

- Create a test request and confirm it appears as pending with name, email, phone, requested role, and request date.
- Confirm a pending login reaches `/access/pending` and cannot open office pages or read office data.
- Approve it by selecting the correct existing driver record; no name, email, or person is hardcoded.
- Confirm a rejected test request reaches `/access/rejected` and receives no driver or office access.
- Confirm the driver sees only bookings whose `booking_diary.driver_id` matches that driver.
- Confirm another booking UUID returns the driver portal not-found page.
- Confirm `/dashboard` signs a linked driver out and redirects to `/driver/login`.
- Confirm pickup/drop-off Maps buttons open the stored Google Place ID, coordinates, or address in that priority order.
- Confirm pricing, costs, notes, reports, office navigation, and office data are absent.

The browser never receives a Supabase driver access or refresh token from the driver portal login. It receives a random HttpOnly cookie whose SHA-256 hash is stored in `driver_sessions`. The custom access-token hook assigns active drivers, pending/rejected requests, and otherwise unauthorised public Auth users the database role `driver_portal`, which has no direct table or schema grants. Only an explicit active `account_access` record can retain office data access.
