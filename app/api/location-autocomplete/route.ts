import {
  extractGoogleMapsErrorCode,
  getGoogleMapsEnvironmentStatus,
  getGoogleMapsErrorMessage,
  getServerGoogleMapsApiKey
} from "@/lib/google-maps";
import { createApiError, createApiSuccess, parseJsonSafely } from "@/lib/http";

type PlacesAutocompleteNewResponse = {
  suggestions?: Array<{
    placePrediction?: {
      place?: string;
      placeId?: string;
      text?: {
        text?: string;
      };
      structuredFormat?: {
        mainText?: {
          text?: string;
        };
        secondaryText?: {
          text?: string;
        };
      };
    };
  }>;
  error?: {
    message?: string;
  };
};

type PlacesAutocompleteLegacyResponse = {
  predictions?: Array<{
    place_id?: string;
    description?: string;
    structured_formatting?: {
      main_text?: string;
      secondary_text?: string;
    };
  }>;
  error_message?: string;
  status?: string;
};

function mapLegacyPredictions(result: PlacesAutocompleteLegacyResponse) {
  return (result.predictions ?? []).slice(0, 5).map((prediction) => ({
    placeId: prediction.place_id ?? prediction.description ?? "",
    description: prediction.description ?? "",
    mainText:
      prediction.structured_formatting?.main_text ??
      prediction.description ??
      "",
    secondaryText: prediction.structured_formatting?.secondary_text ?? ""
  }));
}

function createMapsConfigPayload() {
  const status = getGoogleMapsEnvironmentStatus();
  const missingVariables = [
    ...status.missingServerVariables,
    ...status.missingPublicVariables
  ];
  const message = missingVariables.length
    ? `Missing ${missingVariables.join(" and ")}`
    : status.legacyServerSource
      ? `Missing GOOGLE_MAPS_API_KEY. Legacy ${status.legacyServerSource} is present but not used for stable deployments.`
    : null;

  return {
    configured: status.hasServerKey,
    browserConfigured: status.hasPublicKey,
    serverConfigured: status.hasServerKey,
    missingVariables,
    serverSource: status.serverSource,
    publicSource: status.publicSource,
    legacyServerSource: status.legacyServerSource,
    legacyPublicSource: status.legacyPublicSource,
    message,
    suggestions: [] as LocationSuggestion[]
  };
}

type LocationSuggestion = {
  placeId: string;
  description: string;
  mainText: string;
  secondaryText: string;
};

function logGoogleMapsRouteError(scope: string, error: unknown) {
  console.warn(scope, {
    message: error instanceof Error ? error.message : String(error)
  });
}

export async function GET(request: Request) {
  try {
    const apiKey = getServerGoogleMapsApiKey();
    const { searchParams } = new URL(request.url);
    const input = searchParams.get("input")?.trim() ?? "";
    const language = searchParams.get("language")?.trim() ?? "en";
    const sessionToken = searchParams.get("sessionToken")?.trim() ?? "";

    if (!input) {
      return Response.json(
        createApiSuccess(createMapsConfigPayload())
      );
    }

    if (!apiKey) {
      const config = createMapsConfigPayload();
      return Response.json(
        createApiError(config.message || "Missing GOOGLE_MAPS_API_KEY"),
        { status: 503 }
      );
    }

    if (input.length < 2) {
      return Response.json(
        createApiSuccess({
          configured: true,
          browserConfigured: getGoogleMapsEnvironmentStatus().hasPublicKey,
          suggestions: []
        })
      );
    }

    const response = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask":
          "suggestions.placePrediction.place,suggestions.placePrediction.placeId,suggestions.placePrediction.text,suggestions.placePrediction.structuredFormat"
      },
      body: JSON.stringify({
        input,
        languageCode: language === "th" ? "th" : "en",
        regionCode: "TH",
        sessionToken: sessionToken || undefined
      }),
      cache: "no-store"
    });

    if (!response.ok) {
      const errorBody = await parseJsonSafely<PlacesAutocompleteNewResponse | null>(
        response
      ).catch(() => null);

      const legacyUrl = new URL("https://maps.googleapis.com/maps/api/place/autocomplete/json");
      legacyUrl.searchParams.set("input", input);
      legacyUrl.searchParams.set("key", apiKey);
      legacyUrl.searchParams.set("language", language === "th" ? "th" : "en");
      legacyUrl.searchParams.set("components", "country:th");
      if (sessionToken) {
        legacyUrl.searchParams.set("sessiontoken", sessionToken);
      }

      const legacyResponse = await fetch(legacyUrl, { cache: "no-store" });
      const legacyResult = await parseJsonSafely<PlacesAutocompleteLegacyResponse>(legacyResponse);

      if (
        legacyResponse.ok &&
        (legacyResult.status === "OK" || legacyResult.status === "ZERO_RESULTS")
      ) {
        return Response.json(
          createApiSuccess({
            configured: true,
            browserConfigured: getGoogleMapsEnvironmentStatus().hasPublicKey,
            suggestions: mapLegacyPredictions(legacyResult)
          })
        );
      }

      const rawMessage =
        legacyResult.error_message ||
        legacyResult.status ||
        errorBody?.error?.message ||
        "Unable to reach Google Maps autocomplete service.";
      const errorCode = extractGoogleMapsErrorCode(rawMessage) ?? legacyResult.status ?? null;

      return Response.json(createApiError(getGoogleMapsErrorMessage(errorCode, rawMessage) ?? rawMessage), {
        status: 502
      });
    }

    const result = await parseJsonSafely<PlacesAutocompleteNewResponse>(response);

    return Response.json(
      createApiSuccess({
        configured: true,
        browserConfigured: getGoogleMapsEnvironmentStatus().hasPublicKey,
        suggestions: (result.suggestions ?? [])
          .map((suggestion) => suggestion.placePrediction)
          .filter((prediction): prediction is NonNullable<typeof prediction> => Boolean(prediction))
          .slice(0, 5)
          .map((prediction) => ({
            placeId: prediction.placeId ?? prediction.place ?? prediction.text?.text ?? "",
            description:
              prediction.text?.text ??
              [
                prediction.structuredFormat?.mainText?.text ?? "",
                prediction.structuredFormat?.secondaryText?.text ?? ""
              ]
                .filter(Boolean)
                .join(", "),
            mainText:
              prediction.structuredFormat?.mainText?.text ?? prediction.text?.text ?? "",
            secondaryText: prediction.structuredFormat?.secondaryText?.text ?? ""
          }))
      })
    );
  } catch (error) {
    logGoogleMapsRouteError("[Fuel Bank] Google location autocomplete failed", error);
    return Response.json(
      createApiError("Google Maps API request failed. Manual entry still allowed."),
      { status: 503 }
    );
  }
}
