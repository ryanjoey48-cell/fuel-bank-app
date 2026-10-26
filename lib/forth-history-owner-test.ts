import { hasPermission } from "@/lib/authorization";
import { createServerSupabaseAdmin, requireVerifiedUser, resolveAccountAccess } from "@/lib/admin-user-management-server";
import { parseForthTripsResponse } from "@/lib/forth-history-contract";
import { getForthTrackingFleetData, getForthTripsReport } from "@/lib/forth-tracking-server";
import { normalizeForthRegistration } from "@/lib/forth-tracking";

const REGISTRATION = "3ฒน-9565";
const DATE = "2026-10-24";
const FORTH_DATE = "20261024";

type Dependencies = {
  verifyOfficeUser: (request: Request) => Promise<{ id: string; businessRead: boolean }>;
  getFleet: typeof getForthTrackingFleetData;
  getTrips: typeof getForthTripsReport;
};

async function verifyOfficeUser(request: Request) {
  const user = await requireVerifiedUser(request);
  const access = await resolveAccountAccess(createServerSupabaseAdmin(), user);
  return { id: user.id, businessRead: hasPermission(access, "business:read") };
}

const liveDependencies: Dependencies = {
  verifyOfficeUser,
  getFleet: getForthTrackingFleetData,
  getTrips: getForthTripsReport
};

/**
 * Callable only by a reviewed, isolated owner-invoked server process. No route,
 * CLI, scheduled job, environment switch or approval source is installed here.
 * The caller must verify account/read-only evidence and the owner's one-request
 * authorization before returning true from authorize. A local closure cannot
 * enforce single use across separate process launches.
 */
export function createOwnerInvokedHistoryTest(
  authorize: (scope: { operatorId: string; environmentId: string; registration: string; date: string }) => Promise<boolean>,
  dependencies: Dependencies = liveDependencies
) {
  let attempted = false;
  return async function run(input: { request: Request; environmentId: string }) {
    if (attempted) return { ok: false as const, code: "attempt_consumed" };
    if (process.env.VERCEL_ENV === "production" || !input.environmentId.trim()) {
      return { ok: false as const, code: "environment_unapproved" };
    }
    try {
      const user = await dependencies.verifyOfficeUser(input.request);
      if (!user.id || !user.businessRead) return { ok: false as const, code: "permission_denied" };
      const scope = { operatorId: user.id, environmentId: input.environmentId, registration: REGISTRATION, date: DATE };
      if (!await authorize(scope)) return { ok: false as const, code: "approval_required" };

      const fleet = await dependencies.getFleet();
      if (fleet.connectionStatus !== "connected" || fleet.error) return { ok: false as const, code: "fleet_unavailable" };
      const matches = fleet.records.filter(record => normalizeForthRegistration(record.vehicleRegistration) === normalizeForthRegistration(REGISTRATION));
      if (matches.length !== 1 || !matches[0].gpsDeviceId) return { ok: false as const, code: "identity_unverified" };
      const deviceId = matches[0].gpsDeviceId;
      if (fleet.records.filter(record => record.gpsDeviceId === deviceId).length !== 1) {
        return { ok: false as const, code: "identity_unverified" };
      }

      // Claim synchronously before the first upstream request. No retry or reset.
      if (attempted) return { ok: false as const, code: "attempt_consumed" };
      attempted = true;
      const report = await dependencies.getTrips({ deviceId, forthDate: FORTH_DATE, language: "en" });
      if (!report.ok) return { ok: false as const, code: "report_failed", status: report.status, errorCode: report.error.code };
      const parsed = parseForthTripsResponse(report.payload);
      if (!parsed.ok || parsed.records.some(record => record.boxId !== deviceId)) {
        return { ok: false as const, code: "invalid_report" };
      }
      // Keep source timestamps/durations raw. Do not expose reported driver names.
      return {
        ok: true as const,
        records: parsed.records.map(({ driver: _driver, ...record }) => record),
        timestampInterpretation: "unverified" as const,
        durationInterpretation: "unverified" as const
      };
    } catch {
      return { ok: false as const, code: "test_unavailable" };
    }
  };
}
