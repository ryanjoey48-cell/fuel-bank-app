/**
 * Build idempotent V4 draft import payloads from authorised Aug/Sep preview JSON.
 * Local/synthetic use only until a separately approved write unlock + migration apply.
 * Never writes to vehicle_monthly_performance.
 */

import { createHash } from "node:crypto";
import { hashFinancialDraftContent } from "@/lib/vehicle-financial-draft-storage";
import {
  findV4SourceVehicleMapping,
  resolveV4SourceVehicleMatch
} from "@/lib/vehicle-financial-v4-source-matching";
import { formatVehicleRegistrationDisplay } from "@/lib/vehicle-identity";

export type PreviewSourceRow = {
  registration: string;
  salary: string | null;
  jobs: string | null;
  tripPayments: string | null;
  expenses: string | null;
  parkingFees: string | null;
  totalReceived: string | null;
  fuel: string | null;
  lpg: string | null;
  maintenance: string | null;
  sourceRow?: number;
  lpgBasis?: string;
  sourceDashStatus?: Record<string, string>;
};

export type PreviewSourceReport = {
  reportingMonth: string;
  sourceFile: string;
  sourceSha256: string;
  salaryStatus?: string;
  rowCount: number;
  rows: PreviewSourceRow[];
  sourceFooterTotals: Record<string, string | null>;
};

export type SourceImportVehicle = { id: string; vehicle_reg: string };

export type DraftImportEntryPayload = {
  vehicle_id: string | null;
  registration_source: string;
  registration_snapshot: string | null;
  assigned_employee_id: null;
  assigned_employee_name_snapshot: null;
  assignment_effective_from: null;
  assignment_effective_to: null;
  source_sheet: string;
  source_row: number;
  source_values: Record<string, string | null>;
  raw_cells: [];
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

export type DraftImportBatchPayload = {
  reporting_month: string;
  version: number;
  status: "draft";
  source_file_name: string;
  source_sha256: string;
  source_format: "csv";
  source_size_bytes: number;
  source_sheets: string[];
  formula_reference: string;
  formula_version: string;
  source_totals: Record<string, number | null>;
  source_controls: Array<{ kind: string; sheet: string; row: number; values: unknown[] }>;
  expected_vehicle_ids: string[];
  validation_snapshot: Record<string, unknown>;
  idempotency_hash: string;
  content_hash: string;
  historical_correction: null;
  salary_verification: Record<string, unknown> | null;
};

export type BuiltSourceImport = {
  reportingMonth: string;
  batch: DraftImportBatchPayload;
  entries: DraftImportEntryPayload[];
  reconciliation: {
    rowCount: number;
    controlTotals: Record<string, number | null>;
    unknownFieldCount: number;
    mapped4565VehicleId: string | null;
    lpgVehicleRegistration: string | null;
  };
};

const LPG_VEHICLE_KEY = "ฒอ8453";
const CONTROL_FIELDS = [
  "salary",
  "jobs",
  "tripPayments",
  "expenses",
  "parkingFees",
  "totalReceived",
  "fuel",
  "lpg",
  "maintenance"
] as const;

function registrationKey(value: string) {
  return value.normalize("NFKC").trim().replace(/[\s-]/g, "").toLowerCase();
}

function isLpgVehicle(registration: string) {
  return registrationKey(registration) === LPG_VEHICLE_KEY;
}

/** Parse preview amount strings. Blanks/dashes stay null — never coerced to zero. */
export function parsePreviewAmount(value: string | null | undefined): number | null {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  if (!/^-?\d+(?:\.\d+)?$/.test(raw)) return null;
  const amount = Number(raw);
  return Number.isFinite(amount) ? amount : null;
}

export function resolvePreviewLpgTreatment(
  row: PreviewSourceRow,
  reportingMonth: string
): "included_in_fuel" | "separate" | "unknown" {
  const month = Number(String(reportingMonth).slice(5, 7));
  if (isLpgVehicle(row.registration)) {
    if (month >= 8) return "separate";
    return "included_in_fuel";
  }
  if (row.sourceDashStatus?.lpg === "unresolved_source_dash" && row.lpg == null) {
    return "unknown";
  }
  if (row.lpgBasis === "confirmed_non_lpg_zero" || row.sourceDashStatus?.lpg === "confirmed_zero_by_owner_rule") {
    return "separate";
  }
  if (row.lpg == null) return "unknown";
  return "separate";
}

function lpgAmountForStorage(row: PreviewSourceRow, treatment: "included_in_fuel" | "separate" | "unknown") {
  if (treatment === "included_in_fuel") return null;
  if (treatment === "unknown") return null;
  if (row.lpg == null && row.sourceDashStatus?.lpg === "confirmed_zero_by_owner_rule") return 0;
  return parsePreviewAmount(row.lpg);
}

function reportingMonthDate(reportingMonth: string) {
  return `${reportingMonth}-01`;
}

function sourceTotalsFromFooter(footer: Record<string, string | null>) {
  return {
    salary: parsePreviewAmount(footer.salary),
    jobs: parsePreviewAmount(footer.jobs),
    tripPayments: parsePreviewAmount(footer.tripPayments),
    expenses: parsePreviewAmount(footer.expenses),
    parking: parsePreviewAmount(footer.parkingFees),
    totalReceived: parsePreviewAmount(footer.totalReceived),
    fuel: parsePreviewAmount(footer.fuel),
    lpg: parsePreviewAmount(footer.lpg),
    maintenance: parsePreviewAmount(footer.maintenance)
  };
}

function countUnknownFields(row: PreviewSourceRow) {
  return CONTROL_FIELDS.filter((field) => {
    if (field === "parkingFees") return row.parkingFees == null;
    return row[field] == null;
  }).length;
}

export function buildVehicleFinancialV4SourceImport(
  report: PreviewSourceReport,
  options?: {
    vehicles?: SourceImportVehicle[];
    version?: number;
    actorNote?: string;
  }
): BuiltSourceImport {
  const vehicles = options?.vehicles ?? [];
  const version = options?.version ?? 1;
  const entries: DraftImportEntryPayload[] = report.rows.map((row) => {
    const match = resolveV4SourceVehicleMatch(row.registration, vehicles);
    const mapping = findV4SourceVehicleMapping(row.registration);
    const treatment = resolvePreviewLpgTreatment(row, report.reportingMonth);
    const display = formatVehicleRegistrationDisplay(row.registration);
    return {
      vehicle_id: match.vehicleId ?? mapping?.canonicalVehicleId ?? null,
      registration_source: row.registration,
      registration_snapshot: match.canonicalRegistration ?? mapping?.canonicalRegistration ?? display,
      assigned_employee_id: null,
      assigned_employee_name_snapshot: null,
      assignment_effective_from: null,
      assignment_effective_to: null,
      source_sheet: "AuthorisedPreview",
      source_row: row.sourceRow ?? 0,
      source_values: {
        registration: row.registration,
        salary: row.salary,
        jobs: row.jobs,
        tripPayments: row.tripPayments,
        expenses: row.expenses,
        parking: row.parkingFees,
        totalReceived: row.totalReceived,
        fuel: row.fuel,
        lpg: row.lpg,
        maintenance: row.maintenance
      },
      raw_cells: [],
      salary: parsePreviewAmount(row.salary),
      jobs_completed: parsePreviewAmount(row.jobs),
      trip_payments: parsePreviewAmount(row.tripPayments),
      expenses: parsePreviewAmount(row.expenses),
      parking_fees: parsePreviewAmount(row.parkingFees),
      total_received: parsePreviewAmount(row.totalReceived),
      fuel: parsePreviewAmount(row.fuel),
      lpg: lpgAmountForStorage(row, treatment),
      lpg_treatment: treatment,
      maintenance: parsePreviewAmount(row.maintenance)
    };
  });

  const sourceTotals = sourceTotalsFromFooter(report.sourceFooterTotals);
  const salaryProvisional = /provisional/i.test(report.salaryStatus ?? "");
  const expectedVehicleIds = [...new Set(entries.map((entry) => entry.vehicle_id).filter((id): id is string => Boolean(id)))];
  const contentBody = {
    reportingMonth: report.reportingMonth,
    sourceSha256: report.sourceSha256,
    sourceTotals,
    entries: entries.map((entry) => ({
      registration_source: entry.registration_source,
      source_row: entry.source_row,
      salary: entry.salary,
      jobs_completed: entry.jobs_completed,
      trip_payments: entry.trip_payments,
      expenses: entry.expenses,
      parking_fees: entry.parking_fees,
      total_received: entry.total_received,
      fuel: entry.fuel,
      lpg: entry.lpg,
      lpg_treatment: entry.lpg_treatment,
      maintenance: entry.maintenance,
      source_values: entry.source_values
    }))
  };
  const contentHash = hashFinancialDraftContent(contentBody);
  const idempotencyHash = createHash("sha256")
    .update(`v4-source-import|${report.reportingMonth}|${report.sourceSha256}|${contentHash}`, "utf8")
    .digest("hex");

  const mapped4565 = entries.find((entry) => registrationKey(entry.registration_source).endsWith("4565"));
  const lpgEntry = entries.find((entry) => isLpgVehicle(entry.registration_source));

  const batch: DraftImportBatchPayload = {
    reporting_month: reportingMonthDate(report.reportingMonth),
    version,
    status: "draft",
    source_file_name: `${report.sourceFile} · authorised preview JSON transcription`,
    source_sha256: report.sourceSha256,
    source_format: "csv",
    source_size_bytes: Buffer.byteLength(JSON.stringify(contentBody), "utf8"),
    source_sheets: ["AuthorisedPreview"],
    formula_reference:
      options?.actorNote ??
      "Authorised V4 preview JSON transcription for draft storage only. Not approved accounting policy. Not live KPI publication.",
    formula_version: "vehicle-finance-v4-v1",
    source_totals: sourceTotals,
    source_controls: [
      {
        kind: "printed_source_footer",
        sheet: "AuthorisedPreview",
        row: 0,
        values: CONTROL_FIELDS.map((field) => report.sourceFooterTotals[field] ?? null)
      }
    ],
    expected_vehicle_ids: expectedVehicleIds,
    validation_snapshot: {
      readyForReview: false,
      fleetRosterConfirmed: false,
      source: "authorised_preview_json",
      liveKpiEligible: false,
      publicationEnabled: false,
      salaryStatus: report.salaryStatus ?? null,
      issues: salaryProvisional
        ? [{ code: "september_salary_verification_required", field: "salary" }]
        : [],
      reviewWarnings: salaryProvisional
        ? [{ code: "provisional_carried_forward_pending_september_payroll", field: "salary" }]
        : []
    },
    idempotency_hash: idempotencyHash,
    content_hash: contentHash,
    historical_correction: null,
    salary_verification: salaryProvisional
      ? {
          status: "provisional",
          note: "September salary remains provisional pending independent payroll verification",
          sourceStatus: report.salaryStatus ?? null
        }
      : null
  };

  return {
    reportingMonth: report.reportingMonth,
    batch,
    entries,
    reconciliation: {
      rowCount: entries.length,
      controlTotals: {
        salary: sourceTotals.salary,
        jobs: sourceTotals.jobs,
        tripPayments: sourceTotals.tripPayments,
        expenses: sourceTotals.expenses,
        parkingFees: sourceTotals.parking,
        totalReceived: sourceTotals.totalReceived,
        fuel: sourceTotals.fuel,
        lpg: sourceTotals.lpg,
        maintenance: sourceTotals.maintenance
      },
      unknownFieldCount: report.rows.reduce((sum, row) => sum + countUnknownFields(row), 0),
      mapped4565VehicleId: mapped4565?.vehicle_id ?? null,
      lpgVehicleRegistration: lpgEntry?.registration_source ?? null
    }
  };
}

export function assertSourceImportReconciliation(
  report: PreviewSourceReport,
  built: BuiltSourceImport
) {
  if (built.entries.length !== report.rowCount) {
    throw new Error(`row_count_mismatch:${built.entries.length}:${report.rowCount}`);
  }
  if (built.entries.length !== report.rows.length) {
    throw new Error(`row_length_mismatch`);
  }
  for (const field of CONTROL_FIELDS) {
    const expected = parsePreviewAmount(report.sourceFooterTotals[field]);
    const actualKey = field === "parkingFees" ? "parkingFees" : field;
    const actual = built.reconciliation.controlTotals[actualKey];
    if (expected !== actual) {
      throw new Error(`control_mismatch:${field}:${String(expected)}:${String(actual)}`);
    }
  }
  for (let index = 0; index < report.rows.length; index += 1) {
    const source = report.rows[index];
    const entry = built.entries[index];
    const checks: Array<[string | null, number | null, string]> = [
      [source.salary, entry.salary, "salary"],
      [source.jobs, entry.jobs_completed, "jobs"],
      [source.tripPayments, entry.trip_payments, "tripPayments"],
      [source.expenses, entry.expenses, "expenses"],
      [source.parkingFees, entry.parking_fees, "parkingFees"],
      [source.totalReceived, entry.total_received, "totalReceived"],
      [source.fuel, entry.fuel, "fuel"],
      [source.maintenance, entry.maintenance, "maintenance"]
    ];
    for (const [raw, stored, label] of checks) {
      const parsed = parsePreviewAmount(raw);
      if (parsed !== stored) {
        throw new Error(`row_mismatch:${source.registration}:${label}:${String(parsed)}:${String(stored)}`);
      }
      if (raw == null && stored !== null) {
        throw new Error(`unknown_coerced:${source.registration}:${label}`);
      }
    }
  }
}
