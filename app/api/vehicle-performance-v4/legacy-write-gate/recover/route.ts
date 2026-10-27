import { NextResponse } from "next/server";
import { AdminApiError, createServerSupabaseAdmin, requireVerifiedUser, resolveAccountAccess } from "@/lib/admin-user-management-server";
import { hasPermission } from "@/lib/authorization";
import { BoundedRequestError, boundedRequestBody } from "@/lib/vehicle-financial-upload";

export async function POST(request: Request) {
  try {
    const user = await requireVerifiedUser(request);
    const admin = createServerSupabaseAdmin();
    const access = await resolveAccountAccess(admin, user);
    if (!hasPermission(access, "admin:user_management")) throw new AdminApiError(403, "Only an active administrator can recover monthly Vehicle Performance writes.");
    const bounded = await boundedRequestBody(request, 1024);
    const body = await bounded.json().catch(() => null) as Record<string, unknown> | null;
    const evidenceHash = body?.incidentEvidenceSha256;
    if (!body || Object.keys(body).length !== 1 || typeof evidenceHash !== "string" || !/^[a-f0-9]{64}$/i.test(evidenceHash)) {
      throw new AdminApiError(400, "Provide the SHA-256 fingerprint for the recovery incident record.");
    }
    const { data, error } = await admin.rpc("recover_vehicle_financial_legacy_write_control", {
      p_actor_id: user.id,
      p_incident_sha256: evidenceHash.toLowerCase()
    });
    if (error) throw error;
    return NextResponse.json({ result: data });
  } catch (error) {
    if (error instanceof BoundedRequestError) return NextResponse.json({ error: error.code }, { status: error.code === "request_too_large" ? 413 : 400 });
    const status = error instanceof AdminApiError ? error.status : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to restore legacy write mode." }, { status });
  }
}
