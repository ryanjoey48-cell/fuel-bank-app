# Forth tracking integration — Phase 1

The Phase 1 integration is a server-only, read-only adapter for Forth's tracking endpoint. Its protected diagnostic is `GET /api/admin/forth-tracking`. It uses the existing Supabase verified-user flow and requires the active EES `business:read` permission, which excludes driver portal accounts.

The diagnostic reports connection and authentication status, record and coordinate counts, the latest valid GPS position timestamp, and a fixed safe error code. It does not return tracking records, registrations, driver identifiers, raw upstream error bodies, credentials, or access tokens. Forth requests use TLS, a 10-second timeout, no-store caching, no redirect following, and no automatic retry. Successfully issued tokens are reused until shortly before their reported expiry; failed token requests are cooled down for one minute.

## Server environment

The adapter matches the request produced by Forth's documented [DotNetOpenAuth sample](https://webapi.forthtrack.com/demo/). Configure the four credentials and the profile flag as server-side variables in Vercel. Never use a `NEXT_PUBLIC_` prefix:

```text
FORTH_CLIENT_ID=
FORTH_CLIENT_SECRET=
FORTH_USERNAME=
FORTH_PASSWORD=
FORTH_SOURCE_TIME_ZONE=
FORTH_TOKEN_REQUEST_PROFILE=oauth-password-basic-v1
```

`oauth-password-basic-v1` is the only enabled request profile. DotNetOpenAuth's `ExchangeUserCredentialForToken(username, password)` builds a `POST` with an `application/x-www-form-urlencoded; charset=utf-8` body containing `grant_type=password`, `username`, and `password`. Its `WebServerClient(server, client_id, client_secret)` constructor uses `ClientCredentialApplicator.NetworkCredential`, which sends `Authorization: Basic <base64(UTF-8(client_id:client_secret))>` and removes `client_id` and `client_secret` from the form body. The sample supplies no scopes; DotNetOpenAuth leaves the scope collection empty and omits `scope` from the request. EES mirrors that request. It also sends `Accept: application/json` and never tries another authentication profile automatically.

The source confirms what DotNetOpenAuth generates; it does not independently prove that Forth's live authorization server accepts the request or that credentials are valid. The integration remains disabled unless all four credentials and `FORTH_TOKEN_REQUEST_PROFILE=oauth-password-basic-v1` are explicitly configured. No live Forth request has been made as part of this phase.

### Production safety gate and controlled diagnostic

1. Rotate the Forth client secret because its earlier value was exposed. Store the replacement only as a Vercel Secret; do not paste it into chat, source control, or logs.
2. Configure the OAuth variables `FORTH_CLIENT_ID`, `FORTH_CLIENT_SECRET`, `FORTH_USERNAME`, `FORTH_PASSWORD`, and `FORTH_TOKEN_REQUEST_PROFILE`; set the profile to `oauth-password-basic-v1`. For timezone-less Forth timestamps, set `FORTH_SOURCE_TIME_ZONE` to the IANA timezone confirmed by Forth. There is deliberately no default timezone. Credential values must remain server-side and must never use a `NEXT_PUBLIC_` prefix.
3. Vercel Secret values cannot be read back after saving. A configured-variable claim does not verify the values or prove that the client secret was rotated. Do not activate a deployment or call Forth until the replacement secret is configured and the controlled test is explicitly approved.
4. For a controlled Preview diagnostic, set OAuth credentials as **Preview-only Secret** values, and the profile and confirmed timezone as **Preview-only Config** values, then create a Preview deployment after approval. Use a verified EES office account with `business:read` and make one `GET` request to `/api/admin/forth-tracking` in that signed-in browser session. Production credentials do not need to be copied into Preview.
5. Any later Production deployment also requires the replacement secret to be configured for Production, a passing controlled diagnostic, and explicit deployment approval. Environment changes apply to new deployments. See [Vercel's Secret and Config types](https://vercel.com/changelog/environment-variables-now-use-config-and-secret-types) and [environment variable management](https://vercel.com/docs/environment-variables/managing-environment-variables).

That diagnostic sends one token request followed by one read-only tracking `GET` (or reuses the in-memory token while it remains valid). It returns aggregate counts and connection status only. It performs no Supabase writes and does not update vehicle, maintenance, or mileage data. The dashboard endpoint returns a sanitized read-only projection and uses the same server-side service and token cache. Do not call either endpoint until the replacement secret is configured and the controlled diagnostic is approved.

### GPS timestamp format

The completed Production diagnostic inspected 21 records: all 21 timestamps were present, had the masked shape `99-99-9999 99:99:99`, and failed as unsupported. The Forth dashboard displays these values in day-month-year order, supporting the `DD-MM-YYYY HH:mm:ss` interpretation. The normalizer now accepts this exact timezone-less format and the existing ISO forms (`YYYY-MM-DDTHH:mm:ss` or a space separator, optional fractional seconds, and optional `Z` or numeric UTC offset). Day, month, calendar date, and clock time are checked strictly; no day/month swapping is attempted. Timezone-less values use `FORTH_SOURCE_TIME_ZONE`. The 15-minute stale threshold remains in place, and normalized timestamps are displayed in `Asia/Bangkok` local time.

The temporary timestamp-format button and `/api/admin/forth-tracking/timestamp-format-diagnostic` endpoint have been removed after the diagnostic completed. `FORTH_TIMESTAMP_DIAGNOSTIC_ENABLED` is no longer used by this code and should be set to `false` or removed from Vercel Production. Environment changes apply to subsequent deployments; no deployment is performed as part of this parser change.

### DotNetOpenAuth source trace

The behavior above was traced in the archived [DotNetOpenAuth v4.3.3.13295 source](https://github.com/DotNetOpenAuth/DotNetOpenAuth/tree/v4.3.3.13295). `WebServerClient` delegates a supplied client secret to `DefaultSecretApplicator`; `ExchangeUserCredentialForToken` creates `AccessTokenResourceOwnerPasswordCredentialsRequest` with the username and password and passes the optional scopes to the token request. The request class marks `username` and `password` as required and selects `GrantType.Password`; `AccessTokenRequestBase` sends a POST, and the core channel serializes its message fields as UTF-8 form-urlencoded data. With the default `NetworkCredential` applicator, `client_id` and `client_secret` are removed from message fields and HTTP Basic is applied as UTF-8 Base64 of `client_id:client_secret`. `ScopeEncoder` returns null for an empty collection, so a missing scopes argument produces no `scope` field. The success response maps `access_token` into the authorization state, and `CreateAuthorizingHandler(accessToken)` sets `Authorization: Bearer <token>` on outbound tracking requests.

Source files: [WebServerClient.cs](https://github.com/DotNetOpenAuth/DotNetOpenAuth/blob/v4.3.3.13295/src/DotNetOpenAuth.OAuth2.Client/OAuth2/WebServerClient.cs#L31-L51), [ClientBase.cs](https://github.com/DotNetOpenAuth/DotNetOpenAuth/blob/v4.3.3.13295/src/DotNetOpenAuth.OAuth2.Client/OAuth2/ClientBase.cs#L249-L259), [ClientCredentialApplicator.cs](https://github.com/DotNetOpenAuth/DotNetOpenAuth/blob/v4.3.3.13295/src/DotNetOpenAuth.OAuth2.Client/OAuth2/ClientCredentialApplicator.cs#L117-L142), [OAuth2ClientChannel.cs](https://github.com/DotNetOpenAuth/DotNetOpenAuth/blob/v4.3.3.13295/src/DotNetOpenAuth.OAuth2.Client/OAuth2/ChannelElements/OAuth2ClientChannel.cs#L159-L164), [AccessTokenResourceOwnerPasswordCredentialsRequest.cs](https://github.com/DotNetOpenAuth/DotNetOpenAuth/blob/v4.3.3.13295/src/DotNetOpenAuth.OAuth2.ClientAuthorization/OAuth2/Messages/AccessTokenResourceOwnerPasswordCredentialsRequest.cs#L76-L96), [AccessTokenRequestBase.cs](https://github.com/DotNetOpenAuth/DotNetOpenAuth/blob/v4.3.3.13295/src/DotNetOpenAuth.OAuth2.ClientAuthorization/OAuth2/Messages/AccessTokenRequestBase.cs#L25-L28), [ScopedAccessTokenRequest.cs](https://github.com/DotNetOpenAuth/DotNetOpenAuth/blob/v4.3.3.13295/src/DotNetOpenAuth.OAuth2.ClientAuthorization/OAuth2/Messages/ScopedAccessTokenRequest.cs#L27-L38), [Channel.cs](https://github.com/DotNetOpenAuth/DotNetOpenAuth/blob/v4.3.3.13295/src/DotNetOpenAuth.Core/Messaging/Channel.cs#L1130-L1152), [ScopeEncoder.cs](https://github.com/DotNetOpenAuth/DotNetOpenAuth/blob/v4.3.3.13295/src/DotNetOpenAuth.OAuth2/OAuth2/ChannelElements/ScopeEncoder.cs#L31-L37), [OAuthUtilities.cs](https://github.com/DotNetOpenAuth/DotNetOpenAuth/blob/v4.3.3.13295/src/DotNetOpenAuth.OAuth2/OAuth2/OAuthUtilities.cs#L161-L175), [AccessTokenSuccessResponse.cs](https://github.com/DotNetOpenAuth/DotNetOpenAuth/blob/v4.3.3.13295/src/DotNetOpenAuth.OAuth2.ClientAuthorization/OAuth2/Messages/AccessTokenSuccessResponse.cs#L54-L75), and [BearerTokenHttpMessageHandler.cs](https://github.com/DotNetOpenAuth/DotNetOpenAuth/blob/v4.3.3.13295/src/DotNetOpenAuth.OAuth2.Client/OAuth2/BearerTokenHttpMessageHandler.cs#L75-L89).

## Data handling

Tracking normalization is in `lib/forth-tracking.ts`. It preserves the exact source `dateTime` string for auditing, separately stores the normalized position time, and keeps API retrieval time in `fetchedAt`. Timezone-less values require `FORTH_SOURCE_TIME_ZONE`; the existing strict `DD-MM-YYYY HH:mm:ss` and ISO parsing behavior is unchanged. The stale threshold is 15 minutes.

### Forth field contract and EES interpretation

| Forth response field | Normalized EES value | Meaning in the dashboard |
| --- | --- | --- |
| `GPS` | `gpsConnectivity` (`connected`, `disconnected`, `unknown`) | GPS signal/fix state only. Missing, blank, or unrecognized input stays Unknown. |
| `GPRS` | `gprsConnectivity` (`connected`, `disconnected`, `unknown`) | Tracker communications. It is the input to Online/Offline/Unknown; GPS loss does not make GPRS Offline. |
| `Engine` | `engineOn` (`true`, `false`, `null`) | Engine On/Off/Unknown, independent of motion. |
| `Speed` | finite non-negative number, otherwise `null` | Reported speed. The current UI displays the value as km/h without conversion. One manual comparison matched Forth at 66 km/h; the public API material does not specify the field's unit. Fresh positive speed is shown as Reported driving; fresh zero speed is Reported stopped and is split by the independently reported Engine field. GPS confidence is shown separately. |
| `dateTime` | preserved `sourceTimestampRaw`, normalized `lastGpsTimestamp`, `timestampStatus` | Position report time. Current is within 15 minutes; Stale is older; parse failures are Unknown freshness. |
| `Latitude`, `Longitude` | validated coordinate pair/status | Mappable position if both are finite and in range. Valid coordinates alone do not establish GPS quality. |
| top-level positionSource | preserved source text plus positionQuality | Exact GPS, Wi-Fi and LBS labels map to their respective categories. The observed `No GPS` label (case and whitespace normalized) maps to the separate `no_gps` category and is never treated as verified GPS. Explicit Non-GPS/Other maps to Other. Missing or other unrecognized values stay Unknown. The adapter does not map aliases or nested fields. |

Forth's [published FAQ](https://www.forthtrack.co.th/gps-faq/) documents fallback positioning in the order GPS, Wi-Fi, then LBS, and describes Wi-Fi/LBS as approximate; it does not publish a complete `positionSource` enum/schema or define the API label `No GPS`. EES recognizes the observed `No GPS` label, including case and whitespace variations, as its own unverified category. This is a conservative interpretation of the observed label, not a claim that Forth has published its enum semantics. EES deliberately leaves other values such as “GPS signal lost” Unknown rather than treating source text as a GPS signal or communications state. The original source text remains available in the fleet projection; raw diagnostic-only source capture remains enabled only for the protected one-shot aggregate diagnostic.

EES reports tracker communications from GPRS, position freshness from dateTime, GPS signal from GPS, position quality from positionSource, and engine state from Engine. The adapter does not identify an explicit driving-state field in the tracking response; no published API contract found for this integration defines one. EES therefore labels activity as reported activity, not Forth Working/Parking: a current timestamp and valid positive Speed produces Reported driving; current zero Speed produces Reported stopped, with Engine On/Off/Unknown shown as a subtype. Missing, invalid or non-current speed/time produces Activity unavailable. These rules do not require coordinates, GPS signal, positionSource or GPRS, because those signals describe separate dimensions. They do not create speeding incidents, idling penalties or driver performance judgments.

GPS confidence is separate. A position is GPS-verified only when its timestamp is current, coordinates are valid, GPS reports connected, and positionSource explicitly resolves to GPS. EES counts positive speed as GPS-verified driving only when those checks pass; a No GPS, Wi-Fi, LBS, other, unknown, stale or incomplete position never upgrades reported speed to GPS-verified movement. Zero speed is a reported stop, not proof of a precise fixed location. GPRS Online/Offline/Unknown, GPS signal, position source, and position freshness remain independently visible. The latest verified GPS time uses only an explicitly GPS-quality position with GPS signal, valid coordinates, and a parsed current or stale time. API retrieval time remains separate.

Forth's [vehicle status feature update](https://www.forthtrack.co.th/2019/11/06/21624/) lists “moving,” parked with engine on/off, GPS signal failure, and communication failure as separate states. The public material does not define “Working” and “Parking” as API fields or map those dashboard categories one-to-one to EES activity. EES does not force its counts to match those labels.

### Office accuracy review

Authorized office users with `business:read` can expand **Tracking accuracy review** in the Fleet Tracking Centre. It compares a narrow allowlist of upstream scalar values with their EES-normalized values for each vehicle. It uses the same `/api/admin/forth-tracking/vehicles` response already used by the dashboard, so it adds no Forth request and does not change the 60-second refresh interval. The response remains private and `no-store`; the view keeps values only in current page memory and creates no database records.

The source projection contains only `plateNumber`, `gpsID`, `driver`, `Latitude`, `Longitude`, `Speed`, `Engine`, `COG`, `GPS`, `GPRS`, `positionSource`, and `dateTime`. Strings have control/format characters replaced with spaces and are limited to 160 Unicode code points. Unsupported object/array values are not serialized. Driver source text is omitted when it fails the existing safe driver-label validation. Fields such as `IDCard`, `IDTransport`, sensor values, token data, credentials, and any other upstream properties are not included. The audit panel displays normalization warnings for missing, invalid, stale, unrecognized, and shortened values.

Source-to-EES transformations shown in the panel:

| Source field | EES display/normalization | What remains unverified |
| --- | --- | --- |
| `plateNumber` | Trimmed string; no registration record is changed. | Whether Forth's source formatting is canonical. |
| `gpsID` | String; finite numeric values are stringified. | The API contract's formal type. |
| `driver` | A safe display label; invalid or identifier-like values are omitted. | Whether the source label is current or assigned to the vehicle at the same moment. |
| `Speed` | Strict finite non-negative number; no numeric unit conversion. UI labels it km/h. | The published API unit. A single 66 km/h screen comparison is evidence for that record only. |
| `Engine` | Boolean On/Off/Unknown from observed boolean, 0/1, and common ON/OFF strings. | Complete source enum. |
| `Latitude`, `Longitude` | Numeric parse, validated as a coordinate pair and geographic ranges; audit shows full normalized numeric values. | Upstream precision and stated coordinate datum. |
| `COG` | Numeric parse; accepted only from 0 through 360; displayed in degrees. | Formal field definition/unit in the API schema. |
| `GPS`, `GPRS` | Independently parsed into connected/disconnected/unknown. GPS signal is not position quality; GPRS is communications state. | Complete source enum for either field. |
| `positionSource` | Preserved as a text value and classified only by existing explicit labels. `No GPS` stays separate from GPS-verified. | Full enum and the exact meaning of `No GPS` in the API. |
| `dateTime` | Original text is shown beside parsed UTC ISO time, Thailand local time, and freshness. | Timezone convention beyond the configured source timezone used by EES. |
| EES `fetchedAt` | API refresh/response-processing time, shown separately from `dateTime`. | It is not a position timestamp and should not be compared as one. |

GPS signal available alongside `positionSource: No GPS` is a real cross-field difference in the values EES receives. EES maps them independently: `GPS` sets `gpsConnectivity`; `positionSource` sets `positionQuality`. The [Forth GPS FAQ](https://www.forthtrack.co.th/gps-faq/) describes GPS → Wi-Fi → LBS fallback when GPS is unavailable, but does not publish the tracking API enum or define the `No GPS` label. The dashboard therefore does not force these values to agree. Compare the API fields in the accuracy view with the Forth website at near-matching report times; until the source field semantics are documented, a website/API disagreement remains unresolved rather than a confirmed EES normalization defect.

Forth's [public FAQ](https://www.forthtrack.co.th/gps-faq/) says its Open API can provide driving status, but it does not identify a response property, value mapping, or relation to the website's Working/Parking labels. The current EES normalizer does not map an explicit activity/status field. It derives **Reported driving/stopped** from `Speed` and `Engine`, and labels this as EES-derived. The current typed adapter also knows about a `statusCardReader` field but does not interpret it as vehicle activity. Because the normalizer is an allowlist, this establishes what EES currently consumes, not whether Forth's live response contains an additional unmapped status field. Verifying that would require Forth's response schema/sample or a separately approved, one-shot diagnostic that returns only upstream field names and aggregate presence/type counts.

#### Repeatable comparison checklist

1. Sign in as an authorized EES office user and open **Fleet Tracking Centre → Tracking accuracy review**. Search for `63-3543`, then `61-2835`, then `64-0359`.
2. Expand one vehicle row. Compare the source `dateTime` to EES's Thailand-local/UTC normalized time first; use records whose source report times are near the Forth screen observation. Record the API refresh time separately.
3. Compare registration, device ID, safe reported-driver label, speed, engine, latitude/longitude, heading, GPS, GPRS, and position source. Use the shown raw source scalar and EES value; note any warnings and whether a displayed location is GPS-verified.
4. For each discrepancy, note the vehicle, observation time, source field, source value, EES value, and whether it appears to be timing, formatting, normalization, semantics, or missing data. Do not treat the Forth website as data EES has accessed; compare it manually in the authorized Forth session.
5. Repeat for each of the 21 vehicles. Mark only individually checked records as verified; do not report fleet-wide verification until the full comparison is complete.

Do not use this audit view to alter registrations, maintenance, mileage, service records, or other operational data. No telemetry is synchronized to Supabase.

### One-shot status aggregate

An authorized office user with business:read may manually invoke GET /api/admin/forth-tracking/status-diagnostic?confirm=aggregate-only after confirming in the Fleet Tracking Centre. The endpoint requires that explicit confirmation and returns aggregate counts for communications, position freshness, GPS signal, position-quality category, speed availability, engine state, classification reason, and the raw shape category of the top-level positionSource field. It also counts type categories for source-like alternate fields found at the top level or in shallow nested position/location objects, without returning any field names or values. Shape categories are missing, null, empty string, number, Boolean, recognized string, unrecognized string, and other. For unrecognized string values in the canonical positionSource field only, it returns a deduplicated list of at most 20 sanitized labels, each at most 80 Unicode code points, with occurrence counts. Raw source text is captured only for this explicitly requested diagnostic, not ordinary fleet requests. Control and format characters are replaced by spaces and whitespace is collapsed; empty or overlength labels are omitted and counted. These labels are untrusted values, not verified source categories, and are rendered as text. It omits records, IDs, registrations, driver values, coordinates, timestamps, alternate raw fields/keys, tokens, and credentials. A versioned browser session key allows one attempt in a tab session for this diagnostic; it never runs on page load or normal refresh. It makes one read-only tracking fetch (plus a token request if no valid in-memory token exists). It performs no Supabase writes and does not change fleet records. Do not infer a position-source mapping from label text alone; use an authoritative enum or clearly established semantics.

The latest Production aggregate only showed 15 unknown positionQuality values; it did not retain enough information to tell whether those values were missing, null, another type, or unrecognized strings. Code inspection confirms that EES reads only the top-level positionSource property and does not use GPS as a fallback. Until the expanded sanitized aggregate is run, the exact Production response shape and any alternate field mapping remain unverified. Do not map a candidate field or enum from counts alone.

Vehicle matching is read-only. It prefers an explicitly stored Forth GPS device ID, then compares registrations after removing only whitespace and harmless separators. Thai characters are retained. Duplicate matches are flagged for review, province differences are respected when available, and no database write or automatic vehicle change is performed.

The API route and utility do not access or change maintenance records, vehicle mileage, odometer readings, service intervals, reminders, maintenance history, or vehicle registration data.

## Future alert architecture (not implemented)

The current normalized read-only tracking service can later feed alert evaluation without changing maintenance or mileage workflows:

- **GPS disconnection:** evaluate connectivity and last qualified GPS update against an approved threshold, with a recovery event to prevent repeated notices.
- **Engine-on while stationary:** require a current GPS position, `engineOn === true`, and reported speed of zero for a configured duration; treat missing or stale samples as unknown rather than inferring a prolonged stop.
- **Geofences:** evaluate validated coordinates against versioned, approved geofence geometry and emit enter/exit transitions with deduplication.
- **Speeding:** compare GPS speed only with an independently verified, time- and location-appropriate road-speed-limit source. GPS speed alone cannot establish the applicable legal limit.
- **Persistent notifications and acknowledgements:** a later phase would need a dedicated notification schema, retention/deduplication rules, and separately authorized database writes for creation, acknowledgement, and audit history. The current integration performs none of these writes.
