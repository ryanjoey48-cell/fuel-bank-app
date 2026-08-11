import type { Driver, Vehicle, WeeklyMileageEntry } from "@/types/database";

export type WeeklyMileageComparisonStatus =
  | "normal_range"
  | "higher_mileage"
  | "lower_mileage"
  | "no_movement"
  | "missing_previous_week"
  | "missing_comparison_data"
  | "odometer_error"
  | "missing_this_week";

export type WeeklyMileageComparisonGroup = "cannot_compare" | "more" | "less" | "same";

export type WeeklyMileageComparisonRow = {
  vehicleReg: string;
  driverName: string;
  earlierReadingDate: string | null;
  earlierOdometer: number | null;
  previousReadingDate: string | null;
  previousOdometer: number | null;
  currentReadingDate: string | null;
  currentOdometer: number | null;
  currentDistance: number | null;
  previousDistance: number | null;
  differenceKm: number | null;
  status: WeeklyMileageComparisonStatus;
};

export type WeeklyMileageComparisonReport = {
  selectedWeek: string;
  totalActiveVehicles: number;
  vehiclesRecordedThisWeek: number;
  vehiclesMissingThisWeek: number;
  vehiclesMissingPreviousWeek: number;
  vehiclesCompared: number;
  comparableDistanceThisWeek: number;
  comparableDistancePreviousWeek: number;
  comparableDistanceDifference: number;
  notableVariations: number;
  odometerErrors: number;
  rows: WeeklyMileageComparisonRow[];
};

const statusRank: Record<WeeklyMileageComparisonStatus, number> = {
  missing_this_week: 0,
  missing_previous_week: 1,
  missing_comparison_data: 1,
  odometer_error: 2,
  higher_mileage: 3,
  lower_mileage: 3,
  no_movement: 4,
  normal_range: 4
};

export const WEEKLY_MILEAGE_REVIEW_THRESHOLD_KM = 1000;

export function weeklyMileageComparisonGroup(row: Pick<WeeklyMileageComparisonRow, "differenceKm" | "status">): WeeklyMileageComparisonGroup {
  if (
    row.status === "missing_this_week" ||
    row.status === "missing_previous_week" ||
    row.status === "missing_comparison_data" ||
    row.status === "odometer_error" ||
    row.differenceKm == null
  ) return "cannot_compare";
  if (row.differenceKm > 0) return "more";
  if (row.differenceKm < 0) return "less";
  return "same";
}

const groupRank: Record<WeeklyMileageComparisonGroup, number> = {
  cannot_compare: 0,
  more: 1,
  less: 2,
  same: 3
};

export function compareWeeklyMileageRows(left: WeeklyMileageComparisonRow, right: WeeklyMileageComparisonRow) {
  const leftGroup = weeklyMileageComparisonGroup(left);
  const rightGroup = weeklyMileageComparisonGroup(right);
  const groupDifference = groupRank[leftGroup] - groupRank[rightGroup];
  if (groupDifference !== 0) return groupDifference;
  if (leftGroup === "cannot_compare") {
    const statusDifference = statusRank[left.status] - statusRank[right.status];
    if (statusDifference !== 0) return statusDifference;
  }
  if (leftGroup === "more") {
    const difference = (right.differenceKm ?? 0) - (left.differenceKm ?? 0);
    if (difference !== 0) return difference;
  }
  if (leftGroup === "less") {
    const difference = Math.abs(right.differenceKm ?? 0) - Math.abs(left.differenceKm ?? 0);
    if (difference !== 0) return difference;
  }
  return left.vehicleReg.localeCompare(right.vehicleReg);
}

function normalizeRegistration(value: unknown) {
  return String(value ?? "").trim().replace(/\s+/g, "").replace(/-/g, "").toUpperCase();
}

function registrationLabel(value: unknown) {
  return String(value ?? "").trim();
}

function normalizedOdometer(entry: WeeklyMileageEntry | null | undefined) {
  if (!entry) return null;
  const value = Number(entry.odometer_reading ?? entry.mileage);
  return Number.isFinite(value) ? value : null;
}

function entrySortKey(entry: WeeklyMileageEntry) {
  return `${entry.created_at || ""}::${String(entry.id || "")}`;
}

function latestEntryForDate(entries: WeeklyMileageEntry[]) {
  return [...entries].sort((left, right) => entrySortKey(right).localeCompare(entrySortKey(left)))[0] ?? null;
}

function addUtcDays(value: string, days: number) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function vehicleIsActive(vehicle: Vehicle) {
  const record = vehicle as Vehicle & {
    archived?: boolean | null;
    deleted_at?: string | null;
    is_active?: boolean | null;
    status?: string | null;
  };
  const status = String(record.status ?? "").trim().toLowerCase();
  return vehicle.active !== false && record.is_active !== false && record.archived !== true && !record.deleted_at &&
    !["inactive", "archived", "deleted", "retired"].includes(status);
}

function assignedDriverForVehicle(vehicle: Vehicle | undefined, drivers: Driver[]) {
  if (!vehicle) return "";
  const direct = drivers.find(
    (driver) => driver.active !== false && driver.assigned_vehicle_id && String(driver.assigned_vehicle_id) === String(vehicle.id)
  );
  if (direct) return direct.name;
  const vehicleKey = normalizeRegistration(vehicle.vehicle_reg || vehicle.registration);
  return drivers.find((driver) => driver.active !== false && normalizeRegistration(driver.vehicle_reg) === vehicleKey)?.name ?? "";
}

function comparisonStatus({
  hasCurrent,
  hasPreviousWeek,
  hasEarlierWeek,
  currentDistance,
  previousDistance
}: {
  hasCurrent: boolean;
  hasPreviousWeek: boolean;
  hasEarlierWeek: boolean;
  currentDistance: number | null;
  previousDistance: number | null;
}): WeeklyMileageComparisonStatus {
  if (!hasCurrent) return "missing_this_week";
  if (!hasPreviousWeek) return "missing_previous_week";
  if (currentDistance != null && currentDistance < 0) return "odometer_error";
  if (!hasEarlierWeek) return "missing_comparison_data";
  if (previousDistance != null && previousDistance < 0) return "odometer_error";
  if (currentDistance == null || previousDistance == null) return "missing_comparison_data";
  const differenceKm = currentDistance - previousDistance;
  if (differenceKm === 0) return "no_movement";
  if (Math.abs(differenceKm) >= WEEKLY_MILEAGE_REVIEW_THRESHOLD_KM) {
    return differenceKm > 0 ? "higher_mileage" : "lower_mileage";
  }
  return "normal_range";
}

export function buildWeeklyMileageComparisonReport({
  entries,
  vehicles,
  drivers,
  selectedWeek
}: {
  entries: WeeklyMileageEntry[];
  vehicles: Vehicle[];
  drivers: Driver[];
  selectedWeek: string;
}): WeeklyMileageComparisonReport {
  const validEntries = entries.filter(
    (entry) => normalizeRegistration(entry.vehicle_reg) && entry.week_ending && normalizedOdometer(entry) != null
  );
  const entriesByVehicleAndDate = new Map<string, WeeklyMileageEntry[]>();
  for (const entry of validEntries) {
    const key = `${normalizeRegistration(entry.vehicle_reg)}::${entry.week_ending}`;
    entriesByVehicleAndDate.set(key, [...(entriesByVehicleAndDate.get(key) ?? []), entry]);
  }

  const historyByVehicle = new Map<string, WeeklyMileageEntry[]>();
  for (const [key, sameDateEntries] of entriesByVehicleAndDate.entries()) {
    const vehicleKey = key.split("::")[0];
    const latest = latestEntryForDate(sameDateEntries);
    if (latest) historyByVehicle.set(vehicleKey, [...(historyByVehicle.get(vehicleKey) ?? []), latest]);
  }
  for (const [vehicleKey, history] of historyByVehicle.entries()) {
    historyByVehicle.set(vehicleKey, [...history].sort((left, right) => right.week_ending.localeCompare(left.week_ending)));
  }

  const activeVehiclesByKey = new Map<string, Vehicle>();
  for (const vehicle of vehicles.filter(vehicleIsActive)) {
    const key = normalizeRegistration(vehicle.vehicle_reg || vehicle.registration);
    if (key && !activeVehiclesByKey.has(key)) activeVehiclesByKey.set(key, vehicle);
  }

  const previousWeek = addUtcDays(selectedWeek, -7);
  const earlierWeek = addUtcDays(selectedWeek, -14);

  const rows = Array.from(activeVehiclesByKey.entries()).map(([vehicleKey, vehicle]): WeeklyMileageComparisonRow => {
    const history = historyByVehicle.get(vehicleKey) ?? [];
    const current = history.find((entry) => entry.week_ending === selectedWeek) ?? null;
    const previous = history.find((entry) => entry.week_ending === previousWeek) ?? null;
    const earlier = history.find((entry) => entry.week_ending === earlierWeek) ?? null;
    const currentOdometer = normalizedOdometer(current);
    const previousOdometer = normalizedOdometer(previous);
    const earlierOdometer = normalizedOdometer(earlier);
    const currentDistance = currentOdometer != null && previousOdometer != null ? currentOdometer - previousOdometer : null;
    const previousDistance = previousOdometer != null && earlierOdometer != null ? previousOdometer - earlierOdometer : null;
    const comparable = currentDistance != null && currentDistance >= 0 && previousDistance != null && previousDistance >= 0;
    const differenceKm = comparable ? currentDistance - previousDistance : null;
    return {
      vehicleReg: registrationLabel(vehicle.vehicle_reg || vehicle.registration) || vehicleKey,
      driverName: current?.driver?.trim() || assignedDriverForVehicle(vehicle, drivers) || "-",
      earlierReadingDate: earlier?.week_ending ?? null,
      earlierOdometer,
      previousReadingDate: previous?.week_ending ?? null,
      previousOdometer,
      currentReadingDate: current?.week_ending ?? null,
      currentOdometer,
      currentDistance: currentDistance != null && currentDistance >= 0 ? currentDistance : currentDistance,
      previousDistance: previousDistance != null && previousDistance >= 0 ? previousDistance : previousDistance,
      differenceKm,
      status: comparisonStatus({
        hasCurrent: Boolean(current),
        hasPreviousWeek: Boolean(previous),
        hasEarlierWeek: Boolean(earlier),
        currentDistance,
        previousDistance
      })
    };
  });

  rows.sort(compareWeeklyMileageRows);
  const comparableRows = rows.filter(
    (row) => row.currentDistance != null && row.currentDistance >= 0 && row.previousDistance != null && row.previousDistance >= 0
  );
  const comparableDistanceThisWeek = comparableRows.reduce((sum, row) => sum + row.currentDistance!, 0);
  const comparableDistancePreviousWeek = comparableRows.reduce((sum, row) => sum + row.previousDistance!, 0);

  return {
    selectedWeek,
    totalActiveVehicles: activeVehiclesByKey.size,
    vehiclesRecordedThisWeek: rows.filter((row) => row.currentReadingDate === selectedWeek).length,
    vehiclesMissingThisWeek: rows.filter((row) => row.status === "missing_this_week").length,
    vehiclesMissingPreviousWeek: rows.filter((row) => row.status === "missing_previous_week").length,
    vehiclesCompared: comparableRows.length,
    comparableDistanceThisWeek,
    comparableDistancePreviousWeek,
    comparableDistanceDifference: comparableDistanceThisWeek - comparableDistancePreviousWeek,
    notableVariations: rows.filter((row) => row.status === "higher_mileage" || row.status === "lower_mileage").length,
    odometerErrors: rows.filter((row) => row.status === "odometer_error").length,
    rows
  };
}
