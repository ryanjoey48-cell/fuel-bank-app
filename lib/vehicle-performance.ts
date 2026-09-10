import { normalizeComparableText, normalizeVehicleRegistration } from "@/lib/utils";
import { canonicalizeKnownVehicleRegistration } from "@/lib/vehicle-identity";
import type { Vehicle, VehicleMonthlyPerformance, VehiclePerformanceImportReview } from "@/types/database";

export type VehicleFuelSpendRow = {
  vehicleRegistration: string;
  year: number;
  month: number;
  fuelSpend: number;
  fuelLogCount?: number;
  monthStart?: string;
  monthEnd?: string;
};

export type VehiclePerformanceRow = {
  statusReason?: string;
  vehicleRegistration: string;
  grossRevenue: number;
  fuelSpend: number;
  lpgCost: number;
  salaryCost: number;
  tripIncome: number;
  otherExpenses: number;
  totalDirectCosts: number;
  recordedBalance: number;
  marginPercent: number | null;
  fuelPercent: number | null;
  status: "strong" | "stable" | "monitor" | "needsAttention";
};

export type VehiclePerformanceSummary = {
  grossRevenue: number;
  fuelSpend: number;
  lpgCost: number;
  salaryCost: number;
  tripIncome: number;
  otherExpenses: number;
  totalDirectCosts: number;
  recordedBalance: number;
  marginPercent: number | null;
  fuelPercent: number | null;
};

export type VehiclePerformanceMonthlyTrendRow = VehiclePerformanceSummary & {
  month: number;
};

export type VehiclePerformanceMonthlyPerformanceRow = VehiclePerformanceSummary & {
  month: number;
  recordCount: number;
  vehicleCount: number;
  status: "complete" | "partial" | "missing";
};

export const performanceThresholds = {
  attention: {
    negativeRecordedBalance: true,
    minMarginPercent: 35,
    maxFuelPercent: 45
  },
  strong: {
    minMarginPercent: 52,
    maxFuelPercent: 35
  },
  stable: {
    minMarginPercent: 48,
    maxFuelPercent: 40
  },
  monitor: {
    description: "Still profitable and operating acceptably, but below Stable fleet thresholds."
  }
} as const;

export const VEHICLE_PERFORMANCE_STATUS_RULES = {
  strongMarginPercent: performanceThresholds.strong.minMarginPercent,
  strongMaxFuelPercent: performanceThresholds.strong.maxFuelPercent,
  stableMarginPercent: performanceThresholds.stable.minMarginPercent,
  stableMaxFuelPercent: performanceThresholds.stable.maxFuelPercent,
  needsAttentionMinMarginPercent: performanceThresholds.attention.minMarginPercent,
  needsAttentionMaxFuelPercent: performanceThresholds.attention.maxFuelPercent
} as const;

export type VehiclePerformanceImportStatus =
  | "Ready"
  | "Approved"
  | "Imported"
  | "Existing"
  | "Historical fuel difference"
  | "Correction required"
  | "Resolved"
  | "Review required again"
  | "Fuel data missing"
  | "Fuel warning"
  | "Vehicle not matched"
  | "Duplicate"
  | "Skipped"
  | "Needs review";

export type VehiclePerformanceImportRow = {
  id: string;
  status: VehiclePerformanceImportStatus;
  reason: string;
  year: number | null;
  month: number | null;
  vehicleRegistration: string;
  canonicalVehicleRegistration: string;
  grossRevenue: number;
  salaryCost: number;
  tripIncome: number;
  otherExpenses: number;
  lpgCost: number;
  excelFuel: number | null;
  appFuel: number | null;
  fuelDifference: number | null;
  calculatedBalance: number | null;
  fuelLogCount: number | null;
  fuelMatchMonthStart: string | null;
  fuelMatchMonthEnd: string | null;
  existingRecordId: string | null;
  sourceSheet: string;
  sourceRowNumber: number;
  savedReview?: Pick<
    VehiclePerformanceImportReview,
    | "review_status"
    | "excel_fuel"
    | "app_fuel_at_review"
    | "fuel_difference_at_review"
    | "review_note"
    | "reviewed_at"
    | "reviewed_by"
    | "source_sheet"
    | "source_row_number"
    | "source_row_key"
  > | null;
};

const REVIEW_FUEL_STALE_TOLERANCE_THB = 0.01;

export type WorksheetRows = {
  sheetName: string;
  rows: unknown[][];
};

const FUEL_READY_TOLERANCE_THB = 100;
const FUEL_WARNING_TOLERANCE_THB = 500;

function isHistoricalStatementFuelReference(year: number, month: number) {
  return year === 2026 && (month === 1 || month === 2);
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function monthDateRange(year: number, month: number) {
  const monthPart = String(month).padStart(2, "0");
  const lastDay = String(daysInMonth(year, month)).padStart(2, "0");
  return {
    fromDate: `${year}-${monthPart}-01`,
    toDate: `${year}-${monthPart}-${lastDay}`
  };
}

const MONTH_ALIASES: Array<{ month: number; names: string[] }> = [
  { month: 1, names: ["january", "jan", "มกราคม", "ม.ค."] },
  { month: 2, names: ["february", "feb", "กุมภาพันธ์", "ก.พ."] },
  { month: 3, names: ["march", "mar", "มีนาคม", "มี.ค."] },
  { month: 4, names: ["april", "apr", "เมษายน", "เม.ย."] },
  { month: 5, names: ["may", "พฤษภาคม", "พ.ค."] },
  { month: 6, names: ["june", "jun", "มิถุนายน", "มิ.ย."] },
  { month: 7, names: ["july", "jul", "กรกฎาคม", "ก.ค."] },
  { month: 8, names: ["august", "aug", "สิงหาคม", "ส.ค."] },
  { month: 9, names: ["september", "sep", "กันยายน", "ก.ย."] },
  { month: 10, names: ["october", "oct", "ตุลาคม", "ต.ค."] },
  { month: 11, names: ["november", "nov", "พฤศจิกายน", "พ.ย."] },
  { month: 12, names: ["december", "dec", "ธันวาคม", "ธ.ค."] }
];

const HEADER_ALIASES = {
  vehicle: ["ทะเบียนรถ", "vehicle registration", "vehicle", "registration", "รถ"],
  salary: ["เงินเดือน", "salary"],
  trip: ["ค่าเที่ยว", "trip payments", "trip payment", "trip income"],
  expense: ["ค่าใช้จ่าย", "ค่าใช่จ่าย", "other expenses", "other expense", "expense"],
  revenue: ["รวมรับ", "revenue", "gross revenue"],
  fuel: ["น้ำมัน", "fuel"],
  lpg: ["lpg"],
  other: ["อื่น", "other"],
  balance: ["คงเหลือ", "balance"]
};

function toNumber(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const cleaned = String(value ?? "")
    .replace(/[฿,\s]/g, "")
    .replace(/[()]/g, "-")
    .trim();
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

export function vehiclePerformanceKey(year: number, month: number, vehicleRegistration: string) {
  return `${year}-${month}-${normalizeComparableText(normalizeVehicleRegistration(vehicleRegistration))}`;
}

export function getVehiclePerformanceFuelMap(
  records: Pick<VehicleMonthlyPerformance, "year" | "month" | "vehicle_registration">[],
  fuelRows: VehicleFuelSpendRow[]
) {
  const allowedKeys = new Set(
    records.map((record) => vehiclePerformanceKey(record.year, record.month, record.vehicle_registration))
  );
  const totals = new Map<string, number>();

  for (const fuel of fuelRows) {
    const key = vehiclePerformanceKey(fuel.year, fuel.month, fuel.vehicleRegistration);
    if (!allowedKeys.has(key)) continue;
    totals.set(key, (totals.get(key) ?? 0) + Number(fuel.fuelSpend || 0));
  }

  return totals;
}

export function calculateVehiclePerformanceMetrics(input: {
  grossRevenue: number;
  fuelSpend: number;
  lpgCost: number;
  salaryCost: number;
  tripIncome: number;
  otherExpenses: number;
}): VehiclePerformanceSummary {
  const grossRevenue = Number(input.grossRevenue || 0);
  const fuelSpend = Number(input.fuelSpend || 0);
  const lpgCost = Number(input.lpgCost || 0);
  const salaryCost = Number(input.salaryCost || 0);
  const tripIncome = Number(input.tripIncome || 0);
  const otherExpenses = Number(input.otherExpenses || 0);
  const totalDirectCosts = fuelSpend + salaryCost + tripIncome + otherExpenses;
  const recordedBalance = grossRevenue - totalDirectCosts;

  return {
    grossRevenue,
    fuelSpend,
    lpgCost,
    salaryCost,
    tripIncome,
    otherExpenses,
    totalDirectCosts,
    recordedBalance,
    marginPercent: grossRevenue > 0 ? (recordedBalance / grossRevenue) * 100 : null,
    fuelPercent: grossRevenue > 0 ? (fuelSpend / grossRevenue) * 100 : null
  };
}

export function statusForVehiclePerformance(row: Pick<VehiclePerformanceRow, "recordedBalance" | "marginPercent" | "fuelPercent">): VehiclePerformanceRow["status"] {
  if (
    row.recordedBalance < 0 ||
    (row.marginPercent != null && row.marginPercent < VEHICLE_PERFORMANCE_STATUS_RULES.needsAttentionMinMarginPercent) ||
    (row.fuelPercent != null && row.fuelPercent > VEHICLE_PERFORMANCE_STATUS_RULES.needsAttentionMaxFuelPercent)
  ) {
    return "needsAttention";
  }

  if (
    row.marginPercent != null &&
    row.marginPercent >= VEHICLE_PERFORMANCE_STATUS_RULES.strongMarginPercent &&
    (row.fuelPercent == null || row.fuelPercent <= VEHICLE_PERFORMANCE_STATUS_RULES.strongMaxFuelPercent)
  ) {
    return "strong";
  }

  if (
    row.marginPercent != null &&
    row.marginPercent >= VEHICLE_PERFORMANCE_STATUS_RULES.stableMarginPercent &&
    (row.fuelPercent == null || row.fuelPercent <= VEHICLE_PERFORMANCE_STATUS_RULES.stableMaxFuelPercent)
  ) {
    return "stable";
  }

  return "monitor";
}

export function buildVehiclePerformanceSummary(rows: Array<Pick<
  VehiclePerformanceRow,
  "grossRevenue" | "fuelSpend" | "lpgCost" | "salaryCost" | "tripIncome" | "otherExpenses"
>>) {
  return calculateVehiclePerformanceMetrics(rows.reduce(
    (totals, row) => ({
      grossRevenue: totals.grossRevenue + Number(row.grossRevenue || 0),
      fuelSpend: totals.fuelSpend + Number(row.fuelSpend || 0),
      lpgCost: totals.lpgCost + Number(row.lpgCost || 0),
      salaryCost: totals.salaryCost + Number(row.salaryCost || 0),
      tripIncome: totals.tripIncome + Number(row.tripIncome || 0),
      otherExpenses: totals.otherExpenses + Number(row.otherExpenses || 0)
    }),
    { grossRevenue: 0, fuelSpend: 0, lpgCost: 0, salaryCost: 0, tripIncome: 0, otherExpenses: 0 }
  ));
}

export function buildVehiclePerformanceRows({
  records,
  fuelRows,
  searchQuery = ""
}: {
  records: VehicleMonthlyPerformance[];
  fuelRows: VehicleFuelSpendRow[];
  searchQuery?: string;
}) {
  const fuelMap = getVehiclePerformanceFuelMap(records, fuelRows);
  const groups = new Map<string, VehiclePerformanceRow>();

  for (const record of records) {
    const vehicleRegistration = normalizeVehicleRegistration(record.vehicle_registration);
    const groupKey = normalizeComparableText(vehicleRegistration);
    const fuelKey = vehiclePerformanceKey(record.year, record.month, vehicleRegistration);
    const existing = groups.get(groupKey) ?? {
      vehicleRegistration,
      grossRevenue: 0,
      fuelSpend: 0,
      lpgCost: 0,
      salaryCost: 0,
      tripIncome: 0,
      otherExpenses: 0,
      totalDirectCosts: 0,
      recordedBalance: 0,
      marginPercent: null,
      fuelPercent: null,
      status: "monitor" as const
    };

    existing.grossRevenue += Number(record.gross_revenue || 0);
    existing.fuelSpend += fuelMap.get(fuelKey) ?? 0;
    existing.lpgCost += Number(record.lpg_cost || 0);
    existing.salaryCost += Number(record.salary_cost || 0);
    existing.tripIncome += Number(record.trip_income || 0);
    existing.otherExpenses += Number(record.other_expenses || 0);
    groups.set(groupKey, existing);
  }

  const query = normalizeComparableText(searchQuery);
  return Array.from(groups.values())
    .filter((row) => !query || normalizeComparableText(row.vehicleRegistration).includes(query))
    .map((row) => {
      const calculated = {
        ...row,
        ...calculateVehiclePerformanceMetrics(row)
      };
      return { ...calculated, status: statusForVehiclePerformance(calculated) };
    })
    .sort((left, right) => right.recordedBalance - left.recordedBalance);
}

export function buildVehicleMonthlyTrend(records: VehicleMonthlyPerformance[], fuelRows: VehicleFuelSpendRow[]) {
  const fuelMap = getVehiclePerformanceFuelMap(records, fuelRows);
  const months = new Map<number, VehiclePerformanceMonthlyTrendRow>();

  for (const record of records) {
    const fuelSpend = fuelMap.get(vehiclePerformanceKey(record.year, record.month, record.vehicle_registration)) ?? 0;
    const existing = months.get(record.month);
    const bucket = existing ?? {
      month: record.month,
      ...calculateVehiclePerformanceMetrics({
        grossRevenue: 0,
        fuelSpend: 0,
        lpgCost: 0,
        salaryCost: 0,
        tripIncome: 0,
        otherExpenses: 0
      })
    };

    months.set(record.month, {
      month: record.month,
      ...calculateVehiclePerformanceMetrics({
        grossRevenue: bucket.grossRevenue + Number(record.gross_revenue || 0),
        fuelSpend: bucket.fuelSpend + fuelSpend,
        lpgCost: bucket.lpgCost + Number(record.lpg_cost || 0),
        salaryCost: bucket.salaryCost + Number(record.salary_cost || 0),
        tripIncome: bucket.tripIncome + Number(record.trip_income || 0),
        otherExpenses: bucket.otherExpenses + Number(record.other_expenses || 0)
      })
    });
  }

  return Array.from(months.values()).sort((left, right) => left.month - right.month);
}

export function buildVehicleMonthlyPerformanceRows({
  records,
  fuelRows,
  months,
  expectedVehicleCount
}: {
  records: VehicleMonthlyPerformance[];
  fuelRows: VehicleFuelSpendRow[];
  months: number[];
  expectedVehicleCount: number;
}) {
  const fuelMap = getVehiclePerformanceFuelMap(records, fuelRows);

  return months.map((month) => {
    const monthRecords = records.filter((record) => record.month === month);
    const vehicles = new Set(
      monthRecords.map((record) => normalizeComparableText(normalizeVehicleRegistration(record.vehicle_registration)))
    );
    const totals = calculateVehiclePerformanceMetrics(
      monthRecords.reduce(
        (bucket, record) => {
          const fuelSpend = fuelMap.get(vehiclePerformanceKey(record.year, record.month, record.vehicle_registration)) ?? 0;
          return {
            grossRevenue: bucket.grossRevenue + Number(record.gross_revenue || 0),
            fuelSpend: bucket.fuelSpend + fuelSpend,
            lpgCost: bucket.lpgCost + Number(record.lpg_cost || 0),
            salaryCost: bucket.salaryCost + Number(record.salary_cost || 0),
            tripIncome: bucket.tripIncome + Number(record.trip_income || 0),
            otherExpenses: bucket.otherExpenses + Number(record.other_expenses || 0)
          };
        },
        { grossRevenue: 0, fuelSpend: 0, lpgCost: 0, salaryCost: 0, tripIncome: 0, otherExpenses: 0 }
      )
    );

    return {
      month,
      ...totals,
      recordCount: monthRecords.length,
      vehicleCount: vehicles.size,
      status:
        monthRecords.length === 0
          ? "missing"
          : expectedVehicleCount > 0 && vehicles.size < expectedVehicleCount
            ? "partial"
            : "complete"
    } satisfies VehiclePerformanceMonthlyPerformanceRow;
  });
}

function detectMonth(value: unknown) {
  if (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 12) {
    return value;
  }

  const normalized = normalizeComparableText(text(value));
  if (!normalized) return null;

  if (/^(1[0-2]|0?[1-9])$/.test(normalized)) {
    return Number(normalized);
  }

  for (const { month, names } of MONTH_ALIASES) {
    if (names.some((name) => normalized.includes(normalizeComparableText(name)))) {
      return month;
    }
  }
  if (/\bmonth\b|เดือน/.test(normalized)) {
    const numericMonth = normalized.match(/(?:^|\D)(1[0-2]|0?[1-9])(?:\D|$)/)?.[1];
    return numericMonth ? Number(numericMonth) : null;
  }

  return null;
}

function detectYear(value: unknown, fallbackYear: number) {
  const match = text(value).match(/\b(20\d{2})\b/);
  return match ? Number(match[1]) : fallbackYear;
}

function detectContextYear(value: unknown, fallbackYear: number) {
  if (!detectMonth(value)) return fallbackYear;
  return detectYear(value, fallbackYear);
}

function headerKey(value: unknown) {
  return normalizeComparableText(text(value)).replace(/\s+/g, " ");
}

function findHeaderIndexes(row: unknown[]) {
  const keys = row.map(headerKey);
  const find = (aliases: string[]) =>
    keys.findIndex((key) => aliases.some((alias) => key === normalizeComparableText(alias)));
  const indexes = {
    vehicle: find(HEADER_ALIASES.vehicle),
    salary: find(HEADER_ALIASES.salary),
    trip: find(HEADER_ALIASES.trip),
    expense: find(HEADER_ALIASES.expense),
    revenue: find(HEADER_ALIASES.revenue),
    fuel: find(HEADER_ALIASES.fuel),
    lpg: find(HEADER_ALIASES.lpg)
  };

  return indexes.vehicle >= 0 && indexes.revenue >= 0 ? indexes : null;
}

function isSkippedVehicleLabel(value: string) {
  const normalized = normalizeComparableText(value);
  return !normalized || normalized.includes("dummy") || normalized.includes("total") || normalized.includes("รวม");
}

function getCanonicalVehicleRegistration(
  registration: string,
  vehicleLookup: Map<string, string>
) {
  const canonical = canonicalizeKnownVehicleRegistration(registration, vehicleLookup);
  return vehicleLookup.get(normalizeComparableText(canonical)) ?? "";
}

export function parseVehiclePerformanceWorkbook({
  worksheets,
  vehicles,
  existingRecords,
  fallbackYear = 2026
}: {
  worksheets: WorksheetRows[];
  vehicles: Pick<Vehicle, "vehicle_reg">[];
  existingRecords: Pick<VehicleMonthlyPerformance, "id" | "year" | "month" | "vehicle_registration">[];
  fallbackYear?: number;
}) {
  const vehicleLookup = new Map(
    vehicles
      .map((vehicle) => normalizeVehicleRegistration(vehicle.vehicle_reg))
      .filter(Boolean)
      .map((registration) => [normalizeComparableText(registration), registration])
  );
  const duplicateLookup = new Map(
    existingRecords.map((record) => [
      vehiclePerformanceKey(record.year, record.month, record.vehicle_registration),
      String(record.id)
    ])
  );
  const parsed: VehiclePerformanceImportRow[] = [];

  for (const worksheet of worksheets) {
    let currentMonth = detectMonth(worksheet.sheetName);
    let currentYear = detectYear(worksheet.sheetName, fallbackYear);
    let headerIndexes: ReturnType<typeof findHeaderIndexes> = null;

    worksheet.rows.forEach((row, rowIndex) => {
      const rowMonth = detectMonth(row[0]);
      if (rowMonth) {
        currentMonth = rowMonth;
        currentYear = detectContextYear(row[0], currentYear);
      }

      const nextHeaderIndexes = findHeaderIndexes(row);
      if (nextHeaderIndexes) {
        headerIndexes = nextHeaderIndexes;
        parsed.push(skippedRow(worksheet.sheetName, rowIndex + 1, currentYear, currentMonth, "Header row"));
        return;
      }

      if (!headerIndexes) return;

      const rawRegistration = text(row[headerIndexes.vehicle]);
      if (isSkippedVehicleLabel(rawRegistration)) {
        parsed.push(skippedRow(worksheet.sheetName, rowIndex + 1, currentYear, currentMonth, rawRegistration ? "Non-vehicle row" : "Blank row"));
        return;
      }

      const normalizedRegistration = normalizeVehicleRegistration(rawRegistration);
      const canonicalVehicleRegistration = getCanonicalVehicleRegistration(normalizedRegistration, vehicleLookup);
      const year = currentYear || fallbackYear;
      const month = currentMonth;
      const excelFuel = headerIndexes.fuel >= 0 ? toNumber(row[headerIndexes.fuel]) : null;
      const fuelDateRange = month ? monthDateRange(year, month) : null;
      const baseRow: VehiclePerformanceImportRow = {
        id: `${worksheet.sheetName}-${rowIndex + 1}`,
        status: "Needs review",
        reason: "",
        year,
        month,
        vehicleRegistration: normalizedRegistration,
        canonicalVehicleRegistration,
        grossRevenue: toNumber(row[headerIndexes.revenue]),
        salaryCost: headerIndexes.salary >= 0 ? toNumber(row[headerIndexes.salary]) : 0,
        tripIncome: headerIndexes.trip >= 0 ? toNumber(row[headerIndexes.trip]) : 0,
        otherExpenses: headerIndexes.expense >= 0 ? toNumber(row[headerIndexes.expense]) : 0,
        lpgCost: headerIndexes.lpg >= 0 ? toNumber(row[headerIndexes.lpg]) : 0,
        excelFuel,
        appFuel: null,
        fuelDifference: null,
        calculatedBalance: null,
        fuelLogCount: null,
        fuelMatchMonthStart: fuelDateRange?.fromDate ?? null,
        fuelMatchMonthEnd: fuelDateRange?.toDate ?? null,
        existingRecordId: null,
        sourceSheet: worksheet.sheetName,
        sourceRowNumber: rowIndex + 1
      };

      if (!month) {
        parsed.push({ ...baseRow, status: "Needs review", reason: "Month could not be detected safely." });
        return;
      }

      if (!canonicalVehicleRegistration) {
        parsed.push({ ...baseRow, status: "Vehicle not matched", reason: "Registration does not exactly match an existing vehicle." });
        return;
      }

      const duplicateId = duplicateLookup.get(vehiclePerformanceKey(year, month, canonicalVehicleRegistration)) ?? null;
      parsed.push({
        ...baseRow,
        status: duplicateId ? "Duplicate" : "Ready",
        reason: duplicateId ? "A Vehicle Performance record already exists." : "Ready to import.",
        canonicalVehicleRegistration,
        existingRecordId: duplicateId
      });
    });
  }

  return parsed;
}

export function addAppFuelToImportRows(rows: VehiclePerformanceImportRow[], fuelRows: VehicleFuelSpendRow[]) {
  const fuelMap = new Map<string, { fuelSpend: number; fuelLogCount: number; monthStart: string; monthEnd: string }>();

  for (const fuel of fuelRows) {
    const key = vehiclePerformanceKey(fuel.year, fuel.month, fuel.vehicleRegistration);
    const range = monthDateRange(fuel.year, fuel.month);
    const existing = fuelMap.get(key) ?? {
      fuelSpend: 0,
      fuelLogCount: 0,
      monthStart: range.fromDate,
      monthEnd: range.toDate
    };

    existing.fuelSpend += Number(fuel.fuelSpend || 0);
    existing.fuelLogCount += Number(fuel.fuelLogCount || 0);
    fuelMap.set(key, existing);
  }

  return rows.map((row) => {
    if (!row.year || !row.month || !row.canonicalVehicleRegistration || row.status === "Skipped") return row;
    const range = monthDateRange(row.year, row.month);
    const fuelDetails = fuelMap.get(vehiclePerformanceKey(row.year, row.month, row.canonicalVehicleRegistration));
    const appFuel = fuelDetails?.fuelSpend ?? 0;
    const fuelDifference = appFuel - Number(row.excelFuel || 0);
    const calculatedBalance =
      row.grossRevenue -
      row.salaryCost -
      row.tripIncome -
      row.otherExpenses -
      row.lpgCost -
      appFuel;
    const fuelLogCount = fuelDetails?.fuelLogCount ?? 0;
    const fuelMatchMonthStart = range.fromDate;
    const fuelMatchMonthEnd = range.toDate;
    if (row.status === "Duplicate" || row.status === "Vehicle not matched" || row.status === "Needs review") {
      return { ...row, appFuel, fuelDifference, calculatedBalance, fuelLogCount, fuelMatchMonthStart, fuelMatchMonthEnd };
    }

    const absoluteDifference = Math.abs(fuelDifference);
    const status: VehiclePerformanceImportStatus =
      isHistoricalStatementFuelReference(row.year, row.month) && absoluteDifference > FUEL_READY_TOLERANCE_THB
        ? "Historical fuel difference"
        : Number(row.excelFuel || 0) > 0 && appFuel === 0
        ? "Fuel data missing"
        : absoluteDifference <= FUEL_READY_TOLERANCE_THB
          ? "Ready"
          : absoluteDifference <= FUEL_WARNING_TOLERANCE_THB
            ? "Fuel warning"
            : "Needs review";

    return {
      ...row,
      appFuel,
      fuelDifference,
      calculatedBalance,
      fuelLogCount,
      fuelMatchMonthStart,
      fuelMatchMonthEnd,
      status,
      reason:
        status === "Ready"
          ? "Ready to import."
          : status === "Historical fuel difference"
            ? "January-February fuel figures are historical statement references."
          : status === "Fuel data missing"
            ? "Excel has fuel, but no Fuel Logs matched this vehicle registration and month."
            : status === "Fuel warning"
              ? "Fuel difference is above ฿100 and within ฿500."
              : "Fuel difference is above ฿500."
    };
  });
}

export function evaluateVehiclePerformanceImportStatus(row: Pick<
  VehiclePerformanceImportRow,
  "year" | "month" | "excelFuel" | "appFuel" | "fuelDifference"
>): Pick<VehiclePerformanceImportRow, "status" | "reason"> {
  const year = Number(row.year || 0);
  const month = Number(row.month || 0);
  const fuelDifference = Number(row.fuelDifference || 0);
  const absoluteDifference = Math.abs(fuelDifference);
  const excelFuel = Number(row.excelFuel || 0);
  const appFuel = Number(row.appFuel || 0);
  const status: VehiclePerformanceImportStatus =
    isHistoricalStatementFuelReference(year, month) && absoluteDifference > FUEL_READY_TOLERANCE_THB
      ? "Historical fuel difference"
      : excelFuel > 0 && appFuel === 0
        ? "Fuel data missing"
        : absoluteDifference <= FUEL_READY_TOLERANCE_THB
          ? "Ready"
          : absoluteDifference <= FUEL_WARNING_TOLERANCE_THB
            ? "Fuel warning"
            : "Needs review";

  return {
    status,
    reason:
      status === "Ready"
        ? "Ready to import."
        : status === "Historical fuel difference"
          ? "January-February fuel figures are historical statement references."
          : status === "Fuel data missing"
            ? "Excel has fuel, but no Fuel Logs matched this vehicle registration and month."
            : status === "Fuel warning"
              ? "Fuel difference is above ฿100 and within ฿500."
              : "Fuel difference is above ฿500."
  };
}

export function vehiclePerformanceImportReviewKey(year: number, month: number, vehicleRegistration: string) {
  return `${year}-${month}-${normalizeComparableText(normalizeVehicleRegistration(vehicleRegistration))}`;
}

export function applySavedVehiclePerformanceImportReviews(
  rows: VehiclePerformanceImportRow[],
  reviews: Pick<
    VehiclePerformanceImportReview,
    | "year"
    | "month"
    | "canonical_vehicle_registration"
    | "review_status"
    | "excel_fuel"
    | "app_fuel_at_review"
    | "fuel_difference_at_review"
    | "review_note"
    | "reviewed_at"
    | "reviewed_by"
    | "source_sheet"
    | "source_row_number"
    | "source_row_key"
  >[]
) {
  const reviewByKey = new Map(
    reviews.map((review) => [
      vehiclePerformanceImportReviewKey(review.year, review.month, review.canonical_vehicle_registration),
      review
    ])
  );

  return rows.map((row) => {
    if (!row.year || !row.month || !row.canonicalVehicleRegistration || row.status === "Skipped" || row.status === "Duplicate") {
      return row;
    }

    const review = reviewByKey.get(
      vehiclePerformanceImportReviewKey(row.year, row.month, row.canonicalVehicleRegistration)
    );
    if (!review) return row;

    if (review.review_status === "correction_required") {
      return {
        ...row,
        status: "Correction required" as const,
        reason: review.review_note || "Underlying Fuel Log requires correction before import.",
        savedReview: review
      };
    }

    if (review.review_status !== "approved") {
      return row;
    }

    const currentAppFuel = Number(row.appFuel || 0);
    const reviewedAppFuel = Number(review.app_fuel_at_review || 0);
    const currentExcelFuel = Number(row.excelFuel || 0);
    const reviewedExcelFuel = Number(review.excel_fuel || 0);
    if (
      Math.abs(currentAppFuel - reviewedAppFuel) > REVIEW_FUEL_STALE_TOLERANCE_THB ||
      Math.abs(currentExcelFuel - reviewedExcelFuel) > REVIEW_FUEL_STALE_TOLERANCE_THB
    ) {
      return {
        ...row,
        status: "Review required again" as const,
        reason: "Previously approved - values have changed.",
        savedReview: review
      };
    }

    return {
      ...row,
      status: "Approved" as const,
      reason: review.review_note || "Discrepancy manually reviewed and approved. Saved record uses App Fuel.",
      savedReview: review
    };
  });
}

function skippedRow(sourceSheet: string, sourceRowNumber: number, year: number | null, month: number | null, reason: string): VehiclePerformanceImportRow {
  return {
    id: `${sourceSheet}-${sourceRowNumber}`,
    status: "Skipped",
    reason,
    year,
    month,
    vehicleRegistration: "",
    canonicalVehicleRegistration: "",
    grossRevenue: 0,
    salaryCost: 0,
    tripIncome: 0,
    otherExpenses: 0,
    lpgCost: 0,
    excelFuel: null,
    appFuel: null,
    fuelDifference: null,
    calculatedBalance: null,
    fuelLogCount: null,
    fuelMatchMonthStart: month && year ? monthDateRange(year, month).fromDate : null,
    fuelMatchMonthEnd: month && year ? monthDateRange(year, month).toDate : null,
    existingRecordId: null,
    sourceSheet,
    sourceRowNumber
  };
}
