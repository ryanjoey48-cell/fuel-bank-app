import { NextResponse } from "next/server";
import { AdminApiError, canReviewAccessRequests, requireAdminAccess } from "@/lib/admin-user-management-server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { admin, user } = await requireAdminAccess(request);
    const debug = process.env.EES_ACCESS_REQUEST_DEBUG === "1" && process.env.NODE_ENV !== "production";
    if (debug) {
      const all = await admin.from("driver_access_requests").select("id,status,email").limit(20);
      console.info("[access-request-query]", {
        userId: user.id,
        canReview: canReviewAccessRequests(user.id),
        clientHost: new URL((admin as unknown as { supabaseUrl: string }).supabaseUrl).hostname,
        serviceRoleConfigured: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
        unfilteredCount: all.data?.length ?? null,
        error: all.error ? { code: all.error.code, message: all.error.message } : null
      });
    }
    const { data: requests, error: requestError } = await
      admin
        .from("driver_access_requests")
        .select("id,auth_user_id,full_name,email,phone,requested_account_type,status,requested_at,reviewed_at,linked_driver_id,rejection_reason")
        .eq("status", "pending")
        .order("requested_at", { ascending: true });

    if (debug) console.info("[access-request-query]", {
      pendingCount: requests?.length ?? null,
      error: requestError ? { code: requestError.code, message: requestError.message } : null
    });

    if (requestError) {
      const error = requestError;
      if (error?.code === "42P01" || error?.code === "PGRST205") {
        throw new AdminApiError(503, "Access request setup is not installed.");
      }
      if (!error.code && /fetch failed|network|connect/i.test(error.message)) {
        throw new AdminApiError(503, "Unable to reach the access request service. Refresh to try again.");
      }
      throw error;
    }
    if (!Array.isArray(requests)) throw new AdminApiError(500, "Invalid access request service response.");

    return NextResponse.json({
      canReview: canReviewAccessRequests(user.id),
      requests: requests.map((row) => ({
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
      }))
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof AdminApiError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Unable to load pending access requests." }, { status: 500 });
  }
}
