import { AdminApiError, requireAdminAccess } from "@/lib/admin-user-management-server";
import { DriverPortalError } from "@/lib/driver-portal-server";
import { readOperationalNotifications } from "@/lib/driver-notifications-server";
import { limitedBody } from "@/lib/driver-profile-api";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
export async function GET(request: Request) {
  try { const { admin, user } = await requireAdminAccess(request); return Response.json(await readOperationalNotifications(admin, user.id), { headers }); }
  catch (e) { return Response.json({ error: "Notifications unavailable." }, { status: e instanceof AdminApiError || e instanceof DriverPortalError ? e.status : 500, headers }); }
}
export async function PATCH(request: Request) {
  try {
    if (request.headers.get("origin") !== new URL(request.url).origin) throw new AdminApiError(403, "Invalid origin.");
    const { admin, user } = await requireAdminAccess(request);
    if (Number(request.headers.get("content-length")) > 1024) throw new AdminApiError(413, "Request too large.");
    const body = new TextDecoder().decode(await limitedBody(request, 1024));
    let value: { id?: unknown; all?: unknown };
    try { value = JSON.parse(body); } catch { throw new AdminApiError(400, "Invalid request."); }
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !["id", "all"].includes(key)) ||
      !(value.all === true && value.id === undefined || value.all === undefined && typeof value.id === "string" && /^[0-9a-f-]{36}$/i.test(value.id))) throw new AdminApiError(400, "Invalid request.");
    const result = await admin.rpc("read_driver_operational_notification", { p_recipient_user_id: user.id, p_notification_id: value.all === true ? null : value.id });
    if (result.error) throw new AdminApiError(503, "Unable to mark read.");
    return Response.json({ saved: true }, { headers });
  } catch (e) { return Response.json({ error: "Unable to mark notification read." }, { status: e instanceof AdminApiError || e instanceof DriverPortalError ? e.status : 500, headers }); }
}
