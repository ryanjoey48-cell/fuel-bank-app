import { NextResponse } from "next/server";
import { hasPermission } from "@/lib/authorization";
import { AdminApiError } from "@/lib/admin-user-management-server";
import { requireFleetOfficeAccess } from "@/lib/fleet-operations-auth";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const uuid = /^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;

function responseError(error: unknown) {
  return NextResponse.json({ error: error instanceof AdminApiError ? error.message : "Geofence configuration is unavailable." },
    { status: error instanceof AdminApiError ? error.status : 503, headers });
}

export async function GET(request: Request) {
  try {
    const { admin, access } = await requireFleetOfficeAccess(request);
    const { data, count, error } = await admin.from("ees_fleet_geofence_zones")
      .select("location_id,radius_meters,entry_dwell_seconds,exit_dwell_seconds,hysteresis_meters,active,updated_at", { count: "exact" })
      .order("updated_at", { ascending: false }).limit(1000);
    if (error) throw error;
    if (count === null || count > (data?.length ?? 0)) throw new Error("Zone list exceeds the safe bound.");
    let history: unknown[] = [];
    if (hasPermission(access, "admin:user_management")) {
      const result = await admin.from("ees_fleet_geofence_zone_history")
        .select("id,location_id,old_configuration,new_configuration,reason,actor_user_id,changed_at")
        .order("changed_at", { ascending: false }).limit(50);
      if (result.error) throw result.error;
      history = result.data ?? [];
    }
    return NextResponse.json({ zones: data ?? [], history }, { headers });
  } catch (error) { return responseError(error); }
}

export async function PUT(request: Request) {
  try {
    const { user, admin, access } = await requireFleetOfficeAccess(request, true);
    if (!hasPermission(access, "admin:user_management")) throw new AdminApiError(403, "Only EES administrators can change geofences.");
    const raw: unknown = await request.json();
    const body = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
    const integer = (value: unknown, min: number, max: number) => typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
    if (typeof body.locationId !== "string" || !uuid.test(body.locationId) ||
      !integer(body.radiusMeters, 25, 5000) || !integer(body.entryDwellSeconds, 0, 3600) ||
      !integer(body.exitDwellSeconds, 0, 3600) || !integer(body.hysteresisMeters, 0, 500) ||
      (body.hysteresisMeters as number) > (body.radiusMeters as number) || typeof body.active !== "boolean" ||
      typeof body.reason !== "string" || body.reason.trim().length < 5 || body.reason.trim().length > 500) {
      throw new AdminApiError(400, "Choose valid radius, dwell, hysteresis, activation and audit reason values.");
    }
    const location = await admin.from("ees_locations").select("id,verification_status,is_active")
      .eq("id", body.locationId).maybeSingle();
    if (location.error) throw location.error;
    if (!location.data) throw new AdminApiError(404, "EES location not found.");
    if (body.active && (!location.data.is_active || location.data.verification_status !== "verified")) {
      throw new AdminApiError(409, "Verify and activate the EES Directory record first.");
    }
    if (body.active) {
      const pin = await admin.from("ees_location_map_pins").select("id")
        .eq("location_id", body.locationId).eq("pin_type", "destination")
        .eq("pin_status", "manual_confirmed").maybeSingle();
      if (pin.error || !pin.data) throw new AdminApiError(409, "Confirm the destination coordinate pin first.");
    }
    const { error } = await admin.rpc("set_ees_fleet_geofence_zone", {
      p_location_id: body.locationId, p_radius_meters: body.radiusMeters,
      p_entry_dwell_seconds: body.entryDwellSeconds, p_exit_dwell_seconds: body.exitDwellSeconds,
      p_hysteresis_meters: body.hysteresisMeters, p_active: body.active,
      p_actor_user_id: user.id, p_reason: body.reason.trim()
    });
    if (error) throw error;
    return NextResponse.json({ saved: true }, { headers });
  } catch (error) { return responseError(error); }
}
