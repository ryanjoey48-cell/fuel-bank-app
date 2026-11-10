import { NextResponse } from "next/server";
import { AdminApiError } from "@/lib/admin-user-management-server";
import { requireFleetOfficeAccess } from "@/lib/fleet-operations-auth";
import { hasPermission } from "@/lib/authorization";
import { canViewJourneyDetail } from "@/lib/forth-playback-access";
import { createFleetSourceClient } from "@/lib/fleet-evidence-server";
import { bangkokDay } from "@/lib/fleet-intelligence";
import { loadDayPlaces } from "@/lib/fleet-day-places-server";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

/**
 * V7.3, read only. Named stops and driver attribution for one vehicle-day the caller has ALREADY read in their own server memory.
 * It never calls Forth and never writes. Stop positions are matched to the saved directory on the server and only names, distances
 * and times are returned, so no coordinates reach the browser. Same authorisation as historical journeys.
 */
export async function GET(request: Request) {
  try {
    const { user, access } = await requireFleetOfficeAccess(request);
    if (!canViewJourneyDetail({ access, userId: user.id, checkPermission: hasPermission })) throw new AdminApiError(403, "Named stops use historical journeys and need administrator authorisation.");
    const params = new URL(request.url).searchParams;
    const vehicleId = params.get("vehicleId") ?? "", day = params.get("day") ?? "";
    try { const d = bangkokDay(day); if (d.start > Date.now() || vehicleId.length === 0 || vehicleId.length > 80) throw new Error(); }
    catch { throw new AdminApiError(400, "Choose a vehicle and a valid Bangkok day."); }
    let result;
    try { result = await loadDayPlaces({ client: createFleetSourceClient(request), userId: user.id, vehicleId, day, canSeeDriverNames: hasPermission(access, "business:read") }); }
    catch (error) {
      const status = (error as { status?: number }).status;
      if (status === 503) throw new AdminApiError(503, "Vehicle registry is unavailable or exceeds the bounded scope.");
      if (status === 404) throw new AdminApiError(404, "This vehicle cannot be matched to exactly one active registry record.");
      throw error;
    }
    return NextResponse.json({ ...result, note: "Only a vehicle-day you have already read in this session is used. Nothing was requested from Forth." }, { headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof AdminApiError ? error.message : "Named stops are unavailable." }, { status: error instanceof AdminApiError ? error.status : 503, headers });
  }
}
