import type { TripJourney } from "@/types/database";

export type TripFinancialSummary = {
  operationalTrips: number;
  revenueGeneratingTrips: number;
  excludedTrips: number;
  operationalDistanceKm: number;
  revenueDistanceKm: number;
  nonChargeableDistanceKm: number;
  includedRevenue: number;
  excludedOriginalRevenue: number;
  averageRevenuePerTrip: number | null;
  revenuePerKm: number | null;
};

export function isTripIncludedInFinancials(trip: Pick<TripJourney, "include_in_financials">) {
  return trip.include_in_financials !== false;
}

export function getTripOperationalDistance(trip: Partial<TripJourney>) {
  const manual = Number(trip.manual_actual_km);
  if (Number.isFinite(manual) && manual > 0) return manual;
  const start = Number(trip.start_mileage);
  const end = Number(trip.end_mileage);
  if (Number.isFinite(start) && Number.isFinite(end) && end > start) return end - start;
  const actual = Number(trip.actual_distance_km);
  if (Number.isFinite(actual) && actual > 0) return actual;
  for (const value of [trip.manual_estimated_distance_km, trip.google_estimated_km, trip.booking_estimated_km, trip.estimated_distance_km]) {
    const distance = Number(value);
    if (Number.isFinite(distance) && distance > 0) return distance;
  }
  return 0;
}

export function summarizeTripFinancials(trips: Array<Partial<TripJourney>>): TripFinancialSummary {
  let operationalDistanceKm = 0;
  let revenueDistanceKm = 0;
  let includedRevenue = 0;
  let excludedOriginalRevenue = 0;
  let revenueGeneratingTrips = 0;

  for (const trip of trips) {
    const distance = getTripOperationalDistance(trip);
    const price = Number(trip.original_trip_price);
    const safePrice = Number.isFinite(price) && price > 0 ? price : 0;
    operationalDistanceKm += distance;
    if (trip.include_in_financials !== false) {
      revenueGeneratingTrips += 1;
      revenueDistanceKm += distance;
      includedRevenue += safePrice;
    } else {
      excludedOriginalRevenue += safePrice;
    }
  }

  return {
    operationalTrips: trips.length,
    revenueGeneratingTrips,
    excludedTrips: trips.length - revenueGeneratingTrips,
    operationalDistanceKm,
    revenueDistanceKm,
    nonChargeableDistanceKm: operationalDistanceKm - revenueDistanceKm,
    includedRevenue,
    excludedOriginalRevenue,
    averageRevenuePerTrip: revenueGeneratingTrips > 0 ? includedRevenue / revenueGeneratingTrips : null,
    revenuePerKm: revenueDistanceKm > 0 ? includedRevenue / revenueDistanceKm : null
  };
}
