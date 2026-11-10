import { NextResponse } from "next/server";
import { AdminApiError } from "@/lib/admin-user-management-server";
import { requireFleetOfficeAccess } from "@/lib/fleet-operations-auth";
import { createFleetSourceClient } from "@/lib/fleet-evidence-server";
import { recalledProviderDayEntry } from "@/lib/fleet-intelligence-session";
import { bangkokDay } from "@/lib/fleet-intelligence";
import { registryStatuses } from "@/lib/fleet-registry-audit";
import { summarizeCachedDays, type CachedDayFacts, type CoverageVehicleInput } from "@/lib/fleet-fuel-oversight";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const MAX_DAYS = 62;

/** Bangkok calendar days from..to inclusive, as YYYY-MM-DD. */
function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = bangkokDay(from).start; t <= bangkokDay(to).start && out.length <= MAX_DAYS; t += 86400000) out.push(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t)));
  return out;
}

/**
 * Cache-only, read-only Forth day COVERAGE for every registry vehicle over a period. It never contacts Forth: it only looks up days this
 * user already read in their own server memory (up to 30 minutes old). It returns counts, day lists and distance totals only: no positions,
 * no journeys, no coordinates and no driver data, so it is safe for any caller with fleet office access. A day that is not cached is
 * "not reviewed", never zero driving.
 */
export async function GET(request: Request) {
  try {
    const { user } = await requireFleetOfficeAccess(request);
    const params = new URL(request.url).searchParams;
    const from = params.get("from") ?? "", to = params.get("to") ?? "";
    let days: string[];
    try {
      const lo = bangkokDay(from), hi = bangkokDay(to);
      if (hi.start < lo.start || hi.end - lo.start > MAX_DAYS * 86400000 || hi.start > Date.now()) throw new Error();
      days = daysBetween(from, to);
    } catch { throw new AdminApiError(400, "Choose a valid Bangkok date range (maximum 62 days, not in the future)."); }
    const client = createFleetSourceClient(request);
    let vehicles = await client.from("vehicles").select("id,vehicle_reg,active,vehicle_type").order("vehicle_reg").limit(101);
    if (vehicles.error) vehicles = await client.from("vehicles").select("id,vehicle_reg,active").order("vehicle_reg").limit(101) as typeof vehicles;
    if (vehicles.error || !vehicles.data || vehicles.data.length > 100) throw new AdminApiError(503, "Vehicle registry is unavailable or exceeds the bounded report scope.");
    const registry = vehicles.data as { id: string; vehicle_reg: string; active?: boolean | null; vehicle_type?: string | null }[];
    const statuses = registryStatuses(registry);
    const rows: CoverageVehicleInput[] = registry.map(v => {
      const facts: CachedDayFacts[] = []; let earliestExpiresAt: string | null = null;
      for (const day of days) {
        const entry = recalledProviderDayEntry(user.id, v.id, v.vehicle_reg, day);
        if (!entry) continue;
        const e = entry.evidence; if (earliestExpiresAt === null || entry.expiresAt < earliestExpiresAt) earliestExpiresAt = entry.expiresAt;
        facts.push({ day, providerKm: e.sources.providerReported.value, providerReconciled: e.provider.arithmetic.status === "pass", gpsKm: e.sources.gpsDerived.value, logAvailable: e.logAvailable, observations: e.gps.observations, verifiedObservations: e.gps.verifiedObservations, missingMinutes: (e as { journeyLedger?: { totals?: { missingMinutes?: number } } | null }).journeyLedger?.totals?.missingMinutes ?? null });
      }
      return { vehicleId: v.id, registration: v.vehicle_reg, vehicleType: typeof v.vehicle_type === "string" && v.vehicle_type.trim() ? v.vehicle_type.trim() : null, registryStatus: statuses.get(v.id) ?? "unknown", ...summarizeCachedDays(facts), earliestExpiresAt };
    });
    return NextResponse.json({ from, to, calendarDays: days.length, capturedAt: new Date().toISOString(), timeZone: "Asia/Bangkok", scope: "visible_ees_vehicle_registry", source: "user_scoped_forth_day_cache", vehicles: rows }, { headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof AdminApiError ? error.message : "Fleet period coverage is unavailable." }, { status: error instanceof AdminApiError ? error.status : 503, headers });
  }
}
