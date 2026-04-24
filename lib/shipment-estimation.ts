import { normalizeLocationKey } from "@/lib/utils";
import { buildShipmentBenchmark, computeWeeklyMileageByVehicle } from "@/lib/operations";
import { normalizeShipment } from "@/lib/shipment-normalization";
import type {
  FuelLogWithDriver,
  ShipmentWithDriver,
  WeeklyMileageEntry
} from "@/types/database";

export type ShipmentFuelCostBenchmark = {
  available: boolean;
  costPerKm: number | null;
  totalFuelSpend: number;
  totalDistanceKm: number;
  comparableMileageEntries: number;
  windowStart: string;
  windowEnd: string;
};

type WeeklyMileageDelta = {
  weekEnding: string;
  vehicleReg: string;
  distanceKm: number;
};

type FuelMileageDelta = {
  date: string;
  vehicleReg: string;
  distanceKm: number;
};

function shiftDate(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function toDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function buildHistoricalFuelCostBenchmark(
  fuelLogs: FuelLogWithDriver[],
  weeklyMileage: WeeklyMileageEntry[],
  lookbackDays = 90
): ShipmentFuelCostBenchmark {
  return buildShipmentBenchmark(fuelLogs, weeklyMileage, lookbackDays);
}

export function buildFuelLogMileageDeltas(logs: FuelLogWithDriver[]): FuelMileageDelta[] {
  const sortedLogs = [...logs].sort((a, b) => {
    const dateDiff = new Date(a.date).getTime() - new Date(b.date).getTime();
    if (dateDiff !== 0) {
      return dateDiff;
    }

    return String(a.id).localeCompare(String(b.id));
  });

  const latestByVehicle = new Map<string, FuelLogWithDriver>();
  const deltas: FuelMileageDelta[] = [];

  sortedLogs.forEach((log) => {
    const vehicleReg = log.vehicle_reg?.trim();
    const mileage = Number(log.mileage ?? log.odometer ?? 0);

    if (!vehicleReg || !Number.isFinite(mileage) || mileage <= 0) {
      return;
    }

    const previous = latestByVehicle.get(vehicleReg);
    if (previous) {
      const previousMileage = Number(previous.mileage ?? previous.odometer ?? 0);
      const distanceKm = mileage - previousMileage;

      if (Number.isFinite(distanceKm) && distanceKm > 0) {
        deltas.push({
          date: log.date,
          vehicleReg,
          distanceKm
        });
      }
    }

    latestByVehicle.set(vehicleReg, log);
  });

  return deltas;
}

export function estimateShipmentFuelCost(
  distanceKm: number | null,
  benchmark: ShipmentFuelCostBenchmark
) {
  if (!benchmark.available || benchmark.costPerKm == null || distanceKm == null) {
    return null;
  }

  return distanceKm * benchmark.costPerKm;
}

export function buildShipmentRouteKey(startLocation: string, endLocation: string) {
  return `${normalizeLocationKey(startLocation)}__${normalizeLocationKey(endLocation)}`;
}

export function buildShipmentRouteLabel(startLocation: string, endLocation: string) {
  return `${startLocation.trim()} → ${endLocation.trim()}`;
}

export function filterShipments(
  shipments: ShipmentWithDriver[],
  searchTerm: string
) {
  const normalizedQuery = normalizeLocationKey(searchTerm);

  if (!normalizedQuery) {
    return shipments;
  }

  return shipments.filter((shipment) => {
    const normalized = normalizeShipment(shipment);
    const fields = [
      normalized.jobReference,
      normalized.customerName,
      normalized.jobDescription,
      normalized.driverName,
      normalized.pickupLocation,
      normalized.dropoffLocation,
      normalized.vehicleReg,
      normalized.vehicleType,
      normalized.status
    ];

    return fields.some((field) => normalizeLocationKey(field).includes(normalizedQuery));
  });
}

export function buildWeeklyMileageDeltas(entries: WeeklyMileageEntry[]): WeeklyMileageDelta[] {
  return computeWeeklyMileageByVehicle(entries).map((row) => ({
    weekEnding: row.weekEnding,
    vehicleReg: row.vehicleReg,
    distanceKm: row.distance
  }));
}
