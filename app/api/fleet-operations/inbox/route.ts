import { NextResponse } from "next/server";
import { AdminApiError } from "@/lib/admin-user-management-server";
import { requireFleetOfficeAccess } from "@/lib/fleet-operations-auth";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const uuid = /^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;

function errorResponse(error: unknown) {
  return NextResponse.json({ error: error instanceof AdminApiError ? error.message : "Fleet inbox is unavailable." },
    { status: error instanceof AdminApiError ? error.status : 503, headers });
}

export async function GET(request: Request) {
  try {
    const { user, admin } = await requireFleetOfficeAccess(request);
    const { data, error } = await admin.from("ees_fleet_notification_inbox")
      .select("id,category,severity,title_en,title_th,body_en,body_th,href,created_at,read_at,acknowledged_at")
      .eq("user_id", user.id).order("created_at", { ascending: false }).limit(100);
    if (error) throw error;
    return NextResponse.json({ notifications: data ?? [] }, { headers });
  } catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request) {
  try {
    const { user, admin } = await requireFleetOfficeAccess(request);
    const body: unknown = await request.json();
    const input = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
    if (typeof input.id !== "string" || !uuid.test(input.id) || !["read", "acknowledge"].includes(String(input.action))) {
      throw new AdminApiError(400, "Choose one notification and an action.");
    }
    const now = new Date().toISOString();
    const values = input.action === "read" ? { read_at: now } :
      { read_at: now, acknowledged_at: now, acknowledged_by: user.id };
    const field = input.action === "read" ? "read_at" : "acknowledged_at";
    const { data, error } = await admin.from("ees_fleet_notification_inbox")
      .update(values).eq("id", input.id).eq("user_id", user.id).is(field, null)
      .select("id,read_at,acknowledged_at").maybeSingle();
    if (error) throw error;
    if (!data) {
      const existing = await admin.from("ees_fleet_notification_inbox")
        .select("id,read_at,acknowledged_at").eq("id", input.id).eq("user_id", user.id).maybeSingle();
      if (existing.error) throw existing.error;
      if (!existing.data) throw new AdminApiError(404, "Notification not found.");
      return NextResponse.json({ notification: existing.data }, { headers });
    }
    return NextResponse.json({ notification: data }, { headers });
  } catch (error) { return errorResponse(error); }
}
