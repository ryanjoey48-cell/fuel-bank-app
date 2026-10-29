import { NextResponse } from "next/server";
import august from "../../../../data/vehicle-performance-v4/previews/2026-08.json";
import september from "../../../../data/vehicle-performance-v4/previews/2026-09.json";
import { AdminApiError, createServerSupabaseAdmin, requireVerifiedUser, resolveAccountAccess } from "@/lib/admin-user-management-server";
import { canUseVehicleFinancialDrafts } from "@/lib/vehicle-financial-draft-access";
import {
  authorisedSourceImportTokenConfigured,
  authorisedSourceImportTokenMatches,
  disabledAuthorisedSourceImportResponse,
  isAuthorisedImportMonth,
  isVehicleFinancialV4AuthorisedSourceImportEnabled
} from "@/lib/vehicle-financial-v4-authorised-source-import";
import {
  buildVehicleFinancialV4SourceImport,
  type PreviewSourceReport
} from "@/lib/vehicle-financial-v4-source-import";
import { isVehicleFinancialV4WriteLocked } from "@/lib/vehicle-financial-v4-release-lock";

export const dynamic = "force-dynamic";

const previewByMonth = {
  "2026-08": august,
  "2026-09": september
} as const;

/**
 * Narrow Release B import endpoint.
 * - Does not unlock general draft upload/approve/publish routes.
 * - Requires VEHICLE_FINANCIAL_V4_AUTHORISED_SOURCE_IMPORT=true
 * - Requires admin financial approve permission
 * - Requires import token header when token env is configured
 * - Allowlists August/September 2026 preview JSON only
 */
export async function POST(request: Request) {
  if (!isVehicleFinancialV4AuthorisedSourceImportEnabled()) {
    return disabledAuthorisedSourceImportResponse("disabled");
  }
  // Keep general V4 write surface locked even while this narrow window is open.
  if (!isVehicleFinancialV4WriteLocked()) {
    return NextResponse.json({
      error: "Refuse to run authorised source import while general V4 writes are unlocked. Clear VEHICLE_FINANCIAL_V4_WRITES_UNLOCKED first.",
      errorCode: "v4_general_writes_must_remain_locked"
    }, { status: 409, headers: { "Cache-Control": "private, no-store, max-age=0" } });
  }
  // Token is mandatory whenever the narrow window is open — never allow
  // ADMIN-only import without the server-side one-time secret configured.
  if (!authorisedSourceImportTokenConfigured()
      || !authorisedSourceImportTokenMatches(request.headers.get("x-ees-v4-source-import-token"))) {
    return disabledAuthorisedSourceImportResponse("token_required");
  }

  try {
    const user = await requireVerifiedUser(request);
    const admin = createServerSupabaseAdmin();
    const access = await resolveAccountAccess(admin, user);
    if (!canUseVehicleFinancialDrafts(access, "approve")) {
      throw new AdminApiError(403, "Administrator financial approval access is required for authorised source import.");
    }

    const body = await request.json().catch(() => null) as { reportingMonth?: string; version?: number } | null;
    const reportingMonth = String(body?.reportingMonth ?? "").trim();
    if (!isAuthorisedImportMonth(reportingMonth)) {
      return disabledAuthorisedSourceImportResponse("month_not_allowed");
    }

    const preview = previewByMonth[reportingMonth] as PreviewSourceReport;
    const { data: vehicles, error: vehiclesError } = await admin.from("vehicles").select("id,vehicle_reg");
    if (vehiclesError) throw vehiclesError;

    const built = buildVehicleFinancialV4SourceImport(preview, {
      vehicles: (vehicles ?? []).map((row: { id: string; vehicle_reg: string }) => ({ id: row.id, vehicle_reg: row.vehicle_reg })),
      version: Number.isInteger(body?.version) && Number(body?.version) > 0 ? Number(body?.version) : 1,
      actorNote: `Authorised Release B source import by ${user.id} for ${reportingMonth}`
    });

    const { data, error } = await admin.rpc("create_vehicle_financial_draft", {
      p_batch: built.batch,
      p_entries: built.entries,
      p_actor_id: user.id
    });
    if (error) {
      const message = String(error.message ?? "");
      if (/does not exist|schema cache|PGRST20[245]/i.test(message)) {
        return NextResponse.json({
          error: "Vehicle Financial Draft storage is not installed. Apply the reviewed Phase 2 migration before authorised import.",
          errorCode: "storage_not_installed"
        }, { status: 503, headers: { "Cache-Control": "private, no-store, max-age=0" } });
      }
      if (/duplicate_import|duplicate key/i.test(message)) {
        return NextResponse.json({
          error: "This exact authorised source import already exists for the selected month.",
          errorCode: "duplicate_import"
        }, { status: 409, headers: { "Cache-Control": "private, no-store, max-age=0" } });
      }
      throw error;
    }

    return NextResponse.json({
      ok: true,
      reportingMonth,
      batch: data,
      reconciliation: built.reconciliation,
      generalWritesRemainLocked: isVehicleFinancialV4WriteLocked()
    }, {
      headers: { "Cache-Control": "private, no-store, max-age=0" }
    });
  } catch (error) {
    if (error instanceof AdminApiError) {
      return NextResponse.json({ error: error.message, errorCode: "permission_denied" }, {
        status: error.status,
        headers: { "Cache-Control": "private, no-store, max-age=0" }
      });
    }
    return NextResponse.json({ error: "Authorised source import failed.", errorCode: "authorised_source_import_failed" }, {
      status: 500,
      headers: { "Cache-Control": "private, no-store, max-age=0" }
    });
  }
}
