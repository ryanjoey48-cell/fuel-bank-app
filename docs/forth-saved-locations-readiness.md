# Forth saved locations vs EES Locations Directory

Fleet Tracking and Location Events use the **EES Locations Directory** (`ees_locations` + confirmed `ees_location_map_pins`) as the single master database. No second live location store replaces EES.

## Source export (V20)

The owner-supplied Forth pinned-locations export is bundled at:

`data/forth-locations/Locations Forth Pinned.csv`

Observed parse results from that file:

| Field / metric | Value |
| --- | --- |
| Source records | 466 |
| Unique Forth location IDs | 466 |
| Valid coordinate pairs | 466 |
| Exact duplicate coordinate groups | 1 |
| Populated names | 465 |
| Populated addresses | 53 |
| Distinct group/layer values | 137 |
| Diameter raw values | 100 (465), 150 (1) |
| Location types | จุดทั่วไป, จุดต้นทาง-ปลายทาง |

Nine CSV columns are preserved: Forth location ID, name, group/layer, latitude, longitude, address, location type, diameter, symbol.

**Diameter units are unverified.** The raw Forth field is stored for review and is not applied as a geofence radius.

The Forth live GPS API is not assumed to expose this saved-location directory. Import uses the CSV only.

## Comparison against EES (~103 Directory records)

Classifications produced by `lib/forth-locations-import.ts`:

| Classification | Meaning |
| --- | --- |
| MATCHED | Reliable Forth ID link in `source_info`, or unique strong name + ≤5 m confirmed pin |
| POSSIBLE DUPLICATE | Nearby pin and/or name/address similarity — office review; never auto-merge on proximity alone |
| NEW LOCATION | No reliable EES counterpart |
| MISSING COORDINATES | Blank lat/lon |
| INVALID COORDINATES | Out-of-range lat/lon |
| REQUIRES REVIEW | Blank name, export coordinate collision, or linked ID with large coordinate disagreement |

Offline reconcile against an empty Directory fixture: **463 NEW_LOCATION**, **3 REQUIRES_REVIEW**. Live counts against the ~103 EES records must be refreshed from Location Events → Forth locations import (or `node scripts/reconcile-forth-locations.cjs --ees <fixture.json>`).

## Approval rules

- Import only after office approval.
- Approved new rows enter EES as `needs_check` drafts with Forth ID in `source_info`.
- Existing office-confirmed coordinates are never overwritten by import.
- Destination pins remain a separate manual confirmation in Locations.
- Geofence monitoring stays off until Directory verification, confirmed destination pin, and explicit zone activation.

## Current Fleet Tracking behaviour

- Optional Locations layer shows **confirmed EES destination pins** only.
- Search/filter uses company, address, Thai name and category (Customer, Warehouse, Factory, Depot, Port, Airport, Other).
- Nearby vehicles use **straight-line** distance from the saved pin — not driving distance, ETA, arrival or booking association.
