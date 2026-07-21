import {
  extractGoogleMapsErrorCode,
  getGoogleMapsEnvironmentStatus,
  getGoogleMapsErrorMessage,
  getServerGoogleMapsApiKey
} from "@/lib/google-maps";
import { createApiError, createApiSuccess, parseJsonSafely } from "@/lib/http";
import {
  getBangkokRouteDeparture,
  parseGoogleDurationSeconds,
  selectFastestPracticalRoute,
  type GoogleComputedRoute
} from "@/lib/route-planning";

type RoutePoint = {
  label?: string;
  formatted_address?: string;
  place_id?: string | null;
  lat?: number | null;
  lng?: number | null;
};

type DistanceEstimateRequest = {
  origin?: string | RoutePoint;
  destination?: string | RoutePoint;
  waypoints?: Array<string | RoutePoint>;
  bookingDate?: string | null;
  pickupTime?: string | null;
};

type RoutesWaypoint =
  | { placeId: string }
  | { location: { latLng: { latitude: number; longitude: number } } }
  | { address: string };

type ComputeRoutesResponse = {
  routes?: GoogleComputedRoute[];
  fallbackInfo?: Record<string, unknown>;
  error?: { code?: number; status?: string; message?: string };
};

const ROUTES_FIELD_MASK = [
  "routes.distanceMeters",
  "routes.duration",
  "routes.staticDuration",
  "routes.routeLabels",
  "routes.description",
  "routes.polyline.encodedPolyline",
  "routes.legs.distanceMeters",
  "routes.legs.duration",
  "routes.legs.staticDuration",
  "fallbackInfo"
].join(",");

function toRoutesWaypoint(point: string | RoutePoint | undefined): RoutesWaypoint | null {
  if (!point) return null;
  if (typeof point === "string") {
    const address = point.trim();
    return address ? { address } : null;
  }

  const placeId = point.place_id?.replace(/^places\//, "").trim();
  if (placeId) return { placeId };

  if (Number.isFinite(point.lat) && Number.isFinite(point.lng) && point.lat != null && point.lng != null) {
    return { location: { latLng: { latitude: point.lat, longitude: point.lng } } };
  }

  const address = point.formatted_address?.trim() || point.label?.trim() || "";
  return address ? { address } : null;
}

function logGoogleMapsDistanceError(error: unknown, fallbackInfo?: Record<string, unknown> | null) {
  console.warn("[Fuel Bank] Google traffic-aware route estimate failed", {
    message: error instanceof Error ? error.message : String(error),
    fallbackInfo: fallbackInfo ?? null
  });
}

export async function POST(request: Request) {
  try {
    const apiKey = getServerGoogleMapsApiKey();
    if (!apiKey) {
      const missingVariables = getGoogleMapsEnvironmentStatus().missingServerVariables;
      return Response.json(createApiError(`Missing ${missingVariables.join(" and ") || "GOOGLE_MAPS_API_KEY"}`), { status: 503 });
    }

    let body: DistanceEstimateRequest;
    try {
      body = (await request.json()) as DistanceEstimateRequest;
    } catch {
      return Response.json(createApiError("Invalid request body."), { status: 400 });
    }

    const origin = toRoutesWaypoint(body.origin);
    const destination = toRoutesWaypoint(body.destination);
    const intermediates = (body.waypoints ?? []).map(toRoutesWaypoint).filter((point): point is RoutesWaypoint => point != null);
    if (!origin || !destination) {
      return Response.json(createApiError("Origin and destination are required."), { status: 400 });
    }

    const departure = getBangkokRouteDeparture(body.bookingDate, body.pickupTime);
    const computeBody = {
      origin,
      destination,
      intermediates,
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_AWARE_OPTIMAL",
      trafficModel: "BEST_GUESS",
      computeAlternativeRoutes: intermediates.length === 0,
      regionCode: "TH",
      languageCode: "en",
      units: "METRIC",
      ...(departure.departureTime ? { departureTime: departure.departureTime } : {})
    };

    const routesResponse = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": ROUTES_FIELD_MASK
      },
      body: JSON.stringify(computeBody)
    });
    const routesData = await parseJsonSafely<ComputeRoutesResponse>(routesResponse);
    const selectedRoute = selectFastestPracticalRoute(routesData.routes ?? []);

    if (!routesResponse.ok || !selectedRoute) {
      const rawMessage = routesData.error?.message || "Traffic-aware route data is unavailable. Please use the manual estimate.";
      logGoogleMapsDistanceError(rawMessage, routesData.fallbackInfo);
      const errorCode = extractGoogleMapsErrorCode(rawMessage) ?? routesData.error?.status ?? null;
      return Response.json(createApiError(getGoogleMapsErrorMessage(errorCode, rawMessage) ?? rawMessage), { status: 422 });
    }

    const durationSeconds = parseGoogleDurationSeconds(selectedRoute.duration);
    const staticDurationSeconds = parseGoogleDurationSeconds(selectedRoute.staticDuration);
    const routeLabels = selectedRoute.routeLabels ?? [];
    const fallbackInfo = routesData.fallbackInfo ?? null;
    if (fallbackInfo) {
      console.warn("[Fuel Bank] Google Routes API used fallback routing", { fallbackInfo });
    }

    return Response.json(createApiSuccess({
      distanceKm: Number((Number(selectedRoute.distanceMeters) / 1000).toFixed(3)),
      distanceMeters: Number(selectedRoute.distanceMeters),
      durationSeconds,
      staticDurationSeconds,
      provider: "google_routes_api",
      routePreference: "TRAFFIC_AWARE_OPTIMAL",
      routeLabels,
      routeLabel: routeLabels.includes("DEFAULT_ROUTE") ? "DEFAULT_ROUTE" : routeLabels[0] ?? "FASTEST_TRAFFIC_AWARE",
      routeDescription: selectedRoute.description ?? null,
      encodedPolyline: selectedRoute.polyline?.encodedPolyline ?? null,
      trafficAware: fallbackInfo == null,
      trafficDataAvailable: fallbackInfo == null,
      fallbackInfo,
      departureTime: departure.departureTime,
      departureTimeBasis: departure.timeBasis,
      calculatedAt: new Date().toISOString(),
      alternativesReturned: routesData.routes?.length ?? 0,
      selectedRouteIsGoogleDefault: routeLabels.includes("DEFAULT_ROUTE"),
      legs: (selectedRoute.legs ?? []).map((leg) => ({
        distanceMeters: leg.distanceMeters ?? null,
        durationSeconds: parseGoogleDurationSeconds(leg.duration),
        staticDurationSeconds: parseGoogleDurationSeconds(leg.staticDuration)
      }))
    }));
  } catch (error) {
    logGoogleMapsDistanceError(error);
    return Response.json(createApiError("Traffic-aware route data is unavailable. You can enter distance and time manually."), { status: 503 });
  }
}
