/**
 * V5.2 smart stop intelligence. Pure and read-only; works on ordered Forth observations and never touches a source.
 *
 * What it will and will not claim:
 *  - A "stop" needs two or more ordered observations that stay together and are slow. One position or one speed reading
 *    never proves an arrival. Slow movement that is still travelling (a traffic jam, manoeuvring) is not a stop.
 *  - Every stop carries bounded windows: the arrival lies between the last observation before it and the first inside it;
 *    the departure between the last inside and the next observation after it. A 5-minute gap is a 5-minute window, not a moment.
 *  - A missing period is never a stop. A stop next to a telemetry gap is "incomplete telemetry", not a clean visit.
 *  - Unverified positions can only ever support "provider-reported" classes, never GPS-supported ones.
 *  - Dwell is how long the vehicle stayed put. It is not unloading time and not billable waiting time.
 *  - Nothing here confirms a job. An algorithmic class is never shown as an office confirmation.
 */
import { metersBetween } from "./fleet-job-movement";

export type StopObservation = { timestamp: string; latitude: number; longitude: number; speedKph: number | null; verified: boolean };
export type Coord = { latitude: number; longitude: number };

export const STOP_CLUSTER_RADIUS_M = 75;
export const STOP_SLOW_KPH = 8;
export const STOP_MEDIAN_MAX_KPH = 2;
export const STOP_MIN_OBSERVATIONS = 2;
export const STOP_MIN_SPAN_MS = 60_000;
export const TELEMETRY_GAP_MS = 10 * 60_000;
/**
 * A missing report is not a material gap. Real data (3ฒน-9565, 2026-11-04) shows a parked truck reporting about every 5 minutes with one
 * report missing now and then, a spacing of about 10 minutes plus a few seconds. Spacing over TELEMETRY_GAP_MS but within this tolerance is
 * a "missing report": the time is still unobserved and still never counted as stay time, but it does not claim a tracking outage.
 * Longer spacing is a material tracking gap.
 */
export const REPORT_JITTER_MS = 60_000;
export const MATERIAL_GAP_MS = TELEMETRY_GAP_MS + REPORT_JITTER_MS;
export const TIGHT_WINDOW_MS = 6 * 60_000;
export const DRIVE_BY_KPH = 5;
export const DEFAULT_SEARCH_RADIUS_M = 1000;
export const MAX_SEARCH_RADIUS_M = 2000;

const ms = (iso: string) => Date.parse(iso);
const median = (values: number[]) => { if (!values.length) return null; const s = [...values].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/** Time-ordered, de-duplicated, valid observations only. */
export function normaliseObservations(points: readonly StopObservation[]): StopObservation[] {
  const seen = new Set<string>(); const out: StopObservation[] = [];
  for (const p of [...points].sort((a, b) => ms(a.timestamp) - ms(b.timestamp))) {
    if (!Number.isFinite(ms(p.timestamp)) || !Number.isFinite(p.latitude) || !Number.isFinite(p.longitude) || Math.abs(p.latitude) > 90 || Math.abs(p.longitude) > 180) continue;
    const key = `${p.timestamp}|${p.latitude}|${p.longitude}`; if (seen.has(key)) continue; seen.add(key); out.push(p);
  }
  return out;
}

export type StopKind = "stop" | "slow_movement";
export type StopCluster = {
  kind: StopKind;
  centroid: Coord;
  observations: number;
  firstAt: string; lastAt: string;
  /** Last observation before the cluster and first after it (null = none exists). */
  beforeAt: string | null; afterAt: string | null;
  arrivalWindow: { earliest: string | null; latest: string };
  departureWindow: { earliest: string; latest: string | null };
  /** Dwell range: observed span (minimum) and the widest the bounds allow (maximum, null when a bound is missing). */
  dwellMs: { min: number; max: number | null };
  medianSpeedKph: number | null; maxSpeedKph: number | null;
  verifiedShare: number;
  sourceQuality: "verified_gps" | "mixed" | "unverified";
  /** A MATERIAL tracking gap (or no observation at all) immediately before / after the stop. */
  gapBefore: boolean; gapAfter: boolean;
  /** A single missing report (spacing between 10 and 11 minutes) immediately before / after: unobserved time, but not a tracking outage. */
  missingReportBefore: boolean; missingReportAfter: boolean;
  tightWindows: boolean;
};

/**
 * Finds clusters of slow, spatially compact observations. Ordered observations only; a cluster never spans a telemetry gap.
 * A cluster whose median speed is above STOP_MEDIAN_MAX_KPH is slow_movement (traffic, manoeuvring), not a stop.
 */
export function detectStopClusters(input: readonly StopObservation[]): StopCluster[] {
  const obs = normaliseObservations(input); const clusters: StopCluster[] = [];
  let i = 0;
  while (i < obs.length) {
    const start = obs[i];
    if (start.speedKph !== null && start.speedKph > STOP_SLOW_KPH) { i++; continue; }
    let j = i;
    while (j + 1 < obs.length) {
      const next = obs[j + 1];
      if (ms(next.timestamp) - ms(obs[j].timestamp) > TELEMETRY_GAP_MS) break;
      if (next.speedKph !== null && next.speedKph > STOP_SLOW_KPH) break;
      if (metersBetween(start, next) > STOP_CLUSTER_RADIUS_M) break;
      j++;
    }
    const members = obs.slice(i, j + 1);
    const span = ms(members.at(-1)!.timestamp) - ms(members[0].timestamp);
    if (members.length >= STOP_MIN_OBSERVATIONS && span >= STOP_MIN_SPAN_MS) {
      const speeds = members.map(m => m.speedKph).filter((s): s is number => s !== null);
      const med = median(speeds);
      const before = i > 0 ? obs[i - 1] : null, after = j + 1 < obs.length ? obs[j + 1] : null;
      const first = ms(members[0].timestamp), last = ms(members.at(-1)!.timestamp);
      const verifiedShare = members.filter(m => m.verified).length / members.length;
      const spacingBefore = before ? first - ms(before.timestamp) : null, spacingAfter = after ? ms(after.timestamp) - last : null;
      const gapBefore = spacingBefore === null || spacingBefore > MATERIAL_GAP_MS, gapAfter = spacingAfter === null || spacingAfter > MATERIAL_GAP_MS;
      const missingReportBefore = !gapBefore && spacingBefore !== null && spacingBefore > TELEMETRY_GAP_MS, missingReportAfter = !gapAfter && spacingAfter !== null && spacingAfter > TELEMETRY_GAP_MS;
      const arrivalWidth = before ? first - ms(before.timestamp) : null, departureWidth = after ? ms(after.timestamp) - last : null;
      clusters.push({
        kind: med !== null && med > STOP_MEDIAN_MAX_KPH ? "slow_movement" : "stop",
        centroid: { latitude: members.reduce((n, m) => n + m.latitude, 0) / members.length, longitude: members.reduce((n, m) => n + m.longitude, 0) / members.length },
        observations: members.length, firstAt: members[0].timestamp, lastAt: members.at(-1)!.timestamp,
        beforeAt: before?.timestamp ?? null, afterAt: after?.timestamp ?? null,
        arrivalWindow: { earliest: before?.timestamp ?? null, latest: members[0].timestamp },
        departureWindow: { earliest: members.at(-1)!.timestamp, latest: after?.timestamp ?? null },
        dwellMs: { min: span, max: before && after ? ms(after.timestamp) - ms(before.timestamp) : null },
        medianSpeedKph: med === null ? null : Math.round(med * 10) / 10, maxSpeedKph: speeds.length ? Math.max(...speeds) : null,
        verifiedShare, sourceQuality: verifiedShare === 1 ? "verified_gps" : verifiedShare === 0 ? "unverified" : "mixed",
        gapBefore, gapAfter, missingReportBefore, missingReportAfter, tightWindows: arrivalWidth !== null && departureWidth !== null && arrivalWidth <= TIGHT_WINDOW_MS && departureWidth <= TIGHT_WINDOW_MS
      });
      i = j + 1;
    } else i = Math.max(j + 1, i + 1);
  }
  return clusters;
}

export type DriveBy = { at: string; speedKph: number | null; closestM: number };
/** Observations inside the radius that are moving and brief: driving past, never an arrival. */
export function findDriveBys(input: readonly StopObservation[], anchor: Coord, radiusM: number): DriveBy[] {
  const obs = normaliseObservations(input);
  const inside = obs.map((p, index) => ({ p, index, d: metersBetween(p, anchor) })).filter(x => x.d <= radiusM);
  // Group consecutive inside observations into passes; a pass of one or two moving observations is a drive-by.
  const passes: DriveBy[] = []; let group: typeof inside = [];
  const flush = () => { if (group.length && group.length <= 2 && group.every(g => g.p.speedKph !== null && g.p.speedKph >= DRIVE_BY_KPH)) passes.push({ at: group[0].p.timestamp, speedKph: Math.max(...group.map(g => g.p.speedKph!)), closestM: Math.round(Math.min(...group.map(g => g.d))) }); group = []; };
  for (const x of inside) { if (group.length && x.index !== group.at(-1)!.index + 1) flush(); group.push(x); }
  flush();
  return passes;
}

export type SiteClass = "A_office_confirmed" | "B_gps_supported_probable" | "C_provider_reported_probable" | "D_possible_incomplete_telemetry" | "E_drive_by" | "F_ambiguous_multiple" | "G_no_usable_evidence";
export type SiteAssessment = {
  class: SiteClass;
  reasons: SiteReason[];
  /** The stop chosen for the windows (only for B, C, D); null for E, F, G. */
  stop: StopCluster | null;
  candidates: StopCluster[];
  driveBys: DriveBy[];
  closestApproachM: number | null;
  /** True when the evidence is algorithmic. It is never an office confirmation unless class A. */
  algorithmic: boolean;
};
export type SiteReason =
  | "office_confirmed_input" | "stop_near_site_verified_positions" | "stop_near_site_unverified_positions" | "stop_next_to_telemetry_gap" | "stop_windows_wider_than_tolerance"
  | "single_observation_only" | "slow_movement_not_a_stop" | "drove_past_at_speed" | "several_stops_near_site" | "no_positions_near_site" | "no_observations_at_all"
  | "never_within_search_radius" | "booked_point_unverified" | "mixed_source_quality";

/**
 * Classifies what the observations support at one site. `radiusM` is the matching radius around the point used for the site
 * (the V5 default is 150 m); it is never widened here. Class letters follow the V5.2 brief and stay separate from booking
 * completion or billing.
 */
export function assessSiteVisit(input: { observations: readonly StopObservation[]; point: Coord | null; radiusM: number; pointVerified: boolean; officeConfirmedAt?: string | null }): SiteAssessment {
  const base: SiteAssessment = { class: "G_no_usable_evidence", reasons: [], stop: null, candidates: [], driveBys: [], closestApproachM: null, algorithmic: true };
  const reasons = base.reasons;
  if (!input.pointVerified) reasons.push("booked_point_unverified");
  if (input.officeConfirmedAt) return { ...base, class: "A_office_confirmed", reasons: ["office_confirmed_input"], algorithmic: false };
  const obs = normaliseObservations(input.observations);
  if (!obs.length) return { ...base, reasons: [...reasons, "no_observations_at_all"] };
  if (!input.point) return { ...base, reasons: [...reasons, "no_positions_near_site"] };
  const closest = Math.round(Math.min(...obs.map(p => metersBetween(p, input.point!))));
  const near = detectStopClusters(obs).filter(c => metersBetween(c.centroid, input.point!) <= input.radiusM);
  const stops = near.filter(c => c.kind === "stop"), slow = near.filter(c => c.kind === "slow_movement");
  const driveBys = findDriveBys(obs, input.point, input.radiusM);
  const result = { ...base, closestApproachM: closest, driveBys, candidates: stops };
  if (stops.length > 1) return { ...result, class: "F_ambiguous_multiple", reasons: [...reasons, "several_stops_near_site"] };
  if (stops.length === 1) {
    const s = stops[0];
    const flags: SiteReason[] = [...reasons];
    if (s.gapBefore || s.gapAfter) flags.push("stop_next_to_telemetry_gap");
    if (!s.tightWindows) flags.push("stop_windows_wider_than_tolerance");
    if (s.sourceQuality === "mixed") flags.push("mixed_source_quality");
    if (s.sourceQuality === "unverified") { flags.push("stop_near_site_unverified_positions"); return { ...result, stop: s, class: s.gapBefore || s.gapAfter ? "D_possible_incomplete_telemetry" : "C_provider_reported_probable", reasons: flags }; }
    flags.push("stop_near_site_verified_positions");
    // A mixed cluster is only as good as its unverified part: it cannot be called GPS supported.
    if (s.sourceQuality === "mixed") return { ...result, stop: s, class: "C_provider_reported_probable", reasons: flags };
    return { ...result, stop: s, class: s.gapBefore || s.gapAfter ? "D_possible_incomplete_telemetry" : "B_gps_supported_probable", reasons: flags };
  }
  if (slow.length) return { ...result, class: "G_no_usable_evidence", reasons: [...reasons, "slow_movement_not_a_stop"] };
  if (driveBys.length) return { ...result, class: "E_drive_by", reasons: [...reasons, "drove_past_at_speed"] };
  const inside = obs.filter(p => metersBetween(p, input.point!) <= input.radiusM);
  if (inside.length === 1) return { ...result, class: "D_possible_incomplete_telemetry", reasons: [...reasons, "single_observation_only"] };
  return { ...result, reasons: [...reasons, closest > MAX_SEARCH_RADIUS_M ? "never_within_search_radius" : "no_positions_near_site"] };
}

export type StopCandidate = {
  cluster: StopCluster;
  distanceFromBookedPointM: number;
  /** An evidence weight for sorting. It is not a probability and never confirms anything. */
  weight: number;
  reasons: string[];
};
export type CandidateSearch = {
  searchRadiusM: number;
  candidates: StopCandidate[];
  /** The booked point looks like a roadside pin: a fast pass within 30 m. */
  bookedPointOnRoad: boolean;
  limitations: string[];
};

/**
 * Bounded search for plausible stop clusters around an unreviewed booked point. The search is capped (default 1 km, never above 2 km)
 * and the 150 m matching radius is not changed. A nearby stop is a candidate for office review, never the customer's site by itself.
 */
export function searchCandidateStops(input: { observations: readonly StopObservation[]; point: Coord; searchRadiusM?: number }): CandidateSearch {
  const radius = Math.min(Math.max(input.searchRadiusM ?? DEFAULT_SEARCH_RADIUS_M, 150), MAX_SEARCH_RADIUS_M);
  const obs = normaliseObservations(input.observations);
  const clusters = detectStopClusters(obs).filter(c => c.kind === "stop");
  const candidates: StopCandidate[] = clusters.map(cluster => {
    const d = Math.round(metersBetween(cluster.centroid, input.point));
    return { cluster, distanceFromBookedPointM: d, reasons: [] as string[], weight: 0 };
  }).filter(c => c.distanceFromBookedPointM <= radius).map(c => {
    const k = c.cluster; const reasons: string[] = [];
    let weight = 0;
    weight += Math.max(0, 30 - Math.round(c.distanceFromBookedPointM / (radius / 30))); // closer is better
    weight += Math.min(25, Math.round(k.dwellMs.min / 60_000)); // up to 25 for 25+ minutes observed
    weight += Math.round(k.verifiedShare * 20);
    weight += k.observations >= 4 ? 10 : k.observations >= 3 ? 6 : 3;
    weight += k.tightWindows ? 10 : 0;
    weight -= k.gapBefore || k.gapAfter ? 10 : 0;
    if (k.sourceQuality !== "verified_gps") reasons.push("positions_not_all_verified_gps");
    if (k.gapBefore || k.gapAfter) reasons.push("next_to_telemetry_gap");
    if (c.distanceFromBookedPointM > 150) reasons.push("outside_the_150m_matching_radius");
    reasons.push("could_belong_to_a_neighbouring_site");
    return { ...c, weight: Math.max(0, Math.min(100, weight)), reasons };
  }).sort((a, b) => b.weight - a.weight || a.distanceFromBookedPointM - b.distanceFromBookedPointM);
  const onRoad = obs.some(p => metersBetween(p, input.point) <= 30 && (p.speedKph ?? 0) >= 40);
  const limitations = ["Candidates are not customer sites until the office verifies a pin.", "Stops are inferred from positions about every 1 to 5 minutes; shorter stops can be missed.", "Road proximity is inferred from speed only; no road geometry is used."];
  if (!obs.length) limitations.push("No observations were available.");
  return { searchRadiusM: radius, candidates, bookedPointOnRoad: onRoad, limitations };
}

export type VehicleDayCluster = { vehicleKey: string; day: string; cluster: StopCluster };
export type SharedCandidate = {
  centroid: Coord; vehicles: number; days: number; stops: number; totalDwellMinutesObserved: number;
  verifiedGpsStops: number; unverifiedStops: number;
  status: "candidate_unverified";
  evidence: { vehicleKey: string; day: string; sourceQuality: StopCluster["sourceQuality"] }[];
};
/**
 * Groups stops from different vehicle-days that land within `radiusM` of each other. Agreement between vehicles raises
 * interest, never verification: unverified positions stay unverified however many vehicles share them.
 */
export function aggregateSharedCandidates(items: readonly VehicleDayCluster[], radiusM = 120): SharedCandidate[] {
  const stops = items.filter(i => i.cluster.kind === "stop"); const groups: VehicleDayCluster[][] = [];
  for (const item of stops) {
    const g = groups.find(grp => metersBetween(grp[0].cluster.centroid, item.cluster.centroid) <= radiusM);
    if (g) g.push(item); else groups.push([item]);
  }
  return groups.map(g => ({
    centroid: { latitude: g.reduce((n, x) => n + x.cluster.centroid.latitude, 0) / g.length, longitude: g.reduce((n, x) => n + x.cluster.centroid.longitude, 0) / g.length },
    vehicles: new Set(g.map(x => x.vehicleKey)).size, days: new Set(g.map(x => x.day)).size, stops: g.length,
    totalDwellMinutesObserved: Math.round(g.reduce((n, x) => n + x.cluster.dwellMs.min, 0) / 60_000),
    verifiedGpsStops: g.filter(x => x.cluster.sourceQuality === "verified_gps").length, unverifiedStops: g.filter(x => x.cluster.sourceQuality !== "verified_gps").length,
    status: "candidate_unverified" as const, evidence: g.map(x => ({ vehicleKey: x.vehicleKey, day: x.day, sourceQuality: x.cluster.sourceQuality }))
  })).sort((a, b) => b.vehicles - a.vehicles || b.stops - a.stops);
}
