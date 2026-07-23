export type GoogleComputedRoute = {
  distanceMeters?: number;
  duration?: string;
  staticDuration?: string;
  routeLabels?: string[];
  description?: string;
  polyline?: { encodedPolyline?: string };
  legs?: Array<{
    distanceMeters?: number;
    duration?: string;
    staticDuration?: string;
  }>;
};

export type RouteDeparture = {
  departureTime: string | null;
  timeBasis: "planned_departure" | "current_traffic";
};

export type TrafficAwareRouteEstimate = {
  distanceKm: number;
  distanceMeters: number;
  durationSeconds: number | null;
  staticDurationSeconds: number | null;
  provider: string;
  routePreference: string;
  routeLabels: string[];
  routeLabel: string;
  routeDescription: string | null;
  encodedPolyline: string | null;
  trafficAware: boolean;
  trafficDataAvailable: boolean;
  fallbackInfo: Record<string, unknown> | null;
  departureTime: string | null;
  departureTimeBasis: RouteDeparture["timeBasis"];
  calculatedAt: string;
  alternativesReturned: number;
  validRoutesReturned: number;
  fallbackRouteUsed: boolean;
  fallbackReason: string | null;
  selectedRouteIsGoogleDefault: boolean;
  legs: Array<{
    distanceMeters: number | null;
    durationSeconds: number | null;
    staticDurationSeconds: number | null;
  }>;
};

export type RouteSelectionResult = {
  selectedRoute: GoogleComputedRoute | null;
  validRoutes: GoogleComputedRoute[];
  fallbackRouteUsed: boolean;
  fallbackReason: string | null;
};

export function parseGoogleDurationSeconds(value: string | null | undefined) {
  const match = String(value ?? "").match(/^(\d+(?:\.\d+)?)s$/);
  if (!match) return null;
  const seconds = Number(match[1]);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

export function getBangkokRouteDeparture(
  bookingDate: string | null | undefined,
  pickupTime: string | null | undefined,
  now = new Date()
): RouteDeparture {
  const dateMatch = String(bookingDate ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const timeMatch = String(pickupTime ?? "").match(/^(\d{2}):(\d{2})$/);
  if (!dateMatch || !timeMatch) {
    return { departureTime: null, timeBasis: "current_traffic" };
  }

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) {
    return { departureTime: null, timeBasis: "current_traffic" };
  }

  const utcMilliseconds = Date.UTC(year, month - 1, day, hour - 7, minute);
  const departure = new Date(utcMilliseconds);
  const bangkokCheck = new Date(utcMilliseconds + 7 * 60 * 60 * 1000);
  const valid =
    bangkokCheck.getUTCFullYear() === year &&
    bangkokCheck.getUTCMonth() === month - 1 &&
    bangkokCheck.getUTCDate() === day &&
    bangkokCheck.getUTCHours() === hour &&
    bangkokCheck.getUTCMinutes() === minute;

  if (!valid || departure.getTime() <= now.getTime()) {
    return { departureTime: null, timeBasis: "current_traffic" };
  }

  return { departureTime: departure.toISOString(), timeBasis: "planned_departure" };
}

function isDefaultRoute(route: GoogleComputedRoute) {
  return route.routeLabels?.includes("DEFAULT_ROUTE") ?? false;
}

function isShorterDistanceReference(route: GoogleComputedRoute) {
  return route.routeLabels?.includes("SHORTER_DISTANCE") ?? false;
}

function isValidRoute(route: GoogleComputedRoute) {
  const durationSeconds = parseGoogleDurationSeconds(route.duration);
  return Number.isFinite(route.distanceMeters) && Number(route.distanceMeters) > 0 && durationSeconds != null;
}

function compareFastestRoute(
  route: GoogleComputedRoute,
  selected: GoogleComputedRoute | null,
  selectedDuration: number
) {
  const durationSeconds = parseGoogleDurationSeconds(route.duration);
  if (durationSeconds == null) return false;
  const faster = durationSeconds < selectedDuration;
  const preferredTie = durationSeconds === selectedDuration && isDefaultRoute(route) && selected != null && !isDefaultRoute(selected);
  return !selected || faster || preferredTie;
}

export function selectRouteWithFallback(routes: GoogleComputedRoute[]): RouteSelectionResult {
  const validRoutes = routes.filter(isValidRoute);
  let selected: GoogleComputedRoute | null = null;
  let selectedDuration = Number.POSITIVE_INFINITY;

  for (const route of validRoutes) {
    if (isShorterDistanceReference(route)) continue;
    const durationSeconds = parseGoogleDurationSeconds(route.duration);
    if (compareFastestRoute(route, selected, selectedDuration)) {
      selected = route;
      selectedDuration = durationSeconds ?? selectedDuration;
    }
  }

  if (selected) {
    return { selectedRoute: selected, validRoutes, fallbackRouteUsed: false, fallbackReason: null };
  }

  for (const route of validRoutes) {
    const durationSeconds = parseGoogleDurationSeconds(route.duration);
    if (compareFastestRoute(route, selected, selectedDuration)) {
      selected = route;
      selectedDuration = durationSeconds ?? selectedDuration;
    }
  }

  return {
    selectedRoute: selected,
    validRoutes,
    fallbackRouteUsed: selected != null,
    fallbackReason: selected ? "only_shorter_distance_routes_available" : null
  };
}

export function selectFastestPracticalRoute(routes: GoogleComputedRoute[]) {
  return selectRouteWithFallback(routes).selectedRoute;
}
