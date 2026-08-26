import {
  extractGoogleMapsErrorCode,
  getGoogleMapsEnvironmentStatus,
  getGoogleMapsErrorMessage,
  getServerGoogleMapsApiKey
} from "@/lib/google-maps";
import { createApiError, createApiSuccess, parseJsonSafely } from "@/lib/http";
import { rememberVerifiedGooglePlace } from "@/lib/google-place-verification";

type PlaceDetailsResponse = {
  id?: string;
  formattedAddress?: string;
  displayName?: {
    text?: string;
  };
  location?: {
    latitude?: number;
    longitude?: number;
  };
  addressComponents?: Array<{ shortText?: string; types?: string[] }>;
  error?: {
    message?: string;
  };
};

function logGoogleMapsDetailsError(error: unknown) {
  console.warn("[Fuel Bank] Google location details failed", {
    message: error instanceof Error ? error.message : String(error)
  });
}

export async function GET(request: Request) {
  try {
    const apiKey = getServerGoogleMapsApiKey();
    const { searchParams } = new URL(request.url);
    const rawPlaceId = searchParams.get("placeId")?.trim() ?? "";
    const language = searchParams.get("language")?.trim() ?? "en";
    const sessionToken = searchParams.get("sessionToken")?.trim() ?? "";

    if (!apiKey) {
      const missingVariables = getGoogleMapsEnvironmentStatus().missingServerVariables;
      return Response.json(
        createApiError(`Missing ${missingVariables.join(" and ") || "GOOGLE_MAPS_SERVER_API_KEY"}`),
        { status: 503 }
      );
    }

    if (!rawPlaceId) {
      return Response.json(createApiError("Place ID is required."), { status: 400 });
    }

    const placeName = rawPlaceId.startsWith("places/") ? rawPlaceId : `places/${rawPlaceId}`;
    const detailsUrl = new URL(
      `https://places.googleapis.com/v1/${encodeURIComponent(placeName).replaceAll("%2F", "/")}`
    );
    detailsUrl.searchParams.set("languageCode", language === "th" ? "th" : "en");
    detailsUrl.searchParams.set("regionCode", "TH");
    if (sessionToken) detailsUrl.searchParams.set("sessionToken", sessionToken);
    const response = await fetch(
      detailsUrl,
      {
        headers: {
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": "id,formattedAddress,displayName,location,addressComponents"
        },
        cache: "no-store"
      }
    );

    if (!response.ok) {
      const errorBody = await parseJsonSafely<PlaceDetailsResponse | null>(response).catch(() => null);
      const rawMessage =
        errorBody?.error?.message ||
        "Places API (New) place details request failed.";
      const errorCode = extractGoogleMapsErrorCode(rawMessage);

      return Response.json(createApiError(getGoogleMapsErrorMessage(errorCode, rawMessage) ?? rawMessage), {
        status: response.status
      });
    }

    const result = await parseJsonSafely<PlaceDetailsResponse>(response);
    const lat = result.location?.latitude;
    const lng = result.location?.longitude;

    if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      return Response.json(createApiError("Google Maps did not return coordinates for this location."), {
        status: 422
      });
    }

    const place = {
      placeId: result.id || rawPlaceId.replace(/^places\//, ""),
      displayName: result.displayName?.text || result.formattedAddress || rawPlaceId,
      fullGoogleAddress: result.formattedAddress || result.displayName?.text || rawPlaceId,
      latitude: lat,
      longitude: lng,
      countryCode: result.addressComponents?.find((component) => component.types?.includes("country"))?.shortText?.toUpperCase() ?? null
    };
    rememberVerifiedGooglePlace(place);

    return Response.json(createApiSuccess({
      label: place.displayName,
      formatted_address: place.fullGoogleAddress,
      place_id: place.placeId,
      lat: place.latitude,
      lng: place.longitude,
      country_code: place.countryCode
    }));
  } catch (error) {
    logGoogleMapsDetailsError(error);
    return Response.json(
      createApiError(error instanceof Error ? error.message : "Google Maps place details failed."),
      { status: 503 }
    );
  }
}
