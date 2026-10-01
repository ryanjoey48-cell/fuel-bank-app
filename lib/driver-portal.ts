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
};

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

