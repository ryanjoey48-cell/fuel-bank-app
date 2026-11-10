# Stage A readiness: persistent loading-point model (REVIEW ONLY, nothing executed or created)

Companion to `docs/locations-pin-verification-plan.md` and `docs/fleet-locations-v51-review-only.sql`. No SQL was run, no record created, no permission changed.

## 1. Schema recommendation (the review-only SQL, confirmed against today's database)
* **Compatible with what exists:** `ees_location_map_pins` has 0 rows and `ees_location_map_pin_history` 0 rows, so the type, status and uniqueness changes touch no data. The old status `manual_confirmed` stays valid and is read as "verified by office"; the old UNIQUE (location_id, pin_type) becomes UNIQUE (location_id, pin_type, label) so one site can have several entrances or bays.
* **New:** type `loading_point`; statuses `verified_by_office`, `candidate_awaiting_review`, `needs_verification`, `rejected_invalid`; `radius_meters` (25 to 1000), `vehicle_classes`, `evidence_notes`, `last_reviewed_at`; a constraint that a verified pin carries reviewer and time.
* **Open technical item:** the existing audit trigger function must be read and extended for the new columns and statuses before the migration is approved (it was not inspected in this pass).
* **Default boundary 60 m:** an application default (the column stays null until set), adjustable per pin up to 1000 m. Justification for the 1000 m cap: large industrial estates and port yards can have an entrance far from the loading bay; anything above 1000 m would make neighbouring sites indistinguishable (the real 26 Oct data shows two unrelated stops 2.9 and 3.8 km from Sirtec, and a long stay 4.2 km from the booked CAL-COMP point).

## 2. Permissions (owner decisions of 2026-11-07)
* Create candidate, verify, reject, set boundary and notes: administrators and office staff (the group that can create pins today; permission `business:write`).
* Change a pin that is already verified: administrators only (as the current route does with `admin:user_management`).
* Read-only accounts: view pins and status, no proposing or verifying. Drivers: no access.
* Evidence coordinates (the Stage B panel) stay behind historical-journey authorisation; verification itself does not need it, but proposing from evidence does.
* All writes go through the existing route pattern (server authorisation, then service role), and every change writes a history row. Row level security: unchanged office-only read; no new broad grants.

## 3. Candidate proposals and human verification
* A candidate pin may be proposed from Stage B evidence (a stop, with its vehicle, day, source quality and windows stored as the evidence note). Several vehicles agreeing may support the proposal; **it never verifies, and a candidate pin is never used for matching**.
* Verification requires a named person and a time, and a statement of how they know (site visit, customer confirmation, map review). Rejection keeps the record, with a reason.
* No automatic promotion, no bulk adoption, no change to booking coordinates.

## 4. Sirtec and priorities
* **Sirtec:** create a plain `ees_locations` entry (name, address from the booking, destination type Factory, `needs_check`), with **no pin and no coordinates**, at the Stage A approval, so bookings can link to it. Do not invent a pin from the stops found; the two verified-GPS stops about 166 m and 285 m from the booked point remain candidates until a person verifies.
* **Order:** Sirtec, CAL-COMP, then the busiest unverified sites (to be ranked from Booking Diary counts once the owner confirms the list).

## 5. What the real 68-7154 day says about CAL-COMP
No stop within 1 km of the booked delivery point; the nearest long stays are 3.6 to 4.2 km away (15:33 to 17:21, including one of 82 to 84 minutes). The booked point may be a district centroid rather than the plant. This cannot be settled from one vehicle-day; ask the customer where trucks unload.

## 6. Remaining Stage A blockers
1. Owner approval of the exact SQL, after a rehearsal on a faithful Development copy (the current Development project lacks these tables).
2. Review and extension of the pin-history trigger function.
3. Stage 1 security groups B, C1, C2 and D applied (the new columns must not be exposed through the 12 still-open tables' pattern; the pin tables already have office-only RLS).
4. Backup or export of `ees_locations` before the plain Sirtec entry.
5. The sixth decision: which sites after Sirtec and CAL-COMP.

## 7. Recommended next step
Ask the CAL-COMP and Sirtec contacts where trucks load and unload, have an office user compare the two Sirtec candidate positions with that answer, then approve Stage A. Until then keep using Stage B as an evidence viewer only.
