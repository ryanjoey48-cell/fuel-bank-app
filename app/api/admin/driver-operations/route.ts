import { AdminApiError, requireAdminAccess } from "@/lib/admin-user-management-server";
import { driverOperations } from "@/lib/driver-work-server";
import { DriverPortalError } from "@/lib/driver-portal-server";
import { evaluatePickupWaits } from "@/lib/driver-notifications-server";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try { const { admin } = await requireAdminAccess(request); await evaluatePickupWaits(admin); return Response.json(await driverOperations(admin), { headers: { "Cache-Control": "private, no-store" } }); }
  catch (e) { if (!(e instanceof AdminApiError) || e.status >= 500) console.error("Driver Operations refresh failed", e); return Response.json({ error: "Driver Operations unavailable." }, { status: e instanceof AdminApiError || e instanceof DriverPortalError ? e.status : 500, headers: { "Cache-Control": "private, no-store" } }); }
}
