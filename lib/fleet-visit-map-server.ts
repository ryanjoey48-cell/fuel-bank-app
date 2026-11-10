import "server-only";
import { recalledProviderDay } from "./fleet-intelligence-session";
import { observationsFromProviderDay } from "./fleet-location-evidence";
import { detectStopClusters } from "./fleet-stop-intelligence";
import { groupStopsIntoVisits } from "./fleet-visit-grouping";
import { loadDirectoryPoints } from "./fleet-recurring-server";
import { companyKey, matchStop, nearby, prepareSites, SEARCH_RADIUS_M } from "./fleet-location-match";
import { metersBetween } from "./fleet-job-movement";
import { visitMapView, type VisitMapData } from "./fleet-visit-map";

type SourceClient = { from: (table: string) => any };

/**
 * ONE visit of ONE vehicle-day for the map inspector. It reads only this user's own cached provider day (never Forth), rebuilds the
 * same stop clusters and visit groups as the day-places route (so the visit id means the same thing), and returns a bounded set of
 * observed positions plus the saved points inside the existing 250 m matching radius. The caller must already have passed the
 * historical-journey authorisation check. Coordinates are only ever returned in the response body, never in a URL.
 */
export async function loadVisitMap(input: { client: SourceClient; userId: string; vehicleId: string; day: string; visitId: string }): Promise<VisitMapData> {
  const { client, userId, vehicleId, day, visitId } = input;
  const registry = await client.from("vehicles").select("id,vehicle_reg,active").order("vehicle_reg").limit(101);
  if (registry.error || !registry.data || registry.data.length > 100) throw Object.assign(new Error("registry"), { status: 503 });
  const rows = registry.data as { id: string; vehicle_reg: string; active?: boolean | null }[];
  const key = (s: string) => s.normalize("NFKC").replace(/[\s\-‐‑‒–—]/g, "").toUpperCase();
  const vehicle = rows.find(v => v.id === vehicleId);
  if (!vehicle || vehicle.active === false || rows.filter(x => key(x.vehicle_reg) === key(vehicle.vehicle_reg)).length !== 1) throw Object.assign(new Error("vehicle"), { status: 404 });
  const evidence = recalledProviderDay(userId, vehicle.id, vehicle.vehicle_reg, day);
  const base = { vehicleId: vehicle.id, registration: vehicle.vehicle_reg, day, visitId };
  if (!evidence) return { ...base, status: "day_not_held" };

  const observations = observationsFromProviderDay(evidence);
  const clusters = detectStopClusters(observations);
  const grouped = groupStopsIntoVisits(clusters, observations);
  const group = grouped.groups.find(g => g.id === visitId);
  if (!group) return { ...base, status: "visit_not_found" };

  const { directory } = await loadDirectoryPoints(client);
  const prepared = prepareSites(directory);
  const match = matchStop(prepared, { latitude: group.centroid.latitude, longitude: group.centroid.longitude, radiusM: group.spreadM, dwellMinutes: group.observedMinutes, days: 1, visits: 1, sourceQuality: group.sourceQuality, shortStaysOnly: group.observedMinutes < 10, nextToGap: group.nextToGap });
  const primaryKey = match.primary ? companyKey(match.primary.name) : null;
  const altKeys = new Set(match.alternatives.map(a => companyKey(a.name)));
  const found = nearby(prepared, group.centroid, SEARCH_RADIUS_M).slice(0, 14);
  const candidates = found.map(f => ({
    id: f.point.id, name: f.point.name, thaiName: f.point.thaiName ?? null, latitude: f.point.latitude, longitude: f.point.longitude,
    distanceM: Math.round(f.distanceM), source: f.point.source, category: f.point.category ?? null,
    role: (primaryKey && companyKey(f.point.name) === primaryKey ? "primary" : altKeys.has(companyKey(f.point.name)) ? "alternative" : "nearby") as "primary" | "alternative" | "nearby"
  }));

  const first = Date.parse(group.stops[0].firstAt), last = Date.parse(group.stops.at(-1)!.lastAt);
  const PAD = 10 * 60_000;
  const inWindow = observations
    .map(o => ({ o, t: Date.parse(o.timestamp) }))
    .filter(x => Number.isFinite(x.t) && x.t >= first - PAD && x.t <= last + PAD)
    .sort((a, b) => a.t - b.t);
  const positions = inWindow.map(({ o, t }) => ({ at: o.timestamp, latitude: o.latitude, longitude: o.longitude, verified: o.verified, speedKph: o.speedKph, phase: (t < first ? "before" : t > last ? "after" : "during") as "before" | "during" | "after", distanceFromCentreM: Math.round(metersBetween(o, group.centroid)) }));

  return visitMapView({
    base, group: { firstAt: group.stops[0].firstAt, lastAt: group.stops.at(-1)!.lastAt, observedMinutes: group.observedMinutes, spanMinutes: group.spanMinutes, maxMinutes: group.maxMinutes, stops: group.stops.length, observations: group.observations, sourceQuality: group.sourceQuality, openStart: group.openStart, openEnd: group.openEnd, nextToGap: group.nextToGap, interruptions: group.interruptions, missingReports: group.joins.filter(j => j.missingReport).length, arrival: group.arrival, departure: group.departure, centroid: group.centroid, spreadM: group.spreadM },
    match: { status: match.status, reasons: match.reasons, uncertainty: match.uncertainty, primaryName: match.primary?.name ?? null, primaryDistanceM: match.primary?.distanceM ?? null },
    candidates, positions
  });
}
