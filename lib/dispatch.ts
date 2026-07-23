import type { BookingDiaryEntry, Driver, TripJourneyWithFuel, Vehicle } from "@/types/database";

export type DispatchConflictKind = "driver" | "vehicle";
export type DispatchConflictSeverity = "confirmed" | "possible";

export type DispatchConflict = {
  bookingId: string;
  otherBookingId: string;
  kind: DispatchConflictKind;
  severity: DispatchConflictSeverity;
  reason: string;
};

export type DispatchAttentionKey =
  | "unassigned_driver"
  | "unassigned_vehicle"
  | "missing_pickup_time"
  | "missing_route"
  | "missing_trip"
  | "trip_needs_review"
  | "driver_conflict"
  | "vehicle_conflict"
  | "possible_driver_conflict"
  | "possible_vehicle_conflict";

export type DispatchAttention = {
  key: DispatchAttentionKey;
  tone: "danger" | "warning" | "info";
  label: string;
  detail: string;
};

export type DispatchBoardRow = {
  booking: BookingDiaryEntry;
  trip: TripJourneyWithFuel | null;
  driver: Driver | null;
  vehicle: Vehicle | null;
  conflicts: DispatchConflict[];
  attention: DispatchAttention[];
  ready: boolean;
};

export type DispatchSummary = {
  totalJobs: number;
  ready: number;
  unassigned: number;
  potentialConflicts: number;
  missingRoute: number;
  missingTrip: number;
  needsReview: number;
};

export type DispatchConflictOptions = {
  turnaroundBufferMinutes?: number;
  nearbyWindowMinutes?: number;
};

const DEFAULT_TURNAROUND_BUFFER_MINUTES = 30;
const DEFAULT_NEARBY_WINDOW_MINUTES = 120;

function normalizeKey(value: unknown) {
  return String(value ?? "").trim().toLocaleLowerCase();
}

function normalizeVehicleKey(value: unknown) {
  return normalizeKey(value).replace(/\s+/g, "").replace(/-/g, "");
}

function parseTimeMinutes(value: string | null | undefined) {
  const match = String(value ?? "").match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }
  return hours * 60 + minutes;
}

function getDurationMinutes(booking: BookingDiaryEntry) {
  const routeDuration = Number(booking.route_duration_seconds);
  if (Number.isFinite(routeDuration) && routeDuration > 0) return Math.max(1, Math.ceil(routeDuration / 60));
  const estimatedMinutes = Number(booking.estimated_duration_minutes);
  if (Number.isFinite(estimatedMinutes) && estimatedMinutes > 0) return Math.max(1, Math.ceil(estimatedMinutes));
  return null;
}

function sameAssignedDriver(left: BookingDiaryEntry, right: BookingDiaryEntry) {
  const leftDriver = normalizeKey(left.driver);
  return Boolean(leftDriver) && leftDriver === normalizeKey(right.driver);
}

function sameAssignedVehicle(left: BookingDiaryEntry, right: BookingDiaryEntry) {
  const leftVehicle = normalizeVehicleKey(left.vehicle);
  return Boolean(leftVehicle) && leftVehicle === normalizeVehicleKey(right.vehicle);
}

function windowsOverlap(leftStart: number, leftEnd: number, rightStart: number, rightEnd: number) {
  return leftStart < rightEnd && rightStart < leftEnd;
}

function buildConflictReason(kind: DispatchConflictKind, severity: DispatchConflictSeverity) {
  if (severity === "confirmed") {
    return kind === "driver"
      ? "Same driver has overlapping working windows."
      : "Same vehicle has overlapping working windows.";
  }
  return kind === "driver"
    ? "Same driver is assigned to nearby bookings, but duration information is incomplete."
    : "Same vehicle is assigned to nearby bookings, but duration information is incomplete.";
}

export function detectDispatchConflicts(
  bookings: BookingDiaryEntry[],
  options: DispatchConflictOptions = {}
) {
  const turnaroundBufferMinutes = options.turnaroundBufferMinutes ?? DEFAULT_TURNAROUND_BUFFER_MINUTES;
  const nearbyWindowMinutes = options.nearbyWindowMinutes ?? DEFAULT_NEARBY_WINDOW_MINUTES;
  const conflicts: DispatchConflict[] = [];

  for (let leftIndex = 0; leftIndex < bookings.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < bookings.length; rightIndex += 1) {
      const left = bookings[leftIndex];
      const right = bookings[rightIndex];
      if (!left?.id || !right?.id || String(left.id) === String(right.id)) continue;

      const kinds: DispatchConflictKind[] = [];
      if (sameAssignedDriver(left, right)) kinds.push("driver");
      if (sameAssignedVehicle(left, right)) kinds.push("vehicle");
      if (!kinds.length) continue;

      const leftStart = parseTimeMinutes(left.pickup_time);
      const rightStart = parseTimeMinutes(right.pickup_time);
      if (leftStart == null || rightStart == null) continue;

      const leftDuration = getDurationMinutes(left);
      const rightDuration = getDurationMinutes(right);
      const bothDurationsKnown = leftDuration != null && rightDuration != null;
      const definiteOverlap = bothDurationsKnown
        ? windowsOverlap(
            leftStart,
            leftStart + leftDuration + turnaroundBufferMinutes,
            rightStart,
            rightStart + rightDuration + turnaroundBufferMinutes
          )
        : Math.abs(leftStart - rightStart) <= nearbyWindowMinutes;

      if (!definiteOverlap) continue;

      for (const kind of kinds) {
        const severity: DispatchConflictSeverity = bothDurationsKnown ? "confirmed" : "possible";
        conflicts.push({
          bookingId: String(left.id),
          otherBookingId: String(right.id),
          kind,
          severity,
          reason: buildConflictReason(kind, severity)
        });
        conflicts.push({
          bookingId: String(right.id),
          otherBookingId: String(left.id),
          kind,
          severity,
          reason: buildConflictReason(kind, severity)
        });
      }
    }
  }

  return conflicts;
}

function isTripWaitingForReview(trip: TripJourneyWithFuel | null) {
  if (!trip || trip.status !== "completed") return false;
  if (!String(trip.driver || "").trim()) return true;
  if (!String(trip.vehicle_reg || trip.vehicle_type || "").trim()) return true;
  return false;
}

function hasRouteEstimate(booking: BookingDiaryEntry) {
  return (
    (Number(booking.estimated_distance_km) > 0 && Number(booking.estimated_duration_minutes) > 0) ||
    (Number(booking.route_distance_meters) > 0 && Number(booking.route_duration_seconds) > 0) ||
    Boolean(booking.google_maps_route_url)
  );
}

function findTripForBooking(booking: BookingDiaryEntry, trips: TripJourneyWithFuel[]) {
  return trips.find((trip) => {
    const bookingId = String(booking.id);
    return String(trip.booking_diary_id ?? "") === bookingId || String(trip.booking_id ?? "") === bookingId;
  }) ?? null;
}

function findDriver(booking: BookingDiaryEntry, drivers: Driver[]) {
  const driverName = normalizeKey(booking.driver);
  if (!driverName) return null;
  return drivers.find((driver) => normalizeKey(driver.name) === driverName) ?? null;
}

function findVehicle(booking: BookingDiaryEntry, vehicles: Vehicle[]) {
  const vehicleReg = normalizeVehicleKey(booking.vehicle);
  if (!vehicleReg) return null;
  return vehicles.find((vehicle) => normalizeVehicleKey(vehicle.vehicle_reg ?? vehicle.registration) === vehicleReg) ?? null;
}

function buildAttention(booking: BookingDiaryEntry, trip: TripJourneyWithFuel | null, conflicts: DispatchConflict[]): DispatchAttention[] {
  const attention: DispatchAttention[] = [];
  if (!String(booking.driver || "").trim()) {
    attention.push({ key: "unassigned_driver", tone: "warning", label: "No driver", detail: "No driver assigned." });
  }
  if (!String(booking.vehicle || "").trim()) {
    attention.push({ key: "unassigned_vehicle", tone: "warning", label: "No vehicle", detail: "No vehicle assigned." });
  }
  if (!String(booking.pickup_time || "").trim()) {
    attention.push({ key: "missing_pickup_time", tone: "warning", label: "No pickup time", detail: "Pickup time is missing." });
  }
  if (!hasRouteEstimate(booking)) {
    attention.push({ key: "missing_route", tone: "warning", label: "Missing route", detail: "No Google route estimate is saved." });
  }
  if (!trip) {
    attention.push({ key: "missing_trip", tone: "warning", label: "Missing trip", detail: "No Trip Journey record is linked." });
  }
  if (isTripWaitingForReview(trip)) {
    attention.push({ key: "trip_needs_review", tone: "warning", label: "Trip review", detail: "Completed trip needs review." });
  }

  for (const conflict of conflicts) {
    const driver = conflict.kind === "driver";
    const possible = conflict.severity === "possible";
    attention.push({
      key: possible
        ? driver ? "possible_driver_conflict" : "possible_vehicle_conflict"
        : driver ? "driver_conflict" : "vehicle_conflict",
      tone: possible ? "info" : "danger",
      label: possible ? "Possible conflict" : "Conflict",
      detail: conflict.reason
    });
  }

  return attention;
}

export function buildDispatchRows({
  bookings,
  trips,
  drivers,
  vehicles,
  conflictOptions
}: {
  bookings: BookingDiaryEntry[];
  trips: TripJourneyWithFuel[];
  drivers: Driver[];
  vehicles: Vehicle[];
  conflictOptions?: DispatchConflictOptions;
}) {
  const conflicts = detectDispatchConflicts(bookings, conflictOptions);
  const conflictsByBooking = new Map<string, DispatchConflict[]>();
  for (const conflict of conflicts) {
    conflictsByBooking.set(conflict.bookingId, [...(conflictsByBooking.get(conflict.bookingId) ?? []), conflict]);
  }

  return [...bookings]
    .sort((left, right) => {
      const leftTime = parseTimeMinutes(left.pickup_time);
      const rightTime = parseTimeMinutes(right.pickup_time);
      if (leftTime == null && rightTime == null) return String(left.id).localeCompare(String(right.id));
      if (leftTime == null) return 1;
      if (rightTime == null) return -1;
      return leftTime - rightTime || String(left.id).localeCompare(String(right.id));
    })
    .map((booking) => {
      const trip = findTripForBooking(booking, trips);
      const rowConflicts = conflictsByBooking.get(String(booking.id)) ?? [];
      const attention = buildAttention(booking, trip, rowConflicts);
      return {
        booking,
        trip,
        driver: findDriver(booking, drivers),
        vehicle: findVehicle(booking, vehicles),
        conflicts: rowConflicts,
        attention,
        ready: attention.length === 0
      };
    });
}

export function summarizeDispatchRows(rows: DispatchBoardRow[]): DispatchSummary {
  return {
    totalJobs: rows.length,
    ready: rows.filter((row) => row.ready).length,
    unassigned: rows.filter((row) =>
      row.attention.some((item) => item.key === "unassigned_driver" || item.key === "unassigned_vehicle")
    ).length,
    potentialConflicts: rows.filter((row) => row.conflicts.length > 0).length,
    missingRoute: rows.filter((row) => row.attention.some((item) => item.key === "missing_route")).length,
    missingTrip: rows.filter((row) => row.attention.some((item) => item.key === "missing_trip")).length,
    needsReview: rows.filter((row) => row.attention.some((item) => item.key === "trip_needs_review")).length
  };
}
