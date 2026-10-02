import { AdminApiError, requireAdminAccess } from "@/lib/admin-user-management-server";
import { readDriverProfile } from "@/lib/driver-profile-server";
import { DriverPortalError } from "@/lib/driver-portal-server";
export const dynamic = "force-dynamic";
export async function GET(request: Request, { params }: { params: Promise<{ accountId: string }> }) {
  try {
    const { admin } = await requireAdminAccess(request);
    const { accountId } = await params;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(accountId)) throw new AdminApiError(400, "Invalid account.");
    const account = await admin.from("driver_accounts").select("auth_user_id,driver_id,active").eq("id", accountId).maybeSingle();
    if (account.error) throw new AdminApiError(503, "Account unavailable.");
    if (!account.data) throw new AdminApiError(404, "Account not found.");
    const driver = await admin.from("drivers").select("id,name,vehicle_reg,active").eq("id", account.data.driver_id).maybeSingle();
    if (driver.error || !driver.data) throw new AdminApiError(503, "Driver unavailable.");
    const profile = await readDriverProfile(account.data.auth_user_id, { driverId: String(driver.data.id), driverName: driver.data.name, vehicleRegistration: driver.data.vehicle_reg });
    return Response.json({ profile, active: account.data.active === true && driver.data.active === true }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) { return Response.json({ error: "Profile unavailable." }, { status: e instanceof AdminApiError || e instanceof DriverPortalError ? e.status : 500, headers: { "Cache-Control": "private, no-store" } }); }
}
