# Forth Journey Playback: configuration, evidence and approval checklist

6 November 2026. Local investigation only. **No flag was set**, `.env.local` was not modified, Vercel settings were not touched, nothing was deployed. Playback remains switched off.

## 1. Where the variables are read and what they require

`lib/forth-history-live-gate.ts` is the only reader. `isForthHistoryLiveRequestsEnabled(env = process.env)`:

| Variable | Accepted values | Effect |
|---|---|---|
| `FORTH_HISTORY_OFFICE_PLAYBACK_ENABLED` | `1`, `true` (any case) | opens the gate everywhere, **including Vercel production** (the owner-approved production switch) |
| `FORTH_HISTORY_SUPERVISED_SESSION` | `1`, `true` (any case) | opens the gate **outside production only**. In production (`VERCEL_ENV=production`) it never opens anything |
| both unset or any other value (`0`, `false`, empty, `yes`, `on`, ` 1`) | | closed. The compile-time default `FORTH_HISTORY_LIVE_REQUESTS_ENABLED` is `false` |

Used by: `lib/forth-history-playback-route.ts` (the playback POST) and `lib/forth-history-route.ts` (journeys), `lib/fleet-intelligence-forth-source.ts`, and my provider-day route (which also allows local development without the flag, see §5).

## 2. Are both needed? Are they session-scoped? What else is checked?

- **Only one is needed.** The gate is an OR. Both together is redundant. Locally, `FORTH_HISTORY_SUPERVISED_SESSION=1` is the intended one; it can never open production.
- **Neither is session-scoped in code**, despite the name. Each is a process environment variable: it applies to every signed-in user of that server process until the variable is removed. "Supervised" describes the intended procedure, not an enforced time limit.
- **Restart required.** The playback handler reads the gate once when its module is created, so a change to `.env.local` takes effect only after the dev server restarts (Next.js also reads `.env.local` at start).
- **Server-side authorisation still applies on every call** (verified live: unauthenticated request → 401; signed-in office session with the gate closed → 503 `history_live_disabled`, no request to Forth): a verified user, `business:read`, one device that must be in the authorised live Forth fleet (404/409 otherwise), one Bangkok day, a 12-requests-per-minute and 1-in-flight limit per user and device, an 8 KB body cap, `private, no-store`. `business:read` is held by owner, admin, **office staff and read-only users**, so every office account could open playback once the gate is on.

## 3. Do our credentials and endpoints support historical playback?

Yes, technically. Playback uses the same historical log endpoint as the distance work (`GET /trackingresource/api/log/{device}/{start}/{end}`), which already returned HTTP 200 with the existing credentials: 314 / 751 / 693 records for 2, 3, 4 Nov and 699 for 15 Sep (52 days back). Entitlement is not the problem.

## 4. Distance report versus route playback

| | Provider distance report | Journey playback |
|---|---|---|
| Endpoint | `POST …/vehicle/parkingTrip` (day segments and Total) | `GET …/log/{device}/{start}/{end}` (a record about every 5 minutes) |
| Content | segment start/end and km, Total; **no coordinates** | latitude, longitude, speed, engine, timestamps |
| Used for | kilometres | drawing a route on the map |
| Gate | not gated by these flags in local development | **gated by these flags** |
| Sensitivity | low (times and kilometres) | **high** (precise movement) |

## 5. Would enabling playback expose sensitive location history?

Yes. The playback response carries per-point coordinates, speed and engine state for one vehicle and day, and a vehicle is tied to a driver. That is personal location data about identifiable people (including off-duty and home-area movement), so it falls under Thai PDPA purposes and notice rules. Current controls: authentication, `business:read`, one device and day per request, rate limit, no-store. Missing: a narrower role than every office and read-only account, and an access audit log.

Related finding in the V4 code I own: the provider-day routes can run in local development without the playback flag (they only return distances), but they used to include `observedPoints` (coordinates of verified GPS points) in the JSON. That is now stripped (`publicProviderDay`), so location data only ever leaves through the gated playback route. Today those arrays were empty because no point is verified.

## 6. `.env.local` (inspected without printing secrets)

Names and value shapes only. No `FORTH_HISTORY_*` variable exists in `.env.local` or in this shell. The only related entry is `FORTH_SOURCE_TIME_ZONE` (a 12-character value, as expected for `Asia/Bangkok`). The file is git-ignored. Credentials were not read into any output.

## 7. Recommended local configuration (not applied)

Add one line to `.env.local`, then restart the dev server:

```
FORTH_HISTORY_SUPERVISED_SESSION=1
```

- **Do not** set `FORTH_HISTORY_OFFICE_PLAYBACK_ENABLED` locally: it is the production switch and also opens production if it were ever copied across.
- **Never** set either variable in Vercel without a separate owner approval.
- Remove the line (and restart) when the supervised check is finished.
- Before turning it on for anyone other than the owner, add (recommended): an audit log of who opened which vehicle and day, a narrower permission than `business:read`, and a written approval record. Not yet implemented.

## 8. What enabling playback would actually show for our data

Offline analysis of the stored 3 Nov log, no Forth request and no flag: 751 points, **0 verified GPS**, **751 trail-eligible**, 736 reported-trail segments, 375 distinct positions, up to 99.9 km from the start, straight-line total 286.6 km against the provider's 289.20 km.

So enabling the flag **would** produce a map route, drawn as the existing **amber "reported position" trail**, not a verified GPS route. The playback code labels it as such ("Reported coordinates exist, but Forth did not confirm GPS source"). It would not produce a green verified route, and no verified GPS distance. The route looks consistent with the provider's distance for that day, which is encouraging, but Forth has not said where these positions come from, so it must stay labelled unverified. If a day had no coordinates the panel shows "No Forth GPS observations … no route was invented".

Open Forth questions that decide whether these positions can ever be trusted: what `No GPS` means with GPS `ON`, and how the positions are produced (see `docs/fleet-intelligence-forth-distance-semantics.md`).

## 9. Approval checklist before the flag is set

1. Owner approval to display driver/vehicle location history locally, for how long and to whom.
2. Confirm that unverified (amber) positions may be shown to office staff, labelled as such.
3. Decide whether read-only office accounts may use playback.
4. Accept (or implement first) an access audit log.
5. Notice and retention position under PDPA for location data.
6. Set `FORTH_HISTORY_SUPERVISED_SESSION=1` in `.env.local` only, restart, verify, then remove it.

## 10. Changes made during this investigation

- `lib/forth-journey-playback.ts` + `lib/forth-history-playback-route.ts`: when the gate is closed the panel now says "Journey playback is not available: it is switched off on this server until the owner approves it. No history is requested and no route is shown." instead of implying Forth cannot supply history. The response code and status are unchanged; the existing test still passes.
- `lib/fleet-intelligence-day.ts`, provider and evidence routes: coordinates removed from distance-report responses.
- `lib/fleet-distance-ledger.ts`: the history-coordinates fact is now PARTIAL with the offline evidence.
- `tests/forth-playback-config.test.cjs` (gate truth table, production rule, message, coordinate stripping, offline real-day check).
