import type { FuelLogWithDriver, TripJourneyWithFuel, WeeklyMileageEntry } from "@/types/database";

export type DistanceSource = "manual" | "odometer" | "google" | "missing";

export type TripDistanceResult = {
  workingKm: number | null;
  actualKm: number | null;
  source: DistanceSource;
  isVerifiedActual: boolean;
};

export type FuelInterval = {
  key: string;
  vehicleReg: string;
  driverNames: string[];
  startFuelLog: FuelLogWithDriver;
  endFuelLog: FuelLogWithDriver;
  startDate: string;
  endDate: string;
  startOdometer: number;
  endOdometer: number;
  distanceKm: number;
  valid: boolean;
};

export type VerifiedFuelCycle = FuelInterval & {
  litres: number;
  cost: number;
  kmPerLitre: number | null;
  costPerKm: number | null;
  logIds: string[];
  status: "verified" | "invalid";
  invalidReason: string | null;
};

export type FuelTotals = {
  litres: number;
  cost: number;
  count: number;
};

export type VehicleCoverage = {
  vehicleReg: string;
  odometerDistanceKm: number | null;
  linkedTripWorkingKm: number;
  otherUnallocatedKm: number | null;
  coveragePercent: number | null;
  conflictKm: number;
  needsReview: boolean;
  message: string | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function normalizeVehicleKey(value: string | null | undefined) {
  return String(value ?? "").trim().toLocaleLowerCase().replace(/\s+/gu, "");
}

function positiveNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function getFuelOdometer(log: Pick<FuelLogWithDriver, "mileage" | "odometer">) {
  return positiveNumber(log.mileage) ?? positiveNumber(log.odometer);
}

export function getTripDistanceUsed(trip: Pick<TripJourneyWithFuel, "manual_actual_km" | "start_mileage" | "end_mileage" | "actual_distance_km" | "estimated_distance_km" | "google_estimated_km" | "booking_estimated_km" | "manual_estimated_distance_km">): TripDistanceResult {
  const manual = positiveNumber(trip.manual_actual_km);
  if (manual != null) return { workingKm: manual, actualKm: manual, source: "manual", isVerifiedActual: true };

  if (trip.start_mileage != null && trip.end_mileage != null) {
    const start = Number(trip.start_mileage);
    const end = Number(trip.end_mileage);
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
      const distance = end - start;
      return { workingKm: distance, actualKm: distance, source: "odometer", isVerifiedActual: true };
    }
  }

  const storedActual = positiveNumber(trip.actual_distance_km);
  if (storedActual != null) return { workingKm: storedActual, actualKm: storedActual, source: "odometer", isVerifiedActual: true };

  const google = positiveNumber(trip.estimated_distance_km) ?? positiveNumber(trip.google_estimated_km) ?? positiveNumber(trip.booking_estimated_km) ?? positiveNumber(trip.manual_estimated_distance_km);
  if (google != null) return { workingKm: google, actualKm: null, source: "google", isVerifiedActual: false };

  return { workingKm: null, actualKm: null, source: "missing", isVerifiedActual: false };
}

export function uniqueFuelTotals(logs: FuelLogWithDriver[]) {
  const seen = new Set<string>();
  return logs.reduce<FuelTotals>((total, log) => {
    const id = String(log.id);
    if (seen.has(id)) return total;
    seen.add(id);
    total.litres += Number(log.litres || 0);
    total.cost += Number(log.total_cost || 0);
    total.count += 1;
    return total;
  }, { litres: 0, cost: 0, count: 0 });
}

export function uniqueLinkedFuelTotals(trips: Array<Pick<TripJourneyWithFuel, "linkedFuelLogs">>) {
  return uniqueFuelTotals(trips.flatMap((trip) => trip.linkedFuelLogs ?? []));
}

function sortFuelLogs(logs: FuelLogWithDriver[]) {
  return [...logs].sort((left, right) => {
    const dateCompare = String(left.date || "").localeCompare(String(right.date || ""));
    if (dateCompare !== 0) return dateCompare;
    return (getFuelOdometer(left) ?? 0) - (getFuelOdometer(right) ?? 0);
  });
}

export function buildVehicleFuelIntervals(fuelLogs: FuelLogWithDriver[]) {
  const groups = new Map<string, FuelLogWithDriver[]>();
  for (const log of fuelLogs) {
    const vehicleKey = normalizeVehicleKey(log.vehicle_reg);
    if (!vehicleKey || getFuelOdometer(log) == null) continue;
    groups.set(vehicleKey, [...(groups.get(vehicleKey) ?? []), log]);
  }

  const intervals: FuelInterval[] = [];
  for (const [vehicleKey, logs] of groups) {
    const sorted = sortFuelLogs(logs);
    for (let index = 0; index < sorted.length - 1; index += 1) {
      const startFuelLog = sorted[index];
      const endFuelLog = sorted[index + 1];
      const startOdometer = getFuelOdometer(startFuelLog) ?? 0;
      const endOdometer = getFuelOdometer(endFuelLog) ?? 0;
      const valid = endOdometer > startOdometer;
      intervals.push({
        key: `${vehicleKey}:${startFuelLog.id}:${endFuelLog.id}`,
        vehicleReg: endFuelLog.vehicle_reg || startFuelLog.vehicle_reg || "",
        driverNames: [...new Set([startFuelLog.driver, endFuelLog.driver].map((value) => String(value || "").trim()).filter(Boolean))],
        startFuelLog,
        endFuelLog,
        startDate: startFuelLog.date,
        endDate: endFuelLog.date,
        startOdometer,
        endOdometer,
        distanceKm: valid ? endOdometer - startOdometer : 0,
        valid
      });
    }
  }

  return intervals;
}

export function buildVerifiedFullTankCycles(fuelLogs: FuelLogWithDriver[]) {
  const groups = new Map<string, FuelLogWithDriver[]>();
  for (const log of fuelLogs) {
    const vehicleKey = normalizeVehicleKey(log.vehicle_reg);
    if (!vehicleKey) continue;
    groups.set(vehicleKey, [...(groups.get(vehicleKey) ?? []), log]);
  }

  const cycles: VerifiedFuelCycle[] = [];
  for (const [vehicleKey, logs] of groups) {
    const sorted = sortFuelLogs(logs);
    const fullTankIndexes = sorted
      .map((log, index) => (log.full_tank_confirmed ? index : -1))
      .filter((index) => index >= 0);

    for (let boundaryIndex = 0; boundaryIndex < fullTankIndexes.length - 1; boundaryIndex += 1) {
      const startIndex = fullTankIndexes[boundaryIndex];
      const endIndex = fullTankIndexes[boundaryIndex + 1];
      const cycleLogs = sorted.slice(startIndex + 1, endIndex + 1);
      const startFuelLog = sorted[startIndex];
      const endFuelLog = sorted[endIndex];
      const startOdometer = getFuelOdometer(startFuelLog);
      const endOdometer = getFuelOdometer(endFuelLog);
      const litres = uniqueFuelTotals(cycleLogs).litres;
      const cost = uniqueFuelTotals(cycleLogs).cost;
      const distanceKm = startOdometer != null && endOdometer != null && endOdometer > startOdometer ? endOdometer - startOdometer : 0;
      const invalidReason =
        startOdometer == null || endOdometer == null ? "Missing full-tank odometer boundary" :
        endOdometer <= startOdometer ? "Invalid or decreasing odometer boundary" :
        litres <= 0 ? "Cycle litres are zero" :
        null;

      cycles.push({
        key: `${vehicleKey}:full:${startFuelLog.id}:${endFuelLog.id}`,
        vehicleReg: endFuelLog.vehicle_reg || startFuelLog.vehicle_reg || "",
        driverNames: [...new Set([startFuelLog, endFuelLog, ...cycleLogs].map((log) => String(log.driver || "").trim()).filter(Boolean))],
        startFuelLog,
        endFuelLog,
        startDate: startFuelLog.date,
        endDate: endFuelLog.date,
        startOdometer: startOdometer ?? 0,
        endOdometer: endOdometer ?? 0,
        distanceKm,
        valid: invalidReason === null,
        litres,
        cost,
        kmPerLitre: invalidReason === null ? distanceKm / litres : null,
        costPerKm: invalidReason === null && distanceKm > 0 ? cost / distanceKm : null,
        logIds: cycleLogs.map((log) => String(log.id)),
        status: invalidReason === null ? "verified" : "invalid",
        invalidReason
      });
    }
  }

  return cycles;
}

export function getMondaySundayWeek(dateKey: string) {
  const date = new Date(`${dateKey}T00:00:00Z`);
  const day = date.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const start = new Date(date.getTime() + mondayOffset * DAY_MS);
  const end = new Date(start.getTime() + 6 * DAY_MS);
  return { startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) };
}

export function previousCompletedBangkokWeek(now = new Date()) {
  const bangkokParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const part = (type: string) => bangkokParts.find((item) => item.type === type)?.value ?? "";
  const today = `${part("year")}-${part("month")}-${part("day")}`;
  const currentWeek = getMondaySundayWeek(today);
  const currentStart = new Date(`${currentWeek.startDate}T00:00:00Z`);
  const previousEnd = new Date(currentStart.getTime() - DAY_MS);
  return getMondaySundayWeek(previousEnd.toISOString().slice(0, 10));
}

export function inDateRange(dateKey: string | null | undefined, startDate: string, endDate: string) {
  const key = String(dateKey ?? "").slice(0, 10);
  return key >= startDate && key <= endDate;
}

export function fuelPurchasedInPeriod(fuelLogs: FuelLogWithDriver[], startDate: string, endDate: string) {
  return uniqueFuelTotals(fuelLogs.filter((log) => inDateRange(log.date, startDate, endDate)));
}

export function cyclesEndingInPeriod(cycles: VerifiedFuelCycle[], startDate: string, endDate: string) {
  return cycles.filter((cycle) => inDateRange(cycle.endDate, startDate, endDate));
}

export function calculateRouteAccuracy(trips: TripJourneyWithFuel[]) {
  const rows = trips.flatMap((trip) => {
    const plannedKm = positiveNumber(trip.estimated_distance_km) ?? positiveNumber(trip.google_estimated_km) ?? positiveNumber(trip.booking_estimated_km);
    const distance = getTripDistanceUsed(trip);
    if (plannedKm == null || distance.actualKm == null) return [];
    return [{ plannedKm, actualKm: distance.actualKm, varianceKm: distance.actualKm - plannedKm }];
  });
  const averageVarianceKm = rows.length ? rows.reduce((sum, row) => sum + Math.abs(row.varianceKm), 0) / rows.length : null;
  const accuracyPercent =
    rows.length && rows.reduce((sum, row) => sum + row.plannedKm, 0) > 0
      ? Math.max(0, 100 - (rows.reduce((sum, row) => sum + Math.abs(row.varianceKm), 0) / rows.reduce((sum, row) => sum + row.plannedKm, 0)) * 100)
      : null;
  return { sampleSize: rows.length, averageVarianceKm, accuracyPercent, rows };
}

export function calculateWeeklyOdometerDistance(
  entries: WeeklyMileageEntry[],
  vehicleReg: string,
  weekEnding: string
) {
  const vehicleKey = normalizeVehicleKey(vehicleReg);
  const rows = entries
    .filter((entry) => normalizeVehicleKey(entry.vehicle_reg) === vehicleKey)
    .sort((left, right) => String(left.week_ending).localeCompare(String(right.week_ending)));
  const currentIndex = rows.findIndex((entry) => String(entry.week_ending).slice(0, 10) === weekEnding);
  if (currentIndex < 0) return null;
  const current = rows[currentIndex];
  const previous = rows.slice(0, currentIndex).reverse().find((entry) => !entry.is_odometer_baseline);
  if (!previous || current.is_odometer_baseline) return null;
  const distance = Number(current.mileage ?? current.odometer_reading ?? 0) - Number(previous.mileage ?? previous.odometer_reading ?? 0);
  return Number.isFinite(distance) && distance > 0 ? distance : null;
}

export function calculateVehicleCoverage({
  vehicleReg,
  odometerDistanceKm,
  linkedTripWorkingKm
}: {
  vehicleReg: string;
  odometerDistanceKm: number | null;
  linkedTripWorkingKm: number;
}): VehicleCoverage {
  if (odometerDistanceKm == null || odometerDistanceKm <= 0) {
    return { vehicleReg, odometerDistanceKm, linkedTripWorkingKm, otherUnallocatedKm: null, coveragePercent: null, conflictKm: 0, needsReview: false, message: null };
  }
  const conflictKm = Math.max(0, linkedTripWorkingKm - odometerDistanceKm);
  return {
    vehicleReg,
    odometerDistanceKm,
    linkedTripWorkingKm,
    otherUnallocatedKm: conflictKm > 0 ? 0 : odometerDistanceKm - linkedTripWorkingKm,
    coveragePercent: (linkedTripWorkingKm / odometerDistanceKm) * 100,
    conflictKm,
    needsReview: conflictKm > 0,
    message: conflictKm > 0 ? "Recorded trip distance exceeds odometer distance" : null
  };
}
