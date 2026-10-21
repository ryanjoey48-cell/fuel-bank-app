import type { ForthFleetTrackingRecord } from "@/lib/forth-tracking-server";

export type ForthFleetStatus = "moving" | "parked" | "offline_stale" | "unknown";
export type ForthFleetFilter = "all" | ForthFleetStatus;

export function getForthFleetStatus(record: ForthFleetTrackingRecord): ForthFleetStatus {
  if (
    record.gpsConnectivity === "disconnected" ||
    record.gprsConnectivity === "disconnected" ||
    record.timestampStatus === "stale"
  ) {
    return "offline_stale";
  }

  if (
    record.gpsConnectivity !== "connected" ||
    record.timestampStatus !== "current" ||
    record.coordinateStatus !== "valid" ||
    record.positionStatus !== "gps" ||
    record.speed === null
  ) {
    return "unknown";
  }

  return record.speed > 0 ? "moving" : "parked";
}

export function summarizeForthFleet(records: ForthFleetTrackingRecord[]) {
  const summary = {
    total: records.length,
    moving: 0,
    parked: 0,
    offline_stale: 0,
    unknown: 0,
    lastUpdate: null as string | null
  };

  for (const record of records) {
    summary[getForthFleetStatus(record)] += 1;
    if (record.lastGpsTimestamp && (!summary.lastUpdate || record.lastGpsTimestamp > summary.lastUpdate)) {
      summary.lastUpdate = record.lastGpsTimestamp;
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
    timeZoneName: "short"
  }).format(date);
}
