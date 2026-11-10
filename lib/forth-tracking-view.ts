import type { ForthFleetTrackingRecord } from "@/lib/forth-tracking-server";
import type { ForthSourceFieldSnapshot } from "@/lib/forth-tracking";
import { lookupForthSpeedConfig } from "@/lib/forth-speed-config";

export type ForthFleetStatus = "moving" | "stationary" | "unknown";
export type ForthReportedActivity =
  | "driving"
  | "uncertain"
  | "stopped_engine_on"
  | "stopped_engine_off"
  | "stopped_engine_unknown"
  | "unavailable";
export type ForthFleetFilter =
  | "all"
  | "online"
  | "driving"
  | "uncertain"
  | "stopped"
  | "unavailable"
  | "attention"
  | "offline"
  | "stale"
  | "unverified"
  | "engine_on_stopped"
  | "high_speed"
  | "missing_coordinates"
  | "verified";
export type ForthAttentionKind =
  | "offline"
  | "stale"
  | "missing_coordinates"
  | "engine_on_stopped"
  | "unverified_position"
  | "speed_engine_conflict";
export type ForthFleetSort = "operations" | "registration" | "speed_desc" | "updated_desc" | "status";
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
  | "speed_invalid"
  | "speed_engine_conflict";
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

export type ForthMarkerLabelPlacement = {
  key: string;
  left: number;
  top: number;
  width: number;
  height: number;
  selected: boolean;
  /** Show this label at wide zoom when it belongs to a selection, hover, or search result. */
  reveal?: boolean;
  priority?: number;
};

/** Select visible marker labels, keeping selected, hovered and search labels readable. */
export function getVisibleForthMarkerLabelKeys(
  placements: ForthMarkerLabelPlacement[],
  zoom: number,
  minimumZoom = 7
): Set<string> {
  if (!Number.isFinite(zoom)) return new Set();
  const wideZoom = zoom < minimumZoom;
  const eligible = wideZoom ? placements.filter((placement) => placement.selected || placement.reveal) : placements;

  const ordered = [...eligible].sort((left, right) => {
    if (left.selected !== right.selected) return left.selected ? -1 : 1;
    if ((left.priority ?? 0) !== (right.priority ?? 0)) return (right.priority ?? 0) - (left.priority ?? 0);
    return left.key.localeCompare(right.key);
  });
  const visible = new Set<string>();
  const occupied: ForthMarkerLabelPlacement[] = [];

  for (const candidate of ordered) {
    if (![candidate.left, candidate.top, candidate.width, candidate.height].every(Number.isFinite) || candidate.width <= 0 || candidate.height <= 0) continue;
    const overlaps = occupied.some((placed) =>
      candidate.left < placed.left + placed.width &&
      candidate.left + candidate.width > placed.left &&
      candidate.top < placed.top + placed.height &&
      candidate.top + candidate.height > placed.top
    );
    if (overlaps && !candidate.selected) continue;
    visible.add(candidate.key);
    occupied.push(candidate);
  }

  return visible;
}

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
  const reportedActivity = getForthReportedActivity(record);
  const activityDescription = reportedActivity === "uncertain"
    ? "Activity uncertain; Forth reports positive Speed while Engine is OFF."
    : `Reported ${reportedActivity}; EES derives this from Speed and Engine.`;
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
    { field: "activity_status", sourceField: null, source: null, normalized: activityDescription }
  ];
}

/** Operational activity uses fresh reported signals and exposes a positive-speed/engine-off conflict. */
export function getForthReportedActivity(record: ForthFleetTrackingRecord): ForthReportedActivity {
  if (record.timestampStatus !== "current" || !isUsableSpeed(record.speed)) return "unavailable";
  if (record.speed > 0 && record.engineOn === false) return "uncertain";
  if (record.speed > 0) return "driving";
  if (record.engineOn === true) return "stopped_engine_on";
  if (record.engineOn === false) return "stopped_engine_off";
  return "stopped_engine_unknown";
}

/** Show position age without replacing the exact source timestamp shown in details. */
export function formatForthRelativeAge(
  timestamp: string | null,
  nowMs: number,
  language: "en" | "th"
) {
  if (!timestamp) return null;
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) return null;
  const elapsedSeconds = Math.max(0, Math.floor((nowMs - parsed) / 1000));
  if (language === "en") {
    if (elapsedSeconds < 60) return elapsedSeconds < 5 ? "Updated just now" : `Updated ${elapsedSeconds} sec ago`;
    const minutes = Math.floor(elapsedSeconds / 60);
    if (minutes < 60) return `Updated ${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `Updated ${hours} hr ago`;
    const days = Math.floor(hours / 24);
    return `Updated ${days} day${days === 1 ? "" : "s"} ago`;
  }
  if (elapsedSeconds < 60) return elapsedSeconds < 5 ? "อัปเดตเมื่อสักครู่" : `อัปเดต ${elapsedSeconds} วินาทีที่แล้ว`;
  const minutes = Math.floor(elapsedSeconds / 60);
  if (minutes < 60) return `อัปเดต ${minutes} นาทีที่แล้ว`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `อัปเดต ${hours} ชั่วโมงที่แล้ว`;
  const days = Math.floor(hours / 24);
  return `อัปเดต ${days} วันที่แล้ว`;
}

export function getForthFleetFilterCategory(record: ForthFleetTrackingRecord): ForthFleetFilter {
  const activity = getForthReportedActivity(record);
  if (activity === "driving") return "driving";
  if (activity === "uncertain") return "uncertain";
  if (activity === "unavailable") return "unavailable";
  return "stopped";
}

/** Selects only the top-level Forth address/POI fields already present in its response contract. */
export function getForthLocationDescription(record: ForthFleetTrackingRecord, language: "en" | "th") {
  const candidates = language === "th"
    ? [record.locationAddressThai, record.locationPointOfInterest, record.locationAddressEnglish]
    : [record.locationAddressEnglish, record.locationPointOfInterest, record.locationAddressThai];
  return candidates.find((value) => typeof value === "string" && value.trim()) ?? null;
}

/** A compact area label for list rows. The full source address remains available in the inspector. */
export function getForthLocationArea(record: ForthFleetTrackingRecord, language: "en" | "th") {
  const full = getForthLocationDescription(record, language);
  if (!full) return null;
  const parts = full.split(/[,，]/).map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return full;
  return parts.slice(-2).map((part) => part
    .replace(/^(?:Tambon|Amphoe|Changwat|Subdistrict|District|Province)\s+/i, "")
    .replace(/^(?:ตำบล|อำเภอ|จังหวัด)\s*/, "")
    .trim()).filter(Boolean).join(", ") || full;
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

/** Map modes select source confidence; getForthFleetMapRecords validates coordinates. */
export function getForthFleetMapModeRecords(records: ForthFleetTrackingRecord[], mode: "reported" | "gps") {
  return mode === "gps" ? records.filter(isForthGpsPositionVerified) : records;
}

export function isForthGpsVerifiedDriving(record: ForthFleetTrackingRecord) {
  return isForthGpsPositionVerified(record) && record.engineOn !== false && isUsableSpeed(record.speed) && record.speed > 0;
}

export function getForthMotionReason(record: ForthFleetTrackingRecord): ForthMotionReason {
  if (record.timestampStatus === "stale") return "stale_position";
  if (record.timestampStatus !== "current") return "position_time_unknown";
  if (isUsableSpeed(record.speed) && record.speed > 0 && record.engineOn === false) return "speed_engine_conflict";
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
    record.engineOn !== false &&
    getForthFleetStatus(record) !== "moving";
}

export function summarizeForthFleet(records: ForthFleetTrackingRecord[]) {
  const summary = {
    total: records.length,
    needsAttention: 0,
    reportedActivity: {
      driving: 0,
      uncertain: 0,
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
    currentGpsVerifiedPositions: 0,
    latestCurrentGpsPosition: null as string | null,
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
      speed_invalid: 0,
      speed_engine_conflict: 0
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
    if (recordNeedsForthAttentionReview(record)) summary.needsAttention += 1;

    if (isForthGpsPositionVerified(record)) {
      summary.currentGpsVerifiedPositions += 1;
      if (!summary.latestCurrentGpsPosition || record.lastGpsTimestamp! > summary.latestCurrentGpsPosition) {
        summary.latestCurrentGpsPosition = record.lastGpsTimestamp;
      }
    }

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

/** Distinct source-supported conditions. A vehicle may match more than one; none implies a fault by itself. */
export function getForthAttentionKinds(record: ForthFleetTrackingRecord): ForthAttentionKind[] {
  const kinds: ForthAttentionKind[] = [];
  if (record.gprsConnectivity === "disconnected") kinds.push("offline");
  if (record.timestampStatus === "stale") kinds.push("stale");
  if (record.coordinateStatus === "missing" || record.coordinateStatus === "invalid") kinds.push("missing_coordinates");
  if (getForthReportedActivity(record) === "stopped_engine_on") kinds.push("engine_on_stopped");
  if (getForthReportedActivity(record) === "uncertain") kinds.push("speed_engine_conflict");
  if (record.coordinateStatus === "valid" && !isForthGpsPositionVerified(record)) kinds.push("unverified_position");
  return kinds;
}

/**
 * Metres used only for genuine shared-location anchors.
 * Grouping is geographic, never screen-pixel based: distant vehicles stay separate even when zoomed out.
 */
export function getForthSharedLocationThresholdMeters(zoom: number) {
  if (!Number.isFinite(zoom)) return 8;
  if (zoom >= 16) return 1.5;
  if (zoom >= 14) return 4;
  if (zoom >= 12) return 8;
  return 10;
}

/** Convert haversine kilometres to metres for all shared-location comparisons. */
export function forthDistanceMeters(left: [number, number], right: [number, number]) {
  return distanceKm(left, right) * 1000;
}

/**
 * Legacy lowest owner-reported device alert among the configured fleet (Group A).
 * Prefer lookupForthSpeedConfig / evaluateForthSpeedReview. Not a road legal limit.
 */
export const FORTH_HIGH_SPEED_REVIEW_KMH = 70;

/** Vehicle-class fallback advisories when no owner Forth device setting is matched. */
const FORTH_CLASS_SPEED_ADVISORY_KMH: Record<ForthTrackingMapVehicleClass, number> = {
  four_wheeler: 110,
  six_wheeler: 90,
  six_plus_six_wheeler: 90,
  eighteen_wheeler: 80,
  unclassified: 90
};

export function getForthOperationalSpeedAdvisoryKmh(vehicleClass: ForthTrackingMapVehicleClass) {
  return FORTH_CLASS_SPEED_ADVISORY_KMH[vehicleClass] ?? FORTH_CLASS_SPEED_ADVISORY_KMH.unclassified;
}

/**
 * GPS-verified driving at or above the owner-reported Forth device alert threshold
 * (or class advisory fallback). Never implies a legal road-limit offence or a
 * confirmed Forth overspeed event when a delay is configured.
 */
export function isForthHighReportedSpeed(record: ForthFleetTrackingRecord) {
  if (!isForthGpsPositionVerified(record) || getForthReportedActivity(record) !== "driving" || !isUsableSpeed(record.speed)) {
    return false;
  }
  const config = lookupForthSpeedConfig(record.vehicleRegistration);
  if (config) return record.speed >= config.speedAlertKmh;
  const vehicleClass = getForthTrackingVehicleIdentity(record.vehicleRegistration).vehicleClass;
  return record.speed >= getForthOperationalSpeedAdvisoryKmh(vehicleClass);
}

/** Review-severity attention (excludes engine-on-stopped advisories). */
export function recordNeedsForthAttentionReview(record: ForthFleetTrackingRecord) {
  return (
    record.gprsConnectivity === "disconnected" ||
    record.timestampStatus === "stale" ||
    record.coordinateStatus === "missing" ||
    record.coordinateStatus === "invalid" ||
    getForthReportedActivity(record) === "uncertain" ||
    isForthHighReportedSpeed(record)
  );
}

export function filterForthFleetRecords(
  records: ForthFleetTrackingRecord[],
  search: string,
  filter: ForthFleetFilter,
  extraSearch?: (record: ForthFleetTrackingRecord) => Array<string | null | undefined>
) {
  const query = search.trim().toLocaleLowerCase();
  return records.filter((record) => {
    const matchesFilter = filter === "all" ||
      (filter === "online" && record.gprsConnectivity === "connected") ||
      (filter === "attention" && recordNeedsForthAttentionReview(record)) ||
      (filter === "offline" && record.gprsConnectivity === "disconnected") ||
      (filter === "stale" && record.timestampStatus === "stale") ||
      (filter === "verified" && isForthGpsPositionVerified(record)) ||
      (filter === "unverified" && !isForthGpsPositionVerified(record)) ||
      (filter === "missing_coordinates" && (record.coordinateStatus === "missing" || record.coordinateStatus === "invalid")) ||
      (filter === "engine_on_stopped" && getForthReportedActivity(record) === "stopped_engine_on") ||
      (filter === "high_speed" && isForthHighReportedSpeed(record)) ||
      (["driving", "uncertain", "stopped", "unavailable"].includes(filter) && getForthFleetFilterCategory(record) === filter);
    if (!matchesFilter) return false;
    if (!query) return true;
    const identity = getForthTrackingVehicleIdentity(record.vehicleRegistration);
    const vehicleType = identity.vehicleClass === "four_wheeler"
      ? "4-wheeler 4w รถ 4 ล้อ"
      : identity.vehicleClass === "six_wheeler"
        ? "6-wheeler 6w รถ 6 ล้อ"
        : identity.vehicleClass === "six_plus_six_wheeler"
          ? "6+6-wheeler 6+6 รถ 6+6 ล้อ"
          : identity.vehicleClass === "eighteen_wheeler"
            ? "18-wheeler 18w รถพ่วง 18 ล้อ"
            : "";
    return [
      record.vehicleRegistration,
      record.reportedDriver,
      record.gpsDeviceId,
      record.locationAddressEnglish,
      record.locationAddressThai,
      record.locationPointOfInterest,
      identity.make,
      identity.model,
      identity.classLabel,
      vehicleType,
      ...(extraSearch?.(record) ?? [])
    ]
      .some((value) => value?.toLocaleLowerCase().includes(query));
  });
}

const FORTH_STATUS_SORT_RANK: Record<ForthReportedActivity, number> = {
  driving: 0,
  uncertain: 1,
  stopped_engine_on: 2,
  stopped_engine_off: 3,
  stopped_engine_unknown: 4,
  unavailable: 5
};

function forthReportTime(record: ForthFleetTrackingRecord) {
  if (record.timestampStatus !== "current" && record.timestampStatus !== "stale") return null;
  const parsed = Date.parse(record.lastGpsTimestamp ?? "");
  return Number.isFinite(parsed) ? parsed : null;
}

function forthOperationsGroup(record: ForthFleetTrackingRecord) {
  const activity = getForthReportedActivity(record);
  const sourceIssue = record.gprsConnectivity === "disconnected" ||
    record.timestampStatus === "stale" ||
    record.coordinateStatus === "missing" || record.coordinateStatus === "invalid";
  if (sourceIssue || activity === "uncertain" || activity === "unavailable") return 3;
  if (activity === "driving") return 0;
  if (activity === "stopped_engine_on") return 1;
  if (activity === "stopped_engine_off") return 2;
  return 3;
}

function forthOperationsIssueRank(record: ForthFleetTrackingRecord) {
  const offline = record.gprsConnectivity === "disconnected";
  const stale = record.timestampStatus === "stale";
  if (offline && stale) return 0;
  if (offline) return 1;
  if (stale) return 2;
  if (record.coordinateStatus === "missing" || record.coordinateStatus === "invalid") return 3;
  if (getForthReportedActivity(record) === "uncertain") return 4;
  if (getForthReportedActivity(record) === "unavailable") return 5;
  return 6;
}

export function sortForthFleetRecords(records: ForthFleetTrackingRecord[], sort: ForthFleetSort) {
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  return [...records].sort((left, right) => {
    if (sort === "operations") {
      const leftGroup = forthOperationsGroup(left);
      const rightGroup = forthOperationsGroup(right);
      if (leftGroup !== rightGroup) return leftGroup - rightGroup;
      if (leftGroup === 0 && isUsableSpeed(left.speed) && isUsableSpeed(right.speed) && left.speed !== right.speed) {
        return right.speed - left.speed;
      }
      if (leftGroup === 3) {
        const leftIssue = forthOperationsIssueRank(left);
        const rightIssue = forthOperationsIssueRank(right);
        if (leftIssue !== rightIssue) return leftIssue - rightIssue;
      }
      const leftTime = forthReportTime(left);
      const rightTime = forthReportTime(right);
      if (leftTime === null && rightTime !== null) return 1;
      if (rightTime === null && leftTime !== null) return -1;
      if (leftTime !== null && rightTime !== null && leftTime !== rightTime) {
        return leftGroup === 3 && forthOperationsIssueRank(left) <= 2 ? leftTime - rightTime : rightTime - leftTime;
      }
    } else if (sort === "speed_desc") {
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
    } else if (sort === "status") {
      const leftRank = FORTH_STATUS_SORT_RANK[getForthReportedActivity(left)];
      const rightRank = FORTH_STATUS_SORT_RANK[getForthReportedActivity(right)];
      if (leftRank !== rightRank) return leftRank - rightRank;
    }
    return collator.compare(left.vehicleRegistration ?? "", right.vehicleRegistration ?? "");
  });
}

export function getForthFleetRecordKey(record: ForthFleetTrackingRecord, index: number) {
  const deviceId = record.gpsDeviceId?.trim();
  if (deviceId) return `device:${deviceId}`;

  const registration = record.vehicleRegistration
    ?.trim()
    .toLocaleUpperCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
  return registration ? `registration:${registration}` : `record:${index}`;
}

export function findForthFleetRecord(records: ForthFleetTrackingRecord[], key: string | null) {
  if (!key) return null;
  return records.find((record, index) => getForthFleetRecordKey(record, index) === key) ?? null;
}

export type ForthFleetMapRecord = {
  record: ForthFleetTrackingRecord;
  key: string;
  position: [number, number];
};

export type ForthTrackingMapVehicleClass =
  | "four_wheeler"
  | "six_wheeler"
  | "six_plus_six_wheeler"
  | "eighteen_wheeler"
  | "unclassified";

export type ForthTrackingVehicleIdentity = {
  vehicleClass: ForthTrackingMapVehicleClass;
  classLabel: "4W" | "6W" | "18W" | null;
  make: "Toyota" | "Hino" | "Isuzu" | "Nissan" | null;
  model: "Hilux Revo" | "Hilux Vigo" | null;
};

const approvedFleetDisplayData: Record<string, ForthTrackingVehicleIdentity> = {
  "3ฒน9565": { vehicleClass: "four_wheeler", classLabel: "4W", make: "Toyota", model: "Hilux Revo" },
  "3ฒล4565": { vehicleClass: "four_wheeler", classLabel: "4W", make: "Toyota", model: "Hilux Revo" },
  "ฒอ8453": { vehicleClass: "four_wheeler", classLabel: "4W", make: "Toyota", model: "Hilux Vigo" },
  "612835": { vehicleClass: "six_wheeler", classLabel: "6W", make: "Hino", model: null },
  "616672": { vehicleClass: "six_wheeler", classLabel: "6W", make: "Hino", model: null },
  "621085": { vehicleClass: "six_wheeler", classLabel: "6W", make: "Hino", model: null },
  "624337": { vehicleClass: "six_wheeler", classLabel: "6W", make: "Hino", model: null },
  "640359": { vehicleClass: "six_wheeler", classLabel: "6W", make: "Isuzu", model: null },
  "645954": { vehicleClass: "six_wheeler", classLabel: "6W", make: "Hino", model: null },
  "645956": { vehicleClass: "six_wheeler", classLabel: "6W", make: "Hino", model: null },
  "748969": { vehicleClass: "six_wheeler", classLabel: "6W", make: "Nissan", model: null },
  "786996": { vehicleClass: "six_wheeler", classLabel: "6W", make: "Hino", model: null },
  "792945": { vehicleClass: "six_wheeler", classLabel: "6W", make: "Hino", model: null },
  "7004145": { vehicleClass: "six_wheeler", classLabel: "6W", make: "Hino", model: null },
  "7006659": { vehicleClass: "six_wheeler", classLabel: "6W", make: "Hino", model: null },
  "7011654": { vehicleClass: "six_wheeler", classLabel: "6W", make: "Hino", model: null },
  "7015145": { vehicleClass: "six_wheeler", classLabel: "6W", make: "Isuzu", model: null },
  "633543": { vehicleClass: "eighteen_wheeler", classLabel: "18W", make: "Hino", model: null },
  "648665": { vehicleClass: "eighteen_wheeler", classLabel: "18W", make: "Hino", model: null },
  "687154": { vehicleClass: "eighteen_wheeler", classLabel: "18W", make: "Hino", model: null },
  "795318": { vehicleClass: "eighteen_wheeler", classLabel: "18W", make: "Hino", model: null }
};

function normalizedMapRegistration(registration: string | null) {
  return registration?.trim().toLocaleUpperCase().replace(/[^\p{L}\p{N}]/gu, "") ?? "";
}

/** Approved display-only roster metadata. It never reads or writes EES vehicle records. */
export function getForthTrackingVehicleIdentity(registration: string | null): ForthTrackingVehicleIdentity {
  return approvedFleetDisplayData[normalizedMapRegistration(registration)] ?? {
    vehicleClass: "unclassified",
    classLabel: null,
    make: null,
    model: null
  };
}

export function getForthTrackingMapVehicleClass(registration: string | null): ForthTrackingMapVehicleClass {
  return getForthTrackingVehicleIdentity(registration).vehicleClass;
}

export type ForthReportedLocationPoint = { key: string; latitude: number; longitude: number };

/**
 * Group vehicles that share a genuine reported location.
 * The returned keys are identifiers only; coordinates are never rewritten.
 */
export function getForthSharedLocationGroups(
  points: ForthReportedLocationPoint[],
  thresholdMeters = 30
): string[][] {
  const valid = points.filter((point) =>
    point.key &&
    Number.isFinite(point.latitude) && point.latitude >= -90 && point.latitude <= 90 &&
    Number.isFinite(point.longitude) && point.longitude >= -180 && point.longitude <= 180
  );
  const parent = valid.map((_, index) => index);
  const find = (index: number): number => {
    if (parent[index] !== index) parent[index] = find(parent[index]);
    return parent[index];
  };
  const union = (left: number, right: number) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot;
  };
  const threshold = Number.isFinite(thresholdMeters) && thresholdMeters > 0 ? thresholdMeters : 0;
  for (let left = 0; left < valid.length; left += 1) {
    for (let right = left + 1; right < valid.length; right += 1) {
      const distanceMeters = forthDistanceMeters(
        [valid[left].latitude, valid[left].longitude],
        [valid[right].latitude, valid[right].longitude]
      );
      if (distanceMeters <= threshold) union(left, right);
    }
  }
  const components = new Map<number, string[]>();
  valid.forEach((point, index) => {
    const root = find(index);
    const component = components.get(root) ?? [];
    component.push(point.key);
    components.set(root, component);
  });
  return [...components.values()]
    .filter((keys) => keys.length > 1)
    .map((keys) => keys.sort((left, right) => left.localeCompare(right)))
    .sort((left, right) => left[0].localeCompare(right[0]));
}

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

export type ForthFleetMapInitialFrame = {
  allPositions: [number, number][];
  focusPositions: [number, number][];
  outlierCount: number;
};

function median(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function distanceKm(left: [number, number], right: [number, number]) {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const latitudeDelta = radians(right[0] - left[0]);
  const longitudeDelta = radians(right[1] - left[1]);
  const haversine = Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(radians(left[0])) * Math.cos(radians(right[0])) * Math.sin(longitudeDelta / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(Math.max(0, 1 - haversine)));
}

/**
 * Center the first view on a clear spatial majority when a small number of
 * valid reports are exceptionally distant. Every valid point remains in the
 * returned full set and in the marker layer; callers must disclose outliers
 * and keep an explicit fit-all action available.
 */
export function getForthFleetMapInitialFrame(positions: [number, number][]): ForthFleetMapInitialFrame {
  const allPositions = positions.filter(([latitude, longitude]) =>
    Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 &&
    Number.isFinite(longitude) && longitude >= -180 && longitude <= 180
  );
  if (allPositions.length < 4) return { allPositions, focusPositions: allPositions, outlierCount: 0 };

  // Keep the day-to-day view on the densest working area. A distant, valid
  // report remains in allPositions and can be opened directly from the map tray.
  if (allPositions.length >= 5) {
    const nearby = allPositions.map((anchor) =>
      allPositions.filter((position) => distanceKm(anchor, position) <= 90)
    );
    const primaryArea = nearby.reduce((best, candidate) => candidate.length > best.length ? candidate : best, nearby[0]);
    if (primaryArea.length >= Math.ceil(allPositions.length / 2) && primaryArea.length < allPositions.length) {
      return { allPositions, focusPositions: primaryArea, outlierCount: allPositions.length - primaryArea.length };
    }
  }

  const center: [number, number] = [
    median(allPositions.map(([latitude]) => latitude)),
    median(allPositions.map(([, longitude]) => longitude))
  ];
  const distances = allPositions.map((position) => distanceKm(center, position));
  const medianDistance = median(distances);
  const medianDeviation = median(distances.map((distance) => Math.abs(distance - medianDistance)));
  const thresholdKm = medianDistance + Math.max(15, medianDeviation * 4.5);
  const focusPositions = allPositions.filter((_, index) => distances[index] <= thresholdKm);
  const requiredMajority = Math.ceil(allPositions.length * 0.75);

  if (focusPositions.length < requiredMajority || focusPositions.length === allPositions.length) {
    return { allPositions, focusPositions: allPositions, outlierCount: 0 };
  }
  return { allPositions, focusPositions, outlierCount: allPositions.length - focusPositions.length };
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
