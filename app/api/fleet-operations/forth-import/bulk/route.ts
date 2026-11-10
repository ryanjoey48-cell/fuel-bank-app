import { NextResponse } from "next/server";
import { AdminApiError } from "@/lib/admin-user-management-server";
import { hasPermission } from "@/lib/authorization";
import { requireFleetOfficeAccess } from "@/lib/fleet-operations-auth";
import {
  buildForthImportApprovalPayload,
  extractForthLocationIdFromSourceInfo
} from "@/lib/forth-locations-import";
import { loadEesDirectoryForForthImport, missingTable } from "@/lib/forth-locations-import-directory";
import { reconcileBundledForthPinnedLocationsAgainstDirectory } from "@/lib/forth-locations-import-server";
import {
  isBulkDraftEligible,
  planForthBulkApprovals,
  previewForthBulkAction,
  type ForthBulkAction,
  type ForthBulkItemResult
} from "@/lib/forth-locations-bulk";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const MAX_BULK = 100;

async function writeAudit(
  admin: Awaited<ReturnType<typeof requireFleetOfficeAccess>>["admin"],
  rows: Array<{
    forth_location_id: string;
    ees_location_id?: string | null;
    action: string;
    classification?: string | null;
    details?: Record<string, unknown>;
    actor_user_id: string;
  }>
) {
  if (!rows.length) return { auditStorageReady: true as const };
  const { error } = await admin.from("ees_forth_location_import_audit").insert(rows);
  if (error) {
    if (missingTable(error)) return { auditStorageReady: false as const };
    throw error;
  }
  return { auditStorageReady: true as const };
}

export async function POST(request: Request) {
  try {
    const { user, admin, access } = await requireFleetOfficeAccess(request, true);
    if (!hasPermission(access, "business:write")) {
      throw new AdminApiError(403, "Write access is required for bulk Forth location review.");
    }
    const body = await request.json() as {
      action?: ForthBulkAction | "preview";
      forthLocationIds?: unknown;
      confirm?: boolean;
    };
    const action = body.action;
    const forthLocationIds = Array.isArray(body.forthLocationIds)
      ? [...new Set(body.forthLocationIds.map((value) => String(value ?? "").trim()).filter((value) => /^\d+$/.test(value)))]
      : [];
    if (!action) throw new AdminApiError(400, "Provide a bulk action.");
    if (!forthLocationIds.length) throw new AdminApiError(400, "Select at least one Forth location ID.");
    if (forthLocationIds.length > MAX_BULK) {
      throw new AdminApiError(400, `Bulk actions are limited to ${MAX_BULK} records per request.`);
    }

    const { locations, pins } = await loadEesDirectoryForForthImport(admin);
    const result = await reconcileBundledForthPinnedLocationsAgainstDirectory(locations, pins);
    const alreadyImported = new Set(
      locations.map((location) => extractForthLocationIdFromSourceInfo(location.source_info)).filter(Boolean) as string[]
    );

    if (action === "preview") {
      const previewAction = (body as { previewAction?: ForthBulkAction }).previewAction
        ?? "approve_drafts";
      return NextResponse.json({
        preview: previewForthBulkAction(result.items, forthLocationIds, previewAction),
        alreadyImportedCount: forthLocationIds.filter((id) => alreadyImported.has(id)).length
      }, { headers });
    }

    if (body.confirm !== true) {
      throw new AdminApiError(400, "Set confirm=true after reviewing the bulk summary.");
    }

    if (action === "skip" || action === "defer") {
      const itemResults: ForthBulkItemResult[] = forthLocationIds.map((id) => ({
        forthLocationId: id,
        status: action === "skip" ? "skipped" : "deferred"
      }));
      const audit = await writeAudit(admin, itemResults.map((item) => ({
        forth_location_id: item.forthLocationId,
        action: action === "skip" ? "skipped" : "deferred",
        classification: result.items.find((row) => row.record.forthLocationId === item.forthLocationId)?.classification ?? null,
        details: { bulk: true },
        actor_user_id: user.id
      })));
      return NextResponse.json({
        action,
        results: itemResults,
        summary: {
          requested: forthLocationIds.length,
          succeeded: itemResults.length,
          failed: 0
        },
        auditStorageReady: audit.auditStorageReady,
        note: audit.auditStorageReady
          ? `Bulk ${action} recorded in import audit.`
          : `Bulk ${action} accepted for this session, but Forth audit tables are not installed yet. Durable history requires the review-only SQL.`
      }, { headers });
    }

    if (action !== "approve_drafts") throw new AdminApiError(400, "Unsupported bulk action.");

    const plan = planForthBulkApprovals(result.items, forthLocationIds, alreadyImported);
    const itemResults: ForthBulkItemResult[] = [];
    for (const planned of plan) {
      if (planned.status !== "created") {
        itemResults.push(planned);
        continue;
      }
      const item = result.items.find((candidate) => candidate.record.forthLocationId === planned.forthLocationId);
      if (!item || !isBulkDraftEligible(item)) {
        itemResults.push({
          forthLocationId: planned.forthLocationId,
          status: "rejected",
          error: "Not eligible for bulk draft import."
        });
        continue;
      }
      // Re-check idempotency immediately before insert.
      if (alreadyImported.has(planned.forthLocationId)
        || locations.some((location) => extractForthLocationIdFromSourceInfo(location.source_info) === planned.forthLocationId)) {
        itemResults.push({ forthLocationId: planned.forthLocationId, status: "already_imported" });
        continue;
      }
      try {
        const payload = buildForthImportApprovalPayload(item);
        const { data, error } = await admin.from("ees_locations").insert({
          company_name: payload.company_name,
          thai_name: payload.thai_name,
          alternative_names: payload.alternative_names,
          address: payload.address,
          province: payload.province,
          destination_type: payload.destination_type,
          google_maps_url: null,
          truck_entrance_url: null,
          verification_status: "needs_check",
          verified_at: null,
          notes: payload.notes,
          source_info: payload.source_info,
          created_by: user.id,
          updated_by: user.id
        }).select("id,company_name").single();
        if (error) throw error;
        alreadyImported.add(planned.forthLocationId);
        locations.push({
          id: data.id,
          company_name: data.company_name,
          thai_name: null,
          alternative_names: [],
          address: payload.address,
          province: null,
          destination_type: payload.destination_type,
          source_info: payload.source_info,
          google_maps_url: null,
          verification_status: "needs_check"
        });
        itemResults.push({
          forthLocationId: planned.forthLocationId,
          status: "created",
          eesLocationId: data.id
        });
      } catch (error) {
        itemResults.push({
          forthLocationId: planned.forthLocationId,
          status: "failed",
          error: error instanceof Error ? error.message : "Insert failed."
        });
      }
    }

    const audit = await writeAudit(admin, itemResults.map((item) => ({
      forth_location_id: item.forthLocationId,
      ees_location_id: item.eesLocationId ?? null,
      action: item.status === "created" ? "approved_new"
        : item.status === "already_imported" ? "skipped"
          : item.status === "rejected" ? "skipped" : "skipped",
      classification: result.items.find((row) => row.record.forthLocationId === item.forthLocationId)?.classification ?? null,
      details: { bulk: true, status: item.status, error: item.error ?? null },
      actor_user_id: user.id
    })));

    return NextResponse.json({
      action,
      results: itemResults,
      summary: {
        requested: forthLocationIds.length,
        created: itemResults.filter((item) => item.status === "created").length,
        alreadyImported: itemResults.filter((item) => item.status === "already_imported").length,
        rejected: itemResults.filter((item) => item.status === "rejected").length,
        failed: itemResults.filter((item) => item.status === "failed").length
      },
      auditStorageReady: audit.auditStorageReady,
      note: "Bulk approve created needs_check Directory drafts only. No destination pins or geofences were activated."
    }, { headers });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof AdminApiError ? error.message : "Unable to process bulk Forth location review."
    }, { status: error instanceof AdminApiError ? error.status : 500, headers });
  }
}
