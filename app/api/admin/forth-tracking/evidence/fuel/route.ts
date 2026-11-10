import { NextResponse } from "next/server";
import { AdminApiError } from "@/lib/admin-user-management-server";
import { requireFleetOfficeAccess } from "@/lib/fleet-operations-auth";
import { createFleetSourceClient } from "@/lib/fleet-evidence-server";
import { bangkokDay } from "@/lib/fleet-intelligence";
import { summarizeFuelRange, type FuelRow } from "@/lib/fleet-fuel-view";
import { registryStatuses } from "@/lib/fleet-registry-audit";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
// Existing Fuel Logs columns, newest to most compatible. Optional columns are dropped only on recognised missing-column errors.
const SELECTS = [
  "id,date,vehicle_id,vehicle_reg,odometer,litres,total_cost,fuel_type,station,receipt_checked,full_tank_confirmed,created_at",
  "id,date,vehicle_reg,odometer,litres,total_cost,fuel_type,station,receipt_checked,full_tank_confirmed,created_at",
  "id,date,vehicle_reg,odometer,litres,total_cost,fuel_type,station,receipt_checked,created_at",
  "id,date,vehicle_reg,odometer,litres,total_cost,fuel_type,created_at"
];
const missingColumn = (e: { code?: string; message?: string }) => e.code === "42703" || e.code === "PGRST204" || /does not exist|could not find the .* column/i.test(e.message ?? "");

/** Read-only Fuel Logs range snapshot through the caller's own permissions (RLS). Never writes. */
export async function GET(request: Request) {
  try {
    await requireFleetOfficeAccess(request);
    const params = new URL(request.url).searchParams;
    const from = params.get("from") ?? "", to = params.get("to") ?? "", vehicleId = params.get("vehicleId");
    try {
      const lo = bangkokDay(from), hi = bangkokDay(to);
      if (hi.start < lo.start || hi.end - lo.start > 62 * 86400000 || hi.start > Date.now() || (vehicleId !== null && (!vehicleId || vehicleId.length > 80))) throw new Error();
    } catch { throw new AdminApiError(400, "Choose a valid Bangkok date range (maximum 62 days, not in the future)."); }
    const client = createFleetSourceClient(request);
    let vehicles = await client.from("vehicles").select("id,vehicle_reg,active").order("vehicle_reg").limit(101);
    if (vehicles.error) vehicles = await client.from("vehicles").select("id,vehicle_reg").order("vehicle_reg").limit(101) as typeof vehicles;
    if (vehicles.error || !vehicles.data || vehicles.data.length > 100) throw new AdminApiError(503, "Vehicle registry is unavailable or exceeds the bounded report scope.");
    let rows: FuelRow[] | null = null, columns: string[] = [];
    for (const select of SELECTS) {
      const result = await client.from("fuel_logs").select(select).gte("date", from).lte("date", to).order("date").order("id").limit(1001);
      if (!result.error) { rows = ((result.data ?? []) as unknown as FuelRow[]); columns = select.split(","); break; }
      if (!missingColumn(result.error)) break;
    }
    const truncated = rows !== null && rows.length > 1000;
    if (truncated) rows = null;
    const statuses = registryStatuses(vehicles.data as { id: string; vehicle_reg: string; active?: boolean | null }[]);
    const summary = summarizeFuelRange(vehicles.data, rows, { from, to });
    const scoped = vehicleId ? summary.vehicles.filter(v => v.vehicleId === vehicleId) : summary.vehicles;
    if (vehicleId && scoped.length === 0) throw new AdminApiError(404, "Vehicle identity is unavailable.");
    return NextResponse.json({
      from, to, capturedAt: new Date().toISOString(), timeZone: "Asia/Bangkok", source: "fuel_logs", sourceStatus: rows === null ? (truncated ? "truncated" : "unavailable") : "available",
      capabilities: { columns, fullTankConfirmation: columns.includes("full_tank_confirmed") ? "supported" : "unsupported_by_deployed_source", receiptChecked: columns.includes("receipt_checked"), stableVehicleId: columns.includes("vehicle_id") },
      // Per-vehicle transaction detail is returned only when one vehicle is requested.
      // reviewFlags counts odometer intervals that were withheld or need review (decrease, implausible jump, identical readings).
      vehicles: scoped.map(v => ({ ...v, registryStatus: statuses.get(v.vehicleId) ?? "unknown", reviewFlags: v.intervals === null ? null : v.intervals.filter(i => i.withheld !== null).length, ...(vehicleId ? {} : { transactions: null, intervals: null }) })),
      fleet: vehicleId ? null : summary.fleet
    }, { headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof AdminApiError ? error.message : "Fuel evidence is unavailable." }, { status: error instanceof AdminApiError ? error.status : 503, headers });
  }
}
