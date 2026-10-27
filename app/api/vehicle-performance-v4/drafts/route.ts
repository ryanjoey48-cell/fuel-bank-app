import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { AdminApiError, createServerSupabaseAdmin, requireVerifiedUser, resolveAccountAccess } from "@/lib/admin-user-management-server";
import { canUseVehicleFinancialDrafts } from "@/lib/vehicle-financial-draft-access";
import { FinancialWorkbookError, MAX_FINANCIAL_FILE_BYTES, parseFinancialWorkbook, validateFinancialFileSignature } from "@/lib/vehicle-financial-draft-import";
import { FINANCIAL_COLUMNS, previewFinancialDraft, type DraftInput, type LpgTreatment } from "@/lib/vehicle-financial-draft";
import { financialDraftEntryPayload, hashFinancialDraftContent } from "@/lib/vehicle-financial-draft-storage";
import { knownVehicleRegistrationAliases } from "@/lib/vehicle-identity";
import { BoundedRequestError, boundedRequestBody } from "@/lib/vehicle-financial-upload";
import { getActiveApprovedVehicleFinancialPolicy, verifiedVehicleFinancialPolicyEvidence } from "@/lib/vehicle-financial-accounting-policy";

const json = (value: FormDataEntryValue | null, fallback: unknown) => {
  if (typeof value !== "string" || !value.trim()) return fallback;
  try { return JSON.parse(value); } catch { throw new AdminApiError(400, "One of the import settings is not valid JSON."); }
};

function errorResponse(error: unknown) {
  if (error instanceof AdminApiError) {
    const message = error.message.toLowerCase();
    const errorCode = error.status === 403 ? "permission_denied" : message.includes("reporting month") ? "invalid_reporting_month" :
      message.includes("source total") ? "invalid_source_total" : message.includes("source file") ? "file_required" :
      message.includes("historical correction") ? "historical_owner_admin_required" : message.includes("roster") ? "invalid_import_roster" :
      "invalid_import_request";
    return NextResponse.json({ error: error.message, errorCode }, { status: error.status });
  }
  if (error instanceof BoundedRequestError) return NextResponse.json({ error: error.code, errorCode: error.code }, { status: error.code === "request_too_large" ? 413 : 400 });
  if (error instanceof FinancialWorkbookError) return NextResponse.json({ error: error.code, errorCode: error.code }, { status: 400 });
  const message = String((error as { message?: unknown } | null)?.message ?? "");
  if (/does not exist|schema cache|PGRST20[245]/i.test(message)) {
    return NextResponse.json({ error: "Vehicle Financial Draft storage is not installed in this environment. Review and approve the additive Phase 2 migration before enabling persistence.", errorCode: "storage_not_installed" }, { status: 503 });
  }
  if (/duplicate key|vehicle_finance_|vehicle_financial_import_batches_reporting_month_version_key/i.test(message)) {
    const duplicateImport = /duplicate_import/i.test(message);
    return NextResponse.json({ error: duplicateImport ? "This exact source and reviewed mapping already exists for the selected month." : "This draft version or review state conflicts with a saved report. Refresh the month and review its saved versions.", errorCode: duplicateImport ? "duplicate_import" : "version_conflict" }, { status: 409 });
  }
  return NextResponse.json({ error: "Unable to access monthly financial drafts.", errorCode: "draft_storage_unavailable" }, { status: 500 });
}

async function authorized(request: Request, action: "read" | "import") {
  const user = await requireVerifiedUser(request);
  const admin = createServerSupabaseAdmin();
  const access = await resolveAccountAccess(admin, user);
  if (!canUseVehicleFinancialDrafts(access, action)) throw new AdminApiError(403, "You do not have access to monthly financial drafts.");
  return { user, admin, access };
}

export async function GET(request: Request) {
  try {
    const { admin, access } = await authorized(request, "read");
    const [{ data: vehicles, error: vehicleError }, { data: drivers, error: driverError }, { data: batches, error: batchError }, { data: published, error: publicationError }, { data: policyApproval, error: policyError }] = await Promise.all([
      admin.from("vehicles").select("id,vehicle_reg,active").order("vehicle_reg"),
      admin.rpc("list_vehicle_financial_draft_drivers"),
      admin.from("vehicle_financial_import_batches").select("id,reporting_month,version,status,source_file_name,source_sha256,source_totals,calculated_totals,validation_issue_codes,validation_ready,validation_counts,expected_vehicle_ids,content_hash,uploaded_by,created_at").order("reporting_month", { ascending: false }).order("version", { ascending: false }).limit(100),
      admin.from("vehicle_financial_publications").select("reporting_month,vehicle_id"),
      admin.from("vehicle_financial_policy_approvals").select("policy_version").eq("policy_version", "v4-accounting-draft-3").maybeSingle()
    ]);
    if (vehicleError) throw vehicleError;
    let exactDriverRows = (drivers ?? []) as Array<{ driver_id: string; name: string; active: boolean }>;
    if (driverError) {
      const code = (driverError as { code?: unknown }).code;
      if (code !== "PGRST202" && code !== "42883") throw driverError;
      // Before the additive RPC exists, retain the local/legacy preview for IDs
      // that JSON can represent exactly. Unsafe JS numbers are omitted rather
      // than rounded; installed V4 uses the exact BIGINT-to-text RPC above.
      const legacyDrivers = await admin.from("drivers").select("id,name,active").order("name");
      if (legacyDrivers.error) throw legacyDrivers.error;
      exactDriverRows = (legacyDrivers.data ?? []).flatMap((driver: { id: string | number; name: string; active: boolean }) => {
        const id = typeof driver.id === "string" && /^\d+$/.test(driver.id) ? driver.id :
          typeof driver.id === "number" && Number.isSafeInteger(driver.id) && driver.id >= 0 ? String(driver.id) : null;
        return id ? [{ driver_id: id, name: driver.name, active: driver.active }] : [];
      });
    }
    const migrationReady = !batchError && !publicationError && !driverError && !policyError;
    const activePolicy = await getActiveApprovedVehicleFinancialPolicy(admin);
    return NextResponse.json({
      migrationReady,
      setupMessage: migrationReady ? null : "Vehicle Financial Draft storage is not installed. Local preview remains available; persistence requires the approved Phase 2 migration.",
      accountingPolicy: { status: activePolicy ? "approved" : "draft", evidenceManifestReady: Boolean(verifiedVehicleFinancialPolicyEvidence()), approvalConflict: Boolean(policyApproval && !activePolicy) },
      vehicles: vehicles ?? [],
      drivers: canUseVehicleFinancialDrafts(access, "import") ? exactDriverRows.map(driver => ({ id: driver.driver_id, name: driver.name, active: driver.active })) : [],
      batches: batches ?? [],
      published: published ?? []
    });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const { user, admin, access } = await authorized(request, "import");
    const maxRequestBytes = MAX_FINANCIAL_FILE_BYTES + 1024 * 1024;
    const boundedRequest = await boundedRequestBody(request, maxRequestBytes);
    let form: FormData;
    try { form = await boundedRequest.formData(); }
    catch { return NextResponse.json({ error: "malformed_multipart", errorCode: "malformed_multipart" }, { status: 400 }); }
    const file = form.get("file");
    if (!(file instanceof File)) throw new AdminApiError(400, "Choose an XLSX or CSV source file.");
    if (file.size < 1 || file.size > MAX_FINANCIAL_FILE_BYTES) throw new FinancialWorkbookError("file_size_limit");
    const fileName = file.name.trim().replace(/[\\/\u0000-\u001f\u007f]/g, "_").slice(0, 255);
    const format = fileName.toLowerCase().endsWith(".csv") ? "csv" : fileName.toLowerCase().endsWith(".xlsx") ? "xlsx" : null;
    if (!format) throw new AdminApiError(400, "Only .xlsx and .csv source files are supported in this phase.");
    const fileBytes = new Uint8Array(await file.arrayBuffer());
    validateFinancialFileSignature(fileBytes, format);
    const year = Number(form.get("year"));
    const month = Number(form.get("month"));
    if (!Number.isInteger(year) || year < 2000 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) throw new AdminApiError(400, "Choose a valid reporting month.");
    const reportingMonth = `${year}-${String(month).padStart(2, "0")}-01`;
    const selectedSheets = json(form.get("selectedSheets"), []);
    const rawAnnotations = json(form.get("annotations"), {});
    const expectedVehicleIds = json(form.get("expectedVehicleIds"), []);
    const fleetRosterConfirmed = form.get("fleetRosterConfirmed") === "true";
    const rawSourceTotals = json(form.get("sourceTotals"), {});
    if (!Array.isArray(selectedSheets) || selectedSheets.length > 20 || selectedSheets.some(value => typeof value !== "string" || value.length > 255) || new Set(selectedSheets).size !== selectedSheets.length ||
        !Array.isArray(expectedVehicleIds) || expectedVehicleIds.length > 500 || expectedVehicleIds.some(value => typeof value !== "string") ||
        new Set(expectedVehicleIds).size !== expectedVehicleIds.length || !rawSourceTotals || typeof rawSourceTotals !== "object" || Array.isArray(rawSourceTotals) ||
        !rawAnnotations || typeof rawAnnotations !== "object" || Array.isArray(rawAnnotations) || Object.keys(rawAnnotations).length > 10_000) throw new AdminApiError(400, "Review the selected sheets, source totals, and monthly vehicle roster.");

    const [{ data: vehicleRows, error: vehiclesError }, { data: driverRows, error: driversError }, { data: existingRows, error: existingError }, { data: publishedRows, error: publishedError }] = await Promise.all([
      admin.from("vehicles").select("id,vehicle_reg,active"),
      admin.rpc("list_vehicle_financial_draft_drivers"),
      admin.from("vehicle_financial_import_batches").select("version,status").eq("reporting_month", reportingMonth).order("version", { ascending: true }),
      admin.from("vehicle_financial_publications").select("vehicle_id").eq("reporting_month", reportingMonth)
    ]);
    if (vehiclesError) throw vehiclesError;
    if (driversError) throw driversError;
    if (existingError) throw existingError;
    if (publishedError) throw publishedError;
    const vehicles = (vehicleRows ?? []).map((vehicle: { id: string; vehicle_reg: string }) => ({
      id: vehicle.id,
      registration: vehicle.vehicle_reg,
      aliases: knownVehicleRegistrationAliases(vehicle.vehicle_reg)
    }));
    const vehicleIds = new Set(vehicles.map(vehicle => vehicle.id));
    if (!expectedVehicleIds.every((id: string) => vehicleIds.has(id))) throw new AdminApiError(400, "The selected monthly roster contains a vehicle that is no longer available.");
    const existingVersions = (existingRows ?? []).map((row: { version: number }) => row.version);
    const version = Math.max(0, ...existingVersions) + 1;
    const approvedVersions = new Set((existingRows ?? []).filter((row: { version: number; status: string }) => ["approved", "published"].includes(row.status)).map((row: { version: number }) => row.version));
    const historical = reportingMonth >= "2026-01-01" && reportingMonth <= "2026-07-01";
    const ownerRequested = form.get("ownerRequested") === "true";
    const initialBaseline = form.get("initialBaseline") === "true";
    const ownerEvidence = String(form.get("ownerApprovalEvidence") ?? "").trim().slice(0, 2048);
    if (historical && (ownerRequested || initialBaseline) && (!ownerEvidence || !canUseVehicleFinancialDrafts(access, "approve"))) {
      throw new AdminApiError(403, "Historical correction requests require administrator access and a note recording the owner’s approval.");
    }
    const requestedBaseVersion = Number(form.get("baseVersion"));
    const historicalCorrection = historical ? {
      kind: initialBaseline && existingVersions.length === 0 ? "initial_baseline" as const : "correction" as const,
      explicitlyRequestedByOwner: ownerRequested && Boolean(ownerEvidence),
      reason: ownerRequested ? ownerEvidence : "",
      evidenceReference: initialBaseline ? ownerEvidence : undefined,
      baseVersion: Number.isInteger(requestedBaseVersion) && requestedBaseVersion > 0 ? requestedBaseVersion : undefined,
      approvedBaseVersion: approvedVersions.has(requestedBaseVersion) ? requestedBaseVersion : undefined
    } : undefined;

    const validFieldNames = FINANCIAL_COLUMNS.slice(1).map(([field]) => field);
    const normalizedTotals: Array<[string, string | number | null]> = [];
    for (const [field, value] of Object.entries(rawSourceTotals as Record<string, unknown>)) {
      if (!validFieldNames.includes(field as (typeof validFieldNames)[number])) continue;
      if (value == null || value === "") { normalizedTotals.push([field, null]); continue; }
      if ((typeof value !== "string" && typeof value !== "number") || String(value).length > 64) throw new AdminApiError(400, `Invalid source total for ${field}.`);
      normalizedTotals.push([field, value]);
    }
    const sourceTotals = Object.fromEntries(normalizedTotals);
    // PostgreSQL BIGINT can arrive from PostgREST as a number or decimal string.
    // Normalize before validating annotations or persisting driver identity.
    const driverIds = new Set<string>(((driverRows ?? []) as Array<{ driver_id: string }>).map(driver => String(driver.driver_id)));
    const safeAnnotations = Object.fromEntries(Object.entries(rawAnnotations as Record<string, unknown>).flatMap(([key, value]) => {
      if (key.length > 200 || !value || typeof value !== "object" || Array.isArray(value)) return [];
      const annotation = value as Record<string, unknown>;
      const employeeId = typeof annotation.employeeId === "string" && driverIds.has(annotation.employeeId) ? annotation.employeeId : undefined;
      const lpgTreatment = ["included_in_fuel","separate","unknown"].includes(String(annotation.lpgTreatment)) ? annotation.lpgTreatment as LpgTreatment : undefined;
      const assignmentEffectiveFrom = typeof annotation.assignmentEffectiveFrom === "string" && /^\d{4}-\d{2}-\d{2}$/.test(annotation.assignmentEffectiveFrom) ? annotation.assignmentEffectiveFrom : undefined;
      const assignmentEffectiveTo = typeof annotation.assignmentEffectiveTo === "string" && /^\d{4}-\d{2}-\d{2}$/.test(annotation.assignmentEffectiveTo) ? annotation.assignmentEffectiveTo : undefined;
      return [[key, { employeeId, lpgTreatment, assignmentEffectiveFrom, assignmentEffectiveTo }]];
    })) as Record<string, { employeeId?: string; lpgTreatment?: LpgTreatment; assignmentEffectiveFrom?: string; assignmentEffectiveTo?: string }>;
    const sha256 = createHash("sha256").update(fileBytes).digest("hex");
    const parsed = parseFinancialWorkbook(fileBytes, selectedSheets as string[], safeAnnotations);
    if (!selectedSheets.length || !parsed.rows.length) throw new AdminApiError(400, parsed.issues[0] ?? "No data rows were found on the selected sheets.");
    const totalValues = sourceTotals as DraftInput["sourceTotals"];
    const input: DraftInput = {
      reportingMonth: reportingMonth.slice(0, 7), version,
      source: { fileName, sha256, format, pdfReviewed: false },
      headers: parsed.headers,
      rows: parsed.rows,
      vehicles,
      expectedVehicleIds: expectedVehicleIds as string[],
      fleetRosterConfirmed,
      existingVersions,
      publishedVehicleIds: (publishedRows ?? []).map((row: { vehicle_id: string }) => row.vehicle_id),
      sourceTotals: totalValues,
      // Client-entered references remain provenance. Only a server-managed approved
      // policy can authorize a calculated balance, and none is approved currently.
      formula: await getActiveApprovedVehicleFinancialPolicy(admin) ?? undefined,
      historicalCorrection,
      septemberSalaryVerification: { verified: form.get("septemberSalaryVerified") === "true", evidence: String(form.get("septemberSalaryEvidence") ?? "").trim().slice(0, 2048) },
      employeeIds: [...driverIds]
    };
    const preview = previewFinancialDraft(input);
    if (parsed.issues.length) {
      preview.issues.push(...parsed.issues.map(code => ({ code: "import_parser_issue", field: code })));
      preview.readyForReview = false;
    }

    const hrAllocations = preview.rows.map(row => ({
      source_sheet: row.raw.sheet,
      source_row: row.raw.row,
      driver_id: row.raw.employeeId ? String(row.raw.employeeId) : null,
      vehicle_id: row.vehicleId,
      source_salary: row.values.salary === null ? null : row.values.salary / 100,
      assignment_from: row.raw.assignmentEffectiveFrom ?? null,
      assignment_to: row.raw.assignmentEffectiveTo ?? null
    }));
    const { data: hrSalaryVerification, error: hrVerificationError } = await admin.rpc("verify_vehicle_financial_salary_allocations", {
      p_reporting_month: reportingMonth,
      p_allocations: hrAllocations,
      p_actor_id: user.id
    });
    if (hrVerificationError) throw hrVerificationError;
    const checksBySourceRow = new Map<string, string[]>();
    for (const result of (hrSalaryVerification?.rows ?? []) as Array<{ source_sheet: string; source_row: number; issue_codes: string[] }>) {
      checksBySourceRow.set(`${result.source_sheet}:${result.source_row}`, result.issue_codes ?? []);
    }
    const salaryReviewWarnings: Array<{ code: string; row?: number; field?: string }> = [];
    for (const row of preview.rows) {
      const issueCodes = checksBySourceRow.get(`${row.raw.sheet}:${row.raw.row}`) ?? [];
      for (const code of issueCodes) {
        if (code === "multi_vehicle_salary_allocation_requires_reviewer") {
          salaryReviewWarnings.push({ code: "salary_allocation_approval_required", row: row.raw.row, field: "salary" });
          continue;
        }
        preview.issues.push({ code, row: row.raw.row, field: code.includes("salary") || code.includes("payroll") ? "salary" : "assignment" });
      }
    }
    preview.reviewWarnings.push(...salaryReviewWarnings);
    preview.readyForReview = preview.issues.length === 0;

    const validationCounts = {
      expected: expectedVehicleIds.length,
      matched: new Set(preview.rows.flatMap(row => row.vehicleId ? [row.vehicleId] : [])).size,
      missing: preview.issues.filter(issue => issue.code === "missing_vehicle").length,
      duplicate: preview.issues.filter(issue => issue.code === "duplicate_vehicle_month").length
    };

    const vehicleById = new Map(vehicles.map(vehicle => [vehicle.id, vehicle]));
    const entries = preview.rows.map(row => financialDraftEntryPayload(row, row.vehicleId ? vehicleById.get(row.vehicleId)?.registration ?? null : null, driverIds));
    const sourceControls = [
      ...parsed.controls.map(control => ({ kind: "control_total", sheet: control.sheet, row: control.row, values: control.cells })),
      ...preview.excludedRows.map(row => ({ kind: "excluded_dummy", sheet: row.sheet, row: row.row, values: row.rawCells }))
    ];
    const salaryVerification = {
      september: input.septemberSalaryVerification ?? null,
      hr_cross_check: hrSalaryVerification ?? { status: "unavailable", rows: [] }
    };
    const idempotencyHash = hashFinancialDraftContent({ reportingMonth, sourceSha256: sha256, format,
      selectedSheets, sourceTotals, sourceControls, expectedVehicleIds, fleetRosterConfirmed,
      formulaReference: String(form.get("formulaReference") ?? "").trim().slice(0, 2048),
      historicalCorrection: historicalCorrection ?? null, salaryVerification, entries });
    const batchPayload = {
      reporting_month: reportingMonth,
      version,
      status: "draft",
      source_file_name: fileName,
      source_sha256: sha256,
      source_format: format,
      source_size_bytes: file.size,
      source_sheets: selectedSheets,
      formula_reference: String(form.get("formulaReference") ?? "").trim().slice(0, 2048) || null,
      source_totals: sourceTotals,
      source_controls: sourceControls,
      calculated_totals: preview.totals,
      validation_issue_codes: preview.issues.map(issue => `${issue.code}${issue.field ? `:${issue.field}` : ""}`),
      validation_ready: preview.readyForReview,
      validation_counts: validationCounts,
      expected_vehicle_ids: expectedVehicleIds,
      idempotency_hash: idempotencyHash,
      validation_snapshot: {
        readyForReview: preview.readyForReview,
        fleetRosterConfirmed,
        issues: preview.issues.map(issue => ({ code: issue.code, row: issue.row, field: issue.field })),
        reviewWarnings: preview.reviewWarnings.map(warning => ({ code: warning.code })),
        totals: preview.totals
      },
      historical_correction: historicalCorrection ?? null,
      salary_verification: salaryVerification
    };
    const contentHash = hashFinancialDraftContent({ batch: batchPayload, entries });
    const storedBatch = {
      ...batchPayload,
      content_hash: contentHash,
      formula_version: input.formula?.version
    };
    const { data: saved, error } = await admin.rpc("create_vehicle_financial_draft", {
      p_batch: storedBatch,
      p_entries: entries,
      p_actor_id: user.id
    });
    if (error) throw error;
    return NextResponse.json({ batch: saved, preview: { ...preview, status: storedBatch.status, contentHash } }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}
