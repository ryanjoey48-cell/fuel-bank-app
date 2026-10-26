import { normalizeForthRegistration } from "./forth-tracking";
import { parseForthTripsResponse } from "./forth-history-contract";

/** Dormant runner: no route, credentials, environment switch or default dependencies. */
export type HistoryTestGrant = {
  id: string; operatorId: string; deploymentId: string; deviceId: string;
  registration: string; date: string; expiresAt: number;
  providerApprovalReference: string; executionApprovalReference: string;
};

export type HistoryTestDependencies = {
  verifyOfficeUser: () => Promise<{ id: string; businessRead: boolean }>;
  readGrant: (id: string) => Promise<HistoryTestGrant | null>;
  // Must atomically compare the entire approved grant, check expiry and consume
  // it in shared durable storage. A local flag is not a valid implementation.
  consumeGrant: (grant: HistoryTestGrant) => Promise<boolean>;
  getFleet: () => Promise<{ connectionStatus: string; error: unknown; records: Array<{ gpsDeviceId: string | null; vehicleRegistration: string | null }> }>;
  getTrips: (input: { deviceId: string; forthDate: string; language: "en" }) => Promise<
    { ok: true; payload: unknown } | { ok: false; status: number; error: { code: string; message: string } }
  >;
  now: () => number;
};

export async function runControlledHistoryTest(
  context: { environment: string; deploymentId: string; grantId: string },
  dependencies: HistoryTestDependencies
) {
  try {
    if (context.environment !== "preview") return { ok: false as const, code: "preview_required" };
    const user = await dependencies.verifyOfficeUser();
    if (!user.businessRead) return { ok: false as const, code: "permission_denied" };
    const grant = await dependencies.readGrant(context.grantId);
    if (!grant || grant.id !== context.grantId || grant.operatorId !== user.id ||
      grant.deploymentId !== context.deploymentId || !context.deploymentId ||
      !grant.providerApprovalReference.trim() || !grant.executionApprovalReference.trim() ||
      !Number.isFinite(grant.expiresAt) || grant.expiresAt <= dependencies.now() ||
      grant.expiresAt - dependencies.now() > 15 * 60_000 ||
      grant.date !== "2026-10-24" || !grant.deviceId.trim() ||
      normalizeForthRegistration(grant.registration) !== normalizeForthRegistration("3ฒน-9565")) {
      return { ok: false as const, code: "approval_required" };
    }
    const fleet = await dependencies.getFleet();
    if (fleet.connectionStatus !== "connected" || fleet.error) return { ok: false as const, code: "fleet_unavailable" };
    const devices = fleet.records.filter(record => record.gpsDeviceId === grant.deviceId);
    const registrations = fleet.records.filter(record => normalizeForthRegistration(record.vehicleRegistration) === normalizeForthRegistration(grant.registration));
    if (devices.length !== 1 || registrations.length !== 1 || devices[0] !== registrations[0]) {
      return { ok: false as const, code: "identity_unverified" };
    }
    if (grant.expiresAt <= dependencies.now() || !await dependencies.consumeGrant(grant)) {
      return { ok: false as const, code: "grant_unavailable" };
    }
    // Consumed even on timeout/error. This runner never retries or releases a grant.
    const response = await dependencies.getTrips({ deviceId: grant.deviceId, forthDate: "20261024", language: "en" });
    if (!response.ok) return { ok: false as const, code: "report_failed", status: response.status };
    const parsed = parseForthTripsResponse(response.payload);
    if (!parsed.ok || parsed.records.some(record => record.boxId !== grant.deviceId)) {
      return { ok: false as const, code: "invalid_report" };
    }
    const records = parsed.records.map(({ driver: _driver, ...record }) => record);
    return { ok: true as const, records, timestampInterpretation: "unverified", durationInterpretation: "unverified" };
  } catch {
    return { ok: false as const, code: "test_unavailable" };
  }
}
