import { NextResponse } from "next/server";
import { hasPermission } from "@/lib/authorization";
import { AdminApiError, createServerSupabaseAdmin, requireVerifiedUser, resolveAccountAccess } from "@/lib/admin-user-management-server";

const fields = "id,company_name,thai_name,alternative_names,address,province,destination_type,google_maps_url,truck_entrance_url,verification_status,verified_at,notes,source_info,created_at,updated_at";
const types = ["Factory", "Warehouse", "Airport", "Port", "Customer", "Depot", "Other"];
const verificationEvidencePrefix = "Verification evidence: ";
type Context = { params: Promise<{ id: string }> };
function mapUrl(value: unknown) {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || value.length > 2048) throw new AdminApiError(400, "Map links must be valid Google Maps URLs.");
  let url: URL;
  try { url = new URL(value); } catch { throw new AdminApiError(400, "Map links must be valid Google Maps URLs."); }
  const googleHost = url.hostname === "maps.google.com" || /^(www\.)?google\.(com|[a-z]{2,3}|co\.[a-z]{2})$/.test(url.hostname);
  if (url.protocol !== "https:" || !googleHost || !url.pathname.startsWith("/maps")) throw new AdminApiError(400, "Map links must point to Google Maps over HTTPS.");
  return url.toString();
}
async function access(request: Request, permission: "business:read" | "business:write" | "business:delete") {
  const user = await requireVerifiedUser(request);
  const admin = createServerSupabaseAdmin();
  const account = await resolveAccountAccess(admin, user);
  if (!hasPermission(account, permission)) throw new AdminApiError(403, "You do not have access to the locations directory.");
  return { user, admin };
}
function fail(error: unknown) {
  if (error instanceof AdminApiError) return NextResponse.json({ error: error.message }, { status: error.status });
  return NextResponse.json({ error: "Unable to update this location." }, { status: 500 });
}

export async function PATCH(request: Request, context: Context) {
  try {
    const { user, admin } = await access(request, "business:write");
    const { id } = await context.params;
    const body = await request.json();
    const status = body.verification_status === "verified" ? "verified" : "needs_check";
    const verificationEvidence = typeof body.verification_evidence === "string" ? body.verification_evidence.trim() : "";
    if (status === "verified" && !verificationEvidence) throw new AdminApiError(400, "A verification evidence reference is required to mark a location verified.");
    if (verificationEvidence.length > 2048) throw new AdminApiError(400, "Verification evidence references must be 2048 characters or fewer.");
    const sourceInfo = String(body.source_info ?? "").trim();
    const values = {
      company_name: String(body.company_name ?? "").trim(),
      thai_name: String(body.thai_name ?? "").trim() || null,
      alternative_names: Array.isArray(body.alternative_names) ? body.alternative_names.map((name: unknown) => String(name).trim()).filter(Boolean) : [],
      address: String(body.address ?? "").trim(),
      province: String(body.province ?? "").trim() || null,
      destination_type: types.includes(body.destination_type) ? body.destination_type : "Other",
      google_maps_url: mapUrl(body.google_maps_url),
      truck_entrance_url: mapUrl(body.truck_entrance_url),
      verification_status: status,
      verified_at: status === "verified" ? (body.verified_at || new Date().toISOString()) : null,
      notes: String(body.notes ?? "").trim() || null,
      source_info: [sourceInfo, verificationEvidence && `${verificationEvidencePrefix}${verificationEvidence}`].filter(Boolean).join("\n") || null,
      updated_by: user.id
    };
    if (!values.company_name || !values.address) throw new AdminApiError(400, "Company name and address are required.");
    const { data, error } = await admin.from("ees_locations").update(values).eq("id", id).select(fields).single();
    if (error) throw error;
    return NextResponse.json({ location: data });
  } catch (error) { return fail(error); }
}

export async function POST(request: Request, context: Context) {
  try {
    const { user, admin } = await access(request, "business:read");
    const { id } = await context.params;
    const body = await request.json();
    const { data: prior, error: priorError } = await admin.from("ees_location_user_activity")
      .select("is_favourite,last_used_at").eq("user_id", user.id).eq("location_id", id).maybeSingle();
    if (priorError) throw priorError;
    if (body.action === "use") {
      const { error } = await admin.from("ees_location_user_activity").upsert({ user_id: user.id, location_id: id, is_favourite: prior?.is_favourite ?? false, last_used_at: new Date().toISOString() }, { onConflict: "user_id,location_id" });
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }
    if (body.action === "favourite") {
      const { error } = await admin.from("ees_location_user_activity").upsert({ user_id: user.id, location_id: id, is_favourite: Boolean(body.value), last_used_at: prior?.last_used_at ?? null }, { onConflict: "user_id,location_id" });
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }
    throw new AdminApiError(400, "Unsupported activity action.");
  } catch (error) { return fail(error); }
}

export async function DELETE(request: Request, context: Context) {
  try {
    const { admin } = await access(request, "business:delete");
    const { id } = await context.params;
    const { error } = await admin.from("ees_locations").delete().eq("id", id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) { return fail(error); }
}
