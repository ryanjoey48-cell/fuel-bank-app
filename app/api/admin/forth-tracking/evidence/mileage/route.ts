import { NextResponse } from "next/server";
import { AdminApiError } from "@/lib/admin-user-management-server";
import { requireFleetOfficeAccess } from "@/lib/fleet-operations-auth";
import { hasPermission } from "@/lib/authorization";
import { canViewJourneyDetail } from "@/lib/forth-playback-access";
import { createFleetSourceClient } from "@/lib/fleet-evidence-server";
import { getForthTrackingFleetData } from "@/lib/forth-tracking-server";
import { bangkokDay } from "@/lib/fleet-intelligence";
import { createHash } from "node:crypto";
import { recalledProviderDayEntry } from "@/lib/fleet-intelligence-session";
import { buildMileageReport, dayList, type BookingRow, type LiveVehicleLite, type ProviderDayLite, type WeeklyRow } from "@/lib/fleet-mileage-report";
import { registrationKey, type FuelRow } from "@/lib/fleet-fuel-view";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const FUEL = ["id,date,vehicle_id,vehicle_reg,odometer,litres,total_cost,fuel_type,station,receipt_checked,full_tank_confirmed,created_at", "id,date,vehicle_reg,odometer,litres,total_cost,fuel_type,station,receipt_checked,full_tank_confirmed,created_at",
  "id,date,vehicle_reg,odometer,litres,total_cost,fuel_type,station,receipt_checked,created_at", "id,date,vehicle_reg,odometer,litres,total_cost,fuel_type,created_at"];
const WEEKLY = ["id,week_ending,vehicle_id,vehicle_reg,odometer_reading,is_odometer_baseline,created_at", "id,week_ending,vehicle_reg,odometer_reading,is_odometer_baseline,created_at", "id,week_ending,vehicle_reg,odometer_reading,created_at", "id,week_ending,vehicle_reg,mileage,created_at"];
const BOOKING = ["id,booking_id,booking_date,pickup_time,vehicle_id,vehicle,vehicle_registration,job_order_number,pickup_lat,pickup_lng,dropoff_lat,dropoff_lng,updated_at", "id,booking_id,booking_date,pickup_time,vehicle,vehicle_registration,job_order_number,pickup_lat,pickup_lng,dropoff_lat,dropoff_lng,updated_at", "id,booking_date,pickup_time,vehicle_id,vehicle,vehicle_registration,job_order_number,updated_at", "id,booking_date,vehicle_id,vehicle,vehicle_registration,job_order_number,updated_at", "id,booking_date,vehicle,vehicle_registration,job_order_number,updated_at", "id,booking_date,vehicle_id,vehicle,vehicle_registration,job_order_number", "id,booking_date,vehicle,vehicle_registration,job_order_number"];
const missingColumn = (e: { code?: string; message?: string }) => e.code === "42703" || e.code === "PGRST204" || /does not exist|could not find the .* column/i.test(e.message ?? "");
const LIMIT = 1000;

/** Fleet mileage reconciliation for a bounded Bangkok date range. GET/HEAD only; caller's own permissions. */
export async function GET(request: Request) {
  try {
    const { user, access } = await requireFleetOfficeAccess(request);
    const journeyAllowed = canViewJourneyDetail({ access, userId: user.id, checkPermission: hasPermission });
    const params = new URL(request.url).searchParams; const from = params.get("from") ?? "", to = params.get("to") ?? "";
    try { const lo = bangkokDay(from), hi = bangkokDay(to); if (hi.start < lo.start || hi.end - lo.start > 62 * 86400000 || hi.start > Date.now()) throw new Error(); }
    catch { throw new AdminApiError(400, "Choose a valid Bangkok date range (maximum 62 days, not in the future)."); }
    const client = createFleetSourceClient(request);
    let vehicles = await client.from("vehicles").select("id,vehicle_reg,active").order("vehicle_reg").limit(101);
    if (vehicles.error) vehicles = await client.from("vehicles").select("id,vehicle_reg").order("vehicle_reg").limit(101) as typeof vehicles;
    if (vehicles.error || !vehicles.data || vehicles.data.length > 100) throw new AdminApiError(503, "Vehicle registry is unavailable or exceeds the bounded report scope.");
    const registry = vehicles.data as { id: string; vehicle_reg: string; active?: boolean | null }[];
    async function read<T>(table: string, selects: string[], dateColumn: string): Promise<{ rows: T[] | null; status: "available" | "unavailable" | "truncated" }> {
      for (const select of selects) {
        const r = await client.from(table).select(select).gte(dateColumn, from).lte(dateColumn, to).order(dateColumn).order("id").limit(LIMIT + 1);
        if (!r.error) { const rows = (r.data ?? []) as unknown as T[]; return rows.length > LIMIT ? { rows: null, status: "truncated" } : { rows, status: "available" }; }
        if (!missingColumn(r.error)) break;
      }
      return { rows: null, status: "unavailable" };
    }
    const [fuel, weekly, bookings, fleet] = await Promise.all([read<FuelRow>("fuel_logs", FUEL, "date"), read<WeeklyRow>("weekly_mileage", WEEKLY, "week_ending"), read<BookingRow>("booking_diary", BOOKING, "booking_date"), getForthTrackingFleetData()]);
    const connected = fleet.connectionStatus === "connected";
    const live = connected ? new Map<string, LiveVehicleLite>(fleet.records.filter(r => r.vehicleRegistration).map(r => [registrationKey(r.vehicleRegistration!), { positionQuality: r.positionQuality ?? null, timestampStatus: r.timestampStatus ?? null, lastGpsTimestamp: r.lastGpsTimestamp ?? null }])) : null;
    // Only provider days this operator already read in this server session (30-minute cache). No provider call is made here.
    const days = dayList(from, to), providerDays = new Map<string, ProviderDayLite[]>();
    for (const v of registry) { const list: ProviderDayLite[] = [];
      for (const day of days) { const entry = recalledProviderDayEntry(user.id, v.id, v.vehicle_reg, day); if (!entry) continue; const e = entry.evidence;
        const ok = e.provider.arithmetic.status === "pass";
        list.push({ day, km: ok ? e.sources.providerReported.value : null, reconciled: ok, complete: e.sources.providerReported.completeness === "complete", gpsKm: e.sources.gpsDerived.value, segments: e.provider.segments.length,
          openSegments: e.provider.segments.filter(s => !s.end).length, storedAt: entry.storedAt, expiresAt: entry.expiresAt, segmentList: e.provider.segments.map(s => ({ id: s.id, km: s.km })), journeyLedger: journeyAllowed ? (e.journeyLedger ?? null) : null, journeyRestricted: !journeyAllowed }); }
      providerDays.set(v.id, list); }
    // Booking Diary read provenance: lets repeated reads be compared (same fingerprint = same rows) and shows whether the table is being edited right now.
    const bookingRows = (bookings.rows ?? []) as (BookingRow & { updated_at?: string | null })[];
    const fingerprint = bookings.rows === null ? null : createHash("sha256").update(JSON.stringify(bookingRows.map(b => String(b.id)).sort())).digest("hex").slice(0, 12);
    const latestInRange = bookingRows.map(b => b.updated_at).filter((x): x is string => typeof x === "string").sort().at(-1) ?? null;
    let latestAnywhere: { updatedAt: string | null; bookingDate: string | null } | null = null;
    const newest = await client.from("booking_diary").select("booking_date,updated_at").order("updated_at", { ascending: false }).limit(1);
    if (!newest.error && newest.data?.[0]) latestAnywhere = { updatedAt: (newest.data[0] as { updated_at?: string | null }).updated_at ?? null, bookingDate: (newest.data[0] as { booking_date?: string | null }).booking_date ?? null };
    const report = buildMileageReport({ registry, range: { from, to }, fuel: fuel.rows, weekly: weekly.rows, bookings: bookings.rows, providerDays, live });
    return NextResponse.json({ capturedAt: new Date().toISOString(), timeZone: "Asia/Bangkok", ...report,
      sources: { fuelLogs: fuel.status, weeklyMileage: weekly.status, bookingDiary: bookings.status, forthFleet: connected ? "connected" : "unavailable", providerDays: "session_cache_only" },
      bookingDiaryRead: { rowsInRange: bookings.rows === null ? null : bookingRows.length, fingerprint, latestUpdatedInRange: latestInRange, newestRecordInTable: latestAnywhere, readAt: new Date().toISOString(), cached: false } }, { headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof AdminApiError ? error.message : "Fleet mileage report is unavailable." }, { status: error instanceof AdminApiError ? error.status : 503, headers });
  }
}
