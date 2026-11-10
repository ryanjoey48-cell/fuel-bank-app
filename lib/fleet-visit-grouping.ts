/**
 * V7.5 continuous-visit grouping. Pure, deterministic and read-only.
 *
 * Why it exists: the stop detector (V5.2) anchors every stop to its FIRST position and ends it when a position drifts more than 75 m
 * from that anchor, or speed rises above 8 km/h. A truck parked in a large lot, with ordinary GPS jitter or yard manoeuvres, is
 * therefore reported as many separate stops at the same place. The provider's own report is a different source (Forth parking
 * segments with minute-level, often zero-duration, entries). Both are kept; this module only decides which GPS stops have EVIDENCE of
 * being one continuous visit, and says why or why not.
 *
 * It reuses the V5.4 merge evidence (same place, short interruption, continuous tracking) and adds an explicit gap check, a spread
 * bound so a chain of nearby stops cannot grow without limit, and a "moving through" rule. It adds no new GPS, distance or stop
 * calculation, never uses a company name to group anything, and never confirms a visit: a rule accepting a join is evidence, not proof.
 *
 * Boundaries are central constants, documented below and tested at their edges.
 */
import { metersBetween } from "./fleet-job-movement";
import { MATERIAL_GAP_MS, REPORT_JITTER_MS, TELEMETRY_GAP_MS, normaliseObservations, type StopCluster, type StopObservation } from "./fleet-stop-intelligence";
import { MERGE_MAX_INTERRUPTION_MS, MERGE_MAX_SEPARATION_M } from "./fleet-visit-recognition";

/** Longest break between two stops that can still be one visit (reused from V5.4): a short manoeuvre or a short move inside the site. */
export const VISIT_MAX_INTERRUPTION_MS = MERGE_MAX_INTERRUPTION_MS;
/** Two stops are the same place only if their centres are within this distance (reused from V5.4). */
export const VISIT_MAX_SEPARATION_M = MERGE_MAX_SEPARATION_M;
/** Every position between two stops must stay within this distance of the earlier stop's centre; leaving it is leaving the site (V5.4: 250 m + 50 m of GPS tolerance). */
export const VISIT_LEAVE_DISTANCE_M = MERGE_MAX_SEPARATION_M + 50;
/** A visit may not spread wider than this from its first stop, so a chain of near stops cannot drift into a different site. */
export const VISIT_MAX_SPREAD_M = VISIT_LEAVE_DISTANCE_M;
/**
 * Recording-cadence tolerance. Measured on 3ฒน-9565, 2026-11-04 (real read): a parked truck reports about every 5 minutes, and the 28 neighbouring
 * stops in the lot were separated by one missing report, a spacing of about 10.0 minutes with no position between and 0–10 m apart. The stop
 * detector counts anything over exactly 10 minutes as a gap, so a few seconds of jitter split a stationary truck. Spacing up to this much over
 * the telemetry-gap limit is treated as recording jitter. The bridged minutes are still NOT counted as time at the site. Anything longer splits.
 */
export const VISIT_CADENCE_JITTER_MS = REPORT_JITTER_MS;
/** Positions faster than this between two stops mean the vehicle was driving through, not parked or manoeuvring in the yard. */
export const VISIT_MOVING_THROUGH_KPH = 30;

export type SplitReason = "different_place" | "interruption_too_long" | "tracking_gap_between" | "left_the_site" | "moving_through" | "spread_too_wide" | "no_continuous_tracking";
export type JoinEvidence = {
  /** The two original stops, by id. */
  fromStopId: string; toStopId: string;
  interruptionMinutes: number; separationM: number;
  /** Positions recorded between the stops, and the farthest any of them was from the site. */
  observationsBetween: number; farthestBetweenM: number; maxSpeedBetweenKph: number | null;
  /** Longest spacing between consecutive recorded positions across the join, and whether it exceeded the normal 10 minutes (a missing report: unobserved time, bridged but never counted as stay). */
  largestSpacingMinutes: number; missingReport: boolean;
};
export type GroupedStop = { id: string; firstAt: string; lastAt: string; observedMinutes: number; observations: number; sourceQuality: StopCluster["sourceQuality"]; nextToGap: boolean };
export type VisitGroup = {
  id: string;
  stops: GroupedStop[];
  joins: JoinEvidence[];
  /** Position-weighted centre and the widest distance of any stop centre from it. Server-side only; never sent to the browser. */
  centroid: { latitude: number; longitude: number }; spreadM: number;
  arrival: { earliest: string | null; latest: string }; departure: { earliest: string; latest: string | null };
  /** Observed stationary minutes: the sum of the stops' own observed spans. A lower bound; bridged interruptions are NOT added. */
  observedMinutes: number;
  /** First to last observation of the visit, which includes bridged short interruptions that had continuous tracking. */
  spanMinutes: number;
  /** The widest the surrounding observations allow; null when a bound is missing (day edge). */
  maxMinutes: number | null;
  observations: number;
  sourceQuality: StopCluster["sourceQuality"];
  /** The day's data starts or ends inside the visit: arrival or departure is unknown and the stay is a lower bound only. */
  openStart: boolean; openEnd: boolean;
  nextToGap: boolean; interruptions: number;
};
/** Why two neighbouring stops were kept apart, with the measured evidence behind the decision (no coordinates). */
export type SplitEvidence = { fromStopId: string; toStopId: string; reason: SplitReason; interruptionMinutes: number; separationM: number; observationsBetween: number; /** Longest spacing between consecutive recorded positions from the end of the earlier stop to the start of the later one. */ largestSpacingMinutes: number };
export type GroupingResult = { groups: VisitGroup[]; splits: SplitEvidence[]; stopCount: number; duplicatesRemoved: number };

const ms = (iso: string) => Date.parse(iso);
const mins = (v: number) => Math.round(v / 60_000);
const stopKey = (c: StopCluster) => `${c.firstAt}|${c.lastAt}`;
const byTime = (a: StopCluster, b: StopCluster) => ms(a.firstAt) - ms(b.firstAt) || ms(a.lastAt) - ms(b.lastAt) || a.centroid.latitude - b.centroid.latitude || a.centroid.longitude - b.centroid.longitude;

/**
 * Groups the day's stop clusters into continuous visits only where the evidence supports it.
 * Input order does not matter. Original stops stay inside the group with their own windows; nothing is dropped.
 */
export function groupStopsIntoVisits(clusters: readonly StopCluster[], observations: readonly StopObservation[]): GroupingResult {
  const obs = normaliseObservations(observations);
  const seen = new Set<string>(); const stops: StopCluster[] = [];
  for (const c of [...clusters].filter(x => x.kind === "stop").sort(byTime)) { const k = stopKey(c); if (seen.has(k)) continue; seen.add(k); stops.push(c); }
  const duplicatesRemoved = clusters.filter(x => x.kind === "stop").length - stops.length;
  const ids = new Map(stops.map((c, i) => [c, `S${String(i + 1).padStart(2, "0")}`] as const));

  const splits: SplitEvidence[] = [];
  const grouped: { stops: StopCluster[]; joins: JoinEvidence[] }[] = [];
  for (const stop of stops) {
    const current = grouped.at(-1);
    if (!current) { grouped.push({ stops: [stop], joins: [] }); continue; }
    const prev = current.stops.at(-1)!, first = current.stops[0];
    const fromStopId = ids.get(prev)!, toStopId = ids.get(stop)!;
    const interruption = ms(stop.firstAt) - ms(prev.lastAt);
    const between = obs.filter(o => ms(o.timestamp) > ms(prev.lastAt) && ms(o.timestamp) < ms(stop.firstAt));
    const separation = metersBetween(prev.centroid, stop.centroid);
    const farthest = Math.max(0, ...between.map(o => metersBetween(o, prev.centroid)));
    const speeds = between.map(o => o.speedKph).filter((s): s is number => s !== null);
    const maxSpeed = speeds.length ? Math.max(...speeds) : null;
    // Every spacing from the last position of the earlier stop to the first position of the later one must be an ordinary recording interval.
    const chain = [prev.lastAt, ...between.map(o => o.timestamp), stop.firstAt].map(ms);
    const hasGap = chain.some((t, i) => i > 0 && t - chain[i - 1] > MATERIAL_GAP_MS);
    let reason: SplitReason | null = null;
    if (interruption < 0 || interruption > VISIT_MAX_INTERRUPTION_MS) reason = "interruption_too_long";
    else if (separation > VISIT_MAX_SEPARATION_M) reason = "different_place";
    else if (hasGap) reason = "tracking_gap_between";
    else if (stop.beforeAt === null) reason = "no_continuous_tracking";
    else if (farthest > VISIT_LEAVE_DISTANCE_M) reason = "left_the_site";
    else if (maxSpeed !== null && maxSpeed > VISIT_MOVING_THROUGH_KPH) reason = "moving_through";
    else if (metersBetween(first.centroid, stop.centroid) > VISIT_MAX_SPREAD_M) reason = "spread_too_wide";
    if (reason) { splits.push({ fromStopId, toStopId, reason, interruptionMinutes: mins(interruption), separationM: Math.round(separation), observationsBetween: between.length, largestSpacingMinutes: Math.round(Math.max(0, ...chain.slice(1).map((t, i) => t - chain[i])) / 6_000) / 10 }); grouped.push({ stops: [stop], joins: [] }); continue; }
    current.stops.push(stop);
    current.joins.push({ fromStopId, toStopId, interruptionMinutes: mins(interruption), separationM: Math.round(separation), observationsBetween: between.length, farthestBetweenM: Math.round(farthest), maxSpeedBetweenKph: maxSpeed, largestSpacingMinutes: Math.round(Math.max(0, ...chain.slice(1).map((t, i) => t - chain[i])) / 6_000) / 10, missingReport: chain.slice(1).some((t, i) => t - chain[i] > TELEMETRY_GAP_MS) });
  }

  const groups: VisitGroup[] = grouped.map((g, index) => {
    const first = g.stops[0], last = g.stops.at(-1)!;
    const weight = g.stops.reduce((n, c) => n + c.observations, 0);
    const centroid = { latitude: g.stops.reduce((n, c) => n + c.centroid.latitude * c.observations, 0) / weight, longitude: g.stops.reduce((n, c) => n + c.centroid.longitude * c.observations, 0) / weight };
    const q = new Set(g.stops.map(c => c.sourceQuality));
    const sourceQuality: StopCluster["sourceQuality"] = q.size === 1 ? [...q][0] : q.has("verified_gps") ? "mixed" : q.has("mixed") ? "mixed" : "unverified";
    const openStart = first.beforeAt === null, openEnd = last.afterAt === null;
    return {
      id: `V${String(index + 1).padStart(2, "0")}`,
      stops: g.stops.map(c => ({ id: ids.get(c)!, firstAt: c.firstAt, lastAt: c.lastAt, observedMinutes: mins(c.dwellMs.min), observations: c.observations, sourceQuality: c.sourceQuality, nextToGap: c.gapBefore || c.gapAfter })),
      joins: g.joins, centroid, spreadM: Math.round(Math.max(0, ...g.stops.map(c => metersBetween(centroid, c.centroid)))),
      arrival: { earliest: first.arrivalWindow.earliest, latest: first.arrivalWindow.latest }, departure: { earliest: last.departureWindow.earliest, latest: last.departureWindow.latest },
      observedMinutes: g.stops.reduce((n, c) => n + mins(c.dwellMs.min), 0), spanMinutes: mins(ms(last.lastAt) - ms(first.firstAt)),
      maxMinutes: first.beforeAt && last.afterAt ? mins(ms(last.afterAt) - ms(first.beforeAt)) : null,
      observations: weight, sourceQuality, openStart, openEnd,
      nextToGap: g.stops.some(c => c.gapBefore || c.gapAfter), interruptions: g.joins.length
    };
  });
  return { groups, splits, stopCount: stops.length, duplicatesRemoved };
}

type Lang = "en" | "th";
const SPLIT: Record<SplitReason, [string, string]> = {
  different_place: ["The next stop is more than 250 m away: a different place.", "จุดจอดถัดไปอยู่ไกลเกิน 250 ม. เป็นคนละที่"],
  interruption_too_long: ["More than 15 minutes passed between the stops.", "ผ่านไปเกิน 15 นาทีระหว่างสองจุดจอด"],
  tracking_gap_between: ["Tracking has a gap between the stops, so staying at the site cannot be assumed.", "มีช่วงที่ขาดข้อมูลระหว่างสองจุดจอด จึงสรุปว่าอยู่ที่เดิมไม่ได้"],
  left_the_site: ["Positions between the stops left the site: the vehicle went out and came back.", "ตำแหน่งระหว่างสองจุดจอดออกนอกสถานที่ รถออกไปแล้วกลับมา"],
  moving_through: ["The vehicle was driving (over 30 km/h) between the stops.", "รถวิ่งด้วยความเร็วเกิน 30 กม./ชม. ระหว่างสองจุดจอด"],
  spread_too_wide: ["The stops spread over more than 300 m: too wide to be one visit.", "จุดจอดกระจายเกิน 300 ม. กว้างเกินกว่าจะเป็นการเข้าเยี่ยมครั้งเดียว"],
  no_continuous_tracking: ["Tracking was not continuous just before the later stop.", "การติดตามไม่ต่อเนื่องก่อนจุดจอดหลัง"]
};
export const splitReasonLabel = (r: SplitReason, language: Lang) => SPLIT[r][language === "th" ? 1 : 0];
