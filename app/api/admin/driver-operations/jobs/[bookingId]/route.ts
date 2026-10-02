import { AdminApiError, requireAdminAccess } from "@/lib/admin-user-management-server";
import { DRIVER_JOB_SELECT, DriverPortalError } from "@/lib/driver-portal-server";
import { operationsRows } from "@/lib/driver-work-server";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ bookingId: string }> }) {
  try {
    const { admin } = await requireAdminAccess(request); const { bookingId } = await context.params;
    if (!/^[0-9a-f-]{36}$/i.test(bookingId)) throw new AdminApiError(400, "Invalid job.");
    const result = await admin.from("booking_diary").select(`${DRIVER_JOB_SELECT},driver_id`).eq("id", bookingId).maybeSingle();
    if (result.error) throw new AdminApiError(503, "Job unavailable.");
    const booking = result.data as unknown as Record<string, unknown> | null;
    if (!booking?.driver_id) throw new AdminApiError(404, "Job not found.");
    const rows = await operationsRows(admin, [booking]);
    return Response.json(rows[0], { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) { return Response.json({ error: "Job unavailable." }, { status: e instanceof AdminApiError || e instanceof DriverPortalError ? e.status : 500, headers: { "Cache-Control": "private, no-store" } }); }
}
