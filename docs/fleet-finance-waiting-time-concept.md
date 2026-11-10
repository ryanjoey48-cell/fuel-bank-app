# Finance readiness concept: confirmed arrival and departure for waiting-time review (REVIEW ONLY)

Nothing here is built, stored or connected to Finance. It describes how office-confirmed visit windows could help a person review customer waiting time later.

## Principles
* **Evidence is not a charge.** A dwell estimate is how long a vehicle stayed put. It is not unloading time and not billable waiting time. No customer charge, invoice line or total is created or changed automatically.
* **Only office-confirmed visits (class A) may be offered to Finance review.** Algorithmic classes B to G never flow to Finance. A high-confidence algorithmic match is never shown as confirmed.
* **Windows, not moments.** Finance sees an arrival window and a departure window and the resulting range of possible waiting time (minimum and maximum), never a single exact figure unless the office entered one with its source.
* **Existing rule preserved.** Authorised, evidenced customer extra charges are included in the invoice total exactly once. Any future waiting-time line must be an explicit, office-approved extra-charge entry that goes through the existing extra-charge path, so it cannot be counted twice (once as a separate line and once inside a total).

## Possible review panel (read only)
For one confirmed job: pickup and delivery windows, observed stay range, the customer's free-time allowance (a Finance setting that does not exist today), the possible excess range, evidence class and source quality, and what is missing. The person decides; the panel offers a "prepare an extra-charge draft" button only after separate approval of the Finance workflow.

## Prerequisites (none approved)
1. Persisted office confirmations of visits (review-only design in `docs/fleet-intelligence-persistence-review-only.sql`).
2. Verified loading-point pins for the customer sites (`docs/fleet-locations-v51-review-only.sql`).
3. A customer free-time setting and a Finance-approved wording for waiting time.
4. Tests proving a waiting-time line cannot be double counted and cannot be created without an authorised person.
