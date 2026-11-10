import "server-only";
import { recalledProviderDay } from "./fleet-intelligence-session";
import { observationsFromProviderDay } from "./fleet-location-evidence";
import { detectStopClusters } from "./fleet-stop-intelligence";
import { groupStopsIntoVisits, type JoinEvidence, type SplitEvidence } from "./fleet-visit-grouping";
import { loadDirectoryPoints } from "./fleet-recurring-server";
import { loadCrossReference, suggestionForForthName } from "./fleet-crossref-server";
import { matchStop, prepareSites, type MatchReason, type MatchStatus, type MatchUncertainty, type SiteMatch } from "./fleet-location-match";
import { resolveDriverForDay, type DriverAttribution, type DriverEvidence } from "./fleet-driver-attribution";

type SourceClient = { from: (table: string) => any };
type Quality = "verified_gps" | "mixed" | "unverified";
export type PlaceMatch = {
  status: MatchStatus; reasons: MatchReason[]; uncertainty: MatchUncertainty[];
  primary: { name: string; thaiName: string | null; groupLayer: string | null; source: string; distanceM: number; proximity: "within_reference" | "near" | "far"; referenceRadiusM: number; forthDiameterRaw: string | null; entrances: number; /** A name suggestion for the matching EES directory record. Never a link. */ eesSuggestion: { eesName: string; status: string } | null } | null;
  alternatives: { name: string; thaiName: string | null; distanceM: number }[];
};
/** One original GPS stop, kept inside its visit with its own windows and its own (stop-level) match. */
export type VisitStop = { id: string; firstAt: string; lastAt: string; observedMinutes: number; observations: number; sourceQuality: Quality; nextToGap: boolean; matchStatus: MatchStatus; matchName: string | null };
export type Visit = {
  id: string; stops: VisitStop[];
  /** Why the stops were joined: evidence per join. */
  joins: JoinEvidence[];
  /** Observed windows only. Never exact times. A null bound means the day's data ends there. */
  arrivalWindow: { earliest: string | null; latest: string }; departureWindow: { earliest: string; latest: string | null };
  firstAt: string; lastAt: string;
  observedMinutes: number; spanMinutes: number; maxMinutes: number | null;
  sourceQuality: Quality; openStart: boolean; openEnd: boolean; nextToGap: boolean; interruptions: number; observations: number;
  match: PlaceMatch;
  /** Stop-level matches that name a different company than the visit-level match (the full visit evidence decides; alternatives stay visible). */
  stopLevelNames: string[];
};
export type DriveByRow = { firstAt: string; lastAt: string; observedMinutes: number; sourceQuality: Quality };
export type DayPlaces = {
  day: string; registration: string; read: boolean;
  visits: Visit[]; driveBys: DriveByRow[];
  /** Kept apart on purpose; they are different sources and different questions. */
  counts: { gpsStops: number; visits: number; driveBys: number; splitsKept: number; gapAffectedVisits: number; unknownVisits: number };
  splits: SplitEvidence[];
  driver: DriverAttribution; directory: { usable: number; total: number };
};

const toPlaceMatch = (m: SiteMatch, suggest: (name: string) => { eesName: string; status: string } | null): PlaceMatch => ({
  status: m.status, reasons: m.reasons, uncertainty: m.uncertainty,
  primary: m.primary ? { name: m.primary.name, thaiName: m.primary.thaiName, groupLayer: m.primary.groupLayer, source: m.primary.source, distanceM: m.primary.distanceM, proximity: m.primary.proximity, referenceRadiusM: m.primary.referenceRadiusM, forthDiameterRaw: m.primary.forthDiameterRaw, entrances: m.primary.entrances, eesSuggestion: suggest(m.primary.name) } : null,
  alternatives: m.alternatives.map(a => ({ name: a.name, thaiName: a.thaiName, distanceM: a.distanceM }))
});

/**
 * One vehicle-day, from THIS user's own cached provider day only (it never calls Forth). GPS stops are grouped into visits only where
 * the evidence supports it, each visit is matched to saved directory points once using ALL of its evidence, and only names, distances,
 * windows and counts are returned: never coordinates. The caller must already have checked historical-journey authorisation.
 */
export async function loadDayPlaces(input: { client: SourceClient; userId: string; vehicleId: string; day: string; canSeeDriverNames: boolean }): Promise<DayPlaces> {
  const { client, userId, vehicleId, day } = input;
  const registry = await client.from("vehicles").select("id,vehicle_reg,active").order("vehicle_reg").limit(101);
  if (registry.error || !registry.data || registry.data.length > 100) throw Object.assign(new Error("registry"), { status: 503 });
  const rows = registry.data as { id: string; vehicle_reg: string; active?: boolean | null }[];
  const key = (s: string) => s.normalize("NFKC").replace(/[\s\-‐‑‒–—]/g, "").toUpperCase();
  const vehicle = rows.find(v => v.id === vehicleId);
  if (!vehicle || vehicle.active === false || rows.filter(x => key(x.vehicle_reg) === key(vehicle.vehicle_reg)).length !== 1) throw Object.assign(new Error("vehicle"), { status: 404 });
  const evidence = recalledProviderDay(userId, vehicle.id, vehicle.vehicle_reg, day);

  const driverEvidence: DriverEvidence[] = [];
  try {
    const fuel = await client.from("fuel_logs").select("id,date,driver_id,vehicle_reg").eq("vehicle_reg", vehicle.vehicle_reg).eq("date", day).limit(50);
    const ids = [...new Set(((fuel.data ?? []) as { driver_id: unknown }[]).map(r => (typeof r.driver_id === "string" ? r.driver_id : "")).filter(Boolean))].slice(0, 20);
    const names = ids.length && input.canSeeDriverNames ? await client.from("drivers").select("id,name").in("id", ids) : { data: [] };
    const nameById = new Map(((names.data ?? []) as { id: unknown; name: unknown }[]).map(n => [String(n.id), typeof n.name === "string" ? n.name : null]));
    for (const id of ids) driverEvidence.push({ source: "fuel_log", driverId: id, driverName: nameById.get(id) ?? null, day });
  } catch { /* an unreadable source leaves the driver not confirmed */ }
  const driver = resolveDriverForDay(day, driverEvidence);

  const { directory } = await loadDirectoryPoints(client);
  const prepared = prepareSites(directory);
  let suggestions: Awaited<ReturnType<typeof loadCrossReference>>["results"] = [];
  try { suggestions = (await loadCrossReference(client)).results; } catch { /* suggestions are optional */ }
  const suggest = (name: string) => suggestionForForthName(suggestions, name);

  const visits: Visit[] = []; const driveBys: DriveByRow[] = []; let splits: DayPlaces["splits"] = []; let gpsStops = 0;
  if (evidence) {
    const observations = observationsFromProviderDay(evidence);
    const clusters = detectStopClusters(observations);
    const grouped = groupStopsIntoVisits(clusters, observations);
    gpsStops = grouped.stopCount; splits = grouped.splits;
    const byId = new Map(clusters.filter(c => c.kind === "stop").map(c => [`${c.firstAt}|${c.lastAt}`, c] as const));
    for (const g of grouped.groups) {
      const common = { sourceQuality: g.sourceQuality };
      const groupMatch = matchStop(prepared, { latitude: g.centroid.latitude, longitude: g.centroid.longitude, radiusM: g.spreadM, dwellMinutes: g.observedMinutes, days: 1, visits: 1, sourceQuality: g.sourceQuality, shortStaysOnly: g.observedMinutes < 10, nextToGap: g.nextToGap });
      const firstAt = g.stops[0].firstAt, lastAt = g.stops.at(-1)!.lastAt;
      if (groupMatch.status === "drive_by_only") { driveBys.push({ firstAt, lastAt, observedMinutes: g.observedMinutes, ...common }); continue; }
      const stops: VisitStop[] = g.stops.map(s => {
        const c = byId.get(`${s.firstAt}|${s.lastAt}`)!;
        const m = matchStop(prepared, { latitude: c.centroid.latitude, longitude: c.centroid.longitude, dwellMinutes: s.observedMinutes, days: 1, visits: 1, sourceQuality: s.sourceQuality, shortStaysOnly: s.observedMinutes < 10, nextToGap: s.nextToGap });
        return { ...s, matchStatus: m.status, matchName: m.primary?.name ?? null };
      });
      const primaryName = groupMatch.primary?.name ?? null;
      visits.push({
        id: g.id, stops, joins: g.joins, arrivalWindow: g.arrival, departureWindow: g.departure, firstAt, lastAt,
        observedMinutes: g.observedMinutes, spanMinutes: g.spanMinutes, maxMinutes: g.maxMinutes, sourceQuality: g.sourceQuality, openStart: g.openStart, openEnd: g.openEnd,
        nextToGap: g.nextToGap, interruptions: g.interruptions, observations: g.observations, match: toPlaceMatch(groupMatch, suggest),
        stopLevelNames: [...new Set(stops.map(s => s.matchName).filter((n): n is string => Boolean(n) && n !== primaryName))]
      });
    }
  }
  visits.sort((a, b) => Date.parse(a.firstAt) - Date.parse(b.firstAt));
  driveBys.sort((a, b) => Date.parse(a.firstAt) - Date.parse(b.firstAt));
  return {
    day, registration: vehicle.vehicle_reg, read: Boolean(evidence), visits, driveBys, splits, driver, directory: { usable: prepared.usable, total: prepared.count },
    counts: { gpsStops, visits: visits.length, driveBys: driveBys.length, splitsKept: splits.length, gapAffectedVisits: visits.filter(v => v.nextToGap).length, unknownVisits: visits.filter(v => v.match.status === "unknown_stopping_area").length }
  };
}
