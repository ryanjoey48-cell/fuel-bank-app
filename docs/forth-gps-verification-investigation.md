# Forth GPS verification: why 15 of 21 vehicles are "unverified"

6 November 2026, Asia/Bangkok. Local, read-only investigation: a handful of bounded authenticated requests to the Forth current-tracking, log and report endpoints (about ten reads plus token requests). No device setting, credential, environment variable, Vercel setting or business record was changed. TLS verification was not touched.

## 1. Diagnosis for 64-5954 (device 519697)

EES is not mis-reading the response. At 09:08:24 the raw current record was (types as sent):

`GPS: "ON"` (string) · `GPRS: "ON"` · `Engine: "ON"` · `Speed: 70` (number) · `dateTime: "06-11-2026 09:07:29"` (55 s old) · numeric `Latitude`/`Longitude` (valid) · `COG: 227` · **`positionSource: "No GPS"`**.

EES parses these correctly (GPS and GPRS connected, timestamp converted from local Bangkok time and fresh, coordinates valid). The position is classed **unverified** for exactly one reason: Forth's own `positionSource` field says "No GPS". The rule in `isForthGpsPositionVerified` is: fresh, valid coordinates, `GPS` field ON, **and** `positionSource` equals "GPS".

Are "GPS signal Available" and "Position source No GPS" contradictory? Both are values Forth sent, from two different fields, and they disagree with each other when read literally (`GPS: ON` is documented as satellite signal received). EES keeps them as two separate facts and does not let either override the other; the position is therefore shown as unverified with the conflict explained. **`positionSource` is not in the field list EES was given**, so what "No GPS" means for a device that also reports GPS ON is unknown.

The position itself is real and live. The coordinates in your 08:42 screenshot (8.514, 98.699) and the 09:07 reading (8.421, 98.557) are about 19 km apart, consistent with driving at about 70 km/h. In a second read 45 seconds later, the "No GPS" vehicles' positions and timestamps advanced and their speeds matched the movement (for example 69 → 70 km/h moved about 1.1 km). Visibility on Forth's website is not evidence of a satellite fix, and EES does not treat it as one.

## 2. Comparison with verified 3ฒน-9565 (device 546298)

| Field | 64-5954 (519697, FTS-PLUS, VER 16-10-2019.A) | 3ฒน-9565 (546298, FTS-PRO SE, USERAPP_VER 17-11-2022.B) |
|---|---|---|
| GPS | "ON" | "ON" |
| GPRS | "ON" | "ON" |
| Engine / Speed | ON / 70 | ON / 0 |
| Coordinates | valid numbers | valid numbers |
| Position age | 55 s | 57 s |
| **positionSource** | **"No GPS"** | **"GPS"** |
| powerStatus / externalBatt | "OFF" / 27.2 | "OFF" / 13.6 |
| Record shape (keys) | identical | identical |
| EES result | G: unresolved provider status, unverified | A: verified fresh GPS |

The only field that differs is `positionSource`. Model and firmware are **not** present anywhere in the API response (checked every key of all 21 records); they are known only from the two Forth-website examples supplied.

## 3. Fleet matrix (all 21, 09:19 Bangkok, sanitized: no driver, address or coordinates)

| Registration | Device | GPS | GPRS | Coords valid | Age | positionSource | Category | Activity |
|---|---|---|---|---|---|---|---|---|
| 3ฒน-9565 | 546298 | ON | ON | yes | 31 s | GPS | A | driving (96 km/h) |
| 68-7154 | 548321 | ON | ON | yes | 4 min | GPS | A | stopped, engine off |
| 700-4145 | 553757 | ON | ON | yes | 34 s | GPS | A | driving (74) |
| 700-6659 | 554779 | ON | ON | yes | 5 min | GPS | A | stopped, engine off |
| 701-1654 | 556431 | ON | ON | yes | 17 s | GPS | A | driving (76) |
| 701-5145 | 559090 | ON | ON | yes | 42 s | GPS | A | driving (68) |
| 3ฒล4565 | 536793 | ON | ON | yes | 18 s | No GPS | G | driving (92) |
| 61-2835 | 519693 | ON | ON | yes | 51 s | No GPS | G | stopped, engine on |
| 61-6672 | 519692 | ON | ON | yes | 19 s | No GPS | G | stopped, engine on |
| 62-1085 | 519690 | ON | ON | yes | 58 s | No GPS | G | stopped, engine off |
| 62-4337 | 519694 | ON | ON | yes | 5 min | No GPS | G | stopped, engine off |
| 63-3543 | 514102 | ON | ON | yes | 22 s | No GPS | G | driving (62) |
| 64-0359 | 512921 | ON | ON | yes | 35 s | No GPS | G | stopped, engine on |
| 64-5954 | 519697 | ON | ON | yes | 29 s | No GPS | G | driving (72) |
| 64-5956 | 532393 | ON | ON | yes | 3 min | No GPS | G | stopped, engine off |
| 64-8665 | 523836 | ON | ON | yes | 80 s | No GPS | G | stopped, engine off |
| 74-8969 | 519696 | ON | ON | yes | 5 min | No GPS | G | stopped, engine off |
| 78-6996 | 519691 | ON | ON | yes | 4 min | No GPS | G | stopped, engine off |
| 79-2945 | 519695 | ON | ON | yes | 21 s | No GPS | G | driving (5) |
| 79-5318 | 506876 | ON | ON | yes | 3 min | No GPS | G | stopped, engine off |
| ฒอ-8453 | 519698 | ON | ON | yes | 95 s | No GPS | G | stopped, engine off |

Categories (the classifier keeps them separate; nothing is forced into one badge): A verified fresh GPS **6** · B GPRS online but GPS signal OFF **0** · C stale last-known **0** · D coordinates missing or invalid **0** · E offline tracker **0** · F mapping or reading problem **0** · G provider status unresolved (GPS ON, source "No GPS") **15**. There are no mapping or parsing issues: every record has a unique device ID and registration, numeric coordinates and a readable timestamp. The full machine matrix is `output/fleet-intelligence-v3/gps-health-matrix-2026-11-06.md`.

**Model correlation (not causation):** every device with an ID of 546298 or higher reports "GPS" (6 of 6) and every device with an ID of 536793 or lower reports "No GPS" (15 of 15). Device IDs run in generations (519690–519698 are nine consecutive "No GPS" devices), which fits the FTS-PLUS vs FTS-PRO SE clue. But model is known for only two devices, so it is a pattern to put to Forth, not a diagnosis. Vehicle type also skews (4 of the 6 verified are 10-wheelers; 10 of the 15 unverified are 6-wheelers), which probably reflects when each group was bought. `powerStatus` is "OFF" for all 21 and external battery voltage does not separate the groups.

## 4. Historical comparison (one day each)

| | 64-5954 / 519697 (5 Nov) | 3ฒน-9565 / 546298 (5 Nov) | 519698 (3 Nov, stored) |
|---|---|---|---|
| Log records | 524 | 936 | 751 |
| GPS field | ON 524/524 | ON 936/936 | ON 751/751 |
| positionSource | "No GPS" 524/524 | "GPS" 936/936 | "No GPS" 751/751 |
| Coordinates valid | 524 | 936 | 751 |
| Distinct positions | 190 | 533 | 375 |
| Sum of log `Distance` | 185,708 m | 363,718 m | 289,536 m |
| Sum of straight-line chords | 185,032 m | 361,879 m | 286,646 m |
| Records where Distance = chord to previous point (±max(30 m, 15%)) | 510 / 523 | 844 / 935 | 681 / 750 |
| Report Total (parkingTrip) | 185.55 km | 363.42 km | 289.20 km |

- **Historical GPS matches Current:** the labels are constant for the whole day per device, so History agrees with Current. The "No GPS" label is a per-device property, not intermittent signal loss.
- **Distance semantics, confirmed:** `Distance` is incremental metres from the previous coordinate to the current one (the documentation is right): median ratio to the straight-line chord 1.001, 0.998 and 1.000; it falls many times a day (94, 243, 176) so it is not an odometer. It is a straight-line distance, so it under-counts curves.
- **Report distance exists without verified geometry:** the report Total equals the log's incremental sum within about 0.1% for both the "No GPS" and the "GPS" devices, so the report appears to be computed from the same reported coordinates regardless of the label. This is derived, not documented, and does not show the coordinates are satellite fixes.
- **Why 519698 returned 751 No GPS:** it is a device-level label (see above); every record that day says "No GPS" while GPS is ON.
- **Metrics stay separate:** provider-reported distance (report) and GPS-derived distance (verified fixes only) are still separate; GPS-derived stays unknown for "No GPS" devices.

## 5. EES-side findings and corrections

**No parsing or classification error was found.** Casing, types, GPS/GPRS handling, timestamp conversion (local Bangkok, 55 s age matches), coordinate validation and device-to-registration mapping all behave as designed, and the verification rule is unchanged and correct for what Forth reports. Nothing was loosened: GPS OFF, "No GPS" or speed alone never makes a position verified.

Changes made (wording and diagnostics only):
- `lib/forth-gps-health.ts` (new): classifies each vehicle into A–G with a reason code, and builds a management line that keeps tracker connection, motion and GPS position quality apart, e.g. **"Tracker online · Vehicle moving · GPS position unverified"** (and Thai).
- `components/forth-tracking-centre.tsx`: the inspector shows that line and a plain reason under the speed; GPS Health shows the category, "GPS signal (Forth): ON · Position source (Forth): No GPS", the reason, and the exact source time with age and "Asia/Bangkok". The cell that said **"GPS signal: GPS not verified"** (which mixed signal with position quality) now reads **"GPS position: GPS not verified"**, and the signal row is labelled "GPS signal reported by Forth".
- `lib/fleet-distance-ledger.ts`: semantics updated (log Distance confirmed incremental metres; report distance derived from the same coordinates; positionSource label unknown) and the Forth questions rewritten.
- Tests: `tests/forth-gps-health.test.cjs` (13 tests: every GPS/GPRS combination, coordinate and time failures, conflicting indicators, source-label variations, model-style variations, device mapping, No GPS history and incremental Distance). `tests/fleet-distance-ledger.test.cjs` expectations updated for the upgraded evidence.

## 6. Unresolved on Forth's side

1. What `positionSource` means (undocumented), and why 15 devices say "No GPS" all day while GPS is ON and positions update.
2. Whether older firmware (FTS-PLUS VER 16-10-2019.A) can mislabel or fail to populate it.
3. Whether a field or endpoint exposes model, firmware and the time of the last genuine GPS fix.
4. Report distance method, the meaning of the open final segment, timestamp zone and day boundaries, retention and rate limits.

## 7. Draft message to Forth support (not sent)

> **Subject: positionSource "No GPS" while GPS = ON on 15 of our 21 devices (current and history APIs)**
>
> Hello Forth support,
>
> We use the Tracking Resource API (`/tracking`, `/log/{id}/{start}/{end}`, `/vehicle/parkingTrip`). On 6 Nov 2026 all 21 of our devices return `GPS: "ON"`, `GPRS: "ON"`, fresh `dateTime`, valid coordinates and live speed. The only difference between them is the field `positionSource`: 6 devices return `"GPS"` and 15 return `"No GPS"`. This field is not in the API documentation we were given.
>
> Example A: device 519697 (FTS-PLUS, firmware VER 16-10-2019.A), plate 64-5954: `GPS ON, GPRS ON, Engine ON, Speed 70, positionSource "No GPS"`, dateTime 06-11-2026 09:07:29, valid coordinates, positions advancing with speed.
> Example B: device 546298 (FTS-PRO SE, USERAPP_VER 17-11-2022.B), plate 3ฒน-9565: same fields, `positionSource "GPS"`.
>
> History: for 5 Nov 2026, device 519697 returned 524 log records, all `positionSource "No GPS"` with `GPS ON`; device 546298 returned 936, all `"GPS"`. The label never changes within a day. The log `Distance` equals the straight-line distance from the previous coordinate in metres (as documented), and the `parkingTrip` Total agrees with the sum of log `Distance` to within about 0.1% for both devices (185.55 km vs 185.71 km; 363.42 km vs 363.72 km).
>
> Questions:
> 1. How is `positionSource` defined, and what does "No GPS" mean when `GPS` is ON and the position keeps updating?
> 2. Can `positionSource` be wrong or unpopulated on older firmware such as VER 16-10-2019.A? If so, which devices are affected?
> 3. Is there a field or endpoint that shows a genuine satellite fix (and its time), and one that returns device model and firmware?
> 4. Is `parkingTrip` distance computed from the same coordinates as the log? What does the final open segment (`endTime "-"`) mean?
> 5. Are all timestamps local Asia/Bangkok, and are day boundaries inclusive at 00:00:00 and 23:59:59? What are the history retention depth and rate limits?
>
> We have not changed any device settings. Thank you.

## 8. Recommendation

**GO** for supervised local use. EES now says clearly what Forth reports and why a position is unverified, without changing the verification rule. **NO-GO to relax verification**: until Forth explains `positionSource`, the 15 "No GPS" positions must stay unverified (indicative, not for dispatch alone), and there is no verified GPS distance or route for them.
