# EES Fleet Operations V20 — local implementation and approval gates

This work stays on local `main`. No migration, schedule, live push or Forth write was activated.

## Source of truth and observed data

- `ees_locations` remains the EES location master. Its existing names, aliases, category, address, Google Maps link, verification state and author history are retained. The review-only V20 SQL proposes an `is_active` flag. A Google Maps URL is not a confirmed coordinate.
- `ees_location_map_pins` holds manually confirmed coordinates, including destination and truck-entrance pins. Only confirmed **destination** pins can become geofence centres. The map-pin SQL proposal already exists at `docs/ees-locations-map-pins-review-only.sql`; it is not replaced here.
- A read-only query of the configured Supabase instance on 2026-10-31 found **103** EES locations, **0** verified directory records, **103** needing check, **103** Google Maps URLs, and **0** confirmed map-pin rows. The V20 geofence table was absent (`PGRST205`). These counts can change and should be rechecked before approval.
- Fleet Tracking now turns on the permitted location layer by default and distinguishes unavailable pin storage, empty Directory, no confirmed destination pins, and unmatched pins. It displays Directory and verification counts beside the no-pins explanation.
- The new Location Events page contains a searchable readiness queue linking back to each record in the existing EES Locations Directory. Duplicate names within a province or identical map URLs are **review hints**, never automatic merges or geocodes.
- Forth is a read-only snapshot provider. `gpsDeviceId` is the state key; missing or duplicated IDs are skipped. Registration is display and booking-match evidence, not a replacement identity. Coordinates and source timestamps are unchanged.
- Booking Diary retains its own job identity and approved route coordinates. A unique nearby match with the same assigned registration becomes a review candidate. Multiple matches remain ambiguous. No booking completion, invoice, TRN, charge or waiting-time write occurs.

## Geofence evidence rules

`lib/fleet-geofence-engine.ts` is a pure transition engine. An active zone requires a verified EES Directory record, a confirmed destination pin and an explicitly active geofence configuration. Entry and exit use separate dwell times and a boundary hysteresis ring. Sparse, duplicate, out-of-order, future, stale, offline, non-GPS or missing-coordinate observations cannot create a confirmed event. An outage changes state to `UNCERTAIN` and retains the last stable visit. A departure is confirmed only after fresh verified observations outside the zone.

Event `occurred_at` is the first observed candidate boundary crossing; `confirmed_source_at` and the unchanged confirmed latitude/longitude are the later GPS evidence that satisfied dwell; `detected_at` is EES processing time. On-site duration uses observed arrival and departure boundaries and never claims loading/unloading completion. Overlapping zones select the nearest normalized distance with deterministic ties and preserve an existing entry candidate while it remains inside.

The proposed SQL stores a versioned per-vehicle state and visit events. Its RPC locks one vehicle, compares version and writes state plus any event in one transaction. Unique event and visit/type constraints stop duplicate event rows. A conflicting worker must reload and reevaluate. Run status records freshness and errors. Admin-only geofence settings have a separate reasoned audit history and can be edited from Location Events after the approved storage is installed. Visit review/correction endpoints have **not** yet been activated.

## Server monitoring

`/api/internal/fleet-monitor` is unscheduled and returns 503 unless `EES_FLEET_MONITOR_ENABLED=true`. It also requires a 32-character or longer `EES_FLEET_MONITOR_SECRET` in the Authorization bearer header. No `vercel.json` cron was added. A database lease prevents overlapping runs from making duplicate Forth requests; each vehicle transition also has its own atomic version check. Once approved, choose a hosting schedule compatible with the actual Forth request allowance and hosting plan, then verify runtime duration and GPS reporting cadence. A single poll reads Forth once and evaluates all uniquely identified vehicles. No browser is needed. The Forth history endpoints remain unused.

Before enablement, approve and install the existing map-pin proposal, the V20 SQL, and at least one reviewed Directory record with a confirmed destination pin and explicitly active geofence radius/dwell. Test the atomic RPC and rollback in a staging database. Confirm the service-role permissions and RLS preflight. Production schedule activation is a separate decision.

## iPhone push and inbox

The existing PWA service worker now handles push display and safe same-origin notification clicks. The manifest has stable EES identity and branding. User-owned subscription, preferences, inbox, acknowledgement and delivery-attempt tables are in review-only SQL. APIs verify the authenticated office account and bind every subscription, preference and acknowledgement to that user. Subscription endpoints and encryption secrets are never sent back in lists. The sender restricts endpoints to known HTTPS push services, uses VAPID and RFC 8291 `aes128gcm`, and has a published-vector unit test.

The page offers a local device display test and a separately gated server delivery test (`EES_WEB_PUSH_TEST_ENABLED=true`). Server test results are persisted, rate-limited to one test per user per minute and show only status, HTTP code and a safe error code. **No live operational notification producer is connected to the monitor.** Preference policy is tested for category opt-in, scope, duplicate suppression and Bangkok quiet hours; critical alerts also respect quiet hours until an explicit escalation policy is approved. Speed-alert delivery remains off pending verified event evidence and approved rules. The existing global EES/driver notifications are separate.

To test on iPhone: serve EES over HTTPS, open in Safari on iOS 16.4 or later, Add to Home Screen, launch the installed EES app, sign in as an authorised office user, open Location Events, register the device, choose preference categories, run the local display test, then enable and run the server test in a nonproduction environment. Verify foreground/background display, tap-through, unsubscribe and 404/410 expiry handling. Browser permission must follow a direct tap. VAPID public/private keys and a `mailto:` or HTTPS contact subject must be configured server-side; keep the private key out of the browser.

## Approval and remaining work

1. Review and approve the existing map-pin SQL if its production preflight passes. The table currently exists but has zero pins; do not invent coordinates to fill it.
2. Verify and approve EES Directory records and manually confirm destination pins using the existing Locations workflow. Determine which locations should be active geofences and appropriate radius/dwell values.
3. Review V20 SQL, rollback and read-only verification scripts. Apply only after explicit owner approval. The SQL has been checked in isolated PGlite, not the live schema.
4. Office review/correction for visit events and Booking Diary proposals is implemented at `/api/fleet-operations/events/review` and on the Location Events page. It remains inactive until the V20 visit-event tables are approved and installed.
5. Validate real Forth cadence and access limits. Enable the secret-protected worker and schedule only after staged tests prove correct visits and outage handling.
6. Configure VAPID keys, test server push on installed iPhones and inspect delivery logs before connecting any live event to the notification policy.
7. Forth pinned-locations CSV import: the bundled export at `data/forth-locations/Locations Forth Pinned.csv` (466 records) is parsed and reconciled against the EES Directory. Office approval creates `needs_check` Directory drafts or links existing rows via `source_info` (`Forth location ID:`). Confirmed map pins are never auto-created. Optional link/audit tables are in `docs/ees-forth-locations-import-v20-review-only.sql`.
8. V20.2 reliability: dwell confirmation requires consecutive verified observations within `maxDwellObservationGapMs` (default 5 minutes). Visit review + audit history commit atomically via `commit_ees_fleet_event_review` with `request_id` idempotency. Confirmed visit events enqueue durable notification outbox intents with `delivery_enabled=false` until V20.3. See `docs/ees-fleet-operations-v20-2-review-only.sql`.

Relevant external standards: [WebKit iOS Home Screen Web Push](https://webkit.org/blog/13878/), [RFC 8291](https://www.rfc-editor.org/rfc/rfc8291.html), [RFC 8292](https://www.rfc-editor.org/rfc/rfc8292.html), [Vercel Cron guidance](https://vercel.com/docs/cron-jobs/manage-cron-jobs).
