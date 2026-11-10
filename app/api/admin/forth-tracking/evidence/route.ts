import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { AdminApiError, getBearerToken } from "@/lib/admin-user-management-server";
import { requireFleetOfficeAccess } from "@/lib/fleet-operations-auth";
import { hasPermission } from "@/lib/authorization";
import { applyJourneyAccess, canViewJourneyDetail } from "@/lib/forth-playback-access";
import { readEesFleetDay, readEesMileageEvidence, readEesBookingRange } from "@/lib/fleet-intelligence-ees-source";
import { checkpointIntervals } from "@/lib/fleet-intelligence-mileage";
import { bangkokDay } from "@/lib/fleet-intelligence";
import { recalledProviderDay } from "@/lib/fleet-intelligence-session";
import { dayAttribution, publicProviderDay, suggestDayJobs } from "@/lib/fleet-intelligence-day";
import { applyMovementAccess } from "@/lib/fleet-job-movement";
import { pinFromDirectoryRow, type SitePin } from "@/lib/fleet-location-priority";
import { purchasesByFuelType } from "@/lib/fleet-evidence-view";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

/** Explicit operator request only. No Forth calls, ingestion or business-record writes. */
export async function GET(request: Request) {
  try {
    const { user, access } = await requireFleetOfficeAccess(request);
    const journeyAllowed = canViewJourneyDetail({ access, userId: user.id, checkPermission: hasPermission });
    const params = new URL(request.url).searchParams;
    const vehicleId = params.get("vehicleId") ?? "";
    const fromDay = params.get("from") ?? "";
    const toDay = params.get("to") ?? "";
    try {
      const lo = bangkokDay(fromDay), hi = bangkokDay(toDay);
      if (!vehicleId || vehicleId.length > 80 || hi.start < lo.start || hi.end - lo.start > 62 * 86400000) throw new Error();
    } catch { throw new AdminApiError(400, "Invalid vehicle or date range (maximum 62 days)."); }
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) throw new AdminApiError(503, "EES source is unavailable.");
    // Business source reads retain the requesting user's RLS permissions.
    const client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${getBearerToken(request)}` }, fetch: (input, init) => {
        if (init?.method && init.method !== "GET" && init.method !== "HEAD") throw new Error("read_only_source");
        return fetch(input, { ...init, cache: "no-store", signal: AbortSignal.any([request.signal, AbortSignal.timeout(15000)]) });
      } }
    });
    const vehicle = await client.from("vehicles").select("id,vehicle_reg").eq("id", vehicleId).single();
    if (vehicle.error || !vehicle.data?.vehicle_reg) throw new AdminApiError(404, "Vehicle identity is unavailable.");
    const scope = { vehicleId, registrations: [vehicle.data.vehicle_reg] };
    const deps = { client, authorize: async () => true }; // Office authorization completed above; reads remain user scoped.
    const [day, mileage, bookings] = await Promise.allSettled([
      readEesFleetDay({ ...scope, day: toDay }, deps),
      readEesMileageEvidence({ ...scope, fromDay, toDay }, deps),
      readEesBookingRange({ ...scope, fromDay, toDay }, deps)
    ]);
    for (const [source, result] of [["day", day], ["mileage", mileage]] as const) {
      if (result.status === "rejected") console.warn("fleet_evidence_source_unavailable", { source, code: result.reason instanceof Error && /^[a-z_]+$/.test(result.reason.message) ? result.reason.message : "source_failure" });
    }
    const checkpoints = mileage.status === "fulfilled" ? mileage.value.checkpoints : null;
    let intervals = null;
    if (checkpoints) {
      try { intervals = checkpointIntervals(checkpoints); } catch { /* Invalid evidence remains visible; no derived distance claimed. */ }
    }
    // V5.1: office-verified location pins come from the Locations Directory with the caller's own permissions (read only). Unavailable or empty means the booking coordinate is used and labelled unverified.
    const pinsByLocation: Record<string, SitePin[]> = {};
    try {
      const pinRows = await client.from("ees_location_map_pins").select("id,location_id,pin_type,pin_status,latitude,longitude,confirmed_at,coordinate_source").limit(2000);
      if (!pinRows.error) for (const row of pinRows.data ?? []) { const pin = pinFromDirectoryRow(row as Parameters<typeof pinFromDirectoryRow>[0]); if (pin) (pinsByLocation[pin.locationId] ??= []).push(pin); }
    } catch { /* Pins are an enhancement; the timeline falls back to labelled booking coordinates. */ }
    const activityDays = [];
    for (let time = bangkokDay(fromDay).start; time <= bangkokDay(toDay).start; time += 86400000) {
      const date = new Date(time + 7*3600000).toISOString().slice(0,10);
      const provider = recalledProviderDay(user.id, vehicleId, vehicle.data.vehicle_reg, date);
      const jobs = bookings.status === "fulfilled" ? suggestDayJobs(vehicleId, vehicle.data.vehicle_reg, date, bookings.value, provider, { pinsByLocation }) : null;
      // Fuel purchases come only from Fuel Logs; an unavailable Fuel Log source stays null, never zero.
      const fuelRows = mileage.status === "fulfilled" && mileage.value.sourceStatus?.fuel !== "unavailable" ? mileage.value.checkpoints.filter(point => point.source === "fuel_logs" && point.observationDate === date) : null;
      // V5: arrival/departure times come from historical positions, so they follow the same server-side gate as journey detail.
      const gatedJobs = jobs === null ? null : jobs.map(job => applyMovementAccess(job, journeyAllowed));
      activityDays.push({ day: date, provider: provider ? applyJourneyAccess(publicProviderDay(provider), journeyAllowed) : null, jobs: gatedJobs, attribution: dayAttribution(provider, jobs),
        fuelPurchases: purchasesByFuelType(fuelRows?.map(point => ({ fuelType: point.fuelType ?? null, purchasedLitres: point.purchasedLitres ?? null, costThb: point.costThb ?? null })) ?? null),
        checkpoints: checkpoints?.filter(point => point.observationDate === date).map(({ raw: _raw, ...point }) => point) ?? null });
    }
    return NextResponse.json({ vehicleId, registration: vehicle.data.vehicle_reg, fromDay, toDay,
      capturedAt: new Date().toISOString(), timeZone: "Asia/Bangkok",
      day: day.status === "fulfilled" ? day.value : null,
      mileage: mileage.status === "fulfilled" ? { ...mileage.value, checkpoints: mileage.value.checkpoints.map(({ raw: _raw, ...point }) => point) } : null,
      intervals: intervals?.map(({ from, to, ...interval }) => ({ ...interval, from: from.observationDate, to: to.observationDate })) ?? null,
      activityDays,
      sourceStatus: { day: day.status === "fulfilled" ? "available" : "unavailable", mileage: mileage.status === "fulfilled" ? "available" : "unavailable", bookings: bookings.status === "fulfilled" ? "available" : "unavailable" }
    }, { headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof AdminApiError ? error.message : "Fleet evidence is unavailable." }, { status: error instanceof AdminApiError ? error.status : 503, headers });
  }
}
