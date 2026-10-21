import type { ForthFleetTrackingRecord } from "@/lib/forth-tracking-server";

export type ForthFleetStatus = "moving" | "stationary" | "unknown";
export type ForthFleetFilter = "all" | ForthFleetStatus;
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
  | "non_gps_position"
  | "speed_unavailable"
  | "speed_invalid";

type CountMap<Keys extends string> = Record<Keys, number>;

function isUsableSpeed(speed: number | null): speed is number {
  return typeof speed === "number" && Number.isFinite(speed) && speed >= 0;
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

export function summarizeForthFleet(records: ForthFleetTrackingRecord[]) {
  const summary = {
    total: records.length,
    motion: { moving: 0, stationary: 0, unknown: 0 } as CountMap<ForthFleetStatus>,
    communications: { online: 0, offline: 0, unknown: 0 } as CountMap<"online" | "offline" | "unknown">,
    positionFreshness: { current: 0, stale: 0, unknown: 0 } as CountMap<"current" | "stale" | "unknown">,
    gpsSignal: { available: 0, unavailable: 0, unknown: 0 } as CountMap<"available" | "unavailable" | "unknown">,
    positionQuality: { gps: 0, wifi: 0, lbs: 0, other: 0, unknown: 0 } as CountMap<"gps" | "wifi" | "lbs" | "other" | "unknown">,
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
      non_gps_position: 0,
      speed_unavailable: 0,
      speed_invalid: 0
    } as CountMap<ForthMotionReason>,
    lastVerifiedGpsPosition: null as string | null
  };

  for (const record of records) {
    const reason = getForthMotionReason(record);
    summary.classificationReason[reason] += 1;
    summary.motion[getForthFleetStatus(record)] += 1;
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
    if (filter !== "all" && getForthFleetStatus(record) !== filter) return false;
    if (!query) return true;
    return [record.vehicleRegistration, record.reportedDriver, record.gpsDeviceId]
      .some((value) => value?.toLocaleLowerCase().includes(query));
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
