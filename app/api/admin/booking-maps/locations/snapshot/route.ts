import { NextResponse } from "next/server";
import { AdminApiError, requireAdminAccess } from "@/lib/admin-user-management-server";
import { getLocationReviewSnapshot } from "@/lib/booking-maps-server";

export async function GET(request: Request) {
  try {
    const { admin } = await requireAdminAccess(request);
    const url = new URL(request.url);
    const name = url.searchParams.get("name")?.trim() ?? "";
    const side = url.searchParams.get("side");
    if (!name || (side !== "pickup" && side !== "dropoff")) {
      throw new AdminApiError(400, "Location name and pickup/drop-off type are required.");
    }
    return NextResponse.json({ snapshot: await getLocationReviewSnapshot(admin, { name, side }) });
  } catch (error) {
    if (error instanceof AdminApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Unable to create the location review snapshot." }, { status: 500 });
  }
}
