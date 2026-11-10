/**
 * Visual fleet map intelligence helpers (V19).
 * Cameras and display filters never rewrite Forth coordinates.
 */

import {
  getForthFleetMapRecords,
  getForthReportedActivity,
  isForthGpsPositionVerified,
  recordNeedsForthAttentionReview,
  type ForthReportedActivity
} from "@/lib/forth-tracking-view";
import type { ForthFleetTrackingRecord } from "@/lib/forth-tracking-server";
import { isWithinForthCoreOpsBounds } from "@/lib/forth-map-ops";

/** Independent of Fleet Monitor list filters — only changes what the map emphasises. */
export type ForthMapDisplayFilter = "all" | "driving" | "gps_verified";

export type ForthMapViewLabel =
  | "core_operations"
  | "all_fleet"
  | "driving"
  | "gps_verified"
  | "selected";

export type ForthGroupAccent = "driving" | "attention" | "mixed" | "neutral";

export type ForthGroupMemberSummary = {
  key: string;
  registration: string;
  speed: number | null;
  activity: ForthReportedActivity;
  activityKind: "driving" | "stopped" | "uncertain" | "unavailable";
  gpsVerified: boolean;
  reportAgeTimestamp: string | null;
};

/** Reported driving with a valid map coordinate — activity classification, not GPS proof. */
export function isForthMapDrivingCandidate(record: ForthFleetTrackingRecord) {
  return getForthReportedActivity(record) === "driving";
}

export function getForthDrivingMapRecords(records: ForthFleetTrackingRecord[]) {
  return getForthFleetMapRecords(records).filter(({ record }) => isForthMapDrivingCandidate(record));
}

export function filterForthMapDisplayRecords(
  records: ForthFleetTrackingRecord[],
  displayFilter: ForthMapDisplayFilter
) {
  if (displayFilter === "driving") {
    return records.filter((record) => isForthMapDrivingCandidate(record));
  }
  if (displayFilter === "gps_verified") {
    return records.filter((record) => isForthGpsPositionVerified(record));
  }
  return records;
}

export function resolveForthMapViewLabel(input: {
  cameraMode: string;
  mapMode: "reported" | "gps";
  displayFilter: ForthMapDisplayFilter;
  selectedKey: string | null;
}): ForthMapViewLabel {
  if (input.displayFilter === "driving" || input.cameraMode === "driving") return "driving";
  if (input.cameraMode === "selected" && input.selectedKey) return "selected";
  if (input.displayFilter === "gps_verified" || input.mapMode === "gps" || input.cameraMode === "gps_verified") {
    return "gps_verified";
  }
  if (input.cameraMode === "full_fleet" || input.cameraMode === "thailand_neighbours") return "all_fleet";
  return "core_operations";
}

/**
 * Driving vehicles with valid coordinates that sit outside the current map viewport.
 * Presence is never denied — they remain listed in Fleet Monitor.
 */
export function classifyDrivingOutsideViewport(
  drivingPositioned: Array<{ key: string; latitude: number; longitude: number }>,
  visibleKeys: string[] | null
) {
  if (!visibleKeys) {
    return { inside: drivingPositioned.map((point) => point.key), outside: [] as string[] };
  }
  const visible = new Set(visibleKeys);
  const inside: string[] = [];
  const outside: string[] = [];
  for (const point of drivingPositioned) {
    if (visible.has(point.key)) inside.push(point.key);
    else outside.push(point.key);
  }
  return { inside, outside };
}

export function classifyDrivingOutsideCoreOperations(
  drivingPositioned: Array<{ key: string; latitude: number; longitude: number }>
) {
  const inside: string[] = [];
  const outside: string[] = [];
  for (const point of drivingPositioned) {
    if (isWithinForthCoreOpsBounds(point.latitude, point.longitude)) inside.push(point.key);
    else outside.push(point.key);
  }
  return { inside, outside };
}

/** Bounds for Fit All Driving — only vehicles with valid Forth coordinates. */
export function getForthDrivingFitPositions(
  records: ForthFleetTrackingRecord[]
): Array<{ key: string; position: [number, number] }> {
  return getForthDrivingMapRecords(records).map(({ key, position }) => ({ key, position }));
}

export function activityKindFromReported(activity: ForthReportedActivity): ForthGroupMemberSummary["activityKind"] {
  if (activity === "driving") return "driving";
  if (activity === "uncertain") return "uncertain";
  if (activity === "unavailable") return "unavailable";
  return "stopped";
}

export function summarizeForthMapGroup(
  recordsByKey: Map<string, ForthFleetTrackingRecord>,
  memberKeys: string[]
): { accent: ForthGroupAccent; drivingCount: number; attentionCount: number; members: ForthGroupMemberSummary[] } {
  let drivingCount = 0;
  let attentionCount = 0;
  const members: ForthGroupMemberSummary[] = [];
  for (const key of memberKeys) {
    const record = recordsByKey.get(key);
    if (!record) continue;
    const activity = getForthReportedActivity(record);
    if (activity === "driving") drivingCount += 1;
    if (recordNeedsForthAttentionReview(record)) attentionCount += 1;
    members.push({
      key,
      registration: record.vehicleRegistration || record.gpsDeviceId || "—",
      speed: record.speed,
      activity,
      activityKind: activityKindFromReported(activity),
      gpsVerified: isForthGpsPositionVerified(record),
      reportAgeTimestamp: record.lastGpsTimestamp
    });
  }
  members.sort((left, right) => {
    const rank = (kind: ForthGroupMemberSummary["activityKind"]) =>
      kind === "driving" ? 0 : kind === "uncertain" ? 1 : kind === "stopped" ? 2 : 3;
    return rank(left.activityKind) - rank(right.activityKind) || left.registration.localeCompare(right.registration);
  });
  const accent: ForthGroupAccent =
    drivingCount > 0 && attentionCount > 0
      ? "mixed"
      : drivingCount > 0
        ? "driving"
        : attentionCount > 0
          ? "attention"
          : "neutral";
  return { accent, drivingCount, attentionCount, members };
}

/** Prefer keeping selected / driving markers fully visible when a display filter is active. */
export function shouldEmphasizeMapVehicle(
  record: ForthFleetTrackingRecord,
  displayFilter: ForthMapDisplayFilter,
  selected: boolean
) {
  if (selected) return true;
  if (displayFilter === "all") return true;
  if (displayFilter === "driving") return isForthMapDrivingCandidate(record);
  if (displayFilter === "gps_verified") return isForthGpsPositionVerified(record);
  return true;
}
