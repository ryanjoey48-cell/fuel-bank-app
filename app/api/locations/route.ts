import { NextResponse } from "next/server";
import { hasPermission } from "@/lib/authorization";
import { AdminApiError, createServerSupabaseAdmin, requireVerifiedUser, resolveAccountAccess } from "@/lib/admin-user-management-server";
import { safeGoogleMapsUrl } from "@/lib/locations-directory";

const fields = "id,company_name,thai_name,alternative_names,address,province,destination_type,google_maps_url,truck_entrance_url,verification_status,verified_at,notes,source_info,created_at,updated_at";
const types = ["Factory", "Warehouse", "Airport", "Port", "Customer", "Depot", "Other"];
const verificationEvidencePrefix = "Verification evidence: ";
const mapUrl = (value: unknown) => {
  if (value == null || value === "") return null;
  const safeUrl = safeGoogleMapsUrl(value);
  if (!safeUrl) throw new AdminApiError(400, "Map links must be valid Google Maps URLs over HTTPS.");
  return safeUrl;
};

async function authorized(request: Request, write = false) {
  const user = await requireVerifiedUser(request);
  const admin = createServerSupabaseAdmin();
  const access = await resolveAccountAccess(admin, user);
  const permission = write ? "business:write" : "business:read";
  if (!hasPermission(access, permission)) throw new AdminApiError(403, "You do not have access to the locations directory.");
  return { user, admin };
}

function errorResponse(error: unknown) {
  if (error instanceof AdminApiError) return NextResponse.json({ error: error.message }, { status: error.status });
  return NextResponse.json({ error: "Unable to access locations. Apply the EES Locations migration if it has not been applied." }, { status: 500 });
}

export async function GET(request: Request) {
  try {
    const { user, admin } = await authorized(request);
    const [{ data: locations, error }, { data: activity, error: activityError }] = await Promise.all([
      admin.from("ees_locations").select(fields).order("company_name"),
      admin.from("ees_location_user_activity").select("location_id,is_favourite,last_used_at").eq("user_id", user.id)
    ]);
    if (error) throw error;
    if (activityError) throw activityError;
    return NextResponse.json({ locations: locations ?? [], activity: activity ?? [] });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const { user, admin } = await authorized(request, true);
    const body = await request.json();
    const companyName = String(body.company_name ?? "").trim();
    const address = String(body.address ?? "").trim();
    if (!companyName || !address) throw new AdminApiError(400, "Company name and address are required.");
    const destinationType = types.includes(body.destination_type) ? body.destination_type : "Other";
    const status = body.verification_status === "verified" ? "verified" : "needs_check";
    const verificationEvidence = typeof body.verification_evidence === "string" ? body.verification_evidence.trim() : "";
    if (status === "verified" && !verificationEvidence) throw new AdminApiError(400, "A verification evidence reference is required to mark a location verified.");
    if (verificationEvidence.length > 2048) throw new AdminApiError(400, "Verification evidence references must be 2048 characters or fewer.");
    const sourceInfo = String(body.source_info ?? "").trim();
    const values = {
      company_name: companyName,
      thai_name: String(body.thai_name ?? "").trim() || null,
      alternative_names: Array.isArray(body.alternative_names) ? body.alternative_names.map((name: unknown) => String(name).trim()).filter(Boolean) : [],
      address,
      province: String(body.province ?? "").trim() || null,
      destination_type: destinationType,
      google_maps_url: mapUrl(body.google_maps_url),
      truck_entrance_url: mapUrl(body.truck_entrance_url),
      verification_status: status,
      verified_at: status === "verified" ? new Date().toISOString() : null,
      notes: String(body.notes ?? "").trim() || null,
      source_info: [sourceInfo, verificationEvidence && `${verificationEvidencePrefix}${verificationEvidence}`].filter(Boolean).join("\n") || null,
      created_by: user.id,
      updated_by: user.id
    };
    const { data, error } = await admin.from("ees_locations").insert(values).select(fields).single();
    if (error) throw error;
    return NextResponse.json({ location: data }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}
