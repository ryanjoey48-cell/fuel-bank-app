# Forth Fleet Tracking upgrade readiness

## Implemented in this update

- The live fleet summary uses five measures: tracked vehicles, reported moving, reported stopped, current GPS-verified positions, and vehicles needing attention. Activity and location confidence are explained separately.
- Initial map framing uses only positions that meet EES's current GPS-verification rules. All valid reported map coordinates remain selectable, and Fit Fleet still includes them. An invalid or approximate report cannot pull the initial map away from the operating area.
- The vehicle detail view offers Google Maps only when the current report has a valid coordinate pair, a current timestamp, connected GPS signal, and an explicit GPS position source.
- The Journey History view provides vehicle and calendar-date selection, an empty state, and a visible explanation of the verification gate. It makes no history API request and displays no invented journey information.
- A failed refresh keeps the last successful fleet snapshot and selection visible, and labels it with the last successful refresh time.

## Journey History verification

The repository contains the live tracking endpoint contract and normalizer, but it contains no Forth Swagger/OpenAPI document or journey-history input/output schemas. The four report paths named in the task are listed in the Journey History view, but their request bodies, response fields, permissions, timezone rules, parking-duration units, distance units, and missing-field behavior have not been verified. Their `POST` method alone does not establish that they are read-only reports.

No journey-history request has been sent. The integration must remain unavailable until Forth supplies the Swagger/OpenAPI contract and confirms that each report operation is read-only and authorized for the EES service account. After that, verify one GPS device against one completed day in a single controlled request before implementing the response validator or timeline.

The current Forth API adapter remains server-only and read-only for its existing live tracking operation. No history API route, history response parser, retry, automatic request, or database write was added.

## Saved-location notifications

Forth's [public FAQ](https://www.forthtrack.co.th/gps-faq/) says its Open API can be used to integrate vehicle location, driving status, and travel reports. It also describes Forth's built-in alert notifications through email or its app. The public material does not document API geofence events, event subscriptions, or webhooks, and does not provide a geofence event payload or subscription permission model. Whether event-driven arrival/departure integration is available therefore remains unverified.

The practical next step is to ask Forth for the event/webhook specification, event authentication method, geofence support, delivery and retry behavior, and sample arrival/departure messages. If Forth supports reliable events, use those as the transition source. If it does not, request a documented polling allowance and data freshness guarantees before designing an EES geofence evaluator; do not add frequent requests to the 60-second live feed as an unreviewed substitute.

Before notifications can run, EES must also validate the saved-location coordinates and choose an approved boundary radius or polygon. The future notification flow should require a trusted, fresh GPS position and minimum dwell time, deduplicate each vehicle/location transition, retain an auditable history, and apply each user's notification preferences. Browser and iPhone PWA push delivery would need subscription storage and a service-worker flow. No monitoring, push delivery, location change, or schema migration is included in this update.

## Verification status

- Live tracking uses the existing `GET /trackingresource/api/tracking` endpoint through the existing protected adapter.
- The four user-listed POST history endpoints were not verified; their contracts remain blocked pending Forth's Swagger/OpenAPI specification.
- Forth's public material confirms general Open API and native alert capabilities, but does not verify webhook or geofence event support.
- Saved-location coordinate values were not read or modified as part of this update.
