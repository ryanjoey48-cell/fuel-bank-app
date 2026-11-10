# Learning from office decisions: design (REVIEW ONLY, nothing built, stored or approved)

Goal: let visit suggestions improve from what the office confirms or corrects, without ever confirming a job, saving a GPS-derived pin or touching billing on its own.

## 1. What may be learned (all from authorised office actions)
| Office action | What the system may learn | Never |
|---|---|---|
| Confirms a suggested visit for a booking | the stop (time window, place, source quality) was the pickup or delivery of that booking | marks the job complete, allocates km, creates a charge |
| Rejects a suggestion (with reason: queue, rest, neighbouring site, wrong job) | that place and pattern is not this customer for this booking | blocks the place for other customers |
| Verifies or rejects a loading-point pin (Stage C) | the pin, its boundary and vehicle classes | changes any booking coordinate |
| Corrects a verified pin (administrator) | a new pin version; old one kept in history | rewrites past decisions |

## 2. How suggestions would improve
* **Priors, not rules:** per verified site, the system may keep summary facts from confirmed visits: typical distance from the booking point, typical stay range, typical approach direction, typical arrival hour. A new suggestion near a site with a confirmed history gets an added evidence reason ("similar to 4 confirmed visits"); its weight rises modestly and never past the caps below.
* **Per-site search zone:** after at least three confirmed visits at one site, the 600 m search zone for unreviewed booking points at that customer may shrink to the observed spread plus a margin, still capped at 1000 m and still labelled as a search zone.
* **Neighbour awareness:** a rejected suggestion adds that place as "known neighbour" for the customer, lowering matches there.
* **Caps that learning cannot lift:** unverified positions stay capped; a search-zone find never becomes "inside the boundary"; an algorithmic result is never shown as confirmed; shared-visit and competing-candidate flags always apply.

## 3. Proposed storage (review-only; would need approved schema and security)
* `ees_visit_decisions` (append-only): id, booking id, vehicle id, day, role (pickup or delivery), stop window (earliest/latest arrival and departure), source quality, decision (confirmed / rejected / needs review), reason code, note, decided_by, decided_role (admin or office_staff), decided_at, software version. No raw GPS track; at most the stop centroid, and only when the actor is allowed to see historical journeys.
* `ees_site_learning` (derived, rebuildable): location id, counts, spread, stay percentiles, last updated. Recomputed from decisions; deleting it loses nothing.
* RLS: office read; insert only by admin and office_staff through a server route; no update or delete on decisions; read-only accounts and drivers none; the same historical-journey gate for anything carrying coordinates.
* All tied to Stage 1 and 2 security and the Stage A pin model; not buildable before them.

## 4. Safeguards
Every suggestion shows whether learning influenced it and which decisions. Learning can be switched off per site. A change in weighting is versioned and tested against the saved real-evidence cases (68-7154 and 64-8665 on 26 Oct 2026) so it cannot silently turn a drive-by into a visit. No learning from unverified-only evidence unless a person confirmed it. Finance never reads suggestions, only confirmed decisions, through the separate review-only concept in `docs/fleet-finance-waiting-time-concept.md`.

## 5. Approval path
1. Stage A (pin model) approved and rehearsed. 2. Decision-store schema and routes reviewed (this document becomes SQL). 3. A first period where the office confirms or rejects suggestions with no weighting change, to measure how often suggestions are right. 4. Only then enable modest priors, with the owner reviewing the before-and-after on real days.
