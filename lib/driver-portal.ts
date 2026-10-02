export type DriverPortalJob = {
  id: string;
  bookingDate: string;
  pickupTime: string | null;
  clientName: string | null;
  pickupName: string;
  pickupAddress: string | null;
  pickupPlaceId: string | null;
  pickupLat: number | null;
  pickupLng: number | null;
  dropoffName: string;
  dropoffAddress: string | null;
  dropoffPlaceId: string | null;
  dropoffLat: number | null;
  dropoffLng: number | null;
  vehicleRegistration: string | null;
  trailerRegistration: string | null;
  vehicleType: string | null;
  jobOrderNumber: string | null;
  locationsVerified?: boolean;
};

export const DRIVER_JOB_EVENT_TYPES = ["pickup_arrived", "pickup_departed", "delivery_arrived", "job_completed"] as const;
export type DriverJobEventType = (typeof DRIVER_JOB_EVENT_TYPES)[number];
export type DriverJobEvent = {
  id: string;
  eventType: DriverJobEventType;
  eventTime: string;
  latitude: number | null;
  longitude: number | null;
};
export type DriverRouteLocation = {
  name: string;
  address: string | null;
  placeId: string | null;
  latitude: number | null;
  longitude: number | null;
};

function directionLocation(location: DriverRouteLocation, verified: boolean) {
  if (verified && location.latitude != null && location.longitude != null
      && Number.isFinite(location.latitude) && Number.isFinite(location.longitude)
      && Math.abs(location.latitude) <= 90 && Math.abs(location.longitude) <= 180) {
    return `${location.latitude},${location.longitude}`;
  }
  return location.address?.trim() || location.name.trim();
}

export function buildDriverDirectionsUrl(job: DriverPortalJob, mode: "depot" | "current" | "pickup-to-dropoff" | "pickup" | "delivery", depot: DriverRouteLocation) {
  const pickup = directionLocation({ name: job.pickupName, address: job.pickupAddress, placeId: job.pickupPlaceId, latitude: job.pickupLat, longitude: job.pickupLng }, job.locationsVerified === true);
  const dropoff = directionLocation({ name: job.dropoffName, address: job.dropoffAddress, placeId: job.dropoffPlaceId, latitude: job.dropoffLat, longitude: job.dropoffLng }, job.locationsVerified === true);
  const destination = mode === "pickup" ? pickup : dropoff;
  if (!destination || (mode !== "delivery" && !pickup)) return null;
  const url = new URL("https://www.google.com/maps/dir/");
  url.searchParams.set("api", "1");
  url.searchParams.set("travelmode", "driving");
  url.searchParams.set("destination", destination);
  const destinationPlaceId = mode === "pickup" ? job.pickupPlaceId : job.dropoffPlaceId;
  if (job.locationsVerified && destinationPlaceId) url.searchParams.set("destination_place_id", destinationPlaceId.replace(/^places\//, ""));
  if (mode === "depot") {
    const origin = directionLocation(depot, true);
    if (!origin) return null;
    url.searchParams.set("origin", origin);
    if (depot.placeId) url.searchParams.set("origin_place_id", depot.placeId.replace(/^places\//, ""));
  }
  if (mode === "pickup-to-dropoff") {
    url.searchParams.set("origin", pickup);
    if (job.locationsVerified && job.pickupPlaceId) url.searchParams.set("origin_place_id", job.pickupPlaceId.replace(/^places\//, ""));
  }
  // Omitting origin lets Google Maps use the driver's current location; no GPS is invented.
  if (mode === "depot" || mode === "current") {
    url.searchParams.set("waypoints", pickup);
    if (job.locationsVerified && job.pickupPlaceId) url.searchParams.set("waypoint_place_ids", job.pickupPlaceId.replace(/^places\//, ""));
  }
  return url.toString();
}

export type DriverPortalIdentity = {
  driverId: string;
  driverName: string;
  vehicleRegistration: string | null;
  vehicleType: string | null;
};

export function buildDriverMapsUrl(location: {
  name: string;
  address: string | null;
  placeId: string | null;
  latitude: number | null;
  longitude: number | null;
}) {
  const url = new URL("https://www.google.com/maps/search/");
  url.searchParams.set("api", "1");

  const placeId = location.placeId?.replace(/^places\//, "").trim();
  if (placeId) {
    url.searchParams.set("query", location.address?.trim() || location.name);
    url.searchParams.set("query_place_id", placeId);
    return url.toString();
  }

  if (location.latitude != null && location.longitude != null) {
    url.searchParams.set("query", `${location.latitude},${location.longitude}`);
    return url.toString();
  }

  const query = location.address?.trim() || location.name.trim();
  if (!query) return null;
  url.searchParams.set("query", query);
  return url.toString();
}

