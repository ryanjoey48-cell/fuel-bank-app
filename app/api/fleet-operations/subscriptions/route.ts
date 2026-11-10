import { NextResponse } from "next/server";
import { AdminApiError } from "@/lib/admin-user-management-server";
import { requireFleetOfficeAccess } from "@/lib/fleet-operations-auth";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

function endpointAllowed(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && !url.username && !url.password && !url.port &&
      (host.endsWith(".push.apple.com") || host === "push.apple.com" ||
        host === "fcm.googleapis.com" || host.endsWith(".push.services.mozilla.com"));
  } catch { return false; }
}

function subscriptionBody(value: unknown) {
  const body = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const keys = body.keys && typeof body.keys === "object" ? body.keys as Record<string, unknown> : {};
  if (!endpointAllowed(body.endpoint) || typeof keys.p256dh !== "string" || !/^[A-Za-z0-9_-]{20,512}$/.test(keys.p256dh) ||
      typeof keys.auth !== "string" || !/^[A-Za-z0-9_-]{8,512}$/.test(keys.auth)) {
    throw new AdminApiError(400, "A valid browser push subscription is required.");
  }
  return { endpoint: body.endpoint, p256dh: keys.p256dh, auth_secret: keys.auth };
}

function errorResponse(error: unknown) {
  const status = error instanceof AdminApiError ? error.status : 503;
  return NextResponse.json({ error: error instanceof AdminApiError ? error.message : "Push subscription storage is unavailable." }, { status, headers });
}

export async function GET(request: Request) {
  try {
    const { user, admin } = await requireFleetOfficeAccess(request);
    const { count, error } = await admin.from("ees_fleet_push_subscriptions").select("id", { count: "exact", head: true })
      .eq("user_id", user.id).is("disabled_at", null);
    if (error) throw error;
    return NextResponse.json({ activeDevices: count ?? 0,
      vapidPublicKey: process.env.EES_WEB_PUSH_VAPID_PUBLIC_KEY || null,
      serverTestEnabled: process.env.EES_WEB_PUSH_TEST_ENABLED === "true" }, { headers });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const { user, admin } = await requireFleetOfficeAccess(request);
    const body = subscriptionBody(await request.json());
    const now = new Date().toISOString();
    const inserted = await admin.from("ees_fleet_push_subscriptions")
      .insert({ ...body, user_id: user.id, last_seen_at: now }).select("id").single();
    const { error } = inserted;
    let subscriptionId = inserted.data?.id;
    if (error) {
      if (error.code !== "23505") throw error;
      const existing = await admin.from("ees_fleet_push_subscriptions").select("id,user_id")
        .eq("endpoint", body.endpoint).maybeSingle();
      if (existing.error || !existing.data || existing.data.user_id !== user.id) {
        throw new AdminApiError(409, "This device subscription belongs to another account.");
      }
      const updated = await admin.from("ees_fleet_push_subscriptions")
        .update({ p256dh: body.p256dh, auth_secret: body.auth_secret, last_seen_at: now,
          disabled_at: null, failure_count: 0 }).eq("id", existing.data.id).eq("user_id", user.id);
      if (updated.error) throw updated.error;
      subscriptionId = existing.data.id;
    }
    return NextResponse.json({ subscribed: true, subscriptionId }, { headers });
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: Request) {
  try {
    const { user, admin } = await requireFleetOfficeAccess(request);
    const value: unknown = await request.json();
    const endpoint = value && typeof value === "object" ? (value as Record<string, unknown>).endpoint : null;
    if (!endpointAllowed(endpoint)) throw new AdminApiError(400, "A valid subscription endpoint is required.");
    const { error } = await admin.from("ees_fleet_push_subscriptions").update({ disabled_at: new Date().toISOString() })
      .eq("user_id", user.id).eq("endpoint", endpoint);
    if (error) throw error;
    return NextResponse.json({ subscribed: false }, { headers });
  } catch (error) { return errorResponse(error); }
}
