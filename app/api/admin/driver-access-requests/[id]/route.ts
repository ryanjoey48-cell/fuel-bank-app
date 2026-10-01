import { NextResponse } from "next/server";
import { AdminApiError, requireAccessRequestApprover, requireAdminAccess } from "@/lib/admin-user-management-server";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { admin, user } = await requireAdminAccess(request);
    requireAccessRequestApprover(user.id);
    const { id } = await params;
    const body = await request.json().catch(() => ({})) as {
      decision?: unknown;
      driverId?: unknown;
      rejectionReason?: unknown;
    };
    const decision = body.decision === "approved" || body.decision === "rejected" ? body.decision : null;
    if (!decision) throw new AdminApiError(400, "Choose Approve or Reject.");

    const driverId = typeof body.driverId === "string" && /^[0-9a-f-]{1,64}$/i.test(body.driverId)
      ? body.driverId
      : null;
    const { data, error } = await admin.rpc("review_driver_access_request", {
      p_request_id: id,
      p_decision: decision,
      p_linked_driver_id: driverId,
      p_rejection_reason: typeof body.rejectionReason === "string" ? body.rejectionReason.slice(0, 500) : null,
      p_reviewed_by: user.id
    }).single();

    if (error) {
      if (error.code === "23505") throw new AdminApiError(409, "That driver is already linked to another account.");
      if (error.code === "PGRST202" || error.code === "42883") throw new AdminApiError(503, "Access request setup is not installed.");
      throw new AdminApiError(400, error.message || "Unable to review access request.");
    }

    const row = data as Record<string, unknown>;
    return NextResponse.json({
      request: {
        id: String(row.id),
        authUserId: String(row.auth_user_id),
        fullName: String(row.full_name),
        email: String(row.email),
        phone: String(row.phone),
        requestedAccountType: row.requested_account_type === "office_staff" ? "office_staff" : "driver",
        status: row.status,
        requestedAt: String(row.requested_at),
        reviewedAt: row.reviewed_at ? String(row.reviewed_at) : null,
        linkedDriverId: row.linked_driver_id == null ? null : String(row.linked_driver_id),
        rejectionReason: row.rejection_reason ? String(row.rejection_reason) : null
      }
    });
  } catch (error) {
    if (error instanceof AdminApiError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Unable to review access request." }, { status: 500 });
  }
}
