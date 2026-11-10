/**
 * Read-only customer-location proximity for Fleet Tracking.
 * Straight-line metres only — never road distance, ETA, arrival or geofence events.
 * Depot provisional 120 m pilot settings stay in ees-depot-proximity.ts.
 */

import type { ForthFleetTrackingRecord } from "@/lib/forth-tracking-server";
import { haversineDistanceKm } from "@/lib/forth-fleet-locations";
import {
  formatForthRelativeAge,
  getForthFleetRecordKey,
  isForthGpsPositionVerified
} from "@/lib/forth-tracking-view";

/** Verified GPS within this distance: "At location — proximity only". */
export const FORTH_LOCATION_AT_METERS = 100;
/** Verified GPS beyond at-threshold and within this: "Approaching location". */
export const FORTH_LOCATION_APPROACHING_METERS = 200;

export const FORTH_LOCATION_PROXIMITY_DEFAULTS = {
  atLocationMeters: FORTH_LOCATION_AT_METERS,
  approachingMeters: FORTH_LOCATION_APPROACHING_METERS
} as const;

export type ForthLocationProximityBand = "at_location" | "approaching" | "outside";

export type ForthLocationProximityPoint = {
  latitude: number;
  longitude: number;
};

export type ForthLocationProximityVehicle = {
  key: string;
  record: ForthFleetTrackingRecord;
  distanceMeters: number;
  distanceKm: number;
  band: ForthLocationProximityBand;
  /** True only when GPS is verified and source timestamp is fresh (current). */
  qualifiesForCustomerProximity: boolean;
  gpsVerified: boolean;
  timestampStatus: ForthFleetTrackingRecord["timestampStatus"];
  ageLabel: string | null;
  exclusionReason:
    | null
    | "outside_range"
    | "unverified_gps"
    | "stale_position"
    | "missing_source_time"
    | "invalid_coordinates";
};

export type ForthLocationProximitySummary = {
  atLocationCount: number;
  approachingCount: number;
  active: ForthLocationProximityVehicle[];
  /** Optional last-reported rows inside 200 m that do not qualify (unverified/stale). */
  cautionReports: ForthLocationProximityVehicle[];
  nearestPlanning: ForthLocationProximityVehicle[];
  geofencesActivated: false;
  notificationsActivated: false;
  arrivalsCreated: false;
};

function metersBetween(
  location: ForthLocationProximityPoint,
  latitude: number,
  longitude: number
) {
  const km = haversineDistanceKm(location.latitude, location.longitude, latitude, longitude);
  return km === null ? null : km * 1000;
}

function dedupeLatestRecords(records: readonly ForthFleetTrackingRecord[]) {
  const latest = new Map<string, ForthFleetTrackingRecord>();
  records.forEach((record, index) => {
    const key = getForthFleetRecordKey(record, index);
    const previous = latest.get(key);
    const incoming = Date.parse(record.lastGpsTimestamp ?? "");
    const existing = Date.parse(previous?.lastGpsTimestamp ?? "");
    if (!previous || (Number.isFinite(incoming) && (!Number.isFinite(existing) || incoming >= existing))) {
      latest.set(key, record);
    }
  });
  return latest;
}

export function classifyForthLocationProximityBand(
  distanceMeters: number,
  options?: { atLocationMeters?: number; approachingMeters?: number }
): ForthLocationProximityBand {
  const atMeters = options?.atLocationMeters ?? FORTH_LOCATION_AT_METERS;
  const approachingMeters = options?.approachingMeters ?? FORTH_LOCATION_APPROACHING_METERS;
  if (!(distanceMeters >= 0) || !Number.isFinite(distanceMeters)) return "outside";
  if (distanceMeters <= atMeters) return "at_location";
  if (distanceMeters <= approachingMeters) return "approaching";
  return "outside";
}

export function forthLocationProximityLabel(
  band: ForthLocationProximityBand,
  language: "en" | "th" = "en"
) {
  if (band === "at_location") {
    return language === "th" ? "ที่สถานที่ — ใกล้เคียงเท่านั้น" : "At location — proximity only";
  }
  if (band === "approaching") {
    return language === "th" ? "กำลังเข้าใกล้สถานที่" : "Approaching location";
  }
  return language === "th" ? "นอกระยะใกล้เคียง" : "Outside proximity";
}

function evaluateVehicleProximity(
  key: string,
  record: ForthFleetTrackingRecord,
  location: ForthLocationProximityPoint,
  options: {
    atLocationMeters: number;
    approachingMeters: number;
    nowMs: number;
    language: "en" | "th";
  }
): ForthLocationProximityVehicle | null {
  if (
    record.coordinateStatus !== "valid" ||
    record.latitude === null ||
    record.longitude === null ||
    !Number.isFinite(record.latitude) ||
    !Number.isFinite(record.longitude)
  ) {
    return null;
  }

  const distanceMeters = metersBetween(location, record.latitude, record.longitude);
  if (distanceMeters === null) return null;

  const band = classifyForthLocationProximityBand(distanceMeters, options);
  const gpsVerified = isForthGpsPositionVerified(record);
  const ageLabel = formatForthRelativeAge(record.lastGpsTimestamp, options.nowMs, options.language);

  let exclusionReason: ForthLocationProximityVehicle["exclusionReason"] = null;
  if (!record.lastGpsTimestamp) exclusionReason = "missing_source_time";
  else if (record.timestampStatus === "stale") exclusionReason = "stale_position";
  else if (record.timestampStatus !== "current") exclusionReason = "missing_source_time";
  else if (!gpsVerified) exclusionReason = "unverified_gps";
  else if (band === "outside") exclusionReason = "outside_range";

  const qualifiesForCustomerProximity =
    exclusionReason === null && (band === "at_location" || band === "approaching");

  return {
    key,
    record,
    distanceMeters,
    distanceKm: distanceMeters / 1000,
    band,
    qualifiesForCustomerProximity,
    gpsVerified,
    timestampStatus: record.timestampStatus,
    ageLabel,
    exclusionReason: qualifiesForCustomerProximity ? null : exclusionReason ?? "outside_range"
  };
}

/**
 * Customer proximity: only verified + fresh GPS within approaching threshold.
 * Does not create arrivals, geofences or notifications.
 */
export function summarizeForthLocationProximity(
  location: ForthLocationProximityPoint,
  records: readonly ForthFleetTrackingRecord[],
  options?: {
    atLocationMeters?: number;
    approachingMeters?: number;
    nearestLimit?: number;
    nowMs?: number;
    language?: "en" | "th";
  }
): ForthLocationProximitySummary {
  const atLocationMeters = options?.atLocationMeters ?? FORTH_LOCATION_AT_METERS;
  const approachingMeters = options?.approachingMeters ?? FORTH_LOCATION_APPROACHING_METERS;
  const nearestLimit = options?.nearestLimit ?? 8;
  const nowMs = options?.nowMs ?? Date.now();
  const language = options?.language ?? "en";

  const evaluated: ForthLocationProximityVehicle[] = [];
  for (const [key, record] of dedupeLatestRecords(records)) {
    const row = evaluateVehicleProximity(key, record, location, {
      atLocationMeters,
      approachingMeters,
      nowMs,
      language
    });
    if (row) evaluated.push(row);
  }

  evaluated.sort(
    (left, right) =>
      left.distanceMeters - right.distanceMeters ||
      (left.record.vehicleRegistration ?? "").localeCompare(right.record.vehicleRegistration ?? "", "en", {
        numeric: true
      })
  );

  const active = evaluated.filter((row) => row.qualifiesForCustomerProximity);
  const cautionReports = evaluated.filter(
    (row) =>
      !row.qualifiesForCustomerProximity &&
      row.distanceMeters <= approachingMeters &&
      (row.exclusionReason === "unverified_gps" ||
        row.exclusionReason === "stale_position" ||
        row.exclusionReason === "missing_source_time")
  );

  return {
    atLocationCount: active.filter((row) => row.band === "at_location").length,
    approachingCount: active.filter((row) => row.band === "approaching").length,
    active,
    cautionReports,
    nearestPlanning: evaluated.slice(0, Math.max(0, nearestLimit)),
    geofencesActivated: false,
    notificationsActivated: false,
    arrivalsCreated: false
  };
}

export function formatForthProximityDistanceMeters(distanceMeters: number) {
  if (distanceMeters < 1000) return `${Math.round(distanceMeters)} m`;
  const km = distanceMeters / 1000;
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
}
