import { bookingReference, confirmedWorkOrder, type Booking } from "@/lib/finance-demo-centre";
import type { BookingDiaryEntry } from "@/types/database";

export const MANUAL_MASS_BOOKING_ID = "manual-mass-1";
export const MANUAL_MASS_BOOKING_REFERENCE = "BK-TEST-MASS-001";

const fixtureStamp = "1970-01-01T00:00:00.000Z";

export function fixtureBookingToDiaryEntry(job: Booking): BookingDiaryEntry {
  const isManualTest = job.id === MANUAL_MASS_BOOKING_ID;
  const wo = confirmedWorkOrder(job);
  return {
    id: job.id,
    booking_id: bookingReference(job),
    client_id: job.clientId,
    client: { id: job.clientId, name: job.client, active: true },
    booking_date: job.date,
    pickup_time: job.pickupTime || null,
    amount_pallets: null,
    weight: null,
    dimensions: null,
    pickup: job.pickup,
    dropoff: job.delivery,
    warehouse_no: null,
    job_order_number: wo || null,
    vehicle: job.vehicle,
    vehicle_registration: job.vehicle,
    trailer_registration: null,
    driver: job.driver,
    notes: isManualTest
      ? "SIMULATED LOCAL TEST BOOKING · isolated · no production · fixture mode only"
      : job.source
        ? `Historical workbook row ${job.source.sheet}!${job.source.row} · reconciled WO in fixture`
        : "Finance fixture booking · simulated",
    status: job.operationalStatus === "completed" ? "completed" : "completed",
    created_at: fixtureStamp,
    updated_at: fixtureStamp,
    created_by_user_id: null,
    created_by: null,
    modified_by: null
  };
}

export function mapFixtureBookingsToDiary(bookings: Booking[]): BookingDiaryEntry[] {
  return bookings.map(fixtureBookingToDiaryEntry);
}
