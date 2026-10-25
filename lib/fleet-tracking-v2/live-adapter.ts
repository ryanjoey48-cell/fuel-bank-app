import {
  matchForthVehicle,
  type EesVehicleIdentity,
  type ForthPositionQuality,
  type ForthTimestampStatus,
  type ForthCoordinateStatus,
  type ForthGpsConnectivity
} from "@/lib/forth-tracking";
import type { ForthFleetTrackingRecord } from "@/lib/forth-tracking-server";
import {
  getForthFleetRecordKey,
  getForthReportedActivity,
  isForthGpsPositionVerified,
  type ForthReportedActivity
} from "@/lib/forth-tracking-view";
import { matchesVehicleSearch, type FleetV2Vehicle, type MotionState } from "@/lib/fleet-tracking-v2/view";

export type LiveEesIdentityMatch = {
  status: "matched" | "ambiguous" | "unmatched" | "unavailable";
  vehicleId: string | null;
  registration: string | null;
  matchedBy: "device_id" | "registration" | null;
  candidateVehicleIds: string[];
  reason: string;
};

export type FleetTrackingV2LiveVehicle = FleetV2Vehicle & {
  source: "forth";
  deviceId: string | null;
  reportedDriver: string | null;
  locationAddressEnglish: string | null;
  locationAddressThai: string | null;
  sourceTimestampRaw: string | null;
  timestampStatus: ForthTimestampStatus;
  reportFreshness: ForthTimestampStatus;
  activity: ForthReportedActivity;
  gpsConfidence: "verified" | "unverified" | "unavailable";
  gpsConfidenceReason: string;
  gpsConnectivity: ForthGpsConnectivity;
  positionQuality: ForthPositionQuality;
  positionSource: string | null;
  coordinateStatus: ForthCoordinateStatus;
  heading: number | null;
  eesIdentity: LiveEesIdentityMatch;
};

export type FleetTrackingV2LiveResult =
  | {
      status: "ready";
      fetchedAt: string | null;
      records: FleetTrackingV2LiveVehicle[];
      vehicleRegistryAvailable: boolean;
    }
  | {
      status: "unavailable";
      message: string;
    };

type UnknownRecord = Record<string, unknown>;

const timestampStatuses: ForthTimestampStatus[] = [
  "current", "stale", "missing", "invalid",
  "timezone_unconfigured", "timezone_invalid", "timezone_ambiguous"
];
const coordinateStatuses: ForthCoordinateStatus[] = ["valid", "missing", "invalid"];
const connectivityStatuses: ForthGpsConnectivity[] = ["connected", "disconnected", "unknown"];
const qualityStatuses: ForthPositionQuality[] = ["gps", "no_gps", "wifi", "lbs", "other", "unknown"];

function objectValue(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function textValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function enumValue<T extends string>(value: unknown, allowed: T[], fallback: T): T {
  return typeof value === "string" && allowed.includes(value as T) ? value as T : fallback;
}

function normalizeRecord(value: unknown): ForthFleetTrackingRecord {
  const raw = objectValue(value) ?? {};
  return {
    sourceAudit: (objectValue(raw.sourceAudit) ?? {}) as ForthFleetTrackingRecord["sourceAudit"],
    gpsDeviceId: textValue(raw.gpsDeviceId),
    vehicleRegistration: textValue(raw.vehicleRegistration),
    reportedDriver: textValue(raw.reportedDriver),
    locationAddressEnglish: textValue(raw.locationAddressEnglish),
    locationAddressThai: textValue(raw.locationAddressThai),
    locationPointOfInterest: textValue(raw.locationPointOfInterest),
    latitude: numberValue(raw.latitude),
    longitude: numberValue(raw.longitude),
    coordinateStatus: enumValue(raw.coordinateStatus, coordinateStatuses, "missing"),
    speed: numberValue(raw.speed),
    engineOn: typeof raw.engineOn === "boolean" ? raw.engineOn : null,
    gpsConnectivity: enumValue(raw.gpsConnectivity, connectivityStatuses, "unknown"),
    gprsConnectivity: enumValue(raw.gprsConnectivity, connectivityStatuses, "unknown"),
    sourceTimestampRaw: typeof raw.sourceTimestampRaw === "string" ? raw.sourceTimestampRaw : null,
    lastGpsTimestamp: textValue(raw.lastGpsTimestamp),
    timestampStatus: enumValue(raw.timestampStatus, timestampStatuses, "missing"),
    heading: numberValue(raw.heading),
    positionSource: textValue(raw.positionSource),
    positionQuality: enumValue(raw.positionQuality, qualityStatuses, "unknown")
  };
}

function normalizeVehicleRegistry(values: EesVehicleIdentity[] | null): EesVehicleIdentity[] | null {
  if (!Array.isArray(values)) return null;
  return values.flatMap((value) => {
    const raw = objectValue(value);
    const id = textValue(raw?.id);
    if (!raw || !id) return [];
    return [{
      id,
      vehicle_reg: textValue(raw.vehicle_reg),
      registration: textValue(raw.registration),
      province: textValue(raw.province),
      gpsDeviceId: textValue(raw.gpsDeviceId),
      gps_device_id: textValue(raw.gps_device_id),
      forthGpsId: textValue(raw.forthGpsId),
      forth_gps_id: textValue(raw.forth_gps_id)
    }];
  });
}

function activityMotion(activity: ForthReportedActivity): MotionState {
  if (activity === "driving") return "moving";
  if (activity.startsWith("stopped_")) return "stopped";
  return "unknown";
}

function isGpsConfidenceUnavailable(record: ForthFleetTrackingRecord) {
  return (record.timestampStatus !== "current" && record.timestampStatus !== "stale") ||
    !record.lastGpsTimestamp ||
    record.gpsConnectivity === "unknown" ||
    record.positionQuality === "unknown";
}

function confidenceReason(record: ForthFleetTrackingRecord, verified: boolean, unavailable: boolean) {

  if (verified) return "Current source report has valid coordinates, connected GPS, and GPS position quality.";
  if (record.timestampStatus === "timezone_unconfigured") return "Source timezone is not configured; the source time cannot be interpreted.";
  if (record.timestampStatus === "timezone_invalid" || record.timestampStatus === "timezone_ambiguous") return "Source time cannot be interpreted safely.";
  if (record.timestampStatus === "stale") return "The last source position is stale.";
  if (record.timestampStatus !== "current") return "A current source report time is unavailable.";
  if (record.coordinateStatus !== "valid") return "Valid source coordinates are unavailable.";
  if (record.gpsConnectivity !== "connected") return "GPS receiver connectivity is not confirmed.";
  if (record.positionQuality !== "gps") return "The source position is not confirmed as GPS.";
  return unavailable ? "GPS confidence is unavailable." : "GPS position is not verified.";
}

function unavailableMessage(value: unknown) {
  const error = objectValue(value);
  return textValue(error?.message) ?? "The Forth tracking source is unavailable.";
}

export function matchesLiveVehicleSearch(vehicle: FleetTrackingV2LiveVehicle, query: string) {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return true;
  return matchesVehicleSearch(vehicle, needle) ||
    [vehicle.deviceId, vehicle.reportedDriver, vehicle.eesIdentity.registration]
      .some((value) => typeof value === "string" && value.toLocaleLowerCase().includes(needle));
}
/** Adapt only the existing sanitized fleet response; this module performs no network or database writes. */
export function adaptForthFleetResponse(
  payload: unknown,
  vehicleRegistry: EesVehicleIdentity[] | null
): FleetTrackingV2LiveResult {
  const data = objectValue(payload);
  if (!data || !Array.isArray(data.records)) {
    return { status: "unavailable", message: "The live tracking response is incomplete." };
  }
  if (data.connectionStatus !== "connected" || data.error) {
    return { status: "unavailable", message: unavailableMessage(data.error) };
  }

  const registry = normalizeVehicleRegistry(vehicleRegistry);
  const usedKeys = new Map<string, number>();
  const candidates = (data.records as unknown[]).map((value, index) => {
    const record = normalizeRecord(value);
    const baseKey = getForthFleetRecordKey(record, index);
    const keyCount = (usedKeys.get(baseKey) ?? 0) + 1;
    usedKeys.set(baseKey, keyCount);
    const match = registry
      ? matchForthVehicle({ gpsDeviceId: record.gpsDeviceId, vehicleRegistration: record.vehicleRegistration }, registry)
      : null;
    return { record, id: keyCount === 1 ? baseKey : baseKey + "#" + keyCount, match };
  });

  const matchedRecordCounts = new Map<string, number>();
  for (const candidate of candidates) {
    if (candidate.match?.status === "matched" && candidate.match.vehicleId) {
      const id = candidate.match.vehicleId;
      matchedRecordCounts.set(id, (matchedRecordCounts.get(id) ?? 0) + 1);
    }
  }

  const records = candidates.map(({ record, id, match }) => {
    const verified = isForthGpsPositionVerified(record);
    const confidenceUnavailable = isGpsConfidenceUnavailable(record);
    const activity = getForthReportedActivity(record);
    const duplicateEesMatch = match?.status === "matched" &&
      match.vehicleId !== null && (matchedRecordCounts.get(match.vehicleId) ?? 0) > 1;
    let eesIdentity: LiveEesIdentityMatch;

    if (!registry) {
      eesIdentity = {
        status: "unavailable", vehicleId: null, registration: null, matchedBy: null,
        candidateVehicleIds: [], reason: "The RLS-scoped EES vehicle roster is unavailable."
      };
    } else if (duplicateEesMatch && match?.vehicleId) {
      eesIdentity = {
        status: "ambiguous", vehicleId: null, registration: null, matchedBy: null,
        candidateVehicleIds: [match.vehicleId],
        reason: "Multiple Forth records resolve to the same EES vehicle; review the association."
      };
    } else if (match?.status === "matched" && match.vehicleId) {
      const vehicle = registry.find((entry) => entry.id === match.vehicleId);
      eesIdentity = {
        ...match,
        registration: vehicle?.vehicle_reg ?? vehicle?.registration ?? null
      };
    } else {
      eesIdentity = {
        status: match?.status ?? "unavailable",
        vehicleId: null,
        registration: null,
        matchedBy: null,
        candidateVehicleIds: match?.candidateVehicleIds ?? [],
        reason: match?.reason ?? "The EES vehicle identity is unavailable."
      };
    }

    const gpsTrust: FleetV2Vehicle["gpsTrust"] = verified
      ? "verified"
      : record.timestampStatus === "stale"
        ? "stale"
        : record.coordinateStatus === "missing" || record.timestampStatus === "missing" || !record.lastGpsTimestamp
          ? "missing"
          : "unverified";
    const registration = record.vehicleRegistration ?? "Registration unavailable";
    const gpsQuality: FleetV2Vehicle["gpsQuality"] = record.positionQuality === "gps"
      ? "gps"
      : record.positionQuality === "wifi"
        ? "wifi"
        : record.positionQuality === "no_gps"
          ? "none"
          : "unknown";

    return {
      id,
      registration,
      trackerConnectivity: record.gprsConnectivity,
      locationNameEn: record.locationAddressEnglish ?? record.locationPointOfInterest ?? "",
      locationNameTh: record.locationAddressThai ?? record.locationPointOfInterest ?? "",
      latitude: record.latitude,
      longitude: record.longitude,
      speedKph: record.speed,
      engineOn: record.engineOn,
      reportedAt: record.lastGpsTimestamp,
      gpsTrust,
      gpsQuality,
      activityState: activityMotion(activity),
      source: "forth" as const,
      deviceId: record.gpsDeviceId,
      reportedDriver: record.reportedDriver,
      locationAddressEnglish: record.locationAddressEnglish,
      locationAddressThai: record.locationAddressThai,
      sourceTimestampRaw: record.sourceTimestampRaw,
      timestampStatus: record.timestampStatus,
      reportFreshness: record.timestampStatus,
      activity,
      gpsConfidence: verified ? "verified" as const : confidenceUnavailable ? "unavailable" as const : "unverified" as const,
      gpsConfidenceReason: confidenceReason(record, verified, confidenceUnavailable),
      gpsConnectivity: record.gpsConnectivity,
      positionQuality: record.positionQuality,
      positionSource: record.positionSource,
      coordinateStatus: record.coordinateStatus,
      heading: record.heading,
      eesIdentity
    };
  });

  return {
    status: "ready",
    fetchedAt: textValue(data.fetchedAt),
    records,
    vehicleRegistryAvailable: registry !== null
  };
}
