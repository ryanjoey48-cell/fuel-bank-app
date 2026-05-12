import { getServerGoogleMapsApiKey } from "@/lib/google-maps";
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

export async function GET(request: Request) {
  try {
    const apiKey = getServerGoogleMapsApiKey();
    const { searchParams } = new URL(request.url);
    const rawPlaceId = searchParams.get("placeId")?.trim() ?? "";
    const language = searchParams.get("language")?.trim() ?? "en";

    if (!apiKey) {
      return Response.json(createApiError("Google Maps API key is missing."), { status: 503 });
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
      return Response.json(
        createApiError(errorBody?.error?.message || "Unable to load Google Maps place details."),
        { status: 502 }
      );
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
  } catch {
    return Response.json(createApiError("Unable to load location details right now."), { status: 500 });
  }
}
