import { NextResponse } from "next/server";
import { AdminApiError } from "@/lib/admin-user-management-server";
import { requireFleetOfficeAccess } from "@/lib/fleet-operations-auth";
import { hasPermission } from "@/lib/authorization";
import { canViewJourneyDetail } from "@/lib/forth-playback-access";
import { createFleetSourceClient } from "@/lib/fleet-evidence-server";
import { recalledProviderDayEntry } from "@/lib/fleet-intelligence-session";
import { bangkokDay, distanceKm } from "@/lib/fleet-intelligence";
import { registryStatuses } from "@/lib/fleet-registry-audit";
import { chordStats, journeyRows, reconcileDay, reconcilePeriod, type ReconDay } from "@/lib/fleet-mileage-reconciliation";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const MAX_DAYS = 62;

function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = bangkokDay(from).start; t <= bangkokDay(to).start && out.length <= MAX_DAYS; t += 86400000) out.push(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t)));
  return out;
}

/**
 * V7.8.3, read only and CACHE ONLY. Explains the Forth-vs-GPS distance difference for the vehicle-days this user has already read in their own
 * server memory (up to 30 minutes old). It never calls Forth and never writes. Same authorisation as historical journey detail: the response
 * carries kilometres, counts, minutes and segment windows only. No coordinates, no positions, no drivers. A day that is not cached is simply
 * absent ("not reviewed"), never zero, and is never fetched here.
 */
export async function GET(request: Request) {
  try {
    const { user, access } = await requireFleetOfficeAccess(request);
    if (!canViewJourneyDetail({ access, userId: user.id, checkPermission: hasPermission })) throw new AdminApiError(403, "Mileage reconciliation uses historical journeys and needs administrator authorisation.");
    const params = new URL(request.url).searchParams;
    const vehicleId = params.get("vehicleId") ?? "", from = params.get("from") ?? "", to = params.get("to") ?? "";
    let days: string[];
    try {
      const lo = bangkokDay(from), hi = bangkokDay(to);
      if (!vehicleId || vehicleId.length > 80 || hi.start < lo.start || hi.end - lo.start > MAX_DAYS * 86400000 || hi.start > Date.now()) throw new Error();
      days = daysBetween(from, to);
    } catch { throw new AdminApiError(400, "Choose a vehicle and a valid Bangkok date range (maximum 62 days, not in the future)."); }
    const client = createFleetSourceClient(request);
    const registryRead = await client.from("vehicles").select("id,vehicle_reg,active").order("vehicle_reg").limit(101);
    if (registryRead.error || !registryRead.data || registryRead.data.length > 100) throw new AdminApiError(503, "Vehicle registry is unavailable or exceeds the bounded scope.");
    const registry = registryRead.data as { id: string; vehicle_reg: string; active?: boolean | null }[];
    const vehicle = registry.find(v => v.id === vehicleId);
    if (!vehicle || (registryStatuses(registry).get(vehicle.id) ?? "unknown") === "duplicate" || vehicle.active === false) throw new AdminApiError(404, "This vehicle cannot be matched to exactly one active registry record.");
    const rows = [];
    for (const day of days) {
      const entry = recalledProviderDayEntry(user.id, vehicle.id, vehicle.vehicle_reg, day);
      if (!entry) continue;
      const evidence = entry.evidence as unknown as ReconDay & { observedPoints?: { latitude: number; longitude: number; timestamp: string }[] };
      const reconciliation = reconcileDay(evidence, chordStats(evidence.observedPoints ?? [], distanceKm));
      rows.push({ reconciliation, journeys: journeyRows(evidence), capturedAt: (entry.evidence as { capturedAt?: string }).capturedAt ?? null, expiresAt: entry.expiresAt });
    }
    return NextResponse.json({ vehicleId: vehicle.id, registration: vehicle.vehicle_reg, from, to, calendarDays: days.length, capturedAt: new Date().toISOString(), timeZone: "Asia/Bangkok", source: "user_scoped_forth_day_cache", days: rows, period: reconcilePeriod(rows.map(r => r.reconciliation), days.length) }, { headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof AdminApiError ? error.message : "Mileage reconciliation is unavailable." }, { status: error instanceof AdminApiError ? error.status : 503, headers });
  }
}
