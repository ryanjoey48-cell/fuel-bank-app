import { NextResponse } from "next/server";
import { hasPermission } from "@/lib/authorization";
import { AdminApiError, createServerSupabaseAdmin, requireVerifiedUser, resolveAccountAccess } from "@/lib/admin-user-management-server";
import { projectLocationForDirectory, safeGoogleMapsUrl, type SearchableLocation } from "@/lib/locations-directory";

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
  return { user, admin, access };
}

function errorResponse(error: unknown) {
  if (error instanceof AdminApiError) return NextResponse.json({ error: error.message }, { status: error.status });
  return NextResponse.json({ error: "Unable to access locations. Apply the EES Locations migration if it has not been applied." }, { status: 500 });
}

export async function GET(request: Request) {
  try {
    const { user, admin, access } = await authorized(request);
    const locations: Array<SearchableLocation & { id: string }> = [];
    const activity: Array<{ location_id: string; is_favourite: boolean; last_used_at: string | null }> = [];
    const pageSize = 500;
    for (let offset = 0; offset <= 10_000; offset += pageSize) {
      const [locationPage, activityPage] = await Promise.all([
        admin.from("ees_locations").select(fields).order("company_name").order("id").range(offset, offset + pageSize - 1),
        admin.from("ees_location_user_activity").select("location_id,is_favourite,last_used_at")
          .eq("user_id", user.id).order("location_id").range(offset, offset + pageSize - 1)
      ]);
      if (locationPage.error) throw locationPage.error;
      if (activityPage.error) throw activityPage.error;
      locations.push(...(locationPage.data ?? []));
      activity.push(...(activityPage.data ?? []));
      if ((locationPage.data?.length ?? 0) < pageSize && (activityPage.data?.length ?? 0) < pageSize) break;
      if (offset === 10_000) throw new Error("Location Directory exceeds the safe request bound.");
    }
    const includeInternal = hasPermission(access, "admin:user_management");
    return NextResponse.json({
      locations: (locations ?? []).map((location) => projectLocationForDirectory(location, includeInternal)),
      activity: activity ?? []
    });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const { user, admin, access } = await authorized(request, true);
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
    const values: Record<string, unknown> = {
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
      created_by: user.id,
      updated_by: user.id
    };
    const includeInternal = hasPermission(access, "admin:user_management");
    values.notes = includeInternal ? String(body.notes ?? "").trim() || null : null;
    values.source_info = [includeInternal ? sourceInfo : "", verificationEvidence && `${verificationEvidencePrefix}${verificationEvidence}`]
      .filter(Boolean).join("\n") || null;
    const { data, error } = await admin.from("ees_locations").insert(values).select(fields).single();
    if (error) throw error;
    return NextResponse.json({ location: projectLocationForDirectory(data, includeInternal) }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}
