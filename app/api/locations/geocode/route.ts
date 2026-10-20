import { NextResponse } from "next/server";
import { hasPermission } from "@/lib/authorization";
import { AdminApiError, createServerSupabaseAdmin, requireVerifiedUser, resolveAccountAccess } from "@/lib/admin-user-management-server";
import { buildGeoapifyQuery, filterReliableGeoapifyResults, isLocationPinType } from "@/lib/location-geocoding";
import { signGeoapifyCandidate } from "@/lib/location-geocoding-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const locationIdPattern = /^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;

function errorResponse(error: unknown) {
  if (error instanceof AdminApiError) return NextResponse.json({ error: error.message, code: "ACCESS_DENIED" }, { status: error.status });
  return NextResponse.json({ error: "The location lookup service is unavailable. Please try again or use Google Maps.", code: "LOOKUP_UNAVAILABLE" }, { status: 503 });
}

export async function POST(request: Request) {
  try {
    const user = await requireVerifiedUser(request);
    const admin = createServerSupabaseAdmin();
    const access = await resolveAccountAccess(admin, user);
    if (!hasPermission(access, "business:write")) throw new AdminApiError(403, "You do not have access to search map locations.");

    let body: Record<string, unknown>;
    try {
      body = await request.json() as Record<string, unknown>;
    } catch {
      throw new AdminApiError(400, "Provide a valid destination lookup request.");
    }
    const locationId = typeof body.location_id === "string" ? body.location_id.trim() : "";
    const pinType = body.pin_type;
    const language = body.language === "th" ? "th" : body.language === "en" ? "en" : null;
    if (!locationIdPattern.test(locationId)) throw new AdminApiError(400, "Choose a valid destination before searching.");
    if (!isLocationPinType(pinType)) throw new AdminApiError(400, "Choose a valid pin type before searching.");
    if (!language) throw new AdminApiError(400, "Choose English or Thai before searching.");

    const apiKey = process.env.GEOAPIFY_API_KEY?.trim();
    if (!apiKey) {
      return NextResponse.json({ error: "Geoapify is not configured on the server yet. Use the Google Maps link meanwhile.", code: "GEOCODER_NOT_CONFIGURED" }, { status: 503 });
    }

    const { data: location, error: locationError } = await admin.from("ees_locations")
      .select("id,company_name,thai_name,alternative_names,address,province")
      .eq("id", locationId)
      .maybeSingle();
    if (locationError) throw locationError;
    if (!location) throw new AdminApiError(404, "The selected destination was not found.");

    const query = buildGeoapifyQuery(location);
    if (!query) throw new AdminApiError(400, "This destination does not contain enough address information to search.");

    const { data: reservation, error: reservationError } = await admin.rpc("ees_locations_reserve_geocode_lookup", {
      p_actor_user_id: user.id
    });
    if (reservationError) {
      return NextResponse.json({ error: "The protected lookup quota is not installed. Apply the Locations geocoding rate-limit migration before enabling lookups.", code: "RATE_LIMITER_NOT_READY" }, { status: 503 });
    }
    const rate = Array.isArray(reservation) ? reservation[0] as { allowed?: boolean; reason?: string } | undefined : reservation as { allowed?: boolean; reason?: string } | null;
    if (!rate?.allowed) {
      const dailyLimit = rate?.reason === "daily_limit";
      return NextResponse.json({
        error: dailyLimit ? "The daily free lookup allowance has been reached. Try again tomorrow." : "Please wait a moment before searching again.",
        code: dailyLimit ? "DAILY_LIMIT" : "RATE_LIMITED"
      }, { status: 429, headers: dailyLimit ? undefined : { "Retry-After": "10" } });
    }

    const url = new URL("https://api.geoapify.com/v1/geocode/search");
    url.searchParams.set("text", query);
    url.searchParams.set("filter", "countrycode:th");
    url.searchParams.set("lang", language);
    url.searchParams.set("limit", "5");
    url.searchParams.set("format", "json");
    url.searchParams.set("apiKey", apiKey);

    const controller = new AbortController();
    const abortFromClient = () => controller.abort();
    request.signal.addEventListener("abort", abortFromClient, { once: true });
    const timeout = setTimeout(() => controller.abort(), 8000);
    let providerResponse: Response;
    try {
      providerResponse = await fetch(url, { cache: "no-store", signal: controller.signal });
    } finally {
      clearTimeout(timeout);
      request.signal.removeEventListener("abort", abortFromClient);
    }
    if (!providerResponse.ok) {
      const providerStatus = providerResponse.status;
      if (providerStatus === 429) return NextResponse.json({ error: "Geoapify is temporarily rate limiting requests. Retry in a moment or use Google Maps.", code: "PROVIDER_RATE_LIMITED" }, { status: 503 });
      return NextResponse.json({ error: "Geoapify could not complete the lookup. Retry once or use Google Maps.", code: "LOOKUP_UNAVAILABLE" }, { status: 503 });
    }

    const payload = await providerResponse.json().catch(() => null);
    const candidates = filterReliableGeoapifyResults(payload, location).map((candidate) => ({
      ...candidate,
      confirmationToken: signGeoapifyCandidate(candidate, { actorId: user.id, locationId, pinType }, process.env.SUPABASE_SERVICE_ROLE_KEY ?? "")
    }));
    return NextResponse.json({ candidates, found: candidates.length > 0, attribution: "Powered by Geoapify · © OpenStreetMap contributors" }, {
      headers: { "Cache-Control": "no-store, max-age=0" }
    });
  } catch (error) {
    return errorResponse(error);
  }
}
