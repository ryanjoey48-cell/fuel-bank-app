import type { ForthFleetTrackingRecord } from "@/lib/forth-tracking-server";
import type { ForthSourceFieldSnapshot } from "@/lib/forth-tracking";

export type ForthFleetStatus = "moving" | "stationary" | "unknown";
export type ForthReportedActivity =
  | "driving"
  | "stopped_engine_on"
  | "stopped_engine_off"
  | "stopped_engine_unknown"
  | "unavailable";
export type ForthFleetFilter = "all" | "driving" | "stopped" | "unavailable";
export type ForthFleetSort = "registration" | "speed_desc" | "updated_desc";
export type ForthMotionReason =
  | "moving"
  | "stationary"
  | "stale_position"
  | "position_time_unknown"
  | "coordinates_missing"
  | "coordinates_invalid"
  | "coordinates_unknown"
  | "gps_signal_unavailable"
  | "gps_signal_unknown"
  | "position_source_unknown"
  | "no_gps_position"
  | "non_gps_position"
  | "speed_unavailable"
  | "speed_invalid";
export type ForthNormalizationWarning =
  | "registration_missing"
  | "device_id_missing"
  | "driver_not_displayable"
  | "speed_missing"
  | "speed_invalid"
  | "engine_unavailable"
  | "coordinates_missing"
  | "coordinates_invalid"
  | "heading_invalid"
  | "gps_signal_unknown"
  | "gprs_unknown"
  | "position_time_stale"
  | "position_time_unavailable"
  | "position_source_unknown"
  | "source_value_truncated";
export type ForthAccuracyField =
  | "registration"
  | "device_id"
  | "driver"
  | "speed"
  | "engine"
  | "latitude"
  | "longitude"
  | "heading"
  | "gps_signal"
  | "gprs"
  | "position_source"
  | "position_time"
  | "retrieval_time"
  | "activity_status";
export type ForthAccuracyComparison = {
  field: ForthAccuracyField;
  sourceField: string | null;
  source: ForthSourceFieldSnapshot | null;
  normalized: string | null;
};

type CountMap<Keys extends string> = Record<Keys, number>;

function isUsableSpeed(speed: number | null): speed is number {
  return typeof speed === "number" && Number.isFinite(speed) && speed >= 0;
}

/** Explain missing or lossy normalization in the protected accuracy view. */
export function getForthNormalizationWarnings(record: ForthFleetTrackingRecord): ForthNormalizationWarning[] {
  const warnings: ForthNormalizationWarning[] = [];
  const snapshot = record.sourceAudit;
  if (snapshot.registration.shape === "missing" || snapshot.registration.shape === "null" || snapshot.registration.shape === "empty") warnings.push("registration_missing");
  if (snapshot.deviceId.shape === "missing" || snapshot.deviceId.shape === "null" || snapshot.deviceId.shape === "empty") warnings.push("device_id_missing");
  if (snapshot.driver.shape === "unsupported") warnings.push("driver_not_displayable");
  if (record.speed === null) {
    warnings.push(["missing", "null", "empty"].includes(snapshot.speed.shape) ? "speed_missing" : "speed_invalid");
  }
  if (record.engineOn === null) warnings.push("engine_unavailable");
  if (record.coordinateStatus === "missing") warnings.push("coordinates_missing");
  if (record.coordinateStatus === "invalid") warnings.push("coordinates_invalid");
  if (snapshot.heading.shape !== "missing" && snapshot.heading.shape !== "null" && snapshot.heading.shape !== "empty" && record.heading === null) warnings.push("heading_invalid");
  if (record.gpsConnectivity === "unknown") warnings.push("gps_signal_unknown");
  if (record.gprsConnectivity === "unknown") warnings.push("gprs_unknown");
  if (record.timestampStatus === "stale") warnings.push("position_time_stale");
  else if (record.timestampStatus !== "current") warnings.push("position_time_unavailable");
  if (record.positionQuality === "unknown") warnings.push("position_source_unknown");
  if (Object.values(snapshot).some((field) => field.truncated)) warnings.push("source_value_truncated");
  return warnings;
}

/** Build a deliberately narrow source-to-display comparison; no raw response object is retained. */
export function getForthAccuracyComparisons(record: ForthFleetTrackingRecord, fetchedAt: string | null): ForthAccuracyComparison[] {
  const validCoordinates = record.coordinateStatus === "valid" &&
    typeof record.latitude === "number" && typeof record.longitude === "number";
  const engineLabel = record.engineOn === null ? "Unknown" : record.engineOn ? "On" : "Off";
  const connectivityLabel = (value: ForthFleetTrackingRecord["gpsConnectivity"]) => value;
  const positionSourceValue = record.positionSource
    ? `${record.positionSource} (${record.positionQuality})`
    : record.positionQuality;
  const localTime = (value: string | null) => value
    ? new Intl.DateTimeFormat("en-GB", { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZone: "Asia/Bangkok", timeZoneName: "short" }).format(new Date(value))
    : null;

  return [
    { field: "registration", sourceField: "plateNumber", source: record.sourceAudit.registration, normalized: record.vehicleRegistration },
    { field: "device_id", sourceField: "gpsID", source: record.sourceAudit.deviceId, normalized: record.gpsDeviceId },
    { field: "driver", sourceField: "driver", source: record.sourceAudit.driver, normalized: record.reportedDriver },
    { field: "speed", sourceField: "Speed", source: record.sourceAudit.speed, normalized: record.speed === null ? null : `${record.speed} km/h` },
    { field: "engine", sourceField: "Engine", source: record.sourceAudit.engine, normalized: engineLabel },
    { field: "latitude", sourceField: "Latitude", source: record.sourceAudit.latitude, normalized: validCoordinates ? String(record.latitude) : null },
    { field: "longitude", sourceField: "Longitude", source: record.sourceAudit.longitude, normalized: validCoordinates ? String(record.longitude) : null },
    { field: "heading", sourceField: "COG", source: record.sourceAudit.heading, normalized: record.heading === null ? null : `${record.heading}°` },
    { field: "gps_signal", sourceField: "GPS", source: record.sourceAudit.gpsSignal, normalized: connectivityLabel(record.gpsConnectivity) },
    { field: "gprs", sourceField: "GPRS", source: record.sourceAudit.gprs, normalized: record.gprsConnectivity },
    { field: "position_source", sourceField: "positionSource", source: record.sourceAudit.positionSource, normalized: positionSourceValue },
    {
      field: "position_time",
      sourceField: "dateTime",
      source: record.sourceAudit.positionTimestamp,
      normalized: record.lastGpsTimestamp
        ? `${localTime(record.lastGpsTimestamp)} · ${record.timestampStatus} · ${record.lastGpsTimestamp}`
        : record.timestampStatus
    },
    { field: "retrieval_time", sourceField: "EES fetchedAt", source: null, normalized: fetchedAt ? `${localTime(fetchedAt)} · ${fetchedAt}` : null },
    { field: "activity_status", sourceField: null, source: null, normalized: `Reported ${getForthReportedActivity(record)}; EES derives this from Speed and Engine.` }
  ];
}

/** Operational activity uses only a fresh timestamp and a valid reported speed. */
export function getForthReportedActivity(record: ForthFleetTrackingRecord): ForthReportedActivity {
  if (record.timestampStatus !== "current" || !isUsableSpeed(record.speed)) return "unavailable";
  if (record.speed > 0) return "driving";
  if (record.engineOn === true) return "stopped_engine_on";
  if (record.engineOn === false) return "stopped_engine_off";
  return "stopped_engine_unknown";
}

export function getForthFleetFilterCategory(record: ForthFleetTrackingRecord): ForthFleetFilter {
  const activity = getForthReportedActivity(record);
  if (activity === "driving") return "driving";
  if (activity === "unavailable") return "unavailable";
  return "stopped";
}

export function isForthGpsPositionVerified(record: ForthFleetTrackingRecord) {
  return record.timestampStatus === "current" &&
    record.coordinateStatus === "valid" &&
    typeof record.latitude === "number" &&
    Number.isFinite(record.latitude) &&
    record.latitude >= -90 &&
    record.latitude <= 90 &&
    typeof record.longitude === "number" &&
    Number.isFinite(record.longitude) &&
    record.longitude >= -180 &&
    record.longitude <= 180 &&
    record.gpsConnectivity === "connected" &&
    record.positionQuality === "gps";
}

export function isForthGpsVerifiedDriving(record: ForthFleetTrackingRecord) {
  return isForthGpsPositionVerified(record) && isUsableSpeed(record.speed) && record.speed > 0;
}

export function getForthMotionReason(record: ForthFleetTrackingRecord): ForthMotionReason {
  if (record.timestampStatus === "stale") return "stale_position";
  if (record.timestampStatus !== "current") return "position_time_unknown";
  if (record.coordinateStatus === "missing") return "coordinates_missing";
  if (record.coordinateStatus === "invalid") return "coordinates_invalid";
  if (record.coordinateStatus !== "valid") return "coordinates_unknown";
  if (record.gpsConnectivity === "disconnected") return "gps_signal_unavailable";
  if (record.gpsConnectivity !== "connected") return "gps_signal_unknown";
  if (record.positionQuality === "unknown") return "position_source_unknown";
  if (record.positionQuality === "no_gps") return "no_gps_position";
  if (record.positionQuality !== "gps") return "non_gps_position";
  if (record.speed === null) return "speed_unavailable";
  if (!isUsableSpeed(record.speed)) return "speed_invalid";
  return record.speed > 0 ? "moving" : "stationary";
}

export function getForthFleetStatus(record: ForthFleetTrackingRecord): ForthFleetStatus {
  const reason = getForthMotionReason(record);
  if (reason === "moving") return "moving";
  if (reason === "stationary") return "stationary";
  return "unknown";
}

/**
 * A positive speed on a fresh record with valid coordinates can be surfaced as
 * provisional unless the signals support GPS-verified movement. It is never a
 * verified movement classification or an input to incident/alert decisions.
 */
export function isProvisionalReportedMovement(record: ForthFleetTrackingRecord) {
  return record.timestampStatus === "current" &&
    record.coordinateStatus === "valid" &&
    typeof record.latitude === "number" &&
    Number.isFinite(record.latitude) &&
    record.latitude >= -90 &&
    record.latitude <= 90 &&
    typeof record.longitude === "number" &&
    Number.isFinite(record.longitude) &&
    record.longitude >= -180 &&
    record.longitude <= 180 &&
    isUsableSpeed(record.speed) &&
    record.speed > 0 &&
    getForthFleetStatus(record) !== "moving";
}

export function summarizeForthFleet(records: ForthFleetTrackingRecord[]) {
  const summary = {
    total: records.length,
    reportedActivity: {
      driving: 0,
      stopped: 0,
      stoppedEngineOn: 0,
      stoppedEngineOff: 0,
      stoppedEngineUnknown: 0,
      unavailable: 0
    },
    positionConfidence: { gpsVerified: 0, notGpsVerified: 0 },
    gpsVerifiedDriving: 0,
    motion: { moving: 0, stationary: 0, unknown: 0 } as CountMap<ForthFleetStatus>,
    provisionalMotion: { reportedMoving: 0 },
    communications: { online: 0, offline: 0, unknown: 0 } as CountMap<"online" | "offline" | "unknown">,
    positionFreshness: { current: 0, stale: 0, unknown: 0 } as CountMap<"current" | "stale" | "unknown">,
    gpsSignal: { available: 0, unavailable: 0, unknown: 0 } as CountMap<"available" | "unavailable" | "unknown">,
    positionQuality: { gps: 0, no_gps: 0, wifi: 0, lbs: 0, other: 0, unknown: 0 } as CountMap<"gps" | "no_gps" | "wifi" | "lbs" | "other" | "unknown">,
    speedAvailability: { available: 0, unavailable: 0 } as CountMap<"available" | "unavailable">,
    engineState: { on: 0, off: 0, unknown: 0 } as CountMap<"on" | "off" | "unknown">,
    classificationReason: {
      moving: 0,
      stationary: 0,
      stale_position: 0,
      position_time_unknown: 0,
      coordinates_missing: 0,
      coordinates_invalid: 0,
      coordinates_unknown: 0,
      gps_signal_unavailable: 0,
      gps_signal_unknown: 0,
      position_source_unknown: 0,
      no_gps_position: 0,
      non_gps_position: 0,
      speed_unavailable: 0,
      speed_invalid: 0
    } as CountMap<ForthMotionReason>,
    lastVerifiedGpsPosition: null as string | null
  };

  for (const record of records) {
    const reportedActivity = getForthReportedActivity(record);
    summary.reportedActivity[reportedActivity === "stopped_engine_on" ? "stoppedEngineOn" :
      reportedActivity === "stopped_engine_off" ? "stoppedEngineOff" :
        reportedActivity === "stopped_engine_unknown" ? "stoppedEngineUnknown" : reportedActivity] += 1;
    if (reportedActivity.startsWith("stopped_")) summary.reportedActivity.stopped += 1;
    summary.positionConfidence[isForthGpsPositionVerified(record) ? "gpsVerified" : "notGpsVerified"] += 1;
    if (isForthGpsVerifiedDriving(record)) summary.gpsVerifiedDriving += 1;
    const reason = getForthMotionReason(record);
    summary.classificationReason[reason] += 1;
    summary.motion[getForthFleetStatus(record)] += 1;
    if (isProvisionalReportedMovement(record)) summary.provisionalMotion.reportedMoving += 1;
    summary.communications[record.gprsConnectivity === "connected" ? "online" : record.gprsConnectivity === "disconnected" ? "offline" : "unknown"] += 1;
    summary.positionFreshness[record.timestampStatus === "current" ? "current" : record.timestampStatus === "stale" ? "stale" : "unknown"] += 1;
    summary.gpsSignal[record.gpsConnectivity === "connected" ? "available" : record.gpsConnectivity === "disconnected" ? "unavailable" : "unknown"] += 1;
    summary.positionQuality[record.positionQuality ?? "unknown"] += 1;
    summary.speedAvailability[isUsableSpeed(record.speed) ? "available" : "unavailable"] += 1;
    summary.engineState[record.engineOn === true ? "on" : record.engineOn === false ? "off" : "unknown"] += 1;

    const isVerifiedGpsPosition =
      record.positionQuality === "gps" &&
      record.gpsConnectivity === "connected" &&
      record.coordinateStatus === "valid" &&
      (record.timestampStatus === "current" || record.timestampStatus === "stale") &&
      record.lastGpsTimestamp !== null;
    if (isVerifiedGpsPosition && (!summary.lastVerifiedGpsPosition || record.lastGpsTimestamp! > summary.lastVerifiedGpsPosition)) {
      summary.lastVerifiedGpsPosition = record.lastGpsTimestamp;
    }
  }

  return summary;
}

export function filterForthFleetRecords(
  records: ForthFleetTrackingRecord[],
  search: string,
  filter: ForthFleetFilter
) {
  const query = search.trim().toLocaleLowerCase();
  return records.filter((record) => {
    if (filter !== "all" && getForthFleetFilterCategory(record) !== filter) return false;
    if (!query) return true;
    return [record.vehicleRegistration, record.reportedDriver, record.gpsDeviceId]
      .some((value) => value?.toLocaleLowerCase().includes(query));
  });
}

export function sortForthFleetRecords(records: ForthFleetTrackingRecord[], sort: ForthFleetSort) {
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  return [...records].sort((left, right) => {
    if (sort === "speed_desc") {
      const leftSpeed = isUsableSpeed(left.speed) ? left.speed : null;
      const rightSpeed = isUsableSpeed(right.speed) ? right.speed : null;
      if (leftSpeed === null && rightSpeed !== null) return 1;
      if (rightSpeed === null && leftSpeed !== null) return -1;
      if (leftSpeed !== null && rightSpeed !== null && leftSpeed !== rightSpeed) return rightSpeed - leftSpeed;
    } else if (sort === "updated_desc") {
      const leftTime = left.timestampStatus === "current" || left.timestampStatus === "stale"
        ? Date.parse(left.lastGpsTimestamp ?? "") : Number.NaN;
      const rightTime = right.timestampStatus === "current" || right.timestampStatus === "stale"
        ? Date.parse(right.lastGpsTimestamp ?? "") : Number.NaN;
      if (!Number.isFinite(leftTime) && Number.isFinite(rightTime)) return 1;
      if (!Number.isFinite(rightTime) && Number.isFinite(leftTime)) return -1;
      if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) return rightTime - leftTime;
    }
    return collator.compare(left.vehicleRegistration ?? "", right.vehicleRegistration ?? "");
  });
}

export function getForthFleetRecordKey(record: ForthFleetTrackingRecord, index: number) {
  return `${record.gpsDeviceId || record.vehicleRegistration || "vehicle"}:${index}`;
}

export type ForthFleetMapRecord = {
  record: ForthFleetTrackingRecord;
  key: string;
  position: [number, number];
};

export function getForthFleetMapRecords(records: ForthFleetTrackingRecord[]): ForthFleetMapRecord[] {
  return records.flatMap((record, index) => {
    const { latitude, longitude } = record;
    if (
      record.coordinateStatus !== "valid" ||
      typeof latitude !== "number" ||
      typeof longitude !== "number" ||
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180
    ) return [];
    return [{
      record,
      key: getForthFleetRecordKey(record, index),
      position: [latitude, longitude] as [number, number]
    }];
  });
}

export function formatForthTrackingTime(value: string | null, language: "en" | "th") {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat(language === "th" ? "th-TH" : "en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "Asia/Bangkok",
    timeZoneName: "short"
  }).format(date);
}
