import type { ForthFleetTrackingRecord } from "@/lib/forth-tracking-server";
import { isForthGpsPositionVerified } from "@/lib/forth-tracking-view";
import type { GeofenceObservation } from "@/lib/fleet-geofence-engine";

export type PreparedGeofenceSource = {
  observations: GeofenceObservation[];
  skipped: { registration: string | null; reason: "missing_device_id" | "duplicate_device_id" }[];
};

/** A registration alone is not a safe state key. Ambiguous device IDs are excluded. */
export function prepareForthGeofenceObservations(
  records: readonly ForthFleetTrackingRecord[],
  detectedAt: string
): PreparedGeofenceSource {
  const counts = new Map<string, number>();
  for (const record of records) {
    const id = record.gpsDeviceId?.trim();
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const observations: GeofenceObservation[] = [];
  const skipped: PreparedGeofenceSource["skipped"] = [];
  for (const record of records) {
    const id = record.gpsDeviceId?.trim();
    if (!id || counts.get(id) !== 1) {
      skipped.push({ registration: record.vehicleRegistration, reason: id ? "duplicate_device_id" : "missing_device_id" });
      continue;
    }
    observations.push({
      vehicleKey: `forth:${id}`,
      registration: record.vehicleRegistration,
      sourceAt: record.lastGpsTimestamp,
      detectedAt,
      latitude: record.latitude,
      longitude: record.longitude,
      gpsVerified: isForthGpsPositionVerified(record),
      trackerConnected: record.gpsConnectivity === "connected"
    });
  }
  return { observations, skipped };
}
