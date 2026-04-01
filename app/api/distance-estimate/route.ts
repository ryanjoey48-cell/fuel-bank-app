import { NextResponse } from "next/server";
import { getServerGoogleMapsApiKey } from "@/lib/google-maps";

type ComputeRoutesResponse = {
  routes?: Array<{
    distanceMeters?: number;
    duration?: string;
  }>;
  error?: {
    message?: string;
  };
};

export async function POST(request: Request) {
  try {
    const apiKey = getServerGoogleMapsApiKey();

    if (!apiKey) {
      return NextResponse.json(
        { error: "Google Maps API key is missing." },
        { status: 503 }
      );
    }

    const body = (await request.json()) as {
      origin?: string;
      destination?: string;
    };
    const origin = body.origin?.trim();
    const destination = body.destination?.trim();

    if (!origin || !destination) {
      return NextResponse.json(
        { error: "Origin and destination are required." },
        { status: 400 }
      );
    }

    const response = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "routes.distanceMeters,routes.duration"
      },
      body: JSON.stringify({
        origin: {
          address: origin
        },
        destination: {
          address: destination
        },
        travelMode: "DRIVE",
        routingPreference: "TRAFFIC_UNAWARE",
        languageCode: "en-US",
        units: "METRIC"
      }),
      cache: "no-store"
    });

    if (!response.ok) {
      const errorBody = (await response.json().catch(() => null)) as ComputeRoutesResponse | null;
      return NextResponse.json(
        {
          error:
            errorBody?.error?.message || "Unable to reach Google Maps route service."
        },
        { status: 502 }
      );
    }

    const data = (await response.json()) as ComputeRoutesResponse;
    const route = data.routes?.[0];
    const distanceMeters = route?.distanceMeters ?? null;
    const durationSeconds = route?.duration
      ? Number.parseInt(route.duration.replace("s", ""), 10)
      : null;

    if (distanceMeters == null) {
      return NextResponse.json(
        {
          error:
            data.error?.message ||
            "Google Maps could not estimate this route. Please check the locations and try again."
        },
        { status: 422 }
      );
    }

    return NextResponse.json({
      distanceKm: Number((distanceMeters / 1000).toFixed(2)),
      distanceMeters,
      durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : null,
      provider: "routes_api"
    });
  } catch {
    return NextResponse.json(
      { error: "Unable to estimate distance right now." },
      { status: 500 }
    );
  }
}
