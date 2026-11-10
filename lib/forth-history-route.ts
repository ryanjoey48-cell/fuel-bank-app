import { NextResponse } from "next/server";
import { hasPermission } from "@/lib/authorization";
import { AdminApiError, createServerSupabaseAdmin, requireVerifiedUser, resolveAccountAccess } from "@/lib/admin-user-management-server";
import { forthHistoryGateDenialDetail, isForthHistoryLiveRequestsEnabled } from "@/lib/forth-history-live-gate";
import {
  beginForthHistoryRateLimit,
  releaseForthHistoryRateLimit
} from "@/lib/forth-history-rate-limit";
import { parseForthTripsResponse, validateJourneyHistoryRequest } from "@/lib/forth-history-contract";
import { getForthTrackingFleetData, getForthTripsReport } from "@/lib/forth-tracking-server";
import { HISTORY_PLAYBACK_ALLOWLIST_ENV, PLAYBACK_DENIED_MESSAGE, decideHistoricalPlaybackAccess, parsePlaybackAllowlist } from "@/lib/forth-playback-access";
import { auditOutcomeForStatus, newCorrelationId, recordHistoryAudit, type HistoryAuditEvent } from "@/lib/forth-history-audit";
import { historyRequestRecorder, logProviderRequest } from "@/lib/fleet-provider-request-log";

const privateNoStoreHeaders = { "Cache-Control": "private, no-store" };
const MAX_REQUEST_BYTES = 8_192;

type RouteDependencies = {
  enabled: boolean;
  requireUser: typeof requireVerifiedUser;
  createAdmin: typeof createServerSupabaseAdmin;
  resolveAccess: typeof resolveAccountAccess;
  checkPermission: typeof hasPermission;
  getFleet: typeof getForthTrackingFleetData;
  getTrips: typeof getForthTripsReport;
  rateLimitKey?: (userId: string, deviceId: string) => string;
  beginRateLimit?: typeof beginForthHistoryRateLimit;
  releaseRateLimit?: typeof releaseForthHistoryRateLimit;
  allowedUserIds: readonly string[];
  audit: typeof recordHistoryAudit;
  /** V7.8.3 request-origin ledger (shared with the provider-day route). Separate from the access audit, whose fields are unchanged. */
  logRequest?: typeof logProviderRequest;
};

async function readBoundedRequestJson(request: Request): Promise<unknown> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength && /^\d+$/.test(declaredLength) && Number(declaredLength) > MAX_REQUEST_BYTES) {
    throw new AdminApiError(413, "Journey history request is too large.");
  }
  const reader = request.body?.getReader();
  if (!reader) throw new AdminApiError(400, "A JSON journey history request is required.");
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_REQUEST_BYTES) {
      await reader.cancel();
      throw new AdminApiError(413, "Journey history request is too large.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new AdminApiError(400, "Journey history request must be valid JSON.");
  }
}

export function createJourneyHistoryPostHandler(overrides: Partial<RouteDependencies> = {}) {
  const dependencies: RouteDependencies = {
    enabled: isForthHistoryLiveRequestsEnabled(),
    requireUser: requireVerifiedUser,
    createAdmin: createServerSupabaseAdmin,
    resolveAccess: resolveAccountAccess,
    checkPermission: hasPermission,
    getFleet: getForthTrackingFleetData,
    getTrips: getForthTripsReport,
    rateLimitKey: (userId, deviceId) => `journeys:${userId}:${deviceId}`,
    beginRateLimit: beginForthHistoryRateLimit,
    releaseRateLimit: releaseForthHistoryRateLimit,
    allowedUserIds: parsePlaybackAllowlist(process.env[HISTORY_PLAYBACK_ALLOWLIST_ENV]),
    audit: recordHistoryAudit,
    logRequest: logProviderRequest,
    ...overrides
  };

  return async function POST(request: Request) {
    const correlationId = newCorrelationId();
    const headers = { ...privateNoStoreHeaders, "X-Correlation-Id": correlationId };
    const context: Partial<HistoryAuditEvent> = {};
    let audited = false;
    // Which application action asked (allow-listed header) and whether Forth was actually contacted. No tokens, positions or device ids.
    const origins = historyRequestRecorder({ request, route: "journey_report", log: dependencies.logRequest });
    const note = (outcome: HistoryAuditEvent["outcome"], httpStatus: number, reason?: string) => {
      if (audited) return;
      audited = true;
      try { dependencies.audit({ ...context, correlationId, action: "journey_report", outcome, httpStatus, reason: reason ?? null }); } catch { /* never break the request */ }
      origins.finish(outcome, httpStatus);
    };
    let rateKey: string | null = null;
    try {
      // Match the existing protected tracking route: verification and office permission
      // must succeed before any upstream Forth request can be made. Journey reports name pickup and
      // destination places, so they need the explicit historical-location permission, not business:read alone.
      const user = await dependencies.requireUser(request);
      context.userId = user.id;
      origins.setUser(user.id);
      const admin = dependencies.createAdmin();
      const access = await dependencies.resolveAccess(admin, user);
      context.role = (access as { role?: HistoryAuditEvent["role"] } | null)?.role ?? null;
      const decision = decideHistoricalPlaybackAccess({ access, userId: user.id, checkPermission: dependencies.checkPermission as never, allowedUserIds: dependencies.allowedUserIds });
      if (!decision.allowed) {
        note(decision.reason === "no_office_access" ? "denied_no_office_access" : "denied_playback_permission", 403, decision.reason);
        throw new AdminApiError(403, decision.reason === "no_office_access" ? "EES office access is required." : PLAYBACK_DENIED_MESSAGE);
      }
      context.accessBasis = decision.basis;
      if (!dependencies.enabled) {
        note("denied_gate_closed", 503, "history_live_disabled");
        return NextResponse.json(
          {
            error: "Journey history is awaiting owner approval for office playback.",
            detail: forthHistoryGateDenialDetail("en")
          },
          { status: 503, headers }
        );
      }

      if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
        throw new AdminApiError(415, "Journey history requires a JSON request.");
      }
      const parsedRequest = validateJourneyHistoryRequest(await readBoundedRequestJson(request));
      if (!parsedRequest.ok) throw new AdminApiError(400, "Choose one Forth device and one valid calendar day.");
      context.deviceId = parsedRequest.deviceId; context.date = parsedRequest.forthDate; origins.setTarget(parsedRequest.deviceId, parsedRequest.forthDate);

      rateKey = dependencies.rateLimitKey!(user.id, parsedRequest.deviceId);
      const rate = dependencies.beginRateLimit!(rateKey);
      if (!rate.allowed) {
        note("rate_limited", 429, "history_rate_limited");
        return NextResponse.json(
          { error: "History requests are rate limited. Wait a moment, then retry.", code: "history_rate_limited" },
          {
            status: 429,
            headers: {
              ...headers,
              ...(rate.retryAfterSeconds ? { "Retry-After": String(rate.retryAfterSeconds) } : {})
            }
          }
        );
      }

      try {
        // Resolve against the current authorized Forth fleet snapshot. This rejects arbitrary,
        // unmatched and duplicate device IDs before any history report is requested.
        const fleet = await dependencies.getFleet();
        if (fleet.connectionStatus !== "connected" || fleet.error) {
          throw new AdminApiError(503, "The authorized Forth fleet is unavailable; no history report was requested.");
        }
        const matchingDevices = fleet.records.filter((record) => record.gpsDeviceId === parsedRequest.deviceId);
        if (matchingDevices.length === 0) throw new AdminApiError(404, "That device is not in the authorized Forth fleet.");
        if (matchingDevices.length !== 1) throw new AdminApiError(409, "That Forth device ID is ambiguous in the current fleet.");

        origins.providerCalled();
        const result = await dependencies.getTrips({
          deviceId: parsedRequest.deviceId,
          forthDate: parsedRequest.forthDate,
          language: parsedRequest.language
        });
        if (!result.ok) {
          note("upstream_unavailable", result.status, "forth_history_error");
          return NextResponse.json({ error: result.error.message, code: result.error.code }, { status: result.status, headers });
        }
        const history = parseForthTripsResponse(result.payload);
        if (!history.ok) throw new AdminApiError(502, "Forth journey history returned an invalid response.");
        if (history.records.some((record) => record.boxId !== parsedRequest.deviceId)) {
          throw new AdminApiError(502, "Forth journey history could not be associated with the selected device.");
        }

        // The report needs journey locations and source times, not driver text.
        const records = history.records.map((record) => ({
          boxId: record.boxId,
          plateNo: record.plateNo,
          vehicleName: record.vehicleName,
          rDate: record.rDate,
          arriveTime: record.arriveTime,
          source: record.source,
          departTime: record.departTime,
          arriveDestinationTime: record.arriveDestinationTime,
          destination: record.destination,
          departDestinationTime: record.departDestinationTime,
          routingTime: record.routingTime
        }));
        context.observationCount = records.length;
        note("authorised_ready", 200, records.length === 0 ? "no_records" : "records_returned");
        return NextResponse.json({ records }, { headers });
      } finally {
        if (rateKey) dependencies.releaseRateLimit!(rateKey);
        rateKey = null;
      }
    } catch (error) {
      if (rateKey) dependencies.releaseRateLimit!(rateKey);
      const status = error instanceof AdminApiError ? error.status : 500;
      const message = error instanceof AdminApiError ? error.message : "Forth journey history is unavailable.";
      note(auditOutcomeForStatus(status), status, error instanceof AdminApiError ? undefined : "unexpected_error");
      return NextResponse.json({ error: message }, { status, headers });
    }
  };
}
