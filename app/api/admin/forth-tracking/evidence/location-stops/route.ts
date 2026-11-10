import { NextResponse } from "next/server";
import { AdminApiError } from "@/lib/admin-user-management-server";
import { requireFleetOfficeAccess } from "@/lib/fleet-operations-auth";
import { hasPermission } from "@/lib/authorization";
import { canViewJourneyDetail } from "@/lib/forth-playback-access";
import { createFleetSourceClient } from "@/lib/fleet-evidence-server";
import { bangkokDay } from "@/lib/fleet-intelligence";
import { recalledProviderDay } from "@/lib/fleet-intelligence-session";
import { buildLocationEvidence, observationsFromProviderDay } from "@/lib/fleet-location-evidence";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

/**
 * Stage B, read only. Candidate stops for the Locations Directory pin editor, taken ONLY from a provider day this user has
 * already read (the 30-minute server memory entry). It never calls Forth, never writes, never saves a pin, and it returns
 * coordinates only to callers allowed to view historical journeys. The anchor travels in the POST body, never in the URL.
 */
export async function POST(request: Request) {
  try {
    const { user, access } = await requireFleetOfficeAccess(request);
    if (!canViewJourneyDetail({ access, userId: user.id, checkPermission: hasPermission })) throw new AdminApiError(403, "Stop evidence uses historical journeys and needs administrator authorisation.");
    const body = (await request.json().catch(() => null)) as { vehicleId?: unknown; day?: unknown; anchor?: { latitude?: unknown; longitude?: unknown } | null; searchRadiusM?: unknown } | null;
    const vehicleId = typeof body?.vehicleId === "string" ? body.vehicleId : "", day = typeof body?.day === "string" ? body.day : "";
    try { if (!vehicleId || vehicleId.length > 80 || bangkokDay(day).start > Date.now()) throw new Error(); } catch { throw new AdminApiError(400, "Choose one vehicle and a valid Bangkok day."); }
    const a = body?.anchor;
    const anchor = a && typeof a.latitude === "number" && typeof a.longitude === "number" ? { latitude: a.latitude, longitude: a.longitude } : null;
    const radius = typeof body?.searchRadiusM === "number" && Number.isFinite(body.searchRadiusM) ? body.searchRadiusM : undefined;
    const client = createFleetSourceClient(request);
    const vehicle = await client.from("vehicles").select("id,vehicle_reg").eq("id", vehicleId).single();
    if (vehicle.error || !vehicle.data?.vehicle_reg) throw new AdminApiError(404, "Vehicle identity is unavailable.");
    const provider = recalledProviderDay(user.id, vehicleId, vehicle.data.vehicle_reg, day);
    if (!provider) return NextResponse.json({ status: "day_not_read", message: "Read this vehicle-day from Forth first (a separate, explicit read).", registration: vehicle.data.vehicle_reg, day }, { headers });
    const evidence = buildLocationEvidence({ observations: observationsFromProviderDay(provider), anchor, searchRadiusM: radius });
    return NextResponse.json({ status: "ready", registration: vehicle.data.vehicle_reg, day, provider: { observations: provider.gps.observations, verifiedObservations: provider.gps.verifiedObservations }, evidence, saved: false }, { headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof AdminApiError ? error.message : "Stop evidence is unavailable." }, { status: error instanceof AdminApiError ? error.status : 503, headers });
  }
}
