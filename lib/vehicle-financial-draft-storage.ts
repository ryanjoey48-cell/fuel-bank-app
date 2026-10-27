import { createHash } from "node:crypto";
import type { FinancialField, FinancialValues } from "@/lib/vehicle-financial-draft";

const amountFields: FinancialField[] = ["salary", "tripPayments", "expenses", "parking", "totalReceived", "fuel", "lpg", "maintenance"];

export function satangToBaht(value: number | null) {
  return value === null ? null : value / 100;
}

export function financialValuesToStorage(values: FinancialValues) {
  return {
    salary: satangToBaht(values.salary),
    jobs_completed: values.jobs,
    trip_payments: satangToBaht(values.tripPayments),
    expenses: satangToBaht(values.expenses),
    parking_fees: satangToBaht(values.parking),
    total_received: satangToBaht(values.totalReceived),
    fuel: satangToBaht(values.fuel),
    lpg: satangToBaht(values.lpg),
    maintenance: satangToBaht(values.maintenance)
  };
}

/** Stable JSON shape for a server-generated immutable content fingerprint. */
export function hashFinancialDraftContent(value: unknown) {
  const stable = (item: unknown): string => {
    if (Array.isArray(item)) return `[${item.map(stable).join(",")}]`;
    if (item && typeof item === "object") {
      const record = item as Record<string, unknown>;
      return `{${Object.keys(record).filter(key => record[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${stable(record[key])}`).join(",")}}`;
    }
    return JSON.stringify(item) ?? "null";
  };
  return createHash("sha256").update(stable(value), "utf8").digest("hex");
}

export function sourceTotalsForStorage(totals: Partial<Record<FinancialField, unknown>>) {
  return Object.fromEntries(Object.entries(totals).map(([field, value]) => {
    const financialField = field as FinancialField;
    return [financialField, financialField === "jobs" ? value : value == null || value === "" ? null : Number(value)];
  }));
}

export function financialDraftEntryPayload(row: {
  vehicleId: string | null;
  registration: string;
  values: FinancialValues;
  lpgTreatment: string;
  raw: { cells: unknown[]; rawCells?: unknown[]; sheet: string; row: number; employeeId?: string; assignmentEffectiveFrom?: string; assignmentEffectiveTo?: string };
}, canonicalRegistration: string | null, driverIds: Set<string>) {
  const amounts = financialValuesToStorage(row.values);
  return {
    vehicle_id: row.vehicleId,
    registration_source: row.registration,
    registration_snapshot: canonicalRegistration,
    assigned_employee_id: row.raw.employeeId && driverIds.has(row.raw.employeeId) ? row.raw.employeeId : null,
    assigned_employee_name_snapshot: null,
    assignment_effective_from: row.raw.assignmentEffectiveFrom || null,
    assignment_effective_to: row.raw.assignmentEffectiveTo || null,
    source_sheet: row.raw.sheet,
    source_row: row.raw.row,
    source_values: Object.fromEntries(["registration", "salary", "jobs", "tripPayments", "expenses", "parking", "totalReceived", "fuel", "lpg", "maintenance"].map((key, index) => [key, row.raw.cells[index]])),
    // source_values is the exact ten-column raw report evidence; do not duplicate it
    // or retain unmapped workbook cells in a second JSON payload.
    raw_cells: [],
    ...amounts,
    lpg_treatment: row.lpgTreatment
  };
}
