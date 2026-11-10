/**
 * Booking Diary data quality for journey matching. Pure and read-only: it never changes a booking and never treats a
 * missing booking as proof that no job happened. It only says which existing bookings cannot be confidently placed on
 * a journey, and why.
 */
import { registrationKey } from "./fleet-fuel-view";

export type QualityBooking = {
  id: string | number; booking_date: string;
  booking_id?: string | null; pickup_time?: string | null;
  vehicle_id?: string | null; vehicle_registration?: string | null; vehicle?: string | null;
  job_order_number?: string | null;
  pickup_lat?: number | string | null; pickup_lng?: number | string | null; dropoff_lat?: number | string | null; dropoff_lng?: number | string | null;
};
export type QualityRegistryVehicle = { id: string; vehicle_reg: string };

export type BookingIssue =
  | "missing_pickup_time" | "missing_registration" | "registration_not_in_fleet" | "registration_shared_by_multiple_fleet_rows"
  | "registration_only_assignment" | "same_time_booking" | "missing_work_order" | "missing_pickup_location" | "missing_dropoff_location";

/** Issues that stop a booking being confidently placed on a journey. The rest only weaken the evidence. */
export const BLOCKING_ISSUES: readonly BookingIssue[] = ["missing_pickup_time", "missing_registration", "registration_not_in_fleet", "registration_shared_by_multiple_fleet_rows", "same_time_booking"];

export type BookingQualityRow = { id: string; reference: string | null; date: string; registration: string | null; pickupTime: string | null; issues: BookingIssue[]; blocking: BookingIssue[]; matchable: boolean };
export type BookingQualityReport = {
  total: number; matchable: number; notConfidentlyMatchable: number;
  counts: Record<BookingIssue, number>;
  queue: BookingQualityRow[];
  note: "absence_of_a_booking_is_not_proof_of_no_work";
};

const ISSUES: BookingIssue[] = ["missing_pickup_time", "missing_registration", "registration_not_in_fleet", "registration_shared_by_multiple_fleet_rows", "registration_only_assignment", "same_time_booking", "missing_work_order", "missing_pickup_location", "missing_dropoff_location"];
const hasCoordinate = (lat: unknown, lng: unknown) => {
  const a = typeof lat === "string" ? Number(lat) : lat, b = typeof lng === "string" ? Number(lng) : lng;
  return typeof a === "number" && typeof b === "number" && Number.isFinite(a) && Number.isFinite(b) && Math.abs(a) <= 90 && Math.abs(b) <= 180 && !(a === 0 && b === 0);
};
const validTime = (t: unknown) => typeof t === "string" && /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(t.trim());

export function assessBookingQuality(bookings: readonly QualityBooking[], registry: readonly QualityRegistryVehicle[], queueLimit = 25): BookingQualityReport {
  const byKey = new Map<string, QualityRegistryVehicle[]>();
  for (const v of registry) { const k = registrationKey(v.vehicle_reg); if (k) byKey.set(k, [...(byKey.get(k) ?? []), v]); }
  const idSet = new Set(registry.map(v => v.id));
  // Same vehicle, same day, same pickup time: the journey cannot decide between them.
  const sameTime = new Map<string, number>();
  const slot = (b: QualityBooking) => { const reg = registrationKey(b.vehicle_registration ?? b.vehicle ?? ""); return reg && validTime(b.pickup_time) ? `${reg}|${b.booking_date}|${String(b.pickup_time).trim().slice(0, 5)}` : null; };
  for (const b of bookings) { const k = slot(b); if (k) sameTime.set(k, (sameTime.get(k) ?? 0) + 1); }
  const counts = Object.fromEntries(ISSUES.map(i => [i, 0])) as Record<BookingIssue, number>;
  const rows: BookingQualityRow[] = bookings.map(b => {
    const issues: BookingIssue[] = [];
    const reg = (b.vehicle_registration ?? b.vehicle ?? "").trim(); const key = registrationKey(reg);
    if (!validTime(b.pickup_time)) issues.push("missing_pickup_time");
    if (!key) issues.push("missing_registration");
    else {
      const matches = byKey.get(key) ?? [];
      const byId = b.vehicle_id ? idSet.has(b.vehicle_id) : false;
      if (!byId && matches.length === 0) issues.push("registration_not_in_fleet");
      else if (!byId && matches.length > 1) issues.push("registration_shared_by_multiple_fleet_rows");
      if (!byId) issues.push("registration_only_assignment");
    }
    const s = slot(b); if (s && (sameTime.get(s) ?? 0) > 1) issues.push("same_time_booking");
    if (!(b.job_order_number ?? "").trim()) issues.push("missing_work_order");
    if (!hasCoordinate(b.pickup_lat, b.pickup_lng)) issues.push("missing_pickup_location");
    if (!hasCoordinate(b.dropoff_lat, b.dropoff_lng)) issues.push("missing_dropoff_location");
    for (const i of issues) counts[i]++;
    const blocking = issues.filter(i => BLOCKING_ISSUES.includes(i));
    return { id: String(b.id), reference: (b.booking_id ?? "").trim() || (b.job_order_number ?? "").trim() || null, date: b.booking_date, registration: reg || null, pickupTime: validTime(b.pickup_time) ? String(b.pickup_time).trim().slice(0, 5) : null, issues, blocking, matchable: blocking.length === 0 };
  });
  const bad = rows.filter(r => !r.matchable);
  return {
    total: rows.length, matchable: rows.length - bad.length, notConfidentlyMatchable: bad.length, counts,
    queue: bad.sort((a, b) => b.blocking.length - a.blocking.length || b.date.localeCompare(a.date) || a.id.localeCompare(b.id)).slice(0, queueLimit),
    note: "absence_of_a_booking_is_not_proof_of_no_work"
  };
}

/**
 * Quality warnings for the bookings of ONE vehicle-day, computed from the job suggestions already loaded for that day.
 * Counts only: it never changes a booking, and finding no warning is not proof that a booking is correct.
 */
export type DayJobForQuality = { jobId: string; workOrder: string | null; pickupTime: string | null; bookingAssignment: string; scheduledPickup: unknown | null; scheduledDelivery: unknown | null };
export type DayJobWarning = "missing_pickup_time" | "same_time_booking" | "registration_only_assignment" | "missing_work_order" | "missing_pickup_or_delivery_coordinates";
export function summarizeDayJobWarnings(jobs: readonly DayJobForQuality[]): { total: number; counts: Record<DayJobWarning, number>; blocking: number } {
  const counts: Record<DayJobWarning, number> = { missing_pickup_time: 0, same_time_booking: 0, registration_only_assignment: 0, missing_work_order: 0, missing_pickup_or_delivery_coordinates: 0 };
  const times = new Map<string, number>();
  for (const j of jobs) if (validTime(j.pickupTime)) { const k = String(j.pickupTime).trim().slice(0, 5); times.set(k, (times.get(k) ?? 0) + 1); }
  let blocking = 0;
  for (const j of jobs) {
    const missingTime = !validTime(j.pickupTime), sameTime = !missingTime && (times.get(String(j.pickupTime).trim().slice(0, 5)) ?? 0) > 1;
    if (missingTime) counts.missing_pickup_time++;
    if (sameTime) counts.same_time_booking++;
    if (j.bookingAssignment !== "stable_vehicle_id") counts.registration_only_assignment++;
    if (!(j.workOrder ?? "").trim()) counts.missing_work_order++;
    if (!j.scheduledPickup || !j.scheduledDelivery) counts.missing_pickup_or_delivery_coordinates++;
    if (missingTime || sameTime) blocking++;
  }
  return { total: jobs.length, counts, blocking };
}
