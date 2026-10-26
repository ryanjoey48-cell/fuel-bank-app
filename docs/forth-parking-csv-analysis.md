# Forth parking-based vehicle-use export — offline analysis

Source: owner-supplied Forth console CSV, exported 26 October 2026. The source file stays outside Git. This analysis does not establish that the Open API returns the same values or formats, and no live history endpoint was called.

The export has 17 detail rows for one registration, one device and 24 October 2026, followed by a `Total` row. The driver field is blank. The file has two leading UTF-8 BOM characters; `lib/forth-parking-csv.ts` accepts these and retains source text (including Thai addresses) without interpreting a timezone or changing coordinates. The original Thai headers are `พนักงานขับ` (driver), `สถานที่` (place/location) and `เวลาเริ่มต้น` (start time). This translates the labels, not the meaning or provenance of an individual value.

| CSV field | Detail/summary interpretation verified in this file |
| --- | --- |
| `license plate`, `Device code`, `Vehicle name`, `พนักงานขับ`, `date`, `สถานที่` | Source identifiers, optional reported driver and source location strings; no EES identity or driver assignment inferred. |
| `เวลาเริ่มต้น`, `End of work time` | Original start and end text. The export alone does not prove the end field is a trip arrival timestamp. |
| `Total travel time` | `HH:mm:ss` in this export; detail sum `03:00:52`. |
| `Engine idling duration` | Separate `HH:mm:ss` measure; detail sum `04:38:35`. |
| `Parking duration` | Separate `HH:mm:ss` measure; detail sum `12:30:36`. |
| `Total distance (km)` | Detail sum `87.64` km, equal to Total. |
| `Exceeding the speed limit (times)` | Detail sum and Total both `0`. |
| `Maximum speed (km/h)` | Highest detail value `19` km/h, equal to Total maximum; it is not additive. |

The final detail has an end value of `-` and zero durations. Do not manufacture its end time. Two detail rows have zero reported distance and nonzero reported maximum speed. These are source observations, not proof of a bad sensor or a known rounding rule. All three durations remain independent; do not derive parking duration from idling time or vice versa. The parser reports these anomalies and checks totals, but leaves the original strings available for inspection.

## Open API boundary

The supplied OpenAPI document describes `POST /api/vehicle/parkingTrip` (`Reports_GetParkingTrip`) with required `boxIds`, `startDate` and `endDate` in `VehicleStandardParams`, returning `ParkingTrip[]`. Its fields include `plateNo`, `boxId`, `vehicleName`, `driver`, `rDate`, `address`, `startTime`, `endTime`, `routingTime`, `parkingEngineOn`, `parkingTime`, `sumDistance`, `maxSpeedCount` and `maxSpeed`. These correspond conceptually to CSV columns, but the CSV is a console export, not a captured API response. In particular, this export's `HH:mm:ss` durations do **not** verify the API duration format, source timezone, optional-field behavior, or record completeness. The supplied contract identifies kilometers for `sumDistance` and kilometers per hour for `maxSpeed`; avoid assigning units to undocumented API duration values.

The offline parser only reads supplied CSV text. It requires the observed header, one summary row, one consistent registration/device/day, valid numeric duration and distance fields, and exact reconciliation. Synthetic tests cover quoting, doubled BOM, distinct durations, incomplete end values and mismatched identities. No report data or device ID is embedded in source or tests. It does not fetch reports, write to Supabase, or alter the disabled live history gate.

The supplied Swagger also lists `tripDetails`, `parkingEngineOverTheLimits`, `accessLocations`, `accessStartDestinationLocations` and a GPS-log path. Their names alone do not establish a journey replay, customer visit, geofence event, or any permission for this account. Future customer visits and waiting times require verified location identifiers, event semantics, timezone rules and EES customer matching. The 466 pinned locations mentioned in prior planning need independent provenance and authorization before any import or Booking Diary/Driver Portal link. Notifications, management KPIs and mileage reconciliation require separately reviewed source rules and permissions; none is implemented here.

## Next verified step

Keep Journey and Parking History fetching disabled. First establish the existing API client's entitlement and reporting-only semantics through account documentation or Forth confirmation, then review a single-use, owner-invoked server adapter and obtain separate express authorization for one bounded report. The proposed first report remains `POST /api/vehicle/trips` for registration `3ฒน-9565` on 24 October 2026, after resolving its unique device from the authorized feed. Compare any later `parkingTrip` response with this export only after a separately approved bounded request; do not treat matching field names as proof of matching semantics.
