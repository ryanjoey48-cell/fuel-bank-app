import { NextResponse } from "next/server";
import { hasPermission } from "@/lib/authorization";
import { AdminApiError, createServerSupabaseAdmin, requireVerifiedUser, resolveAccountAccess } from "@/lib/admin-user-management-server";
import { forthHistoryGateDenialDetail, isForthHistoryLiveRequestsEnabled } from "@/lib/forth-history-live-gate";
import { normalizeHistoricalLog } from "@/lib/forth-history-log";
import {
  beginForthHistoryRateLimit,
  releaseForthHistoryRateLimit
} from "@/lib/forth-history-rate-limit";
import {
  buildPlaybackObservations,
  describeHistoryGateOff,
  forthPlaybackDayRange
} from "@/lib/forth-journey-playback";
import { getForthLogReport, getForthTrackingFleetData } from "@/lib/forth-tracking-server";
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
  getLog: typeof getForthLogReport;
  sourceTimeZone?: string | null;
  rateLimitKey?: (userId: string, deviceId: string) => string;
  beginRateLimit?: typeof beginForthHistoryRateLimit;
  releaseRateLimit?: typeof releaseForthHistoryRateLimit;
  /** Explicitly authorised user ids (server-side, empty by default). */
  allowedUserIds: readonly string[];
  audit: typeof recordHistoryAudit;
  /** V7.8.3 request-origin ledger (shared with the provider-day route). Separate from the access audit, whose fields are unchanged. */
  logRequest?: typeof logProviderRequest;
};

async function readBoundedRequestJson(request: Request): Promise<unknown> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength && /^\d+$/.test(declaredLength) && Number(declaredLength) > MAX_REQUEST_BYTES) {
    throw new AdminApiError(413, "Playback history request is too large.");
  }
  const reader = request.body?.getReader();
  if (!reader) throw new AdminApiError(400, "A JSON playback request is required.");
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_REQUEST_BYTES) {
      await reader.cancel();
      throw new AdminApiError(413, "Playback history request is too large.");
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
    throw new AdminApiError(400, "Playback history request must be valid JSON.");
  }
}

function parsePlaybackBody(body: unknown): {
  deviceId: string;
  dateYmd: string;
  startHm: string;
  endHm: string;
  language: "en" | "th";
} | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  const deviceId = typeof record.deviceId === "string" ? record.deviceId.trim() : "";
  const dateYmd = typeof record.date === "string" ? record.date.trim() : "";
  const startHm = typeof record.startTime === "string" ? record.startTime.trim() : "00:00";
  const endHm = typeof record.endTime === "string" ? record.endTime.trim() : "23:59";
  const language = record.language === "th" ? "th" : "en";
  if (!deviceId || deviceId.length > 80) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateYmd)) return null;
  if (!/^\d{2}:\d{2}$/.test(startHm) || !/^\d{2}:\d{2}$/.test(endHm)) return null;
  return { deviceId, dateYmd, startHm, endHm, language };
}

export function createJourneyPlaybackPostHandler(overrides: Partial<RouteDependencies> = {}) {
  const dependencies: RouteDependencies = {
    enabled: isForthHistoryLiveRequestsEnabled(),
    requireUser: requireVerifiedUser,
    createAdmin: createServerSupabaseAdmin,
    resolveAccess: resolveAccountAccess,
    checkPermission: hasPermission,
    getFleet: getForthTrackingFleetData,
    getLog: getForthLogReport,
    sourceTimeZone: process.env.FORTH_SOURCE_TIME_ZONE ?? "Asia/Bangkok",
    rateLimitKey: (userId, deviceId) => `playback:${userId}:${deviceId}`,
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
    const origins = historyRequestRecorder({ request, route: "journey_playback", log: dependencies.logRequest });
    // One audit event per request. Context holds ids, the requested window and counts only: never coordinates or tokens.
    const note = (outcome: HistoryAuditEvent["outcome"], httpStatus: number, reason?: string) => {
      if (audited) return;
      audited = true;
      try { dependencies.audit({ ...context, correlationId, action: "playback_points", outcome, httpStatus, reason: reason ?? null }); } catch { /* never break the request */ }
      origins.finish(outcome, httpStatus);
    };
    let rateKey: string | null = null;
    try {
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

      if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
        throw new AdminApiError(415, "Journey playback requires a JSON request.");
      }
      const parsed = parsePlaybackBody(await readBoundedRequestJson(request));
      if (!parsed) throw new AdminApiError(400, "Choose one Forth device, a calendar day, and an optional time window.");
      context.deviceId = parsed.deviceId; context.date = parsed.dateYmd; origins.setTarget(parsed.deviceId, parsed.dateYmd); context.window = { startTime: parsed.startHm, endTime: parsed.endHm };

      if (!dependencies.enabled) {
        note("denied_gate_closed", 503, "history_live_disabled");
        return NextResponse.json(
          {
            status: "unavailable",
            code: "history_live_disabled",
            message: describeHistoryGateOff(parsed.language),
            detail: forthHistoryGateDenialDetail(parsed.language)
          },
          { status: 503, headers }
        );
      }

      const range = forthPlaybackDayRange(parsed.dateYmd, parsed.startHm, parsed.endHm);
      if (!range) throw new AdminApiError(400, "The selected time window is invalid for a single Bangkok day.");

      rateKey = dependencies.rateLimitKey!(user.id, parsed.deviceId);
      const rate = dependencies.beginRateLimit!(rateKey);
      if (!rate.allowed) {
        note("rate_limited", 429, "history_rate_limited");
        return NextResponse.json(
          {
            status: "unavailable",
            code: "history_rate_limited",
            message:
              parsed.language === "th"
                ? "คำขอประวัติถี่เกินไป — รอสักครู่แล้วลองใหม่"
                : "History requests are rate limited. Wait a moment, then retry."
          },
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
        const fleet = await dependencies.getFleet();
        if (fleet.connectionStatus !== "connected" || fleet.error) {
          throw new AdminApiError(503, "The authorized Forth fleet is unavailable; no history log was requested.");
        }
        const matchingDevices = fleet.records.filter((record) => record.gpsDeviceId === parsed.deviceId);
        if (matchingDevices.length === 0) throw new AdminApiError(404, "That device is not in the authorized Forth fleet.");
        if (matchingDevices.length !== 1) throw new AdminApiError(409, "That Forth device ID is ambiguous in the current fleet.");

        origins.providerCalled();
        const result = await dependencies.getLog({
          deviceId: parsed.deviceId,
          startTime: range.startTime,
          endTime: range.endTime
        });
        if (!result.ok) {
          const authExpired =
            result.error.code === "report_auth_rejected" ||
            /token|auth|unauthor/i.test(result.error.message);
          note("upstream_unavailable", result.status, authExpired ? "forth_auth_expired" : "forth_history_error");
          return NextResponse.json(
            {
              status: "unavailable",
              code: authExpired ? "forth_auth_expired" : result.error.code,
              message: authExpired
                ? parsed.language === "th"
                  ? "การยืนยันตัวตน Forth หมดอายุหรือถูกปฏิเสธ — ไม่มีประวัติถูกโหลด"
                  : "Forth authentication expired or was refused; no history was loaded."
                : result.error.message
            },
            { status: result.status, headers }
          );
        }

        const replay = normalizeHistoricalLog(result.payload, parsed.deviceId, dependencies.sourceTimeZone);
        if (!replay) throw new AdminApiError(502, "Forth historical GPS log returned an invalid response.");
      const observations = buildPlaybackObservations(replay);
      const gapCount = observations.filter((row) => row.isGapEdge).length;
      const empty = observations.length === 0;
      const verifiedCount = observations.filter((row) => row.point.verifiedGps).length;
      const trailEligibleCount = observations.filter((row) => row.point.trailEligible).length;
      context.observationCount = observations.length;
      note("authorised_ready", 200, empty ? "no_observations" : verifiedCount === 0 ? "reported_positions_only" : "verified_positions_present");

      return NextResponse.json(
        {
          status: "ready",
          deviceId: parsed.deviceId,
          vehicleRegistration: matchingDevices[0]?.vehicleRegistration ?? null,
          date: parsed.dateYmd,
          startTime: range.startTime,
          endTime: range.endTime,
          observationCount: observations.length,
          verifiedCount,
          trailEligibleCount,
          segmentCount: replay.segments.length,
          reportedTrailSegmentCount: replay.reportedTrailSegments.length,
          gapCount,
          empty,
          message: empty
            ? parsed.language === "th"
              ? "ช่วงเวลานี้ไม่มีบันทึก GPS จาก Forth — ไม่สร้างเส้นทางสมมติ"
              : "No Forth GPS observations for this window — no route was invented."
            : verifiedCount === 0 && trailEligibleCount > 0
              ? parsed.language === "th"
                ? "มีพิกัดรายงาน แต่ Forth ไม่ยืนยันแหล่ง GPS — เส้นทางสีอำพันเป็นการรายงาน ไม่ใช่ GPS ที่ยืนยัน"
                : "Reported coordinates exist, but Forth did not confirm GPS source — amber trail is reported position, not verified GPS."
              : undefined,
          points: observations.map((row) => ({
            index: row.index,
            sourceTimestamp: row.point.sourceTimestamp,
            timestampIso: row.point.timestampIso,
            latitude: row.point.latitude,
            longitude: row.point.longitude,
            verifiedGps: row.point.verifiedGps,
            trailEligible: row.point.trailEligible,
            speedKph: row.point.speedKph,
            engineOn: row.point.engineOn,
            positionQuality: row.point.positionQuality,
            gapBeforeMs: row.gapBeforeMs,
            isGapEdge: row.isGapEdge
          })),
          segments: replay.segments,
          reportedTrailSegments: replay.reportedTrailSegments,
          firstVerifiedIndex: replay.firstVerifiedIndex,
          lastVerifiedIndex: replay.lastVerifiedIndex,
          // Distance withheld until Forth units are confirmed for this account.
          distanceClaim: null
        },
        { headers }
      );
      } finally {
        if (rateKey) dependencies.releaseRateLimit!(rateKey);
        rateKey = null;
      }
    } catch (error) {
      if (rateKey) dependencies.releaseRateLimit!(rateKey);
      const status = error instanceof AdminApiError ? error.status : 500;
      // Fixed messages only: nothing from the request body, token or coordinates is echoed back.
      const message = error instanceof AdminApiError ? error.message : "Journey playback is unavailable.";
      note(auditOutcomeForStatus(status), status, error instanceof AdminApiError ? undefined : "unexpected_error");
      return NextResponse.json({ status: "unavailable", error: message }, { status, headers });
    }
  };
}
