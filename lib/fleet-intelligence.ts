/** Pure fleet calculations. No network, database, booking or mileage writes. */
import type { HistoricalLogPoint } from "./forth-history-log";

export const FLEET_CALCULATION_VERSION = "ees-gps-v1";
export type EvidencePoint = HistoricalLogPoint & { evidenceId: string };
export type Interval = {
  id: string; start: string; end: string; evidenceIds: string[];
  state: "moving" | "stopped" | "idling" | "unknown" | "unavailable";
  km: number | null; method: "gps_chord" | "validated_counter" | "none";
  reason: string | null;
};
export type DistancePolicy = {
  maxGapSeconds: number; maxSpeedKph: number; movingSpeedKph: number;
  stationaryRadiusMeters: number;
  /** An externally validated cumulative counter contract, never inferred from Distance. */
  counter?: { evidenceReference: string; unitsPerKm: number };
};
export const DEFAULT_DISTANCE_POLICY: DistancePolicy = {
  maxGapSeconds: 300, maxSpeedKph: 150, movingSpeedKph: 5, stationaryRadiusMeters: 20
};

export function bangkokDay(day: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("invalid_day");
  const start = Date.parse(`${day}T00:00:00+07:00`);
  if (!Number.isFinite(start) || new Date(start + 7 * 3600000).toISOString().slice(0, 10) !== day) throw new Error("invalid_day");
  return { start, end: start + 86400000 };
}
export function distanceKm(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const rad = Math.PI / 180;
  const h = Math.sin((b.latitude-a.latitude)*rad/2)**2 + Math.cos(a.latitude*rad)*Math.cos(b.latitude*rad)*Math.sin((b.longitude-a.longitude)*rad/2)**2;
  return 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}
function eligible(p: EvidencePoint) {
  return p.verifiedGps && p.gpsStatus === "connected" && p.positionQuality === "gps" &&
    p.coordinateStatus === "valid" && Number.isFinite(p.latitude) && Number.isFinite(p.longitude) &&
    Math.abs(p.latitude!) <= 90 && Math.abs(p.longitude!) <= 180;
}

/** Exact day boundaries: cross-midnight intervals are unknown, never prorated. */
export function calculateVehicleDay(day: string, input: readonly EvidencePoint[], policy: DistancePolicy = DEFAULT_DISTANCE_POLICY) {
  const { start, end } = bangkokDay(day);
  if (![policy.maxGapSeconds, policy.maxSpeedKph, policy.movingSpeedKph, policy.stationaryRadiusMeters].every(v => Number.isFinite(v) && v > 0) ||
    (policy.counter && (!policy.counter.evidenceReference.trim() || !Number.isFinite(policy.counter.unitsPerKm) || policy.counter.unitsPerKm <= 0))) throw new Error("invalid_policy");
  const groups = new Map<number, EvidencePoint[]>();
  let invalidTimestampCount = 0;
  const ids = new Set<string>();
  for (const point of input) {
    if (!point.evidenceId || ids.has(point.evidenceId)) continue;
    ids.add(point.evidenceId);
    const time = point.timestampIso ? Date.parse(point.timestampIso) : NaN;
    if (!Number.isFinite(time)) { invalidTimestampCount++; continue; }
    groups.set(time, [...(groups.get(time) ?? []), point]);
  }
  // Different revisions at the same instant require explicit resolution upstream.
  const times = [...groups.keys()].sort((a,b) => a-b);
  const intervals: Interval[] = [];
  const addUnknown = (a: number,b: number,reason: string,evidenceIds: string[] = []) => {
    if (b>a) intervals.push({ id: `${a}:${b}`, start:new Date(a).toISOString(), end:new Date(b).toISOString(), evidenceIds, state:"unavailable", km:null, method:"none", reason });
  };
  let cursor = start;
  for (let i=1; i<times.length; i++) {
    const aTime=times[i-1], bTime=times[i];
    const lo=Math.max(start,aTime), hi=Math.min(end,bTime);
    if (hi<=lo) continue;
    if (lo>cursor) addUnknown(cursor,lo,"missing_samples");
    const aRows=groups.get(aTime)!, bRows=groups.get(bTime)!;
    const evidenceIds=[...aRows,...bRows].map(p=>p.evidenceId);
    const a=aRows[0],b=bRows[0];
    let reason: string | null = aRows.length!==1 || bRows.length!==1 ? "conflicting_timestamp" :
      aTime<start || bTime>end ? "day_boundary_without_sample" :
      (bTime-aTime)/1000>policy.maxGapSeconds ? "sample_gap" :
      !eligible(a) || !eligible(b) ? "unverified_position" : null;
    const hours=(bTime-aTime)/3600000;
    const chord=reason ? 0 : distanceKm(a as {latitude:number;longitude:number},b as {latitude:number;longitude:number});
    if (!reason && chord/hours>policy.maxSpeedKph) reason="unrealistic_jump";
    if (reason) { addUnknown(lo,hi,reason,evidenceIds); cursor=hi; continue; }
    let km=chord, method:Interval["method"]="gps_chord";
    if (policy.counter && a.sourceDistanceRaw!==null && b.sourceDistanceRaw!==null) {
      const delta=(b.sourceDistanceRaw-a.sourceDistanceRaw)/policy.counter.unitsPerKm;
      if (!Number.isFinite(delta) || delta<0 || delta/hours>policy.maxSpeedKph || delta+0.05<chord) {
        addUnknown(lo,hi,"counter_reset_or_conflict",evidenceIds); cursor=hi; continue;
      }
      km=delta; method="validated_counter";
    }
    const motion=a.speedKph!==null && b.speedKph!==null && (a.speedKph>=policy.movingSpeedKph || b.speedKph>=policy.movingSpeedKph);
    const stationary=chord*1000<=policy.stationaryRadiusMeters && a.speedKph!==null && b.speedKph!==null && a.speedKph<policy.movingSpeedKph && b.speedKph<policy.movingSpeedKph;
    const state:Interval["state"]=motion ? "moving" : stationary ? (a.engineOn===true && b.engineOn===true ? "idling" : a.engineOn===false && b.engineOn===false ? "stopped" : "unknown") : "unknown";
    // Suppress GPS jitter only for coordinate-derived stationary intervals.
    if (stationary && method==="gps_chord") km=0;
    intervals.push({id:`${lo}:${hi}`,start:new Date(lo).toISOString(),end:new Date(hi).toISOString(),evidenceIds,state,km,method,reason:null});
    cursor=hi;
  }
  if (cursor<end) addUnknown(cursor,end,"missing_samples");
  const observed=intervals.filter(i=>i.km!==null);
  const coveredSeconds=observed.reduce((n,i)=>n+(Date.parse(i.end)-Date.parse(i.start))/1000,0);
  const hoursFor=(state:Interval["state"])=>observed.filter(i=>i.state===state).reduce((n,i)=>n+(Date.parse(i.end)-Date.parse(i.start))/3600000,0);
  return { day, version:FLEET_CALCULATION_VERSION, policy, intervals, invalidTimestampCount,
    observedKm:observed.length ? observed.reduce((n,i)=>n+i.km!,0) : null,
    coveredSeconds, missingSeconds:86400-coveredSeconds, complete:coveredSeconds===86400 && invalidTimestampCount===0,
    confidence:observed.length ? "derived_with_conditions" : "unavailable",
    activeHours:observed.length ? hoursFor("moving") : null, idleHours:observed.length ? hoursFor("idling") : null, stoppedHours:observed.length ? hoursFor("stopped") : null,
    note:"GPS chords are sampled path estimates, not proof of every travelled kilometre. State durations describe intervals between observations." };
}

export type Allocation = { intervalId:string; kind:"depot"|"job"|"repositioning"; jobId?:string; confirmedBy:string; evidenceReference:string };
/** One interval is an indivisible accounting unit. Conflicts stay unassigned. */
export function allocateDistance(intervals: readonly Interval[], decisions: readonly Allocation[]) {
  const totals={depotKm:0,jobKm:0,repositioningKm:0,unassignedKm:0};
  const rows=intervals.filter(i=>i.km!==null).map(i=>{
    const matches=decisions.filter(d=>d.intervalId===i.id && d.confirmedBy.trim() && d.evidenceReference.trim() && (d.kind!=="job" || d.jobId));
    const choice=matches.length===1 ? matches[0] : null;
    const key=choice?.kind==="depot" ? "depotKm" : choice?.kind==="job" ? "jobKm" : choice?.kind==="repositioning" ? "repositioningKm" : "unassignedKm";
    totals[key]+=i.km!;
    return {intervalId:i.id,km:i.km!,kind:choice?.kind ?? "unassigned",jobId:choice?.jobId ?? null,reason:matches.length>1 ? "conflicting_allocations" : choice ? null : "confirmation_required"};
  });
  return {rows,...totals,totalObservedKm:rows.reduce((n,r)=>n+r.km,0),allocatedKm:totals.depotKm+totals.jobKm+totals.repositioningKm};
}

export function segmentTimeline(intervals: readonly Interval[]) {
  const segments: {start:string;end:string;state:Interval["state"];reason:string|null;km:number|null;intervalIds:string[]}[]=[];
  for (const i of intervals) {
    const previous=segments.at(-1);
    if (previous && previous.state===i.state && previous.reason===i.reason && previous.end===i.start) {
      previous.end=i.end; previous.km=previous.km===null || i.km===null ? null : previous.km+i.km; previous.intervalIds.push(i.id);
    } else segments.push({start:i.start,end:i.end,state:i.state,reason:i.reason,km:i.km,intervalIds:[i.id]});
  }
  return segments;
}
