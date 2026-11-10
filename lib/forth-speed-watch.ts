import type { ForthFleetTrackingRecord } from "@/lib/forth-tracking-server";
import { lookupForthSpeedConfig, type ForthSpeedDeviceConfig } from "@/lib/forth-speed-config";
import { evaluateForthSpeedReview, type ForthSpeedReview } from "@/lib/forth-speed-review";
import { getForthFleetRecordKey, getForthReportedActivity, isForthGpsPositionVerified } from "@/lib/forth-tracking-view";

export type ForthSpeedWatchFilter = "all_moving" | "over_threshold" | "configured" | "unknown_settings";

export type ForthSpeedWatchEntry = {
  key: string;
  record: ForthFleetTrackingRecord;
  gpsVerified: boolean;
  config: ForthSpeedDeviceConfig | null;
  review: ForthSpeedReview | null;
};

export const FORTH_SPEED_WATCH_DEFAULT_LIMIT = 5;

function latestByKey(records: ForthFleetTrackingRecord[]) {
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

/** Current source speeds only. Road legal limits and event durations are never inferred. */
export function getForthSpeedWatchEntries(
  records: ForthFleetTrackingRecord[],
  limit: number | null = FORTH_SPEED_WATCH_DEFAULT_LIMIT,
  filter: ForthSpeedWatchFilter = "all_moving"
): ForthSpeedWatchEntry[] {
  const ranked = [...latestByKey(records).entries()]
    .filter(([, record]) => getForthReportedActivity(record) === "driving" && typeof record.speed === "number" && Number.isFinite(record.speed) && record.speed > 0)
    .map(([key, record]) => {
      const config = lookupForthSpeedConfig(record.vehicleRegistration);
      const review = evaluateForthSpeedReview(record);
      return {
        key,
        record,
        gpsVerified: isForthGpsPositionVerified(record),
        config,
        review
      } satisfies ForthSpeedWatchEntry;
    })
    .filter((entry) => {
      if (filter === "over_threshold") return Boolean(entry.review?.isThresholdExceedance);
      if (filter === "configured") return entry.config !== null;
      if (filter === "unknown_settings") return entry.config === null;
      return true;
    })
    .sort((a, b) => {
      const aOver = a.review?.isThresholdExceedance ? 1 : 0;
      const bOver = b.review?.isThresholdExceedance ? 1 : 0;
      if (aOver !== bOver) return bOver - aOver;
      return (b.record.speed ?? 0) - (a.record.speed ?? 0)
        || (a.record.vehicleRegistration ?? a.key).localeCompare(b.record.vehicleRegistration ?? b.key, "en", { numeric: true });
    });

  if (limit === null || limit < 0) return ranked;
  return ranked.slice(0, Math.max(0, limit));
}

export function countForthSpeedWatchOverThreshold(records: ForthFleetTrackingRecord[]) {
  return getForthSpeedWatchEntries(records, null, "over_threshold").length;
}
