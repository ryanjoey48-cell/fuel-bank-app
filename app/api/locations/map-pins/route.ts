import { NextResponse } from "next/server";
import { hasPermission } from "@/lib/authorization";
import { AdminApiError, createServerSupabaseAdmin, requireVerifiedUser, resolveAccountAccess } from "@/lib/admin-user-management-server";
import { isValidCoordinates, type LocationPinType } from "@/lib/locations-directory";

const pinFields = "id,location_id,pin_type,latitude,longitude,pin_status,coordinate_source,source_reference,confirmed_by,confirmed_at,updated_at";
const pinTypes: readonly LocationPinType[] = ["destination", "truck_entrance"];

function missingMapStorage(error: unknown) {
  const value = error as { code?: unknown; message?: unknown } | null;
  const code = String(value?.code ?? "");
  const message = String(value?.message ?? "").toLowerCase();
  return code === "42P01" || code === "PGRST205"
    || message.includes("ees_location_map_pins") && (message.includes("does not exist") || message.includes("could not find the table"));
}

function responseError(error: unknown) {
  if (error instanceof AdminApiError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (missingMapStorage(error)) return NextResponse.json({ error: "Map pin storage has not been installed." }, { status: 503 });
  return NextResponse.json({ error: "Unable to access confirmed map pins." }, { status: 500 });
}

async function authorized(request: Request, write = false) {
  const user = await requireVerifiedUser(request);
  const admin = createServerSupabaseAdmin();
  const access = await resolveAccountAccess(admin, user);
  const permission = write ? "business:write" : "business:read";
  if (!hasPermission(access, permission)) throw new AdminApiError(403, "You do not have access to the Locations Directory.");
  return { user, admin };
}

export async function GET(request: Request) {
  try {
    const { admin } = await authorized(request);
    const { data, error } = await admin.from("ees_location_map_pins")
      .select(pinFields)
      .eq("pin_status", "manual_confirmed")
      .order("updated_at", { ascending: false });
    if (error) {
      if (missingMapStorage(error)) return NextResponse.json({ pins: [], storageReady: false });
      throw error;
    }
    return NextResponse.json({ pins: data ?? [], storageReady: true });
  } catch (error) {
    return responseError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { user, admin } = await authorized(request, true);
    let body: Record<string, unknown>;
    try {
      body = await request.json() as Record<string, unknown>;
    } catch {
      throw new AdminApiError(400, "Provide a valid JSON pin confirmation.");
    }

    if (body.confirm !== true) throw new AdminApiError(400, "Explicit pin confirmation is required before saving coordinates.");
    const locationId = typeof body.location_id === "string" ? body.location_id.trim() : "";
    if (!/^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(locationId)) {
      throw new AdminApiError(400, "Choose a valid destination before saving a pin.");
    }
    if (!pinTypes.includes(body.pin_type as LocationPinType)) throw new AdminApiError(400, "Choose a valid pin type.");
    if (!isValidCoordinates(body.latitude, body.longitude)) throw new AdminApiError(400, "Latitude or longitude is outside its valid range.");

    const coordinateSource = typeof body.coordinate_source === "string" ? body.coordinate_source.trim() : "";
    const sourceReference = typeof body.source_reference === "string" ? body.source_reference.trim() : "";
    if (!coordinateSource || coordinateSource.length > 500) throw new AdminApiError(400, "Enter a coordinate source of 1 to 500 characters.");
    if (sourceReference.length > 2048) throw new AdminApiError(400, "Source references must be 2048 characters or fewer.");

    const { data: location, error: locationError } = await admin.from("ees_locations")
      .select("id")
      .eq("id", locationId)
      .maybeSingle();
    if (locationError) throw locationError;
    if (!location) throw new AdminApiError(404, "The selected destination was not found.");

    const now = new Date().toISOString();
    const { data, error } = await admin.from("ees_location_map_pins").upsert({
      location_id: locationId,
      pin_type: body.pin_type,
      latitude: body.latitude,
      longitude: body.longitude,
      pin_status: "manual_confirmed",
      coordinate_source: coordinateSource,
      source_reference: sourceReference || null,
      confirmed_by: user.id,
      confirmed_at: now,
      updated_by: user.id,
      updated_at: now
    }, { onConflict: "location_id,pin_type" }).select(pinFields).single();
    if (error) throw error;
    return NextResponse.json({ pin: data }, { status: 200 });
  } catch (error) {
    return responseError(error);
  }
}
