/**
 * Release C — null-safe dual-read for Fleet Overview / Monthly / PDF.
 * Legacy Jan–Jul stays on vehicle_monthly_performance.
 * Aug/Sep reads stored V4 draft rows only (never written into legacy KPI table).
 * Incomplete costs stay unknown; balances are not treated as confirmed profit.
 */

import { normalizeComparableText, normalizeVehicleRegistration } from "@/lib/utils";

/** Historical KPI months that remain on the legacy table. */
export const VEHICLE_PERFORMANCE_LEGACY_MONTHS = [1, 2, 3, 4, 5, 6, 7] as const;

/** Months supplied from authorised V4 draft storage after Release B. */
export const VEHICLE_PERFORMANCE_V4_REPORTING_MONTHS = [8, 9] as const;

/** Default Fleet Overview span after Release C (legacy + V4 draft months). */
export const VEHICLE_PERFORMANCE_REPORTING_MONTHS = [
  ...VEHICLE_PERFORMANCE_LEGACY_MONTHS,
  ...VEHICLE_PERFORMANCE_V4_REPORTING_MONTHS
] as const;

export type V4ReportingMonth = (typeof VEHICLE_PERFORMANCE_V4_REPORTING_MONTHS)[number];

export type V4DraftBatchMeta = {
  id: string;
  reportingMonth: string; // YYYY-MM-01
  version: number;
  status: string;
  sourceFileName: string;
  sourceSha256: string;
  salaryVerification: { status?: string; note?: string } | null;
};

export type V4DraftEntryRow = {
  id: string;
  batch_id: string;
  vehicle_id: string | null;
  registration_source: string;
  registration_snapshot: string | null;
  source_sheet: string;
  source_row: number;
  salary: number | null;
  jobs_completed: number | null;
  trip_payments: number | null;
  expenses: number | null;
  parking_fees: number | null;
  total_received: number | null;
  fuel: number | null;
  lpg: number | null;
  lpg_treatment: "included_in_fuel" | "separate" | "unknown";
  maintenance: number | null;
};

export type V4FinancialReportingRow = {
  year: number;
  month: number;
  reportingMonth: string;
  registration: string;
  vehicleId: string | null;
  sourceBatchId: string;
  sourceStatus: string;
  sourceFileName: string;
  sourceSha256: string;
  salaryProvisional: boolean;
  dataProvenance: "v4_draft_source";
  publicationLabel: "stored_draft_not_published";
  salary: number | null;
  jobs: number | null;
  tripPayments: number | null;
  expenses: number | null;
  parkingFees: number | null;
  totalReceived: number | null;
  fuel: number | null;
  lpg: number | null;
  lpgTreatment: V4DraftEntryRow["lpg_treatment"];
  maintenance: number | null;
  incompleteFields: string[];
  financiallyComplete: boolean;
  /** Null when any required cost is unknown — never invent confirmed profit. */
  indicativeRecordedBalance: number | null;
  indicativeMarginPercent: number | null;
};

const REQUIRED_COMPLETE_FIELDS = [
  "salary",
  "tripPayments",
  "expenses",
  "parkingFees",
  "totalReceived",
  "fuel",
  "maintenance"
] as const;

export function isV4ReportingMonth(month: number): month is V4ReportingMonth {
  return (VEHICLE_PERFORMANCE_V4_REPORTING_MONTHS as readonly number[]).includes(month);
}

export function isLegacyReportingMonth(month: number): boolean {
  return (VEHICLE_PERFORMANCE_LEGACY_MONTHS as readonly number[]).includes(month);
}

export function reportingMonthFromDate(date: string): { year: number; month: number } | null {
  const match = /^(\d{4})-(\d{2})-01$/.exec(String(date || "").trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return null;
  return { year, month };
}

function isKnownAmount(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value);
}

export function incompleteFieldsForV4Entry(entry: Pick<
  V4DraftEntryRow,
  "salary" | "trip_payments" | "expenses" | "parking_fees" | "total_received" | "fuel" | "maintenance" | "lpg" | "lpg_treatment"
>): string[] {
  const missing: string[] = [];
  if (!isKnownAmount(entry.salary)) missing.push("salary");
  if (!isKnownAmount(entry.trip_payments)) missing.push("tripPayments");
  if (!isKnownAmount(entry.expenses)) missing.push("expenses");
  if (!isKnownAmount(entry.parking_fees)) missing.push("parkingFees");
  if (!isKnownAmount(entry.total_received)) missing.push("totalReceived");
  if (!isKnownAmount(entry.fuel)) missing.push("fuel");
  if (!isKnownAmount(entry.maintenance)) missing.push("maintenance");
  if (entry.lpg_treatment === "unknown" && !isKnownAmount(entry.lpg)) missing.push("lpg");
  return missing;
}

export function isV4EntryFinanciallyComplete(entry: Parameters<typeof incompleteFieldsForV4Entry>[0]): boolean {
  return incompleteFieldsForV4Entry(entry).length === 0;
}

/** Null-safe balance: returns null if any required cost/revenue field is unknown. */
export function nullSafeIndicativeBalance(input: {
  totalReceived: number | null;
  salary: number | null;
  tripPayments: number | null;
  expenses: number | null;
  parkingFees: number | null;
  fuel: number | null;
  lpg: number | null;
  lpgTreatment: V4DraftEntryRow["lpg_treatment"];
  maintenance: number | null;
}): { balance: number | null; marginPercent: number | null; incompleteFields: string[] } {
  const incompleteFields = incompleteFieldsForV4Entry({
    salary: input.salary,
    trip_payments: input.tripPayments,
    expenses: input.expenses,
    parking_fees: input.parkingFees,
    total_received: input.totalReceived,
    fuel: input.fuel,
    maintenance: input.maintenance,
    lpg: input.lpg,
    lpg_treatment: input.lpgTreatment
  });
  if (incompleteFields.length) {
    return { balance: null, marginPercent: null, incompleteFields };
  }
  const lpgCost = input.lpgTreatment === "separate" ? Number(input.lpg || 0) : 0;
  const costs =
    Number(input.salary) +
    Number(input.tripPayments) +
    Number(input.expenses) +
    Number(input.parkingFees) +
    Number(input.fuel) +
    lpgCost +
    Number(input.maintenance);
  const balance = Number(input.totalReceived) - costs;
  const marginPercent = Number(input.totalReceived) > 0 ? (balance / Number(input.totalReceived)) * 100 : null;
  return { balance, marginPercent, incompleteFields: [] };
}

export function mapV4DraftEntryToReportingRow(
  entry: V4DraftEntryRow,
  batch: V4DraftBatchMeta
): V4FinancialReportingRow | null {
  const period = reportingMonthFromDate(batch.reportingMonth);
  if (!period || !isV4ReportingMonth(period.month)) return null;

  const registration = normalizeVehicleRegistration(
    entry.registration_snapshot || entry.registration_source || ""
  );
  if (!registration) return null;

  const salaryProvisional = /provisional/i.test(String(batch.salaryVerification?.status ?? ""));
  const metrics = nullSafeIndicativeBalance({
    totalReceived: entry.total_received,
    salary: entry.salary,
    tripPayments: entry.trip_payments,
    expenses: entry.expenses,
    parkingFees: entry.parking_fees,
    fuel: entry.fuel,
    lpg: entry.lpg,
    lpgTreatment: entry.lpg_treatment,
    maintenance: entry.maintenance
  });

  return {
    year: period.year,
    month: period.month,
    reportingMonth: batch.reportingMonth,
    registration,
    vehicleId: entry.vehicle_id,
    sourceBatchId: batch.id,
    sourceStatus: batch.status,
    sourceFileName: batch.sourceFileName,
    sourceSha256: batch.sourceSha256,
    salaryProvisional,
    dataProvenance: "v4_draft_source",
    publicationLabel: "stored_draft_not_published",
    salary: entry.salary,
    jobs: entry.jobs_completed,
    tripPayments: entry.trip_payments,
    expenses: entry.expenses,
    parkingFees: entry.parking_fees,
    totalReceived: entry.total_received,
    fuel: entry.fuel,
    lpg: entry.lpg,
    lpgTreatment: entry.lpg_treatment,
    maintenance: entry.maintenance,
    incompleteFields: metrics.incompleteFields,
    financiallyComplete: metrics.incompleteFields.length === 0,
    indicativeRecordedBalance: metrics.balance,
    indicativeMarginPercent: metrics.marginPercent
  };
}

export function mapV4DraftBatchToReportingRows(
  batch: V4DraftBatchMeta,
  entries: V4DraftEntryRow[]
): V4FinancialReportingRow[] {
  return entries
    .map((entry) => mapV4DraftEntryToReportingRow(entry, batch))
    .filter((row): row is V4FinancialReportingRow => Boolean(row));
}

/**
 * Legacy-compatible projection for complete V4 rows only.
 * Incomplete rows are omitted from confirmed KPI aggregation — callers must
 * keep them available for display with unknown markers separately.
 */
export function completeV4RowsAsLegacyCompatible(rows: V4FinancialReportingRow[]): Array<{
  id: string;
  user_id: null;
  vehicle_id: string | null;
  year: number;
  month: number;
  vehicle_registration: string;
  salary_cost: number;
  trip_income: number;
  other_expenses: number;
  gross_revenue: number;
  lpg_cost: number;
  notes: string;
  created_at: string;
  updated_at: string;
  created_by: null;
  updated_by: null;
  financiallyComplete: true;
  dataProvenance: "v4_draft_source";
  salaryProvisional: boolean;
}> {
  return rows.filter((row) => row.financiallyComplete).map((row) => {
    const lpgCost = row.lpgTreatment === "separate" ? Number(row.lpg || 0) : 0;
    const otherExpenses = Number(row.expenses) + Number(row.parkingFees) + Number(row.maintenance);
    return {
      id: `v4-draft:${row.sourceBatchId}:${row.registration}:${row.month}`,
      user_id: null,
      vehicle_id: row.vehicleId,
      year: row.year,
      month: row.month,
      vehicle_registration: row.registration,
      salary_cost: Number(row.salary),
      trip_income: Number(row.tripPayments),
      other_expenses: otherExpenses,
      gross_revenue: Number(row.totalReceived),
      lpg_cost: lpgCost,
      notes: row.salaryProvisional
        ? "V4 stored draft · September salary provisional · not published KPI"
        : "V4 stored draft source · not published / not approved accounting profit",
      created_at: "",
      updated_at: "",
      created_by: null,
      updated_by: null,
      financiallyComplete: true as const,
      dataProvenance: "v4_draft_source" as const,
      salaryProvisional: row.salaryProvisional
    };
  });
}

export function rankCompleteV4Rows<T extends { financiallyComplete: boolean; indicativeRecordedBalance: number | null }>(
  rows: T[],
  direction: "strongest" | "weakest" = "strongest"
): T[] {
  const complete = rows.filter(
    (row) => row.financiallyComplete && row.indicativeRecordedBalance != null && Number.isFinite(row.indicativeRecordedBalance)
  );
  const sorted = [...complete].sort((left, right) =>
    direction === "strongest"
      ? Number(right.indicativeRecordedBalance) - Number(left.indicativeRecordedBalance)
      : Number(left.indicativeRecordedBalance) - Number(right.indicativeRecordedBalance)
  );
  // Disjoint strongest/weakest halves when both ends are requested by callers.
  const limit = Math.max(1, Math.floor(sorted.length / 2));
  return sorted.slice(0, Math.min(5, limit));
}

export function tenColumnHeaders(): string[] {
  return [
    "Registration",
    "Salary",
    "Jobs",
    "Trip Payments",
    "Expenses",
    "Parking Fees",
    "Total Received",
    "Fuel",
    "LPG",
    "Maintenance"
  ];
}

export function formatNullableAmount(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return String(value);
}

export function v4RowToTenColumnValues(row: V4FinancialReportingRow): string[] {
  return [
    row.registration,
    formatNullableAmount(row.salary) + (row.salaryProvisional ? " (provisional)" : ""),
    formatNullableAmount(row.jobs),
    formatNullableAmount(row.tripPayments),
    formatNullableAmount(row.expenses),
    formatNullableAmount(row.parkingFees),
    formatNullableAmount(row.totalReceived),
    formatNullableAmount(row.fuel),
    formatNullableAmount(row.lpg),
    formatNullableAmount(row.maintenance)
  ];
}

export function registrationKey(value: string): string {
  return normalizeComparableText(normalizeVehicleRegistration(value));
}

export function partitionReportingMonths(months: number[]): {
  legacyMonths: number[];
  v4Months: V4ReportingMonth[];
} {
  const unique = [...new Set(months)].filter((month) => Number.isInteger(month) && month >= 1 && month <= 12);
  return {
    legacyMonths: unique.filter(isLegacyReportingMonth),
    v4Months: unique.filter(isV4ReportingMonth) as V4ReportingMonth[]
  };
}

export function assertRequiredCompleteFieldNames(): readonly string[] {
  return REQUIRED_COMPLETE_FIELDS;
}
