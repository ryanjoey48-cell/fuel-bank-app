# EES — Forth 403 locations import plan (awaiting owner selection)

**Status:** BLOCKED — selection not identifiable  
**Production writes:** none  
**Geofences / arrivals / departures:** not enabled by this plan

## Discrepancy

| Source | Count |
| --- | --- |
| Owner request | **403** |
| Bundled export `data/forth-locations/Locations Forth Pinned.csv` | **466** unique Forth IDs, all with valid coordinates |
| Other Forth/location CSVs in repo | **none** |

Checked filters (group, type, symbol, Thailand bbox, NEW/POSSIBLE/REVIEW, office/depot exclusion, Pioneer-like groups, unique coords). **None yield exactly 403.**

Arithmetic only: `466 − 63 = 403` and `434 − 31 = 403` — no matching exclusion set exists in the file.

Probe evidence: `output/ees-forth-403-selection-probe.json`.

## Required from owner before any import

Provide **one** of:

1. Updated CSV with exactly the 403 selected rows, or  
2. `data/forth-locations/SELECTED_FORTH_LOCATION_IDS.txt` listing exactly **403** Forth IDs present in the bundled CSV (see `.example.txt`), or  
3. Confirmation that the intended set is the full **466** (403 was a miscount), or  
4. A reproducible named filter rule that yields 403.

Until then: **do not invent a subset** and **do not write production**.

## Proposed import (after selection approved)

Uses existing EES architecture only (`ees_locations` + optional map display). No V20 geofence schema required for map pins.

1. Validate selection with `validateForthOwnerSelection` (`lib/forth-selected-locations.ts`).
2. Reconcile against live Directory (Forth ID in `source_info`, name + proximity).
3. **Link** strong Forth-ID / safe matches — do not overwrite Directory business fields or office-confirmed pins.
4. **Insert** unmatched selected rows as Directory drafts (`needs_check`) preserving Forth ID, Thai name, coords, group, address; `source_info` includes Forth ID + **Forth GPS**.
5. For Fleet map display without hundreds of manual pin clicks: store Forth coordinates as a **Forth GPS map source** distinct from `manual_confirmed` office pins (display trusted for mapping/proximity suggestions only).
6. **Exclude** all non-selected Forth rows from this import.
7. **Do not** enable geofences for the batch; **do not** generate historical arrivals/departures.
8. Booking Diary suggestions: use Directory rows created/linked above (existing suggestion path).
9. Apply only after explicit owner approval of the write package (counts: imported / linked / skipped / unresolved).

## Production-compatible display note

Fleet Tracking today shows only `manual_confirmed` destination pins — currently **0** on production, which is why the map looks empty. Showing Forth GPS pins can be done without V20 tables once the **selected** records exist in Directory (or a read-only selected CSV overlay). That step waits on the 403 identity.

## Safety

- No Forth device writes  
- No Maintenance / Weekly Mileage / Fuel / Finance changes  
- No silent production SQL  
- Monitor and live push remain off  
