# Migration normalization and permanent identity plan

This plan preserves source evidence and does not change production values.

## Permanent Fleet Asset identity

1. Create a permanent database UUID for every Fleet Asset. It is the primary identity and never derives from registration or Driver.
2. Preserve the legacy Insurance UUID in an immutable mapping ledger with source table, source row, and migration run.
3. Treat a validated chassis number as the strongest natural identity signal, but never auto-merge on chassis alone. Require compatible registration history and make/model/year evidence, and route conflicts to review.
4. Store `display_registration` exactly as entered and `normalized_registration` separately. Registration is matchable/history-bearing data, not a primary key.
5. Preserve make, model, year, and category as separate attributes with original values and provenance. Do not parse a combined make/model string destructively.
6. `asset_category` supports operational truck, pickup, passenger/company car, trailer, other commercial vehicle, insurance-only asset, and Unknown. Unknown is valid and does not block migration when its UUID and source mapping are reliable.
7. Driver and operational-system relationships are nullable assignments/references. They are never prerequisites for a Fleet Asset.

Potential matches produce a review candidate; they do not perform a merge. Any future merge must retain both source identities, registration history, provenance, approver, reason, and a reversible audit event.

## Registration normalization

For each registration keep at least:

- `original_value`: exact legacy value.
- `display_registration`: approved display text; initially equal to `original_value`.
- `normalized_registration`: Unicode NFC, trimmed outer whitespace, internal whitespace and presentation separators removed, and Latin letters consistently cased.
- normalization rule version and timestamp.
- source document/legacy row and confidence.

Normalization must not transliterate Thai, replace Thai characters, or infer a province. Thus `ฒอ8453` and `ฒอ-8453` may normalize to the same key, while `ฌอ8453` remains different. Alias/history records capture prior or alternate display forms.

## Known items

- `ฒอ8453` remains the Insurance display value. `ฒอ-8453` remains the operational master display value. Both normalize to `ฒอ8453`; no display value changes during migration.
- For 64-8664, 77-5902, and 77-8513, preserve legacy `policy_number_original = 'หางหัวลาก'`, set the future genuine `policy_number` to NULL, and place the meaning in `asset_description`/`body_type = 'Trailer'` with provenance. Do not invent a policy number.
- For 61-2835, migrate `main_policy_includes_compulsory = false` and a separate compulsory policy record numbered `726-0133-785`. Do not reuse an ambiguous generic `compulsory_included` field.

## Traceability

Every normalized field must retain the original field name/value, source record UUID, source row/document when known, transformation rule version, confidence, and review status. Reports must show original and normalized values side by side. Null and blank remain distinguishable unless an explicitly approved mapping says otherwise.
