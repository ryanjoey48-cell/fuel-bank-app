# Forth distance semantics: what is established

Verified live and read-only on 5–6 November 2026 for one vehicle (ฒอ-8453, device 519698), through the existing server-side adapter and bounded direct requests (about ten report and log requests plus token requests). No credential was changed or printed, nothing was written, and no fleet-wide history was downloaded. Labels: **CONFIRMED** (observed directly and repeatedly), **DERIVED** (inferred from observations, not documented by Forth), **PARTIAL** (some support, not enough to rely on), **UNKNOWN**. The same list is built into the app (`FORTH_DISTANCE_SEMANTICS` in `lib/fleet-distance-ledger.ts`) and shown in Reports.

## The 344.85 km figure

4 November is **its own day report**: one request (`startDate = endDate = 20261104`) returned 15 segments whose Total row reads **344.85 km**, and the app's own adapter reproduced it (15 segments, 1 open, totals reconcile, acceptance incomplete). The earlier report said "derived as 634.05 − 289.20"; that was my subtraction of two day sums and is not how the number arises. It equals the direct figure only because day totals add. **CONFIRMED as a provider-reported day total; completeness of the day is still unverified (see open segment and coverage).**

## Findings

| Fact | Status | Evidence |
|---|---|---|
| A day report is independent and not cumulative | CONFIRMED | 2, 3, 4 Nov direct reports: Totals 0, 289.20, 344.85 km |
| A two-day request returns one Total per day, then a grand Total | CONFIRMED | 3–4 Nov: 36 rows = 1 header, 32 segments, 3 Total rows (289.2, 344.85, 634.05) |
| A day's Total equals the sum of its segment distances | CONFIRMED | 0 / 289.20 / 344.85 on 2, 3, 4 Nov; 20 segments 251.70 km on 15 Sep |
| The app refuses multi-Total responses | CONFIRMED (tested) | `reconcileProviderSegments` needs exactly one Total; test with the observed shape |
| Duplicate and overlapping segments are not added twice | CONFIRMED (tested) | duplicate rows dropped, overlaps withhold the total |
| Each day ends with one open segment (end `-`, 0 km) at the day's last log record | DERIVED | 2 Nov 23:59:45, 3 Nov 23:55:20, 4 Nov 23:55:03; the meaning ("final stopped or ongoing state") is inferred |
| An open segment means coverage of the day cannot be called complete | Policy | the app never marks a day complete while a segment is open |
| Times are local Asia/Bangkok | DERIVED | a `…000000`–`…235959` request returns records spanning 00:00–23:59 of that date; UTC would shift 7 hours; undocumented |
| Day boundaries | PARTIAL | the log request is inclusive of 23:59:59 (records to 23:59:45 returned); the report's boundary rule is not documented |
| Log `Distance` is a per-record increment, not a cumulative odometer | PARTIAL | it falls 176 and 192 times on 3 and 4 Nov; its daily sum ÷ 1000 is 289.536 and 345.182 vs reports 289.20 and 344.85 (+0.12% and +0.10%), but 0.182 vs 0 on 2 Nov; unit unconfirmed, so it is **not used** |
| How the report distance is computed when every position is `No GPS` | UNKNOWN | 100% of the 314, 751 and 693 log records on 2–4 Nov are `No GPS` with GPS `ON`; on 15 Sep 0 of 699 were verified |
| Whether a day report covers the whole day | PARTIAL | about 5-minute cadence with 301-second gaps; no coverage field |
| History coordinates | PARTIAL | every log record has a coordinate. For 3 Nov (offline analysis of the stored log): 751 points, 375 distinct, up to 99.9 km from the start, straight-line path 286.6 km vs the report's 289.20 km, **0 verified GPS**. They look like a real route but are unverified. No other authorised history endpoint exists. No route is drawn by the distance features; playback is separate and gated (see `docs/forth-journey-playback-local-configuration.md`) |
| Retention depth | PARTIAL | a full report for 15 Sep 2026 (52 days back) was returned: 20 segments, 251.70 km, 699 log records; the limit is unknown |
| Rate limits | UNKNOWN | no 429 so far; not documented |
| Monthly summary (`summaryMonthlys`) | UNKNOWN | documented in the capability matrix, not probed |

## Open questions for Forth

1. Is `sumDistance` derived from positions, an odometer or a pulse counter when `positionSource` is `No GPS`?
2. What does the final open segment (`-`) mean, and can it carry distance if the vehicle is moving at midnight?
3. Are report times local Asia/Bangkok, and are day boundaries inclusive at 00:00:00 and 23:59:59?
4. What are the unit and meaning of the log `Distance` field, and why does its daily sum differ slightly from the report?
5. Which history positions are real GPS fixes, and why is every historical record `No GPS` while GPS is `ON`?
6. What are the retention depth, request limits and rate limits, and is `summaryMonthlys` supported for reconciliation?

## Consequence for the app

Provider distance is shown as **provider-reported, coverage unverified**. A day is only treated as an accountable total if the report reconciles, has no open segment and coverage is verified; that cannot currently be true, so vehicle-day accountability stays "unresolved" and no whole-fleet total is produced until Forth answers 1–3.
