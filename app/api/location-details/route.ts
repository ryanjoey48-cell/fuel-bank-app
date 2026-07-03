import {
  extractGoogleMapsErrorCode,
  getGoogleMapsEnvironmentStatus,
  getGoogleMapsErrorMessage,
  getServerGoogleMapsApiKey
} from "@/lib/google-maps";
import { createApiError, createApiSuccess, parseJsonSafely } from "@/lib/http";

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
  error?: {
    message?: string;
  };
};

type LegacyPlaceDetailsResponse = {
  result?: {
    place_id?: string;
    name?: string;
    formatted_address?: string;
    geometry?: {
      location?: {
        lat?: number;
        lng?: number;
      };
    };
  };
  error_message?: string;
  status?: string;
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

    if (!apiKey) {
      const missingVariables = getGoogleMapsEnvironmentStatus().missingServerVariables;
      return Response.json(
        createApiError(`Missing ${missingVariables.join(" and ") || "GOOGLE_MAPS_API_KEY"}`),
        { status: 503 }
      );
    }

    if (!rawPlaceId) {
      return Response.json(createApiError("Place ID is required."), { status: 400 });
    }

    const placeName = rawPlaceId.startsWith("places/") ? rawPlaceId : `places/${rawPlaceId}`;
    const response = await fetch(
      `https://places.googleapis.com/v1/${encodeURIComponent(placeName).replaceAll("%2F", "/")}?languageCode=${language === "th" ? "th" : "en"}`,
      {
        headers: {
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": "id,formattedAddress,displayName,location"
        },
        cache: "no-store"
      }
    );

    if (!response.ok) {
      const errorBody = await parseJsonSafely<PlaceDetailsResponse | null>(response).catch(() => null);

      const legacyUrl = new URL("https://maps.googleapis.com/maps/api/place/details/json");
      legacyUrl.searchParams.set("place_id", rawPlaceId.replace(/^places\//, ""));
      legacyUrl.searchParams.set("key", apiKey);
      legacyUrl.searchParams.set("language", language === "th" ? "th" : "en");
      legacyUrl.searchParams.set("fields", "place_id,name,formatted_address,geometry");

      const legacyResponse = await fetch(legacyUrl, { cache: "no-store" });
      const legacyResult = await parseJsonSafely<LegacyPlaceDetailsResponse>(legacyResponse);
      const legacyLat = legacyResult.result?.geometry?.location?.lat;
      const legacyLng = legacyResult.result?.geometry?.location?.lng;

      if (
        legacyResponse.ok &&
        legacyResult.status === "OK" &&
        Number.isFinite(legacyLat) &&
        Number.isFinite(legacyLng)
      ) {
        return Response.json(
          createApiSuccess({
            label:
              legacyResult.result?.name ||
              legacyResult.result?.formatted_address ||
              rawPlaceId,
            formatted_address:
              legacyResult.result?.formatted_address ||
              legacyResult.result?.name ||
              rawPlaceId,
            place_id: legacyResult.result?.place_id || rawPlaceId,
            lat: legacyLat,
            lng: legacyLng
          })
        );
      }

      const rawMessage =
        legacyResult.error_message ||
        legacyResult.status ||
        errorBody?.error?.message ||
        "Unable to load Google Maps place details.";
      const errorCode = extractGoogleMapsErrorCode(rawMessage) ?? legacyResult.status ?? null;

      return Response.json(createApiError(getGoogleMapsErrorMessage(errorCode, rawMessage) ?? rawMessage), {
        status: 502
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

    return Response.json(
      createApiSuccess({
        label: result.displayName?.text || result.formattedAddress || rawPlaceId,
        formatted_address: result.formattedAddress || result.displayName?.text || rawPlaceId,
        place_id: result.id || rawPlaceId,
        lat,
        lng
      })
    );
  } catch (error) {
    logGoogleMapsDetailsError(error);
    return Response.json(
      createApiError("Google Maps place details failed. Manual entry still allowed."),
      { status: 503 }
    );
  }
}
