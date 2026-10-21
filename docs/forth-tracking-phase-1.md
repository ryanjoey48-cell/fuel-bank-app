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

### DotNetOpenAuth source trace

The behavior above was traced in the archived [DotNetOpenAuth v4.3.3.13295 source](https://github.com/DotNetOpenAuth/DotNetOpenAuth/tree/v4.3.3.13295). `WebServerClient` delegates a supplied client secret to `DefaultSecretApplicator`; `ExchangeUserCredentialForToken` creates `AccessTokenResourceOwnerPasswordCredentialsRequest` with the username and password and passes the optional scopes to the token request. The request class marks `username` and `password` as required and selects `GrantType.Password`; `AccessTokenRequestBase` sends a POST, and the core channel serializes its message fields as UTF-8 form-urlencoded data. With the default `NetworkCredential` applicator, `client_id` and `client_secret` are removed from message fields and HTTP Basic is applied as UTF-8 Base64 of `client_id:client_secret`. `ScopeEncoder` returns null for an empty collection, so a missing scopes argument produces no `scope` field. The success response maps `access_token` into the authorization state, and `CreateAuthorizingHandler(accessToken)` sets `Authorization: Bearer <token>` on outbound tracking requests.

Source files: [WebServerClient.cs](https://github.com/DotNetOpenAuth/DotNetOpenAuth/blob/v4.3.3.13295/src/DotNetOpenAuth.OAuth2.Client/OAuth2/WebServerClient.cs#L31-L51), [ClientBase.cs](https://github.com/DotNetOpenAuth/DotNetOpenAuth/blob/v4.3.3.13295/src/DotNetOpenAuth.OAuth2.Client/OAuth2/ClientBase.cs#L249-L259), [ClientCredentialApplicator.cs](https://github.com/DotNetOpenAuth/DotNetOpenAuth/blob/v4.3.3.13295/src/DotNetOpenAuth.OAuth2.Client/OAuth2/ClientCredentialApplicator.cs#L117-L142), [OAuth2ClientChannel.cs](https://github.com/DotNetOpenAuth/DotNetOpenAuth/blob/v4.3.3.13295/src/DotNetOpenAuth.OAuth2.Client/OAuth2/ChannelElements/OAuth2ClientChannel.cs#L159-L164), [AccessTokenResourceOwnerPasswordCredentialsRequest.cs](https://github.com/DotNetOpenAuth/DotNetOpenAuth/blob/v4.3.3.13295/src/DotNetOpenAuth.OAuth2.ClientAuthorization/OAuth2/Messages/AccessTokenResourceOwnerPasswordCredentialsRequest.cs#L76-L96), [AccessTokenRequestBase.cs](https://github.com/DotNetOpenAuth/DotNetOpenAuth/blob/v4.3.3.13295/src/DotNetOpenAuth.OAuth2.ClientAuthorization/OAuth2/Messages/AccessTokenRequestBase.cs#L25-L28), [ScopedAccessTokenRequest.cs](https://github.com/DotNetOpenAuth/DotNetOpenAuth/blob/v4.3.3.13295/src/DotNetOpenAuth.OAuth2.ClientAuthorization/OAuth2/Messages/ScopedAccessTokenRequest.cs#L27-L38), [Channel.cs](https://github.com/DotNetOpenAuth/DotNetOpenAuth/blob/v4.3.3.13295/src/DotNetOpenAuth.Core/Messaging/Channel.cs#L1130-L1152), [ScopeEncoder.cs](https://github.com/DotNetOpenAuth/DotNetOpenAuth/blob/v4.3.3.13295/src/DotNetOpenAuth.OAuth2/OAuth2/ChannelElements/ScopeEncoder.cs#L31-L37), [OAuthUtilities.cs](https://github.com/DotNetOpenAuth/DotNetOpenAuth/blob/v4.3.3.13295/src/DotNetOpenAuth.OAuth2/OAuth2/OAuthUtilities.cs#L161-L175), [AccessTokenSuccessResponse.cs](https://github.com/DotNetOpenAuth/DotNetOpenAuth/blob/v4.3.3.13295/src/DotNetOpenAuth.OAuth2.ClientAuthorization/OAuth2/Messages/AccessTokenSuccessResponse.cs#L54-L75), and [BearerTokenHttpMessageHandler.cs](https://github.com/DotNetOpenAuth/DotNetOpenAuth/blob/v4.3.3.13295/src/DotNetOpenAuth.OAuth2.Client/OAuth2/BearerTokenHttpMessageHandler.cs#L75-L89).

## Data handling

Tracking normalization is in `lib/forth-tracking.ts`. It preserves the exact source `dateTime` string for auditing, separately stores the normalized GPS position time, and keeps the API retrieval time in `fetchedAt`. The supplied Developer's Guide examples and accessible API material do not establish the timezone convention for timezone-less `dateTime` values. Timestamps with an explicit offset are normalized directly. Naive timestamps require `FORTH_SOURCE_TIME_ZONE`; with no configured zone they stay unparsed and report `timezone_unconfigured`. Invalid IANA zones are reported separately, and daylight-saving gaps or overlaps are not silently resolved. A position is marked stale after 15 minutes. The dashboard classifies a vehicle as moving or parked only when GPS is connected, a recent GPS position and valid coordinates are present, the source is not explicitly non-GPS or reporting signal loss, and a finite non-negative speed is reported. Positive speed means moving; zero means parked. Disconnected or stale records are offline/stale, and incomplete or timezone-ambiguous records remain unknown.

Vehicle matching is read-only. It prefers an explicitly stored Forth GPS device ID, then compares registrations after removing only whitespace and harmless separators. Thai characters are retained. Duplicate matches are flagged for review, province differences are respected when available, and no database write or automatic vehicle change is performed.

The API route and utility do not access or change maintenance records, vehicle mileage, odometer readings, service intervals, reminders, maintenance history, or vehicle registration data.

## Future alert architecture (not implemented)

The current normalized read-only tracking service can later feed alert evaluation without changing maintenance or mileage workflows:

- **GPS disconnection:** evaluate connectivity and last qualified GPS update against an approved threshold, with a recovery event to prevent repeated notices.
- **Engine-on while stationary:** require a current GPS position, `engineOn === true`, and reported speed of zero for a configured duration; treat missing or stale samples as unknown rather than inferring a prolonged stop.
- **Geofences:** evaluate validated coordinates against versioned, approved geofence geometry and emit enter/exit transitions with deduplication.
- **Speeding:** compare GPS speed only with an independently verified, time- and location-appropriate road-speed-limit source. GPS speed alone cannot establish the applicable legal limit.
- **Persistent notifications and acknowledgements:** a later phase would need a dedicated notification schema, retention/deduplication rules, and separately authorized database writes for creation, acknowledgement, and audit history. The current integration performs none of these writes.
