/**
 * Read-only EES Locations Directory helpers for Fleet Tracking.
 * Uses confirmed destination map pins only — never invents coordinates from addresses.
 */

import { isValidCoordinates, safeGoogleMapsUrl } from "@/lib/locations-directory";
import type { ForthFleetTrackingRecord } from "@/lib/forth-tracking-server";
import { getForthFleetRecordKey, formatForthRelativeAge, isForthGpsPositionVerified } from "@/lib/forth-tracking-view";

export const FLEET_LOCATION_CATEGORIES = [
  "Customer",
  "Warehouse",
  "Depot",
  "Factory",
  "Port",
  "Airport",
  "Other"
] as const;

export type FleetLocationCategory = (typeof FLEET_LOCATION_CATEGORIES)[number] | string;

export type FleetDirectoryLocationSource = {
  id: string;
  company_name: string;
  thai_name?: string | null;
  address: string;
  province?: string | null;
  destination_type?: string | null;
  google_maps_url?: string | null;
};

export type FleetDirectoryPinSource = {
  location_id: string;
  pin_type: string;
  pin_status: string;
  latitude: number;
  longitude: number;
};

export type FleetDirectoryLocation = {
  id: string;
  companyName: string;
  thaiName: string | null;
  address: string;
  province: string | null;
  category: string;
  googleMapsUrl: string | null;
  latitude: number;
  longitude: number;
  directoryHref: string;
};

export type FleetNearbyVehicle = {
  key: string;
  record: ForthFleetTrackingRecord;
  distanceKm: number;
  gpsVerified: boolean;
  ageLabel: string | null;
};

/** Straight-line haversine distance in kilometres. Not driving distance or ETA. */
export function haversineDistanceKm(
  latitudeA: number,
  longitudeA: number,
  latitudeB: number,
  longitudeB: number
) {
  if (![latitudeA, longitudeA, latitudeB, longitudeB].every(Number.isFinite)) return null;
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDelta = radians(latitudeB - latitudeA);
  const longitudeDelta = radians(longitudeB - longitudeA);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(radians(latitudeA)) * Math.cos(radians(latitudeB)) * Math.sin(longitudeDelta / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(Math.max(0, 1 - haversine)));
}

/**
 * Join directory records with confirmed destination pins.
 * Truck-entrance pins are excluded from the default fleet layer to reduce clutter.
 */
export function joinMappedDirectoryLocations(
  locations: readonly FleetDirectoryLocationSource[],
  pins: readonly FleetDirectoryPinSource[]
): FleetDirectoryLocation[] {
  const destinationPinByLocation = new Map<string, FleetDirectoryPinSource>();
  for (const pin of pins) {
    if (pin.pin_type !== "destination" || pin.pin_status !== "manual_confirmed") continue;
    if (!isValidCoordinates(pin.latitude, pin.longitude)) continue;
    const previous = destinationPinByLocation.get(pin.location_id);
    if (!previous) destinationPinByLocation.set(pin.location_id, pin);
  }

  const mapped: FleetDirectoryLocation[] = [];
  for (const location of locations) {
    const pin = destinationPinByLocation.get(location.id);
    if (!pin) continue;
    const companyName = String(location.company_name ?? "").trim();
    const address = String(location.address ?? "").trim();
    if (!companyName || !address) continue;
    mapped.push({
      id: location.id,
      companyName,
      thaiName: location.thai_name?.trim() || null,
      address,
      province: location.province?.trim() || null,
      category: String(location.destination_type ?? "Other").trim() || "Other",
      googleMapsUrl: safeGoogleMapsUrl(location.google_maps_url),
      latitude: pin.latitude,
      longitude: pin.longitude,
      directoryHref: `/locations?focus=${encodeURIComponent(location.id)}`
    });
  }
  return mapped.sort((left, right) => left.companyName.localeCompare(right.companyName, undefined, { sensitivity: "base" }));
}

export function filterFleetDirectoryLocations(
  locations: readonly FleetDirectoryLocation[],
  search: string,
  category: string | "all"
) {
  const query = search.trim().toLocaleLowerCase();
  return locations.filter((location) => {
    if (category !== "all" && location.category !== category) return false;
    if (!query) return true;
    return [
      location.companyName,
      location.thaiName,
      location.address,
      location.province,
      location.category
    ].some((value) => value?.toLocaleLowerCase().includes(query));
  });
}

export type FleetNearbyLocation = {
  location: FleetDirectoryLocation;
  distanceKm: number;
};

/** Straight-line nearby saved EES destinations for a reported vehicle position. Not ETA. */
export function findNearbyLocationsForVehicle(
  point: { latitude: number | null; longitude: number | null; coordinateStatus?: string },
  locations: readonly FleetDirectoryLocation[],
  options?: { limit?: number; maxDistanceKm?: number }
): FleetNearbyLocation[] {
  if (point.coordinateStatus && point.coordinateStatus !== "valid") return [];
  if (point.latitude === null || point.longitude === null) return [];
  if (![point.latitude, point.longitude].every(Number.isFinite)) return [];
  const limit = options?.limit ?? 3;
  const maxDistanceKm = options?.maxDistanceKm ?? 25;
  return locations
    .map((location) => {
      const distanceKm = haversineDistanceKm(point.latitude as number, point.longitude as number, location.latitude, location.longitude);
      if (distanceKm === null || distanceKm > maxDistanceKm) return null;
      return { location, distanceKm } satisfies FleetNearbyLocation;
    })
    .filter((entry): entry is FleetNearbyLocation => entry !== null)
    .sort((left, right) => left.distanceKm - right.distanceKm || left.location.companyName.localeCompare(right.location.companyName, undefined, { sensitivity: "base" }))
    .slice(0, Math.max(0, limit));
}

export function findNearbyVehiclesForLocation(
  location: Pick<FleetDirectoryLocation, "latitude" | "longitude">,
  records: readonly ForthFleetTrackingRecord[],
  options?: { limit?: number; nowMs?: number; language?: "en" | "th" }
): FleetNearbyVehicle[] {
  const limit = options?.limit ?? 8;
  const nowMs = options?.nowMs ?? Date.now();
  const language = options?.language ?? "en";
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

  return [...latest.entries()]
    .map(([key, record]) => {
      if (record.coordinateStatus !== "valid" || record.latitude === null || record.longitude === null) return null;
      const distanceKm = haversineDistanceKm(location.latitude, location.longitude, record.latitude, record.longitude);
      if (distanceKm === null) return null;
      return {
        key,
        record,
        distanceKm,
        gpsVerified: isForthGpsPositionVerified(record),
        ageLabel: formatForthRelativeAge(record.lastGpsTimestamp, nowMs, language)
      } satisfies FleetNearbyVehicle;
    })
    .filter((entry): entry is FleetNearbyVehicle => entry !== null)
    .sort((left, right) => left.distanceKm - right.distanceKm || (left.record.vehicleRegistration ?? "").localeCompare(right.record.vehicleRegistration ?? "", "en", { numeric: true }))
    .slice(0, Math.max(0, limit));
}
