/**
 * V7.8.3 daily mileage reconciliation (pure, read-only). It EXPLAINS the difference between two existing figures for a reviewed vehicle-day and
 * adds no distance calculation of its own:
 *   providerKm  = Forth parking report: the sum of the report's own segment distances (provider-reported, not GPS);
 *   gpsKm       = whole-day GPS chords between consecutive VERIFIED positions (`calculateVehicleDay`, policy ees-gps-v1: 300 s maximum
 *                 spacing, 150 km/h jump limit, stationary jitter suppressed). It is a sampled path estimate, never proof of travelled km.
 * Nothing is adjusted to make the two agree. A difference is a review candidate, never evidence that the vehicle drove more or less.
 *
 * The GPS side is split with the journey ledger's own per-segment GPS figures (GPS intervals lying wholly inside one provider report segment)
 * and the GPS timeline (intervals lying wholly OUTSIDE every report segment). Nothing is prorated; whatever cannot be placed stays "unattributed".
 *   difference = (GPS not inside compared moving segments) + (like-for-like residual) − (provider km with no comparable GPS inside)
 * The like-for-like residual compares GPS and provider km over exactly the same moving segments: it is what this data cannot explain. Percentages use the LARGER of the two figures as the denominator
 * (the same rule Daily Activity already uses to decide whether to show a disagreement notice).
 */
export const DISAGREE_MIN_KM = 5;
export const DISAGREE_MIN_FRACTION = 0.1;
export const MATERIAL_GAP_MIN = 60;

export type ReconTimelineSegment = { start: string; end: string; state: string; reason: string | null; km: number | null };
export type ReconProviderSegment = { id: string; start: string; end: string | null; km: number };
export type ReconJourney = { id: string; segmentId?: string; kind: string; start: string; end: string | null; minutes: number | null; providerKm: number; verifiedGpsKm: number | null; reportedTrailKm: number | null; positionSource: string; issues: readonly string[]; ambiguous: boolean; observations: number };
export type ReconDay = {
  day: string;
  sources: { providerReported: { value: number | null }; gpsDerived: { value: number | null } };
  provider: { arithmetic: { status: string }; segments: readonly ReconProviderSegment[] };
  gps: { observedKm: number | null; coveredSeconds: number; unknownSeconds: number; complete: boolean; observations: number; verifiedObservations: number; timeline: readonly ReconTimelineSegment[] };
  logAvailable: boolean; reportAvailable?: boolean;
  journeyLedger?: { journeys: readonly ReconJourney[]; totals: { missingMinutes: number; duplicateObservations: number; verifiedGpsKm: number | null; outsideReportLogKm: number | null } } | null;
};
/** Server-side indicators from the cached verified positions. Counts and distances only; no coordinates. */
export type ChordStats = { positions: number; largestChordKm: number | null; chordsOver3Km: number; repeatedPositions: number };

export type ReconStatus = "comparable_disagreement" | "comparable_agreement" | "qualified" | "not_comparable" | "unknown";
export type QualifyReason = "tracking_gap" | "unverified_positions" | "open_final_segment" | "excluded_jump_intervals" | "partial_day_coverage";
export type NotComparableReason = "provider_not_reconciled" | "gps_log_unavailable" | "report_unavailable";
export type Bucket = { km: number; segments: number };
export type OutsideWindow = { start: string; end: string; minutes: number; km: number };
export type DayReconciliation = {
  day: string; status: ReconStatus; qualifiers: QualifyReason[]; notComparable: NotComparableReason | null;
  providerKm: number | null; gpsKm: number | null; differenceKm: number | null; absoluteKm: number | null; percentOfLarger: number | null;
  verifiedPositions: number; positions: number; coveragePercent: number; trackingGapMinutes: number | null;
  gpsByState: Record<"moving" | "idling" | "stopped" | "unknown", number>;
  attribution: { insideMoving: Bucket; insideStopped: Bucket; outsideReport: Bucket & { minutes: number }; unattributed: { km: number }; comparedProviderKm: number; providerUncomparedKm: number } | null;
  /** The largest GPS windows that lie outside every provider report segment (times and km only; no coordinates). */
  outsideWindows: OutsideWindow[];
  /** difference = outsideMovingKm + likeForLikeResidualKm − providerUncomparedKm (exact up to rounding). */
  outsideMovingKm: number | null; likeForLikeResidualKm: number | null;
  excluded: { reason: string; minutes: number; intervals: number }[];
  duplicatePositions: number | null; chord: ChordStats | null;
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const ms = (iso: string) => Date.parse(iso);
const finite = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n);

/** Same display rule as Daily Activity: at least 5 km and at least 10% of the larger figure. */
export function disagrees(providerKm: number | null, gpsKm: number | null) {
  if (!finite(providerKm) || !finite(gpsKm)) return false;
  const diff = Math.abs(providerKm - gpsKm);
  return diff >= DISAGREE_MIN_KM && diff >= DISAGREE_MIN_FRACTION * Math.max(providerKm, gpsKm);
}
export function percentOfLarger(providerKm: number | null, gpsKm: number | null) {
  if (!finite(providerKm) || !finite(gpsKm)) return null;
  const larger = Math.max(providerKm, gpsKm);
  return larger > 0 ? r2((Math.abs(providerKm - gpsKm) / larger) * 100) : null;
}

export function reconcileDay(day: ReconDay, chord: ChordStats | null = null): DayReconciliation {
  const provider = day.provider.arithmetic.status === "pass" && finite(day.sources.providerReported.value) ? day.sources.providerReported.value : null;
  const gps = finite(day.gps.observedKm) ? day.gps.observedKm : null;
  const segs = day.provider.segments.filter(s => finite(s.km));
  const openFinal = segs.some(s => s.end === null);
  const ledger = day.journeyLedger ?? null;
  const gapMin = ledger ? ledger.totals.missingMinutes : null;
  const timeline = day.gps.timeline;
  const known = timeline.filter(t => finite(t.km));
  const gpsByState = { moving: 0, idling: 0, stopped: 0, unknown: 0 };
  for (const t of known) { const k = (t.state in gpsByState ? t.state : "unknown") as keyof typeof gpsByState; gpsByState[k] += t.km as number; }
  for (const k of Object.keys(gpsByState) as (keyof typeof gpsByState)[]) gpsByState[k] = r2(gpsByState[k]);

  // Excluded intervals: time the GPS rule could not turn into distance, grouped by its own reason.
  const ex = new Map<string, { minutes: number; intervals: number }>();
  for (const t of timeline) if (!finite(t.km)) { const e = ex.get(t.reason ?? "unavailable") ?? { minutes: 0, intervals: 0 }; e.minutes += (ms(t.end) - ms(t.start)) / 60000; e.intervals++; ex.set(t.reason ?? "unavailable", e); }
  const excluded = [...ex.entries()].map(([reason, e]) => ({ reason, minutes: Math.round(e.minutes), intervals: e.intervals })).sort((a, b) => b.minutes - a.minutes);

  // Attribution. "Inside" figures come from the journey ledger (it only gives GPS km for a segment when every GPS interval touching it lies fully inside it
  // and is verified; otherwise unknown). "Outside" figures come from timeline intervals that touch NO provider report segment.
  let attribution: DayReconciliation["attribution"] = null; let outsideWindows: OutsideWindow[] = [];
  if (gps !== null && segs.length > 0 && ledger) {
    const moving = ledger.journeys.filter(j => j.kind === "moving" && !j.ambiguous && !(j.observations === 0 || j.minutes === 0));
    const stopped = ledger.journeys.filter(j => j.kind === "stopped" && !j.ambiguous && finite(j.verifiedGpsKm));
    const withGps = moving.filter(j => finite(j.verifiedGpsKm));
    const insideMoving = withGps.reduce((n, j) => n + (j.verifiedGpsKm as number), 0), comparedProvider = withGps.reduce((n, j) => n + j.providerKm, 0);
    const insideStopped = stopped.reduce((n, j) => n + (j.verifiedGpsKm as number), 0);
    const outside = known.filter(t => !segs.some(s => ms(s.start) < ms(t.end) && (s.end === null ? Number.POSITIVE_INFINITY : ms(s.end)) > ms(t.start)));
    const outsideKm = outside.reduce((n, t) => n + (t.km as number), 0), outsideMin = outside.reduce((n, t) => n + (ms(t.end) - ms(t.start)) / 60000, 0);
    outsideWindows = outside.filter(t => (t.km as number) > 0).map(t => ({ start: t.start, end: t.end, minutes: Math.round((ms(t.end) - ms(t.start)) / 60000), km: r2(t.km as number) })).sort((x, y) => y.km - x.km).slice(0, 5);
    attribution = {
      insideMoving: { km: r2(insideMoving), segments: withGps.length }, insideStopped: { km: r2(insideStopped), segments: stopped.length },
      outsideReport: { km: r2(outsideKm), segments: outside.length, minutes: Math.round(outsideMin) },
      unattributed: { km: r2(gps - insideMoving - insideStopped - outsideKm) },
      comparedProviderKm: r2(comparedProvider), providerUncomparedKm: provider === null ? 0 : r2(provider - comparedProvider)
    };
  }

  const qualifiers: QualifyReason[] = [];
  if (gapMin !== null && gapMin >= MATERIAL_GAP_MIN) qualifiers.push("tracking_gap");
  if (day.gps.observations > 0 && day.gps.verifiedObservations < day.gps.observations) qualifiers.push("unverified_positions");
  if (openFinal) qualifiers.push("open_final_segment");
  if (excluded.some(e => e.reason === "unrealistic_jump")) qualifiers.push("excluded_jump_intervals");
  if (day.gps.coveredSeconds < 0.5 * 86400) qualifiers.push("partial_day_coverage");

  const notComparable: NotComparableReason | null = day.reportAvailable === false ? "report_unavailable" : !day.logAvailable ? "gps_log_unavailable" : day.provider.arithmetic.status !== "pass" ? "provider_not_reconciled" : null;
  const both = provider !== null && gps !== null && notComparable === null;
  const status: ReconStatus = notComparable ? "not_comparable" : !both ? "unknown" : qualifiers.length ? "qualified" : disagrees(provider, gps) ? "comparable_disagreement" : "comparable_agreement";
  const diff = both ? r2(gps! - provider!) : null;
  const outsideMoving = both && attribution ? r2(gps! - attribution.insideMoving.km) : null;
  return {
    day: day.day, status, qualifiers, notComparable, providerKm: provider, gpsKm: gps, differenceKm: diff, absoluteKm: diff === null ? null : r2(Math.abs(diff)),
    percentOfLarger: both ? percentOfLarger(provider, gps) : null, verifiedPositions: day.gps.verifiedObservations, positions: day.gps.observations,
    coveragePercent: Math.round((Math.min(day.gps.coveredSeconds, 86400) / 86400) * 1000) / 10, trackingGapMinutes: gapMin,
    gpsByState, attribution, outsideWindows, outsideMovingKm: outsideMoving, likeForLikeResidualKm: both && attribution ? r2(attribution.insideMoving.km - attribution.comparedProviderKm) : null,
    excluded, duplicatePositions: ledger ? ledger.totals.duplicateObservations : null, chord
  };
}

export type PeriodContribution = { day: string; status: ReconStatus; differenceKm: number | null; shareOfPeriod: number | null };
export type PeriodReconciliation = {
  days: number; reviewedDays: number; comparableDays: number;
  /** Totals exactly as the Reports figures are built: provider km over reconciled days, GPS km over days with a GPS figure. */
  providerKm: number | null; gpsKm: number | null;
  /** Totals over the days where BOTH figures exist (the only days whose difference is explained below). */
  comparedProviderKm: number | null; comparedGpsKm: number | null; differenceKm: number | null; percentOfLarger: number | null;
  onlyOneSource: { providerOnlyKm: number; gpsOnlyKm: number; days: number };
  contributions: PeriodContribution[]; largest: PeriodContribution | null;
  /** difference − Σ day differences: always ~0; shown so an incomplete decomposition could never hide. */
  unattributedKm: number | null;
};
export function reconcilePeriod(rows: readonly DayReconciliation[], calendarDays: number): PeriodReconciliation {
  const sum = (v: number[]) => (v.length ? r2(v.reduce((n, x) => n + x, 0)) : null);
  const provider = rows.filter(r => r.providerKm !== null), gps = rows.filter(r => r.gpsKm !== null);
  const cmp = rows.filter(r => r.differenceKm !== null);
  const diff = cmp.length ? r2(cmp.reduce((n, r) => n + r.differenceKm!, 0)) : null;
  const cp = sum(cmp.map(r => r.providerKm!)), cg = sum(cmp.map(r => r.gpsKm!));
  const contributions = cmp.map(r => ({ day: r.day, status: r.status, differenceKm: r.differenceKm, shareOfPeriod: diff !== null && Math.abs(diff) >= 0.005 ? Math.round((r.differenceKm! / diff) * 1000) / 10 : null }));
  const largest = [...contributions].sort((a, b) => Math.abs(b.differenceKm!) - Math.abs(a.differenceKm!))[0] ?? null;
  const providerOnly = rows.filter(r => r.providerKm !== null && r.differenceKm === null), gpsOnly = rows.filter(r => r.gpsKm !== null && r.differenceKm === null);
  return {
    days: calendarDays, reviewedDays: rows.length, comparableDays: cmp.length,
    providerKm: sum(provider.map(r => r.providerKm!)), gpsKm: sum(gps.map(r => r.gpsKm!)),
    comparedProviderKm: cp, comparedGpsKm: cg, differenceKm: diff, percentOfLarger: cp !== null && cg !== null ? percentOfLarger(cp, cg) : null,
    onlyOneSource: { providerOnlyKm: r2(providerOnly.reduce((n, r) => n + r.providerKm!, 0)), gpsOnlyKm: r2(gpsOnly.reduce((n, r) => n + r.gpsKm!, 0)), days: new Set([...providerOnly, ...gpsOnly].map(r => r.day)).size },
    contributions, largest, unattributedKm: diff === null ? null : r2(diff - contributions.reduce((n, c) => n + c.differenceKm!, 0))
  };
}

export type JourneyReconRow = { id: string; start: string; end: string | null; minutes: number | null; providerKm: number; gpsKm: number | null; unexplainedKm: number | null; positionSource: string; issues: readonly string[]; ambiguous: boolean };
/** Moving provider segments with the GPS km inside them. Provider per-segment km is the report's own; nothing is apportioned or invented. */
export function journeyRows(day: ReconDay): JourneyReconRow[] {
  const journeys = day.journeyLedger?.journeys ?? [];
  return journeys.filter(j => j.kind === "moving" && !(j.observations === 0 || j.minutes === 0)).map(j => ({
    id: j.id, start: j.start, end: j.end, minutes: j.minutes, providerKm: j.providerKm, gpsKm: j.verifiedGpsKm,
    unexplainedKm: j.verifiedGpsKm === null ? null : r2(j.verifiedGpsKm - j.providerKm), positionSource: j.positionSource, issues: j.issues, ambiguous: j.ambiguous
  }));
}

/** Point-to-point indicators from the verified positions (server only). Coordinates never leave the caller. */
export function chordStats(points: readonly { latitude: number; longitude: number; timestamp: string }[], distance: (a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) => number): ChordStats {
  const ordered = [...points].filter(p => Number.isFinite(p.latitude) && Number.isFinite(p.longitude) && Number.isFinite(ms(p.timestamp))).sort((a, b) => ms(a.timestamp) - ms(b.timestamp));
  let largest: number | null = null, over3 = 0, repeated = 0;
  for (let i = 1; i < ordered.length; i++) {
    const d = distance(ordered[i - 1], ordered[i]);
    if (ordered[i].latitude === ordered[i - 1].latitude && ordered[i].longitude === ordered[i - 1].longitude) repeated++;
    if (largest === null || d > largest) largest = d;
    if (d > 3) over3++;
  }
  return { positions: ordered.length, largestChordKm: largest === null ? null : r2(largest), chordsOver3Km: over3, repeatedPositions: repeated };
}

type Pair = readonly [string, string];
export const RECON_STATUS_COPY: Record<ReconStatus, Pair> = {
  comparable_disagreement: ["Comparable · sources disagree", "เปรียบเทียบได้ · สองแหล่งไม่ตรงกัน"], comparable_agreement: ["Comparable · within tolerance", "เปรียบเทียบได้ · อยู่ในเกณฑ์"],
  qualified: ["Partially comparable", "เปรียบเทียบได้บางส่วน"], not_comparable: ["Not comparable", "เปรียบเทียบไม่ได้"], unknown: ["Unknown", "ไม่ทราบ"]
};
export const QUALIFIER_COPY: Record<QualifyReason, Pair> = {
  tracking_gap: ["60+ minutes with no tracker data", "ไม่มีข้อมูลจากตัวติดตาม 60 นาทีขึ้นไป"], unverified_positions: ["some positions are not GPS-verified", "บางตำแหน่งไม่ได้ยืนยันด้วย GPS"],
  open_final_segment: ["the report's final segment is still open", "ช่วงสุดท้ายในรายงานยังไม่ปิด"], excluded_jump_intervals: ["GPS intervals were excluded as unrealistic jumps", "ช่วง GPS ถูกตัดออกเพราะกระโดดผิดปกติ"], partial_day_coverage: ["less than half of the day has GPS coverage", "GPS ครอบคลุมน้อยกว่าครึ่งวัน"]
};
export const NOT_COMPARABLE_COPY: Record<NotComparableReason, Pair> = {
  provider_not_reconciled: ["the report's own totals do not reconcile", "ยอดในรายงานไม่กระทบยอด"], gps_log_unavailable: ["no GPS log for this day", "ไม่มีบันทึก GPS ของวันนี้"], report_unavailable: ["no provider report for this day", "ไม่มีรายงานผู้ให้บริการของวันนี้"]
};
export const EXCLUDED_COPY: Record<string, Pair> = {
  missing_samples: ["no samples recorded", "ไม่มีตัวอย่างที่บันทึก"], sample_gap: ["spacing over 5 minutes", "ห่างเกิน 5 นาที"], unverified_position: ["position not GPS-verified", "ตำแหน่งไม่ยืนยันด้วย GPS"],
  unrealistic_jump: ["jump over 150 km/h", "กระโดดเกิน 150 กม./ชม."], conflicting_timestamp: ["conflicting records at one instant", "บันทึกขัดแย้งในเวลาเดียวกัน"], day_boundary_without_sample: ["crosses midnight without a sample", "ข้ามเที่ยงคืนโดยไม่มีตัวอย่าง"], counter_reset_or_conflict: ["counter conflict", "ตัวนับขัดแย้ง"], unavailable: ["unavailable", "ไม่พร้อม"]
};
export const METHOD_COPY: Pair = [
  "Percentage = |GPS − provider| ÷ the larger of the two figures. A disagreement is shown from 5 km and 10%. GPS km sums straight chords between consecutive verified positions (at most 5 minutes apart, jumps over 150 km/h excluded, stationary jitter suppressed); it is an estimate of the path, not proof of travelled kilometres. Provider km sums the report's own segment distances. Neither is treated as correct.",
  "ร้อยละ = |GPS − ผู้ให้บริการ| ÷ ค่าที่มากกว่าของสองตัวเลข แสดงว่าไม่ตรงกันเมื่อต่างตั้งแต่ 5 กม. และ 10% ระยะ GPS รวมเส้นตรงระหว่างตำแหน่งที่ยืนยันติดกัน (ห่างไม่เกิน 5 นาที ตัดการกระโดดเกิน 150 กม./ชม. และกดการสั่นขณะจอด) เป็นการประมาณเส้นทาง ไม่ใช่หลักฐานว่าวิ่งจริง ระยะผู้ให้บริการรวมระยะรายช่วงในรายงานเอง ไม่ถือว่าฝ่ายใดถูกต้อง"
];
