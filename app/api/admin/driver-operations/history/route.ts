import { AdminApiError, requireAdminAccess } from "@/lib/admin-user-management-server";
import { DriverPortalError } from "@/lib/driver-portal-server";
import { operationsHistory } from "@/lib/driver-work-server";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try { const { admin } = await requireAdminAccess(request); return Response.json(await operationsHistory(admin, new URL(request.url).searchParams), { headers: { "Cache-Control": "private, no-store" } }); }
  catch (e) { if (!(e instanceof AdminApiError) || e.status >= 500) console.error("Driver Operations history failed", e); return Response.json({ error: "History unavailable." }, { status: e instanceof AdminApiError || e instanceof DriverPortalError ? e.status : 500, headers: { "Cache-Control": "private, no-store" } }); }
}
