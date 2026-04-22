"use client";

import type {
  BankTransferWithDriver,
  Driver,
  FuelLogWithDriver,
  Vehicle,
  WeeklyMileageEntry
} from "@/types/database";
import {
  getOilChangeIntervalForVehicleType,
  getVehicleTypeLabel,
  type OilChangeIntervalSource
} from "@/lib/oil-change-service";

export type FuelCalculationField = "litres" | "total_cost" | "price_per_litre";

export type FuelCalculationInput = {
  litres: string;
  total_cost: string;
  price_per_litre: string;
  lastEditedField: FuelCalculationField;
};

export type FuelCalculationResult = {
  litres: string;
  total_cost: string;
  price_per_litre: string;
};

export type VehicleWeeklyDistanceRow = {
  weekEnding: string;
  vehicleReg: string;
  distance: number;
  minOdometer: number | null;
  maxOdometer: number | null;
  entryCount: number;
  latestEntry: WeeklyMileageEntry;
  previousEntry: WeeklyMileageEntry | null;
  expectedOdometer: number | null;
  unusual: boolean;
};

export type WeeklyMileageSummaryRow = {
  weekEnding: string;
  vehiclesSubmitted: number;
  driversSubmitted: number;
  highestOdometer: number | null;
  lowestOdometer: number | null;
  weeklyDistance: number;
  totalRecordedOdometer: number;
  comparableVehicles: number;
  missingVehicleCount: number;
};

export type DriverWeeklyComparisonRow = {
  driverId: string;
  driver: string;
  latestWeekEnding: string;
  previousWeekEnding: string | null;
  latestOdometer: number;
  previousOdometer: number | null;
  weeklyDistance: number | null;
  vehicleReg: string;
  previousVehicleReg: string | null;
  unusual: boolean;
  history: WeeklyMileageEntry[];
};

export type OilChangeStatus = "ok" | "due_soon" | "urgent" | "overdue" | "not_set" | "no_odometer" | "review_required";

export type OilChangeAlertRow = {
  vehicleId: string | null;
  registration: string;
  vehicleName: string;
  driverName: string | null;
  vehicleType: string | null;
  vehicleTypeLabel: string;
  lastOilChangeDate: string | null;
  lastOilChangeOdometer: number | null;
  oilChangeIntervalKm: number | null;
  intervalSource: OilChangeIntervalSource;
  reviewReasons: string[];
  currentOdometer: number | null;
  currentOdometerDate: string | null;
  nextOilChangeDueOdometer: number | null;
  kmRemaining: number | null;
  overdueKm: number | null;
  status: OilChangeStatus;
  sortRank: number;
};

const OIL_CHANGE_DUE_SOON_THRESHOLD_KM = 3000;
const OIL_CHANGE_URGENT_THRESHOLD_KM = 1000;

function toRoundedNumber(value: number, digits = 2) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function parseNumber(value: string) {
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatDecimal(value: number | null, digits = 2) {
  if (value == null || !Number.isFinite(value)) {
    return "";
  }

  return toRoundedNumber(value, digits).toFixed(digits);
}

function getDriverKey(entry: WeeklyMileageEntry) {
  return String(entry.driver_id || entry.driver || "").trim().toLowerCase();
}

function getVehicleKey(vehicleReg: string | null | undefined) {
  return String(vehicleReg || "").trim().toLowerCase();
}

function getWeekEntrySortValue(entry: WeeklyMileageEntry) {
  return `${entry.week_ending}::${entry.created_at || ""}::${String(entry.id)}`;
}

function getNormalizedOdometer(entry: WeeklyMileageEntry) {
  const value = Number(entry.odometer_reading ?? entry.mileage);
  return Number.isFinite(value) ? value : null;
}

function getLatestWeeklyMileageByVehicle(entries: WeeklyMileageEntry[]) {
  const latestByVehicle = new Map<string, WeeklyMileageEntry>();

  for (const entry of entries) {
    const vehicleKey = getVehicleKey(entry.vehicle_reg);
    const odometer = getNormalizedOdometer(entry);

    if (!vehicleKey || !entry.week_ending || odometer == null) {
      continue;
    }

    const previous = latestByVehicle.get(vehicleKey);
    if (
      !previous ||
      getWeekEntrySortValue(entry).localeCompare(getWeekEntrySortValue(previous)) > 0
    ) {
      latestByVehicle.set(vehicleKey, entry);
    }
  }

  return latestByVehicle;
}

function buildOilChangeRow({
  vehicleId,
  registration,
  vehicleName,
  driverName,
  vehicleType,
  lastOilChangeDate,
  lastOilChangeOdometer,
  oilChangeIntervalKm,
  latestMileage
}: {
  vehicleId: string | null;
  registration: string;
  vehicleName: string;
  driverName?: string | null;
  vehicleType?: string | null;
  lastOilChangeDate: string | null;
  lastOilChangeOdometer: number | null;
  oilChangeIntervalKm: number | null | undefined;
  latestMileage: WeeklyMileageEntry | null;
}): OilChangeAlertRow {
  const explicitInterval =
    oilChangeIntervalKm != null && Number.isFinite(Number(oilChangeIntervalKm)) && Number(oilChangeIntervalKm) > 0
      ? Number(oilChangeIntervalKm)
      : null;
  const vehicleTypeInterval = getOilChangeIntervalForVehicleType(vehicleType);
  const interval = explicitInterval ?? vehicleTypeInterval;
  const intervalSource: OilChangeIntervalSource =
    explicitInterval != null
      ? "vehicle_baseline"
      : vehicleTypeInterval != null
        ? "vehicle_type"
        : "missing";
  const reviewReasons = [
    !vehicleType ? "Missing vehicle type" : "",
    interval == null ? "Missing oil change interval" : ""
  ].filter(Boolean);
  const currentOdometer = latestMileage ? getNormalizedOdometer(latestMileage) : null;
  const lastOdometer =
    lastOilChangeOdometer != null && Number.isFinite(Number(lastOilChangeOdometer))
      ? Number(lastOilChangeOdometer)
      : null;
  const nextDue =
    lastOdometer != null && interval != null ? Math.trunc(lastOdometer + interval) : null;
  const kmRemaining =
    nextDue != null && currentOdometer != null ? Math.trunc(nextDue - currentOdometer) : null;
  const overdueKm = kmRemaining != null && kmRemaining < 0 ? Math.abs(kmRemaining) : null;
  const status: OilChangeStatus =
    reviewReasons.length > 0
      ? "review_required"
      : lastOdometer == null
      ? "not_set"
      : currentOdometer == null
        ? "no_odometer"
        : kmRemaining! < 0
          ? "overdue"
          : kmRemaining! <= OIL_CHANGE_URGENT_THRESHOLD_KM
            ? "urgent"
            : kmRemaining! <= OIL_CHANGE_DUE_SOON_THRESHOLD_KM
              ? "due_soon"
              : "ok";
  const sortRank: Record<OilChangeStatus, number> = {
    overdue: 0,
    urgent: 1,
    due_soon: 2,
    review_required: 3,
    not_set: 4,
    no_odometer: 5,
    ok: 6
  };

  return {
    vehicleId,
    registration,
    vehicleName: vehicleName || registration,
    driverName: driverName ?? null,
    vehicleType: vehicleType ?? null,
    vehicleTypeLabel: getVehicleTypeLabel(vehicleType),
    lastOilChangeDate,
    lastOilChangeOdometer: lastOdometer,
    oilChangeIntervalKm: interval,
    intervalSource,
    reviewReasons,
    currentOdometer,
    currentOdometerDate: latestMileage?.week_ending ?? null,
    nextOilChangeDueOdometer: nextDue,
    kmRemaining,
    overdueKm,
    status,
    sortRank: sortRank[status]
  };
}

export function buildOilChangeAlertRows({
  vehicles,
  weeklyMileage,
  drivers = []
}: {
  vehicles: Vehicle[];
  weeklyMileage: WeeklyMileageEntry[];
  drivers?: Driver[];
}) {
  const latestByVehicle = getLatestWeeklyMileageByVehicle(weeklyMileage);
  const rowsByVehicleKey = new Map<string, OilChangeAlertRow>();

  for (const vehicle of vehicles) {
    const registration = vehicle.vehicle_reg || vehicle.registration || "";
    const vehicleKey = getVehicleKey(registration);
    if (!vehicleKey) {
      continue;
    }
    const matchedDriver =
      drivers.find((driver) => String(driver.assigned_vehicle_id || "") === String(vehicle.id)) ??
      drivers.find((driver) => getVehicleKey(driver.vehicle_reg) === vehicleKey) ??
      null;

    rowsByVehicleKey.set(
      vehicleKey,
      buildOilChangeRow({
        vehicleId: String(vehicle.id),
        registration,
        vehicleName: vehicle.vehicle_name,
        driverName: matchedDriver?.name ?? null,
        vehicleType: matchedDriver?.vehicle_type ?? vehicle.vehicle_type ?? null,
        lastOilChangeDate: vehicle.last_oil_change_date,
        lastOilChangeOdometer: vehicle.last_oil_change_odometer,
        oilChangeIntervalKm: vehicle.oil_change_interval_km,
        latestMileage: latestByVehicle.get(vehicleKey) ?? null
      })
    );
  }

  for (const driver of drivers) {
    const registration = driver.vehicle_reg || "";
    const vehicleKey = getVehicleKey(registration);
    if (!vehicleKey || rowsByVehicleKey.has(vehicleKey)) {
      continue;
    }

    const assignedVehicle = driver.assigned_vehicle_id
      ? vehicles.find((vehicle) => String(vehicle.id) === String(driver.assigned_vehicle_id))
      : null;

    rowsByVehicleKey.set(
      vehicleKey,
      buildOilChangeRow({
        vehicleId: assignedVehicle ? String(assignedVehicle.id) : null,
        registration,
        vehicleName: assignedVehicle?.vehicle_name || driver.name || registration,
        driverName: driver.name || null,
        vehicleType: driver.vehicle_type ?? null,
        lastOilChangeDate: assignedVehicle?.last_oil_change_date ?? null,
        lastOilChangeOdometer: assignedVehicle?.last_oil_change_odometer ?? null,
        oilChangeIntervalKm: assignedVehicle?.oil_change_interval_km ?? null,
        latestMileage: latestByVehicle.get(vehicleKey) ?? null
      })
    );
  }

  return Array.from(rowsByVehicleKey.values()).sort((left, right) => {
    const priorityDiff = left.sortRank - right.sortRank;
    if (priorityDiff !== 0) return priorityDiff;

    const leftRemaining = left.kmRemaining ?? Number.POSITIVE_INFINITY;
    const rightRemaining = right.kmRemaining ?? Number.POSITIVE_INFINITY;
    if (leftRemaining !== rightRemaining) return leftRemaining - rightRemaining;

    return left.registration.localeCompare(right.registration);
  });
}

export function calculateFuelFields({
  litres,
  total_cost,
  price_per_litre,
  lastEditedField
}: FuelCalculationInput): FuelCalculationResult {
  const parsedLitres = parseNumber(litres);
  const parsedTotalCost = parseNumber(total_cost);
  const parsedPricePerLitre = parseNumber(price_per_litre);

  let nextTotalCost = total_cost;
  let nextPricePerLitre = price_per_litre;

  if (lastEditedField === "price_per_litre") {
    if ((parsedLitres ?? 0) > 0 && parsedPricePerLitre != null && parsedPricePerLitre >= 0) {
      nextTotalCost = formatDecimal(parsedLitres! * parsedPricePerLitre);
    } else if (!litres.trim()) {
      nextTotalCost = "";
    }
  } else {
    if ((parsedLitres ?? 0) > 0 && parsedTotalCost != null && parsedTotalCost >= 0) {
      nextPricePerLitre = formatDecimal(parsedTotalCost / parsedLitres!);
    } else {
      nextPricePerLitre = "";
    }
  }

  return {
    litres,
    total_cost: nextTotalCost,
    price_per_litre: nextPricePerLitre
  };
}

export function computeWeeklyMileageByVehicle(entries: WeeklyMileageEntry[]) {
  const normalizedEntries = [...entries].sort((left, right) => {
    const dateDiff = new Date(left.week_ending).getTime() - new Date(right.week_ending).getTime();
    if (dateDiff !== 0) {
      return dateDiff;
    }

    return String(left.id).localeCompare(String(right.id));
  });

  const groups = new Map<string, WeeklyMileageEntry[]>();

  for (const entry of normalizedEntries) {
    const vehicleKey = getVehicleKey(entry.vehicle_reg);
    if (!vehicleKey || !entry.week_ending) {
      continue;
    }

    const groupKey = `${entry.week_ending}::${vehicleKey}`;
    const bucket = groups.get(groupKey) ?? [];
    bucket.push(entry);
    groups.set(groupKey, bucket);
  }

  const vehicleHistory = new Map<string, VehicleWeeklyDistanceRow[]>();
  const rows: VehicleWeeklyDistanceRow[] = [];

  for (const bucket of groups.values()) {
    const sortedBucket = [...bucket].sort((left, right) => getWeekEntrySortValue(left).localeCompare(getWeekEntrySortValue(right)));
    const latestEntry = sortedBucket[sortedBucket.length - 1];
    const odometers = sortedBucket
      .map((entry) => Number(entry.odometer_reading ?? entry.mileage))
      .filter((value) => Number.isFinite(value));
    const minOdometer = odometers.length ? Math.min(...odometers) : null;
    const maxOdometer = odometers.length ? Math.max(...odometers) : null;
    const vehicleKey = getVehicleKey(latestEntry.vehicle_reg);
    const history = vehicleHistory.get(vehicleKey) ?? [];
    const previousEntry = history[history.length - 1]?.latestEntry ?? null;
    const latestOdometer = Number(latestEntry.odometer_reading ?? latestEntry.mileage);
    const previousOdometer =
      previousEntry != null
        ? Number(previousEntry.odometer_reading ?? previousEntry.mileage)
        : null;
    const rawDistance =
      previousOdometer != null && Number.isFinite(latestOdometer)
        ? latestOdometer - previousOdometer
        : null;
    const distance = rawDistance != null ? Math.max(0, rawDistance) : 0;
    const expectedOdometer =
      previousOdometer != null ? previousOdometer + distance : null;
    const previousDistance = history[history.length - 1]?.distance ?? null;
    const unusual =
      rawDistance != null && rawDistance < 0
        ? true
        : previousDistance != null
          ? distance > previousDistance * 1.8 ||
            (previousDistance > 0 && distance < previousDistance * 0.3)
          : false;

    const row = {
      weekEnding: latestEntry.week_ending,
      vehicleReg: latestEntry.vehicle_reg,
      distance,
      minOdometer,
      maxOdometer,
      entryCount: sortedBucket.length,
      latestEntry,
      previousEntry,
      expectedOdometer,
      unusual
    } satisfies VehicleWeeklyDistanceRow;

    history.push(row);
    vehicleHistory.set(vehicleKey, history);
    rows.push(row);
  }

  return rows.sort((left, right) => {
    const dateDiff = new Date(right.weekEnding).getTime() - new Date(left.weekEnding).getTime();
    if (dateDiff !== 0) {
      return dateDiff;
    }

    return left.vehicleReg.localeCompare(right.vehicleReg);
  });
}

export function buildWeeklyMileageSummary(entries: WeeklyMileageEntry[]) {
  const weeklyVehicleRows = computeWeeklyMileageByVehicle(entries);
  const weeks = Array.from(new Set(entries.map((entry) => entry.week_ending))).sort((left, right) =>
    right.localeCompare(left)
  );

  return weeks.map((weekEnding) => {
    const weekEntries = entries.filter((entry) => entry.week_ending === weekEnding);
    const weekVehicleRows = weeklyVehicleRows.filter((row) => row.weekEnding === weekEnding);
    const odometers = weekEntries
      .map((entry) => Number(entry.odometer_reading ?? entry.mileage))
      .filter((value) => Number.isFinite(value));

    return {
      weekEnding,
      vehiclesSubmitted: new Set(weekEntries.map((entry) => getVehicleKey(entry.vehicle_reg)).filter(Boolean)).size,
      driversSubmitted: new Set(weekEntries.map(getDriverKey).filter(Boolean)).size,
      highestOdometer: odometers.length ? Math.max(...odometers) : null,
      lowestOdometer: odometers.length ? Math.min(...odometers) : null,
      weeklyDistance: weekVehicleRows.reduce((sum, row) => sum + row.distance, 0),
      totalRecordedOdometer: odometers.reduce((sum, value) => sum + value, 0),
      comparableVehicles: weekVehicleRows.filter((row) => row.previousEntry != null).length,
      missingVehicleCount: weekVehicleRows.filter((row) => row.distance === 0 && row.entryCount === 1).length
    } satisfies WeeklyMileageSummaryRow;
  });
}

export function buildDriverWeeklyComparisons(entries: WeeklyMileageEntry[]) {
  const validEntries = entries
    .filter((entry) => getDriverKey(entry) && entry.week_ending)
    .filter((entry) => getNormalizedOdometer(entry) != null);

  const driverWeekBuckets = new Map<string, WeeklyMileageEntry[]>();

  for (const entry of validEntries) {
    const bucketKey = `${getDriverKey(entry)}::${entry.week_ending}`;
    const bucket = driverWeekBuckets.get(bucketKey) ?? [];
    bucket.push(entry);
    driverWeekBuckets.set(bucketKey, bucket);
  }

  const latestByDriverWeek = new Map<string, WeeklyMileageEntry>();

  for (const [bucketKey, bucket] of driverWeekBuckets.entries()) {
    const latestEntry = [...bucket].sort((left, right) =>
      getWeekEntrySortValue(right).localeCompare(getWeekEntrySortValue(left))
    )[0];

    latestByDriverWeek.set(bucketKey, latestEntry);
  }

  const driverHistories = new Map<string, WeeklyMileageEntry[]>();

  for (const entry of latestByDriverWeek.values()) {
    const driverKey = getDriverKey(entry);
    const history = driverHistories.get(driverKey) ?? [];
    history.push(entry);
    driverHistories.set(driverKey, history);
  }

  return Array.from(driverHistories.entries())
    .map(([driverKey, history]) => {
      const sortedHistory = [...history].sort((left, right) => {
        const dateDiff = right.week_ending.localeCompare(left.week_ending);
        if (dateDiff !== 0) {
          return dateDiff;
        }

        return getWeekEntrySortValue(right).localeCompare(getWeekEntrySortValue(left));
      });

      const latestEntry = sortedHistory[0];
      const previousEntry = sortedHistory[1] ?? null;
      const latestOdometer = getNormalizedOdometer(latestEntry)!;
      const previousOdometer = previousEntry ? getNormalizedOdometer(previousEntry) : null;
      const weeklyDistance =
        previousOdometer != null ? latestOdometer - previousOdometer : null;

      return {
        driverId: String(latestEntry.driver_id ?? driverKey),
        driver: latestEntry.driver || "-",
        latestWeekEnding: latestEntry.week_ending,
        previousWeekEnding: previousEntry?.week_ending ?? null,
        latestOdometer,
        previousOdometer,
        weeklyDistance,
        vehicleReg: latestEntry.vehicle_reg || "-",
        previousVehicleReg: previousEntry?.vehicle_reg ?? null,
        unusual: weeklyDistance != null ? weeklyDistance < 0 : false,
        history: sortedHistory
      } satisfies DriverWeeklyComparisonRow;
    })
    .sort((left, right) => left.driver.localeCompare(right.driver));
}

export function getSevenDayFuelTrend(fuelLogs: FuelLogWithDriver[], endDate = new Date()) {
  const end = new Date(endDate);
  end.setHours(0, 0, 0, 0);

  const rows: Array<{ date: string; spend: number }> = [];
  for (let offset = 6; offset >= 0; offset -= 1) {
    const day = new Date(end);
    day.setDate(day.getDate() - offset);
    const dateKey = day.toISOString().slice(0, 10);
    rows.push({
      date: dateKey,
      spend: fuelLogs
        .filter((log) => log.date === dateKey)
        .reduce((sum, log) => sum + Number(log.total_cost || 0), 0)
    });
  }

  return rows;
}

export function buildShipmentBenchmark(
  fuelLogs: FuelLogWithDriver[],
  weeklyMileage: WeeklyMileageEntry[],
  lookbackDays = 90
) {
  const endDate = new Date();
  endDate.setHours(0, 0, 0, 0);
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - (lookbackDays - 1));
  const startKey = startDate.toISOString().slice(0, 10);
  const endKey = endDate.toISOString().slice(0, 10);

  const fuelWindow = fuelLogs.filter((log) => log.date >= startKey && log.date <= endKey);
  const mileageWindow = computeWeeklyMileageByVehicle(weeklyMileage).filter(
    (row) => row.weekEnding >= startKey && row.weekEnding <= endKey
  );

  const totalFuelSpend = fuelWindow.reduce((sum, log) => sum + Number(log.total_cost || 0), 0);
  const totalDistance = mileageWindow.reduce((sum, row) => sum + row.distance, 0);
  const costPerKm = totalDistance > 0 ? toRoundedNumber(totalFuelSpend / totalDistance, 2) : null;

  return {
    available: costPerKm != null && totalFuelSpend > 0,
    costPerKm,
    totalFuelSpend,
    totalDistanceKm: totalDistance,
    comparableMileageEntries: mileageWindow.length,
    windowStart: startKey,
    windowEnd: endKey
  };
}

export function buildTransferSummary(transfers: BankTransferWithDriver[]) {
  return {
    totalTransfers: transfers.reduce((sum, transfer) => sum + Number(transfer.amount || 0), 0),
    count: transfers.length
  };
}
