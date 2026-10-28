import { NextResponse } from "next/server";
import { AdminApiError, createServerSupabaseAdmin, requireVerifiedUser, resolveAccountAccess } from "@/lib/admin-user-management-server";
import { canUseVehicleFinancialDrafts } from "@/lib/vehicle-financial-draft-access";
import { BoundedRequestError, boundedRequestBody } from "@/lib/vehicle-financial-upload";
import { disabledVehicleFinancialV4WriteResponse, isVehicleFinancialV4WriteLocked } from "@/lib/vehicle-financial-v4-release-lock";

export async function GET(request: Request, context: { params: Promise<{ batchId: string }> }) {
  try {
    const user = await requireVerifiedUser(request);
    const admin = createServerSupabaseAdmin();
    const access = await resolveAccountAccess(admin, user);
    if (!canUseVehicleFinancialDrafts(access, "read")) throw new AdminApiError(403, "You do not have access to monthly financial drafts.");
    const { batchId } = await context.params;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(batchId)) {
      throw new AdminApiError(400, "Invalid draft identifier.");
    }
    const [{ data: batch, error: batchError }, { data: entries, error: entryError }, { data: history, error: historyError }, { data: approvals, error: approvalError }] = await Promise.all([
      admin.from("vehicle_financial_import_batches").select("*").eq("id", batchId).maybeSingle(),
      admin.from("vehicle_financial_draft_entries").select("*").eq("batch_id", batchId).order("source_sheet").order("source_row"),
      admin.from("vehicle_financial_revision_history").select("*").eq("batch_id", batchId).order("created_at"),
      admin.from("vehicle_financial_review_approvals").select("*").eq("batch_id", batchId).order("created_at")
    ]);
    if (batchError) throw batchError;
    if (entryError) throw entryError;
    if (historyError) throw historyError;
    if (approvalError) throw approvalError;
    if (!batch) throw new AdminApiError(404, "Draft not found.");
    const { data: currentApprovals, error: currentError } = await admin.from("vehicle_financial_current_approvals")
      .select("reporting_month,vehicle_id,batch_id,entry_id,designated_at")
      .eq("reporting_month", batch.reporting_month);
    if (currentError) throw currentError;
    const ids = [...new Set([batch.uploaded_by, ...(history ?? []).map((event: { actor_id: string }) => event.actor_id), ...(approvals ?? []).map((approval: { reviewer_id: string }) => approval.reviewer_id)])];
    const { data: identities, error: identityError } = await admin.from("account_access").select("user_id,display_name").in("user_id", ids);
    if (identityError) throw identityError;
    const names = new Map((identities ?? []).map((identity: { user_id: string; display_name: string | null }) => [identity.user_id, identity.display_name || "—"]));
    const maySeeEmployeeAllocationEvidence = access.role === "admin" || batch.uploaded_by === user.id;
    return NextResponse.json({
      batch: { ...batch, salary_verification: maySeeEmployeeAllocationEvidence ? batch.salary_verification : null,
        uploader_name: names.get(batch.uploaded_by) ?? "—" },
      entries: maySeeEmployeeAllocationEvidence ? entries ?? [] : (entries ?? []).map((entry: Record<string, unknown>) => ({
        ...entry, assigned_employee_id: null, assigned_employee_name_snapshot: null,
        assignment_effective_from: null, assignment_effective_to: null
      })),
      history: (history ?? []).map((event: { actor_id: string }) => ({ ...event, actor_name: names.get(event.actor_id) ?? "—" })),
      approvals: (approvals ?? []).map((approval: { reviewer_id: string }) => ({ ...approval, reviewer_name: names.get(approval.reviewer_id) ?? "—" })),
      currentApprovals: currentApprovals ?? []
    });
  } catch (error) {
    if (error instanceof AdminApiError) {
      const errorCode = error.status === 403 ? "permission_denied" : error.status === 404 ? "draft_not_found" : "invalid_draft_request";
      return NextResponse.json({ error: error.message, errorCode }, { status: error.status });
    }
    return NextResponse.json({ error: "Unable to load financial draft details.", errorCode: "draft_detail_unavailable" }, { status: 500 });
  }
}

function errorResponse(error: unknown) {
  if (error instanceof BoundedRequestError) return NextResponse.json({ error: error.code, errorCode: error.code }, { status: 413 });
  if (error instanceof AdminApiError) {
    const errorCode = error.status === 403 ? "permission_denied" : "invalid_review_request";
    return NextResponse.json({ error: error.message, errorCode }, { status: error.status });
  }
  const message = String((error as { message?: unknown } | null)?.message ?? "");
  if (/does not exist|schema cache|PGRST20[245]/i.test(message)) {
    return NextResponse.json({ error: "Vehicle Financial Draft storage is not installed in this environment. Review and approve the additive Phase 2 migration before enabling persistence.", errorCode: "storage_not_installed" }, { status: 503 });
  }
  if (/forbidden|requires_validation|validation_requires_draft|content_changed|independent_reviewer|not_found|invalid_action|vehicle_finance_/i.test(message)) {
    return NextResponse.json({ error: "This review transition is not allowed for the current draft state or account.", errorCode: "review_transition_conflict" }, { status: 409 });
  }
  return NextResponse.json({ error: "Unable to update the financial draft review status.", errorCode: "review_transition_unavailable" }, { status: 500 });
}

export async function PATCH(request: Request, context: { params: Promise<{ batchId: string }> }) {
  if (isVehicleFinancialV4WriteLocked()) return disabledVehicleFinancialV4WriteResponse();
  try {
    const user = await requireVerifiedUser(request);
    const admin = createServerSupabaseAdmin();
    const access = await resolveAccountAccess(admin, user);
    const boundedRequest = await boundedRequestBody(request, 16 * 1024);
    const body = await boundedRequest.json();
    const action = body?.action;
    if (action !== "validate" && action !== "submit_review" && action !== "approve" && action !== "supersede") throw new AdminApiError(400, "Choose a supported review action.");
    const permission = action === "approve" || action === "supersede" ? "approve" : action === "validate" ? "validate" : "review";
    if (!canUseVehicleFinancialDrafts(access, permission)) throw new AdminApiError(403, "You do not have access to this review action.");
    const expectedHash = typeof body.expectedContentHash === "string" ? body.expectedContentHash : "";
    const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 2048) : "";
    if (!/^[a-f0-9]{64}$/i.test(expectedHash) || !reason) throw new AdminApiError(400, "A current content hash and review reason are required.");
    const expectedCurrent = body?.expectedCurrentApprovals;
    if (action === "supersede" && (!expectedCurrent || typeof expectedCurrent !== "object" || Array.isArray(expectedCurrent) ||
      Object.keys(expectedCurrent).length > 500 || Object.entries(expectedCurrent).some(([vehicleId, batchId]) =>
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(vehicleId) ||
        (batchId !== null && (typeof batchId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(batchId)))))) {
      throw new AdminApiError(400, "Supply the exact current vehicle approvals being superseded.");
    }
    const { batchId } = await context.params;
    const { data, error } = await admin.rpc("transition_vehicle_financial_draft", {
      p_batch_id: batchId,
      p_action: action,
      p_expected_hash: expectedHash,
      p_reason: reason,
      p_actor_id: user.id,
      p_expected_current: action === "supersede" ? expectedCurrent : null
    });
    if (error) throw error;
    return NextResponse.json({ batch: data });
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: "Request body must be valid JSON.", errorCode: "invalid_review_request" }, { status: 400 });
    return errorResponse(error);
  }
}
