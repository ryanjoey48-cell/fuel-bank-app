import { NextResponse } from "next/server";
import { AdminApiError, requireAdminAccess } from "@/lib/admin-user-management-server";
import { countAliasImpact, countRouteContextImpact } from "@/lib/booking-maps-server";

export async function GET(request: Request) {
  try {
    const { admin } = await requireAdminAccess(request);
    const url = new URL(request.url);
    const alias = url.searchParams.get("alias") ?? "";
    const clientId = url.searchParams.get("clientId") || null;
    const side = url.searchParams.get("side");
    const pickup = url.searchParams.get("pickup");
    const dropoff = url.searchParams.get("dropoff");
    if (side !== "pickup" && side !== "dropoff") {
      throw new AdminApiError(400, "Pickup or drop-off type is required.");
    }
    const impact = pickup?.trim() && dropoff?.trim()
      ? await countRouteContextImpact(admin, { alias, clientId, side, pickup, dropoff })
      : await countAliasImpact(admin, alias, clientId, side);
    return NextResponse.json(impact);
  } catch (error) {
    if (error instanceof AdminApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Unable to calculate the location impact." }, { status: 500 });
  }
}
