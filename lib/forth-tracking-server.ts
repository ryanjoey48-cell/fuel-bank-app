import {
  normalizeForthTrackingResponse,
  type ForthPositionSourceShape,
  type ForthTrackingRecord
} from "@/lib/forth-tracking";
import { summarizeForthFleet } from "@/lib/forth-tracking-view";

const TOKEN_ENDPOINT = "https://webapi.forthtrack.com/authorizationserver/token";
const TRACKING_ENDPOINT = "https://webapi.forthtrack.com/trackingresource/api/tracking";
const REQUEST_TIMEOUT_MS = 10_000;
const AUTH_FAILURE_COOLDOWN_MS = 60_000;
const TOKEN_EXPIRY_SKEW_MS = 30_000;

export type ForthTokenRequestProfile = "oauth-password-basic-v1";

export type ForthDiagnosticErrorCode =
  | "credentials_not_configured"
  | "oauth_protocol_unverified"
  | "authentication_rejected"
  | "authentication_unavailable"
  | "authentication_failed"
  | "tracking_auth_rejected"
  | "tracking_http_error"
  | "tracking_network_error"
  | "invalid_tracking_response";

export type ForthTrackingDiagnostic = {
  connectionStatus: "not_configured" | "connected" | "failed";
  authenticationStatus: "not_configured" | "protocol_unverified" | "authenticated" | "rejected" | "failed";
  credentialsConfigured: boolean;
  requestProfileConfigured: boolean;
  trackingRecordCount: number;
  recordsWithValidCoordinates: number;
  recordsWithMissingOrInvalidCoordinates: number;
  recordsWithMissingCoordinates: number;
  recordsWithInvalidCoordinates: number;
  mostRecentGpsUpdateAt: string | null;
  error: { code: ForthDiagnosticErrorCode; message: string } | null;
};

type ForthPositionSourceShapeCounts = Record<ForthPositionSourceShape, number>;

function emptyPositionSourceShapeCounts(): ForthPositionSourceShapeCounts {
  return {
    missing: 0,
    null: 0,
    empty: 0,
    number: 0,
    boolean: 0,
    recognized_string: 0,
    unrecognized_string: 0,
    other: 0
  };
}

const MAX_UNKNOWN_SOURCE_LABEL_LENGTH = 80;
const MAX_UNKNOWN_SOURCE_LABELS = 20;

function sanitizeDiagnosticSourceLabel(value: string): string | null {
  let label = "";
  let length = 0;
  let pendingSpace = false;
  for (const character of value) {
    const safeCharacter = /[\p{Cc}\p{Cf}]/u.test(character) ? " " : character;
    if (/\s/u.test(safeCharacter)) {
      if (label) pendingSpace = true;
      continue;
    }
    if (pendingSpace) {
      if (length >= MAX_UNKNOWN_SOURCE_LABEL_LENGTH) return null;
      label += " ";
      length += 1;
      pendingSpace = false;
    }
    if (length >= MAX_UNKNOWN_SOURCE_LABEL_LENGTH) return null;
    label += safeCharacter;
    length += 1;
  }
  return label || null;
}

function summarizeUnknownPositionSourceStrings(records: ForthTrackingRecord[]) {
  const counts = new Map<string, number>();
  let unknownStringCount = 0;
  let rejectedOccurrences = 0;
  let notListedOccurrences = 0;

  for (const record of records) {
    if (record.positionSourceShape !== "unrecognized_string" || typeof record.positionSourceRaw !== "string") continue;
    unknownStringCount += 1;
    const label = sanitizeDiagnosticSourceLabel(record.positionSourceRaw);
    if (!label) {
      rejectedOccurrences += 1;
      continue;
    }
    const existingCount = counts.get(label);
    if (existingCount !== undefined) {
      counts.set(label, existingCount + 1);
    } else if (counts.size < MAX_UNKNOWN_SOURCE_LABELS) {
      counts.set(label, 1);
    } else {
      notListedOccurrences += 1;
    }
  }

  const labels = [...counts.entries()]
    .sort(([leftLabel, leftCount], [rightLabel, rightCount]) =>
      rightCount - leftCount || (leftLabel < rightLabel ? -1 : leftLabel > rightLabel ? 1 : 0)
    )
    .map(([label, occurrences]) => ({ label, occurrences }));

  return {
    unknownStringCount,
    returnedUniqueCount: labels.length,
    notListedOccurrences,
    rejectedOccurrences,
    labels
  };
}

export type ForthFleetTrackingRecord = Pick<
  ForthTrackingRecord,
  | "gpsDeviceId"
  | "vehicleRegistration"
  | "reportedDriver"
  | "latitude"
  | "longitude"
  | "coordinateStatus"
  | "speed"
  | "engineOn"
  | "gpsConnectivity"
  | "gprsConnectivity"
  | "sourceTimestampRaw"
  | "lastGpsTimestamp"
  | "timestampStatus"
  | "heading"
  | "positionSource"
  | "positionQuality"
>;

export type ForthFleetTrackingData = {
  connectionStatus: ForthTrackingDiagnostic["connectionStatus"];
  fetchedAt: string | null;
  records: ForthFleetTrackingRecord[];
  error: ForthTrackingDiagnostic["error"];
};

type ForthCredentials = {
  clientId: string;
  clientSecret: string;
  username: string;
  password: string;
};

type ForthEnvironment = Record<string, string | undefined>;
type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type TokenResult =
  | { token: string }
  | { failure: "authentication_rejected" | "authentication_unavailable" | "authentication_failed" };

type TrackingResult = {
  connectionStatus: ForthTrackingDiagnostic["connectionStatus"];
  authenticationStatus: ForthTrackingDiagnostic["authenticationStatus"];
  credentialsConfigured: boolean;
  requestProfileConfigured: boolean;
  fetchedAt: string | null;
  records: ForthTrackingRecord[];
  error: ForthTrackingDiagnostic["error"];
};

function emptyDiagnostic(
  connectionStatus: ForthTrackingDiagnostic["connectionStatus"],
  authenticationStatus: ForthTrackingDiagnostic["authenticationStatus"],
  credentialsConfigured: boolean,
  requestProfileConfigured: boolean,
  error: ForthTrackingDiagnostic["error"]
): ForthTrackingDiagnostic {
  return {
    connectionStatus,
    authenticationStatus,
    credentialsConfigured,
    requestProfileConfigured,
    trackingRecordCount: 0,
    recordsWithValidCoordinates: 0,
    recordsWithMissingOrInvalidCoordinates: 0,
    recordsWithMissingCoordinates: 0,
    recordsWithInvalidCoordinates: 0,
    mostRecentGpsUpdateAt: null,
    error
  };
}

function safeError(code: ForthDiagnosticErrorCode): ForthDiagnosticError {
  const messages: Record<ForthDiagnosticErrorCode, string> = {
    credentials_not_configured: "Forth credentials are not configured on the server.",
    oauth_protocol_unverified: "The verified Forth token request profile is not enabled on the server.",
    authentication_rejected: "Forth rejected the authentication request.",
    authentication_unavailable: "Forth authentication service could not be reached.",
    authentication_failed: "Forth authentication response was not usable.",
    tracking_auth_rejected: "Forth did not accept the access token for tracking data.",
    tracking_http_error: "Forth tracking service returned an unsuccessful response.",
    tracking_network_error: "Forth tracking service could not be reached.",
    invalid_tracking_response: "Forth tracking service returned an invalid response."
  };
  return { code, message: messages[code] };
}

type ForthDiagnosticError = { code: ForthDiagnosticErrorCode; message: string };

function readCredentials(environment: ForthEnvironment): ForthCredentials | null {
  const values = {
    clientId: environment.FORTH_CLIENT_ID?.trim(),
    clientSecret: environment.FORTH_CLIENT_SECRET?.trim(),
    username: environment.FORTH_USERNAME?.trim(),
    password: environment.FORTH_PASSWORD?.trim()
  };
  return Object.values(values).every(Boolean) ? values as ForthCredentials : null;
}

function configuredTokenRequestProfile(environment: ForthEnvironment): ForthTokenRequestProfile | null {
  return environment.FORTH_TOKEN_REQUEST_PROFILE?.trim() === "oauth-password-basic-v1"
    ? "oauth-password-basic-v1"
    : null;
}

/**
 * Matches the password-token request generated by Forth's documented
 * DotNetOpenAuth WebServerClient example.
 */
function createTokenRequest(profile: ForthTokenRequestProfile, credentials: ForthCredentials): RequestInit {
  if (profile !== "oauth-password-basic-v1") throw new Error("Unsupported Forth token profile.");
  const body = new URLSearchParams({
    grant_type: "password",
    username: credentials.username,
    password: credentials.password
  });
  return {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`, "utf8").toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
      Accept: "application/json"
    },
    body,
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNetworkOrTimeoutError(error: unknown) {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError" || error.name === "TypeError");
}

function failureCodeForStatus(status: number): TokenResult {
  if ([400, 401, 403].includes(status)) return { failure: "authentication_rejected" };
  if (status === 429 || status >= 500) return { failure: "authentication_unavailable" };
  return { failure: "authentication_failed" };
}

export function createForthTrackingService(options: {
  environment?: ForthEnvironment;
  fetcher?: Fetcher;
  now?: () => number;
} = {}) {
  const environment = options.environment ?? process.env;
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  let cachedToken: { value: string; expiresAt: number } | null = null;
  let tokenInFlight: Promise<TokenResult> | null = null;
  let authFailure: TokenResult | null = null;
  let authRetryAfter = 0;

  async function requestToken(credentials: ForthCredentials, profile: ForthTokenRequestProfile): Promise<TokenResult> {
    let response: Response;
    try {
      response = await fetcher(TOKEN_ENDPOINT, createTokenRequest(profile, credentials));
    } catch (error) {
      return { failure: isNetworkOrTimeoutError(error) ? "authentication_unavailable" : "authentication_failed" };
    }

    if (!response.ok) return failureCodeForStatus(response.status) as TokenResult;

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return { failure: "authentication_failed" };
    }
    if (!isRecord(payload) || typeof payload.access_token !== "string" || !payload.access_token.trim() ||
      (typeof payload.token_type === "string" && payload.token_type.toLowerCase() !== "bearer")) {
      return { failure: "authentication_failed" };
    }

    const token = payload.access_token;
    const expirySeconds = typeof payload.expires_in === "number" && Number.isFinite(payload.expires_in) && payload.expires_in > 0
      ? payload.expires_in
      : null;
    if (expirySeconds !== null) {
      cachedToken = { value: token, expiresAt: now() + expirySeconds * 1000 };
    }
    authFailure = null;
    authRetryAfter = 0;
    return { token };
  }

  async function getAccessToken(credentials: ForthCredentials, profile: ForthTokenRequestProfile): Promise<TokenResult> {
    if (cachedToken && cachedToken.expiresAt - TOKEN_EXPIRY_SKEW_MS > now()) return { token: cachedToken.value };
    if (authRetryAfter > now() && authFailure) return authFailure;
    if (tokenInFlight) return tokenInFlight;

    tokenInFlight = requestToken(credentials, profile).then((result) => {
      if ("failure" in result) {
        cachedToken = null;
        authFailure = result;
        authRetryAfter = now() + AUTH_FAILURE_COOLDOWN_MS;
      }
      return result;
    }).finally(() => { tokenInFlight = null; });
    return tokenInFlight;
  }

  async function requestTracking(includeDiagnosticUnknownPositionSourceText = false): Promise<TrackingResult> {
    const credentials = readCredentials(environment);
    const profile = configuredTokenRequestProfile(environment);
    if (!credentials) {
      return { connectionStatus: "not_configured", authenticationStatus: "not_configured", credentialsConfigured: false, requestProfileConfigured: Boolean(profile), fetchedAt: null, records: [], error: safeError("credentials_not_configured") };
    }
    if (!profile) {
      return { connectionStatus: "not_configured", authenticationStatus: "protocol_unverified", credentialsConfigured: true, requestProfileConfigured: false, fetchedAt: null, records: [], error: safeError("oauth_protocol_unverified") };
    }

    const tokenResult = await getAccessToken(credentials, profile);
    if ("failure" in tokenResult) {
      const authenticationStatus = tokenResult.failure === "authentication_rejected" ? "rejected" : "failed";
      return { connectionStatus: "failed", authenticationStatus, credentialsConfigured: true, requestProfileConfigured: true, fetchedAt: null, records: [], error: safeError(tokenResult.failure) };
    }

    let response: Response;
    try {
      response = await fetcher(TRACKING_ENDPOINT, {
        method: "GET",
        headers: { Authorization: `Bearer ${tokenResult.token}`, Accept: "application/json" },
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      });
    } catch {
      return { connectionStatus: "failed", authenticationStatus: "authenticated", credentialsConfigured: true, requestProfileConfigured: true, fetchedAt: null, records: [], error: safeError("tracking_network_error") };
    }

    if (!response.ok) {
      const code = [401, 403].includes(response.status) ? "tracking_auth_rejected" : "tracking_http_error";
      return { connectionStatus: "failed", authenticationStatus: "authenticated", credentialsConfigured: true, requestProfileConfigured: true, fetchedAt: null, records: [], error: safeError(code) };
    }

    try {
      const payload: unknown = await response.json();
      const records = normalizeForthTrackingResponse(payload, {
        now: now(),
        sourceTimeZone: environment.FORTH_SOURCE_TIME_ZONE,
        includeDiagnosticUnknownPositionSourceText
      });
      return {
        connectionStatus: "connected",
        authenticationStatus: "authenticated",
        credentialsConfigured: true,
        requestProfileConfigured: true,
        fetchedAt: new Date(now()).toISOString(),
        records,
        error: null
      };
    } catch {
      return { connectionStatus: "failed", authenticationStatus: "authenticated", credentialsConfigured: true, requestProfileConfigured: true, fetchedAt: null, records: [], error: safeError("invalid_tracking_response") };
    }
  }

  function latestTimestamp(records: ForthTrackingRecord[]) {
    return records
      .filter((record) =>
        record.coordinateStatus === "valid" &&
        record.gpsConnectivity !== "disconnected" &&
        record.positionQuality === "gps" &&
        (record.timestampStatus === "current" || record.timestampStatus === "stale")
      )
      .map((record) => record.lastGpsTimestamp)
      .filter((timestamp): timestamp is string => timestamp !== null)
      .sort()
      .at(-1) ?? null;
  }

  async function diagnose(): Promise<ForthTrackingDiagnostic> {
    const result = await requestTracking();
    const records = result.records;
    if (result.connectionStatus !== "connected") {
      return emptyDiagnostic(result.connectionStatus, result.authenticationStatus, result.credentialsConfigured, result.requestProfileConfigured, result.error);
    }
    const recordsWithMissingCoordinates = records.filter((record) => record.coordinateStatus === "missing").length;
    const recordsWithInvalidCoordinates = records.filter((record) => record.coordinateStatus === "invalid").length;

    return {
      connectionStatus: result.connectionStatus,
      authenticationStatus: result.authenticationStatus,
      credentialsConfigured: result.credentialsConfigured,
      requestProfileConfigured: result.requestProfileConfigured,
      trackingRecordCount: records.length,
      recordsWithValidCoordinates: records.filter((record) => record.coordinateStatus === "valid").length,
      recordsWithMissingOrInvalidCoordinates: recordsWithMissingCoordinates + recordsWithInvalidCoordinates,
      recordsWithMissingCoordinates,
      recordsWithInvalidCoordinates,
      mostRecentGpsUpdateAt: latestTimestamp(records),
      error: result.error
    };
  }

  async function getFleetData(): Promise<ForthFleetTrackingData> {
    const result = await requestTracking();
    const records = result.records.map((record): ForthFleetTrackingRecord => ({
      gpsDeviceId: record.gpsDeviceId,
      vehicleRegistration: record.vehicleRegistration,
      reportedDriver: record.reportedDriver,
      latitude: record.latitude,
      longitude: record.longitude,
      coordinateStatus: record.coordinateStatus,
      speed: record.speed,
      engineOn: record.engineOn,
      gpsConnectivity: record.gpsConnectivity,
      gprsConnectivity: record.gprsConnectivity,
      sourceTimestampRaw: record.sourceTimestampRaw,
      lastGpsTimestamp: record.lastGpsTimestamp,
      timestampStatus: record.timestampStatus,
      heading: record.heading,
      positionSource: record.positionSource,
      positionQuality: record.positionQuality
    }));

    return {
      connectionStatus: result.connectionStatus,
      fetchedAt: result.fetchedAt,
      records,
      error: result.error
    };
  }

  async function diagnoseStatus() {
    const result = await requestTracking(true);
    const positionSourceShape = emptyPositionSourceShapeCounts();
    const alternateSourceCandidateShapes = emptyPositionSourceShapeCounts();
    let recordsWithAlternateSourceCandidate = 0;
    for (const record of result.records) {
      positionSourceShape[record.positionSourceShape] += 1;
      if (record.alternatePositionSourceCandidates.length > 0) recordsWithAlternateSourceCandidate += 1;
      for (const shape of record.alternatePositionSourceCandidates) {
        alternateSourceCandidateShapes[shape] += 1;
      }
    }
    const unknownPositionSourceStrings = summarizeUnknownPositionSourceStrings(result.records);
    const summary = summarizeForthFleet(result.records.map((record) => ({
      gpsDeviceId: null,
      vehicleRegistration: null,
      reportedDriver: null,
      latitude: record.latitude,
      longitude: record.longitude,
      coordinateStatus: record.coordinateStatus,
      speed: record.speed,
      engineOn: record.engineOn,
      gpsConnectivity: record.gpsConnectivity,
      gprsConnectivity: record.gprsConnectivity,
      sourceTimestampRaw: null,
      lastGpsTimestamp: record.lastGpsTimestamp,
      timestampStatus: record.timestampStatus,
      heading: null,
      positionSource: null,
      positionQuality: record.positionQuality
    })));

    return {
      connectionStatus: result.connectionStatus,
      recordCount: result.connectionStatus === "connected" ? result.records.length : 0,
      communications: summary.communications,
      positionFreshness: summary.positionFreshness,
      gpsSignal: summary.gpsSignal,
      positionQuality: summary.positionQuality,
      speedAvailability: summary.speedAvailability,
      engineState: summary.engineState,
      classificationReason: summary.classificationReason,
      positionSourceShape: {
        canonicalField: positionSourceShape,
        alternateCandidateRecords: recordsWithAlternateSourceCandidate,
        alternateCandidateValues: alternateSourceCandidateShapes
      },
      unknownPositionSourceStrings,
      error: result.connectionStatus === "connected" ? null : result.error?.message ?? "Forth tracking is unavailable."
    };
  }

  return { diagnose, getFleetData, diagnoseStatus };
}

export function createForthTrackingDiagnosticService(options: {
  environment?: ForthEnvironment;
  fetcher?: Fetcher;
  now?: () => number;
} = {}) {
  return createForthTrackingService(options).diagnose;
}

const forthTrackingService = createForthTrackingService();

export async function getForthTrackingDiagnostic() {
  return forthTrackingService.diagnose();
}

export async function getForthTrackingFleetData() {
  return forthTrackingService.getFleetData();
}

export async function getForthTrackingStatusDiagnostic() {
  return forthTrackingService.diagnoseStatus();
}
