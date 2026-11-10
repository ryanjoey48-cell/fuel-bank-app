import { NextResponse } from "next/server";
import { AdminApiError } from "@/lib/admin-user-management-server";
import { requireFleetOfficeAccess } from "@/lib/fleet-operations-auth";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const categories = ["arrivals", "departures", "extended_visits", "tracker_incidents", "gps_incidents", "speed_alerts"] as const;
const defaults = Object.fromEntries(categories.map((key) => [key, false]));

function errorResponse(error: unknown) {
  return NextResponse.json({ error: error instanceof AdminApiError ? error.message : "Notification preferences are unavailable." },
    { status: error instanceof AdminApiError ? error.status : 503, headers });
}

export async function GET(request: Request) {
  try {
    const { user, admin } = await requireFleetOfficeAccess(request);
    const { data, error } = await admin.from("ees_fleet_notification_preferences")
      .select("arrivals,departures,extended_visits,tracker_incidents,gps_incidents,speed_alerts,quiet_start,quiet_end,time_zone")
      .eq("user_id", user.id).maybeSingle();
    if (error) throw error;
    return NextResponse.json({ preferences: data ?? { ...defaults, quiet_start: null, quiet_end: null, time_zone: "Asia/Bangkok" } }, { headers });
  } catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request) {
  try {
    const { user, admin } = await requireFleetOfficeAccess(request);
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new AdminApiError(400, "Invalid preferences.");
    const input = body as Record<string, unknown>;
    const changes: Record<string, unknown> = {};
    for (const key of categories) {
      if (!(key in input)) continue;
      if (typeof input[key] !== "boolean") throw new AdminApiError(400, "Notification categories must be on or off.");
      changes[key] = input[key];
    }
    if ("quiet_start" in input || "quiet_end" in input) {
      const validTime = (value: unknown) => value === null || typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d(:00)?$/.test(value);
      if (!validTime(input.quiet_start) || !validTime(input.quiet_end) || (input.quiet_start === null) !== (input.quiet_end === null)) {
        throw new AdminApiError(400, "Choose a valid quiet-hours range or clear both times.");
      }
      changes.quiet_start = input.quiet_start;
      changes.quiet_end = input.quiet_end;
    }
    if (!Object.keys(changes).length) throw new AdminApiError(400, "No preferences were provided.");
    const existing = await admin.from("ees_fleet_notification_preferences")
      .select("arrivals,departures,extended_visits,tracker_incidents,gps_incidents,speed_alerts,quiet_start,quiet_end,time_zone")
      .eq("user_id", user.id).maybeSingle();
    if (existing.error) throw existing.error;
    const { data, error } = await admin.from("ees_fleet_notification_preferences")
      .upsert({ user_id: user.id, ...defaults, quiet_start: null, quiet_end: null,
        time_zone: "Asia/Bangkok", ...existing.data, ...changes, updated_at: new Date().toISOString() }, { onConflict: "user_id" })
      .select("arrivals,departures,extended_visits,tracker_incidents,gps_incidents,speed_alerts,quiet_start,quiet_end,time_zone").single();
    if (error) throw error;
    return NextResponse.json({ preferences: data }, { headers });
  } catch (error) { return errorResponse(error); }
}
