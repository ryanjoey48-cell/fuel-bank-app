import { NextResponse } from "next/server";
import { AdminApiError } from "@/lib/admin-user-management-server";
import { requireFleetOfficeAccess } from "@/lib/fleet-operations-auth";
import { hasPermission } from "@/lib/authorization";
import { canViewJourneyDetail } from "@/lib/forth-playback-access";
import { createFleetSourceClient } from "@/lib/fleet-evidence-server";
import { bangkokDay } from "@/lib/fleet-intelligence";
import { loadVisitMap } from "@/lib/fleet-visit-map-server";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

/**
 * V7.8, read only. Map evidence for ONE visit of ONE vehicle-day the caller has already read in their own server memory.
 * Same authorisation as historical journeys. It never calls Forth and never writes. The request carries only ids and a day
 * (never coordinates); positions are bounded and returned in the response body to the authorised caller only.
 */
export async function GET(request: Request) {
  try {
    const { user, access } = await requireFleetOfficeAccess(request);
    if (!canViewJourneyDetail({ access, userId: user.id, checkPermission: hasPermission })) throw new AdminApiError(403, "Visit maps use historical positions and need administrator authorisation.");
    const params = new URL(request.url).searchParams;
    const vehicleId = params.get("vehicleId") ?? "", day = params.get("day") ?? "", visit = params.get("visit") ?? "";
    try { const d = bangkokDay(day); if (d.start > Date.now() || vehicleId.length === 0 || vehicleId.length > 80 || !/^V\d{2,3}$/.test(visit)) throw new Error(); }
    catch { throw new AdminApiError(400, "Choose a vehicle, a valid Bangkok day and a visit."); }
    let result;
    try { result = await loadVisitMap({ client: createFleetSourceClient(request), userId: user.id, vehicleId, day, visitId: visit }); }
    catch (error) {
      const status = (error as { status?: number }).status;
      if (status === 503) throw new AdminApiError(503, "Vehicle registry is unavailable or exceeds the bounded scope.");
      if (status === 404) throw new AdminApiError(404, "This vehicle cannot be matched to exactly one active registry record.");
      throw error;
    }
    return NextResponse.json({ ...result, note: "Only a vehicle-day you have already read in this session is used. Nothing was requested from Forth." }, { headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof AdminApiError ? error.message : "The visit map is unavailable." }, { status: error instanceof AdminApiError ? error.status : 503, headers });
  }
}
