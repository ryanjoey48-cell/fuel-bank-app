/**
 * Evidence-only journey summaries from Forth historical GPS observations.
 * Never invents missing movements, arrivals or departures.
 */

export type JourneyIntelligencePoint = {
  index: number;
  sourceTimestamp: string | null;
  timestampIso: string | null;
  latitude: number | null;
  longitude: number | null;
  verifiedGps: boolean;
  trailEligible?: boolean;
  speedKph: number | null;
  engineOn: boolean | null;
  gapBeforeMs: number | null;
  isGapEdge: boolean;
};

export type JourneyActivityKind = "moving" | "stopped" | "unknown";

export type JourneyActivityPeriod = {
  kind: JourneyActivityKind;
  startIndex: number;
  endIndex: number;
  startTimestampIso: string | null;
  endTimestampIso: string | null;
  durationMs: number | null;
  observationCount: number;
  maxSpeedKph: number | null;
};

export type JourneyStopCandidate = {
  key: string;
  label: string;
  kind: "customer_proximity" | "depot_proximity" | "speed_stop";
  startIndex: number;
  endIndex: number;
  seekIndex: number;
  startTimestampIso: string | null;
  endTimestampIso: string | null;
  durationMs: number | null;
  nearestDistanceMeters: number | null;
  observationCount: number;
  /** Explicit disclaimer: proximity evidence only — not delivery confirmation. */
  evidenceNote: "proximity_review_only" | "speed_stop_review_only";
};

export type JourneyIntelligenceSummary = {
  observationCount: number;
  verifiedCount: number;
  trailEligibleCount: number;
  reportedOnlyCount: number;
  gapCount: number;
  first: {
    index: number;
    timestampIso: string | null;
    latitude: number | null;
    longitude: number | null;
    verifiedGps: boolean;
  } | null;
  last: {
    index: number;
    timestampIso: string | null;
    latitude: number | null;
    longitude: number | null;
    verifiedGps: boolean;
  } | null;
  /** Wall-clock span between first and last timestamped observations — not continuous motion. */
  observedSpanMs: number | null;
  speed: {
    samples: number;
    maxKph: number | null;
    meanKph: number | null;
  };
  activityPeriods: JourneyActivityPeriod[];
  movingObservationCount: number;
  stoppedObservationCount: number;
  unknownActivityCount: number;
  stopCandidates: JourneyStopCandidate[];
};

const MOVING_SPEED_KPH = 5;
const STOP_MERGE_GAP_MS = 8 * 60_000;

function parseIsoMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function durationBetween(startIso: string | null, endIso: string | null): number | null {
  const start = parseIsoMs(startIso);
  const end = parseIsoMs(endIso);
  if (start == null || end == null || end < start) return null;
  return end - start;
}

function classifyActivity(point: JourneyIntelligencePoint): JourneyActivityKind {
  if (typeof point.speedKph === "number" && Number.isFinite(point.speedKph)) {
    return point.speedKph >= MOVING_SPEED_KPH ? "moving" : "stopped";
  }
  if (point.engineOn === false) return "stopped";
  return "unknown";
}

function buildActivityPeriods(points: readonly JourneyIntelligencePoint[]): JourneyActivityPeriod[] {
  if (!points.length) return [];
  const periods: JourneyActivityPeriod[] = [];
  let kind = classifyActivity(points[0]!);
  let startIndex = 0;
  let maxSpeed: number | null =
    typeof points[0]!.speedKph === "number" && Number.isFinite(points[0]!.speedKph) ? points[0]!.speedKph : null;

  const flush = (endIndex: number) => {
    const start = points[startIndex]!;
    const end = points[endIndex]!;
    periods.push({
      kind,
      startIndex,
      endIndex,
      startTimestampIso: start.timestampIso,
      endTimestampIso: end.timestampIso,
      durationMs: durationBetween(start.timestampIso, end.timestampIso),
      observationCount: endIndex - startIndex + 1,
      maxSpeedKph: maxSpeed
    });
  };

  for (let index = 1; index < points.length; index += 1) {
    const point = points[index]!;
    const nextKind = classifyActivity(point);
    if (nextKind !== kind) {
      flush(index - 1);
      kind = nextKind;
      startIndex = index;
      maxSpeed =
        typeof point.speedKph === "number" && Number.isFinite(point.speedKph) ? point.speedKph : null;
      continue;
    }
    if (typeof point.speedKph === "number" && Number.isFinite(point.speedKph)) {
      maxSpeed = maxSpeed == null ? point.speedKph : Math.max(maxSpeed, point.speedKph);
    }
  }
  flush(points.length - 1);
  return periods;
}

function speedStopCandidates(periods: readonly JourneyActivityPeriod[]): JourneyStopCandidate[] {
  return periods
    .filter((period) => period.kind === "stopped" && period.observationCount >= 2)
    .slice(0, 12)
    .map((period, index) => ({
      key: `speed-stop-${period.startIndex}-${period.endIndex}-${index}`,
      label: "Recorded stop (speed evidence)",
      kind: "speed_stop" as const,
      startIndex: period.startIndex,
      endIndex: period.endIndex,
      seekIndex: period.startIndex,
      startTimestampIso: period.startTimestampIso,
      endTimestampIso: period.endTimestampIso,
      durationMs: period.durationMs,
      nearestDistanceMeters: null,
      observationCount: period.observationCount,
      evidenceNote: "speed_stop_review_only" as const
    }));
}

export type ProximityVisitInput = {
  locationId: string;
  forthLocationId: string;
  name: string;
  observationCount: number;
  atLocationCount: number;
  approachingCount: number;
  firstTimestampIso: string | null;
  lastTimestampIso: string | null;
  durationMs: number | null;
  nearestDistanceMeters: number;
  /** When known, first qualifying observation index for seek. */
  seekIndex?: number | null;
  isDepot?: boolean;
};

function proximityStopCandidates(
  visits: readonly ProximityVisitInput[],
  points: readonly JourneyIntelligencePoint[]
): JourneyStopCandidate[] {
  return visits
    .filter((visit) => visit.observationCount >= 2 && visit.atLocationCount >= 1)
    .slice(0, 8)
    .map((visit, index) => {
      let seekIndex =
        typeof visit.seekIndex === "number" && visit.seekIndex >= 0 ? visit.seekIndex : null;
      if (seekIndex == null && visit.firstTimestampIso) {
        const match = points.findIndex((point) => point.timestampIso === visit.firstTimestampIso);
        seekIndex = match >= 0 ? match : null;
      }
      return {
        key: `proximity-${visit.locationId}-${index}`,
        label: visit.name,
        kind: visit.isDepot ? ("depot_proximity" as const) : ("customer_proximity" as const),
        startIndex: seekIndex ?? 0,
        endIndex: seekIndex ?? 0,
        seekIndex: seekIndex ?? 0,
        startTimestampIso: visit.firstTimestampIso,
        endTimestampIso: visit.lastTimestampIso,
        durationMs: visit.durationMs,
        nearestDistanceMeters: visit.nearestDistanceMeters,
        observationCount: visit.observationCount,
        evidenceNote: "proximity_review_only" as const
      };
    });
}

export function summarizeJourneyIntelligence(
  points: readonly JourneyIntelligencePoint[],
  options?: { proximityVisits?: readonly ProximityVisitInput[] }
): JourneyIntelligenceSummary {
  const observationCount = points.length;
  const verifiedCount = points.filter((point) => point.verifiedGps).length;
  const trailEligibleCount = points.filter((point) => point.trailEligible ?? point.verifiedGps).length;
  const reportedOnlyCount = Math.max(0, trailEligibleCount - verifiedCount);
  const gapCount = points.filter((point) => point.isGapEdge).length;
  const firstPoint = points[0] ?? null;
  const lastPoint = points.length ? points[points.length - 1]! : null;
  const speeds = points
    .map((point) => point.speedKph)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const activityPeriods = buildActivityPeriods(points);
  const movingObservationCount = points.filter((point) => classifyActivity(point) === "moving").length;
  const stoppedObservationCount = points.filter((point) => classifyActivity(point) === "stopped").length;
  const unknownActivityCount = observationCount - movingObservationCount - stoppedObservationCount;

  const stopCandidates = [
    ...proximityStopCandidates(options?.proximityVisits ?? [], points),
    ...speedStopCandidates(activityPeriods)
  ]
    .sort((left, right) => {
      const leftMs = parseIsoMs(left.startTimestampIso) ?? left.seekIndex;
      const rightMs = parseIsoMs(right.startTimestampIso) ?? right.seekIndex;
      return leftMs - rightMs;
    })
    .slice(0, 16);

  // Merge adjacent identical speed stops that are close in time (display only).
  const mergedStops: JourneyStopCandidate[] = [];
  for (const stop of stopCandidates) {
    const previous = mergedStops[mergedStops.length - 1];
    if (
      previous &&
      previous.kind === "speed_stop" &&
      stop.kind === "speed_stop" &&
      previous.endIndex + 1 >= stop.startIndex
    ) {
      const gap = durationBetween(previous.endTimestampIso, stop.startTimestampIso);
      if (gap != null && gap <= STOP_MERGE_GAP_MS) {
        previous.endIndex = stop.endIndex;
        previous.endTimestampIso = stop.endTimestampIso;
        previous.durationMs = durationBetween(previous.startTimestampIso, previous.endTimestampIso);
        previous.observationCount += stop.observationCount;
        continue;
      }
    }
    mergedStops.push({ ...stop });
  }

  return {
    observationCount,
    verifiedCount,
    trailEligibleCount,
    reportedOnlyCount,
    gapCount,
    first: firstPoint
      ? {
          index: firstPoint.index,
          timestampIso: firstPoint.timestampIso,
          latitude: firstPoint.latitude,
          longitude: firstPoint.longitude,
          verifiedGps: firstPoint.verifiedGps
        }
      : null,
    last: lastPoint
      ? {
          index: lastPoint.index,
          timestampIso: lastPoint.timestampIso,
          latitude: lastPoint.latitude,
          longitude: lastPoint.longitude,
          verifiedGps: lastPoint.verifiedGps
        }
      : null,
    observedSpanMs: durationBetween(firstPoint?.timestampIso ?? null, lastPoint?.timestampIso ?? null),
    speed: {
      samples: speeds.length,
      maxKph: speeds.length ? Math.max(...speeds) : null,
      meanKph: speeds.length
        ? Math.round((speeds.reduce((sum, value) => sum + value, 0) / speeds.length) * 10) / 10
        : null
    },
    activityPeriods,
    movingObservationCount,
    stoppedObservationCount,
    unknownActivityCount,
    stopCandidates: mergedStops
  };
}

export function formatJourneyDuration(ms: number | null, language: "en" | "th" = "en"): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return language === "th" ? "—" : "—";
  const totalMinutes = Math.round(ms / 60_000);
  if (totalMinutes < 60) {
    return language === "th" ? `${totalMinutes} นาที` : `${totalMinutes} min`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return language === "th" ? `${hours} ชม. ${minutes} นาที` : `${hours}h ${minutes}m`;
}
