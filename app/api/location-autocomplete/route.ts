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

function createMapsConfigPayload() {
  const status = getGoogleMapsEnvironmentStatus();
  const missingVariables = [
    ...status.missingServerVariables,
    ...status.missingPublicVariables
  ];
  const message = missingVariables.length
    ? `Missing ${missingVariables.join(" and ")}`
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
        createApiError(config.message || "Missing GOOGLE_MAPS_SERVER_API_KEY"),
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
      const rawMessage =
        errorBody?.error?.message ||
        "Places API (New) autocomplete request failed.";
      const errorCode = extractGoogleMapsErrorCode(rawMessage);

      return Response.json(createApiError(getGoogleMapsErrorMessage(errorCode, rawMessage) ?? rawMessage), {
        status: response.status
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
      createApiError(error instanceof Error ? error.message : "Google Places request failed."),
      { status: 503 }
    );
  }
}
