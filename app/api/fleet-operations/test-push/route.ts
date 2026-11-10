import { NextResponse } from "next/server";
import { AdminApiError } from "@/lib/admin-user-management-server";
import { requireFleetOfficeAccess } from "@/lib/fleet-operations-auth";
import { sendFleetWebPushTest } from "@/lib/fleet-web-push-server";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const uuid = /^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;

export async function GET(request: Request) {
  try {
    const { user, admin } = await requireFleetOfficeAccess(request);
    const { data, error } = await admin.from("ees_fleet_push_test_attempts")
      .select("id,attempted_at,status,http_status,error_code").eq("user_id", user.id)
      .order("attempted_at", { ascending: false }).limit(10);
    if (error) throw error;
    return NextResponse.json({ attempts: data ?? [] }, { headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof AdminApiError ? error.message : "Push test history is unavailable." },
      { status: error instanceof AdminApiError ? error.status : 503, headers });
  }
}

export async function POST(request: Request) {
  try {
    const { user, admin } = await requireFleetOfficeAccess(request);
    if (process.env.EES_WEB_PUSH_TEST_ENABLED !== "true") {
      throw new AdminApiError(503, "Server push testing is disabled.");
    }
    const publicKey = process.env.EES_WEB_PUSH_VAPID_PUBLIC_KEY;
    const privateKey = process.env.EES_WEB_PUSH_VAPID_PRIVATE_KEY;
    const subject = process.env.EES_WEB_PUSH_VAPID_SUBJECT;
    if (!publicKey || !privateKey || !subject) throw new AdminApiError(503, "Web Push keys are not configured.");
    const value: unknown = await request.json();
    const id = value && typeof value === "object" ? (value as Record<string, unknown>).subscriptionId : null;
    if (typeof id !== "string" || !uuid.test(id)) throw new AdminApiError(400, "Choose one registered device.");
    const { data: subscription, error } = await admin.from("ees_fleet_push_subscriptions")
      .select("id,endpoint,p256dh,auth_secret")
      .eq("id", id).eq("user_id", user.id).is("disabled_at", null).maybeSingle();
    if (error) throw error;
    if (!subscription) throw new AdminApiError(404, "Registered device not found.");
    const { data: attempt, error: insertError } = await admin.from("ees_fleet_push_test_attempts")
      .insert({ user_id: user.id, subscription_id: id, request_bucket: Math.floor(Date.now() / 60_000), status: "running" })
      .select("id").single();
    if (insertError?.code === "23505") throw new AdminApiError(429, "Wait one minute before another server push test.");
    if (insertError || !attempt) throw new Error("Push test log is unavailable.");
    let result: { status: "delivered" | "retryable_failure" | "permanent_failure"; httpStatus: number | null; errorCode: string | null };
    try {
      result = await sendFleetWebPushTest(subscription, { publicKey, privateKey, subject });
    } catch {
      result = { status: "permanent_failure", httpStatus: null, errorCode: "push_configuration_invalid" };
    }
    const { error: updateError } = await admin.from("ees_fleet_push_test_attempts")
      .update({ status: result.status, http_status: result.httpStatus, error_code: result.errorCode }).eq("id", attempt.id);
    if (updateError) throw updateError;
    if (result.status === "permanent_failure") {
      await admin.from("ees_fleet_push_subscriptions").update({ disabled_at: new Date().toISOString() }).eq("id", id).eq("user_id", user.id);
    }
    return NextResponse.json({ status: result.status, httpStatus: result.httpStatus, errorCode: result.errorCode }, { headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof AdminApiError ? error.message : "Server push test failed." },
      { status: error instanceof AdminApiError ? error.status : 503, headers });
  }
}
