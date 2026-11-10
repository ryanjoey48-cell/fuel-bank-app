import { NextResponse } from "next/server";
import { AdminApiError } from "@/lib/admin-user-management-server";
import { requireFleetOfficeAccess } from "@/lib/fleet-operations-auth";
import { createFleetSourceClient } from "@/lib/fleet-evidence-server";
import { getForthTrackingFleetData } from "@/lib/forth-tracking-server";
import { classifyRegistry, registryCounts, type RegistryReferences, type RegistryRow } from "@/lib/fleet-registry-audit";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const key = (s: string) => s.normalize("NFKC").replace(/[\s\-‐‑‒–—]/g, "").toUpperCase();

/** Read-only registry review. HEAD/GET counts only, through the caller's RLS permissions. No record is changed. */
export async function GET(request: Request) {
  try {
    await requireFleetOfficeAccess(request);
    const client = createFleetSourceClient(request);
    let vehicles = await client.from("vehicles").select("id,vehicle_reg,active,vehicle_type,vehicle_name,created_at").order("vehicle_reg").limit(101);
    if (vehicles.error) vehicles = await client.from("vehicles").select("id,vehicle_reg").order("vehicle_reg").limit(101) as typeof vehicles;
    if (vehicles.error || !vehicles.data || vehicles.data.length > 100) throw new AdminApiError(503, "Vehicle registry is unavailable or exceeds the bounded review scope.");
    const rows = vehicles.data as RegistryRow[];
    const count = async (table: string, column: string, value: string) => {
      const result = await client.from(table).select("id", { count: "exact", head: true }).eq(column, value);
      return result.error ? null : result.count ?? 0;
    };
    const references = new Map<string, RegistryReferences>();
    await Promise.all(rows.map(async row => {
      const [fuelLogs, weeklyMileage, bookings] = await Promise.all([count("fuel_logs", "vehicle_reg", row.vehicle_reg), count("weekly_mileage", "vehicle_reg", row.vehicle_reg), count("booking_diary", "vehicle_registration", row.vehicle_reg)]);
      references.set(row.id, { fuelLogs, weeklyMileage, bookings });
    }));
    const aliases = await client.from("vehicle_registration_aliases").select("source_registration").limit(200);
    const fleet = await getForthTrackingFleetData();
    const fleetAvailable = fleet.connectionStatus === "connected";
    const tracked = new Set(fleet.records.map(r => key(r.vehicleRegistration ?? "")).filter(Boolean));
    const findings = classifyRegistry({ rows, trackedRegistrations: fleetAvailable ? tracked : new Set(), references, aliasSources: new Set((aliases.data ?? []).map(a => key(String(a.source_registration)))) });
    return NextResponse.json({ capturedAt: new Date().toISOString(), registryRows: rows.length, gpsTrackedVehicles: fleetAvailable ? fleet.records.length : null, gpsFleetAvailable: fleetAvailable,
      counts: registryCounts(findings), findings, unmatchedGpsRegistrations: fleetAvailable ? [...tracked].filter(k => !rows.some(r => key(r.vehicle_reg) === k)).length : null,
      note: "Read-only evidence for management review. No record is merged, renamed, deleted or reassigned." }, { headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof AdminApiError ? error.message : "Registry review is unavailable." }, { status: error instanceof AdminApiError ? error.status : 503, headers });
  }
}
