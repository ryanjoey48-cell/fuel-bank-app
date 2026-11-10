# Locations Directory pin verification: plan (PLAN ONLY, nothing built or saved)

## 1. What already exists (so we extend it, not rebuild it)
* **Map view in the Locations Directory** (`components/locations-map.tsx`, Leaflet, clustered markers) with a pin editor for two types (`destination`, `truck_entrance`) and a "smart pin" dialog (`location-smart-pin-dialog.tsx`) that proposes a pin from the address.
* **Save route** `app/api/locations/map-pins`: office permission to read and create; `admin:user_management` to correct an existing pin; writes with the service role after authorising the caller; saves `pin_status = manual_confirmed` with who and when; a history table audits every change; office-only RLS on the tables. 0 pins are saved today.
* **Fleet side already prepared:** `lib/fleet-location-priority.ts` reads verified pins and ranks them above the booking coordinate; the Jobs tab shows candidate stops with "coordinates (not saved)".

## 2. Gaps (what the office cannot do yet)
1. Choose a **loading point** (type does not exist) or several entrances/bays per site (unique per type today).
2. Set a **boundary** (radius), vehicle classes, evidence notes; see **status** beyond "confirmed"; **reject** a wrong candidate.
3. **Use stop evidence**: nothing connects the Jobs tab's candidate stops to the pin editor.
4. Sirtec has no directory entry; CAL-COMP is `needs_check` with no pin.

## 3. Proposed stages (each needs its own approval)
**Stage A: schema (review-only file exists).** Rehearse and approve `docs/fleet-locations-v51-review-only.sql` (loading_point, label, four statuses, radius 25 to 1000 m, vehicle classes, notes, reviewer required for verified, history columns). Prerequisite: Stage 1 security groups applied, a faithful Development copy (current Development lacks these tables), and the audit trigger function reviewed and extended. Nothing is verified automatically.

**Stage B: read-only evidence view (no saving, no schema).** In the pin editor for a location, an "Evidence from vehicles" panel lists candidate stop clusters from vehicle-days the user chooses (one vehicle-day at a time, the existing Forth read path), showing distance from the current pin, stay range, source quality (verified GPS / unverified), repeated evidence across vehicles, and "may belong to a neighbouring site". It plots candidates as grey, unsaved map markers labelled "candidate, not saved". Access: only users allowed to view historical journeys (same server-side gate); coordinates are never put in a URL or stored in the browser beyond the open page. The existing English/Thai copy pattern and mobile layout rules apply.

**Stage C: verification actions (needs Stage A).** "Propose this as loading point" creates a **candidate** pin only; an authorised office user reviews and chooses Verify, Reject (with reason) or Needs verification; set label, radius, vehicle classes and notes. Verification records reviewer and time and writes history. Rules: at least two ordered, slow positions as supporting evidence are shown but never required to verify (the office decides); two verified points of one type at one site stay ambiguous unless vehicle classes separate them; rejected pins are kept for history and ignored for matching; no coordinate is changed on a booking.

**Stage D: use in tracking.** The resolver already prefers verified points; add the boundary from the pin, show "point used and why" (done), and re-run the real vehicle-days to compare class changes. A review step lists which past jobs would change class so nothing is rewritten silently.

## 4. Permissions and safety
* Verify and reject: administrators and office staff who already may create pins; correcting an already verified pin stays administrator-only as today.
* Read-only accounts see pins and status but cannot propose or verify.
* Drivers have no access. Candidate coordinates come from historical positions, so Stage B follows the historical-journey gate.
* Every change is audited in the pin history table. No automatic verification, no bulk adoption from cross-vehicle agreement, no silent coordinate edits.
* No production write happens until Stage A is approved and rehearsed.

## 5. Decisions needed from the owner
1. Who may verify a loading point: administrators only, or office staff too?
2. Is two vehicles agreeing enough to propose a candidate pin, or must a person visit or confirm with the customer first?
3. Default boundary size for new loading points (suggestion: 60 m, adjustable, cap 1000 m).
4. Should Sirtec be created as a new directory entry now (a plain location record, no pin), so bookings can link to it?
5. Which customer sites come first (Sirtec, CAL-COMP, then the next busiest)?

## 6. Tests per stage
A: constraint tests in the Development rehearsal. B: pure tests that candidate lists never include coordinates for unauthorised callers and never save. C: route tests for permissions, status transitions, audit rows, ambiguity, rejection. D: re-run V5/V5.2 suites plus the two real vehicle-days; compare classes.

## 7. Owner decisions recorded (2026-11-07)
1. **Who verifies or rejects:** administrators **and office staff**. Correcting an already verified pin stays administrator-only. Read-only accounts cannot verify.
2. **Evidence rule:** several vehicles agreeing may help **propose** a candidate pin, but a person who knows the site or has confirmed with the customer must verify it before it is used. Agreement never verifies.
3. **Default boundary for a new loading point:** **60 m**, adjustable per pin, capped at 1000 m.
4. **Sirtec:** create it as a plain directory entry (no pin) **later, with the Stage A approval**, not now.
5. **Which sites first:** still open; working assumption is Sirtec, then CAL-COMP, then the next busiest sites.
These answers approve no change by themselves. Stage A (schema) still needs its own rehearsal and written approval, and Stage 1 security groups B, C1, C2 and D remain pending.
