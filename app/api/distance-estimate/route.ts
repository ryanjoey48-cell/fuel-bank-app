import {
  extractGoogleMapsErrorCode,
  getGoogleMapsEnvironmentStatus,
  getGoogleMapsErrorMessage,
  getServerGoogleMapsApiKey
} from "@/lib/google-maps";
import { createApiError, createApiSuccess, parseJsonSafely } from "@/lib/http";

type ComputeRoutesResponse = {
  routes?: Array<{
    distanceMeters?: number;
    duration?: string;
    legs?: Array<{
      distanceMeters?: number;
      duration?: string;
    }>;
  }>;
  error?: {
    message?: string;
  };
};

type DirectionsResponse = {
  routes?: Array<{
    legs?: Array<{
      distance?: {
        value?: number;
      };
      duration?: {
        value?: number;
      };
      start_address?: string;
      end_address?: string;
    }>;
  }>;
  error_message?: string;
  status?: string;
};

type RoutePoint = {
  label?: string;
  formatted_address?: string;
  place_id?: string | null;
  lat?: number;
  lng?: number;
};

function toRouteWaypoint(point: string | RoutePoint | undefined) {
  if (!point) return null;
  if (typeof point === "string") {
    const address = point.trim();
    return address ? { address } : null;
  }

  const lat = point.lat;
  const lng = point.lng;
  if (Number.isFinite(lat) && Number.isFinite(lng) && lat != null && lng != null) {
    return {
      location: {
        latLng: {
          latitude: lat,
          longitude: lng
        }
      }
    };
  }

  const address = point.formatted_address?.trim() || point.label?.trim();
  return address ? { address } : null;
}

function toDirectionsWaypoint(point: string | RoutePoint | undefined) {
  if (!point) return "";
  if (typeof point === "string") {
    return point.trim();
  }

  const lat = point.lat;
  const lng = point.lng;
  if (Number.isFinite(lat) && Number.isFinite(lng) && lat != null && lng != null) {
    return `${lat},${lng}`;
  }

  if (point.place_id) {
    return `place_id:${point.place_id.replace(/^places\//, "")}`;
  }

  return point.formatted_address?.trim() || point.label?.trim() || "";
}

function parseDurationSeconds(value: string | undefined) {
  if (!value) return null;
  const parsed = Number.parseInt(value.replace("s", ""), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

async function fetchDirectionsEstimate(
  apiKey: string,
  body: { origin?: string | RoutePoint; destination?: string | RoutePoint; waypoints?: Array<string | RoutePoint> }
) {
  const origin = toDirectionsWaypoint(body.origin);
  const destination = toDirectionsWaypoint(body.destination);

  if (!origin || !destination) {
    return null;
  }

  const directionsUrl = new URL("https://maps.googleapis.com/maps/api/directions/json");
  directionsUrl.searchParams.set("origin", origin);
  directionsUrl.searchParams.set("destination", destination);
  directionsUrl.searchParams.set("key", apiKey);
  directionsUrl.searchParams.set("language", "en");
  directionsUrl.searchParams.set("region", "th");

  const waypointValues = Array.isArray(body.waypoints)
    ? body.waypoints.map(toDirectionsWaypoint).filter(Boolean)
    : [];

  if (waypointValues.length) {
    directionsUrl.searchParams.set("waypoints", waypointValues.join("|"));
  }

  const directionsResponse = await fetch(directionsUrl, { cache: "no-store" });
  const directionsData = await parseJsonSafely<DirectionsResponse>(directionsResponse);
  const directionsLegs = directionsData.routes?.[0]?.legs ?? [];
  const directionsDistanceMeters = directionsLegs.reduce(
    (sum, leg) => sum + Number(leg.distance?.value || 0),
    0
  );
  const directionsDurationSeconds = directionsLegs.reduce(
    (sum, leg) => sum + Number(leg.duration?.value || 0),
    0
  );

  if (
    directionsResponse.ok &&
    directionsData.status === "OK" &&
    directionsDistanceMeters > 0
  ) {
    return {
      ok: true as const,
      data: {
        distanceKm: Number((directionsDistanceMeters / 1000).toFixed(2)),
        distanceMeters: directionsDistanceMeters,
        durationSeconds: directionsDurationSeconds || null,
        provider: "directions_api",
        legs: directionsLegs.map((leg) => ({
          distanceMeters: leg.distance?.value ?? null,
          durationSeconds: leg.duration?.value ?? null,
          startAddress: leg.start_address ?? null,
          endAddress: leg.end_address ?? null
        }))
      }
    };
  }

  const rawMessage =
    directionsData.error_message ||
    (directionsData.status && directionsData.status !== "ZERO_RESULTS"
      ? `Google Directions returned ${directionsData.status}.`
      : "Unable to reach Google Maps route service.");
  const errorCode = extractGoogleMapsErrorCode(rawMessage) ?? directionsData.status ?? null;

  return {
    ok: false as const,
    message: getGoogleMapsErrorMessage(errorCode, rawMessage) ?? rawMessage
  };
}

export async function POST(request: Request) {
  try {
    const apiKey = getServerGoogleMapsApiKey();

    if (!apiKey) {
      const missingVariables = getGoogleMapsEnvironmentStatus().missingServerVariables;
      return Response.json(createApiError(`Missing ${missingVariables.join(" and ") || "GOOGLE_MAPS_API_KEY"}`), {
        status: 503
      });
    }

    let body: { origin?: string | RoutePoint; destination?: string | RoutePoint; waypoints?: Array<string | RoutePoint> } = {};

    try {
      body = (await request.json()) as typeof body;
    } catch {
      return Response.json(createApiError("Invalid request body."), { status: 400 });
    }

    const origin = toRouteWaypoint(body.origin);
    const destination = toRouteWaypoint(body.destination);
    const waypoints = Array.isArray(body.waypoints)
      ? body.waypoints.map((waypoint) => toRouteWaypoint(waypoint)).filter((waypoint): waypoint is NonNullable<typeof waypoint> => Boolean(waypoint))
      : [];

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
        "X-Goog-FieldMask": "routes.distanceMeters,routes.duration,routes.legs.distanceMeters,routes.legs.duration"
      },
      body: JSON.stringify({
        origin,
        destination,
        intermediates: waypoints,
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

      const directionsEstimate = await fetchDirectionsEstimate(apiKey, body);
      if (directionsEstimate?.ok) {
        return Response.json(createApiSuccess(directionsEstimate.data));
      }

      const rawMessage =
        directionsEstimate?.message ||
        errorBody?.error?.message ||
        "Unable to reach Google Maps route service.";
      const errorCode = extractGoogleMapsErrorCode(rawMessage);

      return Response.json(createApiError(getGoogleMapsErrorMessage(errorCode, rawMessage) ?? rawMessage), {
        status: 502
      });
    }

    const data = await parseJsonSafely<ComputeRoutesResponse>(response);
    const route = data.routes?.[0];
    const distanceMeters = route?.distanceMeters ?? null;
    const durationSeconds = parseDurationSeconds(route?.duration);

    if (distanceMeters == null) {
      const directionsEstimate = await fetchDirectionsEstimate(apiKey, body);
      if (directionsEstimate?.ok) {
        return Response.json(createApiSuccess(directionsEstimate.data));
      }

      const rawMessage =
        directionsEstimate?.message ||
        data.error?.message ||
        "Google Maps could not estimate this route. Please check the locations and try again.";
      const errorCode = extractGoogleMapsErrorCode(rawMessage);

      return Response.json(createApiError(getGoogleMapsErrorMessage(errorCode, rawMessage) ?? rawMessage), {
        status: 422
      });
    }

    return Response.json(
      createApiSuccess({
        distanceKm: Number((distanceMeters / 1000).toFixed(2)),
        distanceMeters,
        durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : null,
        provider: "routes_api",
        legs: (route?.legs ?? []).map((leg) => ({
          distanceMeters: leg.distanceMeters ?? null,
          durationSeconds: parseDurationSeconds(leg.duration)
        }))
      })
    );
  } catch {
    return Response.json(createApiError("Google route estimate unavailable right now."), {
      status: 503
    });
  }
}
