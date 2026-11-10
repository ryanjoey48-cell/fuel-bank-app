import { geofenceDistanceMeters, validGeofenceCoordinates } from "@/lib/fleet-geofence-engine";

export type FleetVisitForBooking = {
  visitKey: string;
  locationId: string;
  registration: string | null;
  arrivalAt: string;
};

export type BookingVisitCandidate = {
  id: string;
  bookingDate: string;
  vehicleRegistration: string | null;
  routeConfirmationStatus: string | null;
  pickup: { latitude: number | null; longitude: number | null };
  dropoff: { latitude: number | null; longitude: number | null };
};

export type ApprovedEesLocation = { id: string; latitude: number; longitude: number };
export type BookingVisitMatch = {
  status: "no_match" | "review_candidate" | "ambiguous";
  candidates: { bookingId: string; side: "pickup" | "dropoff"; distanceMeters: number }[];
};

function registrationKey(value: string | null) {
  return value?.normalize("NFKC").replace(/[\s\-‐‑‒–—]/g, "").toUpperCase() ?? "";
}

/** Spatial proximity is a review hint only. Booking identity still needs office confirmation. */
export function proposeBookingMatches(
  visit: FleetVisitForBooking,
  location: ApprovedEesLocation,
  bookings: readonly BookingVisitCandidate[],
  options: { maxDistanceMeters?: number; dateWindowDays?: number } = {}
): BookingVisitMatch {
  if (visit.locationId !== location.id || !validGeofenceCoordinates(location.latitude, location.longitude)) {
    return { status: "no_match", candidates: [] };
  }
  const arrivalMs = Date.parse(visit.arrivalAt);
  const vehicle = registrationKey(visit.registration);
  if (!Number.isFinite(arrivalMs) || !vehicle) return { status: "no_match", candidates: [] };
  const matches: BookingVisitMatch["candidates"] = [];
  const maxDistance = options.maxDistanceMeters ?? 75;
  const windowMs = (options.dateWindowDays ?? 1) * 86_400_000;
  for (const booking of bookings) {
    if (registrationKey(booking.vehicleRegistration) !== vehicle || booking.routeConfirmationStatus !== "confirmed") continue;
    const bookingDay = Date.parse(`${booking.bookingDate}T00:00:00+07:00`);
    if (!Number.isFinite(bookingDay) || Math.abs(arrivalMs - bookingDay) > windowMs + 86_400_000) continue;
    for (const side of ["pickup", "dropoff"] as const) {
      const candidate = booking[side];
      if (!validGeofenceCoordinates(candidate.latitude, candidate.longitude)) continue;
      const distanceMeters = geofenceDistanceMeters(location, {
        latitude: candidate.latitude as number, longitude: candidate.longitude as number
      });
      if (distanceMeters <= maxDistance) matches.push({ bookingId: booking.id, side, distanceMeters });
    }
  }
  matches.sort((a, b) => a.distanceMeters - b.distanceMeters || a.bookingId.localeCompare(b.bookingId));
  return { status: matches.length === 0 ? "no_match" : matches.length === 1 ? "review_candidate" : "ambiguous", candidates: matches };
}
