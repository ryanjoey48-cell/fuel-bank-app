import type { ForthFleetTrackingData, ForthFleetTrackingRecord } from "@/lib/forth-tracking-server";

// Authentication and tracking each have a 10s upstream deadline. Leave room
// for EES authorization as well, rather than aborting a healthy cold request.
export const FORTH_FLEET_REQUEST_TIMEOUT_MS = 30_000;
const POSITION_MAX_AGE_MS = 15 * 60_000;

export function retainForthSnapshot(previous: ForthFleetTrackingData | null, incoming: ForthFleetTrackingData): ForthFleetTrackingData {
  if (incoming.connectionStatus === "connected" || !previous) return incoming;
  return { ...incoming, records: previous.records, fetchedAt: previous.fetchedAt };
}

/** Age a retained snapshot without changing the upstream evidence or coordinates. */
export function ageForthSnapshot(records: readonly ForthFleetTrackingRecord[], now: number, unavailable: boolean): ForthFleetTrackingRecord[] {
  return records.map((record) => {
    if (record.timestampStatus !== "current") return record;
    const timestamp = Date.parse(record.lastGpsTimestamp ?? "");
    if (!Number.isFinite(timestamp)) return { ...record, timestampStatus: "invalid" };
    return unavailable || now - timestamp > POSITION_MAX_AGE_MS
      ? { ...record, timestampStatus: "stale" }
      : record;
  });
}
