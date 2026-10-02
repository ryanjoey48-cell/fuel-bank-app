import { NextResponse } from "next/server";
import { AdminApiError, requireAdminAccess } from "@/lib/admin-user-management-server";

export async function GET(request: Request) {
  try {
    const { admin } = await requireAdminAccess(request);
    const { data, error } = await admin.from("drivers")
      .select("id,name,vehicle_reg").eq("active", true).order("name", { ascending: true });
    if (error) throw new AdminApiError(503, "Unable to load active drivers. Refresh to try again.");
    return NextResponse.json({ drivers: (data ?? []).map((row) => ({
      id: String(row.id), name: String(row.name),
      vehicleRegistration: row.vehicle_reg ? String(row.vehicle_reg) : null
    })) });
  } catch (error) {
    if (error instanceof AdminApiError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Unable to load active drivers." }, { status: 500 });
  }
}
