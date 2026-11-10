import { geofenceDistanceMeters, validGeofenceCoordinates } from "@/lib/fleet-geofence-engine";
import {
  EES_LORRY_DEPOT_FORTH_COORDINATES,
  EES_LORRY_DEPOT_PROVISIONAL_RADIUS_METERS,
  EES_OFFICE_FORTH_COORDINATES
} from "@/lib/ees-depot-sites";

export type DepotProximityVehicleInput = {
  vehicleKey: string;
  registration: string | null;
  latitude: number | null;
  longitude: number | null;
  lastGpsTimestamp: string | null;
  gpsVerified: boolean;
  positionStale?: boolean;
  speedKmh: number | null;
  activity: string | null;
  driverName: string | null;
};

export type DepotProximityBand = "inside_depot" | "nearby_depot" | "near_office" | "elsewhere";

export type DepotProximityRow = DepotProximityVehicleInput & {
  band: DepotProximityBand;
  distanceToDepotMeters: number | null;
  distanceToOfficeMeters: number | null;
};

const NEARBY_DEPOT_METERS = 500;

export function classifyDepotProximity(
  vehicles: readonly DepotProximityVehicleInput[],
  options?: { depotRadiusMeters?: number; nearbyMeters?: number }
): DepotProximityRow[] {
  const depotRadius = options?.depotRadiusMeters ?? EES_LORRY_DEPOT_PROVISIONAL_RADIUS_METERS;
  const nearby = options?.nearbyMeters ?? NEARBY_DEPOT_METERS;
  const rows: DepotProximityRow[] = [];

  for (const vehicle of vehicles) {
    if (!validGeofenceCoordinates(vehicle.latitude, vehicle.longitude)) {
      rows.push({
        ...vehicle,
        band: "elsewhere",
        distanceToDepotMeters: null,
        distanceToOfficeMeters: null
      });
      continue;
    }
    const vehiclePoint = { latitude: vehicle.latitude!, longitude: vehicle.longitude! };
    const distanceToDepotMeters = geofenceDistanceMeters(vehiclePoint, EES_LORRY_DEPOT_FORTH_COORDINATES);
    const distanceToOfficeMeters = geofenceDistanceMeters(vehiclePoint, EES_OFFICE_FORTH_COORDINATES);
    let band: DepotProximityBand = "elsewhere";
    if (distanceToDepotMeters <= depotRadius) band = "inside_depot";
    else if (distanceToDepotMeters <= nearby) band = "nearby_depot";
    else if (distanceToOfficeMeters <= depotRadius) band = "near_office";
    rows.push({ ...vehicle, band, distanceToDepotMeters, distanceToOfficeMeters });
  }

  const rank = (band: DepotProximityBand) =>
    band === "inside_depot" ? 0 : band === "nearby_depot" ? 1 : band === "near_office" ? 2 : 3;

  return rows.sort((left, right) => {
    const bandDelta = rank(left.band) - rank(right.band);
    if (bandDelta !== 0) return bandDelta;
    const leftDistance = left.distanceToDepotMeters ?? Number.POSITIVE_INFINITY;
    const rightDistance = right.distanceToDepotMeters ?? Number.POSITIVE_INFINITY;
    return leftDistance - rightDistance;
  });
}

export function summarizeDepotProximity(rows: readonly DepotProximityRow[]) {
  return {
    insideDepot: rows.filter((row) => row.band === "inside_depot").length,
    nearbyDepot: rows.filter((row) => row.band === "nearby_depot").length,
    nearOffice: rows.filter((row) => row.band === "near_office").length,
    withCoordinates: rows.filter((row) => row.distanceToDepotMeters != null).length
  };
}
