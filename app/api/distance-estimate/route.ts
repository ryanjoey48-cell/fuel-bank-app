import { getServerGoogleMapsApiKey } from "@/lib/google-maps";
import { createApiError, createApiSuccess, parseJsonSafely } from "@/lib/http";

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
      return Response.json(createApiError("Google Maps API key is missing."), {
        status: 503
      });
    }

    let body: { origin?: string; destination?: string } = {};

    try {
      body = (await request.json()) as typeof body;
    } catch {
      return Response.json(createApiError("Invalid request body."), { status: 400 });
    }

    const origin = body.origin?.trim();
    const destination = body.destination?.trim();

    if (!origin || !destination) {
      return Response.json(createApiError("Origin and destination are required."), {
        status: 400
      });
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
      const errorBody = await parseJsonSafely<ComputeRoutesResponse | null>(response).catch(
        () => null
      );

      return Response.json(
        createApiError(
          errorBody?.error?.message || "Unable to reach Google Maps route service."
        ),
        { status: 502 }
      );
    }

    const data = await parseJsonSafely<ComputeRoutesResponse>(response);
    const route = data.routes?.[0];
    const distanceMeters = route?.distanceMeters ?? null;
    const durationSeconds = route?.duration
      ? Number.parseInt(route.duration.replace("s", ""), 10)
      : null;

    if (distanceMeters == null) {
      return Response.json(
        createApiError(
          data.error?.message ||
            "Google Maps could not estimate this route. Please check the locations and try again."
        ),
        { status: 422 }
      );
    }

    return Response.json(
      createApiSuccess({
        distanceKm: Number((distanceMeters / 1000).toFixed(2)),
        distanceMeters,
        durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : null,
        provider: "routes_api"
      })
    );
  } catch {
    return Response.json(createApiError("Unable to estimate distance right now."), {
      status: 500
    });
  }
}
