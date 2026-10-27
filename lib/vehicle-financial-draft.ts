/** V4 Phase 1: pure, local preview only. Never writes or publishes legacy data. */
export const FINANCIAL_COLUMNS = [
  ["registration", "Registration", "ทะเบียนรถ"],
  ["salary", "Salary", "เงินเดือน"],
  ["jobs", "Jobs", "จำนวนงาน"],
  ["tripPayments", "Trip Payments", "ค่าเที่ยว"],
  ["expenses", "Expenses", "ค่าใช้จ่าย"],
  ["parking", "Parking Fees", "ค่าจอดรถ"],
  ["totalReceived", "Total Received", "รวมรับ"],
  ["fuel", "Fuel", "น้ำมัน"],
  ["lpg", "LPG", "LPG"],
  ["maintenance", "Maintenance", "ค่าซ่อมบำรุง"]
] as const;
export type FinancialField = Exclude<typeof FINANCIAL_COLUMNS[number][0], "registration">;
export type FinancialValues = Record<FinancialField, number | null>;
export type ReportStatus = "draft" | "in_review" | "approved" | "published";
export type LpgTreatment = "included_in_fuel" | "separate" | "unknown";
export type SourceRow = {
  cells: unknown[];
  rawCells?: unknown[];
  sheet: string;
  row: number;
  employeeId?: string;
  assignmentEffectiveFrom?: string;
  assignmentEffectiveTo?: string;
  /** Human-reviewed row annotation, stored apart from source cells. */
  lpgTreatment?: LpgTreatment;
};
export type FinancialIssue = { code: string; row?: number; field?: string };
export type FormulaPolicy = {
  status: "approved";
  policyId: string;
  version: "vehicle-finance-v4-v1";
  approvedBy: string;
  approvedAt: string;
  sourceEvidence: string[];
};
/** Resolve the owner-confirmed LPG vehicle through the trusted monthly vehicle
 * roster and its approved aliases. Downstream rules compare canonical vehicle IDs,
 * never the imported registration string. */
export function canonicalLpgVehicleIds(vehicles: { id: string; registration: string; aliases?: string[] }[]) {
  return vehicles.filter(vehicle => [vehicle.registration, ...(vehicle.aliases ?? [])]
    .some(registration => key(registration).replace(/[\s-]/g, "") === LPG_CANONICAL_REGISTRATION_KEY))
    .map(vehicle => vehicle.id);
}
const fields = FINANCIAL_COLUMNS.slice(1).map(column => column[0]) as FinancialField[];
const costFields: FinancialField[] = ["salary", "tripPayments", "expenses", "parking", "fuel", "maintenance"];
const requiredFinancialFields: FinancialField[] = ["salary", "tripPayments", "expenses", "parking", "totalReceived", "fuel", "maintenance"];
const key = (value: string) => value.normalize("NFKC").trim().replace(/\s+/g, " ").toUpperCase();
const LPG_CANONICAL_REGISTRATION_KEY = key("ฒอ-8453").replace(/[\s-]/g, "");
const isCalendarDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

/** Money is integer satang; jobs is an integer. Blank/invalid values stay unknown.
 * Reject rounding, exponents, malformed grouping, negatives and unsafe integers. */
export function parseFinancialValue(value: unknown, jobs = false): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const raw = String(value).trim();
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(raw)) return null;
  const [whole, fraction = ""] = raw.replace(/,/g, "").split(".");
  if (jobs && fraction && Number(fraction) !== 0) return null;
  const parsed = jobs ? Number(whole) : Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/** Salary and expense unknowns withhold profit. Jobs is nonfinancial. LPG is counted
 * only for separate treatment; included-in-Fuel amounts stay recorded but aren't added. */
export function calculateDraftFinancials(values: FinancialValues, lpgTreatment: LpgTreatment, policy?: FormulaPolicy) {
  // A source reference is not an accounting decision. Only the server-controlled,
  // independently approved policy object can enable this calculation.
  if (policy?.status !== "approved" || policy.version !== "vehicle-finance-v4-v1" ||
      !policy.policyId.trim() || !policy.approvedBy.trim() || !policy.approvedAt.trim() ||
      !policy.sourceEvidence.length || policy.sourceEvidence.some(reference => !reference.trim()) || lpgTreatment === "unknown" ||
      requiredFinancialFields.some(field => values[field] === null || !Number.isSafeInteger(values[field]) || values[field]! < 0)) return null;
  if (values.jobs !== null && (!Number.isSafeInteger(values.jobs) || values.jobs < 0)) return null;
  if (values.lpg !== null && (!Number.isSafeInteger(values.lpg) || values.lpg < 0)) return null;
  if (lpgTreatment === "separate" && (values.lpg === null || !Number.isSafeInteger(values.lpg) || values.lpg < 0)) return null;
  const directCost = costFields.reduce((sum, field) => sum + values[field]!, 0) + (lpgTreatment === "separate" ? values.lpg! : 0);
  if (!Number.isSafeInteger(directCost)) return null;
  const revenue = values.totalReceived!;
  const recordedBalance = revenue - directCost;
  return {
    directCost, recordedBalance,
    marginPercent: revenue > 0 ? recordedBalance / revenue * 100 : null,
    fuelSharePercent: revenue > 0 ? values.fuel! / revenue * 100 : null,
    fuelShareBasis: lpgTreatment === "included_in_fuel" ? "fuel_includes_lpg" as const : "fuel_excludes_lpg" as const,
    lpgTreatment
  };
}

export type DraftInput = {
  reportingMonth: string;
  version: number;
  source: { fileName: string; sha256: string; format: "xlsx" | "csv" | "pdf"; pdfReviewed: boolean };
  headers: string[];
  rows: SourceRow[];
  /** Month-specific roster, including approved historical registration aliases. */
  vehicles: { id: string; registration: string; aliases?: string[] }[];
  expectedVehicleIds: string[];
  /** User attests that the selected IDs are the complete roster for this month. */
  fleetRosterConfirmed?: boolean;
  existingVersions: number[];
  publishedVehicleIds: string[];
  sourceTotals: Partial<Record<FinancialField, unknown>>;
  formula?: FormulaPolicy;
  /** Required to make a draft of Jan-Jul. This starts review only; it never edits old rows. */
  historicalCorrection?: { kind?: "correction" | "initial_baseline"; explicitlyRequestedByOwner: boolean; reason: string; evidenceReference?: string; baseVersion?: number; approvedBaseVersion?: number };
  septemberSalaryVerification?: { verified: boolean; evidence: string };
  /** Optional allow-list loaded by the server from the employee directory. */
  employeeIds?: string[];
};

export function previewFinancialDraft(input: DraftInput) {
  const issues: FinancialIssue[] = [];
  const reviewWarnings: FinancialIssue[] = [];
  const issue = (code: string, row?: number, field?: string) => issues.push({ code, row, field });
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(input.reportingMonth)) issue("invalid_month");
  const historicalMonth = input.reportingMonth >= "2026-01" && input.reportingMonth <= "2026-07";
  if (historicalMonth && (!input.historicalCorrection?.explicitlyRequestedByOwner || !input.historicalCorrection.reason.trim())) issue("historical_owner_review_required");
  if (historicalMonth && input.historicalCorrection?.kind === "initial_baseline") {
    if (input.existingVersions.length) issue("historical_baseline_requires_empty_month");
    if (!input.historicalCorrection.evidenceReference?.trim()) issue("historical_baseline_source_required");
  } else if (historicalMonth && (!input.historicalCorrection?.baseVersion || !input.existingVersions.includes(input.historicalCorrection.baseVersion) || input.historicalCorrection.baseVersion !== input.historicalCorrection.approvedBaseVersion)) {
    issue("historical_approved_base_version_required");
  }
  const nextVersion = Math.max(0, ...input.existingVersions) + 1;
  if (!Number.isSafeInteger(input.version) || input.version !== nextVersion || input.existingVersions.includes(input.version)) issue("invalid_or_duplicate_version");
  if (!input.source.fileName.trim() || !/^[a-f0-9]{64}$/i.test(input.source.sha256)) issue("missing_provenance");
  if (input.source.format === "pdf" && !input.source.pdfReviewed) issue("pdf_review_required");
  if (input.source.format !== "xlsx" && input.source.format !== "csv" && input.source.format !== "pdf") issue("unsupported_format");
  if (input.headers.length !== FINANCIAL_COLUMNS.length || FINANCIAL_COLUMNS.some((column, index) =>
    !column.slice(1).some(label => key(label) === key(input.headers[index] ?? "")))) issue("standard_headers_required");
  if (input.formula?.status !== "approved" || input.formula.version !== "vehicle-finance-v4-v1") issue("source_relationships_unverified");
  if (!input.expectedVehicleIds.length) issue("monthly_roster_required");
  const lpgVehicleIds = canonicalLpgVehicleIds(input.vehicles);
  if (lpgVehicleIds.length > 1) issue("lpg_canonical_vehicle_ambiguous");
  const canonicalLpgVehicleId = lpgVehicleIds.length === 1 ? lpgVehicleIds[0] : null;
  const seen = new Set<string>();
  const employees = new Map<string, { vehicleIds: Set<string>; assignments: Array<{ vehicleId: string; from: string; to: string }> }>();
  const excludedRows: SourceRow[] = [];
  const rows = input.rows.flatMap(source => {
    const registration = String(source.cells[0] ?? "").trim();
    if (key(registration) === "DUMMY") { excludedRows.push(source); return []; }
    if (source.cells.length !== FINANCIAL_COLUMNS.length) issue("column_count", source.row);
    const matches = input.vehicles.filter(vehicle => [vehicle.registration, ...(vehicle.aliases ?? [])].some(alias => key(alias) === key(registration)));
    const vehicle = matches.length === 1 ? matches[0] : null;
    if (!vehicle) issue(matches.length > 1 ? "ambiguous_registration" : "unknown_registration", source.row);
    const lpgIdentityCandidate = Boolean(vehicle && lpgVehicleIds.includes(vehicle.id));
    const isLpgVehicle = Boolean(vehicle && canonicalLpgVehicleId && vehicle.id === canonicalLpgVehicleId);
    const rosterConfirmedForVehicle = Boolean(input.fleetRosterConfirmed && vehicle && input.expectedVehicleIds.includes(vehicle.id));
    let lpgTreatment = source.lpgTreatment ?? "unknown";
    let confirmedNonLpgZero = false;
    if (isLpgVehicle && historicalMonth) {
      if (source.lpgTreatment && source.lpgTreatment !== "included_in_fuel") issue("historical_lpg_included_in_fuel_required", source.row, "lpg");
      lpgTreatment = "included_in_fuel";
    } else if (isLpgVehicle && input.reportingMonth >= "2026-08") {
      if (source.lpgTreatment && source.lpgTreatment !== "separate") issue("post_july_lpg_must_be_separate", source.row, "lpg");
      lpgTreatment = "separate";
    } else if (vehicle && !lpgIdentityCandidate && rosterConfirmedForVehicle) {
      if (source.lpgTreatment && source.lpgTreatment !== "separate") issue("lpg_treatment_conflicts_with_vehicle_policy", source.row, "lpg");
      lpgTreatment = "separate";
      confirmedNonLpgZero = true;
    }
    if (vehicle && !lpgIdentityCandidate && parseFinancialValue(source.cells[8]) !== null && parseFinancialValue(source.cells[8])! > 0) {
      issue("lpg_recorded_for_non_lpg_vehicle", source.row, "lpg");
      lpgTreatment = "unknown";
      confirmedNonLpgZero = false;
    }
    if (lpgIdentityCandidate && lpgVehicleIds.length > 1) lpgTreatment = "unknown";
    if (vehicle) {
      if (!input.expectedVehicleIds.includes(vehicle.id)) issue("outside_monthly_roster", source.row);
      if (seen.has(vehicle.id)) issue("duplicate_vehicle_month", source.row);
      seen.add(vehicle.id);
      if (input.publishedVehicleIds.includes(vehicle.id) && !historicalMonth) issue("vehicle_month_already_published", source.row);
    }
    const values = Object.fromEntries(fields.map((field, index) => {
      const rawValue = source.cells[index + 1];
      const parsed = parseFinancialValue(rawValue, field === "jobs");
      const blank = rawValue == null || (typeof rawValue === "string" && rawValue.trim() === "");
      const value = field === "lpg" && confirmedNonLpgZero && blank ? 0 : parsed;
      if (parsed === null && !(field === "lpg" && lpgTreatment === "included_in_fuel") && !(field === "lpg" && confirmedNonLpgZero && blank)) issue("missing_or_invalid_value", source.row, field);
      return [field, value];
    })) as FinancialValues;
    if (vehicle && !isLpgVehicle && input.expectedVehicleIds.includes(vehicle.id) && !input.fleetRosterConfirmed && values.lpg === null) {
      issue("fleet_roster_confirmation_required", source.row, "lpg");
    }
    if (lpgTreatment === "unknown") issue("lpg_treatment_unverified", source.row, "lpg");
    if (lpgTreatment === "separate" && values.lpg === null) issue("lpg_amount_unknown", source.row, "lpg");
    // Source identity is optional for preview, mandatory for salary verification.
    if (!source.employeeId?.trim() || (input.employeeIds && !input.employeeIds.includes(source.employeeId))) issue("salary_assignment_unverified", source.row);
    if (vehicle && source.employeeId?.trim() && (!input.employeeIds || input.employeeIds.includes(source.employeeId))) {
      const employeeId = source.employeeId.trim();
      const allocation = employees.get(employeeId) ?? { vehicleIds: new Set<string>(), assignments: [] };
      allocation.vehicleIds.add(vehicle.id);
      allocation.assignments.push({ vehicleId: vehicle.id, from: source.assignmentEffectiveFrom ?? "", to: source.assignmentEffectiveTo ?? "" });
      employees.set(employeeId, allocation);
    }
    return [{ vehicleId: vehicle?.id ?? null, registration, values, lpgTreatment, raw: source,
      metrics: calculateDraftFinancials(values, lpgTreatment, input.formula) }];
  });
  for (const id of input.expectedVehicleIds) if (!seen.has(id)) issue("missing_vehicle", undefined, id);
  for (const [employeeId, allocation] of employees) {
    if (allocation.vehicleIds.size < 2) continue;
    reviewWarnings.push({ code: "salary_allocation_approval_required", field: employeeId });
    // The client cannot attest to payroll. A server-side HR check compares the
    // allocation sum; an independent administrator must approve the resulting draft.
    const periods = allocation.assignments;
    for (const period of periods) {
      if (!isCalendarDate(period.from) || !isCalendarDate(period.to) || period.from > period.to ||
          period.from.slice(0, 7) !== input.reportingMonth || period.to.slice(0, 7) !== input.reportingMonth) issue("salary_assignment_dates_required", undefined, employeeId);
    }
    for (let i = 0; i < periods.length; i++) for (let j = i + 1; j < periods.length; j++) {
      if (periods[i].vehicleId !== periods[j].vehicleId && periods[i].from && periods[i].to && periods[j].from && periods[j].to &&
          periods[i].from <= periods[j].to && periods[j].from <= periods[i].to) issue("salary_assignment_overlap", undefined, employeeId);
    }
  }
  const totals = Object.fromEntries(fields.map(field => {
    const values = rows.map(row => row.values[field]);
    const reportableValues = field === "lpg" ? rows.map(row => row.lpgTreatment === "included_in_fuel" ? 0 : row.values.lpg) : values;
    const sum = reportableValues.reduce<number>((total, value) => total + (value ?? 0), 0);
    const total = reportableValues.some(value => value === null) || !Number.isSafeInteger(sum) ? null : sum;
    const control = parseFinancialValue(input.sourceTotals[field], field === "jobs");
    const lpgControlNotRequired = field === "lpg" && rows.length > 0 && rows.every(row =>
      row.lpgTreatment === "included_in_fuel" || (row.lpgTreatment === "separate" && row.values.lpg === 0));
    if (control === null) {
      if (!lpgControlNotRequired) issue("source_total_required", undefined, field);
    } else if (total === null || control !== total) issue("source_total_mismatch", undefined, field);
    return [field, total];
  })) as FinancialValues;
  if (!rows.length) issue("empty_report");
  // 159,500 is the supplied August allocation control, only applicable if all rows
  // have a known salary. It excludes DUMMY by construction.
  if (input.reportingMonth === "2026-08" && totals.salary !== null && totals.salary !== 15950000) issue("august_salary_control_mismatch");
  if (input.reportingMonth === "2026-09" && (!input.septemberSalaryVerification?.verified || !input.septemberSalaryVerification.evidence.trim())) issue("september_salary_verification_required");
  return { schemaVersion: 4 as const, status: "draft" as const, reportingMonth: input.reportingMonth,
    version: input.version, source: input.source, formula: input.formula ?? null, rows, excludedRows, totals, issues,
    historicalCorrection: input.historicalCorrection ?? null, fleetRosterConfirmed: input.fleetRosterConfirmed === true, reviewWarnings,
    readyForReview: issues.length === 0, canPublish: false as const };
}

export type FinancialReportSnapshot = {
  reportingMonth: string;
  version: number;
  authorId: string;
  status: ReportStatus;
  contentHash: string;
  validationPassed: boolean;
  validatedContentHash: string | null;
  historicalCorrection: DraftInput["historicalCorrection"];
  reviewerId?: string;
  approvalReason?: string;
  events: Array<{ status: ReportStatus; actorId: string; at: string; contentHash: string; reason?: string }>;
};

/** Pure transition contract for a later authorized persistence layer. A correction
 * creates a new snapshot; this function never mutates an approved/published version. */
export function transitionFinancialReport(
  report: FinancialReportSnapshot,
  nextStatus: "in_review" | "approved",
  actor: { id: string; reason: string; at: string; explicitlyRequestedByOwner?: boolean }
): FinancialReportSnapshot | null {
  const lastEvent = report.events.at(-1);
  if (!actor.id.trim() || !actor.reason.trim() || !/^\d{4}-\d{2}-\d{2}T/.test(actor.at) ||
      !report.contentHash.trim() || lastEvent?.contentHash !== report.contentHash || !report.validationPassed ||
      report.validatedContentHash !== report.contentHash) return null;
  if (report.status === "draft" && nextStatus === "in_review") {
    if (report.historicalCorrection && (!report.historicalCorrection.explicitlyRequestedByOwner || !report.historicalCorrection.reason.trim())) return null;
    return { ...report, status: nextStatus, events: [...report.events, { status: nextStatus, actorId: actor.id, at: actor.at, contentHash: report.contentHash, reason: actor.reason }] };
  }
  if (report.status === "in_review" && nextStatus === "approved") {
    if (actor.id === report.authorId || !actor.explicitlyRequestedByOwner) return null;
    return { ...report, status: nextStatus, reviewerId: actor.id, approvalReason: actor.reason,
      events: [...report.events, { status: nextStatus, actorId: actor.id, at: actor.at, contentHash: report.contentHash, reason: actor.reason }] };
  }
  return null;
}
