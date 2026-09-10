import {
  buildVerifiedFullTankCycles,
  calculateRouteAccuracy,
  calculateVehicleCoverage,
  calculateWeeklyOdometerDistance,
  cyclesEndingInPeriod,
  fuelPurchasedInPeriod,
  getMondaySundayWeek,
  getTripDistanceUsed,
  inDateRange,
  previousCompletedBangkokWeek,
  type DistanceSource,
  type VerifiedFuelCycle
} from "@/lib/fuel-cycles";
import { operationalRouteKey, reportingCustomerName, type CanonicalVehicleType } from "@/lib/booking-insights";
import type { BookingDiaryEntry, Driver, FuelLogWithDriver, TripJourneyWithFuel, Vehicle, WeeklyMileageEntry } from "@/types/database";

export type WeeklyBossPeriod = {
  startDate: string;
  endDate: string;
};

export type AttentionIssueKey =
  | "booking_missing_client"
  | "booking_missing_maps"
  | "booking_missing_driver"
  | "booking_missing_vehicle"
  | "booking_without_trip"
  | "trip_missing_working_km"
  | "trip_needs_fuel_check"
  | "trip_needs_mileage_verification"
  | "vehicle_missing_weekly_mileage"
  | "unchecked_fuel_receipt"
  | "invalid_fuel_odometer"
  | "full_tank_cycle_waiting"
  | "trip_distance_exceeds_odometer";

export type WeeklyBossAttentionIssue = {
  key: AttentionIssueKey;
  label: string;
  count: number;
  rows: Array<{ id: string; label: string; href?: string }>;
};

export type WeeklyBossReport = {
  period: WeeklyBossPeriod;
  kpis: {
    bookingJobs: number;
    tripJourneys: number;
    dataCheckedTrips: number;
    tripCoveragePercent: number | null;
    plannedGoogleKm: number;
    plannedGoogleRecordCount: number;
    workingKm: number;
    workingBreakdown: Record<DistanceSource, number>;
    verifiedActualKm: number;
    verifiedActualRecordCount: number;
    fuelPurchasedLitres: number;
    fuelPurchasedThb: number;
    averageFuelPricePerLitre: number | null;
    verifiedCyclesEnding: number;
    weeklyOdometerDistance: number;
    otherUnallocatedMovement: number;
    vehiclesMissingWeeklyMileage: number;
    routeAccuracySampleSize: number;
    routeAccuracyPercent: number | null;
  };
  clientActivity: Array<{
    clientId: string;
    clientName: string;
    jobCount: number;
    sharePercent: number;
    plannedKm: number;
    workingKm: number;
    mostCommonRoute: string;
    mostRequestedVehicleType: string;
    missingTripJourneyCount: number;
  }>;
  vehicleReconciliation: Array<{
    vehicleReg: string;
    vehicleType: string;
    drivers: string[];
    jobCount: number;
    tripCount: number;
    workingKm: number;
    weeklyOdometerDistance: number | null;
    coveragePercent: number | null;
    otherUnallocatedMovement: number | null;
    fuelPurchasedLitres: number;
    fuelPurchasedThb: number;
    verifiedCycleKmPerLitre: number | null;
    verifiedCycleCostPerKm: number | null;
    dataStatus: "Complete" | "Needs Fuel Check" | "Needs Mileage Check" | "Needs Review";
    reviewNotes: string[];
  }>;
  driverWorkload: Array<{
    driver: string;
    jobs: number;
    trips: number;
    workingKm: number;
    dataCheckedTrips: number;
    missingInformationCount: number;
  }>;
  routeActivity: Array<{
    route: string;
    jobCount: number;
    activeDates: string[];
    averagePlannedKm: number | null;
    averageWorkingKm: number | null;
    vehicleTypesUsed: string[];
    missingMapsOrTripCount: number;
  }>;
  needsAttention: WeeklyBossAttentionIssue[];
  verifiedCyclesEndingThisWeek: VerifiedFuelCycle[];
};

const vehicleLabels: Record<string, string> = {
  FOUR_WHEEL_TRUCK: "4-wheel truck",
  SIX_WHEEL_TRUCK: "6-wheel truck",
  SIX_PLUS_SIX_WHEELER: "6+6-wheel truck",
  EIGHTEEN_WHEELER: "18-wheel truck / trailer"
};

function percent(count: number, total: number) {
  return total > 0 ? Math.round((count / total) * 1000) / 10 : null;
}

function round(value: number, decimals = 1) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function safeNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function mode(values: string[]) {
  const counts = new Map<string, number>();
  values.filter(Boolean).forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? "-";
}

function routeName(booking: BookingDiaryEntry) {
  return `${booking.pickup || "Missing pickup"} -> ${booking.dropoff || "Missing drop-off"}`;
}

function normalizeVehicle(value: string | null | undefined) {
  return String(value ?? "").trim();
}

function vehicleTypeFor(registration: string, vehicles: Vehicle[], bookings: BookingDiaryEntry[], trips: TripJourneyWithFuel[]) {
  const matched = vehicles.find((vehicle) => normalizeVehicle(vehicle.vehicle_reg || vehicle.registration).toLowerCase() === registration.toLowerCase());
  if (matched?.vehicle_type) return vehicleLabels[String(matched.vehicle_type)] ?? String(matched.vehicle_type);
  return mode([
    ...bookings.filter((booking) => normalizeVehicle(booking.vehicle) === registration).map((booking) => booking.vehicle || ""),
    ...trips.filter((trip) => normalizeVehicle(trip.vehicle_reg) === registration).map((trip) => trip.vehicle_type || "")
  ]);
}

function bookingHasMaps(booking: BookingDiaryEntry) {
  return Boolean((booking.estimated_distance_km ?? 0) > 0 || (booking.pickup_place_id && booking.dropoff_place_id));
}

function tripNeedsFuelCheck(trip: TripJourneyWithFuel) {
  return trip.fuel_source !== "manual" && (trip.linkedFuelLogs ?? []).length === 0 && !((trip.manual_litres_used ?? 0) > 0 || (trip.manual_fuel_cost ?? 0) > 0);
}

function labelTrip(trip: TripJourneyWithFuel) {
  return `${trip.trip_date} ${trip.vehicle_reg || trip.vehicle_type || "-"} ${trip.driver || ""}`.trim();
}

function labelBooking(booking: BookingDiaryEntry) {
  return `${booking.booking_date} ${booking.booking_id || booking.job_order_number || booking.id}`;
}

export function defaultWeeklyBossPeriod(now = new Date()) {
  return previousCompletedBangkokWeek(now);
}

export function weekFromEndingSunday(weekEndingSunday: string) {
  return getMondaySundayWeek(weekEndingSunday);
}

export function buildWeeklyBossReport({
  bookings,
  trips,
  fuelLogs,
  weeklyMileage,
  vehicles,
  drivers,
  period
}: {
  bookings: BookingDiaryEntry[];
  trips: TripJourneyWithFuel[];
  fuelLogs: FuelLogWithDriver[];
  weeklyMileage: WeeklyMileageEntry[];
  vehicles: Vehicle[];
  drivers: Driver[];
  period: WeeklyBossPeriod;
}): WeeklyBossReport {
  const selectedBookings = bookings.filter((booking) => inDateRange(booking.booking_date, period.startDate, period.endDate));
  const selectedTrips = trips.filter((trip) => inDateRange(trip.trip_date, period.startDate, period.endDate));
  const selectedFuel = fuelLogs.filter((log) => inDateRange(log.date, period.startDate, period.endDate));
  const tripsByBookingId = new Map<string, TripJourneyWithFuel>();
  for (const trip of trips) {
    if (trip.booking_diary_id) tripsByBookingId.set(String(trip.booking_diary_id), trip);
    if (trip.booking_id) tripsByBookingId.set(String(trip.booking_id), trip);
  }

  const distances = selectedTrips.map((trip) => ({ trip, distance: getTripDistanceUsed(trip) }));
  const workingBreakdown: Record<DistanceSource, number> = { manual: 0, odometer: 0, google: 0, missing: 0 };
  for (const row of distances) workingBreakdown[row.distance.source] += row.distance.workingKm ?? 0;
  const fuelPurchased = fuelPurchasedInPeriod(fuelLogs, period.startDate, period.endDate);
  const allCycles = buildVerifiedFullTankCycles(fuelLogs);
  const cyclesEnding = cyclesEndingInPeriod(allCycles, period.startDate, period.endDate).filter((cycle) => cycle.status === "verified");
  const routeAccuracy = calculateRouteAccuracy(selectedTrips);

  const vehicleRegs = [...new Set([
    ...selectedBookings.map((booking) => normalizeVehicle(booking.vehicle_registration || booking.vehicle)).filter(Boolean),
    ...selectedTrips.map((trip) => normalizeVehicle(trip.vehicle_reg || trip.vehicle_type)).filter(Boolean),
    ...selectedFuel.map((log) => normalizeVehicle(log.vehicle_reg)).filter(Boolean)
  ])].sort((a, b) => a.localeCompare(b));

  const vehicleReconciliation = vehicleRegs.map((vehicleReg) => {
    const vehicleBookings = selectedBookings.filter((booking) => normalizeVehicle(booking.vehicle_registration || booking.vehicle) === vehicleReg);
    const vehicleTrips = selectedTrips.filter((trip) => normalizeVehicle(trip.vehicle_reg || trip.vehicle_type) === vehicleReg);
    const vehicleFuel = selectedFuel.filter((log) => normalizeVehicle(log.vehicle_reg) === vehicleReg);
    const workingKm = vehicleTrips.reduce((sum, trip) => sum + (getTripDistanceUsed(trip).workingKm ?? 0), 0);
    const odometerDistance = calculateWeeklyOdometerDistance(weeklyMileage, vehicleReg, period.endDate);
    const coverage = calculateVehicleCoverage({ vehicleReg, odometerDistanceKm: odometerDistance, linkedTripWorkingKm: workingKm });
    const cycle = cyclesEnding.find((item) => normalizeVehicle(item.vehicleReg) === vehicleReg) ?? null;
    const missingFuel = vehicleTrips.some(tripNeedsFuelCheck);
    const missingMileage = odometerDistance == null;
    const status: WeeklyBossReport["vehicleReconciliation"][number]["dataStatus"] = coverage.needsReview ? "Needs Review" : missingFuel ? "Needs Fuel Check" : missingMileage ? "Needs Mileage Check" : "Complete";
    return {
      vehicleReg,
      vehicleType: vehicleTypeFor(vehicleReg, vehicles, vehicleBookings, vehicleTrips),
      drivers: [...new Set([...vehicleTrips.map((trip) => trip.driver || ""), ...vehicleFuel.map((log) => log.driver || "")].filter(Boolean))],
      jobCount: vehicleBookings.length,
      tripCount: vehicleTrips.length,
      workingKm: round(workingKm),
      weeklyOdometerDistance: odometerDistance == null ? null : round(odometerDistance),
      coveragePercent: coverage.coveragePercent == null ? null : round(coverage.coveragePercent),
      otherUnallocatedMovement: coverage.otherUnallocatedKm == null ? null : round(coverage.otherUnallocatedKm),
      fuelPurchasedLitres: round(vehicleFuel.reduce((sum, log) => sum + safeNumber(log.litres), 0), 2),
      fuelPurchasedThb: round(vehicleFuel.reduce((sum, log) => sum + safeNumber(log.total_cost), 0), 2),
      verifiedCycleKmPerLitre: cycle?.kmPerLitre == null ? null : round(cycle.kmPerLitre, 2),
      verifiedCycleCostPerKm: cycle?.costPerKm == null ? null : round(cycle.costPerKm, 2),
      dataStatus: status,
      reviewNotes: [coverage.message, missingFuel ? "Trip needs fuel review/link" : "", missingMileage ? "Vehicle missing current or previous Weekly Mileage" : ""].filter(Boolean) as string[]
    };
  });

  const clientGroups = new Map<string, BookingDiaryEntry[]>();
  selectedBookings.forEach((booking) => {
    const name = reportingCustomerName(booking);
    if (!name || !booking.client_id) return;
    clientGroups.set(booking.client_id, [...(clientGroups.get(booking.client_id) ?? []), booking]);
  });
  const clientActivity = [...clientGroups.entries()].map(([clientId, rows]) => {
    const rowTrips = rows.map((booking) => tripsByBookingId.get(String(booking.id))).filter(Boolean) as TripJourneyWithFuel[];
    const plannedRows = rows.filter((booking) => (booking.estimated_distance_km ?? 0) > 0);
    return {
      clientId,
      clientName: reportingCustomerName(rows[0]) ?? "-",
      jobCount: rows.length,
      sharePercent: percent(rows.length, selectedBookings.length) ?? 0,
      plannedKm: round(plannedRows.reduce((sum, booking) => sum + safeNumber(booking.estimated_distance_km), 0)),
      workingKm: round(rowTrips.reduce((sum, trip) => sum + (getTripDistanceUsed(trip).workingKm ?? 0), 0)),
      mostCommonRoute: mode(rows.map(routeName)),
      mostRequestedVehicleType: mode(rows.map((booking) => booking.vehicle || "Unclassified")),
      missingTripJourneyCount: rows.filter((booking) => !tripsByBookingId.has(String(booking.id))).length
    };
  }).sort((a, b) => b.jobCount - a.jobCount || a.clientName.localeCompare(b.clientName));

  const driverNames = [...new Set([...selectedBookings.map((booking) => booking.driver || ""), ...selectedTrips.map((trip) => trip.driver || ""), ...drivers.map((driver) => driver.name || "")].filter(Boolean))];
  const driverWorkload = driverNames.map((driver) => {
    const driverBookings = selectedBookings.filter((booking) => booking.driver === driver);
    const driverTrips = selectedTrips.filter((trip) => trip.driver === driver);
    return {
      driver,
      jobs: driverBookings.length,
      trips: driverTrips.length,
      workingKm: round(driverTrips.reduce((sum, trip) => sum + (getTripDistanceUsed(trip).workingKm ?? 0), 0)),
      dataCheckedTrips: driverTrips.filter((trip) => !tripNeedsFuelCheck(trip) && getTripDistanceUsed(trip).source !== "missing").length,
      missingInformationCount: driverBookings.filter((booking) => !bookingHasMaps(booking) || !booking.vehicle || !booking.client_id).length + driverTrips.filter((trip) => getTripDistanceUsed(trip).source === "missing" || tripNeedsFuelCheck(trip)).length
    };
  }).filter((row) => row.jobs || row.trips).sort((a, b) => b.jobs - a.jobs || b.trips - a.trips || a.driver.localeCompare(b.driver));

  const routeGroups = new Map<string, BookingDiaryEntry[]>();
  selectedBookings.forEach((booking) => {
    const key = operationalRouteKey(booking);
    routeGroups.set(key, [...(routeGroups.get(key) ?? []), booking]);
  });
  const routeActivity = [...routeGroups.values()].map((rows) => {
    const rowTrips = rows.map((booking) => tripsByBookingId.get(String(booking.id))).filter(Boolean) as TripJourneyWithFuel[];
    const plannedRows = rows.filter((booking) => (booking.estimated_distance_km ?? 0) > 0);
    const workingRows = rowTrips.map(getTripDistanceUsed).filter((distance) => distance.workingKm != null);
    return {
      route: mode(rows.map(routeName)),
      jobCount: rows.length,
      activeDates: [...new Set(rows.map((booking) => booking.booking_date))].sort(),
      averagePlannedKm: plannedRows.length ? round(plannedRows.reduce((sum, booking) => sum + safeNumber(booking.estimated_distance_km), 0) / plannedRows.length) : null,
      averageWorkingKm: workingRows.length ? round(workingRows.reduce((sum, distance) => sum + (distance.workingKm ?? 0), 0) / workingRows.length) : null,
      vehicleTypesUsed: [...new Set(rows.map((booking) => booking.vehicle || "Unclassified"))],
      missingMapsOrTripCount: rows.filter((booking) => !bookingHasMaps(booking) || !tripsByBookingId.has(String(booking.id))).length
    };
  }).sort((a, b) => b.jobCount - a.jobCount || a.route.localeCompare(b.route));

  const issue = (key: AttentionIssueKey, label: string, rows: WeeklyBossAttentionIssue["rows"]): WeeklyBossAttentionIssue => ({ key, label, count: rows.length, rows });
  const vehiclesMissing = vehicleReconciliation.filter((row) => row.weeklyOdometerDistance == null);
  const pendingFullTankVehicles = [...new Set(fuelLogs.filter((log) => log.full_tank_confirmed).map((log) => normalizeVehicle(log.vehicle_reg)).filter(Boolean))]
    .filter((vehicleReg) => !cyclesEnding.some((cycle) => normalizeVehicle(cycle.vehicleReg) === vehicleReg));

  const needsAttention = [
    issue("booking_missing_client", "Booking missing Client Name", selectedBookings.filter((booking) => !booking.client_id || !reportingCustomerName(booking)).map((booking) => ({ id: booking.id, label: labelBooking(booking), href: "/booking-diary" }))),
    issue("booking_missing_maps", "Booking missing Google Maps route/distance", selectedBookings.filter((booking) => !bookingHasMaps(booking)).map((booking) => ({ id: booking.id, label: labelBooking(booking), href: "/booking-diary" }))),
    issue("booking_missing_driver", "Booking missing driver", selectedBookings.filter((booking) => !booking.driver).map((booking) => ({ id: booking.id, label: labelBooking(booking), href: "/booking-diary" }))),
    issue("booking_missing_vehicle", "Booking missing vehicle", selectedBookings.filter((booking) => !booking.vehicle && !booking.vehicle_registration).map((booking) => ({ id: booking.id, label: labelBooking(booking), href: "/booking-diary" }))),
    issue("booking_without_trip", "Booking without Trip Journey", selectedBookings.filter((booking) => !tripsByBookingId.has(String(booking.id))).map((booking) => ({ id: booking.id, label: labelBooking(booking), href: `/trip-journey?bookingId=${booking.id}` }))),
    issue("trip_missing_working_km", "Trip missing Working KM", selectedTrips.filter((trip) => getTripDistanceUsed(trip).source === "missing").map((trip) => ({ id: trip.id, label: labelTrip(trip), href: `/trip-journey?tripId=${trip.id}` }))),
    issue("trip_needs_fuel_check", "Trip needing fuel review/link", selectedTrips.filter(tripNeedsFuelCheck).map((trip) => ({ id: trip.id, label: labelTrip(trip), href: `/trip-journey?tripId=${trip.id}` }))),
    issue("trip_needs_mileage_verification", "Trip needing mileage verification", selectedTrips.filter((trip) => getTripDistanceUsed(trip).source === "google" || getTripDistanceUsed(trip).source === "missing").map((trip) => ({ id: trip.id, label: labelTrip(trip), href: `/trip-journey?tripId=${trip.id}` }))),
    issue("vehicle_missing_weekly_mileage", "Vehicle missing current or previous Weekly Mileage", vehiclesMissing.map((row) => ({ id: row.vehicleReg, label: row.vehicleReg, href: "/weekly-mileage" }))),
    issue("unchecked_fuel_receipt", "Unchecked fuel receipts", selectedFuel.filter((log) => !log.receipt_checked).map((log) => ({ id: log.id, label: `${log.date} ${log.vehicle_reg} ${log.driver || ""}`, href: "/fuel-logs?review=not_checked" }))),
    issue("invalid_fuel_odometer", "Invalid/decreasing odometer fuel logs", buildVerifiedFullTankCycles(fuelLogs).filter((cycle) => cycle.status === "invalid").map((cycle) => ({ id: cycle.key, label: `${cycle.vehicleReg} ${cycle.startDate} -> ${cycle.endDate}: ${cycle.invalidReason ?? ""}`, href: "/fuel-logs?review=missing_mileage" }))),
    issue("full_tank_cycle_waiting", "Full-tank cycle awaiting another full-tank boundary", pendingFullTankVehicles.map((vehicleReg) => ({ id: vehicleReg, label: vehicleReg, href: "/fuel-logs" }))),
    issue("trip_distance_exceeds_odometer", "Trip distance exceeding odometer distance", vehicleReconciliation.filter((row) => row.dataStatus === "Needs Review").map((row) => ({ id: row.vehicleReg, label: `${row.vehicleReg}: ${row.reviewNotes.join(", ")}`, href: "/trip-journey" })))
  ];

  const weeklyOdometerDistance = vehicleReconciliation.reduce((sum, row) => sum + (row.weeklyOdometerDistance ?? 0), 0);
  const otherUnallocatedMovement = vehicleReconciliation.reduce((sum, row) => sum + (row.otherUnallocatedMovement ?? 0), 0);
  const dataCheckedTrips = selectedTrips.filter((trip) => !tripNeedsFuelCheck(trip) && getTripDistanceUsed(trip).source !== "missing").length;
  return {
    period,
    kpis: {
      bookingJobs: selectedBookings.length,
      tripJourneys: selectedTrips.length,
      dataCheckedTrips,
      tripCoveragePercent: percent(selectedBookings.filter((booking) => tripsByBookingId.has(String(booking.id))).length, selectedBookings.length),
      plannedGoogleKm: round(selectedBookings.reduce((sum, booking) => sum + safeNumber(booking.estimated_distance_km), 0)),
      plannedGoogleRecordCount: selectedBookings.filter((booking) => (booking.estimated_distance_km ?? 0) > 0).length,
      workingKm: round(distances.reduce((sum, row) => sum + (row.distance.workingKm ?? 0), 0)),
      workingBreakdown,
      verifiedActualKm: round(distances.reduce((sum, row) => sum + (row.distance.actualKm ?? 0), 0)),
      verifiedActualRecordCount: distances.filter((row) => row.distance.isVerifiedActual).length,
      fuelPurchasedLitres: round(fuelPurchased.litres, 2),
      fuelPurchasedThb: round(fuelPurchased.cost, 2),
      averageFuelPricePerLitre: fuelPurchased.litres > 0 ? round(fuelPurchased.cost / fuelPurchased.litres, 2) : null,
      verifiedCyclesEnding: cyclesEnding.length,
      weeklyOdometerDistance: round(weeklyOdometerDistance),
      otherUnallocatedMovement: round(otherUnallocatedMovement),
      vehiclesMissingWeeklyMileage: vehiclesMissing.length,
      routeAccuracySampleSize: routeAccuracy.sampleSize,
      routeAccuracyPercent: routeAccuracy.accuracyPercent == null ? null : round(routeAccuracy.accuracyPercent)
    },
    clientActivity,
    vehicleReconciliation,
    driverWorkload,
    routeActivity,
    needsAttention,
    verifiedCyclesEndingThisWeek: cyclesEnding
  };
}
