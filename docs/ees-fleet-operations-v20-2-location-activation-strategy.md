# EES V20.2 — location activation strategy (operational)

**Binding clarification (Operations):** Drivers navigate to the **saved Forth destination**, then find the vehicle entrance themselves. EES does **not** maintain separate truck-entrance coordinates for every customer. Scale target: arrival/departure intelligence across the ~466 Forth saved locations.

## Default site position

| Rule | Detail |
| --- | --- |
| Default candidate | **Original Forth saved lat/lon** for that Forth location ID |
| Preserve | Forth ID, name, group, raw diameter string, export source label |
| Do not require | Separate truck-entrance pin / URL before pilot preparation |
| Do not assume | Forth `diameter` raw value is a radius or metres |
| Public map offsets | Informational warnings only (e.g. CAL-COMP ~458 m OSM works offset) |

## Controlled stages (must stay separate)

1. **Draft / link** — Directory `needs_check` or Forth ID linked into existing EES `source_info`. No pin. No geofence.
2. **Approved destination** — Authorised staff explicitly confirm the destination pin. Default candidate = Forth coordinates, with source text naming Forth ID. Not an automatic import of diameter.
3. **Configurable geofence** — Admin configures EES radius / dwell / hysteresis and may leave `active=false`.
4. **Enabled geofence** — Explicit enable with audit reason after Directory verified (+ `is_active`) and confirmed destination pin.

Truck-entrance URLs remain optional enrichment, never a gate for pilot readiness.

## Detection and correction

- Arrival/departure only from **verified Forth GPS** evidence (engine rules unchanged).
- Never manufacture events from stale, unverified, offline, or gapped samples.
- After enablement, use real GPS observations to see whether the approved zone detects the vehicle.
- If the zone misses real on-site activity: **flag for review** — do not silently enlarge radius.
- If public-map features disagree with Forth (CAL-COMP 458 m OSM; other listings farther away): keep as warnings; Forth remains the default candidate unless staff deliberately confirm a different pin.

## CAL-COMP Pilot 001 application

- Link Forth `2742427` → existing EES CAL-COMP.
- Confirm destination pin at Forth `13.234431, 99.806063` (admin manual confirmation with Forth source reference).
- Retain ~458 m OSM discrepancy as an informational warning in the pilot log.
- Choose an explicit EES monitoring radius (150 m only if approved as provisional).
- Validate with real GPS when a vehicle visits; miss → review flag, not auto-resize.
