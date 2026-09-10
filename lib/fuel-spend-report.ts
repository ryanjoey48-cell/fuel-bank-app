import { normalizeVehicleRegistration } from "@/lib/utils";
import { canonicalizeKnownVehicleRegistration } from "@/lib/vehicle-identity";
import type { FuelLogWithDriver } from "@/types/database";
import type { VehicleFuelSpendRow } from "@/lib/vehicle-performance";

function safeNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function monthDateRange(year: number, month?: number | "") {
  if (month) {
    const monthPart = String(month).padStart(2, "0");
    return {
      fromDate: `${year}-${monthPart}-01`,
      toDate: `${year}-${monthPart}-${String(daysInMonth(year, month)).padStart(2, "0")}`
    };
  }

  return {
    fromDate: `${year}-01-01`,
    toDate: `${year}-12-31`
  };
}

function calendarDateKey(value: unknown) {
  const text = String(value ?? "").trim();
  const isoDateMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoDateMatch) return isoDateMatch[0];

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return "";

  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getFuelSpendReportLogCost(log: Pick<FuelLogWithDriver, "total_cost">) {
  return safeNumber(log.total_cost);
}

export function normalizeFuelSpendReportVehicleRegistration(value: string | null | undefined) {
  return canonicalizeKnownVehicleRegistration(normalizeVehicleRegistration(value)) || "-";
}

export function buildFuelSpendReportVehicleMonthlyFuelRows(
  logs: FuelLogWithDriver[],
  filters: { year: number; month?: number | "" }
): VehicleFuelSpendRow[] {
  const { fromDate, toDate } = monthDateRange(filters.year, filters.month);
  const totals = new Map<string, VehicleFuelSpendRow>();

  for (const log of logs) {
    const date = calendarDateKey(log.date);
    if (date < fromDate || date > toDate) continue;

    const year = Number(date.slice(0, 4));
    const month = Number(date.slice(5, 7));
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) continue;

    const vehicleRegistration = normalizeFuelSpendReportVehicleRegistration(log.vehicle_reg);
    const key = `${year}-${month}-${vehicleRegistration}`;
    const existing = totals.get(key);
    const rowRange = monthDateRange(year, month);

    if (existing) {
      existing.fuelSpend += getFuelSpendReportLogCost(log);
      existing.fuelLogCount = (existing.fuelLogCount ?? 0) + 1;
      continue;
    }

    totals.set(key, {
      vehicleRegistration,
      year,
      month,
      fuelSpend: getFuelSpendReportLogCost(log),
      fuelLogCount: 1,
      monthStart: rowRange.fromDate,
      monthEnd: rowRange.toDate
    });
  }

  return Array.from(totals.values());
}

export type FuelSpendManagementFilters = {
  fromDate: string;
  toDate: string;
  driver?: string;
  fuelType?: string;
  location?: string;
  vehicleReg?: string;
};

export type FuelSpendQualityStatus = "normal" | "monitor" | "attention";

export type FuelSpendQualityIssue =
  | "missing_mileage"
  | "unchecked_receipt"
  | "unusual_price"
  | "possible_duplicate"
  | "cost_litre_mismatch"
  | "missing_registration"
  | "missing_driver"
  | "missing_litres"
  | "missing_total_cost"
  | "missing_price_per_litre"
  | "non_bangchak_regular_fuel"
  | "decreasing_mileage";

export type FuelSpendAnalysedLog = FuelLogWithDriver & {
  canonicalLocationGroup: "Bangchak" | "Shell" | "Best LPG" | "Other";
  canonicalVehicleReg: string;
  calculatedPricePerLitre: number | null;
  costAmount: number;
  issues: FuelSpendQualityIssue[];
  litresAmount: number;
  qualityStatus: FuelSpendQualityStatus;
};

export type FuelSpendVehiclePerformanceRow = {
  vehicleReg: string;
  driver: string;
  fuelLogs: number;
  litres: number;
  spend: number;
  weightedAveragePrice: number | null;
  distanceTravelled: number | null;
  kmPerLitre: number | null;
  fuelCostPerKm: number | null;
  firstOdometer: number | null;
  lastOdometer: number | null;
};

export type FuelSpendStationPerformanceRow = {
  station: string;
  fillUps: number;
  litres: number;
  spend: number;
  weightedAveragePrice: number | null;
  fillUpPercent: number;
  spendPercent: number;
};

export type FuelSpendTrendRow = {
  period: string;
  fillUps: number;
  litres: number;
  spend: number;
  weightedAveragePrice: number | null;
};

export type FuelSpendManagementReport = {
  filters: FuelSpendManagementFilters;
  latestFuelLogDate: string | null;
  logs: FuelSpendAnalysedLog[];
  previousLogs: FuelSpendAnalysedLog[];
  totalSpend: number;
  totalLitres: number;
  totalFillUps: number;
  weightedAveragePrice: number | null;
  previousTotalSpend: number;
  previousTotalLitres: number;
  previousWeightedAveragePrice: number | null;
  spendChangeAmount: number | null;
  spendChangePercent: number | null;
  priceChangeAmount: number | null;
  priceChangePercent: number | null;
  highestSpendVehicle: FuelSpendVehiclePerformanceRow | null;
  mostUsedStation: FuelSpendStationPerformanceRow | null;
  bangchakRegularFuelUsagePercent: number | null;
  vehicleRows: FuelSpendVehiclePerformanceRow[];
  stationRows: FuelSpendStationPerformanceRow[];
  trendRows: FuelSpendTrendRow[];
  needsAttention: FuelSpendAnalysedLog[];
  qualityCounts: Record<FuelSpendQualityIssue, number>;
  statusCounts: Record<FuelSpendQualityStatus, number>;
  executiveSummary: string[];
  whatWeShouldKnow: string[];
  whatWeShouldReview: string[];
  reconciliationStatus: "Passed" | "Review required";
};

const qualityIssueKeys: FuelSpendQualityIssue[] = [
  "missing_mileage",
  "unchecked_receipt",
  "unusual_price",
  "possible_duplicate",
  "cost_litre_mismatch",
  "missing_registration",
  "missing_driver",
  "missing_litres",
  "missing_total_cost",
  "missing_price_per_litre",
  "non_bangchak_regular_fuel",
  "decreasing_mileage"
];

function getFuelLogLitres(log: Pick<FuelLogWithDriver, "litres">) {
  const litres = safeNumber(log.litres);
  return litres > 0 ? litres : 0;
}

function getFuelLogStoredPrice(log: Pick<FuelLogWithDriver, "price_per_litre">) {
  const price = Number(log.price_per_litre);
  return Number.isFinite(price) && price > 0 ? price : null;
}

function getFuelLogMileage(log: Pick<FuelLogWithDriver, "mileage" | "odometer">) {
  const rawMileage = log.mileage ?? log.odometer;
  if (rawMileage == null || String(rawMileage).trim() === "") return null;
  const mileage = Number(rawMileage);
  return Number.isFinite(mileage) && mileage >= 0 ? Math.trunc(mileage) : null;
}

function normalizeFuelType(value: unknown) {
  return String(value ?? "").trim().toUpperCase();
}

export function groupFuelSpendStation(value: unknown): FuelSpendAnalysedLog["canonicalLocationGroup"] {
  const text = String(value ?? "").trim().toLowerCase();
  if (text.includes("bangchak") || text.includes("บางจาก")) return "Bangchak";
  if (text.includes("shell")) return "Shell";
  if (text.includes("best") && text.includes("lpg")) return "Best LPG";
  return "Other";
}

function isRegularFuel(log: Pick<FuelLogWithDriver, "fuel_type" | "location">) {
  const fuelType = normalizeFuelType(log.fuel_type);
  const station = groupFuelSpendStation(log.location);
  return station !== "Best LPG" && !fuelType.includes("LPG") && !fuelType.includes("GAS");
}

function equivalentPreviousPeriod(filters: FuelSpendManagementFilters) {
  const from = new Date(`${filters.fromDate}T00:00:00Z`);
  const to = new Date(`${filters.toDate}T00:00:00Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return { fromDate: "", toDate: "" };
  }
  const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1);
  const previousTo = new Date(from);
  previousTo.setUTCDate(previousTo.getUTCDate() - 1);
  const previousFrom = new Date(previousTo);
  previousFrom.setUTCDate(previousFrom.getUTCDate() - days + 1);
  return {
    fromDate: previousFrom.toISOString().slice(0, 10),
    toDate: previousTo.toISOString().slice(0, 10)
  };
}

function logMatchesFilters(log: FuelLogWithDriver, filters: FuelSpendManagementFilters) {
  const date = calendarDateKey(log.date);
  if (filters.fromDate && date < filters.fromDate) return false;
  if (filters.toDate && date > filters.toDate) return false;
  if (filters.driver && String(log.driver || "").trim() !== filters.driver) return false;
  if (filters.location && groupFuelSpendStation(log.location) !== filters.location && String(log.location || "").trim() !== filters.location) return false;
  if (filters.vehicleReg && normalizeFuelSpendReportVehicleRegistration(log.vehicle_reg) !== filters.vehicleReg) return false;
  if (filters.fuelType && normalizeFuelType(log.fuel_type) !== normalizeFuelType(filters.fuelType)) return false;
  return true;
}

function analyseLogs(logs: FuelLogWithDriver[]) {
  const duplicateKeys = new Map<string, number>();
  const previousMileageByVehicle = new Map<string, number>();
  const normalized = logs.map((log) => {
    const vehicle = normalizeFuelSpendReportVehicleRegistration(log.vehicle_reg);
    const location = String(log.location || "").trim();
    const litres = getFuelLogLitres(log);
    const cost = getFuelSpendReportLogCost(log);
    const duplicateKey = [calendarDateKey(log.date), vehicle, String(log.driver || "").trim(), location, litres.toFixed(2), cost.toFixed(2)].join("|");
    duplicateKeys.set(duplicateKey, (duplicateKeys.get(duplicateKey) ?? 0) + 1);
    return { duplicateKey, log };
  });

  return normalized
    .sort((left, right) => {
      const dateDiff = calendarDateKey(left.log.date).localeCompare(calendarDateKey(right.log.date));
      return dateDiff !== 0 ? dateDiff : String(left.log.id).localeCompare(String(right.log.id));
    })
    .map(({ duplicateKey, log }) => {
      const vehicle = normalizeFuelSpendReportVehicleRegistration(log.vehicle_reg);
      const litres = getFuelLogLitres(log);
      const cost = getFuelSpendReportLogCost(log);
      const storedPrice = getFuelLogStoredPrice(log);
      const calculatedPrice = litres > 0 ? cost / litres : null;
      const mileage = getFuelLogMileage(log);
      const previousMileage = vehicle ? previousMileageByVehicle.get(vehicle) ?? null : null;
      const issues: FuelSpendQualityIssue[] = [];

      if (!String(log.vehicle_reg || "").trim() || vehicle === "-") issues.push("missing_registration");
      if (!String(log.driver || "").trim()) issues.push("missing_driver");
      if (mileage == null) issues.push("missing_mileage");
      if (litres <= 0) issues.push("missing_litres");
      if (cost <= 0) issues.push("missing_total_cost");
      if (storedPrice == null) issues.push("missing_price_per_litre");
      if (!log.receipt_checked) issues.push("unchecked_receipt");
      if (storedPrice != null && calculatedPrice != null && Math.abs(storedPrice - calculatedPrice) > 0.05) issues.push("cost_litre_mismatch");
      if (calculatedPrice != null && (calculatedPrice < 20 || calculatedPrice > 60)) issues.push("unusual_price");
      if ((duplicateKeys.get(duplicateKey) ?? 0) > 1) issues.push("possible_duplicate");
      if (isRegularFuel(log) && groupFuelSpendStation(log.location) !== "Bangchak") issues.push("non_bangchak_regular_fuel");
      if (previousMileage != null && mileage != null && mileage < previousMileage) issues.push("decreasing_mileage");
      if (mileage != null && vehicle) previousMileageByVehicle.set(vehicle, mileage);

      const attentionIssues = ["possible_duplicate", "cost_litre_mismatch", "decreasing_mileage"] as FuelSpendQualityIssue[];
      const qualityStatus = issues.some((issue) => attentionIssues.includes(issue))
        ? "attention"
        : issues.length
          ? "monitor"
          : "normal";

      return {
        ...log,
        canonicalLocationGroup: groupFuelSpendStation(log.location),
        canonicalVehicleReg: vehicle,
        calculatedPricePerLitre: calculatedPrice,
        costAmount: cost,
        issues,
        litresAmount: litres,
        qualityStatus
      } satisfies FuelSpendAnalysedLog;
    });
}

function summarizeVehicles(logs: FuelSpendAnalysedLog[]): FuelSpendVehiclePerformanceRow[] {
  const groups = new Map<string, FuelSpendAnalysedLog[]>();
  for (const log of logs) {
    const key = log.canonicalVehicleReg || "-";
    groups.set(key, [...(groups.get(key) ?? []), log]);
  }

  return Array.from(groups.entries()).map(([vehicleReg, rows]) => {
    const litres = rows.reduce((sum, row) => sum + row.litresAmount, 0);
    const spend = rows.reduce((sum, row) => sum + row.costAmount, 0);
    const sortedMileage = rows
      .map((row) => ({ date: calendarDateKey(row.date), mileage: getFuelLogMileage(row) }))
      .filter((row): row is { date: string; mileage: number } => row.mileage != null)
      .sort((left, right) => left.date.localeCompare(right.date));
    const firstOdometer = sortedMileage[0]?.mileage ?? null;
    const lastOdometer = sortedMileage[sortedMileage.length - 1]?.mileage ?? null;
    const distanceTravelled =
      firstOdometer != null && lastOdometer != null && lastOdometer > firstOdometer
        ? lastOdometer - firstOdometer
        : null;
    const driverCounts = new Map<string, number>();
    rows.forEach((row) => {
      const driver = String(row.driver || "").trim();
      if (driver) driverCounts.set(driver, (driverCounts.get(driver) ?? 0) + 1);
    });
    const driver = Array.from(driverCounts.entries()).sort((left, right) => right[1] - left[1])[0]?.[0] ?? "-";

    return {
      vehicleReg,
      driver,
      fuelLogs: rows.length,
      litres,
      spend,
      weightedAveragePrice: litres > 0 ? spend / litres : null,
      distanceTravelled,
      kmPerLitre: distanceTravelled != null && litres > 0 ? distanceTravelled / litres : null,
      fuelCostPerKm: distanceTravelled != null && distanceTravelled > 0 ? spend / distanceTravelled : null,
      firstOdometer,
      lastOdometer
    };
  }).sort((left, right) => right.spend - left.spend);
}

function summarizeStations(logs: FuelSpendAnalysedLog[]): FuelSpendStationPerformanceRow[] {
  const groups = new Map<string, FuelSpendAnalysedLog[]>();
  const totalFillUps = logs.length;
  const totalSpend = logs.reduce((sum, log) => sum + log.costAmount, 0);
  for (const log of logs) {
    groups.set(log.canonicalLocationGroup, [...(groups.get(log.canonicalLocationGroup) ?? []), log]);
  }
  return Array.from(groups.entries()).map(([station, rows]) => {
    const litres = rows.reduce((sum, row) => sum + row.litresAmount, 0);
    const spend = rows.reduce((sum, row) => sum + row.costAmount, 0);
    return {
      station,
      fillUps: rows.length,
      litres,
      spend,
      weightedAveragePrice: litres > 0 ? spend / litres : null,
      fillUpPercent: totalFillUps > 0 ? (rows.length / totalFillUps) * 100 : 0,
      spendPercent: totalSpend > 0 ? (spend / totalSpend) * 100 : 0
    };
  }).sort((left, right) => right.spend - left.spend);
}

function summarizeTrend(logs: FuelSpendAnalysedLog[]): FuelSpendTrendRow[] {
  const groups = new Map<string, FuelSpendAnalysedLog[]>();
  for (const log of logs) {
    const period = calendarDateKey(log.date).slice(0, 7);
    groups.set(period, [...(groups.get(period) ?? []), log]);
  }
  return Array.from(groups.entries()).sort((left, right) => left[0].localeCompare(right[0])).map(([period, rows]) => {
    const litres = rows.reduce((sum, row) => sum + row.litresAmount, 0);
    const spend = rows.reduce((sum, row) => sum + row.costAmount, 0);
    return {
      period,
      fillUps: rows.length,
      litres,
      spend,
      weightedAveragePrice: litres > 0 ? spend / litres : null
    };
  });
}

function percentChange(current: number | null, previous: number | null) {
  return previous != null && previous !== 0 && current != null ? ((current - previous) / previous) * 100 : null;
}

export function buildFuelSpendManagementReport(
  allLogs: FuelLogWithDriver[],
  filters: FuelSpendManagementFilters
): FuelSpendManagementReport {
  const previousFilters = equivalentPreviousPeriod(filters);
  const logs = analyseLogs(allLogs.filter((log) => logMatchesFilters(log, filters)));
  const previousLogs = analyseLogs(allLogs.filter((log) => logMatchesFilters(log, { ...filters, ...previousFilters })));
  const totalSpend = logs.reduce((sum, log) => sum + log.costAmount, 0);
  const totalLitres = logs.reduce((sum, log) => sum + log.litresAmount, 0);
  const previousTotalSpend = previousLogs.reduce((sum, log) => sum + log.costAmount, 0);
  const previousTotalLitres = previousLogs.reduce((sum, log) => sum + log.litresAmount, 0);
  const weightedAveragePrice = totalLitres > 0 ? totalSpend / totalLitres : null;
  const previousWeightedAveragePrice = previousTotalLitres > 0 ? previousTotalSpend / previousTotalLitres : null;
  const vehicleRows = summarizeVehicles(logs);
  const stationRows = summarizeStations(logs);
  const bangchakRegularFuelLogs = logs.filter(isRegularFuel);
  const bangchakRegularFuelUsagePercent = bangchakRegularFuelLogs.length
    ? (bangchakRegularFuelLogs.filter((log) => log.canonicalLocationGroup === "Bangchak").length / bangchakRegularFuelLogs.length) * 100
    : null;
  const qualityCounts = Object.fromEntries(qualityIssueKeys.map((key) => [key, 0])) as Record<FuelSpendQualityIssue, number>;
  const statusCounts = { normal: 0, monitor: 0, attention: 0 };
  logs.forEach((log) => {
    statusCounts[log.qualityStatus] += 1;
    log.issues.forEach((issue) => {
      qualityCounts[issue] += 1;
    });
  });
  const spendChangeAmount = logs.length || previousLogs.length ? totalSpend - previousTotalSpend : null;
  const spendChangePercent = percentChange(totalSpend, previousTotalSpend);
  const priceChangeAmount =
    weightedAveragePrice != null && previousWeightedAveragePrice != null
      ? weightedAveragePrice - previousWeightedAveragePrice
      : null;
  const priceChangePercent = percentChange(weightedAveragePrice, previousWeightedAveragePrice);
  const highestSpendVehicle = vehicleRows[0] ?? null;
  const mostUsedStation = [...stationRows].sort((left, right) => right.fillUps - left.fillUps)[0] ?? null;
  const spendMovement = spendChangeAmount == null ? "has no previous period comparison" : spendChangeAmount >= 0 ? "rose" : "fell";
  const priceMovement = priceChangeAmount == null ? "has no previous period comparison" : priceChangeAmount >= 0 ? "rose" : "fell";
  const issueTotal = Object.values(qualityCounts).reduce((sum, count) => sum + count, 0);

  return {
    filters,
    latestFuelLogDate: logs.map((log) => calendarDateKey(log.date)).sort().at(-1) ?? null,
    logs,
    previousLogs,
    totalSpend,
    totalLitres,
    totalFillUps: logs.length,
    weightedAveragePrice,
    previousTotalSpend,
    previousTotalLitres,
    previousWeightedAveragePrice,
    spendChangeAmount,
    spendChangePercent,
    priceChangeAmount,
    priceChangePercent,
    highestSpendVehicle,
    mostUsedStation,
    bangchakRegularFuelUsagePercent,
    vehicleRows,
    stationRows,
    trendRows: summarizeTrend(logs),
    needsAttention: logs.filter((log) => log.qualityStatus === "attention" || log.issues.includes("unchecked_receipt")),
    qualityCounts,
    statusCounts,
    executiveSummary: [
      `Fuel spend totalled ${totalSpend.toLocaleString("en-GB", { maximumFractionDigits: 0 })} baht across ${logs.length.toLocaleString("en-GB")} fuel logs.`,
      `Spend ${spendMovement}${spendChangeAmount == null ? "." : ` by ${Math.abs(spendChangeAmount).toLocaleString("en-GB", { maximumFractionDigits: 0 })} baht versus the previous equivalent period.`}`,
      `The weighted average fuel price ${priceMovement}${priceChangeAmount == null ? "." : ` by ${Math.abs(priceChangeAmount).toLocaleString("en-GB", { maximumFractionDigits: 2 })} baht/L.`}`,
      highestSpendVehicle ? `Highest spend vehicle: ${highestSpendVehicle.vehicleReg}.` : "No vehicle spend could be ranked for this selection.",
      issueTotal ? `${issueTotal.toLocaleString("en-GB")} data-quality checks need review.` : "Fuel log data quality checks passed for this selection."
    ],
    whatWeShouldKnow: [
      `Total litres: ${totalLitres.toLocaleString("en-GB", { maximumFractionDigits: 2 })} L.`,
      mostUsedStation ? `Most-used station group: ${mostUsedStation.station}.` : "No station usage available.",
      bangchakRegularFuelUsagePercent == null
        ? "Bangchak regular-fuel usage is not applicable for this selection."
        : `Bangchak regular-fuel usage is ${bangchakRegularFuelUsagePercent.toLocaleString("en-GB", { maximumFractionDigits: 1 })}%.`
    ],
    whatWeShouldReview: [
      `Missing mileage: ${qualityCounts.missing_mileage}`,
      `Unchecked receipts: ${qualityCounts.unchecked_receipt}`,
      `Unusual price entries: ${qualityCounts.unusual_price}`,
      `Possible duplicate entries: ${qualityCounts.possible_duplicate}`,
      `Cost/litre mismatches: ${qualityCounts.cost_litre_mismatch}`,
      `Non-Bangchak regular-fuel exceptions: ${qualityCounts.non_bangchak_regular_fuel}`
    ],
    reconciliationStatus: issueTotal ? "Review required" : "Passed"
  };
}
