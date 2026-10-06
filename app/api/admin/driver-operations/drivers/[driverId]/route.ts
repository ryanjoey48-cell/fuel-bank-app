import { AdminApiError, requireAdminAccess } from "@/lib/admin-user-management-server";
import { DriverPortalError } from "@/lib/driver-portal-server";
import { operationsDriverDetail } from "@/lib/driver-work-server";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ driverId: string }> }) {
  try {
    const { admin } = await requireAdminAccess(request);
    const { driverId } = await context.params;
    return Response.json(await operationsDriverDetail(admin, driverId), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const status = error instanceof AdminApiError || error instanceof DriverPortalError ? error.status : 500;
    if (status >= 500) console.error("Driver Operations driver detail failed", error);
    return Response.json({ error: "Driver detail unavailable." }, { status, headers: { "Cache-Control": "private, no-store" } });
  }
}
