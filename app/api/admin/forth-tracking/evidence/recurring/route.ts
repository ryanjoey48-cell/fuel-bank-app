import { NextResponse } from "next/server";
import { AdminApiError } from "@/lib/admin-user-management-server";
import { requireFleetOfficeAccess } from "@/lib/fleet-operations-auth";
import { hasPermission } from "@/lib/authorization";
import { canViewJourneyDetail } from "@/lib/forth-playback-access";
import { createFleetSourceClient } from "@/lib/fleet-evidence-server";
import { bangkokDay } from "@/lib/fleet-intelligence";
import { MAX_RANGE_DAYS, loadRecurringAnalysis } from "@/lib/fleet-recurring-server";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

/**
 * V6.4, read only. Recurring stopping areas from the vehicle-days THIS user has already read (their own 30-minute server memory
 * entries). It never calls Forth, never writes, and returns coordinates only to callers allowed to view historical journeys
 * (decided here, on the server). Positions themselves are never returned: only area summaries.
 */
export async function GET(request: Request) {
  try {
    const { user, access } = await requireFleetOfficeAccess(request);
    if (!canViewJourneyDetail({ access, userId: user.id, checkPermission: hasPermission })) throw new AdminApiError(403, "Recurring places use historical journeys and need administrator authorisation.");
    const params = new URL(request.url).searchParams;
    const from = params.get("from") ?? "", to = params.get("to") ?? "", onlyVehicle = params.get("vehicleId");
    try {
      const a = bangkokDay(from), b = bangkokDay(to);
      if (b.start > Date.now() || a.start > b.start || (b.start - a.start) / 86_400_000 > MAX_RANGE_DAYS - 1) throw new Error();
      if (onlyVehicle !== null && (onlyVehicle.length === 0 || onlyVehicle.length > 80)) throw new Error();
    } catch { throw new AdminApiError(400, `Choose a valid Bangkok date range of at most ${MAX_RANGE_DAYS} days.`); }
    let result;
    try { result = await loadRecurringAnalysis({ client: createFleetSourceClient(request), userId: user.id, from, to, vehicleId: onlyVehicle }); }
    catch (error) { if ((error as { status?: number }).status === 503) throw new AdminApiError(503, "Vehicle registry is unavailable or exceeds the bounded scope."); throw error; }
    return NextResponse.json({ range: { from, to }, ...result, note: "Only vehicle-days you have already read in this session are included. Nothing was requested from Forth." }, { headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof AdminApiError ? error.message : "Recurring places are unavailable." }, { status: error instanceof AdminApiError ? error.status : 503, headers });
  }
}
