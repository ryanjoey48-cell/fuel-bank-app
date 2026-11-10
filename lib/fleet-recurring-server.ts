import "server-only";
import { recalledProviderDay } from "./fleet-intelligence-session";
import { observationsFromProviderDay } from "./fleet-location-evidence";
import { detectStopClusters } from "./fleet-stop-intelligence";
import { analyseRecurringAreas, type AreaVisit, type DirectoryPoint, type RecurringAnalysis, type RecurringArea } from "./fleet-recurring-areas";
import { loadBundledForthPinnedLocationsCsv } from "./forth-locations-import-server";
import { buildForthGpsMapPayloadFromCsv } from "./forth-gps-map-locations";
import { matchStop, prepareSites, type StopEvidence } from "./fleet-location-match";
import { resolveDriverForDay } from "./fleet-driver-attribution";

export const MAX_RANGE_DAYS = 31;
export const MAX_VEHICLES = 100;
export const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

// The source client is the read-only Supabase client from createFleetSourceClient; only the query surface used here is typed.
type SourceClient = { from: (table: string) => any };
export type RecurringResult = {
  vehiclesConsidered: number; vehicleDaysInRange: number; vehicleDaysIncluded: number;
  included: { registration: string; days: string[] }[];
  directory: { forthSavedLocations: number | null; officeConfirmedPins: number | null };
  analysis: RecurringAnalysis;
  /** V7.4: driver-evidence counts over the reviewed vehicle-days only. Counts, never names. */
  driverCoverage: DriverCoverage;
};
export type DriverCoverage = { vehicleDays: number; confirmed: number; supporting: number; conflicting: number; unknown: number; sourceRead: boolean };

/**
 * One shared computation for the recurring-places view and the "review location" handoff, so the two can never disagree.
 * Reads only THIS user's own cached vehicle-days; it never calls Forth. The caller must already have checked authorisation.
 */
export async function loadRecurringAnalysis(input: { client: SourceClient; userId: string; from: string; to: string; vehicleId?: string | null }): Promise<RecurringResult> {
  const { client, userId, from, to } = input;
  const registry = await client.from("vehicles").select("id,vehicle_reg,active").order("vehicle_reg").limit(MAX_VEHICLES + 1);
  if (registry.error || !registry.data || registry.data.length > MAX_VEHICLES) throw Object.assign(new Error("registry"), { status: 503 });
  const rows = registry.data as { id: string; vehicle_reg: string; active?: boolean | null }[];
  const key = (s: string) => s.normalize("NFKC").replace(/[\s\-‐‑‒–—]/g, "").toUpperCase();
  // A duplicated registration cannot be tied to one vehicle, and an inactive record is not tracked: neither is analysed.
  const vehicles = rows.filter(v => v.active !== false && rows.filter(x => key(x.vehicle_reg) === key(v.vehicle_reg)).length === 1 && (input.vehicleId == null || v.id === input.vehicleId));

  const days: string[] = []; for (let d = from; d <= to && days.length < MAX_RANGE_DAYS; d = addDays(d, 1)) days.push(d);
  const visits: AreaVisit[] = []; const included: { registration: string; days: string[] }[] = []; let vehicleDaysInRange = 0;
  for (const vehicle of vehicles) {
    const read: string[] = [];
    for (const day of days) {
      vehicleDaysInRange++;
      const evidence = recalledProviderDay(userId, vehicle.id, vehicle.vehicle_reg, day);
      if (!evidence) continue;
      read.push(day);
      const missing = (evidence as { journeyLedger?: { totals?: { missingMinutes?: number } } | null }).journeyLedger?.totals?.missingMinutes ?? null;
      for (const cluster of detectStopClusters(observationsFromProviderDay(evidence))) visits.push({ vehicleKey: vehicle.id, registration: vehicle.vehicle_reg, day, cluster, dayMissingMinutes: missing });
    }
    if (read.length) included.push({ registration: vehicle.vehicle_reg, days: read });
  }

  const { directory, directoryStatus } = await loadDirectoryPoints(client);
  const analysis = analyseRecurringAreas(visits, directory);
  const prepared = prepareSites(directory);
  analysis.areas = analysis.areas.map(a => ({ ...a, siteMatch: matchStop(prepared, areaEvidence(a)) }));
  return { vehiclesConsidered: vehicles.length, vehicleDaysInRange, vehicleDaysIncluded: included.reduce((n, v) => n + v.days.length, 0), included, directory: directoryStatus, analysis, driverCoverage: await loadDriverCoverage(client, included, from, to) };
}

/**
 * Driver evidence for the reviewed vehicle-days. Only a same-day Fuel Log that names a driver counts, and only as supporting evidence:
 * there is no dated assignment history, so nothing is "confirmed". An unreadable source leaves every day unknown.
 */
async function loadDriverCoverage(client: SourceClient, included: { registration: string; days: string[] }[], from: string, to: string): Promise<DriverCoverage> {
  const out: DriverCoverage = { vehicleDays: included.reduce((n, v) => n + v.days.length, 0), confirmed: 0, supporting: 0, conflicting: 0, unknown: 0, sourceRead: false };
  try {
    const regs = [...new Set(included.map(v => v.registration))].slice(0, MAX_VEHICLES);
    const rows = regs.length ? await client.from("fuel_logs").select("date,vehicle_reg,driver_id").in("vehicle_reg", regs).gte("date", from).lte("date", to).limit(1000) : { data: [], error: null };
    if (rows.error || !Array.isArray(rows.data)) throw new Error("fuel_logs");
    out.sourceRead = true;
    const data = rows.data as { date: string; vehicle_reg: string; driver_id: unknown }[];
    for (const v of included) for (const day of v.days) {
      const evidence = data.filter(r => r.vehicle_reg === v.registration && r.date === day && typeof r.driver_id === "string" && r.driver_id).map(r => ({ source: "fuel_log" as const, driverId: r.driver_id as string, day }));
      const status = resolveDriverForDay(day, evidence).status;
      if (status === "confirmed") out.confirmed++; else if (status === "supporting_evidence_only") out.supporting++; else if (status === "needs_review") out.conflicting++; else out.unknown++;
    }
  } catch { out.sourceRead = false; out.confirmed = out.supporting = out.conflicting = 0; out.unknown = out.vehicleDays; }
  return out;
}

/** Stop evidence for one recurring area, using only what the area analysis already measured. */
function areaEvidence(a: RecurringArea): StopEvidence {
  const all = a.quality.verified === a.visits, none = a.quality.verified === 0;
  return { latitude: a.centroid.latitude, longitude: a.centroid.longitude, radiusM: a.radiusM, dwellMinutes: a.stayMinutes.longestSupported, days: a.distinctDays, visits: a.visits, sourceQuality: all ? "verified_gps" : none ? "unverified" : "mixed", shortStaysOnly: a.flags.includes("short_stays_only_possible_roadside"), nextToGap: a.visitsNextToGap > 0 };
}

/** Directory points for read-only matching (Forth saved locations and office-confirmed pins). Failure to load never blocks an analysis. */
export async function loadDirectoryPoints(client: SourceClient): Promise<{ directory: DirectoryPoint[]; directoryStatus: RecurringResult["directory"] }> {
  const directory: DirectoryPoint[] = []; const directoryStatus = { forthSavedLocations: null as number | null, officeConfirmedPins: null as number | null };
  try {
    const payload = buildForthGpsMapPayloadFromCsv(await loadBundledForthPinnedLocationsCsv());
    if (payload.validation.status === "ready") { for (const l of payload.locations) directory.push({ id: `forth:${l.id}`, name: l.name, thaiName: l.thaiName, groupLayer: l.groupLayer, forthDiameterRaw: l.diameterRaw, latitude: l.latitude, longitude: l.longitude, source: "forth_saved_location", category: l.groupLayer ?? l.locationType }); directoryStatus.forthSavedLocations = payload.locations.length; }
  } catch { /* optional */ }
  try {
    const pins = await client.from("ees_location_map_pins").select("location_id,latitude,longitude").eq("pin_status", "manual_confirmed").limit(2000);
    if (!pins.error && pins.data) {
      const ids = [...new Set((pins.data as { location_id: unknown }[]).map(p => String(p.location_id)))].slice(0, 500);
      const names = ids.length ? await client.from("ees_locations").select("id,name").in("id", ids) : { data: [], error: null };
      const nameById = new Map(((names.data ?? []) as { id: unknown; name: unknown }[]).map(n => [String(n.id), String(n.name ?? "")]));
      for (const p of pins.data as { location_id: unknown; latitude: unknown; longitude: unknown }[]) if (typeof p.latitude === "number" && typeof p.longitude === "number") directory.push({ id: `pin:${String(p.location_id)}`, name: nameById.get(String(p.location_id)) || "Confirmed location", latitude: p.latitude, longitude: p.longitude, source: "office_confirmed_pin", category: null });
      directoryStatus.officeConfirmedPins = pins.data.length;
    }
  } catch { /* optional */ }
  return { directory, directoryStatus };
}
