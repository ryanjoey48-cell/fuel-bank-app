import { NextResponse } from "next/server";
import { hasPermission } from "@/lib/authorization";
import { AdminApiError, createServerSupabaseAdmin, requireVerifiedUser, resolveAccountAccess } from "@/lib/admin-user-management-server";
import { FORTH_HISTORY_LIVE_REQUESTS_ENABLED } from "@/lib/forth-history-live-gate";
import { parseForthTripsResponse, validateJourneyHistoryRequest } from "@/lib/forth-history-contract";
import { getForthTrackingFleetData, getForthTripsReport } from "@/lib/forth-tracking-server";

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
    enabled: FORTH_HISTORY_LIVE_REQUESTS_ENABLED,
    requireUser: requireVerifiedUser,
    createAdmin: createServerSupabaseAdmin,
    resolveAccess: resolveAccountAccess,
    checkPermission: hasPermission,
    getFleet: getForthTrackingFleetData,
    getTrips: getForthTripsReport,
    ...overrides
  };

  return async function POST(request: Request) {
    try {
      // Match the existing protected tracking route: verification and office permission
      // must succeed before any upstream Forth request can be made.
      const user = await dependencies.requireUser(request);
      const admin = dependencies.createAdmin();
      const access = await dependencies.resolveAccess(admin, user);
      if (!dependencies.checkPermission(access, "business:read")) {
        throw new AdminApiError(403, "EES office access is required.");
      }
      if (!dependencies.enabled) {
        return NextResponse.json(
          { error: "Journey history is awaiting approval of a bounded live test." },
          { status: 503, headers: privateNoStoreHeaders }
        );
      }

      if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
        throw new AdminApiError(415, "Journey history requires a JSON request.");
      }
      const parsedRequest = validateJourneyHistoryRequest(await readBoundedRequestJson(request));
      if (!parsedRequest.ok) throw new AdminApiError(400, "Choose one Forth device and one valid calendar day.");

      // Resolve against the current authorized Forth fleet snapshot. This rejects arbitrary,
      // unmatched and duplicate device IDs before any history report is requested.
      const fleet = await dependencies.getFleet();
      if (fleet.connectionStatus !== "connected" || fleet.error) {
        throw new AdminApiError(503, "The authorized Forth fleet is unavailable; no history report was requested.");
      }
      const matchingDevices = fleet.records.filter((record) => record.gpsDeviceId === parsedRequest.deviceId);
      if (matchingDevices.length === 0) throw new AdminApiError(404, "That device is not in the authorized Forth fleet.");
      if (matchingDevices.length !== 1) throw new AdminApiError(409, "That Forth device ID is ambiguous in the current fleet.");

      const result = await dependencies.getTrips({
        deviceId: parsedRequest.deviceId,
        forthDate: parsedRequest.forthDate,
        language: parsedRequest.language
      });
      if (!result.ok) {
        return NextResponse.json({ error: result.error.message, code: result.error.code }, { status: result.status, headers: privateNoStoreHeaders });
      }
      const history = parseForthTripsResponse(result.payload);
      if (!history.ok) throw new AdminApiError(502, "Forth journey history returned an invalid response.");

      return NextResponse.json({ records: history.records }, { headers: privateNoStoreHeaders });
    } catch (error) {
      const status = error instanceof AdminApiError ? error.status : 500;
      const message = error instanceof AdminApiError ? error.message : "Forth journey history is unavailable.";
      return NextResponse.json({ error: message }, { status, headers: privateNoStoreHeaders });
    }
  };
}
