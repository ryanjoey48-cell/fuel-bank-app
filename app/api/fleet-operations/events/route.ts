import { NextResponse } from "next/server";
import { AdminApiError } from "@/lib/admin-user-management-server";
import { requireFleetOfficeAccess } from "@/lib/fleet-operations-auth";
import { proposeBookingMatches, type BookingVisitCandidate } from "@/lib/fleet-booking-visit-match";
import { missingTable } from "@/lib/forth-locations-import-directory";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  try {
    const { admin } = await requireFleetOfficeAccess(request);
    const [events, states, runs] = await Promise.all([
      admin.from("ees_fleet_visit_events")
        .select("event_key,visit_key,event_type,vehicle_key,vehicle_registration,location_id,occurred_at,confirmed_source_at,confirmed_latitude,confirmed_longitude,detected_at,duration_seconds,evidence,review_status,booking_id,booking_match_status")
        .order("occurred_at", { ascending: false }).limit(150),
      admin.from("ees_fleet_vehicle_geofence_state")
        .select("vehicle_key,phase,stable,location_id,arrival_at,last_source_at,last_detected_at,uncertain_reason")
        .eq("stable", "INSIDE").limit(150),
      admin.from("ees_fleet_monitor_runs")
        .select("started_at,finished_at,status,returned_count,processed_count,skipped_count,error_code")
        .order("started_at", { ascending: false }).limit(1)
    ]);
    // Missing V20 tables must soft-fail so a code-only production deploy cannot crash office routes.
    if (missingTable(events.error) || missingTable(states.error) || missingTable(runs.error)) {
      throw new AdminApiError(503, "Fleet operations storage is not installed yet.");
    }
    if (events.error || states.error || runs.error) throw new Error("Fleet operations storage is unavailable.");
    const recent = (events.data ?? []).filter((event) => event.event_type === "arrival" &&
      Date.parse(event.occurred_at) >= Date.now() - 7 * 86_400_000);
    let bookingReviewIncomplete = false;
    const bookingProposals: Record<string, ReturnType<typeof proposeBookingMatches>> = {};
    if (recent.length) {
      const dates = recent.map((event) => Date.parse(event.occurred_at)).filter(Number.isFinite);
      const earliest = new Date(Math.min(...dates) - 2 * 86_400_000).toISOString().slice(0, 10);
      const latest = new Date(Math.max(...dates) + 2 * 86_400_000).toISOString().slice(0, 10);
      const [bookings, pins] = await Promise.all([
        admin.from("booking_diary")
          .select("id,booking_date,vehicle_registration,route_confirmation_status,pickup_lat,pickup_lng,dropoff_lat,dropoff_lng")
          .gte("booking_date", earliest).lte("booking_date", latest).limit(1001),
        admin.from("ees_location_map_pins").select("location_id,latitude,longitude")
          .eq("pin_type", "destination").eq("pin_status", "manual_confirmed")
      ]);
      if (bookings.error || pins.error || (bookings.data?.length ?? 0) > 1000) {
        bookingReviewIncomplete = true;
      } else {
        const pinsByLocation = new Map((pins.data ?? []).map((pin) => [pin.location_id, pin]));
        const candidates: BookingVisitCandidate[] = (bookings.data ?? []).map((booking) => ({
          id: booking.id, bookingDate: booking.booking_date,
          vehicleRegistration: booking.vehicle_registration,
          routeConfirmationStatus: booking.route_confirmation_status,
          pickup: { latitude: booking.pickup_lat == null ? null : Number(booking.pickup_lat),
            longitude: booking.pickup_lng == null ? null : Number(booking.pickup_lng) },
          dropoff: { latitude: booking.dropoff_lat == null ? null : Number(booking.dropoff_lat),
            longitude: booking.dropoff_lng == null ? null : Number(booking.dropoff_lng) }
        }));
        for (const event of recent) {
          const pin = pinsByLocation.get(event.location_id);
          if (!pin) continue;
          bookingProposals[event.event_key] = proposeBookingMatches({ visitKey: event.visit_key,
            locationId: event.location_id, registration: event.vehicle_registration,
            arrivalAt: event.occurred_at },
          { id: event.location_id, latitude: pin.latitude, longitude: pin.longitude }, candidates);
        }
      }
    }
    const inside = (states.data ?? []).filter((state) => state.phase === "INSIDE" && state.last_source_at &&
      Date.now() - Date.parse(state.last_source_at) <= 15 * 60_000);
    const uncertainVisits = (states.data ?? []).filter((state) => !inside.includes(state));
    return NextResponse.json({ events: events.data ?? [], atLocations: inside, uncertainVisits,
      lastRun: runs.data?.[0] ?? null, bookingProposals, bookingReviewIncomplete }, { headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof AdminApiError ? error.message : "Fleet operations storage is not ready." },
      { status: error instanceof AdminApiError ? error.status : 503, headers });
  }
}
