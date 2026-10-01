import { NextResponse } from "next/server";
import { AdminApiError, canReviewAccessRequests, requireAdminAccess } from "@/lib/admin-user-management-server";

export async function GET(request: Request) {
  try {
    const { admin, user } = await requireAdminAccess(request);
    const [{ data: requests, error: requestError }, { data: drivers, error: driverError }] = await Promise.all([
      admin
        .from("driver_access_requests")
        .select("id,auth_user_id,full_name,email,phone,requested_account_type,status,requested_at,reviewed_at,linked_driver_id,rejection_reason")
        .eq("status", "pending")
        .order("requested_at", { ascending: true }),
      admin
        .from("drivers")
        .select("id,name,vehicle_reg,active")
        .eq("active", true)
        .order("name", { ascending: true })
    ]);

    if (requestError || driverError) {
      const error = requestError || driverError;
      if (error?.code === "42P01" || error?.code === "PGRST205") {
        throw new AdminApiError(503, "Access request setup is not installed.");
      }
      throw error;
    }

    return NextResponse.json({
      canReview: canReviewAccessRequests(user.id),
      requests: (requests ?? []).map((row) => ({
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
      })),
      drivers: (drivers ?? []).map((driver) => ({
        id: String(driver.id),
        name: String(driver.name),
        vehicleRegistration: driver.vehicle_reg ? String(driver.vehicle_reg) : null
      }))
    });
  } catch (error) {
    if (error instanceof AdminApiError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Unable to load pending access requests." }, { status: 500 });
  }
}
