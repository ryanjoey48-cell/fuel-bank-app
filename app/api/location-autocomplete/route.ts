import { NextResponse } from "next/server";
import { getServerGoogleMapsApiKey } from "@/lib/google-maps";

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

export async function GET(request: Request) {
  const apiKey = getServerGoogleMapsApiKey();
  const { searchParams } = new URL(request.url);
  const input = searchParams.get("input")?.trim() ?? "";
  const language = searchParams.get("language")?.trim() ?? "en";
  const sessionToken = searchParams.get("sessionToken")?.trim() ?? "";

  if (!input) {
    return NextResponse.json({
      configured: Boolean(apiKey),
      suggestions: []
    });
  }

  if (!apiKey) {
    return NextResponse.json(
      { error: "Google Maps not configured — autocomplete unavailable" },
      { status: 503 }
    );
  }

  if (input.length < 2) {
    return NextResponse.json({
      configured: true,
      suggestions: []
    });
  }

  try {
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
      const errorBody = (await response.json().catch(() => null)) as
        | PlacesAutocompleteNewResponse
        | null;

      return NextResponse.json(
        {
          error:
            errorBody?.error?.message ||
            "Unable to reach Google Maps autocomplete service."
        },
        { status: 502 }
      );
    }

    const result = (await response.json()) as PlacesAutocompleteNewResponse;

    return NextResponse.json({
      configured: true,
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
    });
  } catch {
    return NextResponse.json(
      { error: "Unable to load location suggestions right now." },
      { status: 500 }
    );
  }
}
