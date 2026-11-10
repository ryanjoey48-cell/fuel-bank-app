import { NextResponse } from "next/server";
import { AdminApiError } from "@/lib/admin-user-management-server";
import { requireFleetOfficeAccess } from "@/lib/fleet-operations-auth";
import { hasPermission } from "@/lib/authorization";
import { canViewJourneyDetail } from "@/lib/forth-playback-access";
import { createFleetSourceClient } from "@/lib/fleet-evidence-server";
import { bangkokDay } from "@/lib/fleet-intelligence";
import { MAX_RANGE_DAYS, loadRecurringAnalysis } from "@/lib/fleet-recurring-server";
import { buildCandidatePayload, expectedAreaMatches, isAreaId, isHandoffToken } from "@/lib/fleet-location-candidate";
import { createHandoff, dismissHandoff, readHandoff } from "@/lib/fleet-candidate-handoff";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

/**
 * V6.5. Candidate handoff from a recurring stopping area to the Locations Directory. Read only and never persistent.
 *  - create: the server recomputes the area from THIS user's own cached days (the browser supplies an area id and only a rough
 *    position to confirm which area was meant; it never supplies the coordinates that are used) and stores a short summary in
 *    server memory under an unguessable token.
 *  - open: returns that summary to the same user only.
 *  - dismiss: forgets it.
 * Every action requires the same server-side authorisation as historical journeys. No coordinates travel in a URL.
 */
export async function POST(request: Request) {
  try {
    const { user, access } = await requireFleetOfficeAccess(request);
    if (!canViewJourneyDetail({ access, userId: user.id, checkPermission: hasPermission })) throw new AdminApiError(403, "Candidate locations use historical journeys and need administrator authorisation.");
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") throw new AdminApiError(400, "Invalid request.");
    const action = body.action;

    if (action === "open" || action === "dismiss") {
      if (!isHandoffToken(body.token)) throw new AdminApiError(400, "Invalid candidate reference.");
      if (action === "dismiss") { dismissHandoff(user.id, body.token); return NextResponse.json({ dismissed: true }, { headers }); }
      const read = readHandoff(user.id, body.token);
      if (read.status === "expired") throw new AdminApiError(410, "This suggestion has expired. Open it again from Fleet Tracking.");
      if (read.status === "not_found") throw new AdminApiError(404, "This suggestion is not available.");
      return NextResponse.json({ candidate: read.payload }, { headers });
    }

    if (action !== "create") throw new AdminApiError(400, "Unknown action.");
    const from = typeof body.from === "string" ? body.from : "", to = typeof body.to === "string" ? body.to : "";
    const vehicleId = typeof body.vehicleId === "string" && body.vehicleId.length > 0 && body.vehicleId.length <= 80 ? body.vehicleId : null;
    try {
      const a = bangkokDay(from), b = bangkokDay(to);
      if (b.start > Date.now() || a.start > b.start || (b.start - a.start) / 86_400_000 > MAX_RANGE_DAYS - 1) throw new Error();
      if (!isAreaId(body.areaId)) throw new Error();
      if (body.vehicleId !== undefined && body.vehicleId !== null && vehicleId === null) throw new Error();
    } catch { throw new AdminApiError(400, "Choose a valid recurring area and date range."); }

    let result;
    try { result = await loadRecurringAnalysis({ client: createFleetSourceClient(request), userId: user.id, from, to, vehicleId }); }
    catch (error) { if ((error as { status?: number }).status === 503) throw new AdminApiError(503, "Vehicle registry is unavailable or exceeds the bounded scope."); throw error; }
    if (result.vehicleDaysIncluded === 0) throw new AdminApiError(410, "The vehicle-days behind this area are no longer in your session. Read them again first.");
    const area = result.analysis.areas.find(candidate => candidate.id === body.areaId);
    if (!area) throw new AdminApiError(404, "That area is no longer in the analysis. Refresh the list.");
    // A consistency check only: the list may have changed between the click and now, which would shift area ids.
    if (!expectedAreaMatches(body.expected as { latitude?: unknown; longitude?: unknown } | null, area)) throw new AdminApiError(409, "The list changed since you opened it. Refresh and choose the area again.");
    const payload = buildCandidatePayload({ area, from, to, vehicleDaysIncluded: result.vehicleDaysIncluded, vehicleDaysInRange: result.vehicleDaysInRange, limits: result.analysis.limits });
    const handoff = createHandoff(user.id, payload);
    return NextResponse.json({ token: handoff.token, expiresAt: handoff.expiresAt }, { status: 201, headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof AdminApiError ? error.message : "Candidate handoff is unavailable." }, { status: error instanceof AdminApiError ? error.status : 503, headers });
  }
}
