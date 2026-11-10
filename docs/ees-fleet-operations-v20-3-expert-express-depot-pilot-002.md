# EES V20.3 — Pilot 002: EES Lorry Depot (owner-confirmed)

**CAL-COMP remains Pilot 001.**  
**Status:** Owner **confirmed** Forth `1977073` / `ลานจอดรถ` is the lorry depot (Forth satellite screenshot). Staging writes **not applied** until explicit apply approval.

Evidence: `output/v20-3-pilot-002-lorry-depot-owner-approval.json`  
Proposed staging changes: `output/v20-3-pilot-002-staging-proposed-writes.json`

## Confirmed identities

### Lorry depot — Pilot 002

| Field | Value |
| --- | --- |
| Forth ID | **1977073** |
| Forth name | ลานจอดรถ |
| Forth coordinates | **13.768732, 100.766033** (destination pin primary) |
| Google Maps | **13.7688008, 100.7657385** (corroborating; ~33 m offset retained) |
| Directory | Expert Express Sender — EES depot (`4e2d87d2-…` production evidence) |
| Provisional radius | **120 m** (subject to real GPS validation) |

### Office — separate (not Pilot 002)

| Field | Value |
| --- | --- |
| Forth ID | **1708908** |
| Coordinates | 13.763182, 100.753118 |
| Distance to depot | ~1 499 m |
| Monitoring | **Excluded** |

## Pin + zone (prepared, not enabled)

- Destination pin = **Forth** coordinates (owner satellite-confirmed).  
- Google Maps URL + coords preserved in `source_info` / `google_maps_url`.  
- Zone centre = Forth pin; Maps listing lies **inside** the 120 m circle.  
- Coverage note: 120 m may touch adjacent access roads — validate with real GPS; tighten to 100 m if false approaches appear. Office remains outside.

## Approval gate (required before staging writes)

Owner must explicitly approve **apply staging Pilot 002 package**, which would:

1. Insert/link staging Directory depot (synthetic staging UUID recommended).  
2. Forth link `1977073` + audit.  
3. Confirm destination pin.  
4. Verify Directory.  
5. Configure inactive 120 m → enable with audit reason.  
6. Mark pilot site selected.

**Not** included unless separately approved: monitor pulse, iPhone TEST push, production changes, commit/deploy.

## Supervised GPS test

See `docs/ees-fleet-operations-v20-3-pilot-002-supervised-gps-acceptance.md`.

## iPhone Web Push

Continue V20.3 TEST plan (`docs/ees-fleet-operations-v20-3-iphone-web-push-test-plan.md`) — independent of depot geofence enable; still no send without approval.
