import { NextResponse } from "next/server";
import {
  AdminApiError,
  createServerSupabaseAdmin,
  requireVerifiedUser,
  resolveAccountAccess
} from "@/lib/admin-user-management-server";
import { canUseVehicleFinancialDrafts } from "@/lib/vehicle-financial-draft-access";
import {
  VEHICLE_PERFORMANCE_V4_REPORTING_MONTHS,
  mapV4DraftBatchToReportingRows,
  type V4DraftBatchMeta,
  type V4DraftEntryRow
} from "@/lib/vehicle-financial-v4-reporting";

export const dynamic = "force-dynamic";

/**
 * Release C read-only dual-read feed for Aug/Sep V4 draft storage.
 * Does not unlock writes and never mutates vehicle_monthly_performance.
 */
export async function GET(request: Request) {
  try {
    const user = await requireVerifiedUser(request);
    const admin = createServerSupabaseAdmin();
    const access = await resolveAccountAccess(admin, user);
    if (!canUseVehicleFinancialDrafts(access, "read")) {
      throw new AdminApiError(403, "Financial reporting access is required to read V4 draft source months.");
    }

    const url = new URL(request.url);
    const year = Number(url.searchParams.get("year") || "2026");
    if (!Number.isInteger(year) || year < 2020 || year > 2100) {
      return NextResponse.json({ error: "Invalid year.", errorCode: "invalid_year" }, {
        status: 400,
        headers: { "Cache-Control": "private, no-store, max-age=0" }
      });
    }

    const months = VEHICLE_PERFORMANCE_V4_REPORTING_MONTHS.map(
      (month) => `${year}-${String(month).padStart(2, "0")}-01`
    );

    const { data: batches, error: batchError } = await admin
      .from("vehicle_financial_import_batches")
      .select("id,reporting_month,version,status,source_file_name,source_sha256,salary_verification")
      .in("reporting_month", months)
      .order("reporting_month", { ascending: true })
      .order("version", { ascending: false });

    if (batchError) {
      const message = String(batchError.message ?? "");
      if (/does not exist|schema cache|PGRST20[245]/i.test(message)) {
        return NextResponse.json({
          year,
          months: VEHICLE_PERFORMANCE_V4_REPORTING_MONTHS,
          batches: [],
          rows: [],
          migrationReady: false,
          writesEnabled: false,
          note: "V4 draft storage is not installed in this environment."
        }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
      }
      throw batchError;
    }

    // Latest version per reporting month only.
    const latestByMonth = new Map<string, (typeof batches)[number]>();
    for (const batch of batches ?? []) {
      const key = String(batch.reporting_month);
      if (!latestByMonth.has(key)) latestByMonth.set(key, batch);
    }
    const selected = [...latestByMonth.values()];
    if (!selected.length) {
      return NextResponse.json({
        year,
        months: VEHICLE_PERFORMANCE_V4_REPORTING_MONTHS,
        batches: [],
        rows: [],
        migrationReady: true,
        writesEnabled: false,
        note: "No stored V4 draft batches for the requested Aug/Sep window."
      }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
    }

    const batchIds = selected.map((batch) => batch.id);
    const { data: entries, error: entryError } = await admin
      .from("vehicle_financial_draft_entries")
      .select("id,batch_id,vehicle_id,registration_source,registration_snapshot,source_sheet,source_row,salary,jobs_completed,trip_payments,expenses,parking_fees,total_received,fuel,lpg,lpg_treatment,maintenance")
      .in("batch_id", batchIds)
      .order("source_row", { ascending: true });
    if (entryError) throw entryError;

    const entriesByBatch = new Map<string, V4DraftEntryRow[]>();
    for (const entry of (entries ?? []) as V4DraftEntryRow[]) {
      const list = entriesByBatch.get(entry.batch_id) ?? [];
      list.push(entry);
      entriesByBatch.set(entry.batch_id, list);
    }

    const reportingBatches = selected.map((batch) => {
      const meta: V4DraftBatchMeta = {
        id: batch.id,
        reportingMonth: String(batch.reporting_month).slice(0, 10),
        version: Number(batch.version),
        status: String(batch.status),
        sourceFileName: String(batch.source_file_name ?? ""),
        sourceSha256: String(batch.source_sha256 ?? ""),
        salaryVerification: (batch.salary_verification as V4DraftBatchMeta["salaryVerification"]) ?? null
      };
      const rows = mapV4DraftBatchToReportingRows(meta, entriesByBatch.get(batch.id) ?? []);
      return {
        ...meta,
        entryCount: rows.length,
        completeCount: rows.filter((row) => row.financiallyComplete).length,
        incompleteCount: rows.filter((row) => !row.financiallyComplete).length,
        rows
      };
    });

    return NextResponse.json({
      year,
      months: VEHICLE_PERFORMANCE_V4_REPORTING_MONTHS,
      migrationReady: true,
      writesEnabled: false,
      publicationEnabled: false,
      liveKpiEligible: false,
      note: "Aug/Sep rows are stored V4 drafts for reporting dual-read. They are not published accounting profit.",
      batches: reportingBatches.map(({ rows, ...batch }) => batch),
      rows: reportingBatches.flatMap((batch) => batch.rows)
    }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    if (error instanceof AdminApiError) {
      return NextResponse.json({ error: error.message, errorCode: "permission_denied" }, {
        status: error.status,
        headers: { "Cache-Control": "private, no-store, max-age=0" }
      });
    }
    return NextResponse.json({ error: "Unable to load V4 reporting source.", errorCode: "reporting_source_unavailable" }, {
      status: 500,
      headers: { "Cache-Control": "private, no-store, max-age=0" }
    });
  }
}
